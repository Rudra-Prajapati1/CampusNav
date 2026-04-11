// CampusNav update — IndoorCanvas.jsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Layers, LocateFixed, Navigation, ZoomIn, ZoomOut } from "lucide-react";
import {
  buildCanonicalIndoorMap,
  getIndoorOverlayBounds,
} from "./indoorMapModel.js";
import { buildLeafletProjectionBridge } from "./adapters/leafletAdapter.js";
import IndoorThreeScene from "./IndoorThreeScene.jsx";

const MIN_ZOOM = 0.28;
const MAX_ZOOM = 7;
const toRadians = (degrees) => (Number(degrees || 0) * Math.PI) / 180;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rotatePoint(point, center, degrees = 0) {
  const radians = toRadians(degrees);
  if (Math.abs(radians) < 0.0001) return { ...point };

  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - center.x;
  const dy = point.y - center.y;

  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

function pointInPolygon(point, polygon = []) {
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const current = polygon[i];
    const previous = polygon[j];

    if (
      current.y > point.y !== previous.y > point.y &&
      point.x <
        ((previous.x - current.x) * (point.y - current.y)) /
          (previous.y - current.y) +
          current.x
    ) {
      inside = !inside;
    }
  }

  return inside;
}

function getThemeColors(isDark, overlayMode) {
  return {
    canvas: isDark ? "#0B0F1A" : "#F8F9FA",
    roomFill: overlayMode
      ? isDark
        ? "rgba(19, 25, 41, 0.72)"
        : "rgba(255, 255, 255, 0.75)"
      : isDark
        ? "#1E3A5F"
        : "#EFF6FF",
    roomStroke: isDark ? "#60A5FA" : "#2563EB",
    roomSelectedFill: overlayMode
      ? isDark
        ? "rgba(37, 99, 235, 0.45)"
        : "rgba(219, 234, 254, 0.92)"
      : isDark
        ? "#1D4ED8"
        : "#DBEAFE",
    roomSelectedStroke: isDark ? "#93C5FD" : "#1D4ED8",
    label: isDark ? "#F1F5F9" : "#0F172A",
    route: isDark ? "#60A5FA" : "#2563EB",
    waypoint: isDark ? "#60A5FA" : "#2563EB",
    waypointStroke: isDark ? "#0B0F1A" : "#FFFFFF",
    door: "#D97706",
    beacon: isDark ? "#F59E0B" : "#B45309",
    beaconRing: isDark ? "rgba(245, 158, 11, 0.18)" : "rgba(245, 158, 11, 0.14)",
    userDot: "#0EA5E9",
    shadow: isDark ? "rgba(15, 23, 42, 0.5)" : "rgba(15, 23, 42, 0.18)",
  };
}

function getRoomPolygon(room) {
  const basePolygon = (() => {
  if (Array.isArray(room?.polygon_points) && room.polygon_points.length >= 3) {
    return room.polygon_points;
  }

  if (room?.shapePreset === "diamond") {
    return [
      { x: room.x + room.width / 2, y: room.y },
      { x: room.x + room.width, y: room.y + room.height / 2 },
      { x: room.x + room.width / 2, y: room.y + room.height },
      { x: room.x, y: room.y + room.height / 2 },
    ];
  }

  if (room?.shapePreset === "hex") {
    const inset = room.width * 0.16;
    return [
      { x: room.x + inset, y: room.y },
      { x: room.x + room.width - inset, y: room.y },
      { x: room.x + room.width, y: room.y + room.height / 2 },
      { x: room.x + room.width - inset, y: room.y + room.height },
      { x: room.x + inset, y: room.y + room.height },
      { x: room.x, y: room.y + room.height / 2 },
    ];
  }

  return [
    { x: room.x, y: room.y },
    { x: room.x + room.width, y: room.y },
    { x: room.x + room.width, y: room.y + room.height },
    { x: room.x, y: room.y + room.height },
  ];
  })();

  const rotation = Number(room?.rotation || 0);
  if (!rotation) return basePolygon;
  const center = {
    x: room.x + room.width / 2,
    y: room.y + room.height / 2,
  };
  return basePolygon.map((point) => rotatePoint(point, center, rotation));
}

function roomIconSymbol(room) {
  const iconPreset = room.iconPreset || "auto";
  const symbolMap = {
    stairs: "⇅",
    elevator: "⇳",
    restroom: "WC",
    food: "☕",
    parking: "P",
    exit: "EXIT",
    office: "OF",
    info: "i",
  };

  if (symbolMap[iconPreset]) return symbolMap[iconPreset];
  return room.name
    ? room.name
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0])
        .join("")
        .toUpperCase()
    : "";
}

