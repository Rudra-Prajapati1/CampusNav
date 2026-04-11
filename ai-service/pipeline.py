import json
import math
import uuid
from io import BytesIO
from typing import Dict, List, Optional, Sequence, Tuple

import cv2
import fitz
import numpy as np
from PIL import Image

try:  # pragma: no cover - optional at runtime, but required by requirements.txt
    from skimage.morphology import skeletonize as skimage_skeletonize
except Exception:  # pragma: no cover
    skimage_skeletonize = None


Point = Tuple[int, int]
Line = Tuple[int, int, int, int]


def make_uuid() -> str:
    return str(uuid.uuid4())


def empty_result() -> Dict:
    return {
        "walls": [],
        "doors": [],
        "windows": [],
        "rooms": [],
        "nodes": [],
        "edges": [],
        "objects": [],
    }


def parse_options(raw_options: str) -> Dict:
    try:
        options = json.loads(raw_options or "{}")
        return options if isinstance(options, dict) else {}
    except Exception:
        return {}


def load_image_from_bytes(content: bytes, filename: str) -> np.ndarray:
    lower = filename.lower()
    if lower.endswith(".pdf"):
        doc = fitz.open(stream=content, filetype="pdf")
        if doc.page_count == 0:
            raise ValueError("The uploaded PDF does not contain any pages.")
        page = doc.load_page(0)
        pix = page.get_pixmap(alpha=False, dpi=220)
        image = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        return cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)

    image = Image.open(BytesIO(content)).convert("RGB")
    return cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)


def to_point(point: Sequence[int]) -> Dict[str, int]:
    return {"x": int(point[0]), "y": int(point[1])}


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def line_length(line: Line) -> float:
    x1, y1, x2, y2 = line
    return math.hypot(x2 - x1, y2 - y1)


def normalize_line(raw_line: Sequence[int]) -> Line:
    x1, y1, x2, y2 = [int(value) for value in raw_line]
    if abs(y2 - y1) < abs(x2 - x1):
        return (x1, y1, x2, y2) if x1 <= x2 else (x2, y2, x1, y1)
    return (x1, y1, x2, y2) if y1 <= y2 else (x2, y2, x1, y1)


def line_orientation(line: Line) -> str:
    x1, y1, x2, y2 = line
    dx = x2 - x1
    dy = y2 - y1
    if abs(dy) <= abs(dx) * 0.35:
        return "horizontal"
    if abs(dx) <= abs(dy) * 0.35:
        return "vertical"
    return "other"


def point_distance(a: Point, b: Point) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def preprocess(image: np.ndarray) -> Dict[str, np.ndarray]:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    filtered = cv2.bilateralFilter(gray, 9, 35, 35)
    clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8)).apply(filtered)
    binary = cv2.adaptiveThreshold(
        clahe,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        35,
        11,
    )

    if float(np.mean(binary < 128)) > 0.45:
        binary = cv2.bitwise_not(binary)

    wall_mask = cv2.bitwise_not(binary)
    wall_mask = cv2.morphologyEx(
        wall_mask,
        cv2.MORPH_CLOSE,
        np.ones((3, 3), np.uint8),
        iterations=2,
    )
    processed = cv2.bitwise_not(wall_mask)

    return {
        "gray": gray,
        "filtered": filtered,
        "enhanced": clahe,
        "processed": processed,
        "wall_mask": wall_mask,
    }


def interior_space_mask(wall_mask: np.ndarray) -> np.ndarray:
    walkable = cv2.bitwise_not(wall_mask)
    walkable = cv2.morphologyEx(
        walkable,
        cv2.MORPH_CLOSE,
        np.ones((7, 7), np.uint8),
        iterations=2,
    )

    component_count, labels, stats, _ = cv2.connectedComponentsWithStats(walkable, 8)
    interior = np.zeros_like(walkable)
    height, width = walkable.shape

    for label in range(1, component_count):
        left = stats[label, cv2.CC_STAT_LEFT]
        top = stats[label, cv2.CC_STAT_TOP]
        component_width = stats[label, cv2.CC_STAT_WIDTH]
        component_height = stats[label, cv2.CC_STAT_HEIGHT]
        touches_border = (
            left <= 0
            or top <= 0
            or left + component_width >= width - 1
            or top + component_height >= height - 1
        )
        if not touches_border:
            interior[labels == label] = 255

    return interior


