import json
import logging
import math
import os
import tempfile
import threading
import urllib.request
import uuid
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

import cv2
import fitz
import numpy as np
from PIL import Image

try:
    import torch
    from detectron2 import model_zoo
    from detectron2.config import get_cfg
    from detectron2.engine import DefaultPredictor

    DETECTRON_AVAILABLE = True
except Exception:  # pragma: no cover - import is optional at runtime
    DETECTRON_AVAILABLE = False
    torch = None
    model_zoo = None
    get_cfg = None
    DefaultPredictor = None

try:
    from skimage.morphology import skeletonize as skimage_skeletonize
except Exception:  # pragma: no cover
    skimage_skeletonize = None


LOGGER = logging.getLogger("campusnav.pipeline")

Point = Tuple[float, float]
Line = Tuple[int, int, int, int]


CLASS_INDEX = {
    "background": 0,
    "outer_wall": 1,
    "inner_wall": 2,
    "window": 3,
    "door": 4,
    "room": 5,
    "corridor": 6,
    "railing": 7,
    "stairs": 8,
    "elevator": 9,
}

MODEL_LOCK = threading.Lock()
MODEL_STATE = {
    "attempted": False,
    "predictor": None,
    "error": None,
}


@dataclass
class ImageBundle:
    image_bgr: np.ndarray
    width: int
    height: int


def make_uuid() -> str:
    return str(uuid.uuid4())


def feature_collection() -> Dict:
    return {"type": "FeatureCollection", "features": []}


def parse_options(raw_options: object) -> Dict:
    if isinstance(raw_options, dict):
        return raw_options
    if not raw_options:
        return {}
    try:
        parsed = json.loads(raw_options)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def load_image_from_bytes(content: bytes, filename: str) -> ImageBundle:
    lower = (filename or "upload.png").lower()
    if lower.endswith(".pdf"):
        doc = fitz.open(stream=content, filetype="pdf")
        if doc.page_count == 0:
            raise ValueError("The uploaded PDF does not contain any pages.")
        page = doc.load_page(0)
        pix = page.get_pixmap(alpha=False, dpi=220)
        image = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        bgr = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
        return ImageBundle(image_bgr=bgr, width=bgr.shape[1], height=bgr.shape[0])

    image = Image.open(BytesIO(content)).convert("RGB")
    bgr = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
    return ImageBundle(image_bgr=bgr, width=bgr.shape[1], height=bgr.shape[0])


def closed_polygon(points: Sequence[Sequence[float]]) -> List[List[float]]:
    if not points:
        return []
    coords = [[float(p[0]), float(p[1])] for p in points]
    if coords[0] != coords[-1]:
        coords.append([coords[0][0], coords[0][1]])
    return coords


def polygon_centroid(points: Sequence[Sequence[float]]) -> Point:
    arr = np.array(points, dtype=np.float32)
    if arr.size == 0:
        return (0.0, 0.0)
    return (float(np.mean(arr[:, 0])), float(np.mean(arr[:, 1])))


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def euclidean(a: Point, b: Point) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def line_orientation(line: Line) -> str:
    x1, y1, x2, y2 = line
    dx = x2 - x1
    dy = y2 - y1
    if abs(dy) <= abs(dx) * 0.35:
        return "horizontal"
    if abs(dx) <= abs(dy) * 0.35:
        return "vertical"
    return "other"


def line_length(line: Line) -> float:
    x1, y1, x2, y2 = line
    return math.hypot(x2 - x1, y2 - y1)


def normalize_line(raw_line: Sequence[int]) -> Line:
    x1, y1, x2, y2 = [int(value) for value in raw_line]
    if abs(y2 - y1) < abs(x2 - x1):
        return (x1, y1, x2, y2) if x1 <= x2 else (x2, y2, x1, y1)
    return (x1, y1, x2, y2) if y1 <= y2 else (x2, y2, x1, y1)