function drawPolygonPath(ctx, points = []) {
  if (!points.length) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
  ctx.closePath();
}

function getRoomBounds(room) {
  const points = getRoomPolygon(room);
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

function mergeBounds(current, next) {
  if (!next) return current;
  if (!current) return { ...next };

  return {
    minX: Math.min(current.minX, next.minX),
    minY: Math.min(current.minY, next.minY),
    maxX: Math.max(current.maxX, next.maxX),
    maxY: Math.max(current.maxY, next.maxY),
  };
}

function getFloorBounds(floorData, rooms = []) {
  let bounds = null;

  if (floorData?.floor_plan_width && floorData?.floor_plan_height) {
    bounds = {
      minX: 0,
      minY: 0,
      maxX: floorData.floor_plan_width,
      maxY: floorData.floor_plan_height,
    };
  }

  rooms.forEach((room) => {
    bounds = mergeBounds(bounds, getRoomBounds(room));
  });

  return (
    bounds || {
      minX: 0,
      minY: 0,
      maxX: 1200,
      maxY: 800,
    }
  );
}

function getPathBounds(points) {
  if (!points?.length) return null;
  return points.reduce(
    (bounds, point) => ({
      minX: Math.min(bounds.minX, point.x),
      minY: Math.min(bounds.minY, point.y),
      maxX: Math.max(bounds.maxX, point.x),
      maxY: Math.max(bounds.maxY, point.y),
    }),
    {
      minX: points[0].x,
      minY: points[0].y,
      maxX: points[0].x,
      maxY: points[0].y,
    },
  );
}

function fitTransform(bounds, viewport, padding = 56) {
  if (!bounds || !viewport.width || !viewport.height) {
    return { x: 0, y: 0, zoom: 1 };
  }

  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const usableWidth = Math.max(1, viewport.width - padding * 2);
  const usableHeight = Math.max(1, viewport.height - padding * 2);
  const zoom = clamp(
    Math.min(usableWidth / width, usableHeight / height),
    MIN_ZOOM,
    MAX_ZOOM,
  );

  return {
    zoom,
    x: viewport.width / 2 - ((bounds.minX + bounds.maxX) / 2) * zoom,
    y: viewport.height / 2 - ((bounds.minY + bounds.maxY) / 2) * zoom,
  };
}

function solveLinear3(matrix, vector) {
  const augmented = matrix.map((row, index) => [...row, vector[index]]);

  for (let pivot = 0; pivot < 3; pivot += 1) {
    let maxRow = pivot;
    for (let row = pivot + 1; row < 3; row += 1) {
      if (Math.abs(augmented[row][pivot]) > Math.abs(augmented[maxRow][pivot])) {
        maxRow = row;
      }
    }

    if (Math.abs(augmented[maxRow][pivot]) < 1e-10) return null;

    if (maxRow !== pivot) {
      [augmented[pivot], augmented[maxRow]] = [augmented[maxRow], augmented[pivot]];
    }

    const divisor = augmented[pivot][pivot];
    for (let col = pivot; col < 4; col += 1) {
      augmented[pivot][col] /= divisor;
    }

    for (let row = 0; row < 3; row += 1) {
      if (row === pivot) continue;
      const factor = augmented[row][pivot];
      for (let col = pivot; col < 4; col += 1) {
        augmented[row][col] -= factor * augmented[pivot][col];
      }
    }
  }

  return augmented.map((row) => row[3]);
}

function orderedOverlayCorners(corners = []) {
  const byId = new Map(corners.map((corner) => [corner.id, corner]));
  const ordered = ["nw", "ne", "se", "sw"]
    .map((id) => byId.get(id))
    .filter(Boolean);
  return ordered.length === 4 ? ordered : corners.slice(0, 4);
}

function solveAffineTransform(sourcePoints, targetPoints) {
  if (sourcePoints.length < 3 || targetPoints.length < 3) return null;

  const matrix = sourcePoints.slice(0, 3).map((point) => [point.x, point.y, 1]);
  const solveX = solveLinear3(matrix, targetPoints.slice(0, 3).map((point) => point.x));
  const solveY = solveLinear3(matrix, targetPoints.slice(0, 3).map((point) => point.y));

  if (!solveX || !solveY) return null;

  return {
    a: solveX[0],
    b: solveY[0],
    c: solveX[1],
    d: solveY[1],
    e: solveX[2],
    f: solveY[2],
  };
}

function invertAffineTransform(transform) {
  if (!transform) return null;
  const determinant = transform.a * transform.d - transform.b * transform.c;
  if (Math.abs(determinant) < 1e-10) return null;

  return {
    a: transform.d / determinant,
    b: -transform.b / determinant,
    c: -transform.c / determinant,
    d: transform.a / determinant,
    e: (transform.c * transform.f - transform.d * transform.e) / determinant,
    f: (transform.b * transform.e - transform.a * transform.f) / determinant,
  };
}

function applyAffineTransform(transform, point) {
  if (!transform) return point;
  return {
    x: transform.a * point.x + transform.c * point.y + transform.e,
    y: transform.b * point.x + transform.d * point.y + transform.f,
  };
}

function drawRoom(ctx, room, colors, routeState, showLabels = true) {
  const roomBounds = getRoomBounds(room);
  const width = roomBounds.maxX - roomBounds.minX;
  const height = roomBounds.maxY - roomBounds.minY;
  const labelX = roomBounds.minX + width / 2;
  const labelY = roomBounds.minY + height / 2;

  drawPolygonPath(ctx, getRoomPolygon(room));

  const fill = routeState ? colors.roomSelectedFill : room.color || colors.roomFill;
  const stroke = routeState ? colors.roomSelectedStroke : colors.roomStroke;

  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = routeState ? 2 : 1.5;
  ctx.stroke();

  if (showLabels && width > 64 && height > 28) {
    ctx.fillStyle = colors.label;
    ctx.font = "700 12px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(roomIconSymbol(room), labelX, labelY - 10);
    ctx.font = "600 12px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(room.name, labelX, labelY + 12);
  }
}

function doorVectors(room, edge = "right") {
  const rotation = Number(room.rotation || 0);
  const tangentBase =
    edge === "left" || edge === "right"
      ? { x: 0, y: 1 }
      : { x: 1, y: 0 };
  const normalBase =
    edge === "left"
      ? { x: -1, y: 0 }
      : edge === "right"
        ? { x: 1, y: 0 }
        : edge === "top"
          ? { x: 0, y: -1 }
          : { x: 0, y: 1 };

  return {
    tangent: rotatePoint(tangentBase, { x: 0, y: 0 }, rotation),
    normal: rotatePoint(normalBase, { x: 0, y: 0 }, rotation),
  };
}

function drawDoorOpening(ctx, room, door, colors, is3D = false, extrusion = 0) {
  const half = Math.max(9, ((door.widthMeters || 1.1) * 22) / 2);
  const center = { x: door.x, y: door.y };
  const { tangent, normal } = doorVectors(room, door.edge);
  const depthX = is3D ? extrusion * 0.9 : 0;
  const depthY = is3D ? -extrusion * 0.55 : 0;
  const start = {
    x: center.x - tangent.x * half + depthX,
    y: center.y - tangent.y * half + depthY,
  };
  const end = {
    x: center.x + tangent.x * half + depthX,
    y: center.y + tangent.y * half + depthY,
  };

  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = colors.canvas;
  ctx.lineWidth = is3D ? 10 : 8;
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();

  ctx.strokeStyle = colors.door;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(center.x + depthX + normal.x * 2, center.y + depthY + normal.y * 2);
  ctx.lineTo(center.x + depthX + normal.x * 10, center.y + depthY + normal.y * 10);
  ctx.stroke();
  ctx.restore();
}

function drawRoom3D(ctx, room, colors, routeState, showLabels = true, extrusion = 10) {
  const topPolygon = getRoomPolygon(room);
  const offsetPolygon = topPolygon.map((point) => ({
    x: point.x + extrusion * 1.2,
    y: point.y - extrusion * 0.7,
  }));
  const fill = routeState ? colors.roomSelectedFill : room.color || colors.roomFill;
  const stroke = routeState ? colors.roomSelectedStroke : colors.roomStroke;

  ctx.save();

  for (let index = topPolygon.length - 1; index >= 0; index -= 1) {
    const current = topPolygon[index];
    const next = topPolygon[(index + 1) % topPolygon.length];
    const currentTop = offsetPolygon[index];
    const nextTop = offsetPolygon[(index + 1) % topPolygon.length];

    ctx.beginPath();
    ctx.moveTo(current.x, current.y);
    ctx.lineTo(next.x, next.y);
    ctx.lineTo(nextTop.x, nextTop.y);
    ctx.lineTo(currentTop.x, currentTop.y);
    ctx.closePath();
    ctx.fillStyle = colors.shadow;
    ctx.fill();
  }

  drawPolygonPath(ctx, offsetPolygon);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = routeState ? 2 : 1.5;
  ctx.stroke();

  if (showLabels) {
    const roomBounds = getRoomBounds(room);
    const width = roomBounds.maxX - roomBounds.minX;
    const height = roomBounds.maxY - roomBounds.minY;

    if (width > 64 && height > 28) {
      ctx.fillStyle = colors.label;
      ctx.font = "700 12px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        roomIconSymbol(room),
        roomBounds.minX + width / 2 + extrusion * 0.5,
        roomBounds.minY + height / 2 - extrusion * 0.5 - 10,
      );
      ctx.font = "600 12px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        room.name,
        roomBounds.minX + width / 2 + extrusion * 0.5,
        roomBounds.minY + height / 2 - extrusion * 0.5 + 12,
      );
    }
  }

  ctx.restore();
}