def merge_parallel_lines(lines: List[Line], orientation: str) -> List[Line]:
    if not lines:
        return []

    normalized = [normalize_line(line) for line in lines if line_length(line) >= 30]
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
            if abs(prev_y - line_y) <= 5 and gap <= 8:
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
            if abs(prev_x - line_x) <= 5 and gap <= 8:
                merged[-1] = (
                    int(round((prev_x + line_x) / 2)),
                    min(prev_start, line_start),
                    int(round((prev_x + line_x) / 2)),
                    max(prev_end, line_end),
                )
            else:
                merged.append(line)

    return merged


def estimate_wall_thickness(wall_mask: np.ndarray, line: Line) -> int:
    x1, y1, x2, y2 = line
    mid_x = int(round((x1 + x2) / 2))
    mid_y = int(round((y1 + y2) / 2))
    height, width = wall_mask.shape
    orientation = line_orientation(line)

    def measure_span(axis: str) -> int:
        span = 1
        for direction in (-1, 1):
            delta = 1
            while delta < 24:
                sample_x = mid_x + (delta * direction if axis == "x" else 0)
                sample_y = mid_y + (delta * direction if axis == "y" else 0)
                if not (0 <= sample_x < width and 0 <= sample_y < height):
                    break
                if wall_mask[sample_y, sample_x] < 128:
                    break
                span += 1
                delta += 1
        return span

    if orientation == "horizontal":
        return max(4, measure_span("y"))
    if orientation == "vertical":
        return max(4, measure_span("x"))
    return 4


def detect_walls(processed: np.ndarray, wall_mask: np.ndarray) -> Tuple[List[Dict], List[Line]]:
    edges = cv2.Canny(processed, 30, 100)
    raw_lines = cv2.HoughLinesP(
        edges,
        1,
        np.pi / 180,
        threshold=80,
        minLineLength=30,
        maxLineGap=8,
    )

    if raw_lines is None:
        return [], []

    normalized_lines = [normalize_line(line[0]) for line in raw_lines]
    horizontal = [line for line in normalized_lines if line_orientation(line) == "horizontal"]
    vertical = [line for line in normalized_lines if line_orientation(line) == "vertical"]
    diagonal = [line for line in normalized_lines if line_orientation(line) == "other"]

    merged_lines = (
        merge_parallel_lines(horizontal, "horizontal")
        + merge_parallel_lines(vertical, "vertical")
        + [line for line in diagonal if line_length(line) >= 40]
    )

    walls = []
    for line in merged_lines:
        walls.append(
            {
                "id": make_uuid(),
                "x1": int(line[0]),
                "y1": int(line[1]),
                "x2": int(line[2]),
                "y2": int(line[3]),
                "thickness": estimate_wall_thickness(wall_mask, line),
            }
        )

    return walls, normalized_lines


def contour_moments_center(contour: np.ndarray) -> Point:
    moments = cv2.moments(contour)
    if moments["m00"] == 0:
        x, y, width, height = cv2.boundingRect(contour)
        return (int(x + width / 2), int(y + height / 2))
    return (
        int(moments["m10"] / moments["m00"]),
        int(moments["m01"] / moments["m00"]),
    )


def polygon_from_contour(contour: np.ndarray) -> List[Dict[str, int]]:
    epsilon = 0.01 * cv2.arcLength(contour, True)
    approx = cv2.approxPolyDP(contour, epsilon, True)
    if len(approx) < 3:
        approx = contour
    return [to_point(point[0]) for point in approx]