def merge_parallel_lines(lines: List[Line], orientation: str) -> List[Line]:
    if not lines:
        return []

    normalized = [normalize_line(line) for line in lines if line_length(line) >= 24]
    if not normalized:
        return []

    if orientation == "horizontal":
        normalized.sort(key=lambda line: (round((line[1] + line[3]) / 2), line[0], line[2]))
    else:
        normalized.sort(key=lambda line: (round((line[0] + line[2]) / 2), line[1], line[3]))

    merged: List[Line] = []
    for line in normalized:
        if not merged:
            merged.append(line)
            continue

        prev = merged[-1]
        if orientation == "horizontal":
            prev_y = int(round((prev[1] + prev[3]) / 2))
            line_y = int(round((line[1] + line[3]) / 2))
            prev_start, prev_end = sorted((prev[0], prev[2]))
            line_start, line_end = sorted((line[0], line[2]))
            gap = line_start - prev_end
            if abs(prev_y - line_y) <= 8 and gap <= 14:
                merged[-1] = (
                    min(prev_start, line_start),
                    int(round((prev_y + line_y) / 2)),
                    max(prev_end, line_end),
                    int(round((prev_y + line_y) / 2)),
                )
            else:
                merged.append(line)
        else:
            prev_x = int(round((prev[0] + prev[2]) / 2))
            line_x = int(round((line[0] + line[2]) / 2))
            prev_start, prev_end = sorted((prev[1], prev[3]))
            line_start, line_end = sorted((line[1], line[3]))
            gap = line_start - prev_end
            if abs(prev_x - line_x) <= 8 and gap <= 14:
                merged[-1] = (
                    int(round((prev_x + line_x) / 2)),
                    min(prev_start, line_start),
                    int(round((prev_x + line_x) / 2)),
                    max(prev_end, line_end),
                )
            else:
                merged.append(line)

    return merged


def skeletonize_mask(mask: np.ndarray) -> np.ndarray:
    if skimage_skeletonize is not None:
        skeleton = skimage_skeletonize(mask > 0)
        return (skeleton.astype(np.uint8)) * 255

    if hasattr(cv2, "ximgproc") and hasattr(cv2.ximgproc, "thinning"):
        return cv2.ximgproc.thinning(mask)

    skeleton = np.zeros_like(mask)
    working = (mask > 0).astype(np.uint8) * 255
    kernel = cv2.getStructuringElement(cv2.MORPH_CROSS, (3, 3))

    while True:
        eroded = cv2.erode(working, kernel)
        temp = cv2.dilate(eroded, kernel)
        temp = cv2.subtract(working, temp)
        skeleton = cv2.bitwise_or(skeleton, temp)
        working = eroded.copy()
        if cv2.countNonZero(working) == 0:
            break

    return skeleton


def binary_mask(class_map: np.ndarray, classes: Iterable[int]) -> np.ndarray:
    arr = np.isin(class_map, list(classes)).astype(np.uint8)
    return arr * 255


def connected_components_centroids(mask: np.ndarray, min_area: int = 20) -> List[Tuple[int, int, int, int]]:
    components: List[Tuple[int, int, int, int]] = []
    count, labels, stats, centroids = cv2.connectedComponentsWithStats((mask > 0).astype(np.uint8), 8)
    for label in range(1, count):
        area = int(stats[label, cv2.CC_STAT_AREA])
        if area < min_area:
            continue
        x = int(centroids[label][0])
        y = int(centroids[label][1])
        w = int(stats[label, cv2.CC_STAT_WIDTH])
        h = int(stats[label, cv2.CC_STAT_HEIGHT])
        components.append((x, y, w, h))
    return components


def nearest_wall(line_segments: List[Line], point: Point) -> Optional[Tuple[Line, float]]:
    if not line_segments:
        return None
    best_line = None
    best_distance = float("inf")
    for line in line_segments:
        x1, y1, x2, y2 = line
        if line_orientation(line) == "horizontal":
            distance = abs(point[1] - y1)
        elif line_orientation(line) == "vertical":
            distance = abs(point[0] - x1)
        else:
            distance = min(euclidean(point, (x1, y1)), euclidean(point, (x2, y2)))
        if distance < best_distance:
            best_distance = distance
            best_line = line
    if best_line is None:
        return None
    return best_line, best_distance


