import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Stage,
  Layer,
  Line,
  Circle,
  Rect,
  Text,
  Group,
  Image as KonvaImage,
  Transformer,
} from "react-konva";
import { v4 as uuidv4, validate as uuidValidate } from "uuid";
import toast from "react-hot-toast";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  DoorOpen,
  Download,
  Eraser,
  Eye,
  EyeOff,
  GitBranch,
  Grid,
  Import,
  MapPin,
  Magnet,
  Minus,
  Move,
  Pencil,
  Plus,
  Save,
  Sparkles,
  Square,
  Trash2,
} from "lucide-react";
import { api } from "../utils/api.js";

const AI_OPTIONS = [
  {
    key: "walls",
    label: "Walls",
    description: "Detects structural wall lines from the floor plan",
    defaultValue: true,
  },
  {
    key: "doors",
    label: "Doors",
    description: "Finds door openings between spaces",
    defaultValue: true,
  },
  {
    key: "windows",
    label: "Windows",
    description: "Identifies window segments on exterior walls",
    defaultValue: true,
  },
  {
    key: "connections",
    label: "Nav Edges",
    description: "Builds the walkable navigation graph",
    defaultValue: false,
  },
  {
    key: "objects",
    label: "AI Objects",
    description: "Detects stairs, elevators, restrooms (beta)",
    defaultValue: false,
  },
  {
    key: "locationsOnRooms",
    label: "Locations on Rooms",
    description: "Places location pins at room centers",
    defaultValue: false,
  },
  {
    key: "locationsOnObjects",
    label: "Locations on Objects",
    description: "Places pins on detected objects",
    defaultValue: false,
  },
  {
    key: "locationsOnConnections",
    label: "Locations on Connections",
    description: "Places pins at corridor intersections",
    defaultValue: false,
  },
];

const AI_STEPS = ["Preprocessing", "Walls", "Rooms", "Graph", "Done"];

const GRID_SCREEN_SIZE = 20;
const MIN_ROOM_SIZE = 20;
const ROOM_DUPLICATE_OFFSET = 24;
const POLYGON_CLOSE_DISTANCE = 12;
const WALL_HOVER_DISTANCE = 15;
const LAYER_VISIBILITY_DEFAULTS = {
  rooms: true,
  doors: true,
  waypoints: true,
  paths: true,
  grid: true,
  background: true,
};

const ROOM_TYPE_OPTIONS = [
  { value: "room", label: "Classroom / Room" },
  { value: "office", label: "Office" },
  { value: "lab", label: "Lab" },
  { value: "corridor", label: "Corridor" },
  { value: "stairs", label: "Stairs" },
  { value: "elevator", label: "Elevator" },
  { value: "restroom", label: "Restroom" },
  { value: "exit", label: "Exit" },
  { value: "other", label: "Other" },
  { value: "entrance", label: "Entrance" },
  { value: "canteen", label: "Canteen" },
  { value: "store", label: "Store" },
  { value: "atm", label: "ATM" },
  { value: "emergency", label: "Emergency" },
  { value: "parking", label: "Parking" },
];

const ROOM_TYPE_STYLES = {
  room: { fill: "#E8F0F7", selectedFill: "#DBEAF8", stroke: "#94B4CC" },
  office: { fill: "#E5EEF9", selectedFill: "#D8E5F7", stroke: "#8AA8C8" },
  lab: { fill: "#EEE8FA", selectedFill: "#E4D9F7", stroke: "#A38FC7" },
  corridor: { fill: "#ECEFF3", selectedFill: "#E2E8F0", stroke: "#94A3B8" },
  stairs: { fill: "#FFF1E2", selectedFill: "#FFE3C2", stroke: "#F59E0B" },
  elevator: { fill: "#F1EAFE", selectedFill: "#E6DBFF", stroke: "#8B5CF6" },
  restroom: { fill: "#E7F5F1", selectedFill: "#D3ECE5", stroke: "#14B8A6" },
  exit: { fill: "#E8F7EC", selectedFill: "#D5F0DD", stroke: "#22C55E" },
  other: { fill: "#E8F0F7", selectedFill: "#DBEAF8", stroke: "#94B4CC" },
  entrance: { fill: "#E8F7EC", selectedFill: "#D5F0DD", stroke: "#16A34A" },
  canteen: { fill: "#FFF4E6", selectedFill: "#FFE6BF", stroke: "#F59E0B" },
  store: { fill: "#F1EAFE", selectedFill: "#E6DBFF", stroke: "#8B5CF6" },
  atm: { fill: "#E8F0F7", selectedFill: "#DBEAF8", stroke: "#3B82F6" },
  emergency: { fill: "#FEEAEA", selectedFill: "#FBD5D5", stroke: "#EF4444" },
  parking: { fill: "#E9EFF5", selectedFill: "#DCE6F0", stroke: "#64748B" },
};

const ROOM_COLOR_SWATCHES = [
  "#E8F0F7",
  "#E5EEF9",
  "#EEE8FA",
  "#ECEFF3",
  "#FFF1E2",
  "#F1EAFE",
  "#E7F5F1",
  "#E8F7EC",
  "#FEEAEA",
];

const WAYPOINT_TYPE_OPTIONS = [
  { value: "room_center", label: "Room Center" },
  { value: "corridor", label: "Corridor" },
  { value: "stairs", label: "Stairs" },
  { value: "elevator", label: "Elevator" },
  { value: "exit", label: "Exit" },
  { value: "entrance", label: "Entrance" },
];

const WAYPOINT_TYPE_COLORS = {
  room_center: "#2563EB",
  corridor: "#94A3B8",
  stairs: "#F59E0B",
  elevator: "#8B5CF6",
  exit: "#22C55E",
  entrance: "#16A34A",
};

const PRIMARY_TOOL_OPTIONS = [
  {
    id: "select",
    label: "Select",
    key: "V",
    Icon: Move,
    tooltip: "Select items and drag to pan",
  },
  {
    id: "room",
    label: "Room",
    key: "R",
    Icon: Square,
    tooltip: "Draw rectangle rooms with click and drag",
  },
  {
    id: "polygon",
    label: "Polygon",
    key: "P",
    Icon: Pencil,
    tooltip: "Draw polygon rooms vertex by vertex",
  },
  {
    id: "door",
    label: "Door",
    key: "D",
    Icon: DoorOpen,
    tooltip: "Place doors on room walls",
  },
  {
    id: "waypoint",
    label: "Waypoint",
    key: "W",
    Icon: MapPin,
    tooltip: "Place navigation waypoints",
  },
  {
    id: "path",
    label: "Path",
    key: "C",
    Icon: GitBranch,
    tooltip: "Connect waypoints with paths",
  },
  {
    id: "erase",
    label: "Erase",
    key: "E",
    Icon: Eraser,
    tooltip: "Delete any clicked element",
  },
];

const TOOL_KEYS = {
  v: "select",
  r: "room",
  p: "polygon",
  d: "door",
  w: "waypoint",
  c: "path",
  e: "erase",
};

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function ensureUuid(value) {
  return uuidValidate(value) ? value : uuidv4();
}

function emptyCollection() {
  return { type: "FeatureCollection", features: [] };
}

function buildEmptyMvf(width = 2000, height = 1500, floorLabel = "Floor") {
  return {
    spaces: emptyCollection(),
    obstructions: emptyCollection(),
    openings: emptyCollection(),
    nodes: emptyCollection(),
    objects: emptyCollection(),
    meta: {
      imageWidth: width,
      imageHeight: height,
      pixelsPerMeter: 20,
      floorLabel,
    },
  };
}

