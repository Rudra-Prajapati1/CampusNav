import json
import logging
import math
import os
import threading
import uuid
from dataclasses import dataclass
from io import BytesIO
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

import cv2
import fitz
import numpy as np
from PIL import Image

try:
    from cubicasa_adapter import (
        ICON_CLASSES,
        ROOM_CLASSES,
        CubiCasaPrediction,
        CubiCasaRuntime,
        build_runtime,
        predict as predict_cubicasa,
    )

    CUBICASA_AVAILABLE = True
    CUBICASA_IMPORT_ERROR = None
except Exception as exc:  # pragma: no cover - optional runtime dependency
    ICON_CLASSES = []
    ROOM_CLASSES = []
    CubiCasaPrediction = None
    CubiCasaRuntime = None
    build_runtime = None
    predict_cubicasa = None
    CUBICASA_AVAILABLE = False
    CUBICASA_IMPORT_ERROR = exc

try:
    from skimage.morphology import skeletonize as skimage_skeletonize
except Exception:  # pragma: no cover - optional runtime dependency
    skimage_skeletonize = None


LOGGER = logging.getLogger("campusnav.pipeline")

Point = Tuple[float, float]
Line = Tuple[int, int, int, int]


MODEL_LOCK = threading.Lock()
MODEL_STATE = {
    "attempted": False,
    "runtime": None,
    "error": None,
    "status": "cubicasa-not-loaded",
    "weights_path": None,
}

ROOM_CLASS_KINDS = {
    3: "room",
    4: "room",
    5: "room",
    6: "room",
    7: "corridor",
    9: "room",
    10: "room",
    11: "room",
}

ICON_OBJECT_CLASSES = {
    3: ("store", "Closet"),
    4: ("facility", "Electrical Appliance"),
    5: ("restroom", "Toilet"),
    6: ("facility", "Sink"),
    7: ("facility", "Sauna Bench"),
    8: ("facility", "Fire Place"),
    9: ("restroom", "Bathtub"),
    10: ("facility", "Chimney"),
}