def walkable_ratio(mask: np.ndarray, a: Point, b: Point, samples: int = 30) -> float:
    xs = np.linspace(a[0], b[0], samples)
    ys = np.linspace(a[1], b[1], samples)
    h, w = mask.shape
    walkable = 0
    for x, y in zip(xs, ys):
        xi = int(clamp(round(float(x)), 0, w - 1))
        yi = int(clamp(round(float(y)), 0, h - 1))
        if mask[yi, xi] > 0:
            walkable += 1
    return walkable / max(samples, 1)


def resize_for_model(image_bgr: np.ndarray, max_side: int = 1024) -> Tuple[np.ndarray, float]:
    h, w = image_bgr.shape[:2]
    if max(h, w) <= max_side:
        return image_bgr.copy(), 1.0
    scale = max_side / float(max(h, w))
    resized = cv2.resize(image_bgr, (int(round(w * scale)), int(round(h * scale))), interpolation=cv2.INTER_AREA)
    return resized, scale


def get_weights_path() -> Path:
    default_dir = Path(os.getenv("CAMPUSNAV_MODEL_DIR", str(Path.home() / ".campusnav" / "models")))
    default_dir.mkdir(parents=True, exist_ok=True)
    return default_dir / "cubicasa5k_detectron2.pth"


def ensure_weights_downloaded() -> Path:
    weights_path = get_weights_path()
    if weights_path.exists():
        return weights_path

    candidate_urls = [
        os.getenv("CUBICASA_DETECTRON2_WEIGHTS_URL", "").strip(),
        "https://github.com/CubiCasa/CubiCasa5k/releases/download/v1.0/cubicasa5k_detectron2.pth",
        "https://raw.githubusercontent.com/CubiCasa/CubiCasa5k/master/models/cubicasa5k_detectron2.pth",
    ]

    errors = []
    for url in [value for value in candidate_urls if value]:
        try:
            LOGGER.info("Downloading CubiCasa5k weights from %s", url)
            with urllib.request.urlopen(url, timeout=90) as response:
                payload = response.read()
            if len(payload) < 1024:
                raise RuntimeError("Downloaded model file is unexpectedly small.")
            with open(weights_path, "wb") as handle:
                handle.write(payload)
            LOGGER.info("Saved CubiCasa5k weights to %s", weights_path)
            return weights_path
        except Exception as exc:  # pragma: no cover - network conditions vary
            errors.append(f"{url}: {exc}")

    raise RuntimeError("Unable to download CubiCasa5k weights. " + " | ".join(errors))


def load_cubicasa_model() -> Optional[DefaultPredictor]:
    with MODEL_LOCK:
        if MODEL_STATE["predictor"] is not None:
            return MODEL_STATE["predictor"]
        if MODEL_STATE["attempted"]:
            return None

        MODEL_STATE["attempted"] = True

        if not DETECTRON_AVAILABLE:
            MODEL_STATE["error"] = "Detectron2 is not available in this environment."
            LOGGER.warning("Detectron2 unavailable, enabling OpenCV fallback.")
            return None

        try:
            weights_path = ensure_weights_downloaded()
            cfg = get_cfg()
            config_name = os.getenv(
                "CUBICASA_DETECTRON2_CONFIG",
                "COCO-PanopticSegmentation/panoptic_fpn_R_50_3x.yaml",
            )
            cfg.merge_from_file(model_zoo.get_config_file(config_name))
            cfg.MODEL.DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
            cfg.MODEL.WEIGHTS = str(weights_path)
            cfg.MODEL.ROI_HEADS.SCORE_THRESH_TEST = 0.2
            cfg.MODEL.ROI_HEADS.NUM_CLASSES = 10
            cfg.MODEL.SEM_SEG_HEAD.NUM_CLASSES = 10
            cfg.MODEL.PANOPTIC_FPN.COMBINE.INSTANCES_CONFIDENCE_THRESH = 0.2
            cfg.freeze()

            predictor = DefaultPredictor(cfg)
            MODEL_STATE["predictor"] = predictor
            MODEL_STATE["error"] = None
            LOGGER.info("Loaded CubiCasa5k Detectron2 model on %s", cfg.MODEL.DEVICE)
            return predictor
        except Exception as exc:  # pragma: no cover - runtime environment dependent
            MODEL_STATE["error"] = str(exc)
            LOGGER.warning("Detectron2 model load failed. Falling back to OpenCV. %s", exc)
            return None


