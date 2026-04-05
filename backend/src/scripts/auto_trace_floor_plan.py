import json
import math
import sys
from collections import deque
from colorsys import rgb_to_hsv
from pathlib import Path

from PIL import Image, ImageFilter, ImageOps


def otsu_threshold(image):
    histogram = image.histogram()
    total = sum(histogram)
    sum_total = sum(index * count for index, count in enumerate(histogram))

    sum_background = 0
    weight_background = 0
    max_variance = 0
    threshold = 127

    for level in range(256):
      weight_background += histogram[level]
      if weight_background == 0:
        continue

      weight_foreground = total - weight_background
      if weight_foreground == 0:
        break

      sum_background += level * histogram[level]
      mean_background = sum_background / weight_background
      mean_foreground = (sum_total - sum_background) / weight_foreground
      variance = weight_background * weight_foreground * (mean_background - mean_foreground) ** 2

      if variance > max_variance:
        max_variance = variance
        threshold = level

    return threshold


def flood_outside(open_grid, width, height):
    queue = deque()
    outside = [[False for _ in range(width)] for _ in range(height)]

    def push(x, y):
        if x < 0 or y < 0 or x >= width or y >= height:
            return
        if outside[y][x] or not open_grid[y][x]:
            return
        outside[y][x] = True
        queue.append((x, y))

    for x in range(width):
        push(x, 0)
        push(x, height - 1)
    for y in range(height):
        push(0, y)
        push(width - 1, y)

    while queue:
        x, y = queue.popleft()
        push(x + 1, y)
        push(x - 1, y)
        push(x, y + 1)
        push(x, y - 1)

    return outside


def connected_components(mask_grid, width, height, outside=None):
    visited = [[False for _ in range(width)] for _ in range(height)]
    components = []

    for y in range(height):
        for x in range(width):
            if visited[y][x] or not mask_grid[y][x]:
                continue
            if outside and outside[y][x]:
                continue

            queue = deque([(x, y)])
            visited[y][x] = True
            min_x = max_x = x
            min_y = max_y = y
            area = 0

            while queue:
                px, py = queue.popleft()
                area += 1
                min_x = min(min_x, px)
                min_y = min(min_y, py)
                max_x = max(max_x, px)
                max_y = max(max_y, py)

                for nx, ny in ((px + 1, py), (px - 1, py), (px, py + 1), (px, py - 1)):
                    if nx < 0 or ny < 0 or nx >= width or ny >= height:
                        continue
                    if visited[ny][nx] or not mask_grid[ny][nx]:
                        continue
                    if outside and outside[ny][nx]:
                        continue
                    visited[ny][nx] = True
                    queue.append((nx, ny))

            components.append(
                {
                    "min_x": min_x,
                    "min_y": min_y,
                    "max_x": max_x,
                    "max_y": max_y,
                    "area": area,
                }
            )

    return components


def merge_boxes(boxes):
    merged = []

    for box in sorted(boxes, key=lambda entry: entry["area"], reverse=True):
        merged_into_existing = False
        for current in merged:
            overlap_x = max(
                0,
                min(box["max_x"], current["max_x"]) - max(box["min_x"], current["min_x"]),
            )
            overlap_y = max(
                0,
                min(box["max_y"], current["max_y"]) - max(box["min_y"], current["min_y"]),
            )
            overlap_area = overlap_x * overlap_y

            close_x = (
                min(abs(box["max_x"] - current["min_x"]), abs(current["max_x"] - box["min_x"])) <= 14
            )
            close_y = (
                min(abs(box["max_y"] - current["min_y"]), abs(current["max_y"] - box["min_y"])) <= 14
            )

            if overlap_area <= 0 and not (close_x and close_y):
                continue

            current_area = max(1, (current["max_x"] - current["min_x"]) * (current["max_y"] - current["min_y"]))
            box_area = max(1, (box["max_x"] - box["min_x"]) * (box["max_y"] - box["min_y"]))
            iou = overlap_area / float(current_area + box_area - overlap_area) if overlap_area > 0 else 0

            if iou > 0.22 or overlap_area / min(current_area, box_area) > 0.48 or (close_x and close_y):
                current["min_x"] = min(current["min_x"], box["min_x"])
                current["min_y"] = min(current["min_y"], box["min_y"])
                current["max_x"] = max(current["max_x"], box["max_x"])
                current["max_y"] = max(current["max_y"], box["max_y"])
                current["area"] = max(current["area"], box["area"])
                merged_into_existing = True
                break

        if not merged_into_existing:
            merged.append(dict(box))

    return merged


def classify_room(width, height, box_area, image_area, index):
    aspect = max(width, height) / max(1, min(width, height))
    density = box_area / max(1, image_area)

    if density > 0.09:
        return ("hall", "Main Hall")
    if aspect > 3.8:
        return ("hallway", f"Corridor {index}")
    if density > 0.03:
        return ("hall", f"Open Area {index}")
    return ("room", f"Room {index}")


def preprocess_grayscale(image):
    prepared = ImageOps.autocontrast(image.convert("L"))
    prepared = prepared.filter(ImageFilter.MedianFilter(size=3))
    return prepared