SPACE_MIN_AREA = 1500
SPACE_COLORS = {
    "room": "#9370DB",
    "corridor": "#D3D3D3",
    "stairs": "#FF8C00",
    "elevator": "#4169E1",
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
        document = fitz.open(stream=content, filetype="pdf")
        if document.page_count == 0:
            raise ValueError("The uploaded PDF does not contain any pages.")
        page = document.load_page(0)
        pix = page.get_pixmap(alpha=False, dpi=220)
        image = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        bgr = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
        return ImageBundle(image_bgr=bgr, width=bgr.shape[1], height=bgr.shape[0])

    image = Image.open(BytesIO(content)).convert("RGB")
    bgr = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
    return ImageBundle(image_bgr=bgr, width=bgr.shape[1], height=bgr.shape[0])


def trace_working_max_dimension(options: Dict) -> int:
    raw_value = options.get(
        "traceMaxDimension",
        options.get("trace_max_dimension", os.getenv("TRACE_WORKING_MAX_DIM", "768")),
    )
    try:
        parsed = int(raw_value)
    except (TypeError, ValueError):
        parsed = 768
    return max(512, min(parsed, 2400))


def working_bundle_for_trace(bundle: ImageBundle, options: Dict) -> Tuple[ImageBundle, float, float]:
    max_dimension = trace_working_max_dimension(options)
    largest = max(bundle.width, bundle.height)
    if largest <= max_dimension:
        return bundle, 1.0, 1.0

    scale = max_dimension / float(largest)
    next_width = max(1, int(round(bundle.width * scale)))
    next_height = max(1, int(round(bundle.height * scale)))
    resized = cv2.resize(
        bundle.image_bgr,
        (next_width, next_height),
        interpolation=cv2.INTER_AREA,
    )
    return (
        ImageBundle(image_bgr=resized, width=next_width, height=next_height),
        bundle.width / float(next_width),
        bundle.height / float(next_height),
    )


def closed_polygon(points: Sequence[Sequence[float]]) -> List[List[float]]:
    if not points:
        return []
    coords = [[float(point[0]), float(point[1])] for point in points]
    if coords[0] != coords[-1]:
        coords.append([coords[0][0], coords[0][1]])
    return coords


def polygon_centroid(points: Sequence[Sequence[float]]) -> Point:
    if not points:
        return (0.0, 0.0)
    arr = np.array(points, dtype=np.float32)
    if arr.ndim != 2 or arr.shape[1] != 2:
        return (0.0, 0.0)
    if len(arr) >= 3:
        contour = arr[:-1] if np.array_equal(arr[0], arr[-1]) else arr
        moments = cv2.moments(contour)
        area = float(moments.get("m00") or 0.0)
        if area:
            return (
                float(moments["m10"] / area),
                float(moments["m01"] / area),
            )
    return (float(np.mean(arr[:, 0])), float(np.mean(arr[:, 1])))


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def euclidean(a: Point, b: Point) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def runtime_status_message() -> str:
    status = MODEL_STATE.get("status") or "cubicasa-not-loaded"
    error = MODEL_STATE.get("error")
    if error:
        return f"{status}: {error}"
    return status


def load_cubicasa_runtime() -> Optional[CubiCasaRuntime]:
    with MODEL_LOCK:
        if MODEL_STATE["runtime"] is not None:
            return MODEL_STATE["runtime"]
        if MODEL_STATE["attempted"]:
            return None

        MODEL_STATE["attempted"] = True

        if not CUBICASA_AVAILABLE:
            MODEL_STATE["error"] = f"CubiCasa import failed: {CUBICASA_IMPORT_ERROR}"
            MODEL_STATE["status"] = "cubicasa-load-failed"
            LOGGER.warning(
                "CubiCasa runtime unavailable. Emergency OpenCV fallback will be used. %s",
                CUBICASA_IMPORT_ERROR,
            )
            return None

        try:
            runtime = build_runtime()
            MODEL_STATE["runtime"] = runtime
            MODEL_STATE["weights_path"] = str(runtime.weights_path)
            MODEL_STATE["status"] = "cubicasa-loaded"
            MODEL_STATE["error"] = None
            LOGGER.info("CubiCasa model loaded from %s", runtime.weights_path)
            return runtime
        except FileNotFoundError as exc:
            MODEL_STATE["error"] = str(exc)
            MODEL_STATE["status"] = "cubicasa-missing-weights"
            LOGGER.warning(
                "CubiCasa weights missing. Emergency OpenCV fallback will be used. %s",
                exc,
            )
            return None
        except Exception as exc:  # pragma: no cover - runtime dependent
            MODEL_STATE["error"] = str(exc)
            MODEL_STATE["status"] = "cubicasa-load-failed"
            LOGGER.warning(
                "CubiCasa model failed to load. Emergency OpenCV fallback will be used. %s",
                exc,
            )
            return None


def warmup_model() -> bool:
    return load_cubicasa_runtime() is not None


def run_cubicasa_prediction(image_bgr: np.ndarray) -> Optional[CubiCasaPrediction]:
    runtime = load_cubicasa_runtime()
    if runtime is None:
        return None
    return predict_cubicasa(runtime, image_bgr)


def normalize_line(raw_line: Sequence[int]) -> Line:
    x1, y1, x2, y2 = [int(value) for value in raw_line]
    if (x1, y1) <= (x2, y2):
        return (x1, y1, x2, y2)
    return (x2, y2, x1, y1)


def line_length(line: Line) -> float:
    x1, y1, x2, y2 = line
    return math.hypot(x2 - x1, y2 - y1)


def line_angle_degrees(line: Line) -> float:
    x1, y1, x2, y2 = line
    angle = math.degrees(math.atan2(y2 - y1, x2 - x1))
    return (angle + 180.0) % 180.0


def angle_difference(a: float, b: float) -> float:
    diff = abs(a - b) % 180.0
    return min(diff, 180.0 - diff)


def line_midpoint(line: Line) -> Point:
    x1, y1, x2, y2 = line
    return ((x1 + x2) / 2.0, (y1 + y2) / 2.0)


def point_line_distance(point: Point, line: Line) -> float:
    x0, y0 = point
    x1, y1, x2, y2 = line
    dx = x2 - x1
    dy = y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(x0 - x1, y0 - y1)
    numerator = abs(dy * x0 - dx * y0 + x2 * y1 - y2 * x1)
    denominator = math.hypot(dx, dy)
    return numerator / denominator


def endpoint_min_distance(a: Line, b: Line) -> float:
    points_a = [(a[0], a[1]), (a[2], a[3])]
    points_b = [(b[0], b[1]), (b[2], b[3])]
    return min(euclidean(p1, p2) for p1 in points_a for p2 in points_b)


def projection_interval(
    line: Line,
    origin: Point,
    direction: Point,
) -> Tuple[float, float]:
    points = [(line[0], line[1]), (line[2], line[3])]
    values = [
        (point[0] - origin[0]) * direction[0] + (point[1] - origin[1]) * direction[1]
        for point in points
    ]
    return (min(values), max(values))


def lines_are_similar(
    base: Line,
    candidate: Line,
    distance_px: float,
    angle_degrees: float,
) -> bool:
    if angle_difference(line_angle_degrees(base), line_angle_degrees(candidate)) > angle_degrees:
        return False

    if endpoint_min_distance(base, candidate) <= distance_px:
        return True

    if point_line_distance(line_midpoint(candidate), base) > distance_px:
        return False

    bx1, by1, bx2, by2 = base
    base_length = line_length(base)
    if base_length <= 1.0:
        return False

    direction = ((bx2 - bx1) / base_length, (by2 - by1) / base_length)
    origin = (float(bx1), float(by1))

    min_a, max_a = projection_interval(base, origin, direction)
    min_b, max_b = projection_interval(candidate, origin, direction)
    gap = max(0.0, min_b - max_a, min_a - max_b)
    return gap <= distance_px


def merge_cluster(cluster: List[Line]) -> Line:
    if len(cluster) == 1:
        return normalize_line(cluster[0])

    endpoints = []
    angles = []
    for line in cluster:
        endpoints.append((float(line[0]), float(line[1])))
        endpoints.append((float(line[2]), float(line[3])))
        angles.append(math.radians(line_angle_degrees(line)))

    sin_sum = sum(math.sin(2.0 * angle) for angle in angles)
    cos_sum = sum(math.cos(2.0 * angle) for angle in angles)
    mean_angle = 0.5 * math.atan2(sin_sum, cos_sum)
    direction = (math.cos(mean_angle), math.sin(mean_angle))
    normal = (-direction[1], direction[0])

    origin = (
        sum(point[0] for point in endpoints) / len(endpoints),
        sum(point[1] for point in endpoints) / len(endpoints),
    )

    projected = [
        (point[0] - origin[0]) * direction[0] + (point[1] - origin[1]) * direction[1]
        for point in endpoints
    ]
    offsets = [
        (point[0] - origin[0]) * normal[0] + (point[1] - origin[1]) * normal[1]
        for point in endpoints
    ]

    min_t = min(projected)
    max_t = max(projected)
    offset = sum(offsets) / len(offsets)

    center = (origin[0] + normal[0] * offset, origin[1] + normal[1] * offset)
    p1 = (center[0] + direction[0] * min_t, center[1] + direction[1] * min_t)
    p2 = (center[0] + direction[0] * max_t, center[1] + direction[1] * max_t)

    return normalize_line(
        (
            int(round(p1[0])),
            int(round(p1[1])),
            int(round(p2[0])),
            int(round(p2[1])),
        )
    )


def merge_lines(
    lines: List[Line],
    distance_px: float = 8.0,
    angle_degrees: float = 12.0,
) -> List[Line]:
    if not lines:
        return []

    normalized = [normalize_line(line) for line in lines if line_length(line) >= 8.0]
    if not normalized:
        return []

    normalized.sort(key=line_length, reverse=True)
    used = [False] * len(normalized)
    merged: List[Line] = []

    for index, line in enumerate(normalized):
        if used[index]:
            continue

        cluster = [line]
        used[index] = True
        expanded = True

        while expanded:
            expanded = False
            for candidate_index, candidate in enumerate(normalized):
                if used[candidate_index]:
                    continue

                if any(
                    lines_are_similar(base, candidate, distance_px, angle_degrees)
                    for base in cluster
                ):
                    cluster.append(candidate)
                    used[candidate_index] = True
                    expanded = True

        merged.append(merge_cluster(cluster))

    return merged


def build_wall_lines_and_mask(image_bgr: np.ndarray) -> Tuple[List[Line], np.ndarray]:
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    bilateral = cv2.bilateralFilter(gray, 9, 75, 75)

    clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
    enhanced = clahe.apply(bilateral)

    adaptive = cv2.adaptiveThreshold(
        enhanced,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        31,
        4,
    )

    # Requirement-specific Canny-on-enhanced stage before Hough.
    canny = cv2.Canny(enhanced, 60, 180)
    adaptive_edges = cv2.Canny(adaptive, 60, 160)
    edge_map = cv2.bitwise_or(canny, adaptive_edges)

    lines_raw = cv2.HoughLinesP(
        edge_map,
        1,
        np.pi / 180,
        threshold=60,
        minLineLength=25,
        maxLineGap=6,
    )

    extracted: List[Line] = []
    if lines_raw is not None:
        for row in lines_raw:
            extracted.append(normalize_line(row[0]))

    merged = merge_lines(extracted, distance_px=8.0, angle_degrees=12.0)

    wall_mask = np.zeros(gray.shape, dtype=np.uint8)
    for x1, y1, x2, y2 in merged:
        cv2.line(wall_mask, (x1, y1), (x2, y2), 255, 4)
    wall_mask = cv2.morphologyEx(
        wall_mask,
        cv2.MORPH_CLOSE,
        np.ones((3, 3), np.uint8),
        iterations=1,
    )

    return merged, wall_mask


def wall_lines_from_wall_mask(wall_mask: np.ndarray) -> List[Line]:
    clean = (wall_mask > 0).astype(np.uint8) * 255
    clean = cv2.morphologyEx(
        clean,
        cv2.MORPH_CLOSE,
        np.ones((5, 5), np.uint8),
        iterations=1,
    )
    clean = cv2.dilate(clean, np.ones((3, 3), np.uint8), iterations=1)
    skeleton = skeletonize_walkable_mask(clean)

    lines_raw = cv2.HoughLinesP(
        skeleton,
        1,
        np.pi / 180,
        threshold=28,
        minLineLength=24,
        maxLineGap=10,
    )

    extracted: List[Line] = []
    if lines_raw is not None:
        for row in lines_raw:
            extracted.append(normalize_line(row[0]))

    return merge_lines(extracted, distance_px=10.0, angle_degrees=12.0)


def contour_to_polygon(contour: np.ndarray) -> Optional[List[List[float]]]:
    if contour is None or len(contour) < 3:
        return None

    perimeter = cv2.arcLength(contour, True)
    if perimeter <= 0:
        return None

    approx = cv2.approxPolyDP(contour, 0.008 * perimeter, True)
    if len(approx) < 3:
        return None

    points = [[float(point[0][0]), float(point[0][1])] for point in approx]
    return closed_polygon(points)


def polygon_to_mask(shape: Tuple[int, int], polygon: Sequence[Sequence[float]]) -> np.ndarray:
    mask = np.zeros(shape, dtype=np.uint8)
    if not polygon:
        return mask

    pts = np.array([[int(round(p[0])), int(round(p[1]))] for p in polygon], dtype=np.int32)
    if len(pts) < 3:
        return mask

    cv2.fillPoly(mask, [pts], 255)
    return mask


def retain_enclosed_regions(binary_mask: np.ndarray, min_area: int = SPACE_MIN_AREA) -> np.ndarray:
    labels_count, labels, stats, _ = cv2.connectedComponentsWithStats(
        (binary_mask > 0).astype(np.uint8),
        8,
    )

    result = np.zeros(binary_mask.shape, dtype=np.uint8)
    height, width = binary_mask.shape

    for label in range(1, labels_count):
        area = int(stats[label, cv2.CC_STAT_AREA])
        if area < min_area:
            continue

        x = int(stats[label, cv2.CC_STAT_LEFT])
        y = int(stats[label, cv2.CC_STAT_TOP])
        w = int(stats[label, cv2.CC_STAT_WIDTH])
        h = int(stats[label, cv2.CC_STAT_HEIGHT])

        touches_border = x <= 0 or y <= 0 or (x + w) >= width or (y + h) >= height
        if touches_border:
            continue

        result[labels == label] = 255

    return result


def mask_to_polygons(mask: np.ndarray, min_area: float = float(SPACE_MIN_AREA)) -> List[List[List[float]]]:
    contours, hierarchy = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    if hierarchy is None:
        return []

    polygons: List[List[List[float]]] = []
    for index, contour in enumerate(contours):
        parent = int(hierarchy[0][index][3])
        if parent != -1:
            continue

        area = cv2.contourArea(contour)
        if area < min_area:
            continue

        polygon = contour_to_polygon(contour)
        if not polygon:
            continue

        polygons.append(polygon)

    return polygons


def classify_space_kind(polygon: Sequence[Sequence[float]]) -> str:
    if not polygon:
        return "room"

    contour = np.array([[point[0], point[1]] for point in polygon[:-1]], dtype=np.float32)
    if len(contour) < 3:
        return "room"

    area = float(cv2.contourArea(contour))
    x, y, w, h = cv2.boundingRect(contour.astype(np.int32))
    aspect = max(w / max(h, 1), h / max(w, 1))
    if area >= 2500 and aspect >= 2.8:
        return "corridor"
    return "room"


def mask_from_classes(
    segmentation: np.ndarray,
    classes: Iterable[int],
    confidence: Optional[np.ndarray] = None,
    min_confidence: float = 0.0,
) -> np.ndarray:
    mask = np.isin(segmentation, list(classes))
    if confidence is not None and min_confidence > 0:
        mask = np.logical_and(mask, confidence >= min_confidence)
    return mask.astype(np.uint8) * 255


def cubicasa_wall_mask(prediction: CubiCasaPrediction, shape: Tuple[int, int]) -> np.ndarray:
    mask = mask_from_classes(prediction.room_segmentation, [2])
    if mask.shape != shape:
        mask = cv2.resize(mask, (shape[1], shape[0]), interpolation=cv2.INTER_NEAREST)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8), iterations=1)
    mask = cv2.dilate(mask, np.ones((3, 3), np.uint8), iterations=1)
    return mask