def warmup_model() -> bool:
    return load_cubicasa_model() is not None


def inference_semantic_map(image_bgr: np.ndarray) -> np.ndarray:
    predictor = load_cubicasa_model()
    if predictor is None:
        raise RuntimeError(MODEL_STATE["error"] or "Detectron2 model is unavailable.")

    resized, scale = resize_for_model(image_bgr, max_side=1024)
    outputs = predictor(resized)

    if "sem_seg" in outputs:
        sem_seg = outputs["sem_seg"].to("cpu")
        class_map_small = sem_seg.argmax(dim=0).numpy().astype(np.uint8)
    elif "instances" in outputs:
        instances = outputs["instances"].to("cpu")
        h, w = resized.shape[:2]
        class_map_small = np.zeros((h, w), dtype=np.uint8)
        if hasattr(instances, "pred_masks") and hasattr(instances, "pred_classes"):
            masks = instances.pred_masks.numpy()
            classes = instances.pred_classes.numpy()
            for cls_idx, mask in zip(classes, masks):
                class_map_small[mask.astype(bool)] = int(cls_idx)
    else:
        raise RuntimeError("Detectron2 output did not contain semantic segmentation data.")

    original_h, original_w = image_bgr.shape[:2]
    if scale != 1.0:
        class_map = cv2.resize(class_map_small, (original_w, original_h), interpolation=cv2.INTER_NEAREST)
    else:
        class_map = class_map_small

    return class_map.astype(np.uint8)


def walls_from_mask(wall_mask: np.ndarray) -> Tuple[List[Dict], List[Line]]:
    cleaned = cv2.morphologyEx(wall_mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8), iterations=1)
    skeleton = skeletonize_mask(cleaned)
    lines_raw = cv2.HoughLinesP(skeleton, 1, np.pi / 180, threshold=35, minLineLength=20, maxLineGap=12)

    if lines_raw is None:
        return [], []

    normalized_lines = [normalize_line(line[0]) for line in lines_raw]
    horizontal = [line for line in normalized_lines if line_orientation(line) == "horizontal"]
    vertical = [line for line in normalized_lines if line_orientation(line) == "vertical"]
    diagonal = [line for line in normalized_lines if line_orientation(line) == "other"]

    merged_lines = merge_parallel_lines(horizontal, "horizontal") + merge_parallel_lines(vertical, "vertical")
    merged_lines.extend([line for line in diagonal if line_length(line) > 32])

    features = []
    for line in merged_lines:
        x1, y1, x2, y2 = line
        features.append(
            {
                "type": "Feature",
                "id": make_uuid(),
                "properties": {"kind": "wall", "thickness": 4},
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[float(x1), float(y1)], [float(x2), float(y2)]],
                },
            }
        )

    return features, merged_lines


def polygons_from_class(mask: np.ndarray, min_area: float = 3000.0) -> List[Tuple[List[List[float]], Point]]:
    contours, _ = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    polygons: List[Tuple[List[List[float]], Point]] = []
    for contour in contours:
        area = cv2.contourArea(contour)
        if area < min_area:
            continue
        epsilon = 0.008 * cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, epsilon, True)
        if len(approx) < 3:
            continue
        points = [[float(point[0][0]), float(point[0][1])] for point in approx]
        center = polygon_centroid(points)
        polygons.append((closed_polygon(points), center))
    return polygons