def detect_rooms(interior_mask: np.ndarray) -> List[Dict]:
    closed = cv2.morphologyEx(
        interior_mask,
        cv2.MORPH_CLOSE,
        np.ones((9, 9), np.uint8),
        iterations=2,
    )
    contours, hierarchy = cv2.findContours(
        closed,
        cv2.RETR_CCOMP,
        cv2.CHAIN_APPROX_SIMPLE,
    )

    if hierarchy is None:
        return []

    rooms: List[Dict] = []
    total_area = interior_mask.shape[0] * interior_mask.shape[1]

    for contour in sorted(contours, key=cv2.contourArea, reverse=True):
        area = cv2.contourArea(contour)
        if area < 3000 or area > total_area * 0.8:
            continue

        x, y, width, height = cv2.boundingRect(contour)
        if x <= 0 or y <= 0 or x + width >= interior_mask.shape[1] - 1 or y + height >= interior_mask.shape[0] - 1:
            continue

        center = contour_moments_center(contour)
        polygon = polygon_from_contour(contour)
        if len(polygon) < 3:
            continue

        rooms.append(
            {
                "id": make_uuid(),
                "name": f"Room {len(rooms) + 1}",
                "type": "other",
                "x": int(x),
                "y": int(y),
                "width": int(width),
                "height": int(height),
                "center": to_point(center),
                "polygon": polygon,
                "_area": float(area),
            }
        )

    return rooms


def build_region_labels(interior_mask: np.ndarray) -> np.ndarray:
    _, labels = cv2.connectedComponents((interior_mask > 0).astype(np.uint8), 8)
    return labels


def sample_labels_around_point(region_labels: np.ndarray, x: int, y: int, orientation: str) -> Tuple[int, int]:
    height, width = region_labels.shape
    if orientation == "vertical":
        offsets = [(-8, 0), (8, 0), (-12, 0), (12, 0)]
    else:
        offsets = [(0, -8), (0, 8), (0, -12), (0, 12)]

    side_a = 0
    side_b = 0
    for offset_x, offset_y in offsets[:2]:
        sample_x = int(clamp(x + offset_x, 0, width - 1))
        sample_y = int(clamp(y + offset_y, 0, height - 1))
        label = int(region_labels[sample_y, sample_x])
        if label:
            if not side_a:
                side_a = label
            elif label != side_a and not side_b:
                side_b = label

    for offset_x, offset_y in offsets[2:]:
        sample_x = int(clamp(x + offset_x, 0, width - 1))
        sample_y = int(clamp(y + offset_y, 0, height - 1))
        label = int(region_labels[sample_y, sample_x])
        if label and label != side_a and not side_b:
            side_b = label

    return side_a, side_b


def nearest_wall_id(walls: List[Dict], point: Point, orientation: Optional[str] = None) -> Optional[str]:
    best_id = None
    best_distance = 18.0
    for wall in walls:
        wall_orientation = line_orientation((wall["x1"], wall["y1"], wall["x2"], wall["y2"]))
        if orientation and wall_orientation != orientation:
            continue

        if wall_orientation == "horizontal":
            distance = abs(point[1] - wall["y1"])
        elif wall_orientation == "vertical":
            distance = abs(point[0] - wall["x1"])
        else:
            distance = min(
                point_distance(point, (wall["x1"], wall["y1"])),
                point_distance(point, (wall["x2"], wall["y2"])),
            )

        if distance < best_distance:
            best_distance = distance
            best_id = wall["id"]

    return best_id