def cubicasa_corridor_mask(
    prediction: Optional[CubiCasaPrediction],
    shape: Tuple[int, int],
) -> np.ndarray:
    if prediction is None:
        return np.zeros(shape, dtype=np.uint8)

    mask = mask_from_classes(
        prediction.room_segmentation,
        [7],
        confidence=prediction.room_confidence,
        min_confidence=0.12,
    )
    if mask.shape != shape:
        mask = cv2.resize(mask, (shape[1], shape[0]), interpolation=cv2.INTER_NEAREST)

    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8), iterations=1)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8), iterations=1)
    return mask


def clean_space_mask(mask: np.ndarray, wall_mask: Optional[np.ndarray] = None) -> np.ndarray:
    prepared = (mask > 0).astype(np.uint8) * 255
    if cv2.countNonZero(prepared) == 0:
        return prepared

    if wall_mask is not None and cv2.countNonZero(wall_mask) > 0:
        separated_walls = cv2.dilate((wall_mask > 0).astype(np.uint8) * 255, np.ones((3, 3), np.uint8), iterations=1)
        prepared = cv2.bitwise_and(prepared, cv2.bitwise_not(separated_walls))

    prepared = cv2.morphologyEx(prepared, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8), iterations=1)
    prepared = cv2.morphologyEx(prepared, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8), iterations=1)
    return prepared


def component_masks(mask: np.ndarray, min_area: int = SPACE_MIN_AREA) -> List[np.ndarray]:
    count, labels, stats, _ = cv2.connectedComponentsWithStats((mask > 0).astype(np.uint8), 8)
    components: List[np.ndarray] = []
    for label in range(1, count):
        area = int(stats[label, cv2.CC_STAT_AREA])
        if area < min_area:
            continue
        component = np.zeros(mask.shape, dtype=np.uint8)
        component[labels == label] = 255
        components.append(component)
    return components


def watershed_components(mask: np.ndarray, min_area: int = SPACE_MIN_AREA) -> List[np.ndarray]:
    prepared = (mask > 0).astype(np.uint8) * 255
    if cv2.countNonZero(prepared) < min_area:
        return []

    distance = cv2.distanceTransform(prepared, cv2.DIST_L2, 5)
    max_distance = float(distance.max())
    if max_distance <= 0.0:
        return []

    sure_fg = np.uint8(distance >= (0.24 * max_distance)) * 255
    sure_fg = cv2.erode(sure_fg, np.ones((3, 3), np.uint8), iterations=1)
    if cv2.countNonZero(sure_fg) == 0:
        sure_fg = prepared.copy()

    count, markers = cv2.connectedComponents((sure_fg > 0).astype(np.uint8))
    if count <= 2:
        alternate = cv2.erode(prepared, np.ones((3, 3), np.uint8), iterations=2)
        if cv2.countNonZero(alternate) > 0:
            count, markers = cv2.connectedComponents((alternate > 0).astype(np.uint8))
            sure_fg = alternate

    if count <= 2:
        return []

    sure_bg = cv2.dilate(prepared, np.ones((3, 3), np.uint8), iterations=1)
    unknown = cv2.subtract(sure_bg, sure_fg)
    markers = markers.astype(np.int32) + 1
    markers[unknown > 0] = 0
    markers = cv2.watershed(cv2.cvtColor(prepared, cv2.COLOR_GRAY2BGR), markers)

    components: List[np.ndarray] = []
    for label in np.unique(markers):
        if label <= 1:
            continue
        component = np.zeros(mask.shape, dtype=np.uint8)
        component[markers == label] = 255
        if cv2.countNonZero(component) < min_area:
            continue
        components.append(component)
    return components


def split_space_components(
    mask: np.ndarray,
    wall_mask: Optional[np.ndarray],
    min_area: int = SPACE_MIN_AREA,
) -> List[np.ndarray]:
    prepared = clean_space_mask(mask, wall_mask)
    if cv2.countNonZero(prepared) < min_area:
        return []

    components = component_masks(prepared, min_area=min_area)
    if len(components) > 1:
        return components

    components = watershed_components(prepared, min_area=min_area)
    if components:
        return components

    return component_masks((mask > 0).astype(np.uint8) * 255, min_area=min_area) or [prepared]


def split_mask_to_polygons(
    mask: np.ndarray,
    wall_mask: Optional[np.ndarray],
    min_area: int = SPACE_MIN_AREA,
) -> List[List[List[float]]]:
    polygons: List[List[List[float]]] = []
    for component in split_space_components(mask, wall_mask, min_area=min_area):
        polygons.extend(mask_to_polygons(component, min_area=float(min_area)))
    return polygons


