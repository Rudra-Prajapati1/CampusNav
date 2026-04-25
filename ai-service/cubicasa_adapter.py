import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Tuple

import cv2
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

from floortrans.models.hg_furukawa_original import hg_furukawa_original


ROOM_CLASSES = [
    "Background",
    "Outdoor",
    "Wall",
    "Kitchen",
    "Living Room",
    "Bedroom",
    "Bath",
    "Hallway",
    "Railing",
    "Storage",
    "Garage",
    "Other rooms",
]

ICON_CLASSES = [
    "Empty",
    "Window",
    "Door",
    "Closet",
    "Electrical Appliance",
    "Toilet",
    "Sink",
    "Sauna Bench",
    "Fire Place",
    "Bathtub",
    "Chimney",
]

CUBICASA_SPLIT = (21, 12, 11)
CUBICASA_N_CLASSES = 44


@dataclass
class CubiCasaRuntime:
    model: nn.Module
    device: torch.device
    weights_path: Path


@dataclass
class CubiCasaPrediction:
    room_segmentation: np.ndarray
    icon_segmentation: np.ndarray
    room_confidence: np.ndarray
    icon_confidence: np.ndarray


def default_weights_path() -> Path:
    configured = os.getenv("CUBICASA_WEIGHTS_PATH")
    if configured:
        return Path(configured).expanduser().resolve()
    return Path(__file__).resolve().parent / "models" / "model_best_val_loss_var.pkl"


def default_device() -> torch.device:
    configured = os.getenv("CUBICASA_DEVICE", "").strip().lower()
    if configured:
        return torch.device(configured)
    return torch.device("cuda" if torch.cuda.is_available() else "cpu")


def default_input_size() -> int:
    raw_value = os.getenv("CUBICASA_INPUT_SIZE", "256")
    try:
        parsed = int(raw_value)
    except ValueError:
        parsed = 512
    return max(256, min(parsed, 1536))


def _load_checkpoint(path: Path, device: torch.device):
    try:
        return torch.load(path, map_location=device, weights_only=False)
    except TypeError:
        return torch.load(path, map_location=device)


def _normalize_state_dict(checkpoint) -> dict:
    state = checkpoint.get("model_state", checkpoint) if isinstance(checkpoint, dict) else checkpoint
    if not isinstance(state, dict):
        raise ValueError("CubiCasa weights do not contain a model state dictionary.")
    if any(str(key).startswith("module.") for key in state.keys()):
        return {str(key).removeprefix("module."): value for key, value in state.items()}
    return state


def build_runtime(weights_path: Optional[Path] = None) -> CubiCasaRuntime:
    resolved_weights = (weights_path or default_weights_path()).expanduser().resolve()
    if not resolved_weights.exists():
        raise FileNotFoundError(
            "CubiCasa weights are missing. Put model_best_val_loss_var.pkl at "
            f"{resolved_weights} or set CUBICASA_WEIGHTS_PATH."
        )

    device = default_device()
    model = hg_furukawa_original(n_classes=51)
    model.conv4_ = nn.Conv2d(256, CUBICASA_N_CLASSES, bias=True, kernel_size=1)
    model.upsample = nn.ConvTranspose2d(
        CUBICASA_N_CLASSES,
        CUBICASA_N_CLASSES,
        kernel_size=4,
        stride=4,
    )

    checkpoint = _load_checkpoint(resolved_weights, device)
    model.load_state_dict(_normalize_state_dict(checkpoint), strict=True)
    model.to(device)
    model.eval()
    return CubiCasaRuntime(model=model, device=device, weights_path=resolved_weights)


def _prepare_image(image_bgr: np.ndarray, input_size: int) -> Tuple[torch.Tensor, Tuple[int, int, int, int]]:
    height, width = image_bgr.shape[:2]
    scale = min(input_size / max(width, 1), input_size / max(height, 1))
    resized_width = max(1, int(round(width * scale)))
    resized_height = max(1, int(round(height * scale)))

    rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
    resized = cv2.resize(rgb, (resized_width, resized_height), interpolation=cv2.INTER_AREA)
    canvas = np.full((input_size, input_size, 3), 255, dtype=np.uint8)

    pad_x = (input_size - resized_width) // 2
    pad_y = (input_size - resized_height) // 2
    canvas[pad_y : pad_y + resized_height, pad_x : pad_x + resized_width] = resized

    normalized = 2.0 * (canvas.astype(np.float32) / 255.0) - 1.0
    tensor = torch.from_numpy(np.moveaxis(normalized, -1, 0)).unsqueeze(0)
    return tensor, (pad_x, pad_y, resized_width, resized_height)


def predict(runtime: CubiCasaRuntime, image_bgr: np.ndarray) -> CubiCasaPrediction:
    input_size = default_input_size()
    tensor, crop = _prepare_image(image_bgr, input_size)
    pad_x, pad_y, resized_width, resized_height = crop
    original_height, original_width = image_bgr.shape[:2]

    with torch.inference_mode():
        output = runtime.model(tensor.to(runtime.device))
        if output.shape[-2:] != (input_size, input_size):
            output = F.interpolate(
                output,
                size=(input_size, input_size),
                mode="bilinear",
                align_corners=False,
            )
        output = output[0].detach().cpu()

    _, room_count, icon_count = CUBICASA_SPLIT
    room_logits = output[21 : 21 + room_count]
    icon_logits = output[21 + room_count : 21 + room_count + icon_count]

    room_probs = F.softmax(room_logits, dim=0).numpy()
    icon_probs = F.softmax(icon_logits, dim=0).numpy()

    room_seg = np.argmax(room_probs, axis=0).astype(np.uint8)
    icon_seg = np.argmax(icon_probs, axis=0).astype(np.uint8)
    room_conf = np.max(room_probs, axis=0).astype(np.float32)
    icon_conf = np.max(icon_probs, axis=0).astype(np.float32)

    crop_slice = np.s_[pad_y : pad_y + resized_height, pad_x : pad_x + resized_width]
    room_seg = room_seg[crop_slice]
    icon_seg = icon_seg[crop_slice]
    room_conf = room_conf[crop_slice]
    icon_conf = icon_conf[crop_slice]

    room_seg = cv2.resize(room_seg, (original_width, original_height), interpolation=cv2.INTER_NEAREST)
    icon_seg = cv2.resize(icon_seg, (original_width, original_height), interpolation=cv2.INTER_NEAREST)
    room_conf = cv2.resize(room_conf, (original_width, original_height), interpolation=cv2.INTER_LINEAR)
    icon_conf = cv2.resize(icon_conf, (original_width, original_height), interpolation=cv2.INTER_LINEAR)

    return CubiCasaPrediction(
        room_segmentation=room_seg,
        icon_segmentation=icon_seg,
        room_confidence=room_conf,
        icon_confidence=icon_conf,
    )