def scan_wall_gap_candidates(wall_mask: np.ndarray, wall: Dict, region_labels: np.ndarray) -> List[Dict]:
    orientation = line_orientation((wall["x1"], wall["y1"], wall["x2"], wall["y2"]))
    if orientation not in {"horizontal", "vertical"}:
        return []

    candidates = []
    if orientation == "horizontal":
        y = int(round((wall["y1"] + wall["y2"]) / 2))
        x_start, x_end = sorted((wall["x1"], wall["x2"]))
        values = wall_mask[y, x_start : x_end + 1] > 0
    else:
        x = int(round((wall["x1"] + wall["x2"]) / 2))
        y_start, y_end = sorted((wall["y1"], wall["y2"]))
        values = wall_mask[y_start : y_end + 1, x] > 0

    run_start = None
    for index, active in enumerate(values.tolist() + [True]):
        if not active and run_start is None:
            run_start = index
        elif active and run_start is not None:
            gap_length = index - run_start
            if 20 <= gap_length <= 80:
                if orientation == "horizontal":
                    center_x = x_start + run_start + gap_length // 2
                    center_y = y
                else:
                    center_x = x
                    center_y = y_start + run_start + gap_length // 2

                label_a, label_b = sample_labels_around_point(
                    region_labels,
                    center_x,
                    center_y,
                    orientation,
                )
                if label_a and label_b and label_a != label_b:
                    candidates.append(
                        {
                            "id": make_uuid(),
                            "x": int(center_x),
                            "y": int(center_y),
                            "width": int(gap_length),
                            "rotation": 0 if orientation == "horizontal" else 90,
                            "wallId": wall["id"],
                        }
                    )
            run_start = None

    return candidates


def detect_arc_doors(processed: np.ndarray, walls: List[Dict]) -> List[Dict]:
    edges = cv2.Canny(processed, 30, 100)
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    arc_candidates: List[Dict] = []

    for contour in contours:
        area = cv2.contourArea(contour)
        if area < 40 or area > 2500:
            continue

        perimeter = cv2.arcLength(contour, False)
        if perimeter <= 0:
            continue

        circularity = (4 * math.pi * area) / (perimeter * perimeter)
        if circularity < 0.1 or circularity > 0.9:
            continue

        x, y, width, height = cv2.boundingRect(contour)
        if not (20 <= max(width, height) <= 80):
            continue

        center = contour_moments_center(contour)
        wall_id = nearest_wall_id(walls, center)
        if not wall_id:
            continue

        arc_candidates.append(
            {
                "id": make_uuid(),
                "x": int(center[0]),
                "y": int(center[1]),
                "width": int(max(width, height)),
                "rotation": 0,
                "wallId": wall_id,
            }
        )

    return arc_candidates


def dedupe_by_distance(entries: List[Dict], threshold: float = 18.0) -> List[Dict]:
    deduped: List[Dict] = []
    for entry in entries:
        if any(
            math.hypot(entry["x"] - current["x"], entry["y"] - current["y"]) < threshold
            for current in deduped
        ):
            continue
        deduped.append(entry)
    return deduped


def detect_doors(processed: np.ndarray, wall_mask: np.ndarray, walls: List[Dict], region_labels: np.ndarray) -> List[Dict]:
    candidates = []
    for wall in walls:
        candidates.extend(scan_wall_gap_candidates(wall_mask, wall, region_labels))
    candidates.extend(detect_arc_doors(processed, walls))
    return dedupe_by_distance(candidates, 18.0)


def detect_windows(raw_lines: List[Line], walls: List[Dict], region_labels: np.ndarray) -> List[Dict]:
    windows: List[Dict] = []
    normalized = [line for line in raw_lines if 20 <= line_length(line) <= 60]

    for index, left in enumerate(normalized):
        left_orientation = line_orientation(left)
        if left_orientation not in {"horizontal", "vertical"}:
            continue

        for right in normalized[index + 1 :]:
            right_orientation = line_orientation(right)
            if right_orientation != left_orientation:
                continue

            if left_orientation == "horizontal":
                left_y = int(round((left[1] + left[3]) / 2))
                right_y = int(round((right[1] + right[3]) / 2))
                if not (4 <= abs(left_y - right_y) <= 18):
                    continue
                left_start, left_end = sorted((left[0], left[2]))
                right_start, right_end = sorted((right[0], right[2]))
                overlap = min(left_end, right_end) - max(left_start, right_start)
                if overlap < 16:
                    continue
                center = (int((max(left_start, right_start) + min(left_end, right_end)) / 2), int((left_y + right_y) / 2))
                width = int(overlap)
            else:
                left_x = int(round((left[0] + left[2]) / 2))
                right_x = int(round((right[0] + right[2]) / 2))
                if not (4 <= abs(left_x - right_x) <= 18):
                    continue
                left_start, left_end = sorted((left[1], left[3]))
                right_start, right_end = sorted((right[1], right[3]))
                overlap = min(left_end, right_end) - max(left_start, right_start)
                if overlap < 16:
                    continue
                center = (int((left_x + right_x) / 2), int((max(left_start, right_start) + min(left_end, right_end)) / 2))
                width = int(overlap)

            label_a, label_b = sample_labels_around_point(region_labels, center[0], center[1], left_orientation)
            if bool(label_a) == bool(label_b):
                continue

            wall_id = nearest_wall_id(walls, center, left_orientation)
            if not wall_id:
                continue

            windows.append(
                {
                    "id": make_uuid(),
                    "x": int(center[0]),
                    "y": int(center[1]),
                    "width": int(width),
                    "wallId": wall_id,
                }
            )

    return dedupe_by_distance(windows, 14.0)