def spaces_from_masks(room_mask: np.ndarray, corridor_mask: np.ndarray) -> Tuple[List[Dict], List[Tuple[str, Point, str]]]:
    features: List[Dict] = []
    centroids: List[Tuple[str, Point, str]] = []

    room_polygons = polygons_from_class(room_mask, min_area=3000.0)
    corridor_polygons = polygons_from_class(corridor_mask, min_area=2500.0)

    def add_polygon_set(polygons: List[Tuple[List[List[float]], Point]], kind: str, color: str):
        for index, (polygon, center) in enumerate(polygons, start=1):
            fid = make_uuid()
            name = f"{kind.title()} {index}"
            features.append(
                {
                    "type": "Feature",
                    "id": fid,
                    "properties": {
                        "kind": kind,
                        "name": name,
                        "category": kind,
                        "color": color,
                        "entrances": [],
                    },
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [polygon],
                    },
                }
            )
            centroids.append((fid, center, kind))

    add_polygon_set(room_polygons, "room", "#9370DB")
    add_polygon_set(corridor_polygons, "corridor", "#D3D3D3")
    return features, centroids


def openings_from_masks(
    door_mask: np.ndarray,
    window_mask: np.ndarray,
    wall_lines: List[Line],
) -> Tuple[List[Dict], Dict[str, List[str]]]:
    features: List[Dict] = []
    wall_to_openings: Dict[str, List[str]] = {}

    def add_components(mask: np.ndarray, kind: str, min_area: int, default_width: float):
        components = connected_components_centroids(mask, min_area=min_area)
        for x, y, w, h in components:
            nearest = nearest_wall(wall_lines, (x, y))
            rotation = 0.0
            width = default_width
            if nearest is not None:
                line, _ = nearest
                x1, y1, x2, y2 = line
                rotation = math.degrees(math.atan2(y2 - y1, x2 - x1))
                width = max(default_width, float(max(w, h)))

            feature_id = make_uuid()
            features.append(
                {
                    "type": "Feature",
                    "id": feature_id,
                    "properties": {
                        "kind": kind,
                        "width": float(width),
                        "rotation": float(rotation),
                    },
                    "geometry": {
                        "type": "Point",
                        "coordinates": [float(x), float(y)],
                    },
                }
            )

    add_components(door_mask, "door", min_area=12, default_width=36.0)
    add_components(window_mask, "window", min_area=10, default_width=30.0)
    return features, wall_to_openings


def objects_from_masks(stairs_mask: np.ndarray, elevator_mask: np.ndarray) -> List[Dict]:
    features: List[Dict] = []
    for kind, mask in (("stairs", stairs_mask), ("elevator", elevator_mask)):
        for x, y, _, _ in connected_components_centroids(mask, min_area=80):
            features.append(
                {
                    "type": "Feature",
                    "id": make_uuid(),
                    "properties": {
                        "kind": kind,
                        "label": "Stairs" if kind == "stairs" else "Elevator",
                    },
                    "geometry": {
                        "type": "Point",
                        "coordinates": [float(x), float(y)],
                    },
                }
            )
    return features


def skeleton_nodes(mask: np.ndarray, min_distance: float = 16.0) -> List[Point]:
    if cv2.countNonZero(mask) == 0:
        return []
    skeleton = skeletonize_mask(mask)
    binary = (skeleton > 0).astype(np.uint8)
    if np.count_nonzero(binary) == 0:
        return []

    kernel = np.array([[1, 1, 1], [1, 10, 1], [1, 1, 1]], dtype=np.uint8)
    neighbor_map = cv2.filter2D(binary, -1, kernel)

    y_coords, x_coords = np.where(binary > 0)
    points: List[Point] = []
    for y, x in zip(y_coords, x_coords):
        neighbors = int(neighbor_map[y, x]) - 10
        if neighbors != 2:
            points.append((float(x), float(y)))

    deduped: List[Point] = []
    for point in points:
        if any(euclidean(point, existing) < min_distance for existing in deduped):
            continue
        deduped.append(point)

    return deduped