def cubicasa_space_candidates(
    prediction: Optional[CubiCasaPrediction],
    shape: Tuple[int, int],
    wall_mask: Optional[np.ndarray] = None,
) -> Tuple[List[Dict], np.ndarray]:
    coverage = np.zeros(shape, dtype=np.uint8)
    candidates: List[Dict] = []
    if prediction is None:
        return candidates, coverage

    for class_id, kind in ROOM_CLASS_KINDS.items():
        min_confidence = 0.08 if kind == "corridor" else 0.12
        mask = mask_from_classes(
            prediction.room_segmentation,
            [class_id],
            confidence=prediction.room_confidence,
            min_confidence=min_confidence,
        )
        if mask.shape != shape:
            mask = cv2.resize(mask, (shape[1], shape[0]), interpolation=cv2.INTER_NEAREST)

        mask = clean_space_mask(mask, wall_mask)
        if cv2.countNonZero(mask) < SPACE_MIN_AREA:
            continue

        poly_list = split_mask_to_polygons(mask, None, min_area=SPACE_MIN_AREA)
        for polygon in poly_list:
            poly_mask = polygon_to_mask(shape, polygon)
            if cv2.countNonZero(poly_mask) < SPACE_MIN_AREA:
                continue
            candidates.append(
                {
                    "polygon": polygon,
                    "source": "cubicasa",
                    "kind": kind,
                    "roomClass": ROOM_CLASSES[class_id] if class_id < len(ROOM_CLASSES) else str(class_id),
                }
            )
            coverage = cv2.bitwise_or(coverage, poly_mask)

    return candidates, coverage


def extract_space_polygons(
    wall_mask: np.ndarray,
    cubicasa: Optional[CubiCasaPrediction],
) -> Tuple[List[Dict], np.ndarray]:
    shape = wall_mask.shape

    cubicasa_candidates, cubicasa_coverage = cubicasa_space_candidates(cubicasa, shape, wall_mask)

    inverse_walls = cv2.bitwise_not(wall_mask)
    enclosed_seed = cv2.morphologyEx(
        inverse_walls,
        cv2.MORPH_CLOSE,
        np.ones((7, 7), np.uint8),
        iterations=2,
    )
    enclosed = retain_enclosed_regions(enclosed_seed, min_area=SPACE_MIN_AREA)
    cv_polygons = split_mask_to_polygons(enclosed, wall_mask, min_area=SPACE_MIN_AREA)

    accepted: List[Dict] = []
    accepted_mask = np.zeros(shape, dtype=np.uint8)

    for candidate in cubicasa_candidates:
        polygon = candidate["polygon"]
        poly_mask = polygon_to_mask(shape, polygon)
        area = cv2.countNonZero(poly_mask)
        if area < SPACE_MIN_AREA:
            continue

        overlap = cv2.countNonZero(cv2.bitwise_and(poly_mask, accepted_mask))
        if overlap / max(area, 1) > 0.75:
            continue

        accepted.append(candidate)
        accepted_mask = cv2.bitwise_or(accepted_mask, poly_mask)

    for polygon in cv_polygons:
        poly_mask = polygon_to_mask(shape, polygon)
        area = cv2.countNonZero(poly_mask)
        if area < SPACE_MIN_AREA:
            continue

        covered = cv2.countNonZero(cv2.bitwise_and(poly_mask, cubicasa_coverage))
        if covered / max(area, 1) > 0.35:
            continue

        overlap = cv2.countNonZero(cv2.bitwise_and(poly_mask, accepted_mask))
        if overlap / max(area, 1) > 0.75:
            continue

        accepted.append({"polygon": polygon, "source": "opencv"})
        accepted_mask = cv2.bitwise_or(accepted_mask, poly_mask)

    if not accepted:
        for polygon in cv_polygons:
            poly_mask = polygon_to_mask(shape, polygon)
            if cv2.countNonZero(poly_mask) < SPACE_MIN_AREA:
                continue
            accepted.append({"polygon": polygon, "source": "opencv"})
            accepted_mask = cv2.bitwise_or(accepted_mask, poly_mask)

    if cv2.countNonZero(accepted_mask) == 0:
        accepted_mask = retain_enclosed_regions(cv2.bitwise_not(wall_mask), min_area=800)

    for entry in accepted:
        if not entry.get("kind"):
            entry["kind"] = classify_space_kind(entry["polygon"])

    return accepted, accepted_mask


def sample_points_on_line(line: Line) -> List[Point]:
    x1, y1, x2, y2 = line
    length = max(1, int(round(line_length(line))))
    points: List[Point] = []
    for idx in range(length + 1):
        t = idx / max(length, 1)
        points.append((x1 + (x2 - x1) * t, y1 + (y2 - y1) * t))
    return points


def local_wall_presence(mask: np.ndarray, point: Point) -> bool:
    x = int(clamp(round(point[0]), 0, mask.shape[1] - 1))
    y = int(clamp(round(point[1]), 0, mask.shape[0] - 1))

    x0 = max(0, x - 1)
    x1 = min(mask.shape[1], x + 2)
    y0 = max(0, y - 1)
    y1 = min(mask.shape[0], y + 2)

    return bool(np.any(mask[y0:y1, x0:x1] > 0))


def find_gap_runs(
    presence: Sequence[bool],
    step_length: float,
    min_gap: float = 25.0,
    max_gap: float = 90.0,
) -> List[Tuple[int, int]]:
    runs: List[Tuple[int, int]] = []
    start = None

    for idx, value in enumerate(presence):
        if not value and start is None:
            start = idx
            continue
        if value and start is not None:
            end = idx - 1
            length = (end - start + 1) * step_length
            if min_gap <= length <= max_gap:
                runs.append((start, end))
            start = None

    if start is not None:
        end = len(presence) - 1
        length = (end - start + 1) * step_length
        if min_gap <= length <= max_gap:
            runs.append((start, end))

    return runs


def flood_fill_region_labels(interior_mask: np.ndarray) -> np.ndarray:
    binary = (interior_mask > 0).astype(np.uint8)
    labels = np.zeros(binary.shape, dtype=np.int32)
    working = binary.copy()
    current_label = 1

    height, width = working.shape
    for y in range(height):
        for x in range(width):
            if working[y, x] == 0:
                continue

            fill_mask = np.zeros((height + 2, width + 2), dtype=np.uint8)
            cv2.floodFill(working, fill_mask, (x, y), 0, flags=8)
            region = fill_mask[1:-1, 1:-1] > 0
            labels[region] = current_label
            current_label += 1

    return labels


def label_at(labels: np.ndarray, point: Point) -> int:
    x = int(clamp(round(point[0]), 0, labels.shape[1] - 1))
    y = int(clamp(round(point[1]), 0, labels.shape[0] - 1))
    return int(labels[y, x])


def gap_connects_two_regions(labels: np.ndarray, center: Point, line: Line) -> bool:
    x1, y1, x2, y2 = line
    dx = x2 - x1
    dy = y2 - y1
    length = math.hypot(dx, dy)
    if length <= 0:
        return False

    normal = (-dy / length, dx / length)
    for offset in (4, 6, 8, 10):
        a = (center[0] + normal[0] * offset, center[1] + normal[1] * offset)
        b = (center[0] - normal[0] * offset, center[1] - normal[1] * offset)
        la = label_at(labels, a)
        lb = label_at(labels, b)
        if la > 0 and lb > 0 and la != lb:
            return True

    return False