def detect_enclosed_space_boxes(image):
    grayscale = preprocess_grayscale(image)
    threshold = otsu_threshold(grayscale)
    wall_mask = grayscale.point(lambda value: 255 if value < threshold else 0, mode="L")
    wall_mask = wall_mask.filter(ImageFilter.MaxFilter(size=3))
    wall_mask = wall_mask.filter(ImageFilter.MaxFilter(size=3))

    width, height = wall_mask.size
    wall_pixels = wall_mask.load()
    open_grid = [
        [0 if wall_pixels[x, y] else 1 for x in range(width)]
        for y in range(height)
    ]

    outside = flood_outside(open_grid, width, height)
    components = connected_components(open_grid, width, height, outside=outside)
    return components, {"threshold": threshold, "mode": "enclosed-space"}


def build_color_region_mask(image):
    prepared = ImageOps.autocontrast(image.convert("RGB"))
    prepared = prepared.filter(ImageFilter.MedianFilter(size=3))
    width, height = prepared.size
    pixels = prepared.load()
    mask = Image.new("L", (width, height), 0)
    mask_pixels = mask.load()

    for y in range(height):
        for x in range(width):
            r, g, b = pixels[x, y]
            hue, saturation, value = rgb_to_hsv(r / 255.0, g / 255.0, b / 255.0)

            if value < 0.08:
                continue

            is_dark_wall = saturation < 0.08 and value < 0.55
            is_corridor_gray = saturation < 0.1 and 0.6 <= value <= 0.9
            is_bright_corridor = saturation < 0.08 and value > 0.92
            is_colored_region = saturation >= 0.12 and value > 0.18
            is_pale_room = saturation >= 0.05 and value > 0.82

            if is_dark_wall or is_corridor_gray or is_bright_corridor:
                continue

            if is_colored_region or is_pale_room:
                mask_pixels[x, y] = 255

    mask = mask.filter(ImageFilter.MaxFilter(size=3))
    mask = mask.filter(ImageFilter.MinFilter(size=3))
    return mask


def detect_color_region_boxes(image):
    mask = build_color_region_mask(image)
    width, height = mask.size
    pixels = mask.load()
    grid = [[1 if pixels[x, y] else 0 for x in range(width)] for y in range(height)]
    components = connected_components(grid, width, height)
    return components, {"mode": "color-region"}


def filter_boxes(components, width, height):
    min_component_area = max(320, int(width * height * 0.001))
    filtered = []

    for component in components:
        box_width = component["max_x"] - component["min_x"]
        box_height = component["max_y"] - component["min_y"]

        if component["area"] < min_component_area:
            continue
        if box_width < 18 or box_height < 18:
            continue
        if box_width > width * 0.94 and box_height > height * 0.94:
            continue

        filtered.append(component)

    return merge_boxes(filtered)


def boxes_to_rooms(boxes, scale_back, original_width, original_height):
    rooms = []
    image_area = original_width * original_height

    for index, box in enumerate(sorted(boxes, key=lambda entry: (entry["min_y"], entry["min_x"])), start=1):
        x = int(box["min_x"] * scale_back)
        y = int(box["min_y"] * scale_back)
        room_width = int((box["max_x"] - box["min_x"]) * scale_back)
        room_height = int((box["max_y"] - box["min_y"]) * scale_back)
        room_type, name = classify_room(room_width, room_height, room_width * room_height, image_area, index)

        rooms.append(
            {
                "x": x,
                "y": y,
                "width": room_width,
                "height": room_height,
                "roomType": room_type,
                "name": name,
                "confidence": round(min(0.95, 0.45 + math.log(max(2, box["area"])) / 18), 2),
            }
        )

    return rooms


def detect_rooms(image):
    original_width, original_height = image.size
    scale = min(1.0, 1400 / float(max(original_width, original_height)))
    scaled = image
    if scale < 1.0:
        scaled = image.resize(
            (max(1, int(original_width * scale)), max(1, int(original_height * scale))),
            Image.Resampling.LANCZOS,
        )

    width, height = scaled.size
    scale_back = 1.0 / scale if scale > 0 else 1.0

    enclosed_components, enclosed_summary = detect_enclosed_space_boxes(scaled)
    enclosed_boxes = filter_boxes(enclosed_components, width, height)
    if enclosed_boxes:
        return boxes_to_rooms(enclosed_boxes, scale_back, original_width, original_height), {
            **enclosed_summary,
            "count": len(enclosed_boxes),
            "scale": scale,
        }

    color_components, color_summary = detect_color_region_boxes(scaled)
    color_boxes = filter_boxes(color_components, width, height)
    return boxes_to_rooms(color_boxes, scale_back, original_width, original_height), {
        **color_summary,
        "count": len(color_boxes),
        "scale": scale,
    }


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Image path is required"}))
        sys.exit(1)

    image_path = Path(sys.argv[1])
    image = Image.open(image_path)
    rooms, summary = detect_rooms(image)

    print(
        json.dumps(
            {
                "rooms": rooms,
                "summary": summary,
                "warnings": [
                    "Auto trace creates an editable draft from enclosed spaces or colored map regions. Review labels, doors, stairs, and POIs before publishing."
                ],
            }
        )
    )


if __name__ == "__main__":
    main()