def nodes_from_spaces(
    spaces: List[Dict],
    corridor_mask: np.ndarray,
    walkable_mask: np.ndarray,
) -> List[Dict]:
    node_candidates: List[Dict] = []

    for feature in spaces:
        coords = feature.get("geometry", {}).get("coordinates", [[]])[0]
        center = polygon_centroid(coords)
        node_candidates.append(
            {
                "id": make_uuid(),
                "kind": "waypoint",
                "point": center,
                "spaceId": feature.get("id"),
            }
        )

    for point in skeleton_nodes(corridor_mask, min_distance=14.0):
        node_candidates.append(
            {
                "id": make_uuid(),
                "kind": "waypoint",
                "point": point,
                "spaceId": None,
            }
        )

    if not node_candidates:
        return []

    points = [entry["point"] for entry in node_candidates]
    edges: List[Tuple[int, int, float]] = []
    for index, source in enumerate(points):
        nearest_candidates = sorted(
            [(other_index, euclidean(source, target)) for other_index, target in enumerate(points) if other_index != index],
            key=lambda item: item[1],
        )[:6]
        links = 0
        for target_index, distance in nearest_candidates:
            if distance < 8 or distance > 260:
                continue
            ratio = walkable_ratio(walkable_mask, source, points[target_index], samples=36)
            if ratio < 0.72:
                continue
            a, b = sorted((index, target_index))
            if any(existing_a == a and existing_b == b for existing_a, existing_b, _ in edges):
                continue
            edges.append((a, b, distance))
            links += 1
            if links >= 3:
                break

    neighbors_map: Dict[str, List[Dict]] = {entry["id"]: [] for entry in node_candidates}
    for a, b, weight in edges:
        id_a = node_candidates[a]["id"]
        id_b = node_candidates[b]["id"]
        distance = float(round(weight, 2))
        neighbors_map[id_a].append({"id": id_b, "weight": distance})
        neighbors_map[id_b].append({"id": id_a, "weight": distance})

    features = []
    for entry in node_candidates:
        x, y = entry["point"]
        features.append(
            {
                "type": "Feature",
                "id": entry["id"],
                "properties": {
                    "kind": entry["kind"],
                    "spaceId": entry["spaceId"],
                    "neighbors": neighbors_map.get(entry["id"], []),
                },
                "geometry": {
                    "type": "Point",
                    "coordinates": [float(x), float(y)],
                },
            }
        )

    return features


def apply_options(mvf: Dict, options: Dict) -> Dict:
    include_walls = options.get("walls", True)
    include_doors = options.get("doors", True)
    include_windows = options.get("windows", True)
    include_nav = options.get("connections", True)
    include_objects = options.get("objects", True)

    if not include_walls:
        mvf["obstructions"]["features"] = []

    if not include_doors or not include_windows:
        filtered = []
        for feature in mvf["openings"]["features"]:
            kind = feature.get("properties", {}).get("kind")
            if kind == "door" and not include_doors:
                continue
            if kind == "window" and not include_windows:
                continue
            filtered.append(feature)
        mvf["openings"]["features"] = filtered

    if not include_nav:
        mvf["nodes"]["features"] = []

    if not include_objects:
        mvf["objects"]["features"] = []

    return mvf


def build_meta(width: int, height: int, options: Dict) -> Dict:
    ppm = options.get("pixelsPerMeter", options.get("pixels_per_meter", 20))
    floor_label = options.get("floorLabel", options.get("floor_label", "Floor"))
    return {
        "imageWidth": int(width),
        "imageHeight": int(height),
        "pixelsPerMeter": float(ppm) if ppm is not None else 20.0,
        "floorLabel": str(floor_label),
    }


def build_mvf(
    width: int,
    height: int,
    options: Dict,
    spaces: List[Dict],
    obstructions: List[Dict],
    openings: List[Dict],
    nodes: List[Dict],
    objects: List[Dict],
) -> Dict:
    mvf = {
        "spaces": feature_collection(),
        "obstructions": feature_collection(),
        "openings": feature_collection(),
        "nodes": feature_collection(),
        "objects": feature_collection(),
        "meta": build_meta(width, height, options),
    }
    mvf["spaces"]["features"] = spaces
    mvf["obstructions"]["features"] = obstructions
    mvf["openings"]["features"] = openings
    mvf["nodes"]["features"] = nodes
    mvf["objects"]["features"] = objects
    return apply_options(mvf, options)


