import { useCallback, useEffect, useRef, useState } from "react";
import { Layers, LocateFixed, Navigation, ZoomIn, ZoomOut } from "lucide-react";

const ROOM_COLORS = {
  classroom: { fill: "rgba(15,110,253,0.15)", stroke: "#0f6efd" },
  lab: { fill: "rgba(14,165,233,0.16)", stroke: "#0284c7" },
  office: { fill: "rgba(16,185,129,0.16)", stroke: "#059669" },
  toilet: { fill: "rgba(100,116,139,0.16)", stroke: "#64748b" },
  stairs: { fill: "rgba(245,158,11,0.16)", stroke: "#d97706" },
  elevator: { fill: "rgba(168,85,247,0.16)", stroke: "#9333ea" },
  entrance: { fill: "rgba(239,68,68,0.16)", stroke: "#dc2626" },
  canteen: { fill: "rgba(249,115,22,0.16)", stroke: "#ea580c" },
  corridor: { fill: "rgba(148,163,184,0.14)", stroke: "#94a3b8" },
  other: { fill: "rgba(148,163,184,0.14)", stroke: "#64748b" },
};

const MIN_ZOOM = 0.28;
const MAX_ZOOM = 7;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getMapDataElements(floorData) {
  const floors = floorData?.map_data?.floors;
  if (!Array.isArray(floors) || floors.length === 0) return [];

  const matched =
    floors.find((entry) => entry.id === floorData.id) ||
    floors.find((entry) => entry.name === floorData.name) ||
    floors.find((entry) => entry.level === floorData.level) ||
    floors[0];

  return Array.isArray(matched?.elements) ? matched.elements : [];
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

  getMapDataElements(floorData).forEach((element) => {
    if (element?.type === "door" || element?.type === "waypoint") {
      bounds = mergeBounds(bounds, {
        minX: element.x - 10,
        minY: element.y - 10,
        maxX: element.x + 10,
        maxY: element.y + 10,
      });
    }
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

function fitTransform(bounds, viewport, padding = 52) {
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

function drawRoom(ctx, room, isDark, routeState) {
  const palette = ROOM_COLORS[room.type] || ROOM_COLORS.other;
  const roomBounds = getRoomBounds(room);
  const width = roomBounds.maxX - roomBounds.minX;
  const height = roomBounds.maxY - roomBounds.minY;
  const labelX = roomBounds.minX + width / 2;
  const labelY = roomBounds.minY + height / 2;

  ctx.beginPath();

  if (Array.isArray(room.polygon_points) && room.polygon_points.length > 0) {
    ctx.moveTo(room.polygon_points[0].x, room.polygon_points[0].y);
    room.polygon_points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
    ctx.closePath();
  } else {
    ctx.roundRect(room.x, room.y, room.width, room.height, 16);
  }

  let fill = room.color || palette.fill;
  let stroke = palette.stroke;
  let lineWidth = 1.5;

  if (routeState === "start") {
    fill = "rgba(16,185,129,0.18)";
    stroke = "#059669";
    lineWidth = 2.6;
  } else if (routeState === "end") {
    fill = "rgba(244,63,94,0.16)";
    stroke = "#e11d48";
    lineWidth = 2.6;
  } else if (routeState === "route") {
    fill = "rgba(15,110,253,0.13)";
    stroke = "#0f6efd";
    lineWidth = 2.1;
  }

  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.stroke();

  if (width > 72 && height > 28) {
    ctx.fillStyle = isDark ? "rgba(237,245,255,0.9)" : "rgba(17,32,49,0.82)";
    ctx.font = `600 ${Math.max(11, Math.min(15, width / 8))}px Manrope`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(room.name, labelX, labelY);
  }
}

export default function IndoorCanvas({
  floorData,
  floorImage,
  pathPoints,
  fromRoom,
  toRoom,
  currentFloorId,
  isDark,
}) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const activePointersRef = useRef(new Map());
  const gestureRef = useRef(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [transform, setTransform] = useState({ x: 0, y: 0, zoom: 1 });
  const [pathOffset, setPathOffset] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;

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

  const fitView = useCallback(
    (focusRoute = true) => {
      const floorBounds = getFloorBounds(floorData);
      const routeBounds = getPathBounds(pathPoints);
      const fromRoomBounds =
        fromRoom?.floor_id === currentFloorId ? getRoomBounds(fromRoom) : null;
      const toRoomBounds =
        toRoom?.floor_id === currentFloorId ? getRoomBounds(toRoom) : null;

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
    [currentFloorId, floorData, fromRoom, pathPoints, toRoom, viewport],
  );

  useEffect(() => {
    fitView(Boolean(pathPoints?.length));
  }, [fitView, floorData, floorImage, pathPoints]);

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
    if (!canvas || !viewport.width || !viewport.height || !floorData) return;

    const ratio = window.devicePixelRatio || 1;
    canvas.width = viewport.width * ratio;
    canvas.height = viewport.height * ratio;
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;

    const ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, viewport.width, viewport.height);
    ctx.fillStyle = isDark ? "#091421" : "#eef4fb";
    ctx.fillRect(0, 0, viewport.width, viewport.height);

    ctx.save();
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.zoom, transform.zoom);

    if (floorImage) {
      ctx.globalAlpha = isDark ? 0.42 : 0.7;
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

    (floorData.rooms || []).forEach((room) => {
      let roomState = null;

      if (fromRoom?.id === room.id) roomState = "start";
      else if (toRoom?.id === room.id) roomState = "end";
      else if (pathRoomIds.has(room.id)) roomState = "route";

      drawRoom(ctx, room, isDark, roomState);
    });

    if (pathPoints?.length > 0) {
      ctx.beginPath();
      ctx.moveTo(pathPoints[0].x, pathPoints[0].y);
      pathPoints.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
      ctx.strokeStyle = "#0f6efd";
      ctx.lineWidth = 5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.setLineDash([14, 8]);
      ctx.lineDashOffset = -pathOffset;
      ctx.shadowColor = "rgba(15,110,253,0.24)";
      ctx.shadowBlur = 20;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;

      pathPoints.forEach((point, index) => {
        const isStart = index === 0;
        const isEnd = index === pathPoints.length - 1;
        ctx.beginPath();
        ctx.arc(point.x, point.y, isStart || isEnd ? 7 : 5, 0, Math.PI * 2);
        ctx.fillStyle = isStart ? "#059669" : isEnd ? "#e11d48" : "#0f6efd";
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.stroke();
      });
    }

    ctx.restore();
  }, [
    floorData,
    floorImage,
    fromRoom,
    isDark,
    pathOffset,
    pathPoints,
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
  }, [applyZoom]);

  const handlePointerDown = (event) => {
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
  };

  const handlePointerMove = (event) => {
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

      if (gestureRef.current.type !== "pinch") {
        const [first, second] = pointers;
        gestureRef.current = {
          type: "pinch",
          transform,
          startDistance: Math.hypot(first.x - second.x, first.y - second.y),
          startMid: {
            x: (first.x + second.x) / 2 - rect.left,
            y: (first.y + second.y) / 2 - rect.top,
          },
        };
      }

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
  };

  const endPointer = (event) => {
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
  };

  return (
    <div className="relative h-full min-h-[360px] overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--surface-strong)]">
      <div ref={containerRef} className="relative h-full w-full">
        <canvas
          ref={canvasRef}
          className="h-full w-full touch-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          onPointerLeave={endPointer}
        />

        <div className="absolute left-4 top-4 flex flex-wrap gap-2">
          <span className="badge">
            <Layers className="h-3.5 w-3.5 text-brand-500" />
            Indoor map
          </span>
          {pathPoints?.length > 0 && (
            <span className="badge">
              <Navigation className="h-3.5 w-3.5 text-brand-500" />
              Route fit active
            </span>
          )}
        </div>

        <div className="absolute bottom-4 right-4 flex flex-col gap-2">
          <button
            onClick={() => applyZoom(1.15, { x: viewport.width - 60, y: viewport.height - 60 })}
            className="btn-secondary h-11 w-11 rounded-full p-0"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            onClick={() => applyZoom(0.85, { x: viewport.width - 60, y: viewport.height - 60 })}
            className="btn-secondary h-11 w-11 rounded-full p-0"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <button
            onClick={() => fitView(Boolean(pathPoints?.length))}
            className="btn-secondary h-11 w-11 rounded-full p-0"
          >
            <LocateFixed className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
