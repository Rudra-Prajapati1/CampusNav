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
} from "react-konva";
import { v4 as uuidv4, validate as uuidValidate } from "uuid";
import toast from "react-hot-toast";
import {
  Download,
  Eye,
  EyeOff,
  GitBranch,
  ImagePlus,
  Import,
  Magnet,
  Move,
  Pencil,
  Plus,
  Save,
  Sparkles,
  Square,
} from "lucide-react";
import { api } from "../utils/api.js";

const TOOL_KEYS = {
  s: "select",
  w: "wall",
  r: "room",
  d: "door",
  i: "window",
  p: "waypoint",
  e: "path",
};

const ROOM_COLORS = {
  room: "#9370DB40",
  corridor: "#D3D3D340",
  stairs: "#FF8C0040",
  elevator: "#4169E140",
};

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

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
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

function roomPolygon(feature) {
  const ring = feature?.geometry?.coordinates?.[0] || [];
  if (!Array.isArray(ring) || ring.length < 4) return [];
  return ring.slice(0, -1).map(toPointFromCoords);
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
        kind: room.type === "corridor" ? "corridor" : "room",
        name: room.name || "Room",
        category: room.type || "other",
        color: room.color || "#9370DB",
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
        spaceId: waypoint.room_id || null,
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
    const weight = Math.round(
      Math.hypot(pointA.x - pointB.x, pointA.y - pointB.y),
    );
    a.properties.neighbors.push({ id: b.id, weight });
    b.properties.neighbors.push({ id: a.id, weight });
  }

  return mvf;
}

