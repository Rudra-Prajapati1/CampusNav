// CampusNav redesign — MapEditor.jsx — updated
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { v4 as uuidv4 } from "uuid";
import toast from "react-hot-toast";
import {
  Accessibility,
  Check,
  ChevronDown,
  DoorOpen,
  Download,
  Eye,
  EyeOff,
  GitBranch,
  HelpCircle,
  ImagePlus,
  Import,
  LayoutGrid,
  Layers,
  Magnet,
  MapPin,
  MousePointer2,
  Move,
  MoveDiagonal2,
  PencilRuler,
  RectangleHorizontal,
  Search,
  SearchCheck,
  Sparkles,
  Spline,
  Trash2,
  Wifi,
  X,
} from "lucide-react";
import {
  DEFAULT_INDUSTRY,
  formatRoomTypeLabel,
  getRoomTypeMeta,
  getRoomTypes,
  resolvePoiIcon,
} from "../config/poiTypes.js";

const GRID = 20;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 6;
const MIN_SIZE = 24;
const LINK_DIST = 48;
const WAYPOINTS = ["junction", "entrance", "destination"];
const TRANSITIONS = ["none", "stairs", "elevator"];
const ROOM_ALIASES = { toilet: "restroom", staircase: "stairs" };

const TOOLS = [
  { group: "Draw", id: "room", label: "Room", key: "R", icon: RectangleHorizontal },
  { group: "Draw", id: "door", label: "Door", key: "D", icon: DoorOpen },
  { group: "Draw", id: "waypoint", label: "Waypoint", key: "W", icon: MapPin },
  { group: "Draw", id: "beacon", label: "Beacon", key: "B", icon: Wifi },
  { group: "Draw", id: "path", label: "Path", key: "P", icon: Spline },
  { group: "Edit", id: "select", label: "Select", key: "S", icon: MousePointer2 },
  { group: "Edit", id: "move", label: "Move", key: "M", icon: Move },
  { group: "Edit", id: "resize", label: "Resize", key: "E", icon: MoveDiagonal2 },
  { group: "Edit", id: "delete", label: "Delete", key: "Del", icon: Trash2 },
];

const clone = (value) => JSON.parse(JSON.stringify(value));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const snap = (value, enabled) =>
  enabled ? Math.round(value / GRID) * GRID : value;
const slugify = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "custom";
const dist = (a, b) => Math.hypot((a.x || 0) - (b.x || 0), (a.y || 0) - (b.y || 0));