def detect_door_points(
    wall_lines: List[Line],
    wall_mask: np.ndarray,
    region_labels: np.ndarray,
) -> List[Point]:
    candidates: List[Point] = []

    for line in wall_lines:
        length = line_length(line)
        if length < 35:
            continue

        points = sample_points_on_line(line)
        if len(points) < 4:
            continue

        presence = [local_wall_presence(wall_mask, point) for point in points]
        step_length = length / max(len(points) - 1, 1)

        for start, end in find_gap_runs(presence, step_length, 25.0, 90.0):
            center_idx = (start + end) // 2
            center = points[center_idx]
            if gap_connects_two_regions(region_labels, center, line):
                candidates.append(center)

    deduped: List[Point] = []
    for point in candidates:
        if any(euclidean(point, existing) < 12.0 for existing in deduped):
            continue
        deduped.append(point)

    return deduped


def component_centroids(mask: np.ndarray, min_area: int = 16) -> List[Point]:
    count, _labels, stats, centroids = cv2.connectedComponentsWithStats(
        (mask > 0).astype(np.uint8),
        8,
    )
    points: List[Point] = []
    for label in range(1, count):
        area = int(stats[label, cv2.CC_STAT_AREA])
        if area < min_area:
            continue
        points.append((float(centroids[label][0]), float(centroids[label][1])))
    return points


def cubicasa_opening_records(
    prediction: Optional[CubiCasaPrediction],
    shape: Tuple[int, int],
) -> List[Dict]:
    if prediction is None:
        return []

    records: List[Dict] = []
    opening_specs = [
        (1, "window", 34.0, 10),
        (2, "door", 40.0, 14),
    ]

    for class_id, kind, width, min_area in opening_specs:
        mask = mask_from_classes(
            prediction.icon_segmentation,
            [class_id],
            confidence=prediction.icon_confidence,
            min_confidence=0.36,
        )
        if mask.shape != shape:
            mask = cv2.resize(mask, (shape[1], shape[0]), interpolation=cv2.INTER_NEAREST)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8), iterations=1)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8), iterations=1)

        for point in component_centroids(mask, min_area=min_area):
            records.append({"point": point, "kind": kind, "width": width})

    return records


def zhang_suen_thinning(binary_mask: np.ndarray) -> np.ndarray:
    image = (binary_mask > 0).astype(np.uint8)
    changed = True

    while changed:
        changed = False
        to_remove: List[Tuple[int, int]] = []
        rows, cols = image.shape

        for y in range(1, rows - 1):
            for x in range(1, cols - 1):
                if image[y, x] != 1:
                    continue

                p2 = image[y - 1, x]
                p3 = image[y - 1, x + 1]
                p4 = image[y, x + 1]
                p5 = image[y + 1, x + 1]
                p6 = image[y + 1, x]
                p7 = image[y + 1, x - 1]
                p8 = image[y, x - 1]
                p9 = image[y - 1, x - 1]

                neighbors = [p2, p3, p4, p5, p6, p7, p8, p9]
                count = int(sum(neighbors))
                if count < 2 or count > 6:
                    continue

                transitions = 0
                for idx in range(8):
                    if neighbors[idx] == 0 and neighbors[(idx + 1) % 8] == 1:
                        transitions += 1
                if transitions != 1:
                    continue

                if p2 * p4 * p6 != 0:
                    continue
                if p4 * p6 * p8 != 0:
                    continue

                to_remove.append((y, x))

        if to_remove:
            changed = True
            for y, x in to_remove:
                image[y, x] = 0

        to_remove = []
        for y in range(1, rows - 1):
            for x in range(1, cols - 1):
                if image[y, x] != 1:
                    continue

                p2 = image[y - 1, x]
                p3 = image[y - 1, x + 1]
                p4 = image[y, x + 1]
                p5 = image[y + 1, x + 1]
                p6 = image[y + 1, x]
                p7 = image[y + 1, x - 1]
                p8 = image[y, x - 1]
                p9 = image[y - 1, x - 1]

                neighbors = [p2, p3, p4, p5, p6, p7, p8, p9]
                count = int(sum(neighbors))
                if count < 2 or count > 6:
                    continue

                transitions = 0
                for idx in range(8):
                    if neighbors[idx] == 0 and neighbors[(idx + 1) % 8] == 1:
                        transitions += 1
                if transitions != 1:
                    continue

                if p2 * p4 * p8 != 0:
                    continue
                if p2 * p6 * p8 != 0:
                    continue

                to_remove.append((y, x))

        if to_remove:
            changed = True
            for y, x in to_remove:
                image[y, x] = 0

    return (image * 255).astype(np.uint8)


def skeletonize_walkable_mask(walkable_mask: np.ndarray) -> np.ndarray:
    binary = (walkable_mask > 0).astype(np.uint8)
    if np.count_nonzero(binary) == 0:
        return np.zeros_like(binary, dtype=np.uint8)

    if skimage_skeletonize is not None:
        skeleton = skimage_skeletonize(binary.astype(bool))
        return (skeleton.astype(np.uint8)) * 255

    return zhang_suen_thinning(binary)


def extract_skeleton_nodes(skeleton: np.ndarray, min_distance: float = 10.0) -> List[Point]:
    binary = (skeleton > 0).astype(np.uint8)
    if np.count_nonzero(binary) == 0:
        return []

    rows, cols = binary.shape
    candidates: List[Point] = []
    for y in range(1, rows - 1):
        for x in range(1, cols - 1):
            if binary[y, x] == 0:
                continue

            patch = binary[y - 1 : y + 2, x - 1 : x + 2]
            neighbors = int(np.sum(patch)) - 1
            if neighbors == 1 or neighbors >= 3:
                candidates.append((float(x), float(y)))

    deduped: List[Point] = []
    for point in candidates:
        if any(euclidean(point, existing) < min_distance for existing in deduped):
            continue
        deduped.append(point)

    return deduped