def polygon_mask(shape: Tuple[int, int], polygon: List[Dict]) -> np.ndarray:
    mask = np.zeros(shape, dtype=np.uint8)
    points = np.array([[[point["x"], point["y"]]] for point in polygon], dtype=np.int32)
    cv2.fillPoly(mask, [points], 255)
    return mask


def is_corridor_room(room: Dict) -> bool:
    width = max(room["width"], 1)
    height = max(room["height"], 1)
    ratio = max(width / height, height / width)
    area = room.get("_area", width * height)
    polygon = room.get("polygon", [])
    fill_ratio = area / max(width * height, 1)
    return area >= 12000 and (ratio >= 2.0 or fill_ratio <= 0.62 or len(polygon) >= 8)


def skeletonize_mask(mask: np.ndarray) -> np.ndarray:
    if skimage_skeletonize is not None:
        skeleton = skimage_skeletonize(mask > 0)
        return (skeleton.astype(np.uint8)) * 255

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


def line_samples(a: Point, b: Point, count: int) -> List[Point]:
    xs = np.linspace(a[0], b[0], count)
    ys = np.linspace(a[1], b[1], count)
    return [(int(round(x)), int(round(y))) for x, y in zip(xs, ys)]


def line_pass_ratio(mask: np.ndarray, a: Point, b: Point) -> float:
    sample_count = max(12, int(point_distance(a, b) / 6))
    samples = line_samples(a, b, sample_count)
    inside = 0
    height, width = mask.shape
    for x, y in samples:
        x = int(clamp(x, 0, width - 1))
        y = int(clamp(y, 0, height - 1))
        if mask[y, x] > 0:
            inside += 1
    return inside / max(sample_count, 1)


def clear_of_walls(wall_mask: np.ndarray, a: Point, b: Point) -> bool:
    sample_count = max(12, int(point_distance(a, b) / 5))
    samples = line_samples(a, b, sample_count)
    height, width = wall_mask.shape
    hits = 0
    for x, y in samples:
        x = int(clamp(x, 0, width - 1))
        y = int(clamp(y, 0, height - 1))
        if wall_mask[y, x] > 0:
            hits += 1
    return hits / max(sample_count, 1) <= 0.08


def detect_corridor_nodes(corridor_mask: np.ndarray) -> List[Point]:
    skeleton = skeletonize_mask(corridor_mask)
    if cv2.countNonZero(skeleton) == 0:
        return []

    skeleton_bool = (skeleton > 0).astype(np.uint8)
    kernel = np.array(
        [[1, 1, 1], [1, 10, 1], [1, 1, 1]],
        dtype=np.uint8,
    )
    neighbor_map = cv2.filter2D(skeleton_bool, -1, kernel)
    node_mask = np.zeros_like(skeleton_bool)
    ys, xs = np.where(skeleton_bool > 0)

    for y, x in zip(ys, xs):
        neighbors = int(neighbor_map[y, x]) - 10
        if neighbors != 2:
            node_mask[y, x] = 255

    component_count, labels, stats, centroids = cv2.connectedComponentsWithStats(node_mask, 8)
    nodes: List[Point] = []
    for label in range(1, component_count):
        if stats[label, cv2.CC_STAT_AREA] <= 0:
            continue
        nodes.append((int(centroids[label][0]), int(centroids[label][1])))

    segment_mask = cv2.bitwise_and(skeleton, cv2.bitwise_not(node_mask))
    component_count, labels, stats, centroids = cv2.connectedComponentsWithStats(segment_mask, 8)
    for label in range(1, component_count):
        if stats[label, cv2.CC_STAT_AREA] < 28:
            continue
        nodes.append((int(centroids[label][0]), int(centroids[label][1])))

    deduped: List[Point] = []
    for node in nodes:
        if any(point_distance(node, existing) < 18 for existing in deduped):
            continue
        deduped.append(node)
    return deduped