function drawBeacon(ctx, beacon, colors, pixelsPerMeter) {
  const radiusPx = Math.max(18, (beacon.radiusMeters || 2.5) * (pixelsPerMeter || 14));

  ctx.beginPath();
  ctx.arc(beacon.x, beacon.y, radiusPx, 0, Math.PI * 2);
  ctx.fillStyle = colors.beaconRing;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(beacon.x, beacon.y, 7, 0, Math.PI * 2);
  ctx.fillStyle = colors.beacon;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = colors.waypointStroke;
  ctx.stroke();
}

function drawUserDot(ctx, position, colors) {
  if (!position) return;

  ctx.beginPath();
  ctx.arc(position.x, position.y, 14, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(14, 165, 233, 0.18)";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(position.x, position.y, 7, 0, Math.PI * 2);
  ctx.fillStyle = colors.userDot;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
}

function findRoomAtPoint(rooms, point) {
  return rooms.find((room) => {
    return pointInPolygon(point, getRoomPolygon(room));
  });
}

function findObjectAtPoint(objects, point) {
  return (objects || []).find(
    (entry) => Math.hypot((entry.x || 0) - point.x, (entry.y || 0) - point.y) <= 16,
  );
}

export default function IndoorCanvas({
  floorData,
  floorImage,
  pathPoints,
  fromRoom,
  toRoom,
  currentFloorId,
  isDark,
  mapInstance = null,
  mapAdapter = null,
  overlayBounds = null,
  overlayCorners = null,
  interactive = false,
  onRoomPick,
  viewMode = "2d",
  sensorPosition = null,
  showBeacons = true,
  className = "",
  style,
}) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const activePointersRef = useRef(new Map());
  const gestureRef = useRef(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [transform, setTransform] = useState({ x: 0, y: 0, zoom: 1 });
  const [pathOffset, setPathOffset] = useState(0);
  const [geoFrame, setGeoFrame] = useState({ left: 0, top: 0, width: 0, height: 0 });

  const indoorMap = useMemo(() => buildCanonicalIndoorMap(floorData), [floorData]);
  const floorBounds = useMemo(() => getFloorBounds(floorData, indoorMap.rooms), [floorData, indoorMap.rooms]);
  const resolvedOverlayBounds = overlayBounds || getIndoorOverlayBounds(floorData);
  const resolvedOverlayCorners = useMemo(
    () => orderedOverlayCorners(overlayCorners || indoorMap.floor.corners || []),
    [indoorMap.floor.corners, overlayCorners],
  );
  const mapElements = indoorMap.raw.elements;
  const projectionBridge = useMemo(() => {
    if (mapAdapter) return mapAdapter;
    return buildLeafletProjectionBridge(mapInstance);
  }, [mapAdapter, mapInstance]);
  const overlayMode =
    Boolean(projectionBridge) &&
    (
      resolvedOverlayCorners.length >= 4 ||
      (
        Boolean(resolvedOverlayBounds) &&
        Object.values(resolvedOverlayBounds || {}).every((value) => Number.isFinite(value))
      )
    );
  const is3D = viewMode !== "2d";

  useEffect(() => {
    if (!containerRef.current) return undefined;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setViewport({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const overlayAffine = useMemo(() => {
    if (!projectionBridge || resolvedOverlayCorners.length < 4) return null;

    const projected = resolvedOverlayCorners.map((corner) =>
      projectionBridge.latLngToContainerPoint([corner.lat, corner.lng]),
    );

    return solveAffineTransform(
      [
        { x: floorBounds.minX, y: floorBounds.minY },
        { x: floorBounds.maxX, y: floorBounds.minY },
        { x: floorBounds.minX, y: floorBounds.maxY },
      ],
      [
        projected[0],
        projected[1],
        projected[3],
      ],
    );
  }, [floorBounds.maxX, floorBounds.maxY, floorBounds.minX, floorBounds.minY, projectionBridge, resolvedOverlayCorners]);

  const inverseOverlayAffine = useMemo(
    () => invertAffineTransform(overlayAffine),
    [overlayAffine],
  );

  useEffect(() => {
    if (!overlayMode || !projectionBridge || !resolvedOverlayBounds || overlayAffine) return undefined;

    const updateFrame = () => {
      const northWest = projectionBridge.latLngToContainerPoint([
        resolvedOverlayBounds.north,
        resolvedOverlayBounds.west,
      ]);
      const southEast = projectionBridge.latLngToContainerPoint([
        resolvedOverlayBounds.south,
        resolvedOverlayBounds.east,
      ]);

      setGeoFrame({
        left: northWest.x,
        top: northWest.y,
        width: southEast.x - northWest.x,
        height: southEast.y - northWest.y,
      });
    };

    updateFrame();
    return projectionBridge.subscribeViewportChange(updateFrame);
  }, [overlayAffine, overlayMode, projectionBridge, resolvedOverlayBounds]);

  const fitView = useCallback(
    (focusRoute = true) => {
      const routeBounds = getPathBounds(pathPoints);
      const fromRoomBounds =
        fromRoom?.floor_id === currentFloorId ? getRoomBounds(fromRoom) : null;
      const toRoomBounds = toRoom?.floor_id === currentFloorId ? getRoomBounds(toRoom) : null;

      let targetBounds = focusRoute ? routeBounds : null;
      targetBounds = mergeBounds(targetBounds, fromRoomBounds);
      targetBounds = mergeBounds(targetBounds, toRoomBounds);
      targetBounds = targetBounds
        ? {
            minX: targetBounds.minX - 80,
            minY: targetBounds.minY - 80,
            maxX: targetBounds.maxX + 80,
            maxY: targetBounds.maxY + 80,
          }
        : floorBounds;

      setTransform(fitTransform(targetBounds || floorBounds, viewport));
    },
    [currentFloorId, floorBounds, fromRoom, pathPoints, toRoom, viewport],
  );

  useEffect(() => {
    if (overlayMode) return;
    fitView(Boolean(pathPoints?.length));
  }, [fitView, overlayMode, floorData, floorImage, pathPoints]);

  useEffect(() => {
    if (!pathPoints?.length) return undefined;

    let animationFrame = null;
    const tick = () => {
      setPathOffset((current) => (current + 0.8) % 20);
      animationFrame = requestAnimationFrame(tick);
    };

    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [pathPoints]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !floorData) return;

    const width = overlayMode
      ? overlayAffine
        ? viewport.width
        : geoFrame.width
      : viewport.width;
    const height = overlayMode
      ? overlayAffine
        ? viewport.height
        : geoFrame.height
      : viewport.height;
    if (!width || !height) return;

    const colors = getThemeColors(isDark, overlayMode);
    const ratio = window.devicePixelRatio || 1;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (!overlayMode) {
      ctx.fillStyle = colors.canvas;
      ctx.fillRect(0, 0, width, height);
      ctx.save();
      ctx.translate(transform.x, transform.y);
      ctx.scale(transform.zoom, transform.zoom);
    } else if (overlayAffine) {
      ctx.save();
      ctx.transform(
        overlayAffine.a,
        overlayAffine.b,
        overlayAffine.c,
        overlayAffine.d,
        overlayAffine.e,
        overlayAffine.f,
      );
    } else {
      const scaleX = width / Math.max(1, floorBounds.maxX - floorBounds.minX);
      const scaleY = height / Math.max(1, floorBounds.maxY - floorBounds.minY);
      ctx.save();
      ctx.translate(-floorBounds.minX * scaleX, -floorBounds.minY * scaleY);
      ctx.scale(scaleX, scaleY);
    }

    if (floorImage) {
      ctx.globalAlpha = overlayMode ? 0.18 : isDark ? 0.35 : 0.7;
      ctx.drawImage(
        floorImage,
        0,
        0,
        floorData.floor_plan_width || floorImage.width,
        floorData.floor_plan_height || floorImage.height,
      );
      ctx.globalAlpha = 1;
    }

    const pathRoomIds = new Set(
      (pathPoints || []).map((point) => point.room_id).filter(Boolean),
    );
    const roomsById = new Map(indoorMap.rooms.map((room) => [room.id, room]));

    indoorMap.walls?.forEach((wall) => {
      const offset = is3D ? { x: 6, y: -6 } : { x: 0, y: 0 };
      ctx.beginPath();
      ctx.moveTo(wall.x1 + offset.x, wall.y1 + offset.y);
      ctx.lineTo(wall.x2 + offset.x, wall.y2 + offset.y);
      ctx.strokeStyle = isDark ? "#64748B" : "#6B7280";
      ctx.lineWidth = wall.thickness || 6;
      ctx.lineCap = "round";
      ctx.stroke();
    });

    indoorMap.windows?.forEach((windowElement) => {
      const offset = is3D ? { x: 6, y: -6 } : { x: 0, y: 0 };
      ctx.beginPath();
      ctx.moveTo(
        windowElement.x - (windowElement.width || 28) / 2 + offset.x,
        windowElement.y + offset.y,
      );
      ctx.lineTo(
        windowElement.x + (windowElement.width || 28) / 2 + offset.x,
        windowElement.y + offset.y,
      );
      ctx.strokeStyle = "#06B6D4";
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.stroke();
    });

    indoorMap.rooms.forEach((room) => {
      let roomState = null;
      if (fromRoom?.id === room.id) roomState = "start";
      else if (toRoom?.id === room.id) roomState = "end";
      else if (pathRoomIds.has(room.id)) roomState = "route";

      if (is3D) {
        drawRoom3D(
          ctx,
          room,
          colors,
          roomState,
          indoorMap.metadata.showLabels,
          10,
        );
      } else {
        drawRoom(ctx, room, colors, roomState, indoorMap.metadata.showLabels);
      }

      indoorMap.doors
        .filter((door) => door.roomId === room.id)
        .forEach((door) => drawDoorOpening(ctx, room, door, colors, is3D, 10));
    });

    indoorMap.waypoints.forEach((waypoint) => {
      ctx.beginPath();
      ctx.arc(waypoint.x, waypoint.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = colors.waypoint;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = colors.waypointStroke;
      ctx.stroke();
    });

    if (pathPoints?.length > 0) {
      ctx.beginPath();
      const offset = is3D ? { x: 5, y: -5 } : { x: 0, y: 0 };
      ctx.moveTo(pathPoints[0].x + offset.x, pathPoints[0].y + offset.y);
      pathPoints
        .slice(1)
        .forEach((point) => ctx.lineTo(point.x + offset.x, point.y + offset.y));
      ctx.strokeStyle = colors.route;
      ctx.lineWidth = is3D ? 4 : 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.setLineDash([8, 4]);
      ctx.lineDashOffset = -pathOffset;
      ctx.stroke();
      ctx.setLineDash([]);

      pathPoints.forEach((point) => {
        ctx.beginPath();
        ctx.arc(point.x + offset.x, point.y + offset.y, 8, 0, Math.PI * 2);
        ctx.fillStyle = colors.route;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = colors.waypointStroke;
        ctx.stroke();
      });
    }

    if (showBeacons) {
      indoorMap.beacons.forEach((beacon) => {
        drawBeacon(ctx, beacon, colors, indoorMap.metadata.pixelsPerMeter);
      });
    }

    indoorMap.objects?.forEach((objectElement) => {
      ctx.beginPath();
      ctx.arc(objectElement.x, objectElement.y, 12, 0, Math.PI * 2);
      ctx.fillStyle =
        objectElement.objectType === "exit" ? "#16A34A" : colors.route;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = colors.waypointStroke;
      ctx.stroke();
      ctx.fillStyle = "#FFFFFF";
      ctx.font = "700 9px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        roomIconSymbol({
          name: objectElement.label || objectElement.name || "POI",
          iconPreset: objectElement.iconPreset || objectElement.objectType || "info",
        }),
        objectElement.x,
        objectElement.y,
      );
      if (indoorMap.metadata.showLabels) {
        ctx.fillStyle = colors.label;
        ctx.font = "600 10px Inter, sans-serif";
        ctx.fillText(
          objectElement.label || objectElement.name || "Object",
          objectElement.x,
          objectElement.y + 22,
        );
      }
    });

    drawUserDot(ctx, sensorPosition, colors);

    mapElements
      .filter((element) => element.kind === "door")
      .forEach((door) => {
        if (door.roomId && roomsById.has(door.roomId)) return;
        ctx.beginPath();
        ctx.arc(door.x, door.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = colors.door;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = colors.waypointStroke;
        ctx.stroke();
      });

    ctx.restore();
  }, [
    currentFloorId,
    floorBounds,
    floorData,
    floorImage,
    fromRoom,
    geoFrame,
    indoorMap.metadata.showLabels,
    indoorMap.rooms,
    indoorMap.waypoints,
    indoorMap.walls,
    indoorMap.windows,
    indoorMap.beacons,
    indoorMap.objects,
    indoorMap.metadata.pixelsPerMeter,
    isDark,
    is3D,
    mapElements,
    overlayAffine,
    overlayMode,
    pathOffset,
    pathPoints,
    sensorPosition,
    showBeacons,
    toRoom,
    transform,
    viewport,
  ]);

  const applyZoom = useCallback((factor, screenPoint) => {
    setTransform((current) => {
      const nextZoom = clamp(current.zoom * factor, MIN_ZOOM, MAX_ZOOM);
      const worldX = (screenPoint.x - current.x) / current.zoom;
      const worldY = (screenPoint.y - current.y) / current.zoom;

      return {
        zoom: nextZoom,
        x: screenPoint.x - worldX * nextZoom,
        y: screenPoint.y - worldY * nextZoom,
      };
    });
  }, []);

  useEffect(() => {
    if (overlayMode) return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const handleWheel = (event) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      applyZoom(event.deltaY > 0 ? 0.92 : 1.08, {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    };

    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [applyZoom, overlayMode]);

  const handleRoomPick = (event) => {
    if (!interactive || !onRoomPick || (!indoorMap.rooms.length && !indoorMap.objects.length)) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;

    let worldPoint;
    if (overlayMode && inverseOverlayAffine) {
      worldPoint = applyAffineTransform(inverseOverlayAffine, {
        x: localX,
        y: localY,
      });
    } else if (overlayMode) {
      const scaleX = (floorBounds.maxX - floorBounds.minX) / Math.max(rect.width, 1);
      const scaleY = (floorBounds.maxY - floorBounds.minY) / Math.max(rect.height, 1);
      worldPoint = {
        x: floorBounds.minX + localX * scaleX,
        y: floorBounds.minY + localY * scaleY,
      };
    } else {
      worldPoint = {
        x: (localX - transform.x) / transform.zoom,
        y: (localY - transform.y) / transform.zoom,
      };
    }

    const objectElement = findObjectAtPoint(indoorMap.objects, worldPoint);
    if (objectElement) {
      onRoomPick(objectElement);
      return;
    }

    const room = findRoomAtPoint(indoorMap.rooms, worldPoint);
    if (room) onRoomPick(room);
  };

  const containerStyle = overlayMode
    ? {
        left: overlayAffine ? 0 : geoFrame.left,
        top: overlayAffine ? 0 : geoFrame.top,
        width: overlayAffine ? "100%" : geoFrame.width,
        height: overlayAffine ? "100%" : geoFrame.height,
        pointerEvents: interactive ? "auto" : "none",
        ...style,
      }
    : style;

  const useThreeScene = viewMode !== "2d" && !interactive && !overlayMode;

  if (useThreeScene) {
    return (
      <div
        ref={containerRef}
        className={`${overlayMode ? "absolute z-[520]" : "relative h-full min-h-[360px]"} ${className}`}
        style={containerStyle}
      >
        <div className="relative h-full w-full overflow-hidden rounded-none">
          <IndoorThreeScene
            indoorMap={indoorMap}
            pathPoints={pathPoints}
            sensorPosition={sensorPosition}
            showBeacons={showBeacons}
            isDark={isDark}
            viewMode={viewMode === "3d" ? "3d" : "isometric"}
            className="h-full w-full"
          />
          {!overlayMode && (
            <div className="pointer-events-none absolute left-4 top-4 flex flex-wrap gap-2">
              <span className="badge-neutral">
                <Layers className="h-3.5 w-3.5" />
                {viewMode === "3d" ? "3D scene" : "2.5D isometric"}
              </span>
              {pathPoints?.length > 0 && (
                <span className="badge-neutral">
                  <Navigation className="h-3.5 w-3.5" />
                  Active route
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`${overlayMode ? "absolute z-[520]" : "relative h-full min-h-[360px]"} ${className}`}
      style={containerStyle}
    >
      <div className="relative h-full w-full">
        <canvas
          ref={canvasRef}
          className={`h-full w-full ${overlayMode ? "" : "touch-none"}`}
          onClick={handleRoomPick}
          onPointerDown={overlayMode ? undefined : (event) => {
            activePointersRef.current.set(event.pointerId, {
              x: event.clientX,
              y: event.clientY,
            });
            event.currentTarget.setPointerCapture?.(event.pointerId);

            if (activePointersRef.current.size === 1) {
              gestureRef.current = {
                type: "pan",
                origin: { x: event.clientX, y: event.clientY },
                transform,
              };
            } else if (activePointersRef.current.size === 2) {
              const [first, second] = [...activePointersRef.current.values()];
              gestureRef.current = {
                type: "pinch",
                transform,
                startDistance: Math.hypot(first.x - second.x, first.y - second.y),
                startMid: {
                  x: (first.x + second.x) / 2 - (containerRef.current?.getBoundingClientRect().left || 0),
                  y: (first.y + second.y) / 2 - (containerRef.current?.getBoundingClientRect().top || 0),
                },
              };
            }
          }}
          onPointerMove={overlayMode ? undefined : (event) => {
            if (!activePointersRef.current.has(event.pointerId)) return;

            activePointersRef.current.set(event.pointerId, {
              x: event.clientX,
              y: event.clientY,
            });

            const pointers = [...activePointersRef.current.values()];
            if (!gestureRef.current) return;

            if (pointers.length >= 2) {
              const rect = containerRef.current?.getBoundingClientRect();
              if (!rect) return;

              const [first, second] = pointers;
              const distance = Math.hypot(first.x - second.x, first.y - second.y);
              const mid = {
                x: (first.x + second.x) / 2 - rect.left,
                y: (first.y + second.y) / 2 - rect.top,
              };
              const factor = distance / Math.max(gestureRef.current.startDistance, 1);
              const nextZoom = clamp(
                gestureRef.current.transform.zoom * factor,
                MIN_ZOOM,
                MAX_ZOOM,
              );
              const worldX =
                (gestureRef.current.startMid.x - gestureRef.current.transform.x) /
                gestureRef.current.transform.zoom;
              const worldY =
                (gestureRef.current.startMid.y - gestureRef.current.transform.y) /
                gestureRef.current.transform.zoom;

              setTransform({
                zoom: nextZoom,
                x: mid.x - worldX * nextZoom,
                y: mid.y - worldY * nextZoom,
              });
              return;
            }

            const pointer = pointers[0];
            if (!pointer || gestureRef.current.type !== "pan") return;

            setTransform({
              ...gestureRef.current.transform,
              x: gestureRef.current.transform.x + pointer.x - gestureRef.current.origin.x,
              y: gestureRef.current.transform.y + pointer.y - gestureRef.current.origin.y,
            });
          }}
          onPointerUp={
            overlayMode
              ? undefined
              : (event) => {
                  activePointersRef.current.delete(event.pointerId);
                  const remaining = [...activePointersRef.current.values()];

                  if (remaining.length === 1) {
                    gestureRef.current = {
                      type: "pan",
                      origin: { x: remaining[0].x, y: remaining[0].y },
                      transform,
                    };
                  } else if (remaining.length < 1) {
                    gestureRef.current = null;
                  }
                }
          }
          onPointerCancel={
            overlayMode
              ? undefined
              : (event) => {
                  activePointersRef.current.delete(event.pointerId);
                  gestureRef.current = null;
                }
          }
        />

        {!overlayMode && (
          <>
            <div className="absolute left-4 top-4 flex flex-wrap gap-2">
              <span className="badge-neutral">
                <Layers className="h-3.5 w-3.5" />
                Indoor map
              </span>
              {pathPoints?.length > 0 && (
                <span className="badge-neutral">
                  <Navigation className="h-3.5 w-3.5" />
                  Active route
                </span>
              )}
            </div>

            <div className="absolute bottom-4 right-4 flex flex-col gap-2">
              <button
                onClick={() => applyZoom(1.15, { x: viewport.width - 60, y: viewport.height - 60 })}
                className="btn-secondary px-3"
              >
                <ZoomIn className="h-4 w-4" />
              </button>
              <button
                onClick={() => applyZoom(0.85, { x: viewport.width - 60, y: viewport.height - 60 })}
                className="btn-secondary px-3"
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              <button
                onClick={() => fitView(Boolean(pathPoints?.length))}
                className="btn-secondary px-3"
              >
                <LocateFixed className="h-4 w-4" />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