def sample_skeleton_points(
    skeleton: np.ndarray,
    max_points: int = 32,
    min_distance: float = 16.0,
) -> List[Point]:
    coords = np.column_stack(np.where(skeleton > 0))
    if len(coords) == 0:
        return []

    stride = max(1, len(coords) // max_points)
    sampled: List[Point] = []
    for y, x in coords[::stride]:
        point = (float(x), float(y))
        if any(euclidean(point, existing) < min_distance for existing in sampled):
            continue
        sampled.append(point)
        if len(sampled) >= max_points:
            break
    return sampled


def skeleton_line_ratio(
    skeleton: np.ndarray,
    source: Point,
    target: Point,
    samples: Optional[int] = None,
) -> float:
    distance = euclidean(source, target)
    if distance <= 1.0:
        return 0.0

    count = samples or int(max(16, min(220, distance / 2.0)))
    xs = np.linspace(source[0], target[0], count)
    ys = np.linspace(source[1], target[1], count)

    hit = 0
    for x, y in zip(xs, ys):
        xi = int(clamp(round(float(x)), 0, skeleton.shape[1] - 1))
        yi = int(clamp(round(float(y)), 0, skeleton.shape[0] - 1))

        x0 = max(0, xi - 1)
        x1 = min(skeleton.shape[1], xi + 2)
        y0 = max(0, yi - 1)
        y1 = min(skeleton.shape[0], yi + 2)
        if np.any(skeleton[y0:y1, x0:x1] > 0):
            hit += 1

    return hit / max(count, 1)


def point_in_polygon(point: Point, polygon: Sequence[Sequence[float]]) -> bool:
    if not polygon or len(polygon) < 4:
        return False
    contour = np.array([[p[0], p[1]] for p in polygon[:-1]], dtype=np.float32)
    if len(contour) < 3:
        return False
    return cv2.pointPolygonTest(contour, point, False) >= 0


def point_polygon_distance(point: Point, polygon: Sequence[Sequence[float]]) -> float:
    if not polygon or len(polygon) < 4:
        return float("inf")
    contour = np.array([[p[0], p[1]] for p in polygon[:-1]], dtype=np.float32)
    if len(contour) < 3:
        return float("inf")
    return abs(float(cv2.pointPolygonTest(contour, point, True)))


def line_mask_ratio(
    mask: np.ndarray,
    source: Point,
    target: Point,
    samples: Optional[int] = None,
    padding: int = 1,
) -> float:
    distance = euclidean(source, target)
    if distance <= 1.0:
        return 0.0

    count = samples or int(max(18, min(260, distance / 2.0)))
    xs = np.linspace(source[0], target[0], count)
    ys = np.linspace(source[1], target[1], count)

    hit = 0
    for x, y in zip(xs, ys):
        xi = int(clamp(round(float(x)), 0, mask.shape[1] - 1))
        yi = int(clamp(round(float(y)), 0, mask.shape[0] - 1))

        x0 = max(0, xi - padding)
        x1 = min(mask.shape[1], xi + padding + 1)
        y0 = max(0, yi - padding)
        y1 = min(mask.shape[0], yi + padding + 1)
        if np.any(mask[y0:y1, x0:x1] > 0):
            hit += 1

    return hit / max(count, 1)


def line_clear_of_walls(source: Point, target: Point, wall_mask: np.ndarray) -> bool:
    return line_mask_ratio(wall_mask, source, target, padding=1) <= 0.08


def line_through_walkable(source: Point, target: Point, walkable_mask: np.ndarray, min_ratio: float) -> bool:
    return line_mask_ratio(walkable_mask, source, target, padding=1) >= min_ratio


def carve_openings_from_wall_mask(wall_mask: np.ndarray, opening_records: List[Dict]) -> np.ndarray:
    carved = wall_mask.copy()
    for record in opening_records:
        if str(record.get("kind") or "") != "door":
            continue
        x, y = record.get("point", (0.0, 0.0))
        width = float(record.get("width") or 40.0)
        radius = max(5, int(round(width * 0.35)))
        cv2.circle(carved, (int(round(x)), int(round(y))), radius, 0, thickness=-1)
    return carved


def find_space_id_for_point(point: Point, space_records: List[Dict]) -> Optional[str]:
    best_id: Optional[str] = None
    best_distance = float("inf")
    for record in space_records:
        polygon = record.get("polygon", [])
        if point_in_polygon(point, polygon):
            return record.get("id")
        distance = point_polygon_distance(point, polygon)
        if distance < best_distance:
            best_distance = distance
            best_id = record.get("id")
    return best_id if best_distance <= 24.0 else None


def connect_skeleton_nodes(
    nodes: List[Point],
    skeleton: np.ndarray,
    wall_mask: Optional[np.ndarray] = None,
    walkable_mask: Optional[np.ndarray] = None,
) -> List[Tuple[int, int, float]]:
    edges: List[Tuple[int, int, float]] = []
    seen = set()

    for index, source in enumerate(nodes):
        neighbors = sorted(
            [
                (other_index, euclidean(source, target))
                for other_index, target in enumerate(nodes)
                if other_index != index
            ],
            key=lambda value: value[1],
        )[:10]

        links = 0
        for other_index, distance in neighbors:
            if distance < 8.0 or distance > 260.0:
                continue

            key = tuple(sorted((index, other_index)))
            if key in seen:
                continue

            if skeleton_line_ratio(skeleton, source, nodes[other_index]) < 0.58:
                continue
            if wall_mask is not None and not line_clear_of_walls(source, nodes[other_index], wall_mask):
                continue
            if walkable_mask is not None and not line_through_walkable(
                source,
                nodes[other_index],
                walkable_mask,
                min_ratio=0.46,
            ):
                continue

            seen.add(key)
            edges.append((key[0], key[1], distance))
            links += 1
            if links >= 4:
                break

    if edges:
        return edges

    # Fallback lightweight connectivity when skeleton paths are sparse.
    for index, source in enumerate(nodes):
        neighbors = sorted(
            [
                (other_index, euclidean(source, target))
                for other_index, target in enumerate(nodes)
                if other_index != index
            ],
            key=lambda value: value[1],
        )[:2]
        for other_index, distance in neighbors:
            if distance > 320.0:
                continue
            key = tuple(sorted((index, other_index)))
            if key in seen:
                continue
            if wall_mask is not None and not line_clear_of_walls(source, nodes[other_index], wall_mask):
                continue
            seen.add(key)
            edges.append((key[0], key[1], distance))

    return edges


def build_space_features(space_candidates: List[Dict]) -> Tuple[List[Dict], List[Dict]]:
    features: List[Dict] = []
    records: List[Dict] = []
    room_index = 1
    corridor_index = 1

    for candidate in space_candidates:
        polygon = candidate.get("polygon")
        if not polygon:
            continue

        kind = candidate.get("kind") or classify_space_kind(polygon)
        if kind == "corridor":
            name = f"Corridor {corridor_index}"
            color = SPACE_COLORS["corridor"]
            corridor_index += 1
        else:
            name = f"Room {room_index}"
            color = SPACE_COLORS.get(kind, SPACE_COLORS["room"])
            room_index += 1

        feature_id = make_uuid()
        features.append(
            {
                "type": "Feature",
                "id": feature_id,
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
        records.append(
            {
                "id": feature_id,
                "polygon": polygon,
                "kind": kind,
                "centroid": polygon_centroid(polygon),
            }
        )

    return features, records


def build_wall_features(wall_lines: List[Line]) -> List[Dict]:
    features: List[Dict] = []
    for x1, y1, x2, y2 in wall_lines:
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
    return features


def build_opening_features(opening_records: List[Dict]) -> List[Dict]:
    features: List[Dict] = []
    seen: List[Point] = []
    for record in opening_records:
        x, y = record["point"]
        if any(euclidean((x, y), existing) < 8.0 for existing in seen):
            continue
        seen.append((x, y))
        kind = str(record.get("kind") or "door")
        width = float(record.get("width") or (40.0 if kind == "door" else 34.0))
        features.append(
            {
                "type": "Feature",
                "id": make_uuid(),
                "properties": {
                    "kind": kind,
                    "width": width,
                    "rotation": 0.0,
                },
                "geometry": {"type": "Point", "coordinates": [float(x), float(y)]},
            }
        )
    return features


def build_object_features(
    cubicasa: Optional[CubiCasaPrediction],
    shape: Tuple[int, int],
) -> List[Dict]:
    if cubicasa is None:
        return []

    features: List[Dict] = []
    for class_id, (kind, label) in ICON_OBJECT_CLASSES.items():
        mask = mask_from_classes(
            cubicasa.icon_segmentation,
            [class_id],
            confidence=cubicasa.icon_confidence,
            min_confidence=0.52,
        )
        if mask.shape != shape:
            mask = cv2.resize(mask, (shape[1], shape[0]), interpolation=cv2.INTER_NEAREST)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8), iterations=1)

        for x, y in component_centroids(mask, min_area=18):
            features.append(
                {
                    "type": "Feature",
                    "id": make_uuid(),
                    "properties": {
                        "kind": kind,
                        "label": label,
                        "sourceClass": ICON_CLASSES[class_id] if class_id < len(ICON_CLASSES) else str(class_id),
                    },
                    "geometry": {"type": "Point", "coordinates": [float(x), float(y)]},
                }
            )

    return features


def build_navigation_features(
    interior_mask: np.ndarray,
    space_records: List[Dict],
    wall_mask: np.ndarray,
    corridor_mask: Optional[np.ndarray] = None,
    opening_records: Optional[List[Dict]] = None,
) -> List[Dict]:
    if cv2.countNonZero(interior_mask) == 0 or not space_records:
        return []

    walkable_mask = cv2.morphologyEx(
        (interior_mask > 0).astype(np.uint8) * 255,
        cv2.MORPH_CLOSE,
        np.ones((5, 5), np.uint8),
        iterations=1,
    )
    backbone_mask = corridor_mask if corridor_mask is not None and cv2.countNonZero(corridor_mask) > 0 else walkable_mask
    backbone_mask = cv2.morphologyEx(
        (backbone_mask > 0).astype(np.uint8) * 255,
        cv2.MORPH_CLOSE,
        np.ones((5, 5), np.uint8),
        iterations=1,
    )
    backbone_mask = cv2.morphologyEx(
        backbone_mask,
        cv2.MORPH_OPEN,
        np.ones((3, 3), np.uint8),
        iterations=1,
    )

    skeleton = skeletonize_walkable_mask(backbone_mask)
    skeleton_points = extract_skeleton_nodes(skeleton, min_distance=8.0)
    if not skeleton_points:
        skeleton_points = sample_skeleton_points(skeleton, max_points=28, min_distance=18.0)

    room_records = [record for record in space_records if str(record.get("kind") or "") != "corridor"] or list(space_records)
    node_entries: List[Dict] = []
    room_indices: List[int] = []
    door_indices: List[int] = []
    skeleton_indices: List[int] = []

    for record in room_records:
        point = tuple(record.get("centroid") or polygon_centroid(record.get("polygon", [])))
        node_entries.append(
            {
                "point": point,
                "spaceId": record.get("id"),
                "role": "room",
                "polygon": record.get("polygon", []),
            }
        )
        room_indices.append(len(node_entries) - 1)

    seen_doors: List[Point] = []
    for record in opening_records or []:
        if str(record.get("kind") or "") != "door":
            continue
        point = (float(record["point"][0]), float(record["point"][1]))
        if any(euclidean(point, existing) < 10.0 for existing in seen_doors):
            continue
        seen_doors.append(point)
        node_entries.append(
            {
                "point": point,
                "spaceId": find_space_id_for_point(point, space_records),
                "role": "door",
                "polygon": [],
            }
        )
        door_indices.append(len(node_entries) - 1)

    for point in skeleton_points:
        if any(euclidean(point, entry["point"]) < 8.0 for entry in node_entries):
            continue
        node_entries.append(
            {
                "point": point,
                "spaceId": find_space_id_for_point(point, space_records),
                "role": "skeleton",
                "polygon": [],
            }
        )
        skeleton_indices.append(len(node_entries) - 1)

    if not node_entries:
        return []

    navigation_wall_mask = carve_openings_from_wall_mask(wall_mask, opening_records or [])
    edge_set = set()
    edge_records: List[Tuple[int, int, float]] = []
    degree: Dict[int, int] = {index: 0 for index in range(len(node_entries))}

    def add_edge(a: int, b: int, weight: Optional[float] = None) -> bool:
        if a == b:
            return False
        key = tuple(sorted((a, b)))
        if key in edge_set:
            return False
        w = float(round(weight if weight is not None else euclidean(node_entries[a]["point"], node_entries[b]["point"]), 2))
        edge_set.add(key)
        edge_records.append((key[0], key[1], w))
        degree[a] += 1
        degree[b] += 1
        return True

    def try_connect(
        source_index: int,
        candidate_indices: List[int],
        max_distance: float,
        min_walk_ratio: float,
        max_links: int,
    ) -> int:
        source = node_entries[source_index]["point"]
        links = 0
        ranked = sorted(
            (
                (candidate_index, euclidean(source, node_entries[candidate_index]["point"]))
                for candidate_index in candidate_indices
                if candidate_index != source_index
            ),
            key=lambda entry: entry[1],
        )
        for candidate_index, distance in ranked:
            if distance > max_distance:
                continue
            target = node_entries[candidate_index]["point"]
            if not line_clear_of_walls(source, target, navigation_wall_mask):
                continue
            if not line_through_walkable(source, target, walkable_mask, min_ratio=min_walk_ratio):
                continue
            if add_edge(source_index, candidate_index, distance):
                links += 1
            if links >= max_links:
                break
        return links

    if skeleton_indices:
        skeleton_edges = connect_skeleton_nodes(
            [node_entries[index]["point"] for index in skeleton_indices],
            skeleton,
            wall_mask=navigation_wall_mask,
            walkable_mask=walkable_mask,
        )
        for a, b, weight in skeleton_edges:
            add_edge(skeleton_indices[a], skeleton_indices[b], weight)

    for door_index in door_indices:
        if degree[door_index] > 0:
            continue
        links = try_connect(door_index, skeleton_indices, max_distance=180.0, min_walk_ratio=0.28, max_links=2)
        if links == 0:
            try_connect(door_index, room_indices, max_distance=140.0, min_walk_ratio=0.22, max_links=1)

    for room_index in room_indices:
        room_polygon = node_entries[room_index].get("polygon", [])
        nearby_doors = [
            candidate_index
            for candidate_index in door_indices
            if point_polygon_distance(node_entries[candidate_index]["point"], room_polygon) <= 32.0
        ]
        nearby_doors.sort(
            key=lambda candidate_index: euclidean(
                node_entries[room_index]["point"],
                node_entries[candidate_index]["point"],
            )
        )
        if nearby_doors:
            try_connect(room_index, nearby_doors, max_distance=160.0, min_walk_ratio=0.24, max_links=1)
        if degree[room_index] == 0:
            try_connect(room_index, skeleton_indices, max_distance=260.0, min_walk_ratio=0.28, max_links=1)
        if degree[room_index] == 0:
            try_connect(
                room_index,
                [candidate for candidate in room_indices if candidate != room_index],
                max_distance=320.0,
                min_walk_ratio=0.18,
                max_links=1,
            )

    for room_index in room_indices:
        if degree[room_index] > 0:
            continue
        fallback_targets = [candidate for candidate in door_indices + skeleton_indices + room_indices if candidate != room_index]
        ranked = sorted(
            (
                (candidate, euclidean(node_entries[room_index]["point"], node_entries[candidate]["point"]))
                for candidate in fallback_targets
            ),
            key=lambda entry: entry[1],
        )
        for candidate, distance in ranked:
            if line_clear_of_walls(node_entries[room_index]["point"], node_entries[candidate]["point"], navigation_wall_mask):
                if add_edge(room_index, candidate, distance):
                    break
        if degree[room_index] == 0 and ranked:
            candidate, distance = ranked[0]
            add_edge(room_index, candidate, distance)

    keep_indices = [
        index
        for index, entry in enumerate(node_entries)
        if degree[index] > 0 or entry.get("role") == "room"
    ]
    remap = {old_index: new_index for new_index, old_index in enumerate(keep_indices)}
    filtered_entries = [node_entries[index] for index in keep_indices]
    filtered_edges = [
        (remap[a], remap[b], weight)
        for a, b, weight in edge_records
        if a in remap and b in remap
    ]

    node_ids = [make_uuid() for _ in filtered_entries]
    neighbors: Dict[str, List[Dict]] = {node_id: [] for node_id in node_ids}

    for a, b, weight in filtered_edges:
        id_a = node_ids[a]
        id_b = node_ids[b]
        neighbors[id_a].append({"id": id_b, "weight": weight})
        neighbors[id_b].append({"id": id_a, "weight": weight})

    features: List[Dict] = []
    for index, entry in enumerate(filtered_entries):
        point = entry["point"]
        node_id = node_ids[index]
        features.append(
            {
                "type": "Feature",
                "id": node_id,
                "properties": {
                    "kind": "waypoint",
                    "spaceId": entry.get("spaceId"),
                    "role": entry.get("role"),
                    "neighbors": neighbors[node_id],
                },
                "geometry": {
                    "type": "Point",
                    "coordinates": [float(point[0]), float(point[1])],
                },
            }
        )

    return features


def apply_options(mvf: Dict, options: Dict) -> Dict:
    include_walls = bool(options.get("walls", True))
    include_doors = bool(options.get("doors", True))
    include_windows = bool(options.get("windows", True))
    include_connections = bool(options.get("connections", True))
    include_objects = bool(options.get("objects", True))

    if not include_walls:
        mvf["obstructions"]["features"] = []

    if not include_doors or not include_windows:
        filtered = []
        for feature in mvf["openings"]["features"]:
            kind = str(feature.get("properties", {}).get("kind", ""))
            if kind == "door" and not include_doors:
                continue
            if kind == "window" and not include_windows:
                continue
            filtered.append(feature)
        mvf["openings"]["features"] = filtered

    if not include_connections:
        mvf["nodes"]["features"] = []

    if not include_objects:
        mvf["objects"]["features"] = []

    return mvf


def build_meta(width: int, height: int, options: Dict) -> Dict:
    pixels_per_meter = options.get("pixelsPerMeter", options.get("pixels_per_meter", 20))
    floor_label = options.get("floorLabel", options.get("floor_label", "Floor"))
    return {
        "imageWidth": int(width),
        "imageHeight": int(height),
        "pixelsPerMeter": float(pixels_per_meter),
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


def scale_coordinate_pair(coord: Sequence[float], scale_x: float, scale_y: float) -> List[float]:
    if coord is None or len(coord) < 2:
        return [0.0, 0.0]
    return [float(coord[0]) * scale_x, float(coord[1]) * scale_y]


def clamp_coordinate_pair(coord: Sequence[float], width: int, height: int) -> List[float]:
    if coord is None or len(coord) < 2:
        return [0.0, 0.0]
    max_x = max(0.0, float(width))
    max_y = max(0.0, float(height))
    return [
        clamp(float(coord[0]), 0.0, max_x),
        clamp(float(coord[1]), 0.0, max_y),
    ]


def scale_geometry(
    geometry: Dict,
    scale_x: float,
    scale_y: float,
    width: Optional[int] = None,
    height: Optional[int] = None,
) -> None:
    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates")

    if geometry_type == "Point":
        point = scale_coordinate_pair(coordinates, scale_x, scale_y)
        geometry["coordinates"] = (
            clamp_coordinate_pair(point, width, height) if width is not None and height is not None else point
        )
        return

    if geometry_type == "LineString":
        line = [
            scale_coordinate_pair(coord, scale_x, scale_y) for coord in coordinates or []
        ]
        geometry["coordinates"] = (
            [clamp_coordinate_pair(coord, width, height) for coord in line]
            if width is not None and height is not None
            else line
        )
        return

    if geometry_type == "Polygon":
        polygon = [
            [scale_coordinate_pair(coord, scale_x, scale_y) for coord in ring]
            for ring in coordinates or []
        ]
        geometry["coordinates"] = (
            [
                [clamp_coordinate_pair(coord, width, height) for coord in ring]
                for ring in polygon
            ]
            if width is not None and height is not None
            else polygon
        )


def scale_mvf_to_original(
    mvf: Dict,
    original_width: int,
    original_height: int,
    working_width: int,
    working_height: int,
    scale_x: float,
    scale_y: float,
) -> Dict:
    for collection_name in ("spaces", "obstructions", "openings", "nodes", "objects"):
        for feature in mvf.get(collection_name, {}).get("features", []):
            geometry = feature.get("geometry")
            if isinstance(geometry, dict):
                scale_geometry(
                    geometry,
                    scale_x,
                    scale_y,
                    width=original_width,
                    height=original_height,
                )

            properties = feature.get("properties")
            if isinstance(properties, dict):
                if "width" in properties:
                    properties["width"] = float(properties["width"]) * ((scale_x + scale_y) / 2.0)
                if "thickness" in properties:
                    properties["thickness"] = max(
                        1.0,
                        float(properties["thickness"]) * ((scale_x + scale_y) / 2.0),
                    )

    mvf.setdefault("meta", {}).update(
        {
            "imageWidth": int(original_width),
            "imageHeight": int(original_height),
            "traceWorkingWidth": int(working_width),
            "traceWorkingHeight": int(working_height),
            "traceScaleX": float(scale_x),
            "traceScaleY": float(scale_y),
            "coordinateSpace": "image-pixels",
        }
    )
    return mvf


def opencv_emergency_pipeline(
    bundle: ImageBundle,
    options: Dict,
) -> Dict:
    wall_lines, wall_mask = build_wall_lines_and_mask(bundle.image_bgr)

    space_candidates, interior_mask = extract_space_polygons(wall_mask, None)
    region_labels = flood_fill_region_labels(interior_mask)
    door_points = detect_door_points(wall_lines, wall_mask, region_labels)
    opening_records = [
        {"point": point, "kind": "door", "width": 40.0} for point in door_points
    ]

    spaces, space_records = build_space_features(space_candidates)
    obstructions = build_wall_features(wall_lines)
    openings = build_opening_features(opening_records)
    objects: List[Dict] = []
    nodes = build_navigation_features(
        interior_mask,
        space_records,
        wall_mask,
        corridor_mask=None,
        opening_records=opening_records,
    )

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


def cubicasa_pipeline(
    bundle: ImageBundle,
    options: Dict,
    cubicasa: CubiCasaPrediction,
) -> Dict:
    wall_mask = cubicasa_wall_mask(cubicasa, bundle.image_bgr.shape[:2])
    corridor_mask = cubicasa_corridor_mask(cubicasa, wall_mask.shape)
    wall_lines = wall_lines_from_wall_mask(wall_mask)
    if not wall_lines:
        wall_lines, wall_mask = build_wall_lines_and_mask(bundle.image_bgr)
        corridor_mask = np.zeros(wall_mask.shape, dtype=np.uint8)

    space_candidates, interior_mask = extract_space_polygons(wall_mask, cubicasa)
    region_labels = flood_fill_region_labels(interior_mask)

    opening_records = cubicasa_opening_records(cubicasa, wall_mask.shape)
    if not any(record.get("kind") == "door" for record in opening_records):
        opening_records.extend(
            {"point": point, "kind": "door", "width": 40.0}
            for point in detect_door_points(wall_lines, wall_mask, region_labels)
        )

    spaces, space_records = build_space_features(space_candidates)
    obstructions = build_wall_features(wall_lines)
    openings = build_opening_features(opening_records)
    objects = build_object_features(cubicasa, wall_mask.shape)
    nodes = build_navigation_features(
        interior_mask,
        space_records,
        wall_mask,
        corridor_mask=corridor_mask,
        opening_records=opening_records,
    )

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
    original_bundle = load_image_from_bytes(content, filename)
    bundle, scale_x, scale_y = working_bundle_for_trace(original_bundle, options)

    cubicasa_result = None
    pipeline_name = "opencv-emergency-fallback"
    warning = None

    try:
        cubicasa_result = run_cubicasa_prediction(bundle.image_bgr)
        if cubicasa_result is not None:
            pipeline_name = "cubicasa-floortrans"
    except Exception as exc:  # pragma: no cover - runtime dependent
        LOGGER.warning(
            "CubiCasa inference failed. Emergency OpenCV fallback will be used (%s)",
            exc,
        )
        warning = f"CubiCasa inference failed; emergency OpenCV fallback used. {exc}"
        cubicasa_result = None
        pipeline_name = "opencv-emergency-fallback"

    if cubicasa_result is not None:
        mvf = cubicasa_pipeline(bundle, options, cubicasa_result)
    else:
        if warning is None:
            warning = "CubiCasa model unavailable; emergency OpenCV fallback used."
        mvf = opencv_emergency_pipeline(bundle, options)

    mvf.setdefault("meta", {}).update(
        {
            "pipeline": pipeline_name,
            "modelStatus": runtime_status_message(),
        }
    )
    if warning:
        mvf["meta"]["warning"] = warning
    return scale_mvf_to_original(
        mvf,
        original_bundle.width,
        original_bundle.height,
        bundle.width,
        bundle.height,
        scale_x,
        scale_y,
    )