def detectron_to_mvf(bundle: ImageBundle, options: Dict) -> Dict:
    class_map = inference_semantic_map(bundle.image_bgr)

    wall_mask = binary_mask(class_map, [CLASS_INDEX["outer_wall"], CLASS_INDEX["inner_wall"]])
    room_mask = binary_mask(class_map, [CLASS_INDEX["room"]])
    corridor_mask = binary_mask(class_map, [CLASS_INDEX["corridor"]])
    door_mask = binary_mask(class_map, [CLASS_INDEX["door"]])
    window_mask = binary_mask(class_map, [CLASS_INDEX["window"]])
    stairs_mask = binary_mask(class_map, [CLASS_INDEX["stairs"]])
    elevator_mask = binary_mask(class_map, [CLASS_INDEX["elevator"]])

    obstructions, wall_lines = walls_from_mask(wall_mask)
    spaces, _ = spaces_from_masks(room_mask, corridor_mask)
    openings, _ = openings_from_masks(door_mask, window_mask, wall_lines)
    objects = objects_from_masks(stairs_mask, elevator_mask)

    walkable_mask = cv2.bitwise_not(wall_mask)
    walkable_mask = cv2.morphologyEx(walkable_mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8), iterations=1)
    nodes = nodes_from_spaces(spaces, corridor_mask, walkable_mask)

    return build_mvf(
        bundle.width,
        bundle.height,
        options,
        spaces=spaces,
        obstructions=obstructions,
        openings=openings,
        nodes=nodes,
        objects=objects,
    )


def fallback_opencv_mvf(bundle: ImageBundle, options: Dict) -> Dict:
    gray = cv2.cvtColor(bundle.image_bgr, cv2.COLOR_BGR2GRAY)
    filtered = cv2.bilateralFilter(gray, 9, 35, 35)
    edges = cv2.Canny(filtered, 40, 120)

    wall_mask = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)
    room_binary = cv2.adaptiveThreshold(
        filtered,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        31,
        8,
    )
    room_binary = cv2.morphologyEx(room_binary, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8), iterations=1)
    room_binary = cv2.morphologyEx(room_binary, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8), iterations=2)

    obstructions, wall_lines = walls_from_mask(wall_mask)
    spaces, _ = spaces_from_masks(room_binary, np.zeros_like(room_binary))

    door_mask = cv2.morphologyEx(cv2.subtract(room_binary, cv2.erode(room_binary, np.ones((5, 5), np.uint8), iterations=1)), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8), iterations=1)
    window_mask = cv2.morphologyEx(edges, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8), iterations=1)
    openings, _ = openings_from_masks(door_mask, window_mask, wall_lines)

    objects = []
    for feature in spaces:
        polygon = feature.get("geometry", {}).get("coordinates", [[]])[0]
        cx, cy = polygon_centroid(polygon)
        area = cv2.contourArea(np.array(polygon, dtype=np.float32)) if polygon else 0
        if area > 14000:
            objects.append(
                {
                    "type": "Feature",
                    "id": make_uuid(),
                    "properties": {"kind": "stairs", "label": "Stairs"},
                    "geometry": {"type": "Point", "coordinates": [float(cx), float(cy)]},
                }
            )

    walkable_mask = cv2.bitwise_not(wall_mask)
    nodes = nodes_from_spaces(spaces, np.zeros_like(room_binary), walkable_mask)

    return build_mvf(
        bundle.width,
        bundle.height,
        options,
        spaces=spaces,
        obstructions=obstructions,
        openings=openings,
        nodes=nodes,
        objects=objects,
    )


def trace_floor_plan(content: bytes, filename: str, raw_options: object = "{}") -> Dict:
    options = parse_options(raw_options)
    bundle = load_image_from_bytes(content, filename)

    try:
        mvf = detectron_to_mvf(bundle, options)
        mvf.setdefault("meta", {}).update({"pipeline": "detectron2-cubicasa5k"})
        return mvf
    except Exception as exc:
        LOGGER.warning("Detectron2 tracing failed. Falling back to OpenCV pipeline. %s", exc)
        mvf = fallback_opencv_mvf(bundle, options)
        mvf.setdefault("meta", {}).update(
            {
                "pipeline": "opencv-fallback",
                "warning": "Detectron2 unavailable or inference failed; OpenCV fallback used.",
            }
        )
        return mvf