function dedupeEdges(nodes) {
  const edges = [];
  const seen = new Set();
  for (const node of nodes) {
    const neighbors = Array.isArray(node.properties?.neighbors)
      ? node.properties.neighbors
      : [];
    for (const neighbor of neighbors) {
      const a = String(node.id);
      const b = String(neighbor.id);
      if (!a || !b || a === b) continue;
      const key = [a, b].sort().join(":");
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({
        from: a,
        to: b,
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
      type: feature.properties?.kind || "other",
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
    type: feature.properties?.spaceId ? "room_center" : "corridor",
    room_id: feature.properties?.spaceId || null,
    name: feature.properties?.name || `Waypoint ${index + 1}`,
    linked_floor_id: feature.properties?.linkedFloorId || null,
  }));

  const edges = dedupeEdges(mvf.nodes.features);
  const connections = edges.map((edge) => ({
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
            className={`rounded-md px-4 py-2 text-sm ${scope === "current_floor" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700"}`}
          >
            Current Floor
          </button>
          <button
            type="button"
            onClick={() => onScope("all_floors")}
            className={`rounded-md px-4 py-2 text-sm ${scope === "all_floors" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700"}`}
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
                className={`rounded-md border px-3 py-1 text-xs ${index <= step ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-500"}`}
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

  const [mvf, setMvf] = useState(() => buildMvfFromFloor(floorData));
  const [tool, setTool] = useState("select");
  const [roomShape, setRoomShape] = useState("rectangle");
  const [roomKind, setRoomKind] = useState("room");
  const [showBackground, setShowBackground] = useState(true);
  const [showNavGraph, setShowNavGraph] = useState(true);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [selected, setSelected] = useState(null);
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

  const mvfRef = useRef(mvf);

  useEffect(() => {
    mvfRef.current = mvf;
  }, [mvf]);

  useEffect(() => {
    const next = buildMvfFromFloor(floorData);
    setMvf(next);
    setHistory([]);
    setFuture([]);
    setDirty(false);
    setSelected(null);
    setDrawing(null);
    setPolygonDraft([]);
    setPathDraft(null);
  }, [floorData]);

  useEffect(() => {
    if (!autoOpenAiMapping) return;
    setAiModalOpen(true);
  }, [autoOpenAiMapping]);

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

  useEffect(() => {
    const keyHandler = (event) => {
      const key = event.key.toLowerCase();
      if (event.ctrlKey && key === "z") {
        event.preventDefault();
        undo();
        return;
      }
      if (event.ctrlKey && key === "y") {
        event.preventDefault();
        redo();
        return;
      }
      const nextTool = TOOL_KEYS[key];
      if (nextTool && !previewMode) {
        event.preventDefault();
        setTool(nextTool);
      }
    };
    window.addEventListener("keydown", keyHandler);
    return () => window.removeEventListener("keydown", keyHandler);
  }, [previewMode]);

  const wallEndpoints = useMemo(() => {
    const points = [];
    for (const wall of mvf.obstructions.features) {
      const coordinates = wall.geometry?.coordinates || [];
      if (coordinates.length < 2) continue;
      points.push(toPointFromCoords(coordinates[0]));
      points.push(toPointFromCoords(coordinates[1]));
    }
    return points;
  }, [mvf.obstructions.features]);

  const nodeMap = useMemo(() => {
    return new Map(mvf.nodes.features.map((feature) => [feature.id, feature]));
  }, [mvf.nodes.features]);

  const navEdges = useMemo(
    () => dedupeEdges(mvf.nodes.features),
    [mvf.nodes.features],
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
    [mvf, navEdges],
  );

  function pushHistory(nextState) {
    setHistory((current) => [...current, deepClone(nextState)].slice(-80));
    setFuture([]);
    setDirty(true);
  }

  function updateMvf(updater, track = true) {
    setMvf((current) => {
      const next = deepClone(current);
      updater(next);
      if (track) {
        setHistory((prevHistory) =>
          [...prevHistory, deepClone(current)].slice(-80),
        );
        setFuture([]);
        setDirty(true);
      }
      return next;
    });
  }

  function undo() {
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
    setSelected(null);
  }

  function redo() {
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
    setSelected(null);
  }

  function stagePoint() {
    const stage = stageRef.current;
    if (!stage) return null;
    const pointer = stage.getPointerPosition();
    if (!pointer) return null;
    return {
      x: (pointer.x - position.x) / scale,
      y: (pointer.y - position.y) / scale,
    };
  }

  function snappedPoint(rawPoint) {
    if (!rawPoint) return null;
    const endpoint = snapEnabled ? nearest(wallEndpoints, rawPoint, 10) : null;
    if (endpoint) return endpoint;
    return {
      x: snapEnabled ? Math.round(rawPoint.x) : rawPoint.x,
      y: snapEnabled ? Math.round(rawPoint.y) : rawPoint.y,
    };
  }

  function addWall(start, end) {
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
  }

  function addRectRoom(start, end) {
    const x1 = Math.min(start.x, end.x);
    const y1 = Math.min(start.y, end.y);
    const x2 = Math.max(start.x, end.x);
    const y2 = Math.max(start.y, end.y);
    if (Math.abs(x2 - x1) < 6 || Math.abs(y2 - y1) < 6) return;

    const polygon = [
      [x1, y1],
      [x2, y1],
      [x2, y2],
      [x1, y2],
      [x1, y1],
    ];

    updateMvf((next) => {
      next.spaces.features.push({
        type: "Feature",
        id: uuidv4(),
        properties: {
          kind: roomKind,
          name: roomKind === "corridor" ? "Corridor" : "Room",
          category: roomKind,
          color: roomKind === "corridor" ? "#D3D3D3" : "#9370DB",
          entrances: [],
        },
        geometry: { type: "Polygon", coordinates: [polygon] },
      });
    });
  }

  function addPolygonRoom(points) {
    if (points.length < 3) return;
    const ring = points.map(toCoords);
    const closed =
      ring[0][0] === ring[ring.length - 1][0] &&
      ring[0][1] === ring[ring.length - 1][1]
        ? ring
        : [...ring, ring[0]];

    updateMvf((next) => {
      next.spaces.features.push({
        type: "Feature",
        id: uuidv4(),
        properties: {
          kind: roomKind,
          name: roomKind === "corridor" ? "Corridor" : "Room",
          category: roomKind,
          color: roomKind === "corridor" ? "#D3D3D3" : "#9370DB",
          entrances: [],
        },
        geometry: { type: "Polygon", coordinates: [closed] },
      });
    });
  }

  function addOpening(point, kind) {
    const closest = nearest(
      mvf.obstructions.features.flatMap((wall) => {
        const coords = wall.geometry?.coordinates;
        if (!coords || coords.length < 2) return [];
        const a = toPointFromCoords(coords[0]);
        const b = toPointFromCoords(coords[1]);
        const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        return [center];
      }),
      point,
      120,
    );
    const placement = closest || point;

    updateMvf((next) => {
      next.openings.features.push({
        type: "Feature",
        id: uuidv4(),
        properties: {
          kind,
          width: kind === "door" ? 40 : 30,
          rotation: 0,
        },
        geometry: { type: "Point", coordinates: [placement.x, placement.y] },
      });
    });
  }

  function addWaypoint(point) {
    updateMvf((next) => {
      next.nodes.features.push({
        type: "Feature",
        id: uuidv4(),
        properties: {
          kind: "waypoint",
          spaceId: null,
          neighbors: [],
        },
        geometry: { type: "Point", coordinates: [point.x, point.y] },
      });
    });
  }

  function connectWaypoints(aId, bId) {
    if (!aId || !bId || aId === bId) return;
    updateMvf((next) => {
      const source = next.nodes.features.find((feature) => feature.id === aId);
      const target = next.nodes.features.find((feature) => feature.id === bId);
      if (!source || !target) return;

      const sourcePoint = toPointFromCoords(source.geometry.coordinates);
      const targetPoint = toPointFromCoords(target.geometry.coordinates);
      const weight = Math.round(
        Math.hypot(
          sourcePoint.x - targetPoint.x,
          sourcePoint.y - targetPoint.y,
        ),
      );

      const sourceNeighbors = Array.isArray(source.properties.neighbors)
        ? source.properties.neighbors
        : [];
      const targetNeighbors = Array.isArray(target.properties.neighbors)
        ? target.properties.neighbors
        : [];
      if (!sourceNeighbors.some((entry) => entry.id === target.id)) {
        sourceNeighbors.push({ id: target.id, weight });
      }
      if (!targetNeighbors.some((entry) => entry.id === source.id)) {
        targetNeighbors.push({ id: source.id, weight });
      }

      source.properties.neighbors = sourceNeighbors;
      target.properties.neighbors = targetNeighbors;
    });
  }

  function removeSelection() {
    if (!selected) return;
    updateMvf((next) => {
      next.spaces.features = next.spaces.features.filter(
        (feature) => feature.id !== selected,
      );
      next.obstructions.features = next.obstructions.features.filter(
        (feature) => feature.id !== selected,
      );
      next.openings.features = next.openings.features.filter(
        (feature) => feature.id !== selected,
      );
      next.objects.features = next.objects.features.filter(
        (feature) => feature.id !== selected,
      );
      next.nodes.features = next.nodes.features.filter(
        (feature) => feature.id !== selected,
      );
      for (const node of next.nodes.features) {
        node.properties.neighbors = ensureArray(
          node.properties.neighbors,
        ).filter((entry) => entry.id !== selected);
      }
    });
    setSelected(null);
  }

  function selectedFeature() {
    const all = [
      ...mvf.spaces.features,
      ...mvf.obstructions.features,
      ...mvf.openings.features,
      ...mvf.objects.features,
      ...mvf.nodes.features,
    ];
    return all.find((feature) => feature.id === selected) || null;
  }

  function exportMvf() {
    const blob = new Blob([JSON.stringify(mvf, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${floorData?.name || "floor"}-mvf.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function importMvf(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || "{}"));
        if (!isMvf(parsed)) throw new Error("Invalid MVF JSON");
        setMvf(parsed);
        setHistory([]);
        setFuture([]);
        setDirty(true);
        toast.success("MVF imported.");
      } catch (error) {
        toast.error(error.message || "Failed to import MVF");
      }
    };
    reader.readAsText(file);
  }

  async function saveMap() {
    if (!onSave) return;
    const payload = buildSavePayload(mvfRef.current);
    await onSave(payload);
    setDirty(false);
  }

  function autoGenerateWaypoints() {
    updateMvf((next) => {
      const nodes = [];
      for (const space of next.spaces.features) {
        const points = roomPolygon(space);
        const center = polygonCenter(points);
        nodes.push({
          type: "Feature",
          id: uuidv4(),
          properties: {
            kind: "waypoint",
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
            distance: Math.hypot(
              currentPoint.x - entry.geometry.coordinates[0],
              currentPoint.y - entry.geometry.coordinates[1],
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
  }

  function validateMap() {
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
      return;
    }
    toast.success("Validation passed.");
  }

  async function runAiMapping() {
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

      const result = response?.result;
      if (!isMvf(result)) {
        throw new Error("AI mapping did not return MVF data.");
      }

      setMvf(result);
      setHistory([]);
      setFuture([]);
      setDirty(true);
      setAiModalOpen(false);
      toast.success("AI mapping completed.");
    } catch (error) {
      toast.error(error.message || "AI mapping failed.");
    } finally {
      setAiRunning(false);
    }
  }

  function canvasToWorld(event) {
    const pointer = stageRef.current?.getPointerPosition();
    if (!pointer) return null;
    return {
      x: (pointer.x - position.x) / scale,
      y: (pointer.y - position.y) / scale,
    };
  }

  function onMouseDown(event) {
    if (previewMode) return;
    const point = snappedPoint(canvasToWorld(event));
    if (!point) return;

    if (tool === "wall") {
      setDrawing({ kind: "wall", start: point, end: point });
      return;
    }

    if (tool === "room" && roomShape === "rectangle") {
      setDrawing({ kind: "room", start: point, end: point });
      return;
    }

    if (tool === "room" && roomShape === "polygon") {
      setPolygonDraft((current) => [...current, point]);
      return;
    }

    if (tool === "door") {
      addOpening(point, "door");
      return;
    }

    if (tool === "window") {
      addOpening(point, "window");
      return;
    }

    if (tool === "waypoint") {
      addWaypoint(point);
      return;
    }

    if (tool === "path") {
      const nearestNode = nearest(
        mvf.nodes.features.map((feature) => ({
          id: feature.id,
          ...toPointFromCoords(feature.geometry.coordinates),
        })),
        point,
        14,
      );
      if (!nearestNode) return;
      if (!pathDraft) {
        setPathDraft(nearestNode.id);
      } else {
        connectWaypoints(pathDraft, nearestNode.id);
        setPathDraft(null);
      }
      return;
    }
  }

  function onMouseMove(event) {
    const point = canvasToWorld(event);
    if (!point) return;
    setCursor(point);
    if (!drawing) return;

    if (drawing.kind === "wall") {
      const snappedEnd = snapEnabled ? angleSnap(drawing.start, point) : point;
      setDrawing((current) => ({ ...current, end: snappedEnd }));
      return;
    }

    if (drawing.kind === "room") {
      setDrawing((current) => ({ ...current, end: point }));
    }
  }

  function onMouseUp() {
    if (!drawing) return;
    if (drawing.kind === "wall") {
      addWall(drawing.start, drawing.end);
    }
    if (drawing.kind === "room") {
      addRectRoom(drawing.start, drawing.end);
    }
    setDrawing(null);
  }

  function onDoubleClick() {
    if (tool !== "room" || roomShape !== "polygon") return;
    if (polygonDraft.length < 3) return;
    addPolygonRoom(polygonDraft);
    setPolygonDraft([]);
  }

  function zoomBy(factor) {
    setScale((current) => Math.max(0.2, Math.min(6, current * factor)));
  }

  function updateSelectionProperty(key, value) {
    if (!selected) return;
    updateMvf((next) => {
      const collections = [
        next.spaces.features,
        next.obstructions.features,
        next.openings.features,
        next.objects.features,
        next.nodes.features,
      ];
      for (const collection of collections) {
        const match = collection.find((feature) => feature.id === selected);
        if (!match) continue;
        if (!match.properties) match.properties = {};
        match.properties[key] = value;
        break;
      }
    });
  }

  useImperativeHandle(ref, () => ({
    save: saveMap,
    undo,
    redo,
    zoomIn: () => zoomBy(1.12),
    zoomOut: () => zoomBy(0.88),
    setZoom: (value) =>
      setScale(Math.max(0.2, Math.min(6, Number(value) || 1))),
    toggleGrid: () => setShowGrid((value) => !value),
    toggleSnap: () => setSnapEnabled((value) => !value),
  }));

  useEffect(() => {
    if (!onStateChange) return;
    onStateChange({
      tool,
      zoom: scale,
      dirty,
      canUndo: history.length > 0,
      canRedo: future.length > 0,
      showGrid,
      snapToGrid: snapEnabled,
      cursor,
      selectedElement: selected,
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
    onStateChange,
    scale,
    selected,
    showGrid,
    snapEnabled,
    tool,
  ]);

  const selectedFeatureData = selectedFeature();

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
        <aside className="w-72 shrink-0 border-r border-default bg-surface p-3">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
            Draw Tools
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {[
              ["select", "Select", "S", Move],
              ["wall", "Wall", "W", Pencil],
              ["room", "Room", "R", Square],
              ["door", "Door", "D", Plus],
              ["window", "Window", "I", Plus],
              ["waypoint", "Waypoint", "P", Plus],
              ["path", "Path", "E", GitBranch],
            ].map(([id, label, key, Icon]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTool(id)}
                className={`flex items-center gap-2 rounded-md border px-2 py-2 text-left text-sm ${tool === id ? "border-blue-600 bg-blue-50 text-blue-700" : "border-default"}`}
              >
                <Icon className="h-4 w-4" />
                <span>{label}</span>
                <span className="ml-auto text-xs text-muted">{key}</span>
              </button>
            ))}
          </div>

          <div className="mt-4 text-xs font-semibold uppercase tracking-[0.12em] text-muted">
            Room Shape
          </div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className={`rounded-md px-3 py-1 text-sm ${roomShape === "rectangle" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700"}`}
              onClick={() => setRoomShape("rectangle")}
            >
              Rectangle
            </button>
            <button
              type="button"
              className={`rounded-md px-3 py-1 text-sm ${roomShape === "polygon" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700"}`}
              onClick={() => setRoomShape("polygon")}
            >
              Polygon
            </button>
          </div>

          <div className="mt-4 text-xs font-semibold uppercase tracking-[0.12em] text-muted">
            Room Type
          </div>
          <select
            className="mt-2 w-full rounded-md border border-default px-2 py-2 text-sm"
            value={roomKind}
            onChange={(event) => setRoomKind(event.target.value)}
          >
            <option value="room">Classroom / Room</option>
            <option value="corridor">Corridor</option>
            <option value="stairs">Stairs</option>
            <option value="elevator">Elevator</option>
            <option value="entrance">Entrance</option>
            <option value="canteen">Canteen</option>
            <option value="store">Store</option>
            <option value="atm">ATM</option>
            <option value="emergency">Emergency</option>
            <option value="parking">Parking</option>
          </select>

          <div className="mt-4 text-xs font-semibold uppercase tracking-[0.12em] text-muted">
            Utilities
          </div>
          <div className="mt-2 space-y-2">
            <button
              type="button"
              onClick={() => setShowBackground((v) => !v)}
              className="flex w-full items-center gap-2 rounded-md border border-default px-2 py-2 text-sm"
            >
              {showBackground ? (
                <Eye className="h-4 w-4" />
              ) : (
                <EyeOff className="h-4 w-4" />
              )}{" "}
              Background
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full items-center gap-2 rounded-md border border-default px-2 py-2 text-sm"
            >
              <ImagePlus className="h-4 w-4" /> Import Floor Image
            </button>
            <button
              type="button"
              onClick={() => importInputRef.current?.click()}
              className="flex w-full items-center gap-2 rounded-md border border-default px-2 py-2 text-sm"
            >
              <Import className="h-4 w-4" /> Import MVF JSON
            </button>
            <button
              type="button"
              onClick={exportMvf}
              className="flex w-full items-center gap-2 rounded-md border border-default px-2 py-2 text-sm"
            >
              <Download className="h-4 w-4" /> Export MVF JSON
            </button>
            <button
              type="button"
              onClick={validateMap}
              className="flex w-full items-center gap-2 rounded-md border border-default px-2 py-2 text-sm"
            >
              <Save className="h-4 w-4" /> Validate
            </button>
            <button
              type="button"
              onClick={autoGenerateWaypoints}
              className="flex w-full items-center gap-2 rounded-md border border-default px-2 py-2 text-sm"
            >
              <GitBranch className="h-4 w-4" /> Auto Waypoints
            </button>
            <button
              type="button"
              onClick={() => setAiModalOpen(true)}
              className="flex w-full items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-2 py-2 text-sm text-blue-700"
            >
              <Sparkles className="h-4 w-4" /> Auto Trace Draft
            </button>
            <button
              type="button"
              onClick={() => setSnapEnabled((value) => !value)}
              className={`flex w-full items-center gap-2 rounded-md border px-2 py-2 text-sm ${snapEnabled ? "border-blue-200 bg-blue-50 text-blue-700" : "border-default"}`}
            >
              <Magnet className="h-4 w-4" /> Snap {snapEnabled ? "ON" : "OFF"}
            </button>
          </div>

          <div className="mt-4">
            <label className="text-xs text-muted">
              Scale (pixels per meter)
            </label>
            <input
              type="number"
              min="1"
              className="mt-1 w-full rounded-md border border-default px-2 py-1 text-sm"
              value={Number(mvf.meta?.pixelsPerMeter || 20)}
              onChange={(event) => {
                const next = Number(event.target.value || 20);
                updateMvf((state) => {
                  state.meta.pixelsPerMeter = next;
                }, false);
              }}
            />
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

        <div
          ref={containerRef}
          className="relative min-h-0 flex-1 overflow-hidden bg-slate-100"
          onDoubleClick={onDoubleClick}
        >
          <Stage
            ref={stageRef}
            width={size.width}
            height={size.height}
            scaleX={scale}
            scaleY={scale}
            x={position.x}
            y={position.y}
            draggable={tool === "select"}
            onDragEnd={(event) =>
              setPosition({ x: event.target.x(), y: event.target.y() })
            }
            onWheel={(event) => {
              event.evt.preventDefault();
              const factor = event.evt.deltaY > 0 ? 0.92 : 1.08;
              zoomBy(factor);
            }}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
          >
            <Layer listening={false}>
              {showGrid &&
                Array.from({ length: 300 }).map((_, index) => (
                  <Line
                    key={`grid-x-${index}`}
                    points={[index * 40, 0, index * 40, 6000]}
                    stroke="#e2e8f0"
                    strokeWidth={0.5}
                  />
                ))}
              {showGrid &&
                Array.from({ length: 200 }).map((_, index) => (
                  <Line
                    key={`grid-y-${index}`}
                    points={[0, index * 40, 6000, index * 40]}
                    stroke="#e2e8f0"
                    strokeWidth={0.5}
                  />
                ))}
            </Layer>

            <Layer>
              {showBackground && backgroundImage ? (
                <KonvaImage
                  image={backgroundImage}
                  width={mvf.meta?.imageWidth || backgroundImage.width}
                  height={mvf.meta?.imageHeight || backgroundImage.height}
                  opacity={0.85}
                />
              ) : null}
            </Layer>

            <Layer>
              {mvf.spaces.features.map((feature) => {
                const points = roomPolygon(feature);
                const center = polygonCenter(points);
                const kind = String(
                  feature.properties?.kind || "room",
                ).toLowerCase();
                const fill = ROOM_COLORS[kind] || ROOM_COLORS.room;
                const selectedNow = selected === feature.id;
                return (
                  <Group key={feature.id}>
                    <Line
                      points={flatten(points)}
                      closed
                      fill={fill}
                      stroke={selectedNow ? "#1d4ed8" : "#4b5563"}
                      strokeWidth={selectedNow ? 2.4 : 1.5}
                      onClick={() => setSelected(feature.id)}
                      draggable={!previewMode && tool === "select"}
                      onDragEnd={(event) => {
                        const dx = event.target.x();
                        const dy = event.target.y();
                        event.target.position({ x: 0, y: 0 });
                        updateMvf((next) => {
                          const target = next.spaces.features.find(
                            (entry) => entry.id === feature.id,
                          );
                          if (!target) return;
                          target.geometry.coordinates[0] =
                            target.geometry.coordinates[0].map((coord) => [
                              coord[0] + dx,
                              coord[1] + dy,
                            ]);
                        });
                      }}
                      onDblClick={() => {
                        const name = window.prompt(
                          "Rename space",
                          feature.properties?.name || "Room",
                        );
                        if (name === null) return;
                        updateSelectionProperty("name", name.trim() || "Room");
                      }}
                    />
                    <Text
                      x={center.x - 60}
                      y={center.y - 10}
                      width={120}
                      align="center"
                      text={feature.properties?.name || "Room"}
                      fontSize={12}
                      fill="#111827"
                      listening={false}
                    />
                    {selectedNow && (
                      <Rect
                        x={polygonBounds(points).x}
                        y={polygonBounds(points).y}
                        width={polygonBounds(points).width}
                        height={polygonBounds(points).height}
                        stroke="#2563eb"
                        dash={[6, 4]}
                        listening={false}
                      />
                    )}
                  </Group>
                );
              })}

              {mvf.obstructions.features.map((feature) => {
                const coordinates = feature.geometry?.coordinates || [];
                if (coordinates.length < 2) return null;
                const a = toPointFromCoords(coordinates[0]);
                const b = toPointFromCoords(coordinates[1]);
                const selectedNow = selected === feature.id;
                return (
                  <Group key={feature.id}>
                    <Line
                      points={[a.x, a.y, b.x, b.y]}
                      stroke="#333333"
                      strokeWidth={feature.properties?.thickness || 4}
                      onClick={() => setSelected(feature.id)}
                    />
                    {selectedNow && !previewMode && (
                      <>
                        <Circle
                          x={a.x}
                          y={a.y}
                          radius={6}
                          fill="#2563eb"
                          draggable
                          onDragMove={(event) => {
                            updateMvf((next) => {
                              const target = next.obstructions.features.find(
                                (entry) => entry.id === feature.id,
                              );
                              if (!target) return;
                              target.geometry.coordinates[0] = [
                                event.target.x(),
                                event.target.y(),
                              ];
                            }, false);
                          }}
                          onDragEnd={() => pushHistory(mvfRef.current)}
                        />
                        <Circle
                          x={b.x}
                          y={b.y}
                          radius={6}
                          fill="#2563eb"
                          draggable
                          onDragMove={(event) => {
                            updateMvf((next) => {
                              const target = next.obstructions.features.find(
                                (entry) => entry.id === feature.id,
                              );
                              if (!target) return;
                              target.geometry.coordinates[1] = [
                                event.target.x(),
                                event.target.y(),
                              ];
                            }, false);
                          }}
                          onDragEnd={() => pushHistory(mvfRef.current)}
                        />
                      </>
                    )}
                  </Group>
                );
              })}

              {mvf.openings.features.map((feature) => {
                const point = toPointFromCoords(feature.geometry?.coordinates);
                const kind = feature.properties?.kind;
                const selectedNow = selected === feature.id;
                if (kind === "door") {
                  return (
                    <Group
                      key={feature.id}
                      onClick={() => setSelected(feature.id)}
                    >
                      <Line
                        points={[point.x - 12, point.y, point.x + 12, point.y]}
                        stroke="#2196F3"
                        strokeWidth={3}
                      />
                      <Line
                        points={[point.x, point.y, point.x + 8, point.y - 8]}
                        stroke="#2196F3"
                        strokeWidth={2}
                      />
                      {selectedNow && (
                        <Circle
                          x={point.x}
                          y={point.y}
                          radius={5}
                          stroke="#1d4ed8"
                        />
                      )}
                    </Group>
                  );
                }

                return (
                  <Group
                    key={feature.id}
                    onClick={() => setSelected(feature.id)}
                  >
                    <Line
                      points={[
                        point.x - 10,
                        point.y - 3,
                        point.x + 10,
                        point.y - 3,
                      ]}
                      stroke="#00BCD4"
                      strokeWidth={2}
                    />
                    <Line
                      points={[
                        point.x - 10,
                        point.y + 3,
                        point.x + 10,
                        point.y + 3,
                      ]}
                      stroke="#00BCD4"
                      strokeWidth={2}
                    />
                    {selectedNow && (
                      <Circle
                        x={point.x}
                        y={point.y}
                        radius={5}
                        stroke="#1d4ed8"
                      />
                    )}
                  </Group>
                );
              })}

              {showNavGraph &&
                navEdges.map((edge, index) => {
                  const source = nodeMap.get(edge.from);
                  const target = nodeMap.get(edge.to);
                  if (!source || !target) return null;
                  const a = source.geometry.coordinates;
                  const b = target.geometry.coordinates;
                  return (
                    <Line
                      key={`edge-${index}-${edge.from}-${edge.to}`}
                      points={[a[0], a[1], b[0], b[1]]}
                      stroke="#00C853"
                      strokeWidth={1.5}
                      dash={[5, 5]}
                      listening={false}
                    />
                  );
                })}

              {showNavGraph &&
                mvf.nodes.features.map((feature) => {
                  const point = toPointFromCoords(feature.geometry.coordinates);
                  return (
                    <Circle
                      key={feature.id}
                      x={point.x}
                      y={point.y}
                      radius={5}
                      fill="#00C853"
                      stroke="#007B33"
                      strokeWidth={1.2}
                      onClick={() => setSelected(feature.id)}
                      draggable={!previewMode && tool === "select"}
                      onDragMove={(event) => {
                        updateMvf((next) => {
                          const target = next.nodes.features.find(
                            (entry) => entry.id === feature.id,
                          );
                          if (!target) return;
                          target.geometry.coordinates = [
                            event.target.x(),
                            event.target.y(),
                          ];
                        }, false);
                      }}
                      onDragEnd={() => pushHistory(mvfRef.current)}
                    />
                  );
                })}

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
                  fill="#9370DB33"
                  stroke="#4c1d95"
                  dash={[6, 4]}
                  listening={false}
                />
              )}

              {polygonDraft.length > 0 && (
                <Line
                  points={flatten(polygonDraft)}
                  stroke="#6d28d9"
                  strokeWidth={2}
                  dash={[5, 4]}
                  listening={false}
                />
              )}
            </Layer>
          </Stage>
        </div>

        <aside className="w-80 shrink-0 border-l border-default bg-surface p-3">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
            How to use the editor
          </div>
          <ul className="mt-2 space-y-1 text-sm text-slate-600">
            <li>S: Select elements</li>
            <li>W: Draw walls (angle snaps to 0/45/90)</li>
            <li>R: Draw rooms (rectangle or polygon)</li>
            <li>D: Place doors on walls</li>
            <li>I: Place windows</li>
            <li>P: Place waypoints</li>
            <li>E: Connect waypoints</li>
            <li>Ctrl+Z / Ctrl+Y: Undo / Redo</li>
          </ul>

          <div className="mt-4 rounded-lg border border-default p-3">
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
              Selection
            </div>
            {!selectedFeatureData ? (
              <div className="mt-2 text-sm text-slate-500">
                Select an element to edit properties.
              </div>
            ) : (
              <div className="mt-2 space-y-2">
                <div className="text-sm font-medium text-slate-800">
                  {selectedFeatureData.properties?.name ||
                    selectedFeatureData.properties?.kind ||
                    "Element"}
                </div>
                {selectedFeatureData.properties && (
                  <>
                    <label className="block text-xs text-slate-500">Name</label>
                    <input
                      className="w-full rounded-md border border-default px-2 py-1 text-sm"
                      value={selectedFeatureData.properties.name || ""}
                      onChange={(event) =>
                        updateSelectionProperty("name", event.target.value)
                      }
                    />
                    {selectedFeatureData.properties.color !== undefined && (
                      <>
                        <label className="block text-xs text-slate-500">
                          Color
                        </label>
                        <input
                          type="color"
                          className="h-9 w-full rounded-md border border-default"
                          value={
                            selectedFeatureData.properties.color || "#9370DB"
                          }
                          onChange={(event) =>
                            updateSelectionProperty("color", event.target.value)
                          }
                        />
                      </>
                    )}
                  </>
                )}
                <button
                  type="button"
                  className="w-full rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white"
                  onClick={removeSelection}
                >
                  Delete
                </button>
              </div>
            )}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setShowNavGraph((value) => !value)}
              className="rounded-md border border-default px-2 py-2 text-sm"
            >
              {showNavGraph ? "Hide Graph" : "Show Graph"}
            </button>
            <button
              type="button"
              onClick={saveMap}
              className="rounded-md bg-blue-600 px-2 py-2 text-sm font-medium text-white"
            >
              Save
            </button>
          </div>

          <div className="mt-4 text-xs text-slate-500">
            {counts.rooms} spaces • {counts.waypoints} waypoints •{" "}
            {counts.paths} edges • zoom {Math.round(scale * 100)}%
          </div>
        </aside>
      </div>
    </>
  );
});

export default MapEditor;