def corridor_graph_nodes(
    corridor_mask: np.ndarray,
    wall_mask: np.ndarray,
    room_nodes: List[Dict],
) -> Tuple[List[Dict], List[Dict]]:
    corridor_points = detect_corridor_nodes(corridor_mask)
    corridor_nodes = [
        {
            "id": make_uuid(),
            "x": int(point[0]),
            "y": int(point[1]),
            "type": "corridor",
            "roomId": None,
        }
        for point in corridor_points
    ]

    nodes = list(room_nodes) + corridor_nodes
    edges: List[Dict] = []
    edge_keys = set()

    for room_node in room_nodes:
        ordered = sorted(
            corridor_nodes,
            key=lambda node: point_distance(
                (room_node["x"], room_node["y"]),
                (node["x"], node["y"]),
            ),
        )[:4]
        for corridor_node in ordered:
            start = (room_node["x"], room_node["y"])
            end = (corridor_node["x"], corridor_node["y"])
            if line_pass_ratio(corridor_mask, start, end) < 0.42 and line_pass_ratio(
                cv2.bitwise_not(wall_mask), start, end
            ) < 0.9:
                continue
            if not clear_of_walls(wall_mask, start, end):
                continue
            key = tuple(sorted((room_node["id"], corridor_node["id"])))
            if key in edge_keys:
                continue
            edge_keys.add(key)
            edges.append(
                {
                    "id": make_uuid(),
                    "from": room_node["id"],
                    "to": corridor_node["id"],
                    "weight": int(round(point_distance(start, end))),
                }
            )
            break

    for index, node in enumerate(corridor_nodes):
        neighbors = sorted(
            corridor_nodes[:index] + corridor_nodes[index + 1 :],
            key=lambda other: point_distance(
                (node["x"], node["y"]),
                (other["x"], other["y"]),
            ),
        )[:6]
        added = 0
        for neighbor in neighbors:
            start = (node["x"], node["y"])
            end = (neighbor["x"], neighbor["y"])
            if point_distance(start, end) < 18 or point_distance(start, end) > 180:
                continue
            if line_pass_ratio(corridor_mask, start, end) < 0.7:
                continue
            if not clear_of_walls(wall_mask, start, end):
                continue

            key = tuple(sorted((node["id"], neighbor["id"])))
            if key in edge_keys:
                continue
            edge_keys.add(key)
            edges.append(
                {
                    "id": make_uuid(),
                    "from": node["id"],
                    "to": neighbor["id"],
                    "weight": int(round(point_distance(start, end))),
                }
            )
            added += 1
            if added >= 3:
                break

    if not corridor_nodes:
        for index, node in enumerate(room_nodes):
            neighbors = sorted(
                room_nodes[:index] + room_nodes[index + 1 :],
                key=lambda other: point_distance(
                    (node["x"], node["y"]),
                    (other["x"], other["y"]),
                ),
            )[:3]
            for neighbor in neighbors:
                start = (node["x"], node["y"])
                end = (neighbor["x"], neighbor["y"])
                if not clear_of_walls(wall_mask, start, end):
                    continue
                key = tuple(sorted((node["id"], neighbor["id"])))
                if key in edge_keys:
                    continue
                edge_keys.add(key)
                edges.append(
                    {
                        "id": make_uuid(),
                        "from": node["id"],
                        "to": neighbor["id"],
                        "weight": int(round(point_distance(start, end))),
                    }
                )

    return nodes, edges