function pointInPoly(point, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    if (
      points[i].y > point.y !== points[j].y > point.y &&
      point.x <
        ((points[j].x - points[i].x) * (point.y - points[i].y)) /
          (points[j].y - points[i].y) +
          points[i].x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function segDist(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return dist(point, a);
  const t = clamp(
    ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy),
    0,
    1,
  );
  return dist(point, { x: a.x + t * dx, y: a.y + t * dy });
}

function boundsFromPoints(points = []) {
  return points.reduce(
    (acc, point) => ({
      minX: Math.min(acc.minX, point.x),
      minY: Math.min(acc.minY, point.y),
      maxX: Math.max(acc.maxX, point.x),
      maxY: Math.max(acc.maxY, point.y),
    }),
    {
      minX: points[0]?.x ?? 0,
      minY: points[0]?.y ?? 0,
      maxX: points[0]?.x ?? 0,
      maxY: points[0]?.y ?? 0,
    },
  );
}

function getBounds(element) {
  if (element.kind === "room" && element.shape === "polygon") {
    const box = boundsFromPoints(element.points);
    return {
      x: box.minX,
      y: box.minY,
      width: box.maxX - box.minX,
      height: box.maxY - box.minY,
    };
  }
  if (element.kind === "path") {
    const box = boundsFromPoints(element.points);
    return {
      x: box.minX,
      y: box.minY,
      width: box.maxX - box.minX,
      height: box.maxY - box.minY,
    };
  }
  if (element.kind === "door" || element.kind === "waypoint" || element.kind === "beacon") {
    return { x: element.x - 12, y: element.y - 12, width: 24, height: 24 };
  }
  return {
    x: element.x || 0,
    y: element.y || 0,
    width: element.width || 0,
    height: element.height || 0,
  };
}

function roomCenter(room) {
  const box = getBounds(room);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function handlePoints(element) {
  const box = getBounds(element);
  const mx = box.x + box.width / 2;
  const my = box.y + box.height / 2;
  return [
    { id: "nw", x: box.x, y: box.y },
    { id: "n", x: mx, y: box.y },
    { id: "ne", x: box.x + box.width, y: box.y },
    { id: "e", x: box.x + box.width, y: my },
    { id: "se", x: box.x + box.width, y: box.y + box.height },
    { id: "s", x: mx, y: box.y + box.height },
    { id: "sw", x: box.x, y: box.y + box.height },
    { id: "w", x: box.x, y: my },
  ];
}

function defaultRoomType(industryId) {
  return getRoomTypes(industryId).find((entry) => !entry.isCustom)?.id || "custom";
}

function normalizeRoomType(rawType, industryId) {
  const next = ROOM_ALIASES[rawType] || rawType;
  if (!next) return { roomType: defaultRoomType(industryId), customLabel: "", customValue: "" };
  if (getRoomTypes(industryId).some((entry) => entry.id === next)) {
    return { roomType: next, customLabel: "", customValue: "" };
  }
  return {
    roomType: "custom",
    customLabel: formatRoomTypeLabel(rawType),
    customValue: rawType,
  };
}

function resolvedRoomType(room) {
  return room.roomType === "custom"
    ? room.customValue || slugify(room.customLabel)
    : room.roomType;
}

function roomLabel(room, industryId) {
  if (room.roomType !== "custom") {
    const meta = getRoomTypeMeta(industryId, room.roomType);
    if (!meta?.isCustom) return meta.label;
  }
  return room.customLabel || formatRoomTypeLabel(room.customValue || "custom");
}

function hit(point, element) {
  if (element.kind === "room" && element.shape === "polygon") {
    return pointInPoly(point, element.points || []);
  }
  if (element.kind === "path") {
    return element.points.some((entry, index) => {
      if (!index) return false;
      return segDist(point, element.points[index - 1], entry) <= 10;
    });
  }
  const box = getBounds(element);
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  );
}

function floorEntry(mapData, floorData) {
  const floors = Array.isArray(mapData?.floors) ? mapData.floors : [];
  return (
    floors.find((entry) => entry.id === floorData?.id) ||
    floors.find((entry) => entry.name === floorData?.name) ||
    floors.find((entry) => entry.level === floorData?.level) ||
    floors[0] ||
    null
  );
}

function normalizeOverlayBounds(bounds) {
  if (!bounds || typeof bounds !== "object") {
    return {
      north: "",
      south: "",
      east: "",
      west: "",
    };
  }

  return {
    north: bounds.north ?? "",
    south: bounds.south ?? "",
    east: bounds.east ?? "",
    west: bounds.west ?? "",
  };
}

function cleanOverlayBounds(bounds) {
  const next = {
    north: Number.parseFloat(bounds?.north),
    south: Number.parseFloat(bounds?.south),
    east: Number.parseFloat(bounds?.east),
    west: Number.parseFloat(bounds?.west),
  };

  if (Object.values(next).some((value) => !Number.isFinite(value))) {
    return null;
  }

  return next;
}

function elementTitle(element, industryId) {
  if (!element) return "Selection";
  if (element.kind === "room") return element.name || roomLabel(element, industryId);
  if (element.kind === "door") return element.name || element.doorType || "Door";
  if (element.kind === "waypoint") {
    return element.name || formatRoomTypeLabel(element.waypointType || "waypoint");
  }
  return element.name || `Path ${element.points?.length || 0}`;
}

function iconForElement(element) {
  if (element.kind === "room") return RectangleHorizontal;
  if (element.kind === "door") return DoorOpen;
  if (element.kind === "waypoint") return MapPin;
  if (element.kind === "beacon") return Wifi;
  return Spline;
}

function normalizeElement(element, industryId) {
  const kind = element.kind || element.type;
  if (kind === "rect" || kind === "polygon" || kind === "room") {
    const shape = element.shape || (kind === "polygon" ? "polygon" : "rect");
    const typeState = normalizeRoomType(
      element.roomType || element.zoneType || element.typeId || null,
      industryId,
    );
    const points = (element.points || element.polygon_points || []).map((point) => ({
      x: point.x,
      y: point.y,
    }));
    const box = shape === "polygon" && points.length ? boundsFromPoints(points) : null;
    return {
      id: element.id || uuidv4(),
      kind: "room",
      type: shape === "polygon" ? "polygon" : "rect",
      shape,
      x: box ? box.minX : element.x || 0,
      y: box ? box.minY : element.y || 0,
      width: box ? box.maxX - box.minX : element.width || element.w || 120,
      height: box ? box.maxY - box.minY : element.height || element.h || 90,
      points,
      name: element.name || "",
      roomType: typeState.roomType,
      customLabel: element.customTypeLabel || typeState.customLabel || "",
      customValue: element.customTypeValue || typeState.customValue || "",
      description: element.description || "",
      color: element.color || "",
      wheelchairAccessible: Boolean(element.wheelchairAccessible),
      publicAccess: element.publicAccess ?? true,
    };
  }
  if (kind === "door") {
    return {
      id: element.id || uuidv4(),
      kind: "door",
      type: "door",
      x: element.x || 0,
      y: element.y || 0,
      name: element.name || "Door",
      doorType: element.doorType || "main_entrance",
      widthMeters: element.widthMeters || element.width_meters || "",
      accessible: Boolean(element.accessible),
      locked: Boolean(element.locked),
    };
  }
  if (kind === "waypoint") {
    return {
      id: element.id || uuidv4(),
      kind: "waypoint",
      type: "waypoint",
      x: element.x || 0,
      y: element.y || 0,
      name: element.name || "",
      waypointType:
        element.waypointType ||
        (element.type === "entrance"
          ? "entrance"
          : element.type === "room_center"
            ? "destination"
            : "junction"),
      transitionType:
        element.transitionType ||
        (element.navType === "staircase" ? "stairs" : element.navType) ||
        (element.type === "stairs" || element.type === "elevator" ? element.type : "none"),
      linkedFloorId:
        element.linkedFloorId || element.linkedFloor || element.linked_floor_id || null,
      description: element.description || "",
      customWaypointLabel: element.customWaypointLabel || "",
    };
  }
  if (kind === "beacon") {
    return {
      id: element.id || uuidv4(),
      kind: "beacon",
      type: "beacon",
      x: element.x || 0,
      y: element.y || 0,
      name: element.name || "Beacon",
      beaconId: element.beaconId || element.hardwareId || "",
      radiusMeters: element.radiusMeters ?? element.radius_meters ?? 2.5,
      txPower: element.txPower ?? element.tx_power ?? -59,
      notes: element.notes || "",
    };
  }
  if (kind === "path") {
    return {
      id: element.id || uuidv4(),
      kind: "path",
      type: "path",
      points: (element.points || []).map((point) => ({ x: point.x, y: point.y })),
      bidirectional: element.bidirectional ?? true,
      accessible: Boolean(element.accessible),
      name: element.name || "",
      staffOnly: Boolean(element.staffOnly),
    };
  }
  return null;
}

function modelFromFloor(floorData, industryId) {
  if (!floorData) {
    return {
      floor: { id: uuidv4(), name: "Floor", level: 0, width: 1200, height: 800, bg: null },
      elements: [],
      pixelsPerMeter: null,
      showGrid: true,
      showLabels: true,
      snapToGrid: true,
      overlayBounds: normalizeOverlayBounds(),
    };
  }
  const entry = floorEntry(floorData.map_data, floorData);
  const elements = entry?.elements?.length
    ? entry.elements.map((item) => normalizeElement(item, industryId)).filter(Boolean)
    : [
        ...(floorData.rooms || []).map((room) =>
          normalizeElement(
            {
              id: room.id,
              type: room.polygon_points?.length ? "polygon" : "rect",
              x: room.x,
              y: room.y,
              width: room.width,
              height: room.height,
              polygon_points: room.polygon_points,
              name: room.name,
              roomType: room.type,
              description: room.description,
              color: room.color,
            },
            industryId,
          ),
        ),
        ...(floorData.waypoints || []).map((waypoint) =>
          normalizeElement(
            {
              id: waypoint.id,
              kind: "waypoint",
              x: waypoint.x,
              y: waypoint.y,
              name: waypoint.name,
              type: waypoint.type,
              linked_floor_id: waypoint.linked_floor_id,
            },
            industryId,
          ),
        ),
        ...((floorData.connections || []).map((connection) => {
          const start = (floorData.waypoints || []).find((wp) => wp.id === connection.waypoint_a_id);
          const end = (floorData.waypoints || []).find((wp) => wp.id === connection.waypoint_b_id);
          if (!start || !end) return null;
          return {
            id: connection.id || uuidv4(),
            kind: "path",
            type: "path",
            points: [
              { x: start.x, y: start.y },
              { x: end.x, y: end.y },
            ],
            bidirectional: true,
            accessible: false,
            name: "",
          };
        }).filter(Boolean)),
      ];
  return {
    floor: {
      id: floorData.id,
      name: floorData.name,
      level: floorData.level ?? 0,
      width: entry?.width || floorData.floor_plan_width || 1200,
      height: entry?.height || floorData.floor_plan_height || 800,
      bg: entry?.backgroundDataUrl || entry?.bgImage || null,
    },
    elements,
    pixelsPerMeter:
      floorData.map_data?.pixelsPerMeter ?? floorData.scale_pixels_per_meter ?? null,
    showGrid: floorData.map_data?.showGrid ?? true,
    showLabels: floorData.map_data?.showLabels ?? true,
    snapToGrid: floorData.map_data?.snapToGrid ?? true,
    overlayBounds: normalizeOverlayBounds(entry?.overlayBounds),
    threeD: {
      extrusionHeight: entry?.threeD?.extrusionHeight ?? 3.2,
      wallHeight: entry?.threeD?.wallHeight ?? 3.2,
    },
  };
}

function navigationIssues(model) {
  const rooms = model.elements.filter((element) => element.kind === "room");
  const waypoints = model.elements.filter((element) => element.kind === "waypoint");
  const paths = model.elements.filter((element) => element.kind === "path");
  const beacons = model.elements.filter((element) => element.kind === "beacon");
  const overlayBounds = cleanOverlayBounds(model.overlayBounds);
  const issues = [];

  if (!rooms.length) issues.push("Add at least one room or POI.");
  if (rooms.some((room) => !String(room.name || "").trim())) {
    issues.push("Name all rooms so users can search them.");
  }
  if (rooms.length && !waypoints.length) issues.push("Add waypoints for routing.");
  if (waypoints.length > 1 && !paths.length) {
    issues.push("Connect waypoints with at least one path.");
  }
  if (!overlayBounds) {
    issues.push("Add overlay bounds to anchor this floor on the live map.");
  }
  if (!beacons.length) {
    issues.push("Place BLE beacons to prepare blue-dot positioning.");
  }

  return issues;
}

function editorBounds(model, bgImage) {
  const boxes = model.elements.map(getBounds);
  if (bgImage || model.floor.width || model.floor.height) {
    return {
      minX: 0,
      minY: 0,
      maxX: model.floor.width || bgImage?.naturalWidth || 1200,
      maxY: model.floor.height || bgImage?.naturalHeight || 800,
    };
  }
  if (!boxes.length) return { minX: 0, minY: 0, maxX: 1200, maxY: 800 };
  return boxes.reduce(
    (acc, box) => ({
      minX: Math.min(acc.minX, box.x),
      minY: Math.min(acc.minY, box.y),
      maxX: Math.max(acc.maxX, box.x + box.width),
      maxY: Math.max(acc.maxY, box.y + box.height),
    }),
    {
      minX: boxes[0].x,
      minY: boxes[0].y,
      maxX: boxes[0].x + boxes[0].width,
      maxY: boxes[0].y + boxes[0].height,
    },
  );
}

function fit(bounds, viewport) {
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const zoom = clamp(
    Math.min((viewport.width - 112) / width, (viewport.height - 112) / height),
    MIN_ZOOM,
    MAX_ZOOM,
  );
  return {
    zoom,
    x: viewport.width / 2 - ((bounds.minX + bounds.maxX) / 2) * zoom,
    y: viewport.height / 2 - ((bounds.minY + bounds.maxY) / 2) * zoom,
  };
}

function nearestWaypoint(point, waypoints) {
  let match = null;
  let best = Infinity;
  waypoints.forEach((waypoint) => {
    const value = dist(point, waypoint);
    if (value < best) {
      best = value;
      match = waypoint;
    }
  });
  return best <= LINK_DIST ? match : null;
}

function containingRoom(point, rooms) {
  return rooms.find((room) => hit(point, room)) || null;
}

function serialize(model, bgImage, industryId) {
  const rooms = model.elements.filter((element) => element.kind === "room");
  const waypoints = model.elements.filter((element) => element.kind === "waypoint");
  const dbRooms = rooms.map((room) => ({
    id: room.id,
    name: room.name || "Unnamed",
    type: resolvedRoomType(room),
    x: Math.round(room.x),
    y: Math.round(room.y),
    width: Math.round(room.width),
    height: Math.round(room.height),
    color: room.color || null,
    description: room.description || "",
    polygon_points: room.shape === "polygon" ? room.points : null,
  }));
  const dbWaypoints = waypoints.map((waypoint) => {
    const room = containingRoom(waypoint, rooms);
    const roomMeta = room ? getRoomTypeMeta(industryId, resolvedRoomType(room)) : null;
    const type =
      waypoint.transitionType === "stairs" || waypoint.transitionType === "elevator"
        ? waypoint.transitionType
        : roomMeta?.navRole ||
          (waypoint.waypointType === "entrance"
            ? "entrance"
            : waypoint.waypointType === "destination"
              ? "room_center"
              : "corridor");
    return {
      id: waypoint.id,
      x: Math.round(waypoint.x),
      y: Math.round(waypoint.y),
      type,
      room_id: waypoint.waypointType === "destination" ? room?.id || null : null,
      name: waypoint.name || "",
      linked_floor_id: waypoint.linkedFloorId || null,
    };
  });
  const dbConnections = [];
  const seen = new Set();
  model.elements
    .filter((element) => element.kind === "path")
    .forEach((path) => {
      path.points.forEach((point, index) => {
        if (!index) return;
        const a = nearestWaypoint(path.points[index - 1], waypoints);
        const b = nearestWaypoint(point, waypoints);
        if (!a || !b || a.id === b.id) return;
        const key = [a.id, b.id].sort().join(":");
        if (seen.has(key)) return;
        seen.add(key);
        dbConnections.push({
          id: uuidv4(),
          waypoint_a_id: a.id,
          waypoint_b_id: b.id,
        });
      });
    });
  return {
    rooms: dbRooms,
    waypoints: dbWaypoints,
    connections: dbConnections,
    map_data: {
      version: 2,
      pixelsPerMeter: model.pixelsPerMeter || null,
      showGrid: model.showGrid,
      showLabels: model.showLabels,
      snapToGrid: model.snapToGrid,
      floors: [
        {
          id: model.floor.id,
          name: model.floor.name,
          level: model.floor.level,
          width: model.floor.width || bgImage?.naturalWidth || 1200,
          height: model.floor.height || bgImage?.naturalHeight || 800,
          backgroundDataUrl: model.floor.bg || null,
          bgImage: model.floor.bg || null,
          overlayBounds: cleanOverlayBounds(model.overlayBounds),
          threeD: {
            extrusionHeight: Number.parseFloat(model.threeD?.extrusionHeight) || 3.2,
            wallHeight: Number.parseFloat(model.threeD?.wallHeight) || 3.2,
          },
          elements: model.elements.map((element) => {
            if (element.kind === "room") {
              return {
                id: element.id,
                kind: "room",
                type: element.shape === "polygon" ? "polygon" : "rect",
                shape: element.shape,
                x: element.x,
                y: element.y,
                width: element.width,
                height: element.height,
                w: element.width,
                h: element.height,
                points: element.points,
                name: element.name,
                roomType: element.roomType,
                customTypeLabel: element.customLabel,
                customTypeValue: element.customValue,
                description: element.description,
                color: element.color,
                wheelchairAccessible: Boolean(element.wheelchairAccessible),
                publicAccess: element.publicAccess ?? true,
              };
            }
            if (element.kind === "door") {
              return {
                ...element,
                widthMeters:
                  element.widthMeters === "" ? "" : Number.parseFloat(element.widthMeters) || "",
              };
            }
            if (element.kind === "waypoint") {
              return {
                id: element.id,
                kind: "waypoint",
                type: "waypoint",
                x: element.x,
                y: element.y,
                name: element.name,
                waypointType: element.waypointType,
                transitionType: element.transitionType,
                linkedFloorId: element.linkedFloorId,
                customWaypointLabel: element.customWaypointLabel,
              };
            }
            if (element.kind === "beacon") {
              return {
                id: element.id,
                kind: "beacon",
                type: "beacon",
                x: element.x,
                y: element.y,
                name: element.name,
                beaconId: element.beaconId,
                radiusMeters:
                  element.radiusMeters === "" ? "" : Number.parseFloat(element.radiusMeters) || 2.5,
                txPower:
                  element.txPower === "" ? "" : Number.parseFloat(element.txPower) || -59,
                notes: element.notes || "",
              };
            }
            return element;
          }),
        },
      ],
    },
    scale_pixels_per_meter: model.pixelsPerMeter || null,
  };
}

function autoPack(elements, industryId) {
  const rooms = elements.filter((element) => element.kind === "room");
  const doors = elements.filter((element) => element.kind === "door");
  const waypoints = rooms.map((room) => {
    const box = getBounds(room);
    const door =
      doors.find(
        (entry) =>
          entry.x >= box.x - 12 &&
          entry.x <= box.x + box.width + 12 &&
          entry.y >= box.y - 12 &&
          entry.y <= box.y + box.height + 12,
      ) || null;
    const meta = getRoomTypeMeta(industryId, resolvedRoomType(room));
    const anchor = door || roomCenter(room);
    return {
      id: uuidv4(),
      kind: "waypoint",
      type: "waypoint",
      x: anchor.x,
      y: anchor.y,
      name: room.name || roomLabel(room, industryId),
      waypointType: meta?.navRole ? "junction" : "destination",
      transitionType: meta?.navRole || "none",
      linkedFloorId: null,
      description: "",
    };
  });
  const paths = [];
  const visited = new Set([waypoints[0]?.id]);
  while (visited.size && visited.size < waypoints.length) {
    let edge = null;
    waypoints.forEach((source) => {
      if (!visited.has(source.id)) return;
      waypoints.forEach((target) => {
        if (visited.has(target.id) || source.id === target.id) return;
        const value = dist(source, target);
        if (!edge || value < edge.value) edge = { source, target, value };
      });
    });
    if (!edge) break;
    visited.add(edge.target.id);
    paths.push({
      id: uuidv4(),
      kind: "path",
      type: "path",
      points: [
        { x: edge.source.x, y: edge.source.y },
        { x: edge.target.x, y: edge.target.y },
      ],
      bidirectional: true,
      accessible: false,
      name: "",
    });
  }
  return { waypoints, paths };
}

const MapEditor = forwardRef(function MapEditor(
  {
    floorData,
    floors = [],
    buildingIndustry = DEFAULT_INDUSTRY,
    onSave,
    onStateChange,
    previewMode = false,
    previewView = "2d",
  },
  ref,
) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const bgInputRef = useRef(null);
  const jsonInputRef = useRef(null);
  const actionRef = useRef(null);
  const historyRef = useRef([]);
  const futureRef = useRef([]);
  const didFitRef = useRef(false);
  const spaceDownRef = useRef(false);
  const [model, setModel] = useState(() => modelFromFloor(floorData, buildingIndustry));
  const modelRef = useRef(model);
  const [tool, setTool] = useState("select");
  const [shape, setShape] = useState("rect");
  const [selectionId, setSelectionId] = useState(null);
  const [draftType, setDraftType] = useState(defaultRoomType(buildingIndustry));
  const [draftCustomLabel, setDraftCustomLabel] = useState("");
  const [typeSearch, setTypeSearch] = useState("");
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [cursor, setCursor] = useState(null);
  const [polyDraft, setPolyDraft] = useState([]);
  const [pathDraft, setPathDraft] = useState([]);
  const [measure, setMeasure] = useState(null);
  const [bgImage, setBgImage] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);
  const [showHelpPanel, setShowHelpPanel] = useState(false);
  const [hiddenIds, setHiddenIds] = useState({});
  const [sections, setSections] = useState({
    draw: true,
    edit: true,
    view: true,
    layers: true,
    utilities: false,
  });

  const roomTypes = useMemo(() => {
    return getRoomTypes(buildingIndustry).filter((entry) => {
      const value = typeSearch.toLowerCase();
      return !value || entry.label.toLowerCase().includes(value) || entry.id.includes(value);
    });
  }, [buildingIndustry, typeSearch]);

  const visibleElements = useMemo(
    () => model.elements.filter((element) => !hiddenIds[element.id]),
    [hiddenIds, model.elements],
  );

  const selected = model.elements.find((element) => element.id === selectionId) || null;

  useEffect(() => {
    const next = modelFromFloor(floorData, buildingIndustry);
    modelRef.current = next;
    setModel(next);
    setSelectionId(null);
    setTool("select");
    setShape("rect");
    setDraftType(defaultRoomType(buildingIndustry));
    setDraftCustomLabel("");
    setTypeSearch("");
    setPolyDraft([]);
    setPathDraft([]);
    setMeasure(null);
    setDirty(false);
    setShowHelpPanel(false);
    setHiddenIds({});
    historyRef.current = [];
    futureRef.current = [];
    setUndoCount(0);
    setRedoCount(0);
    didFitRef.current = false;
  }, [buildingIndustry, floorData]);

  useEffect(() => {
    modelRef.current = model;
  }, [model]);

  useEffect(() => {
    if (selectionId && hiddenIds[selectionId]) {
      setSelectionId(null);
    }
  }, [hiddenIds, selectionId]);

  useEffect(() => {
    const source = model.floor.bg || floorData?.floor_plan_url || null;
    if (!source) {
      setBgImage(null);
      return undefined;
    }
    let cancelled = false;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => !cancelled && setBgImage(image);
    image.onerror = () => !cancelled && setBgImage(null);
    image.src = source;
    return () => {
      cancelled = true;
    };
  }, [floorData?.floor_plan_url, model.floor.bg]);

  useEffect(() => {
    if (!wrapRef.current) return undefined;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setViewport({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(wrapRef.current);
    return () => observer.disconnect();
  }, []);

  function commit(next, track = true) {
    if (track) {
      historyRef.current = [...historyRef.current, clone(modelRef.current)].slice(-60);
      futureRef.current = [];
      setUndoCount(historyRef.current.length);
      setRedoCount(0);
    }
    modelRef.current = next;
    setModel(next);
    setDirty(true);
  }

  function mutate(recipe, track = true) {
    const next = clone(modelRef.current);
    recipe(next);
    commit(next, track);
  }

  function fitView() {
    if (!viewport.width || !viewport.height) return;
    const next = fit(editorBounds(modelRef.current, bgImage), viewport);
    setZoom(next.zoom);
    setPan({ x: next.x, y: next.y });
  }

  useEffect(() => {
    if (!viewport.width || !viewport.height || didFitRef.current) return;
    fitView();
    didFitRef.current = true;
  }, [bgImage, viewport]);

  function undo() {
    if (!historyRef.current.length) return;
    const previous = historyRef.current[historyRef.current.length - 1];
    historyRef.current = historyRef.current.slice(0, -1);
    futureRef.current = [clone(modelRef.current), ...futureRef.current].slice(0, 60);
    modelRef.current = previous;
    setModel(previous);
    setSelectionId(null);
    setDirty(true);
    setUndoCount(historyRef.current.length);
    setRedoCount(futureRef.current.length);
  }

  function redo() {
    if (!futureRef.current.length) return;
    const [next, ...rest] = futureRef.current;
    futureRef.current = rest;
    historyRef.current = [...historyRef.current, clone(modelRef.current)].slice(-60);
    modelRef.current = next;
    setModel(next);
    setSelectionId(null);
    setDirty(true);
    setUndoCount(historyRef.current.length);
    setRedoCount(futureRef.current.length);
  }

  function activate(nextTool) {
    if (previewMode && nextTool !== "select") {
      setTool("select");
      return;
    }
    setTool(nextTool);
    setPolyDraft([]);
    setPathDraft([]);
    setCursor(null);
    if (nextTool !== "measure") setMeasure(null);
  }

  function pointFromEvent(event) {
    const box = canvasRef.current.getBoundingClientRect();
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    return {
      canvasX: x,
      canvasY: y,
      worldX: (x - pan.x) / zoom,
      worldY: (y - pan.y) / zoom,
      x: snap((x - pan.x) / zoom, modelRef.current.snapToGrid),
      y: snap((y - pan.y) / zoom, modelRef.current.snapToGrid),
    };
  }

  function hitElement(point) {
    return [...visibleElements].reverse().find((element) => hit(point, element)) || null;
  }

  function removeSelected(targetId = selectionId) {
    if (!targetId) return;
    mutate((next) => {
      next.elements = next.elements.filter((element) => element.id !== targetId);
    });
    setSelectionId(null);
  }

  function addElement(element) {
    mutate((next) => {
      next.elements.push(element);
    });
    setSelectionId(element.id);
    setShowHelpPanel(false);
  }

  function updateElement(id, recipe, track = false) {
    if (previewMode) return;
    const next = clone(modelRef.current);
    const target = next.elements.find((element) => element.id === id);
    if (!target) return;
    recipe(target);
    commit(next, track);
  }

  function updateOverlayBound(key, value) {
    if (previewMode) return;
    mutate((next) => {
      if (!next.overlayBounds) {
        next.overlayBounds = normalizeOverlayBounds();
      }
      next.overlayBounds[key] = value === "" ? "" : value;
    }, false);
  }

  function toggleVisibility(id) {
    setHiddenIds((current) => {
      const next = { ...current };
      if (next[id]) delete next[id];
      else next[id] = true;
      return next;
    });
  }

  function toggleSection(id) {
    setSections((current) => ({ ...current, [id]: !current[id] }));
  }

  function saveRoom(bounds, points = []) {
    addElement({
      id: uuidv4(),
      kind: "room",
      type: shape === "polygon" ? "polygon" : "rect",
      shape,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      points,
      name: "",
      roomType: draftType,
      customLabel: draftType === "custom" ? draftCustomLabel.trim() : "",
      customValue: draftType === "custom" ? slugify(draftCustomLabel) : "",
      description: "",
      color: "",
      wheelchairAccessible: false,
      publicAccess: true,
    });
  }

  function zoomBy(factor, anchor) {
    const nextZoom = clamp(zoom * factor, MIN_ZOOM, MAX_ZOOM);
    if (!anchor) {
      setZoom(nextZoom);
      return;
    }
    const wx = (anchor.x - pan.x) / zoom;
    const wy = (anchor.y - pan.y) / zoom;
    setZoom(nextZoom);
    setPan({ x: anchor.x - wx * nextZoom, y: anchor.y - wy * nextZoom });
  }

  function validate() {
    const rooms = modelRef.current.elements.filter((element) => element.kind === "room");
    const waypoints = modelRef.current.elements.filter((element) => element.kind === "waypoint");
    const paths = modelRef.current.elements.filter((element) => element.kind === "path");
    const issues = [];
    if (rooms.some((room) => !room.name.trim())) issues.push("Some rooms still need names.");
    if (rooms.some((room) => room.roomType === "custom" && !room.customLabel.trim())) {
      issues.push("Some custom room types still need labels.");
    }
    if (rooms.length && !waypoints.length) issues.push("No waypoints yet.");
    if (waypoints.length > 1 && !paths.length) issues.push("Waypoints are not connected by paths.");
    if (!modelRef.current.pixelsPerMeter) issues.push("Scale is not set.");
    if (issues.length) toast.error(issues.join(" "));
    else toast.success("Map validation passed.");
  }

  function autoWaypoints() {
    const rooms = modelRef.current.elements.filter((element) => element.kind === "room");
    if (!rooms.length) {
      toast.error("Add at least one room first.");
      return;
    }
    const pack = autoPack(modelRef.current.elements, buildingIndustry);
    mutate((next) => {
      next.elements = next.elements.filter(
        (element) => element.kind !== "waypoint" && element.kind !== "path",
      );
      next.elements.push(...pack.waypoints, ...pack.paths);
    });
    toast.success("Waypoints and paths generated.");
  }

  function uploadBackground(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result || "");
      const image = new Image();
      image.onload = () => {
        mutate((next) => {
          next.floor.bg = src;
          next.floor.width = image.naturalWidth;
          next.floor.height = image.naturalHeight;
        });
        setBgImage(image);
        didFitRef.current = false;
      };
      image.src = src;
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  }

  function importJson(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || "{}"));
        const next = modelFromFloor(
          { ...floorData, map_data: parsed, rooms: [], waypoints: [], connections: [] },
          buildingIndustry,
        );
        modelRef.current = next;
        setModel(next);
        setSelectionId(null);
        setDirty(true);
        historyRef.current = [];
        futureRef.current = [];
        setUndoCount(0);
        setRedoCount(0);
        didFitRef.current = false;
        toast.success("Editor JSON imported.");
      } catch {
        toast.error("Invalid map JSON.");
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  }

  function exportJson() {
    const payload = serialize(modelRef.current, bgImage, buildingIndustry);
    const blob = new Blob([JSON.stringify(payload.map_data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${modelRef.current.floor.name || "floor"}-map.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function save() {
    const payload = serialize(modelRef.current, bgImage, buildingIndustry);
    if (onSave) await onSave(payload);
    setDirty(false);
    return payload;
  }

  useImperativeHandle(
    ref,
    () => ({
      save,
      undo,
      redo,
      zoomIn: () => zoomBy(1.15),
      zoomOut: () => zoomBy(1 / 1.15),
      setZoom: (value) => setZoom(clamp(value, MIN_ZOOM, MAX_ZOOM)),
      fitToScreen: fitView,
      setTool: activate,
      deleteSelection: removeSelected,
      toggleGrid: () => mutate((next) => { next.showGrid = !next.showGrid; }, false),
      toggleSnap: () => mutate((next) => { next.snapToGrid = !next.snapToGrid; }, false),
      toggleLabels: () => mutate((next) => { next.showLabels = !next.showLabels; }, false),
      setRoomShape: setShape,
      selectElement: (id) => {
        setSelectionId(id || null);
        setShowHelpPanel(false);
        if (id) setTool("select");
      },
      getState: () => ({
        tool,
        zoom,
        dirty,
        canUndo: historyRef.current.length > 0,
        canRedo: futureRef.current.length > 0,
        selectedElement: selected,
        showGrid: modelRef.current.showGrid,
        showLabels: modelRef.current.showLabels,
        snapToGrid: modelRef.current.snapToGrid,
        cursor,
        overlayBounds: modelRef.current.overlayBounds,
        issues: navigationIssues(modelRef.current),
      }),
    }),
    [cursor, dirty, selected, tool, zoom],
  );

  useEffect(() => {
    const issues = navigationIssues(model);
    if (!onStateChange) return;
    onStateChange({
      tool,
      roomShape: shape,
      zoom,
      dirty,
      canUndo: historyRef.current.length > 0,
      canRedo: futureRef.current.length > 0,
      showGrid: model.showGrid,
      showLabels: model.showLabels,
      snapToGrid: model.snapToGrid,
      counts: {
        rooms: model.elements.filter((element) => element.kind === "room").length,
        waypoints: model.elements.filter((element) => element.kind === "waypoint").length,
        paths: model.elements.filter((element) => element.kind === "path").length,
        doors: model.elements.filter((element) => element.kind === "door").length,
        beacons: model.elements.filter((element) => element.kind === "beacon").length,
      },
      selectedElement: selected
        ? {
            id: selected.id,
            kind: selected.kind,
            label: elementTitle(selected, buildingIndustry),
          }
        : null,
      saveStatus: dirty ? "Unsaved changes" : "All changes saved",
      cursor,
      overlayBounds: model.overlayBounds,
      issues,
      readiness:
        issues.length === 0 ? "Ready for navigation" : `${issues.length} issue${issues.length === 1 ? "" : "s"} to review`,
    });
  }, [buildingIndustry, cursor, dirty, model, onStateChange, selected, shape, tool, zoom]);

  useEffect(() => {
    function keyDown(event) {
      if (
        event.target instanceof HTMLElement &&
        ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      if (event.key === "Delete" || event.key === "Backspace") removeSelected();
      if ((event.ctrlKey || event.metaKey) && key === "z") {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
      }
      if ((event.ctrlKey || event.metaKey) && key === "y") {
        event.preventDefault();
        redo();
      }
      if ((event.ctrlKey || event.metaKey) && key === "s") {
        event.preventDefault();
        save();
      }
      if (event.key === " ") spaceDownRef.current = true;
      if (!previewMode && key === "r") activate("room");
      if (!previewMode && key === "d") activate("door");
      if (!previewMode && key === "w") activate("waypoint");
      if (!previewMode && key === "b") activate("beacon");
      if (!previewMode && key === "p") activate("path");
      if (key === "s" && !event.ctrlKey && !event.metaKey) activate("select");
      if (!previewMode && key === "m") activate("move");
      if (!previewMode && key === "e") activate("resize");
      if (key === "f") fitView();
      if (key === "g") mutate((next) => { next.showGrid = !next.showGrid; }, false);
      if (key === "l") mutate((next) => { next.showLabels = !next.showLabels; }, false);
      if (event.key === "Escape") {
        actionRef.current = null;
        setPolyDraft([]);
        setPathDraft([]);
        setMeasure(null);
        setSelectionId(null);
        activate("select");
      }
    }
    function keyUp(event) {
      if (event.key === " ") spaceDownRef.current = false;
    }
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    return () => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
    };
  }, [previewMode, tool, zoom]);

  function down(event) {
    canvasRef.current.setPointerCapture(event.pointerId);
    const point = pointFromEvent(event);
    const world = { x: point.worldX, y: point.worldY };
    const snapped = { x: point.x, y: point.y };
    const match = hitElement(world);
    const handle =
      selected?.kind === "room"
        ? handlePoints(selected).find((entry) => dist(world, entry) <= 12 / zoom + 4)
        : null;
    if (event.button === 1 || spaceDownRef.current) {
      actionRef.current = { kind: "pan", startX: point.canvasX, startY: point.canvasY, pan: { ...pan } };
      return;
    }
    if (previewMode) {
      setSelectionId(match?.id || null);
      if (match) setShowHelpPanel(false);
      return;
    }
    if (tool === "delete") {
      if (match) {
        setSelectionId(match.id);
        removeSelected(match.id);
      }
      return;
    }
    if (tool === "door") {
      if (previewMode) return;
      addElement({
        id: uuidv4(),
        kind: "door",
        type: "door",
        x: snapped.x,
        y: snapped.y,
        name: "Door",
        doorType: "main_entrance",
        widthMeters: "",
        accessible: false,
        locked: false,
      });
      return;
    }
    if (tool === "waypoint") {
      if (previewMode) return;
      addElement({
        id: uuidv4(),
        kind: "waypoint",
        type: "waypoint",
        x: snapped.x,
        y: snapped.y,
        name: "",
        waypointType: "junction",
        transitionType: "none",
        linkedFloorId: null,
        description: "",
        customWaypointLabel: "",
      });
      return;
    }
    if (tool === "beacon") {
      addElement({
        id: uuidv4(),
        kind: "beacon",
        type: "beacon",
        x: snapped.x,
        y: snapped.y,
        name: "Beacon",
        beaconId: "",
        radiusMeters: 2.5,
        txPower: -59,
        notes: "",
      });
      return;
    }
    if (tool === "measure") {
      if (!measure?.start || measure.end) {
        setMeasure({ start: world, end: null, pixels: 0, meters: null });
      } else {
        const pixels = dist(measure.start, world);
        setMeasure({
          start: measure.start,
          end: world,
          pixels,
          meters: modelRef.current.pixelsPerMeter ? pixels / modelRef.current.pixelsPerMeter : null,
        });
        activate("select");
      }
      return;
    }
    if (tool === "room" && shape === "polygon") {
      if (previewMode) return;
      setSelectionId(null);
      setPolyDraft((current) => [...current, snapped]);
      setCursor(snapped);
      return;
    }
    if (tool === "path") {
      if (previewMode) return;
      setSelectionId(null);
      setPathDraft((current) => [...current, snapped]);
      setCursor(snapped);
      return;
    }
    if (tool === "room") {
      if (previewMode) return;
      setSelectionId(null);
      actionRef.current = { kind: "rect", start: snapped };
      setCursor(snapped);
      return;
    }
    if (match) {
      setSelectionId(match.id);
      setShowHelpPanel(false);
      if ((tool === "resize" || tool === "select") && handle) {
        historyRef.current = [...historyRef.current, clone(modelRef.current)].slice(-60);
        futureRef.current = [];
        setUndoCount(historyRef.current.length);
        setRedoCount(0);
        actionRef.current = { kind: "resize", original: clone(selected), handle: handle.id };
        return;
      }
      if (tool === "select" || tool === "move") {
        historyRef.current = [...historyRef.current, clone(modelRef.current)].slice(-60);
        futureRef.current = [];
        setUndoCount(historyRef.current.length);
        setRedoCount(0);
        actionRef.current = { kind: "move", id: match.id, start: world, original: clone(match) };
        return;
      }
    }
    setSelectionId(null);
  }

  function move(event) {
    const point = pointFromEvent(event);
    const world = { x: point.worldX, y: point.worldY };
    const snapped = { x: point.x, y: point.y };
    const action = actionRef.current;
    setCursor(snapped);
    if (measure?.start && !measure.end && tool === "measure") {
      const pixels = dist(measure.start, world);
      setMeasure({
        start: measure.start,
        end: world,
        pixels,
        meters: modelRef.current.pixelsPerMeter ? pixels / modelRef.current.pixelsPerMeter : null,
      });
    }
    if (!action) return;
    if (action.kind === "pan") {
      setPan({
        x: action.pan.x + (point.canvasX - action.startX),
        y: action.pan.y + (point.canvasY - action.startY),
      });
      return;
    }
    if (action.kind === "move") {
      const dx = snapped.x - action.start.x;
      const dy = snapped.y - action.start.y;
      const next = clone(modelRef.current);
      const target = next.elements.find((element) => element.id === action.id);
      if (!target) return;
      if (target.kind === "room" && target.shape === "polygon") {
        target.points = action.original.points.map((entry) => ({ x: entry.x + dx, y: entry.y + dy }));
      } else if (target.kind === "path") {
        target.points = action.original.points.map((entry) => ({ x: entry.x + dx, y: entry.y + dy }));
      }
      if (target.x !== undefined) target.x = action.original.x + dx;
      if (target.y !== undefined) target.y = action.original.y + dy;
      modelRef.current = next;
      setModel(next);
      setDirty(true);
      return;
    }
    if (action.kind === "resize") {
      const start = getBounds(action.original);
      const box = { x: start.x, y: start.y, width: start.width, height: start.height };
      if (action.handle.includes("w")) {
        box.x = Math.min(snapped.x, start.x + start.width - MIN_SIZE);
        box.width = start.x + start.width - box.x;
      }
      if (action.handle.includes("e")) box.width = Math.max(MIN_SIZE, snapped.x - start.x);
      if (action.handle.includes("n")) {
        box.y = Math.min(snapped.y, start.y + start.height - MIN_SIZE);
        box.height = start.y + start.height - box.y;
      }
      if (action.handle.includes("s")) box.height = Math.max(MIN_SIZE, snapped.y - start.y);
      const next = clone(modelRef.current);
      const target = next.elements.find((element) => element.id === action.original.id);
      if (!target) return;
      if (target.shape === "polygon") {
        const sx = box.width / start.width;
        const sy = box.height / start.height;
        target.points = action.original.points.map((entry) => ({
          x: box.x + (entry.x - start.x) * sx,
          y: box.y + (entry.y - start.y) * sy,
        }));
      }
      target.x = box.x;
      target.y = box.y;
      target.width = box.width;
      target.height = box.height;
      modelRef.current = next;
      setModel(next);
      setDirty(true);
    }
  }

  function up(event) {
    if (canvasRef.current?.hasPointerCapture(event.pointerId)) {
      canvasRef.current.releasePointerCapture(event.pointerId);
    }
    const action = actionRef.current;
    actionRef.current = null;
    if (action?.kind === "rect" && cursor) {
      const box = {
        x: Math.min(action.start.x, cursor.x),
        y: Math.min(action.start.y, cursor.y),
        width: Math.abs(cursor.x - action.start.x),
        height: Math.abs(cursor.y - action.start.y),
      };
      if (box.width >= MIN_SIZE && box.height >= MIN_SIZE) saveRoom(box);
    }
  }

  function dbl() {
    if (previewMode) return;
    if (tool === "room" && shape === "polygon" && polyDraft.length >= 3) {
      const box = boundsFromPoints(polyDraft);
      saveRoom(
        {
          x: box.minX,
          y: box.minY,
          width: box.maxX - box.minX,
          height: box.maxY - box.minY,
        },
        polyDraft,
      );
      setPolyDraft([]);
      setCursor(null);
    }
    if (tool === "path" && pathDraft.length >= 2) {
      addElement({
        id: uuidv4(),
        kind: "path",
        type: "path",
        points: pathDraft,
        bidirectional: true,
        accessible: false,
        name: "",
        staffOnly: false,
      });
      setPathDraft([]);
      setCursor(null);
    }
  }

  useEffect(() => {
    if (!canvasRef.current || !viewport.width || !viewport.height) return;
    const root = getComputedStyle(document.documentElement);
    const isDark = document.documentElement.dataset.theme === "dark";
    const canvas = canvasRef.current;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = viewport.width * ratio;
    canvas.height = viewport.height * ratio;
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, viewport.width, viewport.height);
    ctx.fillStyle = root.getPropertyValue("--color-bg").trim() || "#f8f9fa";
    ctx.fillRect(0, 0, viewport.width, viewport.height);
    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);
    if (bgImage) {
      ctx.globalAlpha = isDark ? 0.35 : 0.58;
      ctx.drawImage(
        bgImage,
        0,
        0,
        model.floor.width || bgImage.naturalWidth,
        model.floor.height || bgImage.naturalHeight,
      );
      ctx.globalAlpha = 1;
    }
    const accent = root.getPropertyValue("--color-accent").trim() || "#2563eb";
    const accentLight = root.getPropertyValue("--color-accent-light").trim() || "#eff6ff";
    const text = root.getPropertyValue("--color-text-primary").trim() || "#0f172a";
    const warn = root.getPropertyValue("--color-warning").trim() || "#d97706";
    const success = root.getPropertyValue("--color-success").trim() || "#16a34a";
    visibleElements.filter((element) => element.kind === "path").forEach((path) => {
      if (!path.points.length) return;
      ctx.beginPath();
      ctx.moveTo(path.points[0].x, path.points[0].y);
      path.points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
      ctx.strokeStyle = path.accessible ? success : accent;
      ctx.lineWidth = selectionId === path.id ? 3 : previewMode ? 3 : 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      if (!path.bidirectional) ctx.setLineDash([10, 6]);
      ctx.stroke();
      ctx.setLineDash([]);
      path.points.forEach((point) => {
        ctx.beginPath();
        ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = accent;
        ctx.fill();
      });
    });
    visibleElements.filter((element) => element.kind === "room").forEach((room) => {
      ctx.beginPath();
      if (room.shape === "polygon" && room.points.length >= 3) {
        ctx.moveTo(room.points[0].x, room.points[0].y);
        room.points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
        ctx.closePath();
      } else {
        ctx.roundRect(room.x, room.y, room.width, room.height, 14);
      }
      ctx.fillStyle = previewMode
        ? room.color || (isDark ? "rgba(30, 58, 95, 0.76)" : "rgba(255, 255, 255, 0.78)")
        : room.color || accentLight;
      if (previewMode && previewView === "3d") {
        ctx.save();
        ctx.translate(8, -8);
        ctx.fillStyle = isDark ? "rgba(15, 23, 42, 0.42)" : "rgba(15, 23, 42, 0.12)";
        ctx.fill();
        ctx.restore();
      }
      ctx.fill();
      ctx.strokeStyle = room.color || accent;
      ctx.lineWidth = selectionId === room.id ? 2.5 : 1.5;
      ctx.stroke();
      const center = roomCenter(room);
      if (model.showLabels) {
        ctx.fillStyle = text;
        ctx.font = previewMode ? "600 12px Inter, sans-serif" : "600 11px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(room.name || roomLabel(room, buildingIndustry), center.x, center.y);
      }
    });
    visibleElements.filter((element) => element.kind === "door").forEach((door) => {
      ctx.beginPath();
      ctx.arc(door.x, door.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = warn;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
    });
    visibleElements.filter((element) => element.kind === "waypoint").forEach((waypoint) => {
      ctx.beginPath();
      ctx.arc(waypoint.x, waypoint.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = accent;
      ctx.fill();
      ctx.lineWidth = selectionId === waypoint.id ? 2.5 : 2;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
    });
    visibleElements.filter((element) => element.kind === "beacon").forEach((beacon) => {
      const radius = Math.max(18, (Number(beacon.radiusMeters) || 2.5) * 12);
      ctx.beginPath();
      ctx.arc(beacon.x, beacon.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = isDark ? "rgba(245, 158, 11, 0.16)" : "rgba(245, 158, 11, 0.12)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(beacon.x, beacon.y, 7, 0, Math.PI * 2);
      ctx.fillStyle = warn;
      ctx.fill();
      ctx.lineWidth = selectionId === beacon.id ? 2.5 : 2;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
    });
    if (selected) {
      const box = getBounds(selected);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.strokeRect(box.x - 6, box.y - 6, box.width + 12, box.height + 12);
      if (selected.kind === "room" && !previewMode) {
        handlePoints(selected).forEach((entry) => {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(entry.x - 2, entry.y - 2, 4, 4);
          ctx.strokeStyle = accent;
          ctx.strokeRect(entry.x - 2, entry.y - 2, 4, 4);
        });
      }
    }
    if (!previewMode && actionRef.current?.kind === "rect" && cursor) {
      const x = Math.min(actionRef.current.start.x, cursor.x);
      const y = Math.min(actionRef.current.start.y, cursor.y);
      const width = Math.abs(cursor.x - actionRef.current.start.x);
      const height = Math.abs(cursor.y - actionRef.current.start.y);
      ctx.beginPath();
      ctx.roundRect(x, y, width, height, 12);
      ctx.fillStyle = accentLight;
      ctx.globalAlpha = 0.7;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = accent;
      ctx.stroke();
    }
    if (!previewMode && polyDraft.length) {
      ctx.beginPath();
      ctx.moveTo(polyDraft[0].x, polyDraft[0].y);
      polyDraft.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
      if (cursor) ctx.lineTo(cursor.x, cursor.y);
      ctx.strokeStyle = accent;
      ctx.setLineDash([8, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (!previewMode && pathDraft.length) {
      ctx.beginPath();
      ctx.moveTo(pathDraft[0].x, pathDraft[0].y);
      pathDraft.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
      if (cursor) ctx.lineTo(cursor.x, cursor.y);
      ctx.strokeStyle = accent;
      ctx.setLineDash([8, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (measure?.start && measure.end) {
      ctx.beginPath();
      ctx.moveTo(measure.start.x, measure.start.y);
      ctx.lineTo(measure.end.x, measure.end.y);
      ctx.strokeStyle = warn;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
  }, [bgImage, buildingIndustry, cursor, measure, model, pan, pathDraft, polyDraft, previewMode, previewView, selectionId, selected, viewport, visibleElements, zoom]);

  const drawTools = TOOLS.filter((entry) => entry.group === "Draw");
  const editTools = TOOLS.filter(
    (entry) => entry.group === "Edit" && entry.id !== "resize",
  );
  const showHelp = !selected || showHelpPanel;
  const roomColorPresets = [
    "#2563EB",
    "#16A34A",
    "#D97706",
    "#DC2626",
    "#7C3AED",
    "#0F766E",
  ];
  const orderedElements = [...model.elements].reverse();
  const readinessIssues = navigationIssues(model);

  return (
    <div className="map-editor">
      <aside className="map-editor__rail">
        <section className="map-editor__panel">
          <button
            type="button"
            onClick={() => toggleSection("draw")}
            className="map-editor__section-toggle"
          >
            <span>Draw Tools</span>
            <ChevronDown
              className={`h-4 w-4 transition-transform ${sections.draw ? "" : "-rotate-90"}`}
            />
          </button>
          {sections.draw && (
            <div className="map-editor__section-body">
              <div className="map-editor__tool-list">
                {drawTools.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      disabled={previewMode}
                      onClick={() => activate(item.id)}
                      className={`map-editor__tool ${tool === item.id ? "is-active" : ""}`}
                    >
                      <span className="map-editor__tool-label">
                        <Icon className="h-4 w-4" />
                        <span>{item.label}</span>
                      </span>
                      <span className="map-editor__tool-key">{item.key}</span>
                    </button>
                  );
                })}
              </div>

              <div className="map-editor__divider" />

              <div className="section-label">Room Shape</div>
              <div className="map-editor__shape-switch">
                <button
                  type="button"
                  disabled={previewMode}
                  onClick={() => setShape("rect")}
                  className={`map-editor__toggle ${shape === "rect" ? "is-active" : ""}`}
                >
                  <RectangleHorizontal className="h-4 w-4" />
                  Rectangle
                </button>
                <button
                  type="button"
                  disabled={previewMode}
                  onClick={() => setShape("polygon")}
                  className={`map-editor__toggle ${shape === "polygon" ? "is-active" : ""}`}
                >
                  <LayoutGrid className="h-4 w-4" />
                  Polygon
                </button>
              </div>

              <div className="section-label">Room Type</div>
              <div className="map-editor__search">
                <Search className="h-4 w-4 text-muted" />
                <input
                  value={typeSearch}
                  onChange={(event) => setTypeSearch(event.target.value)}
                  placeholder="Search room types"
                />
              </div>
              <div className="map-editor__type-grid">
                {roomTypes.map((entry) => {
                  const Icon = resolvePoiIcon(entry.icon);
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      disabled={previewMode}
                      onClick={() => setDraftType(entry.id)}
                      className={`map-editor__type-button ${draftType === entry.id ? "is-active" : ""}`}
                    >
                      <Icon className="h-4 w-4" />
                      {entry.label}
                    </button>
                  );
                })}
              </div>
              {draftType === "custom" && (
                <div>
                  <label className="field-label">Custom Label</label>
                  <input
                    className="input"
                    value={draftCustomLabel}
                    disabled={previewMode}
                    onChange={(event) => setDraftCustomLabel(event.target.value)}
                    placeholder="Quiet Room"
                  />
                </div>
              )}
            </div>
          )}
        </section>

        <section className="map-editor__panel">
          <button
            type="button"
            onClick={() => toggleSection("edit")}
            className="map-editor__section-toggle"
          >
            <span>Edit Tools</span>
            <ChevronDown
              className={`h-4 w-4 transition-transform ${sections.edit ? "" : "-rotate-90"}`}
            />
          </button>
          {sections.edit && (
            <div className="map-editor__section-body">
              <div className="map-editor__tool-list">
                {editTools.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      disabled={previewMode && item.id !== "select"}
                      onClick={() => activate(item.id)}
                      className={`map-editor__tool ${tool === item.id ? "is-active" : ""}`}
                    >
                      <span className="map-editor__tool-label">
                        <Icon className="h-4 w-4" />
                        <span>{item.label}</span>
                      </span>
                      <span className="map-editor__tool-key">
                        {item.id === "select" ? "S / Esc" : item.key}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        <section className="map-editor__panel">
          <button
            type="button"
            onClick={() => toggleSection("view")}
            className="map-editor__section-toggle"
          >
            <span>View Tools</span>
            <ChevronDown
              className={`h-4 w-4 transition-transform ${sections.view ? "" : "-rotate-90"}`}
            />
          </button>
          {sections.view && (
            <div className="map-editor__section-body">
              <div className="map-editor__tool-list">
                <button type="button" onClick={fitView} className="map-editor__tool">
                  <span className="map-editor__tool-label">
                    <SearchCheck className="h-4 w-4" />
                    <span>Fit to Screen</span>
                  </span>
                  <span className="map-editor__tool-key">F</span>
                </button>
                <button
                  type="button"
                  onClick={() => mutate((next) => { next.showLabels = !next.showLabels; }, false)}
                  className={`map-editor__tool ${model.showLabels ? "is-active" : ""}`}
                >
                  <span className="map-editor__tool-label">
                    <Layers className="h-4 w-4" />
                    <span>Toggle Labels</span>
                  </span>
                  <span className="map-editor__tool-key">L</span>
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="map-editor__panel">
          <button
            type="button"
            onClick={() => toggleSection("layers")}
            className="map-editor__section-toggle"
          >
            <span>Layers / Elements</span>
            <ChevronDown
              className={`h-4 w-4 transition-transform ${sections.layers ? "" : "-rotate-90"}`}
            />
          </button>
          {sections.layers && (
            <div className="map-editor__section-body">
              {orderedElements.length === 0 ? (
                <p className="text-sm subtle-text">No elements yet. Start drawing.</p>
              ) : (
                <div className="map-editor__layer-list">
                  {orderedElements.map((element) => {
                    const Icon = iconForElement(element);
                    const hidden = Boolean(hiddenIds[element.id]);

                    return (
                      <div
                        key={element.id}
                        className={`map-editor__layer-item group ${selectionId === element.id ? "is-active" : ""}`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setSelectionId(element.id);
                            setShowHelpPanel(false);
                            setTool("select");
                          }}
                          className="min-w-0 flex flex-1 items-center gap-2 truncate text-left"
                        >
                          <Icon className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{elementTitle(element, buildingIndustry)}</span>
                        </button>
                        <button
                          type="button"
                          title={hidden ? "Show element" : "Hide element"}
                          aria-label={hidden ? "Show element" : "Hide element"}
                          onClick={() => toggleVisibility(element.id)}
                          className="map-editor__layer-visibility"
                        >
                          {hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </section>

        <section className="map-editor__panel">
          <button
            type="button"
            onClick={() => toggleSection("utilities")}
            className="map-editor__section-toggle"
          >
            <span>Utilities</span>
            <ChevronDown
              className={`h-4 w-4 transition-transform ${sections.utilities ? "" : "-rotate-90"}`}
            />
          </button>
          {sections.utilities && (
            <div className="map-editor__section-body">
              <div className="map-editor__utility-row">
                <button
                  type="button"
                  disabled={previewMode}
                  onClick={() => bgInputRef.current?.click()}
                  className="map-editor__mini-button"
                >
                  <ImagePlus className="h-4 w-4" />
                  Background
                </button>
                <button
                  type="button"
                  disabled={previewMode}
                  onClick={() => jsonInputRef.current?.click()}
                  className="map-editor__mini-button"
                >
                  <Import className="h-4 w-4" />
                  Import
                </button>
              </div>
              <div className="map-editor__utility-row">
                <button type="button" onClick={exportJson} className="map-editor__mini-button">
                  <Download className="h-4 w-4" />
                  Export
                </button>
                <button
                  type="button"
                  disabled={previewMode}
                  onClick={() => activate("measure")}
                  className="map-editor__mini-button"
                >
                  <PencilRuler className="h-4 w-4" />
                  Measure
                </button>
              </div>
              <div className="map-editor__utility-row">
                <button
                  type="button"
                  disabled={previewMode}
                  onClick={autoWaypoints}
                  className="map-editor__mini-button"
                >
                  <Sparkles className="h-4 w-4" />
                  Auto Waypoints
                </button>
                <button type="button" onClick={validate} className="map-editor__mini-button">
                  <Check className="h-4 w-4" />
                  Validate
                </button>
              </div>
              <div>
                <label className="field-label">Scale (pixels / meter)</label>
                <input
                  className="input"
                  type="number"
                  step="0.1"
                  disabled={previewMode}
                  value={model.pixelsPerMeter || ""}
                  onChange={(event) => mutate((next) => {
                    const value = Number.parseFloat(event.target.value);
                    next.pixelsPerMeter = Number.isFinite(value) && value > 0 ? value : null;
                  }, false)}
                  placeholder="50"
                />
              </div>
            </div>
          )}
        </section>
      </aside>

      <section className="map-editor__canvas">
        <div
          ref={wrapRef}
          className="map-editor__canvas-inner"
          style={{
            backgroundImage: model.showGrid
              ? "linear-gradient(0deg, color-mix(in srgb, var(--color-border) 28%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--color-border) 28%, transparent) 1px, transparent 1px)"
              : "none",
            backgroundSize: `${GRID * zoom}px ${GRID * zoom}px`,
            cursor:
              previewMode
                ? "default"
                : tool === "delete"
                ? "not-allowed"
                : tool === "move"
                  ? "grab"
                  : tool === "resize"
                    ? "nwse-resize"
                    : tool === "select"
                      ? "default"
                      : "crosshair",
          }}
        >
          <canvas ref={canvasRef} onPointerDown={down} onPointerMove={move} onPointerUp={up} onDoubleClick={dbl} onWheel={(event) => {
            event.preventDefault();
            zoomBy(event.deltaY > 0 ? 0.9 : 1.1, { x: event.nativeEvent.offsetX, y: event.nativeEvent.offsetY });
          }} />
          {previewMode && (
            <div className="pointer-events-none absolute left-3 top-3 z-10">
              <span className="badge-neutral">
                <Eye className="h-3.5 w-3.5" />
                Preview mode
              </span>
            </div>
          )}
          {!previewMode && (
            <div className="pointer-events-none absolute left-3 top-3 z-10">
              <span className="badge-neutral">
                <MousePointer2 className="h-3.5 w-3.5" />
                {tool === "room" && shape === "polygon"
                  ? "Click to add corners. Double-click to finish."
                  : tool === "path"
                    ? "Click waypoints to draw a path."
                    : tool === "measure"
                      ? "Click two points to measure."
                      : "Select or draw on the canvas."}
              </span>
            </div>
          )}
          {measure && (
            <div className="pointer-events-none absolute right-3 top-3 z-10">
              <span className="badge-neutral">
                <PencilRuler className="h-3.5 w-3.5" />
                {measure.pixels?.toFixed(0) || 0} px
                {measure.meters ? ` | ${measure.meters.toFixed(1)} m` : ""}
              </span>
            </div>
          )}
        </div>
      </section>

      <aside className="map-editor__aside">
        <section className="map-editor__panel">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="map-editor__panel-title">
                {showHelp ? "How To Use The Editor" : `${selected?.kind || "Selection"} Properties`}
              </h2>
              <p className="map-editor__property-text">
                {showHelp
                  ? "Shortcuts, guidance, and map overlay alignment."
                  : "Update the selected element details."}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {selected && !showHelp && (
                <button type="button" onClick={() => setSelectionId(null)} className="btn-ghost px-3">
                  <X className="h-4 w-4" />
                </button>
              )}
              {selected && (
                <button
                  type="button"
                  title="Show help"
                  aria-label="Show help"
                  onClick={() => setShowHelpPanel((current) => !current)}
                  className="btn-ghost px-3"
                >
                  <HelpCircle className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
          {showHelp ? (
            <div className="map-editor__property-grid mt-4">
              <div>
                <div className="section-label">Drawing</div>
                <div className="map-editor__help-list mt-3">
                  <div className="map-editor__help-row"><span className="map-editor__key-pill">R</span><span>Room — Click and drag to draw a room</span></div>
                  <div className="map-editor__help-row"><span className="map-editor__key-pill">D</span><span>Door — Click on a wall to place a door</span></div>
                  <div className="map-editor__help-row"><span className="map-editor__key-pill">W</span><span>Waypoint — Click to place a navigation point</span></div>
                  <div className="map-editor__help-row"><span className="map-editor__key-pill">P</span><span>Path — Click waypoints to connect them</span></div>
                </div>
              </div>

              <div className="map-editor__divider" />

              <div>
                <div className="section-label">Editing</div>
                <div className="map-editor__help-list mt-3">
                  <div className="map-editor__help-row"><span className="map-editor__key-pill">S</span><span>Select — Click any element to select</span></div>
                  <div className="map-editor__help-row"><span className="map-editor__key-pill">M</span><span>Move — Drag selected elements</span></div>
                  <div className="map-editor__help-row"><span className="map-editor__key-pill">Del</span><span>Delete — Remove selected element</span></div>
                  <div className="map-editor__help-row"><span className="map-editor__key-pill">Ctrl+Z</span><span>Undo / Ctrl+Y redo</span></div>
                </div>
              </div>

              <div className="map-editor__divider" />

              <div>
                <div className="section-label">Canvas</div>
                <div className="map-editor__help-list mt-3">
                  <div className="map-editor__help-row"><span className="map-editor__key-pill">Scroll</span><span>Zoom in / out</span></div>
                  <div className="map-editor__help-row"><span className="map-editor__key-pill">Middle</span><span>Drag to pan canvas</span></div>
                  <div className="map-editor__help-row"><span className="map-editor__key-pill">F</span><span>Fit all elements to screen</span></div>
                  <div className="map-editor__help-row"><span className="map-editor__key-pill">L</span><span>Toggle room labels</span></div>
                </div>
              </div>

              <div className="map-editor__divider" />

              <div>
                <div className="section-label">Tips</div>
                <ul className="map-editor__tips mt-3">
                  <li>Draw rooms first, then place doors on walls.</li>
                  <li>Connect waypoints with paths for navigation routing.</li>
                  <li>Every room needs at least one waypoint inside it for routing to work.</li>
                  <li>Use Fit to Screen if you lose your place.</li>
                </ul>
              </div>

              <div className="map-editor__divider" />

              <div>
                <div className="section-label">Overlay Alignment</div>
                <p className="mt-2 text-xs subtle-text">
                  Add north, south, east, and west bounds to anchor this floor on the live map.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {["north", "south", "west", "east"].map((key) => (
                    <div key={key}>
                      <label className="field-label capitalize">{key}</label>
                      <input
                        className="input"
                        type="number"
                        step="any"
                        disabled={previewMode}
                        value={model.overlayBounds?.[key] ?? ""}
                        onChange={(event) => updateOverlayBound(key, event.target.value)}
                        placeholder={key === "north" || key === "south" ? "23.02887" : "72.55078"}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="map-editor__divider" />

              <div>
                <div className="section-label">Navigation Readiness</div>
                <div className="mt-3 rounded-lg border border-default bg-surface-alt px-3 py-3 text-xs text-secondary">
                  <div className="flex items-center justify-between">
                    <span>Rooms</span>
                    <span>{model.elements.filter((element) => element.kind === "room").length}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span>Waypoints</span>
                    <span>{model.elements.filter((element) => element.kind === "waypoint").length}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span>Paths</span>
                    <span>{model.elements.filter((element) => element.kind === "path").length}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span>Beacons</span>
                    <span>{model.elements.filter((element) => element.kind === "beacon").length}</span>
                  </div>
                </div>
                <div className="mt-3 grid gap-2">
                  {readinessIssues.length === 0 ? (
                    <div className="rounded-lg border border-[color:rgba(34,197,94,0.25)] bg-[color:rgba(34,197,94,0.08)] px-3 py-2 text-xs text-secondary">
                      This floor is ready for search, routing, overlay alignment, and positioning tests.
                    </div>
                  ) : (
                    readinessIssues.map((issue) => (
                      <div key={issue} className="rounded-lg border border-default bg-surface-alt px-3 py-2 text-xs text-secondary">
                        {issue}
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="map-editor__divider" />

              <div>
                <div className="section-label">3D Preview</div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div>
                    <label className="field-label">Wall Height</label>
                    <input
                      className="input"
                      type="number"
                      step="0.1"
                      disabled={previewMode}
                      value={model.threeD?.wallHeight ?? 3.2}
                      onChange={(event) =>
                        mutate((next) => {
                          next.threeD = next.threeD || {};
                          next.threeD.wallHeight = event.target.value;
                        }, false)
                      }
                    />
                  </div>
                  <div>
                    <label className="field-label">Extrusion</label>
                    <input
                      className="input"
                      type="number"
                      step="0.1"
                      disabled={previewMode}
                      value={model.threeD?.extrusionHeight ?? 3.2}
                      onChange={(event) =>
                        mutate((next) => {
                          next.threeD = next.threeD || {};
                          next.threeD.extrusionHeight = event.target.value;
                        }, false)
                      }
                    />
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="map-editor__property-grid mt-6">
              {selected.kind !== "path" && selected.kind !== "beacon" && (
                <div>
                  <label className="field-label">Name</label>
                  <input className="input" disabled={previewMode} value={selected.name || ""} onChange={(event) => updateElement(selected.id, (element) => { element.name = event.target.value; })} placeholder="Main Lobby" />
                </div>
              )}
              {selected.kind === "room" && (
                <>
                  <div className="section-label">Room Properties</div>
                  <div>
                    <label className="field-label">Type</label>
                    <select
                      className="select"
                      disabled={previewMode}
                      value={selected.roomType || defaultRoomType(buildingIndustry)}
                      onChange={(event) =>
                        updateElement(selected.id, (element) => {
                          element.roomType = event.target.value;
                          if (event.target.value !== "custom") {
                            element.customLabel = "";
                            element.customValue = "";
                          }
                        })
                      }
                    >
                      {getRoomTypes(buildingIndustry).map((entry) => {
                        return (
                          <option key={entry.id} value={entry.id}>
                            {entry.label}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  {selected.roomType === "custom" && (
                    <div>
                      <label className="field-label">Custom Label</label>
                      <input className="input" disabled={previewMode} value={selected.customLabel || ""} onChange={(event) => updateElement(selected.id, (element) => {
                        element.customLabel = event.target.value;
                        element.customValue = slugify(event.target.value);
                      })} placeholder="Quiet Room" />
                    </div>
                  )}
                  <div>
                    <label className="field-label">Description</label>
                    <textarea className="textarea" rows={2} disabled={previewMode} value={selected.description || ""} onChange={(event) => updateElement(selected.id, (element) => { element.description = event.target.value; })} placeholder="Helpful notes for destination search." />
                  </div>
                  <div>
                    <label className="field-label">Color</label>
                    <div className="flex flex-wrap items-center gap-2">
                      {roomColorPresets.map((color) => (
                        <button
                          key={color}
                          type="button"
                          disabled={previewMode}
                          onClick={() => updateElement(selected.id, (element) => { element.color = color; })}
                          className={`map-editor__color-swatch ${(selected.color || "#2563EB").toLowerCase() === color.toLowerCase() ? "is-active" : ""}`}
                          style={{ background: color }}
                        />
                      ))}
                      <input type="color" disabled={previewMode} className="map-editor__color-input" value={selected.color || "#2563eb"} onChange={(event) => updateElement(selected.id, (element) => { element.color = event.target.value; })} />
                      <button type="button" disabled={previewMode} onClick={() => updateElement(selected.id, (element) => { element.color = ""; })} className="map-editor__mini-button">
                        Reset
                      </button>
                    </div>
                  </div>
                  <div className="map-editor__divider" />
                  <div className="section-label">Accessibility</div>
                  <div className="grid gap-2">
                    <button type="button" disabled={previewMode} onClick={() => updateElement(selected.id, (element) => { element.wheelchairAccessible = !element.wheelchairAccessible; })} className={`map-editor__toggle ${selected.wheelchairAccessible ? "is-active" : ""}`}><Accessibility className="h-4 w-4" />Wheelchair accessible</button>
                    <button type="button" disabled={previewMode} onClick={() => updateElement(selected.id, (element) => { element.publicAccess = !element.publicAccess; })} className={`map-editor__toggle ${selected.publicAccess ? "is-active" : ""}`}><Check className="h-4 w-4" />Public access</button>
                  </div>
                </>
              )}
              {selected.kind === "door" && (
                <>
                  <div className="section-label">Door Properties</div>
                  <div>
                    <label className="field-label">Type</label>
                    <select className="select" disabled={previewMode} value={selected.doorType || "main_entrance"} onChange={(event) => updateElement(selected.id, (element) => { element.doorType = event.target.value; })}>
                      <option value="main_entrance">Main Entrance</option>
                      <option value="emergency_exit">Emergency Exit</option>
                      <option value="staff_only">Staff Only</option>
                      <option value="fire_door">Fire Door</option>
                      <option value="custom">Custom</option>
                    </select>
                  </div>
                  <div>
                    <label className="field-label">Width (m)</label>
                    <input className="input" type="number" step="0.1" disabled={previewMode} value={selected.widthMeters ?? ""} onChange={(event) => updateElement(selected.id, (element) => { element.widthMeters = event.target.value; })} placeholder="1.2" />
                  </div>
                  <div className="map-editor__divider" />
                  <div className="section-label">Accessibility</div>
                  <div className="grid gap-2">
                    <button type="button" disabled={previewMode} onClick={() => updateElement(selected.id, (element) => { element.accessible = !element.accessible; })} className={`map-editor__toggle ${selected.accessible ? "is-active" : ""}`}><Accessibility className="h-4 w-4" />Accessible</button>
                    <button type="button" disabled={previewMode} onClick={() => updateElement(selected.id, (element) => { element.locked = !element.locked; })} className={`map-editor__toggle ${selected.locked ? "is-active" : ""}`}><Check className="h-4 w-4" />Locked by default</button>
                  </div>
                </>
              )}
              {selected.kind === "waypoint" && (
                <>
                  <div className="section-label">Waypoint Properties</div>
                  <div>
                    <label className="field-label">Type</label>
                    <select className="select" disabled={previewMode} value={selected.transitionType === "elevator" || selected.transitionType === "stairs" ? selected.transitionType : selected.waypointType || "junction"} onChange={(event) => updateElement(selected.id, (element) => {
                      const value = event.target.value;
                      if (value === "elevator" || value === "stairs") {
                        element.transitionType = value;
                        element.waypointType = "junction";
                      } else {
                        element.transitionType = "none";
                        element.waypointType = value;
                      }
                    })}>
                      <option value="entrance">Entrance</option>
                      <option value="junction">Junction</option>
                      <option value="destination">Destination</option>
                      <option value="elevator">Elevator</option>
                      <option value="stairs">Stairs</option>
                      <option value="custom">Custom</option>
                    </select>
                  </div>
                  {selected.waypointType === "custom" && (
                    <div>
                      <label className="field-label">Custom Label</label>
                      <input className="input" disabled={previewMode} value={selected.customWaypointLabel || ""} onChange={(event) => updateElement(selected.id, (element) => { element.customWaypointLabel = event.target.value; })} placeholder="Transfer Point" />
                    </div>
                  )}
                  <div>
                    <label className="field-label">Floor Connection</label>
                    <select className="select" disabled={previewMode} value={selected.linkedFloorId || ""} onChange={(event) => updateElement(selected.id, (element) => { element.linkedFloorId = event.target.value || null; })}>
                      <option value="">No linked floor</option>
                      {floors.filter((floor) => floor.id !== floorData?.id).map((floor) => <option key={floor.id} value={floor.id}>{floor.name}</option>)}
                    </select>
                  </div>
                </>
              )}
              {selected.kind === "path" && (
                <>
                  <div className="section-label">Path Properties</div>
                  <div>
                    <label className="field-label">Label</label>
                    <input className="input" disabled={previewMode} value={selected.name || ""} onChange={(event) => updateElement(selected.id, (element) => { element.name = event.target.value; })} placeholder="Optional" />
                  </div>
                  <div className="grid gap-2">
                    <button type="button" disabled={previewMode} onClick={() => updateElement(selected.id, (element) => { element.bidirectional = true; })} className={`map-editor__toggle ${selected.bidirectional ? "is-active" : ""}`}><GitBranch className="h-4 w-4" />Bidirectional</button>
                    <button type="button" disabled={previewMode} onClick={() => updateElement(selected.id, (element) => { element.bidirectional = false; })} className={`map-editor__toggle ${!selected.bidirectional ? "is-active" : ""}`}><Spline className="h-4 w-4" />One-way</button>
                  </div>
                  <div className="grid gap-2">
                    <button type="button" disabled={previewMode} onClick={() => updateElement(selected.id, (element) => { element.accessible = !element.accessible; })} className={`map-editor__toggle ${selected.accessible ? "is-active" : ""}`}><Accessibility className="h-4 w-4" />Accessible route</button>
                    <button type="button" disabled={previewMode} onClick={() => updateElement(selected.id, (element) => { element.staffOnly = !element.staffOnly; })} className={`map-editor__toggle ${selected.staffOnly ? "is-active" : ""}`}><Check className="h-4 w-4" />Staff only</button>
                  </div>
                </>
              )}
              {selected.kind === "beacon" && (
                <>
                  <div className="section-label">Beacon Properties</div>
                  <div>
                    <label className="field-label">Beacon Name</label>
                    <input className="input" disabled={previewMode} value={selected.name || ""} onChange={(event) => updateElement(selected.id, (element) => { element.name = event.target.value; })} placeholder="Entrance Beacon" />
                  </div>
                  <div>
                    <label className="field-label">Hardware ID</label>
                    <input className="input" disabled={previewMode} value={selected.beaconId || ""} onChange={(event) => updateElement(selected.id, (element) => { element.beaconId = event.target.value; })} placeholder="BEACON-01" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="field-label">Radius (m)</label>
                      <input className="input" type="number" step="0.1" disabled={previewMode} value={selected.radiusMeters ?? ""} onChange={(event) => updateElement(selected.id, (element) => { element.radiusMeters = event.target.value; })} placeholder="2.5" />
                    </div>
                    <div>
                      <label className="field-label">TX Power</label>
                      <input className="input" type="number" step="1" disabled={previewMode} value={selected.txPower ?? ""} onChange={(event) => updateElement(selected.id, (element) => { element.txPower = event.target.value; })} placeholder="-59" />
                    </div>
                  </div>
                  <div>
                    <label className="field-label">Notes</label>
                    <textarea className="textarea" rows={2} disabled={previewMode} value={selected.notes || ""} onChange={(event) => updateElement(selected.id, (element) => { element.notes = event.target.value; })} placeholder="Mounted near the main corridor ceiling." />
                  </div>
                </>
              )}
              <div className="map-editor__divider" />
              <div className="section-label">Actions</div>
              <div className="map-editor__utility-row">
                {selected.kind !== "path" && (
                  <button
                    type="button"
                    disabled={previewMode}
                    onClick={() => {
                      const source = clone(selected);
                      const duplicate = {
                        ...source,
                        id: uuidv4(),
                        x: source.x !== undefined ? source.x + 24 : source.x,
                        y: source.y !== undefined ? source.y + 24 : source.y,
                        points: source.points?.map((point) => ({ x: point.x + 24, y: point.y + 24 })),
                      };
                      addElement(duplicate);
                    }}
                    className="map-editor__mini-button"
                  >
                    Duplicate
                  </button>
                )}
                <button type="button" disabled={previewMode} onClick={removeSelected} className="map-editor__mini-button is-danger"><Trash2 className="h-4 w-4" />Delete</button>
              </div>
            </div>
          )}
        </section>
        {false && (
        <section className="map-editor__panel">
          <h2 className="map-editor__panel-title">Live Summary</h2>
          <div className="map-editor__meta-list">
            <div className="rounded-lg border border-default bg-surface-alt px-3 py-3 text-sm text-secondary">
              <div className="flex items-center justify-between"><span>Rooms / POIs</span><span>{model.elements.filter((element) => element.kind === "room").length}</span></div>
              <div className="mt-2 flex items-center justify-between"><span>Waypoints</span><span>{model.elements.filter((element) => element.kind === "waypoint").length}</span></div>
              <div className="mt-2 flex items-center justify-between"><span>Paths</span><span>{model.elements.filter((element) => element.kind === "path").length}</span></div>
              <div className="mt-2 flex items-center justify-between"><span>Doors</span><span>{model.elements.filter((element) => element.kind === "door").length}</span></div>
            </div>
            {measure && (
              <div className="rounded-lg border border-default bg-surface-alt px-3 py-3 text-sm text-secondary">
                <div className="font-medium text-primary">Latest Measurement</div>
                <div className="mt-2">{measure.pixels?.toFixed(0) || 0} px{measure.meters ? ` · ${measure.meters.toFixed(1)} m` : ""}</div>
              </div>
            )}
            <div className="rounded-lg border border-default bg-surface-alt px-3 py-3 text-sm text-secondary">
              <div className="font-medium text-primary">{dirty ? "Unsaved changes" : "Saved state"}</div>
              <div className="mt-2">Undo: {undoCount} · Redo: {redoCount}</div>
            </div>
          </div>
        </section>
        )}
      </aside>

      <input ref={bgInputRef} type="file" accept="image/*" className="hidden" onChange={uploadBackground} />
      <input ref={jsonInputRef} type="file" accept=".json,application/json" className="hidden" onChange={importJson} />
    </div>
  );
});

export default MapEditor;