function isMvf(value) {
  return (
    value &&
    value.spaces?.type === "FeatureCollection" &&
    value.obstructions?.type === "FeatureCollection" &&
    value.openings?.type === "FeatureCollection" &&
    value.nodes?.type === "FeatureCollection" &&
    value.objects?.type === "FeatureCollection"
  );
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function angleSnap(start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return end;
  const angle = Math.atan2(dy, dx);
  const snappedAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
  return {
    x: start.x + length * Math.cos(snappedAngle),
    y: start.y + length * Math.sin(snappedAngle),
  };
}

function toPointFromCoords(coords) {
  return {
    x: Number(coords?.[0] || 0),
    y: Number(coords?.[1] || 0),
  };
}

function toCoords(point) {
  return [Number(point.x || 0), Number(point.y || 0)];
}

function flatten(points) {
  return points.flatMap((point) => [point.x, point.y]);
}

function distanceBetween(a, b) {
  return Math.hypot((a?.x || 0) - (b?.x || 0), (a?.y || 0) - (b?.y || 0));
}

function polygonCenter(points) {
  if (!points.length) return { x: 0, y: 0 };
  const total = points.reduce(
    (acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
    { x: 0, y: 0 },
  );
  return {
    x: total.x / points.length,
    y: total.y / points.length,
  };
}

function polygonBounds(points) {
  if (!points.length) return { x: 0, y: 0, width: 0, height: 0 };
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

function truncateLabel(value, maxLength = 18) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function roomTypeStyle(kind) {
  return ROOM_TYPE_STYLES[String(kind || "room").toLowerCase()] || ROOM_TYPE_STYLES.room;
}

function roomTypeLabel(kind) {
  const match = ROOM_TYPE_OPTIONS.find((entry) => entry.value === kind);
  return match?.label || "Room";
}

function waypointTypeLabel(kind) {
  const match = WAYPOINT_TYPE_OPTIONS.find((entry) => entry.value === kind);
  return match?.label || "Waypoint";
}

function roomPolygon(feature) {
  const ring = feature?.geometry?.coordinates?.[0] || [];
  if (!Array.isArray(ring) || ring.length < 4) return [];
  return ring.slice(0, -1).map(toPointFromCoords);
}

function edgeKey(a, b) {
  return [String(a || ""), String(b || "")].sort().join(":");
}

function safeGridStep(scale) {
  return GRID_SCREEN_SIZE / Math.max(0.2, Number(scale) || 1);
}

function snapValue(value, step) {
  if (!Number.isFinite(step) || step <= 0) return value;
  return Math.round(value / step) * step;
}

function snapPointToGrid(point, step) {
  return {
    x: snapValue(point.x, step),
    y: snapValue(point.y, step),
  };
}

function nearest(list, point, maxDist = 10) {
  let best = null;
  let bestDist = Infinity;
  for (const entry of list) {
    const distance = Math.hypot(entry.x - point.x, entry.y - point.y);
    if (distance < bestDist) {
      bestDist = distance;
      best = entry;
    }
  }
  return bestDist <= maxDist ? best : null;
}

function projectPointToSegment(point, start, end) {
  const vx = end.x - start.x;
  const vy = end.y - start.y;
  const len2 = vx * vx + vy * vy;
  if (len2 <= 0.0001) {
    return {
      point: { ...start },
      t: 0,
      distance: distanceBetween(point, start),
      angle: 0,
    };
  }

  const t = clamp(
    ((point.x - start.x) * vx + (point.y - start.y) * vy) / len2,
    0,
    1,
  );
  const projected = { x: start.x + t * vx, y: start.y + t * vy };
  return {
    point: projected,
    t,
    distance: distanceBetween(point, projected),
    angle: (Math.atan2(vy, vx) * 180) / Math.PI,
  };
}

function roomSegments(feature) {
  const points = roomPolygon(feature);
  if (points.length < 2) return [];

  return points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    const projection = projectPointToSegment(point, point, next);
    return {
      roomId: feature.id,
      roomName: feature.properties?.name || "Room",
      edgeIndex: index,
      start: point,
      end: next,
      angle: projection.angle,
    };
  });
}

function findNearestRoomWall(point, rooms, maxDistance) {
  let best = null;

  rooms.forEach((feature) => {
    roomSegments(feature).forEach((segment) => {
      const projected = projectPointToSegment(point, segment.start, segment.end);
      if (!best || projected.distance < best.distance) {
        best = {
          ...segment,
          point: projected.point,
          offset: projected.t,
          distance: projected.distance,
          angle: projected.angle,
        };
      }
    });
  });

  if (!best || best.distance > maxDistance) return null;
  return best;
}

function nearestWallProjection(point, walls) {
  let best = null;
  let bestDistance = Infinity;

  for (const wall of walls) {
    const coords = wall?.geometry?.coordinates;
    if (!coords || coords.length < 2) continue;

    const a = toPointFromCoords(coords[0]);
    const b = toPointFromCoords(coords[1]);
    const projected = projectPointToSegment(point, a, b);

    if (projected.distance < bestDistance) {
      bestDistance = projected.distance;
      best = {
        point: projected.point,
        wallAngle: projected.angle,
        distance: projected.distance,
      };
    }
  }

  return best;
}

function resolveDoorPlacement(feature, roomMap) {
  const linkedRoomId =
    feature?.properties?.linkedRoomId || feature?.properties?.linked_room_id;
  const edgeIndex = Number(
    feature?.properties?.edgeIndex ?? feature?.properties?.edge_index,
  );
  const offset = clamp(
    Number(feature?.properties?.offset ?? 0.5) || 0.5,
    0,
    1,
  );

  if (linkedRoomId && Number.isInteger(edgeIndex)) {
    const room = roomMap.get(linkedRoomId);
    const segment = room ? roomSegments(room)[edgeIndex] : null;
    if (segment) {
      return {
        point: {
          x: segment.start.x + (segment.end.x - segment.start.x) * offset,
          y: segment.start.y + (segment.end.y - segment.start.y) * offset,
        },
        wallAngle: segment.angle,
        roomName: room.properties?.name || "Room",
        roomId: linkedRoomId,
        offset,
        edgeIndex,
      };
    }
  }

  return {
    point: toPointFromCoords(feature?.geometry?.coordinates),
    wallAngle: Number(feature?.properties?.rotation || 0) - 90,
    roomName: feature?.properties?.roomName || "Room",
    roomId: linkedRoomId || null,
    offset,
    edgeIndex: Number.isInteger(edgeIndex) ? edgeIndex : null,
  };
}

function syncDoorsForRoom(next, roomId) {
  const room = next.spaces.features.find((feature) => feature.id === roomId);
  if (!room) return;

  const roomMap = new Map([[room.id, room]]);

  next.openings.features.forEach((feature) => {
    if (feature.properties?.kind !== "door") return;
    const linkedRoomId =
      feature.properties?.linkedRoomId || feature.properties?.linked_room_id;
    if (linkedRoomId !== roomId) return;

    const placement = resolveDoorPlacement(feature, roomMap);
    feature.geometry.coordinates = [placement.point.x, placement.point.y];
    feature.properties.rotation = placement.wallAngle + 90;
    feature.properties.roomName = placement.roomName;
  });
}

function collectWorldBounds(mvf, backgroundImage) {
  const points = [];

  mvf.spaces.features.forEach((feature) => {
    points.push(...roomPolygon(feature));
  });

  mvf.obstructions.features.forEach((feature) => {
    const coords = feature.geometry?.coordinates || [];
    coords.forEach((coord) => points.push(toPointFromCoords(coord)));
  });

  mvf.openings.features.forEach((feature) => {
    points.push(toPointFromCoords(feature.geometry?.coordinates));
  });

  mvf.nodes.features.forEach((feature) => {
    points.push(toPointFromCoords(feature.geometry?.coordinates));
  });

  if (backgroundImage || mvf.meta?.imageWidth || mvf.meta?.imageHeight) {
    points.push({ x: 0, y: 0 });
    points.push({
      x: Number(mvf.meta?.imageWidth || backgroundImage?.width || 0),
      y: Number(mvf.meta?.imageHeight || backgroundImage?.height || 0),
    });
  }

  if (!points.length) {
    return { x: 0, y: 0, width: 1200, height: 760 };
  }

  return polygonBounds(points);
}

function buildMvfFromFloor(floorData) {
  if (isMvf(floorData?.map_data)) {
    return deepClone(floorData.map_data);
  }

  const width = Number(floorData?.floor_plan_width || 2000);
  const height = Number(floorData?.floor_plan_height || 1500);
  const mvf = buildEmptyMvf(width, height, floorData?.name || "Floor");

  const rooms = Array.isArray(floorData?.rooms) ? floorData.rooms : [];
  for (const room of rooms) {
    const polygon =
      Array.isArray(room.polygon_points) && room.polygon_points.length >= 3
        ? room.polygon_points.map((point) => [point.x, point.y])
        : [
            [room.x, room.y],
            [room.x + room.width, room.y],
            [room.x + room.width, room.y + room.height],
            [room.x, room.y + room.height],
          ];

    mvf.spaces.features.push({
      type: "Feature",
      id: ensureUuid(room.id),
      properties: {
        kind: room.type || "room",
        category: room.type || "other",
        name: room.name || "Room",
        color: room.color || roomTypeStyle(room.type || "room").fill,
        description: room.description || "",
        entrances: [],
      },
      geometry: {
        type: "Polygon",
        coordinates: [
          polygon.length &&
          polygon[0][0] === polygon[polygon.length - 1][0] &&
          polygon[0][1] === polygon[polygon.length - 1][1]
            ? polygon
            : [...polygon, polygon[0]],
        ],
      },
    });
  }

  const waypoints = Array.isArray(floorData?.waypoints)
    ? floorData.waypoints
    : [];
  const pointById = new Map();

  for (const waypoint of waypoints) {
    const id = ensureUuid(waypoint.id);
    pointById.set(id, waypoint);
    mvf.nodes.features.push({
      type: "Feature",
      id,
      properties: {
        kind: "waypoint",
        type: waypoint.type || (waypoint.room_id ? "room_center" : "corridor"),
        name: waypoint.name || "",
        spaceId: waypoint.room_id || null,
        linkedFloorId: waypoint.linked_floor_id || null,
        neighbors: [],
      },
      geometry: { type: "Point", coordinates: [waypoint.x, waypoint.y] },
    });
  }

  const nodeById = new Map(
    mvf.nodes.features.map((feature) => [feature.id, feature]),
  );

  const connections = Array.isArray(floorData?.connections)
    ? floorData.connections
    : [];
  for (const connection of connections) {
    const a = nodeById.get(connection.waypoint_a_id);
    const b = nodeById.get(connection.waypoint_b_id);
    if (!a || !b) continue;
    const pointA = toPointFromCoords(a.geometry.coordinates);
    const pointB = toPointFromCoords(b.geometry.coordinates);
    const weight = Math.round(distanceBetween(pointA, pointB));
    a.properties.neighbors.push({ id: b.id, weight });
    b.properties.neighbors.push({ id: a.id, weight });
  }

  return mvf;
}

function dedupeEdges(nodes) {
  const edges = [];
  const seen = new Set();
  for (const node of nodes) {
    const neighbors = ensureArray(node.properties?.neighbors);
    for (const neighbor of neighbors) {
      const key = edgeKey(node.id, neighbor.id);
      if (!key || seen.has(key) || node.id === neighbor.id) continue;
      seen.add(key);
      edges.push({
        from: String(node.id),
        to: String(neighbor.id),
        weight: Number(neighbor.weight || 1),
      });
    }
  }
  return edges;
}

function buildSavePayload(mvf) {
  const rooms = mvf.spaces.features.map((feature) => {
    const polygon = roomPolygon(feature);
    const bounds = polygonBounds(polygon);
    return {
      id: ensureUuid(feature.id),
      name: feature.properties?.name || "Room",
      type: feature.properties?.kind || feature.properties?.category || "other",
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      color: feature.properties?.color || null,
      description: feature.properties?.description || "",
      polygon_points: polygon,
    };
  });

  const waypoints = mvf.nodes.features.map((feature, index) => ({
    id: ensureUuid(feature.id),
    x: Number(feature.geometry?.coordinates?.[0] || 0),
    y: Number(feature.geometry?.coordinates?.[1] || 0),
    type:
      feature.properties?.type ||
      (feature.properties?.spaceId ? "room_center" : "corridor"),
    room_id: feature.properties?.spaceId || null,
    name: feature.properties?.name || `Waypoint ${index + 1}`,
    linked_floor_id:
      feature.properties?.linkedFloorId ||
      feature.properties?.linked_floor_id ||
      null,
  }));

  const connections = dedupeEdges(mvf.nodes.features).map((edge) => ({
    id: uuidv4(),
    waypoint_a_id: edge.from,
    waypoint_b_id: edge.to,
  }));

  return {
    rooms,
    waypoints,
    connections,
    map_data: mvf,
    scale_pixels_per_meter: Number(mvf.meta?.pixelsPerMeter || 20),
  };
}

function AiModal({
  open,
  running,
  options,
  scope,
  step,
  onClose,
  onRun,
  onToggle,
  onScope,
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[950] flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">
            AI MAPPING
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1 text-slate-600 hover:bg-slate-100"
          >
            x
          </button>
        </div>

        <div className="mt-4">
          <h3 className="text-base font-semibold text-slate-900">
            Run AI Mapping
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            Detect editable walls, doors, windows, rooms, navigation edges, and
            spatial objects from the uploaded floor plan.
          </p>
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => onScope("current_floor")}
            className={`rounded-md px-4 py-2 text-sm ${
              scope === "current_floor"
                ? "bg-blue-600 text-white"
                : "bg-slate-100 text-slate-700"
            }`}
          >
            Current Floor
          </button>
          <button
            type="button"
            onClick={() => onScope("all_floors")}
            className={`rounded-md px-4 py-2 text-sm ${
              scope === "all_floors"
                ? "bg-blue-600 text-white"
                : "bg-slate-100 text-slate-700"
            }`}
          >
            All Floors
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2">
          {AI_OPTIONS.map((entry) => (
            <label
              key={entry.key}
              className="rounded-lg border border-slate-200 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-slate-800">
                  {entry.label}
                </span>
                <input
                  type="checkbox"
                  checked={Boolean(options[entry.key])}
                  disabled={running}
                  onChange={() => onToggle(entry.key)}
                />
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {entry.description}
              </div>
            </label>
          ))}
        </div>

        <div className="mt-5">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            Progress
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {AI_STEPS.map((name, index) => (
              <div
                key={name}
                className={`rounded-md border px-3 py-1 text-xs ${
                  index <= step
                    ? "border-blue-200 bg-blue-50 text-blue-700"
                    : "border-slate-200 bg-white text-slate-500"
                }`}
              >
                {name}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={running}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onRun}
            disabled={running}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white"
          >
            {running ? "Running..." : "Run AI Mapping"}
          </button>
        </div>
      </div>
    </div>
  );
}

const MapEditor = forwardRef(function MapEditor(
  {
    floorData,
    floors = [],
    onSave,
    onStateChange,
    previewMode = false,
    autoOpenAiMapping = false,
  },
  ref,
) {
  const stageRef = useRef(null);
  const containerRef = useRef(null);
  const fileInputRef = useRef(null);
  const importInputRef = useRef(null);
  const transformerRef = useRef(null);
  const nameInputRef = useRef(null);
  const roomRefs = useRef(new Map());
  const mvfRef = useRef(null);
  const scaleRef = useRef(1);
  const positionRef = useRef({ x: 40, y: 40 });

  const [mvf, setMvf] = useState(() => buildMvfFromFloor(floorData));
  const [tool, setTool] = useState("select");
  const [roomKind, setRoomKind] = useState("room");
  const [layerVisibility, setLayerVisibility] = useState(
    LAYER_VISIBILITY_DEFAULTS,
  );
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [selection, setSelection] = useState(null);
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 40, y: 40 });
  const [size, setSize] = useState({ width: 1200, height: 760 });
  const [drawing, setDrawing] = useState(null);
  const [polygonDraft, setPolygonDraft] = useState([]);
  const [pathDraft, setPathDraft] = useState(null);
  const [history, setHistory] = useState([]);
  const [future, setFuture] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [cursor, setCursor] = useState(null);
  const [backgroundImage, setBackgroundImage] = useState(null);
  const [backgroundOpacity, setBackgroundOpacity] = useState(0.4);
  const [contextMenu, setContextMenu] = useState(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [spacePressed, setSpacePressed] = useState(false);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiStep, setAiStep] = useState(0);
  const [aiRunning, setAiRunning] = useState(false);
  const [aiScope, setAiScope] = useState("current_floor");
  const [aiOptions, setAiOptions] = useState(() =>
    AI_OPTIONS.reduce(
      (acc, option) => ({ ...acc, [option.key]: option.defaultValue }),
      {},
    ),
  );

  mvfRef.current = mvf;
  scaleRef.current = scale;
  positionRef.current = position;

  useEffect(() => {
    const next = buildMvfFromFloor(floorData);
    setMvf(next);
    setHistory([]);
    setFuture([]);
    setDirty(false);
    setSelection(null);
    setDrawing(null);
    setPolygonDraft([]);
    setPathDraft(null);
    setContextMenu(null);
    setTool("select");
    setScale(1);
    setPosition({ x: 40, y: 40 });
    setLayerVisibility(LAYER_VISIBILITY_DEFAULTS);
    setSnapEnabled(true);
  }, [floorData]);

  useEffect(() => {
    setAdvancedOpen(false);
  }, [selection?.id, selection?.kind]);

  useEffect(() => {
    if (!autoOpenAiMapping) return;
    setAiModalOpen(true);
  }, [autoOpenAiMapping]);

  useEffect(() => {
    if (previewMode) {
      setDrawing(null);
      setPolygonDraft([]);
      setPathDraft(null);
      setContextMenu(null);
    }
  }, [previewMode]);

  useEffect(() => {
    const source = floorData?.floor_plan_url || null;
    if (!source) {
      setBackgroundImage(null);
      return;
    }

    let cancelled = false;
    const image = new window.Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      if (!cancelled) setBackgroundImage(image);
    };
    image.onerror = () => {
      if (!cancelled) setBackgroundImage(null);
    };
    image.src = source;
    return () => {
      cancelled = true;
    };
  }, [floorData?.floor_plan_url]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const roomMap = useMemo(
    () => new Map(mvf.spaces.features.map((feature) => [feature.id, feature])),
    [mvf.spaces.features],
  );

  const openingMap = useMemo(
    () =>
      new Map(mvf.openings.features.map((feature) => [feature.id, feature])),
    [mvf.openings.features],
  );

  const wallMap = useMemo(
    () =>
      new Map(mvf.obstructions.features.map((feature) => [feature.id, feature])),
    [mvf.obstructions.features],
  );

  const waypointMap = useMemo(
    () => new Map(mvf.nodes.features.map((feature) => [feature.id, feature])),
    [mvf.nodes.features],
  );

  const navEdges = useMemo(
    () =>
      dedupeEdges(mvf.nodes.features)
        .map((edge) => ({
          ...edge,
          key: edgeKey(edge.from, edge.to),
          source: waypointMap.get(edge.from),
          target: waypointMap.get(edge.to),
        }))
        .filter((edge) => edge.source && edge.target),
    [mvf.nodes.features, waypointMap],
  );

  const counts = useMemo(
    () => ({
      rooms: mvf.spaces.features.length,
      waypoints: mvf.nodes.features.length,
      paths: navEdges.length,
      doors: mvf.openings.features.filter(
        (feature) => feature.properties?.kind === "door",
      ).length,
      beacons: 0,
    }),
    [mvf.nodes.features.length, mvf.openings.features, mvf.spaces.features.length, navEdges.length],
  );

  const gridStep = safeGridStep(scale);
  const polygonCloseTarget =
    tool === "polygon" &&
    polygonDraft.length >= 3 &&
    cursor &&
    distanceBetween(cursor, polygonDraft[0]) <= POLYGON_CLOSE_DISTANCE / scale;

  const hoveredDoorTarget = useMemo(() => {
    if (tool !== "door" || !cursor) return null;
    return findNearestRoomWall(
      cursor,
      mvf.spaces.features,
      WALL_HOVER_DISTANCE / Math.max(scale, 0.2),
    );
  }, [cursor, mvf.spaces.features, scale, tool]);

  const allSelectableIds = useMemo(
    () => [
      ...mvf.spaces.features.map((feature) => feature.id),
      ...mvf.obstructions.features.map((feature) => feature.id),
      ...mvf.openings.features.map((feature) => feature.id),
      ...mvf.nodes.features.map((feature) => feature.id),
    ],
    [mvf.nodes.features, mvf.obstructions.features, mvf.openings.features, mvf.spaces.features],
  );

  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) return;

    if (selection?.kind !== "room") {
      transformer.nodes([]);
      transformer.getLayer()?.batchDraw();
      return;
    }

    const node = roomRefs.current.get(selection.id);
    if (!node) {
      transformer.nodes([]);
      transformer.getLayer()?.batchDraw();
      return;
    }

    transformer.nodes([node]);
    transformer.getLayer()?.batchDraw();
  }, [mvf, selection]);

  const getWorldPoint = (event) => {
    const stage = event?.target?.getStage?.() || stageRef.current;
    const pointer = stage?.getPointerPosition();
    if (!pointer) return null;
    return {
      x: (pointer.x - positionRef.current.x) / scaleRef.current,
      y: (pointer.y - positionRef.current.y) / scaleRef.current,
    };
  };

  const snapWorldPoint = (point) => {
    if (!point) return null;
    return snapEnabled
      ? snapPointToGrid(point, safeGridStep(scaleRef.current))
      : point;
  };

  const focusNameField = () => {
    window.requestAnimationFrame(() => {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    });
  };

  const setToolMode = (nextTool) => {
    if (previewMode && nextTool !== "select") return;
    setTool(nextTool);
    setContextMenu(null);
    if (nextTool !== "polygon") setPolygonDraft([]);
    if (nextTool !== "path") setPathDraft(null);
    if (nextTool !== "room" && nextTool !== "wall") setDrawing(null);
  };

  const pushHistoryState = (previousState) => {
    setHistory((current) => [...current, deepClone(previousState)].slice(-80));
    setFuture([]);
    setDirty(true);
  };

  const updateMvf = (updater, track = true) => {
    setMvf((current) => {
      const next = deepClone(current);
      updater(next);
      if (track) {
        pushHistoryState(current);
      }
      return next;
    });
  };

  const undo = () => {
    setHistory((current) => {
      if (!current.length) return current;
      const previous = current[current.length - 1];
      setFuture((futureState) =>
        [deepClone(mvfRef.current), ...futureState].slice(0, 80),
      );
      setMvf(deepClone(previous));
      setDirty(true);
      return current.slice(0, -1);
    });
    setSelection(null);
    setContextMenu(null);
  };

  const redo = () => {
    setFuture((current) => {
      if (!current.length) return current;
      const [next, ...rest] = current;
      setHistory((historyState) =>
        [...historyState, deepClone(mvfRef.current)].slice(-80),
      );
      setMvf(deepClone(next));
      setDirty(true);
      return rest;
    });
    setSelection(null);
    setContextMenu(null);
  };

  const writeRoomPoints = (feature, points) => {
    const ring = points.map(toCoords);
    const closed =
      ring[0][0] === ring[ring.length - 1][0] &&
      ring[0][1] === ring[ring.length - 1][1]
        ? ring
        : [...ring, ring[0]];
    feature.geometry.coordinates = [closed];
  };

  const updateRoomFeature = (id, updater, track = true) => {
    updateMvf((next) => {
      const feature = next.spaces.features.find((entry) => entry.id === id);
      if (!feature) return;
      updater(feature, next);
      syncDoorsForRoom(next, id);
    }, track);
  };

  const updateOpeningFeature = (id, updater, track = true) => {
    updateMvf((next) => {
      const feature = next.openings.features.find((entry) => entry.id === id);
      if (!feature) return;
      updater(feature, next);
    }, track);
  };

  const updateWaypointFeature = (id, updater, track = true) => {
    updateMvf((next) => {
      const feature = next.nodes.features.find((entry) => entry.id === id);
      if (!feature) return;
      updater(feature, next);
    }, track);
  };

  const updateWallFeature = (id, updater, track = true) => {
    updateMvf((next) => {
      const feature = next.obstructions.features.find((entry) => entry.id === id);
      if (!feature) return;
      updater(feature, next);
    }, track);
  };

  const nextRoomName = (spaces = mvfRef.current.spaces.features) =>
    `Room ${spaces.length + 1}`;

  const addRectangleRoom = (start, end) => {
    const x1 = Math.min(start.x, end.x);
    const y1 = Math.min(start.y, end.y);
    const x2 = Math.max(start.x, end.x);
    const y2 = Math.max(start.y, end.y);
    if (Math.abs(x2 - x1) < MIN_ROOM_SIZE || Math.abs(y2 - y1) < MIN_ROOM_SIZE) {
      return;
    }

    const id = uuidv4();
    const type = roomKind || "room";
    const style = roomTypeStyle(type);

    updateMvf((next) => {
      next.spaces.features.push({
        type: "Feature",
        id,
        properties: {
          kind: type,
          category: type,
          name: nextRoomName(next.spaces.features),
          color: style.fill,
          description: "",
          entrances: [],
        },
        geometry: {
          type: "Polygon",
          coordinates: [[[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]]],
        },
      });
    });

    setSelection({ kind: "room", id });
    setTool("select");
    focusNameField();
  };

  const addPolygonRoom = (points) => {
    if (points.length < 3) return;

    const id = uuidv4();
    const type = roomKind || "room";
    const style = roomTypeStyle(type);
    const ring = points.map(toCoords);
    const closed =
      ring[0][0] === ring[ring.length - 1][0] &&
      ring[0][1] === ring[ring.length - 1][1]
        ? ring
        : [...ring, ring[0]];

    updateMvf((next) => {
      next.spaces.features.push({
        type: "Feature",
        id,
        properties: {
          kind: type,
          category: type,
          name: nextRoomName(next.spaces.features),
          color: style.fill,
          description: "",
          entrances: [],
        },
        geometry: { type: "Polygon", coordinates: [closed] },
      });
    });

    setSelection({ kind: "room", id });
    setTool("select");
    setPolygonDraft([]);
    focusNameField();
  };

  const addRoomAtPoint = (point) => {
    const snapped = snapWorldPoint(point);
    if (!snapped) return;
    addRectangleRoom(
      { x: snapped.x - 60, y: snapped.y - 40 },
      { x: snapped.x + 60, y: snapped.y + 40 },
    );
  };

  const addWall = (start, end) => {
    if (distanceBetween(start, end) < MIN_ROOM_SIZE) return;
    updateMvf((next) => {
      next.obstructions.features.push({
        type: "Feature",
        id: uuidv4(),
        properties: { kind: "wall", thickness: 4 },
        geometry: {
          type: "LineString",
          coordinates: [toCoords(start), toCoords(end)],
        },
      });
    });
  };

  const addWindow = (point) => {
    const nearestWall =
      nearestWallProjection(point, mvfRef.current.obstructions.features) ||
      findNearestRoomWall(
        point,
        mvfRef.current.spaces.features,
        WALL_HOVER_DISTANCE / Math.max(scaleRef.current, 0.2),
      );

    const placement = nearestWall?.point || point;
    const rotation = nearestWall?.wallAngle ?? nearestWall?.angle ?? 0;
    const id = uuidv4();

    updateMvf((next) => {
      next.openings.features.push({
        type: "Feature",
        id,
        properties: {
          kind: "window",
          width: 30,
          rotation,
        },
        geometry: { type: "Point", coordinates: [placement.x, placement.y] },
      });
    });

    setSelection({ kind: "window", id });
  };

  const addDoorFromWall = (wallTarget) => {
    if (!wallTarget) return;
    const id = uuidv4();
    updateMvf((next) => {
      next.openings.features.push({
        type: "Feature",
        id,
        properties: {
          kind: "door",
          width: 16,
          rotation: wallTarget.angle + 90,
          linkedRoomId: wallTarget.roomId,
          roomName: wallTarget.roomName,
          edgeIndex: wallTarget.edgeIndex,
          offset: wallTarget.offset,
          doorType: "both",
          label: "Door",
        },
        geometry: {
          type: "Point",
          coordinates: [wallTarget.point.x, wallTarget.point.y],
        },
      });
    });

    setSelection({ kind: "door", id });
  };

  const addWaypoint = (point) => {
    const id = uuidv4();
    updateMvf((next) => {
      next.nodes.features.push({
        type: "Feature",
        id,
        properties: {
          kind: "waypoint",
          type: "corridor",
          name: `Waypoint ${next.nodes.features.length + 1}`,
          spaceId: null,
          neighbors: [],
        },
        geometry: { type: "Point", coordinates: [point.x, point.y] },
      });
    });
    setSelection({ kind: "waypoint", id });
  };

  const connectWaypoints = (aId, bId) => {
    if (!aId || !bId || aId === bId) return;

    updateMvf((next) => {
      const source = next.nodes.features.find((feature) => feature.id === aId);
      const target = next.nodes.features.find((feature) => feature.id === bId);
      if (!source || !target) return;

      const sourcePoint = toPointFromCoords(source.geometry.coordinates);
      const targetPoint = toPointFromCoords(target.geometry.coordinates);
      const weight = Math.round(distanceBetween(sourcePoint, targetPoint));

      const sourceNeighbors = ensureArray(source.properties?.neighbors);
      const targetNeighbors = ensureArray(target.properties?.neighbors);

      if (!sourceNeighbors.some((entry) => entry.id === target.id)) {
        sourceNeighbors.push({ id: target.id, weight });
      }
      if (!targetNeighbors.some((entry) => entry.id === source.id)) {
        targetNeighbors.push({ id: source.id, weight });
      }

      source.properties.neighbors = sourceNeighbors;
      target.properties.neighbors = targetNeighbors;
    });
  };

  const removePathEdge = (key) => {
    const edge = navEdges.find((entry) => entry.key === key);
    if (!edge) return;

    updateMvf((next) => {
      const source = next.nodes.features.find((feature) => feature.id === edge.from);
      const target = next.nodes.features.find((feature) => feature.id === edge.to);
      if (source) {
        source.properties.neighbors = ensureArray(source.properties?.neighbors).filter(
          (entry) => entry.id !== edge.to,
        );
      }
      if (target) {
        target.properties.neighbors = ensureArray(target.properties?.neighbors).filter(
          (entry) => entry.id !== edge.from,
        );
      }
    });
  };

  const removeIds = (ids) => {
    if (!ids.length) return;
    const idSet = new Set(ids);

    updateMvf((next) => {
      const removedRoomIds = new Set(
        next.spaces.features
          .filter((feature) => idSet.has(feature.id))
          .map((feature) => feature.id),
      );

      next.spaces.features = next.spaces.features.filter(
        (feature) => !idSet.has(feature.id),
      );
      next.obstructions.features = next.obstructions.features.filter(
        (feature) => !idSet.has(feature.id),
      );
      next.openings.features = next.openings.features.filter((feature) => {
        const linkedRoomId =
          feature.properties?.linkedRoomId || feature.properties?.linked_room_id;
        return !idSet.has(feature.id) && !removedRoomIds.has(linkedRoomId);
      });
      next.nodes.features = next.nodes.features.filter(
        (feature) => !idSet.has(feature.id),
      );

      next.nodes.features.forEach((feature) => {
        feature.properties.neighbors = ensureArray(feature.properties?.neighbors).filter(
          (entry) => !idSet.has(entry.id),
        );
        if (removedRoomIds.has(feature.properties?.spaceId)) {
          feature.properties.spaceId = null;
        }
      });
    });
  };

  const removeSelection = (target = selection, options = {}) => {
    if (!target) return;

    if (target.kind === "multi") {
      removeIds(target.ids || []);
      setSelection(null);
      return;
    }

    if (target.kind === "path") {
      removePathEdge(target.id);
      setSelection(null);
      return;
    }

    if (options.confirm && target.kind === "room") {
      const ok = window.confirm("Delete this room?");
      if (!ok) return;
    }

    if (options.confirm && target.kind === "waypoint") {
      const feature = waypointMap.get(target.id);
      if (ensureArray(feature?.properties?.neighbors).length) {
        const ok = window.confirm(
          "Delete this waypoint and all of its connections?",
        );
        if (!ok) return;
      }
    }

    removeIds([target.id]);
    setSelection(null);
  };

  const duplicateSelectedRoom = (roomId = selection?.id) => {
    if (!roomId) return;
    const feature = roomMap.get(roomId);
    if (!feature) return;

    const id = uuidv4();
    const points = roomPolygon(feature).map((point) => ({
      x: point.x + ROOM_DUPLICATE_OFFSET,
      y: point.y + ROOM_DUPLICATE_OFFSET,
    }));

    updateMvf((next) => {
      next.spaces.features.push({
        type: "Feature",
        id,
        properties: {
          ...deepClone(feature.properties || {}),
          name: `${feature.properties?.name || "Room"} Copy`,
        },
        geometry: {
          type: "Polygon",
          coordinates: [[...points.map(toCoords), toCoords(points[0])]],
        },
      });
    });

    setSelection({ kind: "room", id });
    focusNameField();
  };

  const updateSelectedName = (value) => {
    if (!selection || selection.kind === "path" || selection.kind === "multi") {
      return;
    }

    if (selection.kind === "room") {
      updateRoomFeature(selection.id, (feature) => {
        feature.properties.name = value;
      });
      return;
    }

    if (selection.kind === "waypoint") {
      updateWaypointFeature(selection.id, (feature) => {
        feature.properties.name = value;
      });
      return;
    }

    if (selection.kind === "door") {
      updateOpeningFeature(selection.id, (feature) => {
        feature.properties.label = value;
      });
    }
  };

  const updateRoomKind = (value) => {
    if (selection?.kind !== "room") return;
    updateRoomFeature(selection.id, (feature) => {
      const previousKind = feature.properties?.kind || "room";
      const previousDefault = roomTypeStyle(previousKind).fill;
      const nextDefault = roomTypeStyle(value).fill;
      feature.properties.kind = value;
      feature.properties.category = value;
      if (!feature.properties.color || feature.properties.color === previousDefault) {
        feature.properties.color = nextDefault;
      }
    });
  };

  const updateRoomDescription = (value) => {
    if (selection?.kind !== "room") return;
    updateRoomFeature(selection.id, (feature) => {
      feature.properties.description = value;
    });
  };

  const updateRoomColor = (value) => {
    if (selection?.kind !== "room") return;
    updateRoomFeature(selection.id, (feature) => {
      feature.properties.color = value;
    });
  };

  const updateDoorType = (value) => {
    if (selection?.kind !== "door") return;
    updateOpeningFeature(selection.id, (feature) => {
      feature.properties.doorType = value;
    });
  };

  const updateWaypointType = (value) => {
    if (selection?.kind !== "waypoint") return;
    updateWaypointFeature(selection.id, (feature) => {
      feature.properties.type = value;
    });
  };

  const exportMvf = () => {
    const blob = new Blob([JSON.stringify(mvfRef.current, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${floorData?.name || "floor"}-mvf.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importMvf = (file) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || "{}"));
        if (!isMvf(parsed)) throw new Error("Invalid MVF JSON");
        setMvf(parsed);
        setHistory([]);
        setFuture([]);
        setDirty(true);
        setSelection(null);
        toast.success("MVF imported.");
      } catch (error) {
        toast.error(error.message || "Failed to import MVF");
      }
    };
    reader.readAsText(file);
  };

  const saveMap = async () => {
    if (!onSave) return;
    const payload = buildSavePayload(mvfRef.current);
    await onSave(payload);
    setDirty(false);
  };

  const autoGenerateWaypoints = () => {
    updateMvf((next) => {
      const nodes = [];
      for (const space of next.spaces.features) {
        const center = polygonCenter(roomPolygon(space));
        nodes.push({
          type: "Feature",
          id: uuidv4(),
          properties: {
            kind: "waypoint",
            type: "room_center",
            name: space.properties?.name || `Waypoint ${nodes.length + 1}`,
            spaceId: space.id,
            neighbors: [],
          },
          geometry: { type: "Point", coordinates: [center.x, center.y] },
        });
      }

      for (const node of nodes) {
        const currentPoint = toPointFromCoords(node.geometry.coordinates);
        const nearby = nodes
          .filter((entry) => entry.id !== node.id)
          .map((entry) => ({
            node: entry,
            distance: distanceBetween(
              currentPoint,
              toPointFromCoords(entry.geometry.coordinates),
            ),
          }))
          .sort((a, b) => a.distance - b.distance)
          .slice(0, 2);

        node.properties.neighbors = nearby.map((entry) => ({
          id: entry.node.id,
          weight: Math.round(entry.distance),
        }));
      }

      next.nodes.features = nodes;
    });
    toast.success("Waypoints generated.");
  };

  const validateMap = () => {
    const spaces = mvfRef.current.spaces.features;
    const nodes = mvfRef.current.nodes.features;
    const issues = [];

    if (!spaces.length) issues.push("Add at least one room or corridor.");
    if (
      spaces.some((feature) => !String(feature.properties?.name || "").trim())
    ) {
      issues.push("Name all rooms and corridors.");
    }
    if (!nodes.length) issues.push("Add or auto-generate waypoints.");

    const spaceIds = new Set(spaces.map((feature) => feature.id));
    const mappedSpaceIds = new Set(
      nodes.map((feature) => feature.properties?.spaceId).filter(Boolean),
    );
    for (const id of spaceIds) {
      if (!mappedSpaceIds.has(id)) {
        issues.push("Some spaces do not have waypoints.");
        break;
      }
    }

    if (issues.length) {
      toast.error(issues.join(" "));
      return false;
    }

    toast.success("Validation passed.");
    return true;
  };

  const runAiMapping = async () => {
    if (!floorData?.id) {
      toast.error("Floor id is missing.");
      return;
    }

    setAiRunning(true);
    setAiStep(0);

    try {
      const timer = window.setInterval(() => {
        setAiStep((current) => Math.min(current + 1, AI_STEPS.length - 1));
      }, 400);

      const formData = new FormData();
      formData.append("floor_id", floorData.id);
      formData.append("scope", aiScope);
      formData.append("options", JSON.stringify(aiOptions));

      const response = await api.maps.aiTrace(formData);
      window.clearInterval(timer);
      setAiStep(AI_STEPS.length - 1);

      const resultEntries = Array.isArray(response?.results)
        ? response.results
        : [];
      const completedEntries = resultEntries.filter(
        (entry) => entry?.status === "completed" && isMvf(entry?.result),
      );

      if (resultEntries.length > 0 && completedEntries.length === 0) {
        const detail = resultEntries
          .map((entry) => entry?.message)
          .filter(Boolean)
          .join(" ");
        throw new Error(detail || "AI mapping failed for all selected floors.");
      }

      const result = completedEntries[0]?.result || response?.result;
      if (!isMvf(result)) {
        throw new Error("AI mapping did not return MVF data.");
      }

      setMvf(result);
      setHistory([]);
      setFuture([]);
      setDirty(true);
      setSelection(null);
      setAiModalOpen(false);
      if (resultEntries.some((entry) => entry?.status === "failed")) {
        toast("AI mapping completed with warnings.");
      } else {
        toast.success("AI mapping completed.");
      }
    } catch (error) {
      toast.error(error.message || "AI mapping failed.");
    } finally {
      setAiRunning(false);
    }
  };

  const zoomBy = (factor, pointer = null) => {
    const currentScale = scaleRef.current;
    const currentPosition = positionRef.current;
    const nextScale = clamp(currentScale * factor, 0.2, 6);
    const pivot = pointer || { x: size.width / 2, y: size.height / 2 };
    const worldPoint = {
      x: (pivot.x - currentPosition.x) / currentScale,
      y: (pivot.y - currentPosition.y) / currentScale,
    };

    setScale(nextScale);
    setPosition({
      x: pivot.x - worldPoint.x * nextScale,
      y: pivot.y - worldPoint.y * nextScale,
    });
  };

  const fitToScreen = () => {
    const bounds = collectWorldBounds(mvfRef.current, backgroundImage);
    const safeWidth = Math.max(1, size.width - 80);
    const safeHeight = Math.max(1, size.height - 80);
    const nextScale = clamp(
      Math.min(
        safeWidth / Math.max(bounds.width, 1),
        safeHeight / Math.max(bounds.height, 1),
      ),
      0.2,
      6,
    );

    setScale(nextScale);
    setPosition({
      x: (size.width - bounds.width * nextScale) / 2 - bounds.x * nextScale,
      y: (size.height - bounds.height * nextScale) / 2 - bounds.y * nextScale,
    });
  };

  const toggleLayer = (key) => {
    setLayerVisibility((current) => ({ ...current, [key]: !current[key] }));
  };

  const toggleNavGraph = () => {
    setLayerVisibility((current) => {
      const nextValue = !(current.waypoints && current.paths);
      return {
        ...current,
        waypoints: nextValue,
        paths: nextValue,
      };
    });
  };

  const handleElementActivate = (nextSelection, options = {}) => {
    if (previewMode && tool !== "select") return;

    if (tool === "erase") {
      removeSelection(nextSelection);
      return;
    }

    if (tool === "path" && nextSelection.kind === "waypoint") {
      if (!pathDraft) {
        setPathDraft(nextSelection.id);
      } else if (pathDraft !== nextSelection.id) {
        connectWaypoints(pathDraft, nextSelection.id);
        setPathDraft(nextSelection.id);
      }
      return;
    }

    if (tool === "select" || options.forceSelect) {
      setSelection(nextSelection);
      setContextMenu(null);
    }
  };

  const openContextMenu = (event, target) => {
    if (previewMode) return;
    event.evt.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    const pointer = getWorldPoint(event);
    if (!rect || !pointer) return;

    setContextMenu({
      x: event.evt.clientX - rect.left,
      y: event.evt.clientY - rect.top,
      point: pointer,
      target,
    });
  };

  const handleStageMouseDown = (event) => {
    if (event.evt.button === 2) return;
    setContextMenu(null);

    const stage = event.target.getStage?.();
    const clickedOnEmpty = event.target === stage;
    const point = snapWorldPoint(getWorldPoint(event));
    if (!point || spacePressed) return;

    if (tool === "select" && clickedOnEmpty) {
      setSelection(null);
      return;
    }

    if (previewMode) return;

    if (tool === "room" && clickedOnEmpty) {
      setDrawing({ kind: "room", start: point, end: point });
      return;
    }

    if (tool === "wall" && clickedOnEmpty) {
      setDrawing({ kind: "wall", start: point, end: point });
      return;
    }

    if (tool === "polygon" && clickedOnEmpty) {
      if (polygonCloseTarget) {
        addPolygonRoom(polygonDraft);
        return;
      }
      setPolygonDraft((current) => [...current, point]);
      return;
    }

    if (tool === "door" && clickedOnEmpty) {
      if (!hoveredDoorTarget) return;
      addDoorFromWall(hoveredDoorTarget);
      return;
    }

    if (tool === "window" && clickedOnEmpty) {
      addWindow(point);
      return;
    }

    if (tool === "waypoint" && clickedOnEmpty) {
      addWaypoint(point);
    }
  };

  const handleStageMouseMove = (event) => {
    const point = getWorldPoint(event);
    if (!point) return;
    setCursor(point);
    if (!drawing) return;

    if (drawing.kind === "room") {
      setDrawing((current) => ({ ...current, end: point }));
      return;
    }

    if (drawing.kind === "wall") {
      const end = snapEnabled ? angleSnap(drawing.start, point) : point;
      setDrawing((current) => ({ ...current, end }));
    }
  };

  const handleStageMouseUp = () => {
    if (!drawing) return;
    if (drawing.kind === "room") {
      addRectangleRoom(drawing.start, drawing.end);
    } else if (drawing.kind === "wall") {
      addWall(drawing.start, drawing.end);
    }
    setDrawing(null);
  };

  const handleStageDoubleClick = () => {
    if (previewMode) return;
    if (tool !== "polygon" || polygonDraft.length < 3) return;
    addPolygonRoom(polygonDraft);
  };

  const handleStageContextMenu = (event) => {
    if (event.target !== event.target.getStage?.()) return;
    openContextMenu(event, { kind: "empty" });
  };

  useImperativeHandle(ref, () => ({
    save: saveMap,
    validateMap,
    autoGenerateWaypoints,
    undo,
    redo,
    zoomIn: () => zoomBy(1.12),
    zoomOut: () => zoomBy(0.88),
    setZoom: (value) =>
      setScale(Math.max(0.2, Math.min(6, Number(value) || 1))),
    toggleGrid: () => toggleLayer("grid"),
    toggleSnap: () => setSnapEnabled((value) => !value),
    fitToScreen,
  }));

  useEffect(() => {
    const isEditableTarget = (target) => {
      const tag = String(target?.tagName || "").toLowerCase();
      return (
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        target?.isContentEditable
      );
    };

    const handleKeyDown = (event) => {
      const key = event.key.toLowerCase();

      if (event.code === "Space" && !isEditableTarget(event.target)) {
        setSpacePressed(true);
        event.preventDefault();
      }

      if (isEditableTarget(event.target)) return;

      if ((key === "delete" || key === "backspace") && selection) {
        event.preventDefault();
        removeSelection();
        return;
      }

      if (event.ctrlKey && key === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
        return;
      }

      if (event.ctrlKey && (key === "y" || (event.shiftKey && key === "z"))) {
        event.preventDefault();
        redo();
        return;
      }

      if (event.ctrlKey && key === "a") {
        event.preventDefault();
        if (allSelectableIds.length) {
          setSelection({ kind: "multi", ids: allSelectableIds });
        }
        return;
      }

      if (event.ctrlKey && key === "d") {
        event.preventDefault();
        duplicateSelectedRoom();
        return;
      }

      if (key === "escape") {
        event.preventDefault();
        setToolMode("select");
        setSelection(null);
        return;
      }

      if (key === "=" || key === "+") {
        event.preventDefault();
        zoomBy(1.12);
        return;
      }

      if (key === "-") {
        event.preventDefault();
        zoomBy(0.88);
        return;
      }

      if (key === "g") {
        event.preventDefault();
        toggleLayer("grid");
        return;
      }

      if (key === "n") {
        event.preventDefault();
        toggleNavGraph();
        return;
      }

      const nextTool = TOOL_KEYS[key];
      if (nextTool) {
        event.preventDefault();
        setToolMode(nextTool);
      }
    };

    const handleKeyUp = (event) => {
      if (event.code === "Space") {
        setSpacePressed(false);
      }
    };

    const clearSpace = () => setSpacePressed(false);

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", clearSpace);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", clearSpace);
    };
  }, [allSelectableIds, previewMode, selection, tool]);

  useEffect(() => {
    const dismiss = () => setContextMenu(null);
    window.addEventListener("mousedown", dismiss);
    return () => window.removeEventListener("mousedown", dismiss);
  }, []);

  useEffect(() => {
    if (!onStateChange) return;
    onStateChange({
      tool,
      zoom: scale,
      dirty,
      canUndo: history.length > 0,
      canRedo: future.length > 0,
      showGrid: layerVisibility.grid,
      snapToGrid: snapEnabled,
      cursor,
      selectedElement: selection,
      counts,
      saveStatus: dirty ? "Unsaved" : "Saved",
      readiness:
        counts.rooms > 0 && counts.waypoints > 0 ? "Ready" : "Needs review",
      issues: [],
    });
  }, [
    counts,
    cursor,
    dirty,
    future.length,
    history.length,
    layerVisibility.grid,
    onStateChange,
    scale,
    selection,
    snapEnabled,
    tool,
  ]);

  const selectedRoom = selection?.kind === "room" ? roomMap.get(selection.id) : null;
  const selectedDoor =
    selection?.kind === "door" ? openingMap.get(selection.id) : null;
  const selectedWaypoint =
    selection?.kind === "waypoint" ? waypointMap.get(selection.id) : null;
  const selectedPath =
    selection?.kind === "path"
      ? navEdges.find((edge) => edge.key === selection.id) || null
      : null;

  const connectedWaypointNames = selectedWaypoint
    ? ensureArray(selectedWaypoint.properties?.neighbors)
        .map((entry) => waypointMap.get(entry.id)?.properties?.name || entry.id)
        .filter(Boolean)
    : [];

  const selectedDoorPlacement = selectedDoor
    ? resolveDoorPlacement(selectedDoor, roomMap)
    : null;

  const selectedHeader = (() => {
    if (!selection) {
      return {
        title: floorData?.name || "Map overview",
        badge: "Map",
      };
    }
    if (selection.kind === "multi") {
      return {
        title: `${selection.ids.length} selected`,
        badge: "Multi",
      };
    }
    if (selection.kind === "room" && selectedRoom) {
      return {
        title: selectedRoom.properties?.name || "Room",
        badge: roomTypeLabel(selectedRoom.properties?.kind || "room"),
      };
    }
    if (selection.kind === "door" && selectedDoorPlacement) {
      return {
        title: `Door on ${selectedDoorPlacement.roomName}`,
        badge: "Door",
      };
    }
    if (selection.kind === "waypoint" && selectedWaypoint) {
      return {
        title: selectedWaypoint.properties?.name || "Waypoint",
        badge: waypointTypeLabel(selectedWaypoint.properties?.type || "corridor"),
      };
    }
    if (selection.kind === "path" && selectedPath) {
      return {
        title: `${selectedPath.source?.properties?.name || selectedPath.from} to ${
          selectedPath.target?.properties?.name || selectedPath.to
        }`,
        badge: "Path",
      };
    }
    return {
      title: "Selected item",
      badge: selection.kind,
    };
  })();

  const renderPropertiesForm = () => {
    if (!selection) {
      return (
        <div className="rounded-xl border border-default bg-surface-alt p-3">
          <div className="text-sm font-semibold text-primary">Map stats</div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-secondary">
            <div className="rounded-lg bg-surface px-3 py-2">
              {counts.rooms} rooms
            </div>
            <div className="rounded-lg bg-surface px-3 py-2">
              {counts.doors} doors
            </div>
            <div className="rounded-lg bg-surface px-3 py-2">
              {counts.waypoints} waypoints
            </div>
            <div className="rounded-lg bg-surface px-3 py-2">
              {counts.paths} connections
            </div>
          </div>
        </div>
      );
    }

    if (selection.kind === "multi") {
      return (
        <div className="rounded-xl border border-default bg-surface-alt p-3 text-sm text-secondary">
          {selection.ids.length} elements selected.
        </div>
      );
    }

    if (selectedRoom) {
      const roomColor =
        String(selectedRoom.properties?.color || "").startsWith("#")
          ? selectedRoom.properties.color
          : roomTypeStyle(selectedRoom.properties?.kind || "room").fill;

      return (
        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
              Name
            </label>
            <input
              ref={nameInputRef}
              className="mt-1 w-full rounded-lg border border-default bg-surface px-3 py-2 text-sm"
              value={selectedRoom.properties?.name || ""}
              onChange={(event) => updateSelectedName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                }
              }}
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
              Room type
            </label>
            <select
              className="mt-1 w-full rounded-lg border border-default bg-surface px-3 py-2 text-sm"
              value={selectedRoom.properties?.kind || "room"}
              onChange={(event) => updateRoomKind(event.target.value)}
            >
              {ROOM_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
              Color
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              {ROOM_COLOR_SWATCHES.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  className={`h-7 w-7 rounded-full border ${
                    roomColor === swatch
                      ? "border-blue-600 ring-2 ring-blue-100"
                      : "border-default"
                  }`}
                  style={{ backgroundColor: swatch }}
                  onClick={() => updateRoomColor(swatch)}
                />
              ))}
            </div>
            <input
              type="color"
              className="mt-2 h-10 w-full rounded-lg border border-default bg-surface"
              value={roomColor}
              onChange={(event) => updateRoomColor(event.target.value)}
            />
          </div>
        </div>
      );
    }

    if (selectedDoor && selectedDoorPlacement) {
      return (
        <div className="space-y-3">
          <div className="rounded-xl border border-default bg-surface-alt px-3 py-2 text-sm text-secondary">
            Door on {selectedDoorPlacement.roomName}
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
              Door type
            </label>
            <select
              className="mt-1 w-full rounded-lg border border-default bg-surface px-3 py-2 text-sm"
              value={selectedDoor.properties?.doorType || "both"}
              onChange={(event) => updateDoorType(event.target.value)}
            >
              <option value="entry">Entry</option>
              <option value="exit">Exit</option>
              <option value="both">Both</option>
            </select>
          </div>
          <div className="rounded-xl border border-default bg-surface-alt px-3 py-2 text-xs text-secondary">
            Wall {Number(selectedDoorPlacement.edgeIndex ?? 0) + 1} •{" "}
            {Math.round((selectedDoorPlacement.offset || 0) * 100)}% along edge
          </div>
        </div>
      );
    }

    if (selectedWaypoint) {
      return (
        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
              Name
            </label>
            <input
              ref={nameInputRef}
              className="mt-1 w-full rounded-lg border border-default bg-surface px-3 py-2 text-sm"
              value={selectedWaypoint.properties?.name || ""}
              onChange={(event) => updateSelectedName(event.target.value)}
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
              Waypoint type
            </label>
            <select
              className="mt-1 w-full rounded-lg border border-default bg-surface px-3 py-2 text-sm"
              value={selectedWaypoint.properties?.type || "corridor"}
              onChange={(event) => updateWaypointType(event.target.value)}
            >
              {WAYPOINT_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
              Connected to
            </label>
            <div className="mt-1 rounded-xl border border-default bg-surface-alt px-3 py-2 text-sm text-secondary">
              {connectedWaypointNames.length
                ? connectedWaypointNames.join(", ")
                : "No connections"}
            </div>
          </div>
        </div>
      );
    }

    if (selectedPath) {
      return (
        <div className="rounded-xl border border-default bg-surface-alt px-3 py-3 text-sm text-secondary">
          Path between {selectedPath.source?.properties?.name || selectedPath.from} and{" "}
          {selectedPath.target?.properties?.name || selectedPath.to}
        </div>
      );
    }

    return (
      <div className="rounded-xl border border-default bg-surface-alt px-3 py-3 text-sm text-secondary">
        Select an item to edit it.
      </div>
    );
  };

  const renderActions = () => {
    if (!selection) return null;

    if (selection.kind === "room") {
      return (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-default bg-surface px-3 py-2 text-sm font-medium text-secondary"
            onClick={duplicateSelectedRoom}
          >
            <Copy className="h-4 w-4" />
            Duplicate
          </button>
          <button
            type="button"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white"
            onClick={() => removeSelection(selection, { confirm: true })}
          >
            <Trash2 className="h-4 w-4" />
            Delete Room
          </button>
        </div>
      );
    }

    if (selection.kind === "door") {
      return (
        <button
          type="button"
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white"
          onClick={() => removeSelection(selection)}
        >
          <Trash2 className="h-4 w-4" />
          Delete Door
        </button>
      );
    }

    if (selection.kind === "waypoint") {
      return (
        <button
          type="button"
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white"
          onClick={() => removeSelection(selection, { confirm: true })}
        >
          <Trash2 className="h-4 w-4" />
          Delete Waypoint
        </button>
      );
    }

    if (selection.kind === "path") {
      return (
        <button
          type="button"
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white"
          onClick={() => removeSelection(selection)}
        >
          <Trash2 className="h-4 w-4" />
          Delete Connection
        </button>
      );
    }

    if (selection.kind === "multi") {
      return (
        <button
          type="button"
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white"
          onClick={() => removeSelection(selection)}
        >
          <Trash2 className="h-4 w-4" />
          Delete Selected
        </button>
      );
    }

    return null;
  };

  const renderAdvancedSection = () => {
    let metadata = null;

    if (selection?.kind === "room" && selectedRoom?.properties) {
      metadata = selectedRoom.properties;
    } else if (selection?.kind === "door" && selectedDoor?.properties) {
      metadata = selectedDoor.properties;
    } else if (selection?.kind === "waypoint" && selectedWaypoint?.properties) {
      metadata = selectedWaypoint.properties;
    } else if (selection?.kind === "path" && selectedPath) {
      metadata = selectedPath;
    }

    return (
      <div className="rounded-xl border border-default">
        <button
          type="button"
          className="flex w-full items-center justify-between px-3 py-3 text-left text-sm font-semibold text-primary"
          onClick={() => setAdvancedOpen((current) => !current)}
        >
          <span>Advanced</span>
          {advancedOpen ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>
        {advancedOpen && (
          <div className="border-t border-default px-3 py-3">
            {!selection && (
              <div className="space-y-3">
                <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                  Legacy tools
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-default bg-surface px-3 py-2 text-sm"
                    onClick={() => setToolMode("wall")}
                  >
                    <Pencil className="h-4 w-4" />
                    Wall
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-default bg-surface px-3 py-2 text-sm"
                    onClick={() => setToolMode("window")}
                  >
                    <DoorOpen className="h-4 w-4" />
                    Window
                  </button>
                </div>
              </div>
            )}
            {selection && (
              <div className="space-y-3">
                {selection.kind === "room" && selectedRoom && (
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                      Description
                    </label>
                    <textarea
                      className="mt-1 min-h-[96px] w-full rounded-lg border border-default bg-surface px-3 py-2 text-sm"
                      value={selectedRoom.properties?.description || ""}
                      onChange={(event) => updateRoomDescription(event.target.value)}
                    />
                  </div>
                )}
                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                    Custom metadata
                  </label>
                  <pre className="mt-2 overflow-x-auto rounded-lg border border-default bg-surface-alt p-3 text-[11px] text-secondary">
                    {JSON.stringify(metadata || {}, null, 2)}
                  </pre>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const contextMenuActions = (() => {
    if (!contextMenu) return [];

    if (contextMenu.target.kind === "empty") {
      return [
        {
          label: "Add Room here",
          onClick: () => addRoomAtPoint(contextMenu.point),
        },
      ];
    }

    const targetSelection = {
      kind: contextMenu.target.kind,
      id: contextMenu.target.id,
    };

    const actions = [];

    if (["room", "waypoint"].includes(contextMenu.target.kind)) {
      actions.push({
        label: "Rename",
        onClick: () => {
          setSelection(targetSelection);
          focusNameField();
        },
      });
    }

    if (contextMenu.target.kind === "room") {
      actions.push({
        label: "Duplicate",
        onClick: () => {
          setSelection(targetSelection);
          duplicateSelectedRoom(contextMenu.target.id);
        },
      });
    }

    actions.push({
      label: "Delete",
      danger: true,
      onClick: () =>
        removeSelection(targetSelection, {
          confirm: contextMenu.target.kind === "room",
        }),
    });

    return actions;
  })();

  const roomDragBound = (pos) =>
    snapEnabled ? snapPointToGrid(pos, gridStep) : pos;

  return (
    <>
      <AiModal
        open={aiModalOpen}
        running={aiRunning}
        options={aiOptions}
        scope={aiScope}
        step={aiStep}
        onClose={() => setAiModalOpen(false)}
        onScope={setAiScope}
        onToggle={(key) =>
          setAiOptions((current) => ({ ...current, [key]: !current[key] }))
        }
        onRun={runAiMapping}
      />

      <div className="flex h-full min-h-0 bg-[var(--color-surface)]">
        <aside className="flex h-full w-[56px] shrink-0 flex-col items-center gap-2 border-r border-default bg-surface py-3">
          {PRIMARY_TOOL_OPTIONS.map(({ id, label, key, Icon, tooltip }) => (
            <button
              key={id}
              type="button"
              title={`${label} (${key}) — ${tooltip}`}
              aria-label={`${label} (${key})`}
              onClick={() => setToolMode(id)}
              className={`inline-flex h-12 w-12 flex-col items-center justify-center gap-1 rounded-xl border px-1 transition-colors ${
                tool === id
                  ? "border-blue-600 bg-blue-50 text-blue-700"
                  : "border-default bg-surface text-secondary hover:bg-surface-alt"
              }`}
            >
              <Icon className="h-4 w-4" />
              <span className="text-[9px] font-semibold uppercase leading-none">
                {label}
              </span>
            </button>
          ))}

          <div className="my-1 h-px w-8 bg-[var(--color-border)]" />

          <button
            type="button"
            title={`Toggle grid (G) — ${layerVisibility.grid ? "On" : "Off"}`}
            onClick={() => toggleLayer("grid")}
            className={`inline-flex h-12 w-12 flex-col items-center justify-center gap-1 rounded-xl border px-1 transition-colors ${
              layerVisibility.grid
                ? "border-blue-600 bg-blue-50 text-blue-700"
                : "border-default bg-surface text-secondary hover:bg-surface-alt"
            }`}
          >
            <Grid className="h-4 w-4" />
            <span className="text-[9px] font-semibold uppercase leading-none">
              Grid
            </span>
          </button>

          <button
            type="button"
            title={`Toggle snap (G) — ${snapEnabled ? "On" : "Off"}`}
            onClick={() => setSnapEnabled((value) => !value)}
            className={`inline-flex h-12 w-12 flex-col items-center justify-center gap-1 rounded-xl border px-1 transition-colors ${
              snapEnabled
                ? "border-blue-600 bg-blue-50 text-blue-700"
                : "border-default bg-surface text-secondary hover:bg-surface-alt"
            }`}
          >
            <Magnet className="h-4 w-4" />
            <span className="text-[9px] font-semibold uppercase leading-none">
              Snap
            </span>
          </button>

          <button
            type="button"
            title={`Toggle navigation graph (N) — ${
              layerVisibility.waypoints && layerVisibility.paths ? "On" : "Off"
            }`}
            onClick={toggleNavGraph}
            className={`inline-flex h-12 w-12 flex-col items-center justify-center gap-1 rounded-xl border px-1 transition-colors ${
              layerVisibility.waypoints && layerVisibility.paths
                ? "border-blue-600 bg-blue-50 text-blue-700"
                : "border-default bg-surface text-secondary hover:bg-surface-alt"
            }`}
          >
            <GitBranch className="h-4 w-4" />
            <span className="text-[9px] font-semibold uppercase leading-none">
              Nav
            </span>
          </button>
        </aside>

        <div
          ref={containerRef}
          className="relative min-h-0 flex-1 overflow-hidden bg-slate-100"
          style={{
            cursor:
              spacePressed || tool === "select"
                ? "grab"
                : tool === "door"
                  ? hoveredDoorTarget
                    ? "copy"
                    : "not-allowed"
                  : "crosshair",
          }}
        >
          <Stage
            ref={stageRef}
            width={size.width}
            height={size.height}
            scaleX={scale}
            scaleY={scale}
            x={position.x}
            y={position.y}
            draggable={!previewMode && (tool === "select" || spacePressed)}
            onDragStart={() => setContextMenu(null)}
            onDragEnd={(event) =>
              setPosition({ x: event.target.x(), y: event.target.y() })
            }
            onWheel={(event) => {
              event.evt.preventDefault();
              zoomBy(0.92 ** Math.sign(event.evt.deltaY || 1), stageRef.current?.getPointerPosition() || null);
            }}
            onMouseDown={handleStageMouseDown}
            onMouseMove={handleStageMouseMove}
            onMouseUp={handleStageMouseUp}
            onDblClick={handleStageDoubleClick}
            onContextMenu={handleStageContextMenu}
          >
            <Layer listening={false}>
              {layerVisibility.grid &&
                (() => {
                  const startX =
                    Math.floor((-position.x / scale) / gridStep) * gridStep;
                  const endX =
                    Math.ceil(((size.width - position.x) / scale) / gridStep) *
                    gridStep;
                  const startY =
                    Math.floor((-position.y / scale) / gridStep) * gridStep;
                  const endY =
                    Math.ceil(((size.height - position.y) / scale) / gridStep) *
                    gridStep;
                  const lines = [];

                  for (let x = startX; x <= endX; x += gridStep) {
                    lines.push(
                      <Line
                        key={`grid-x-${x}`}
                        points={[x, startY, x, endY]}
                        stroke="#CBD5E1"
                        opacity={0.3}
                        strokeWidth={0.5}
                      />,
                    );
                  }

                  for (let y = startY; y <= endY; y += gridStep) {
                    lines.push(
                      <Line
                        key={`grid-y-${y}`}
                        points={[startX, y, endX, y]}
                        stroke="#CBD5E1"
                        opacity={0.3}
                        strokeWidth={0.5}
                      />,
                    );
                  }

                  return lines;
                })()}
            </Layer>

            <Layer listening={false}>
              {layerVisibility.background && backgroundImage ? (
                <KonvaImage
                  image={backgroundImage}
                  width={mvf.meta?.imageWidth || backgroundImage.width}
                  height={mvf.meta?.imageHeight || backgroundImage.height}
                  opacity={backgroundOpacity}
                />
              ) : null}
            </Layer>

            <Layer>
              {mvf.spaces.features.map((feature) => {
                const points = roomPolygon(feature);
                const center = polygonCenter(points);
                const bounds = polygonBounds(points);
                const selectedNow =
                  selection?.kind === "room" && selection.id === feature.id;
                const style = roomTypeStyle(feature.properties?.kind || "room");
                const fill = feature.properties?.color || style.fill;
                const listening =
                  !previewMode && (tool === "select" || tool === "erase");

                return (
                  <Group
                    key={feature.id}
                    ref={(node) => {
                      if (node) roomRefs.current.set(feature.id, node);
                      else roomRefs.current.delete(feature.id);
                    }}
                    draggable={
                      !previewMode &&
                      tool === "select" &&
                      selectedNow &&
                      !spacePressed
                    }
                    dragBoundFunc={roomDragBound}
                    onDragEnd={(event) => {
                      const dx = event.target.x();
                      const dy = event.target.y();
                      event.target.position({ x: 0, y: 0 });
                      if (dx === 0 && dy === 0) return;
                      updateRoomFeature(feature.id, (target) => {
                        const moved = roomPolygon(target).map((point) => ({
                          x: point.x + dx,
                          y: point.y + dy,
                        }));
                        writeRoomPoints(target, moved);
                      });
                    }}
                    onTransformEnd={() => {
                      const node = roomRefs.current.get(feature.id);
                      if (!node) return;
                      const dx = node.x();
                      const dy = node.y();
                      const nextScaleX = node.scaleX();
                      const nextScaleY = node.scaleY();
                      node.scaleX(1);
                      node.scaleY(1);
                      node.position({ x: 0, y: 0 });
                      updateRoomFeature(feature.id, (target) => {
                        const sourcePoints = roomPolygon(target);
                        const baseBounds = polygonBounds(sourcePoints);
                        const transformed = sourcePoints.map((point) => ({
                          x:
                            baseBounds.x +
                            (point.x - baseBounds.x) * nextScaleX +
                            dx,
                          y:
                            baseBounds.y +
                            (point.y - baseBounds.y) * nextScaleY +
                            dy,
                        }));
                        writeRoomPoints(target, transformed);
                      });
                    }}
                  >
                    {layerVisibility.rooms && (
                      <>
                        <Line
                          points={flatten(points)}
                          closed
                          fill={fill}
                          opacity={0.8}
                          strokeEnabled={false}
                          hitStrokeWidth={0}
                          listening={listening}
                          onClick={(event) => {
                            event.cancelBubble = true;
                            handleElementActivate({ kind: "room", id: feature.id });
                          }}
                          onContextMenu={(event) =>
                            openContextMenu(event, { kind: "room", id: feature.id })
                          }
                        />
                        <Line
                          points={flatten(points)}
                          closed
                          fillEnabled={false}
                          stroke={selectedNow ? "#2563EB" : style.stroke}
                          strokeWidth={selectedNow ? 2.5 : 1.5}
                          listening={false}
                        />
                        <Text
                          x={center.x - 64}
                          y={center.y - 8}
                          width={128}
                          align="center"
                          text={truncateLabel(feature.properties?.name || "Room")}
                          fontSize={12}
                          fill="#0F172A"
                          listening={false}
                        />
                      </>
                    )}
                    {selectedNow && (
                      <Rect
                        x={bounds.x}
                        y={bounds.y}
                        width={bounds.width}
                        height={bounds.height}
                        stroke="#2563EB"
                        strokeWidth={1.2}
                        dash={[5, 4]}
                        listening={false}
                      />
                    )}
                  </Group>
                );
              })}

              {mvf.obstructions.features.map((feature) => {
                const coords = feature.geometry?.coordinates || [];
                if (coords.length < 2) return null;
                const a = toPointFromCoords(coords[0]);
                const b = toPointFromCoords(coords[1]);
                const selectedNow =
                  selection?.kind === "wall" && selection.id === feature.id;
                const listening =
                  !previewMode && (tool === "select" || tool === "erase");
                return (
                  <Line
                    key={feature.id}
                    points={[a.x, a.y, b.x, b.y]}
                    stroke={selectedNow ? "#2563EB" : "#475569"}
                    strokeWidth={feature.properties?.thickness || 3}
                    lineCap="round"
                    hitStrokeWidth={10}
                    listening={listening}
                    onClick={(event) => {
                      event.cancelBubble = true;
                      handleElementActivate(
                        { kind: "wall", id: feature.id },
                        { forceSelect: true },
                      );
                    }}
                    onContextMenu={(event) =>
                      openContextMenu(event, { kind: "wall", id: feature.id })
                    }
                  />
                );
              })}

              {mvf.openings.features.map((feature) => {
                const kind = feature.properties?.kind;
                const selectedNow =
                  selection?.kind === kind && selection.id === feature.id;
                const listening =
                  !previewMode && (tool === "select" || tool === "erase");

                if (kind === "door") {
                  const placement = resolveDoorPlacement(feature, roomMap);
                  return (
                    <Group
                      key={feature.id}
                      x={placement.point.x}
                      y={placement.point.y}
                      rotation={placement.wallAngle}
                      draggable={
                        !previewMode &&
                        tool === "select" &&
                        selectedNow &&
                        !spacePressed
                      }
                      dragBoundFunc={roomDragBound}
                      listening={listening}
                      onClick={(event) => {
                        event.cancelBubble = true;
                        handleElementActivate({ kind: "door", id: feature.id });
                      }}
                      onContextMenu={(event) =>
                        openContextMenu(event, { kind: "door", id: feature.id })
                      }
                      onDragEnd={(event) => {
                        const nextPoint = {
                          x: event.target.x(),
                          y: event.target.y(),
                        };
                        event.target.position({
                          x: placement.point.x,
                          y: placement.point.y,
                        });
                        const nextWall = findNearestRoomWall(
                          nextPoint,
                          mvfRef.current.spaces.features,
                          WALL_HOVER_DISTANCE / Math.max(scaleRef.current, 0.2),
                        );
                        if (!nextWall) return;
                        updateOpeningFeature(feature.id, (door) => {
                          door.geometry.coordinates = [
                            nextWall.point.x,
                            nextWall.point.y,
                          ];
                          door.properties.rotation = nextWall.angle + 90;
                          door.properties.linkedRoomId = nextWall.roomId;
                          door.properties.roomName = nextWall.roomName;
                          door.properties.edgeIndex = nextWall.edgeIndex;
                          door.properties.offset = nextWall.offset;
                        });
                      }}
                    >
                      {layerVisibility.doors && (
                        <>
                          <Line
                            points={[-8, 0, 8, 0]}
                            stroke="#FFFFFF"
                            strokeWidth={6}
                            listening={false}
                          />
                          <Rect
                            x={-3}
                            y={-8}
                            width={6}
                            height={16}
                            fill={selectedNow ? "#FBBF24" : "#F59E0B"}
                            stroke={selectedNow ? "#F97316" : "#B45309"}
                            strokeWidth={selectedNow ? 1.4 : 1}
                            cornerRadius={1}
                            listening={false}
                          />
                          <Text
                            x={-42}
                            y={-24}
                            width={84}
                            align="center"
                            text={
                              feature.properties?.label ||
                              placement.roomName ||
                              "Door"
                            }
                            fontSize={10}
                            fill="#92400E"
                            listening={false}
                          />
                        </>
                      )}
                    </Group>
                  );
                }

                const point = toPointFromCoords(feature.geometry?.coordinates);
                const rotation = Number(feature.properties?.rotation || 0);
                const radians = (rotation * Math.PI) / 180;
                const ux = Math.cos(radians);
                const uy = Math.sin(radians);
                const nx = -uy;
                const ny = ux;
                return (
                  <Group
                    key={feature.id}
                    listening={listening}
                    onClick={(event) => {
                      event.cancelBubble = true;
                      handleElementActivate(
                        { kind: "window", id: feature.id },
                        { forceSelect: true },
                      );
                    }}
                    onContextMenu={(event) =>
                      openContextMenu(event, { kind: "window", id: feature.id })
                    }
                  >
                    <Line
                      points={[
                        point.x - ux * 10 + nx * 3,
                        point.y - uy * 10 + ny * 3,
                        point.x + ux * 10 + nx * 3,
                        point.y + uy * 10 + ny * 3,
                      ]}
                      stroke={selectedNow ? "#2563EB" : "#00BCD4"}
                      strokeWidth={2}
                    />
                    <Line
                      points={[
                        point.x - ux * 10 - nx * 3,
                        point.y - uy * 10 - ny * 3,
                        point.x + ux * 10 - nx * 3,
                        point.y + uy * 10 - ny * 3,
                      ]}
                      stroke={selectedNow ? "#2563EB" : "#00BCD4"}
                      strokeWidth={2}
                    />
                  </Group>
                );
              })}

              {layerVisibility.paths &&
                navEdges.map((edge) => {
                  const a = edge.source.geometry.coordinates;
                  const b = edge.target.geometry.coordinates;
                  const selectedNow =
                    selection?.kind === "path" && selection.id === edge.key;
                  const listening =
                    !previewMode && (tool === "select" || tool === "erase");
                  return (
                    <Line
                      key={edge.key}
                      points={[a[0], a[1], b[0], b[1]]}
                      stroke={selectedNow ? "#2563EB" : "#64748B"}
                      opacity={selectedNow ? 1 : 0.6}
                      strokeWidth={selectedNow ? 2.5 : 1.5}
                      hitStrokeWidth={12}
                      listening={listening}
                      onClick={(event) => {
                        event.cancelBubble = true;
                        handleElementActivate(
                          { kind: "path", id: edge.key },
                          { forceSelect: true },
                        );
                      }}
                      onContextMenu={(event) =>
                        openContextMenu(event, { kind: "path", id: edge.key })
                      }
                    />
                  );
                })}

              {layerVisibility.waypoints &&
                mvf.nodes.features.map((feature) => {
                  const point = toPointFromCoords(feature.geometry.coordinates);
                  const type = feature.properties?.type || "corridor";
                  const color = WAYPOINT_TYPE_COLORS[type] || WAYPOINT_TYPE_COLORS.corridor;
                  const selectedNow =
                    selection?.kind === "waypoint" && selection.id === feature.id;
                  const selectedForPath = pathDraft === feature.id;
                  const listening =
                    !previewMode &&
                    (tool === "select" || tool === "erase" || tool === "path");

                  return (
                    <Group
                      key={feature.id}
                      x={point.x}
                      y={point.y}
                      draggable={
                        !previewMode &&
                        tool === "select" &&
                        selectedNow &&
                        !spacePressed
                      }
                      dragBoundFunc={roomDragBound}
                      listening={listening}
                      onClick={(event) => {
                        event.cancelBubble = true;
                        handleElementActivate({ kind: "waypoint", id: feature.id });
                      }}
                      onContextMenu={(event) =>
                        openContextMenu(event, { kind: "waypoint", id: feature.id })
                      }
                      onDragEnd={(event) => {
                        const nextPosition = {
                          x: event.target.x(),
                          y: event.target.y(),
                        };
                        event.target.position({ x: point.x, y: point.y });
                        updateWaypointFeature(feature.id, (target) => {
                          target.geometry.coordinates = [
                            nextPosition.x,
                            nextPosition.y,
                          ];
                        });
                      }}
                    >
                      <Circle
                        radius={selectedNow ? 10 : 8}
                        fill={selectedForPath ? "#22C55E" : color}
                        stroke={selectedNow ? "#2563EB" : "#FFFFFF"}
                        strokeWidth={selectedNow ? 2.4 : 2}
                        shadowColor="#0F172A"
                        shadowBlur={selectedNow ? 8 : 4}
                        shadowOpacity={0.2}
                        listening={false}
                      />
                      <Text
                        x={-44}
                        y={12}
                        width={88}
                        align="center"
                        text={truncateLabel(feature.properties?.name || type, 16)}
                        fontSize={10}
                        fill="#0F172A"
                        listening={false}
                      />
                    </Group>
                  );
                })}

              {tool === "door" && hoveredDoorTarget && (
                <Group
                  x={hoveredDoorTarget.point.x}
                  y={hoveredDoorTarget.point.y}
                  rotation={hoveredDoorTarget.angle}
                  listening={false}
                >
                  <Line
                    points={[
                      hoveredDoorTarget.start.x - hoveredDoorTarget.point.x,
                      hoveredDoorTarget.start.y - hoveredDoorTarget.point.y,
                      hoveredDoorTarget.end.x - hoveredDoorTarget.point.x,
                      hoveredDoorTarget.end.y - hoveredDoorTarget.point.y,
                    ]}
                    stroke="#2563EB"
                    strokeWidth={2}
                  />
                  <Line points={[-8, 0, 8, 0]} stroke="#FFFFFF" strokeWidth={6} />
                  <Rect
                    x={-3}
                    y={-8}
                    width={6}
                    height={16}
                    fill="#F59E0B"
                    stroke="#B45309"
                    strokeWidth={1}
                    cornerRadius={1}
                  />
                </Group>
              )}

              {tool === "path" && pathDraft && cursor && waypointMap.get(pathDraft) && (
                <Line
                  points={[
                    waypointMap.get(pathDraft).geometry.coordinates[0],
                    waypointMap.get(pathDraft).geometry.coordinates[1],
                    cursor.x,
                    cursor.y,
                  ]}
                  stroke="#22C55E"
                  strokeWidth={2}
                  dash={[6, 4]}
                  listening={false}
                />
              )}

              {drawing?.kind === "wall" && (
                <Line
                  points={[
                    drawing.start.x,
                    drawing.start.y,
                    drawing.end.x,
                    drawing.end.y,
                  ]}
                  stroke="#334155"
                  strokeWidth={3}
                  dash={[6, 5]}
                  listening={false}
                />
              )}

              {drawing?.kind === "room" && (
                <Rect
                  x={Math.min(drawing.start.x, drawing.end.x)}
                  y={Math.min(drawing.start.y, drawing.end.y)}
                  width={Math.abs(drawing.end.x - drawing.start.x)}
                  height={Math.abs(drawing.end.y - drawing.start.y)}
                  fill="#DBEAFE"
                  opacity={0.7}
                  stroke="#2563EB"
                  dash={[6, 4]}
                  listening={false}
                />
              )}

              {polygonDraft.length > 0 && (
                <>
                  <Line
                    points={[
                      ...flatten(polygonDraft),
                      ...(cursor ? [cursor.x, cursor.y] : []),
                    ]}
                    stroke="#2563EB"
                    strokeWidth={2}
                    dash={[5, 4]}
                    listening={false}
                  />
                  {polygonDraft.map((point, index) => {
                    const closePoint =
                      index === 0 &&
                      polygonDraft.length >= 3 &&
                      distanceBetween(cursor || point, point) <=
                        POLYGON_CLOSE_DISTANCE / scale;
                    return (
                      <Group
                        key={`draft-${index}`}
                        x={point.x}
                        y={point.y}
                        onClick={(event) => {
                          if (!closePoint) return;
                          event.cancelBubble = true;
                          addPolygonRoom(polygonDraft);
                        }}
                      >
                        <Circle
                          radius={closePoint ? 6 : 4}
                          fill={closePoint ? "#2563EB" : "#FFFFFF"}
                          stroke="#2563EB"
                          strokeWidth={2}
                        />
                      </Group>
                    );
                  })}
                </>
              )}
            </Layer>

            <Layer listening={false}>
              <Transformer
                ref={transformerRef}
                rotateEnabled={false}
                enabledAnchors={
                  spacePressed
                    ? []
                    : [
                        "top-left",
                        "top-right",
                        "bottom-left",
                        "bottom-right",
                      ]
                }
                anchorSize={8}
                borderStroke="#2563EB"
                anchorStroke="#2563EB"
                anchorFill="#FFFFFF"
                boundBoxFunc={(oldBox, newBox) => {
                  if (newBox.width < MIN_ROOM_SIZE || newBox.height < MIN_ROOM_SIZE) {
                    return oldBox;
                  }
                  return newBox;
                }}
              />
            </Layer>
          </Stage>

          <div className="absolute bottom-4 left-4 z-20 flex items-center gap-2 rounded-xl border border-default bg-[var(--color-map-overlay)] px-3 py-2 text-sm text-secondary shadow">
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-default bg-surface"
              onClick={() => zoomBy(0.88)}
            >
              <Minus className="h-4 w-4" />
            </button>
            <div className="min-w-[60px] text-center font-semibold text-primary">
              {Math.round(scale * 100)}%
            </div>
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-default bg-surface"
              onClick={() => zoomBy(1.12)}
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="rounded-md border border-default bg-surface px-3 py-1.5 text-xs font-semibold text-secondary"
              onClick={fitToScreen}
            >
              Fit
            </button>
          </div>

          {tool === "door" && !hoveredDoorTarget && (
            <div className="absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-full border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700 shadow">
              Click on a wall to place a door
            </div>
          )}

          {tool === "polygon" && polygonCloseTarget && (
            <div className="absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-full border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700 shadow">
              Close shape
            </div>
          )}

          {contextMenu && contextMenuActions.length > 0 && (
            <div
              className="absolute z-30 min-w-[160px] rounded-xl border border-default bg-surface p-1 shadow-xl"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              onMouseDown={(event) => event.stopPropagation()}
            >
              {contextMenuActions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  className={`block w-full rounded-lg px-3 py-2 text-left text-sm ${
                    action.danger
                      ? "text-red-600 hover:bg-red-50"
                      : "text-secondary hover:bg-surface-alt"
                  }`}
                  onClick={() => {
                    action.onClick();
                    setContextMenu(null);
                  }}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <aside className="h-full w-[260px] shrink-0 overflow-y-auto border-l border-default bg-surface">
          <div className="flex min-h-full flex-col gap-4 p-3">
            <section className="rounded-xl border border-default bg-surface-alt p-3">
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                Selected item
              </div>
              <div className="mt-2 text-sm font-semibold text-primary">
                {selectedHeader.title}
              </div>
              <div className="mt-2 inline-flex rounded-full bg-surface px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-secondary">
                {selectedHeader.badge}
              </div>
            </section>

            {renderPropertiesForm()}

            {renderActions()}

            {renderAdvancedSection()}

            <section className="rounded-xl border border-default">
              <div className="border-b border-default px-3 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                Layers
              </div>
              <div className="space-y-2 px-3 py-3">
                {[
                  ["rooms", "Rooms"],
                  ["doors", "Doors"],
                  ["waypoints", "Waypoints"],
                  ["paths", "Paths"],
                  ["grid", "Grid"],
                  ["background", "Background image"],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                      layerVisibility[key]
                        ? "border-blue-200 bg-blue-50 text-blue-700"
                        : "border-default bg-surface text-secondary"
                    }`}
                    onClick={() => toggleLayer(key)}
                  >
                    <span>{label}</span>
                    <span className="text-xs font-semibold">
                      {layerVisibility[key] ? "ON" : "OFF"}
                    </span>
                  </button>
                ))}
                <div className="pt-2">
                  <label className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                    Background opacity
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    className="mt-2 w-full"
                    value={Math.round(backgroundOpacity * 100)}
                    onChange={(event) =>
                      setBackgroundOpacity(Number(event.target.value) / 100)
                    }
                  />
                </div>
              </div>
            </section>

            <section className="mt-auto rounded-xl border border-default">
              <div className="border-b border-default px-3 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                Map actions
              </div>
              <div className="space-y-2 px-3 py-3">
                <select
                  className="w-full rounded-lg border border-default bg-surface px-3 py-2 text-sm"
                  value={roomKind}
                  onChange={(event) => setRoomKind(event.target.value)}
                >
                  {ROOM_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      New rooms: {option.label}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-default bg-surface px-3 py-2 text-sm font-medium text-secondary"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {layerVisibility.background ? (
                    <Eye className="h-4 w-4" />
                  ) : (
                    <EyeOff className="h-4 w-4" />
                  )}
                  Import Floor Image
                </button>
                <button
                  type="button"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-default bg-surface px-3 py-2 text-sm font-medium text-secondary"
                  onClick={() => importInputRef.current?.click()}
                >
                  <Import className="h-4 w-4" />
                  Import MVF JSON
                </button>
                <button
                  type="button"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-default bg-surface px-3 py-2 text-sm font-medium text-secondary"
                  onClick={exportMvf}
                >
                  <Download className="h-4 w-4" />
                  Export MVF JSON
                </button>
                <button
                  type="button"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700"
                  onClick={() => setAiModalOpen(true)}
                >
                  <Sparkles className="h-4 w-4" />
                  Auto Trace Draft
                </button>
                <button
                  type="button"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-default bg-surface px-3 py-2 text-sm font-medium text-secondary"
                  onClick={validateMap}
                >
                  <Save className="h-4 w-4" />
                  Validate Map
                </button>
                <button
                  type="button"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-default bg-surface px-3 py-2 text-sm font-medium text-secondary"
                  onClick={autoGenerateWaypoints}
                >
                  <GitBranch className="h-4 w-4" />
                  Auto-generate Waypoints
                </button>
                <button
                  type="button"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white"
                  onClick={saveMap}
                >
                  <Save className="h-4 w-4" />
                  Save Map
                </button>

                <div className="pt-2">
                  <label className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                    Scale (pixels per meter)
                  </label>
                  <input
                    type="number"
                    min="1"
                    className="mt-1 w-full rounded-lg border border-default bg-surface px-3 py-2 text-sm"
                    value={Number(mvf.meta?.pixelsPerMeter || 20)}
                    onChange={(event) => {
                      const next = Number(event.target.value || 20);
                      updateMvf((state) => {
                        state.meta.pixelsPerMeter = next;
                      }, false);
                    }}
                  />
                </div>
              </div>
            </section>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => {
                const dataUrl = String(reader.result || "");
                const image = new window.Image();
                image.onload = () => {
                  setBackgroundImage(image);
                  updateMvf((next) => {
                    next.meta.imageWidth = image.width;
                    next.meta.imageHeight = image.height;
                  }, false);
                };
                image.src = dataUrl;
              };
              reader.readAsDataURL(file);
            }}
          />

          <input
            ref={importInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) importMvf(file);
            }}
          />
        </aside>
      </div>
    </>
  );
});

export default MapEditor;