def detect_navigation_graph(rooms: List[Dict], interior_mask: np.ndarray, wall_mask: np.ndarray) -> Tuple[List[Dict], List[Dict]]:
    room_nodes = [
        {
            "id": make_uuid(),
            "x": int(room["center"]["x"]),
            "y": int(room["center"]["y"]),
            "type": "room",
            "roomId": room["id"],
        }
        for room in rooms
    ]

    corridor_mask = np.zeros_like(interior_mask)
    for room in rooms:
        if is_corridor_room(room):
            corridor_mask = cv2.bitwise_or(
                corridor_mask,
                polygon_mask(interior_mask.shape, room["polygon"]),
            )

    if cv2.countNonZero(corridor_mask) == 0:
        corridor_mask = cv2.morphologyEx(
            interior_mask,
            cv2.MORPH_OPEN,
            np.ones((7, 7), np.uint8),
            iterations=1,
        )

    return corridor_graph_nodes(corridor_mask, wall_mask, room_nodes)


def detect_objects(rooms: List[Dict], doors: List[Dict], region_labels: np.ndarray) -> List[Dict]:
    objects: List[Dict] = []

    for door in doors:
        label_a, label_b = sample_labels_around_point(
            region_labels,
            int(door["x"]),
            int(door["y"]),
            "vertical" if door["rotation"] == 90 else "horizontal",
        )
        if bool(label_a) != bool(label_b):
            objects.append(
                {
                    "id": make_uuid(),
                    "type": "exit",
                    "x": int(door["x"]),
                    "y": int(door["y"]),
                    "label": "Exit",
                }
            )

    for room in rooms:
        area = room.get("_area", room["width"] * room["height"])
        ratio = max(room["width"] / max(room["height"], 1), room["height"] / max(room["width"], 1))

        if 2500 <= area <= 15000 and ratio <= 1.4:
            objects.append(
                {
                    "id": make_uuid(),
                    "type": "elevator",
                    "x": int(room["center"]["x"]),
                    "y": int(room["center"]["y"]),
                    "label": "Elevator",
                }
            )
        elif area >= 18000 and ratio <= 1.6:
            objects.append(
                {
                    "id": make_uuid(),
                    "type": "stairs",
                    "x": int(room["center"]["x"]),
                    "y": int(room["center"]["y"]),
                    "label": "Stairs",
                }
            )

    deduped: List[Dict] = []
    for entry in objects:
        if any(
            entry["type"] == current["type"]
            and point_distance((entry["x"], entry["y"]), (current["x"], current["y"])) < 22
            for current in deduped
        ):
            continue
        deduped.append(entry)

    return deduped


def trace_floor_plan(content: bytes, filename: str, raw_options: str = "{}") -> Dict:
    options = parse_options(raw_options)
    image = load_image_from_bytes(content, filename)
    preprocessed = preprocess(image)
    processed = preprocessed["processed"]
    wall_mask = preprocessed["wall_mask"]
    interior_mask = interior_space_mask(wall_mask)

    walls, raw_lines = detect_walls(processed, wall_mask)
    rooms = detect_rooms(interior_mask)
    region_labels = build_region_labels(interior_mask)

    doors = detect_doors(processed, wall_mask, walls, region_labels)
    windows = detect_windows(raw_lines, walls, region_labels)
    nodes, edges = detect_navigation_graph(rooms, interior_mask, wall_mask)
    objects = detect_objects(rooms, doors, region_labels)

    if options.get("walls") is False:
        walls = []
    if options.get("doors") is False:
        doors = []
    if options.get("windows") is False:
        windows = []
    if options.get("connections") is False:
        nodes = []
        edges = []
    if options.get("objects") is False:
        objects = []

    for room in rooms:
        room.pop("_area", None)

    return {
        "walls": walls,
        "doors": doors,
        "windows": windows,
        "rooms": rooms,
        "nodes": nodes,
        "edges": edges,
        "objects": objects,
    }
