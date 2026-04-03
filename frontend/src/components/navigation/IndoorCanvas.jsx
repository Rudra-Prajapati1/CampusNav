// CampusNav update — IndoorCanvas.jsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Layers, LocateFixed, Navigation, ZoomIn, ZoomOut } from "lucide-react";
import {
  buildCanonicalIndoorMap,
  getIndoorOverlayBounds,
} from "./indoorMapModel.js";
import { buildLeafletProjectionBridge } from "./adapters/leafletAdapter.js";

const MIN_ZOOM = 0.28;
const MAX_ZOOM = 7;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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
  if (Array.isArray(room?.polygon_points) && room.polygon_points.length >= 3) {
    return room.polygon_points;
  }

  return [
    { x: room.x, y: room.y },
    { x: room.x + room.width, y: room.y },
    { x: room.x + room.width, y: room.y + room.height },
    { x: room.x, y: room.y + room.height },
  ];
}

function drawPolygonPath(ctx, points = []) {
  if (!points.length) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
  ctx.closePath();
}

function getRoomBounds(room) {
  if (Array.isArray(room?.polygon_points) && room.polygon_points.length > 0) {
    const xs = room.polygon_points.map((point) => point.x);
    const ys = room.polygon_points.map((point) => point.y);
    return {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    };
  }

  return {
    minX: room.x,
    minY: room.y,
    maxX: room.x + room.width,
    maxY: room.y + room.height,
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

function getFloorBounds(floorData) {
  let bounds = null;

  if (floorData?.floor_plan_width && floorData?.floor_plan_height) {
    bounds = {
      minX: 0,
      minY: 0,
      maxX: floorData.floor_plan_width,
      maxY: floorData.floor_plan_height,
    };
  }

  (floorData?.rooms || []).forEach((room) => {
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

function drawRoom(ctx, room, colors, routeState, showLabels = true) {
  const roomBounds = getRoomBounds(room);
  const width = roomBounds.maxX - roomBounds.minX;
  const height = roomBounds.maxY - roomBounds.minY;
  const labelX = roomBounds.minX + width / 2;
  const labelY = roomBounds.minY + height / 2;

  if (Array.isArray(room.polygon_points) && room.polygon_points.length > 0) {
    drawPolygonPath(ctx, room.polygon_points);
  } else {
    ctx.beginPath();
    ctx.roundRect(room.x, room.y, room.width, room.height, 14);
  }

  const fill = routeState ? colors.roomSelectedFill : room.color || colors.roomFill;
  const stroke = routeState ? colors.roomSelectedStroke : colors.roomStroke;

  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = routeState ? 2 : 1.5;
  ctx.stroke();

  if (showLabels && width > 64 && height > 28) {
    ctx.fillStyle = colors.label;
    ctx.font = "600 12px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(room.name, labelX, labelY);
  }
}

function drawRoom3D(ctx, room, colors, routeState, showLabels = true, extrusion = 10) {
  const topPolygon = getRoomPolygon(room);
  const offsetPolygon = topPolygon.map((point) => ({
    x: point.x + extrusion,
    y: point.y - extrusion,
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
      ctx.font = "600 12px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        room.name,
        roomBounds.minX + width / 2 + extrusion * 0.5,
        roomBounds.minY + height / 2 - extrusion * 0.5,
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
    if (Array.isArray(room.polygon_points) && room.polygon_points.length > 2) {
      return pointInPolygon(point, room.polygon_points);
    }
    return (
      point.x >= room.x &&
      point.x <= room.x + room.width &&
      point.y >= room.y &&
      point.y <= room.y + room.height
    );
  });
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
  const floorBounds = useMemo(() => getFloorBounds(floorData), [floorData]);
  const resolvedOverlayBounds = overlayBounds || getIndoorOverlayBounds(floorData);
  const mapElements = indoorMap.raw.elements;
  const projectionBridge = useMemo(() => {
    if (mapAdapter) return mapAdapter;
    return buildLeafletProjectionBridge(mapInstance);
  }, [mapAdapter, mapInstance]);
  const overlayMode =
    Boolean(projectionBridge) &&
    Boolean(resolvedOverlayBounds) &&
    Object.values(resolvedOverlayBounds || {}).every((value) => Number.isFinite(value));
  const is3D = viewMode === "3d";

  useEffect(() => {
    if (overlayMode) return undefined;
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
  }, [overlayMode]);

  useEffect(() => {
    if (!overlayMode || !projectionBridge || !resolvedOverlayBounds) return undefined;

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
  }, [overlayMode, projectionBridge, resolvedOverlayBounds]);

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

    const width = overlayMode ? geoFrame.width : viewport.width;
    const height = overlayMode ? geoFrame.height : viewport.height;
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

    drawUserDot(ctx, sensorPosition, colors);

    mapElements
      .filter((element) => element.kind === "door")
      .forEach((door) => {
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
    indoorMap.beacons,
    indoorMap.metadata.pixelsPerMeter,
    isDark,
    is3D,
    mapElements,
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
    if (!interactive || !onRoomPick || !indoorMap.rooms.length) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;

    let worldPoint;
    if (overlayMode) {
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

    const room = findRoomAtPoint(indoorMap.rooms, worldPoint);
    if (room) onRoomPick(room);
  };

  const containerStyle = overlayMode
    ? {
        left: geoFrame.left,
        top: geoFrame.top,
        width: geoFrame.width,
        height: geoFrame.height,
        pointerEvents: interactive ? "auto" : "none",
        ...style,
      }
    : style;

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
