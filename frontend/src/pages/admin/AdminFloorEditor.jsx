import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Save,
  Upload,
  MousePointer,
  Square,
  Minus,
  GitMerge,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  QrCode,
  Trash2,
  Eye,
  EyeOff,
  Layers,
  Download,
  X,
  Check,
  Navigation,
  Undo2,
  Redo2,
  AlertTriangle,
  Copy,
  Grid,
} from "lucide-react";
import { api } from "../../utils/api.js";
import { uploadFile } from "../../utils/supabase.js";
import { useTheme } from "../../context/themeContext.jsx";
import toast from "react-hot-toast";
import { v4 as uuidv4 } from "uuid";

// ─── Room Types ──────────────────────────────────────────────────────
const ROOM_TYPES = {
  classroom: {
    label: "Classroom",
    color: "#6366f1",
    bg: "rgba(99,102,241,0.15)",
  },
  lab: { label: "Lab", color: "#8b5cf6", bg: "rgba(139,92,246,0.15)" },
  office: { label: "Office", color: "#06b6d4", bg: "rgba(6,182,212,0.15)" },
  toilet: { label: "Restroom", color: "#64748b", bg: "rgba(100,116,139,0.15)" },
  stairs: { label: "Stairs", color: "#f59e0b", bg: "rgba(245,158,11,0.15)" },
  elevator: {
    label: "Elevator",
    color: "#10b981",
    bg: "rgba(16,185,129,0.15)",
  },
  entrance: { label: "Entrance", color: "#ef4444", bg: "rgba(239,68,68,0.15)" },
  canteen: { label: "Canteen", color: "#f97316", bg: "rgba(249,115,22,0.15)" },
  corridor: {
    label: "Corridor",
    color: "#94a3b8",
    bg: "rgba(148,163,184,0.08)",
  },
  other: { label: "Other", color: "#a3a3a3", bg: "rgba(163,163,163,0.12)" },
};

// ─── Tools ───────────────────────────────────────────────────────────
const TOOLS = {
  SELECT: "select",
  DRAW_ROOM: "draw_room",
  DRAW_WAYPOINT: "draw_waypoint",
  CONNECT_WAYPOINTS: "connect_waypoints",
  DELETE_WAYPOINT: "delete_waypoint",
};

// ─── Constants ───────────────────────────────────────────────────────
const GRID_SIZE = 10;
const CORRIDOR_NODE_SPACING = 150;
const AUTO_CONNECT_DISTANCE = 200;
const RESIZE_HANDLE_SIZE = 8;

// ─── Snap helper ─────────────────────────────────────────────────────
function snapToGrid(value, enabled) {
  if (!enabled) return value;
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

// ─── Auto-generate waypoints with corridor detection ─────────────────
function autoGenerateWaypoints(rooms, floorId) {
  const waypoints = [];

  rooms.forEach((room) => {
    if (room.type === "corridor") {
      // Generate multiple waypoints along corridor center, every CORRIDOR_NODE_SPACING px
      const isHorizontal = room.width >= room.height;
      const centerY = room.y + room.height / 2;
      const centerX = room.x + room.width / 2;

      if (isHorizontal) {
        const startX = room.x + 20;
        const endX = room.x + room.width - 20;
        const count = Math.max(
          2,
          Math.ceil((endX - startX) / CORRIDOR_NODE_SPACING) + 1,
        );
        const step = (endX - startX) / (count - 1);

        for (let i = 0; i < count; i++) {
          waypoints.push({
            id: uuidv4(),
            x: Math.round(startX + step * i),
            y: Math.round(centerY),
            room_id: room.id,
            type: "corridor",
            floor_id: floorId,
          });
        }
      } else {
        const startY = room.y + 20;
        const endY = room.y + room.height - 20;
        const count = Math.max(
          2,
          Math.ceil((endY - startY) / CORRIDOR_NODE_SPACING) + 1,
        );
        const step = (endY - startY) / (count - 1);

        for (let i = 0; i < count; i++) {
          waypoints.push({
            id: uuidv4(),
            x: Math.round(centerX),
            y: Math.round(startY + step * i),
            room_id: room.id,
            type: "corridor",
            floor_id: floorId,
          });
        }
      }
    } else {
      // Single center waypoint for non-corridor rooms
      waypoints.push({
        id: uuidv4(),
        x: Math.round(room.x + room.width / 2),
        y: Math.round(room.y + room.height / 2),
        room_id: room.id,
        type:
          room.type === "stairs"
            ? "stairs"
            : room.type === "elevator"
              ? "elevator"
              : "room_center",
        floor_id: floorId,
      });
    }
  });

  return waypoints;
}

// ─── Auto-connect waypoints ──────────────────────────────────────────
function autoConnectWaypoints(waypoints, rooms) {
  const connections = [];
  const connected = new Set();

  // First, connect corridor waypoints belonging to same corridor sequentially
  const corridorRooms = rooms.filter((r) => r.type === "corridor");
  corridorRooms.forEach((corridor) => {
    const corridorWps = waypoints
      .filter((w) => w.room_id === corridor.id)
      .sort((a, b) => {
        if (corridor.width >= corridor.height) return a.x - b.x;
        return a.y - b.y;
      });

    for (let i = 0; i < corridorWps.length - 1; i++) {
      const key = [corridorWps[i].id, corridorWps[i + 1].id].sort().join("_");
      if (!connected.has(key)) {
        connections.push({
          id: uuidv4(),
          waypoint_a_id: corridorWps[i].id,
          waypoint_b_id: corridorWps[i + 1].id,
        });
        connected.add(key);
      }
    }
  });

  // Then, connect each non-corridor room waypoint to nearest corridor waypoint
  const corridorWps = waypoints.filter((w) => w.type === "corridor");
  const roomWps = waypoints.filter((w) => w.type !== "corridor");

  roomWps.forEach((wp) => {
    let nearest = null;
    let minDist = Infinity;

    corridorWps.forEach((cwp) => {
      const dist = Math.sqrt((wp.x - cwp.x) ** 2 + (wp.y - cwp.y) ** 2);
      if (dist < minDist && dist < AUTO_CONNECT_DISTANCE) {
        minDist = dist;
        nearest = cwp;
      }
    });

    if (nearest) {
      const key = [wp.id, nearest.id].sort().join("_");
      if (!connected.has(key)) {
        connections.push({
          id: uuidv4(),
          waypoint_a_id: wp.id,
          waypoint_b_id: nearest.id,
        });
        connected.add(key);
      }
    }
  });

  // Also connect nearby waypoints as fallback
  waypoints.forEach((wp, i) => {
    waypoints.forEach((wp2, j) => {
      if (i >= j) return;
      const dist = Math.sqrt((wp.x - wp2.x) ** 2 + (wp.y - wp2.y) ** 2);
      const key = [wp.id, wp2.id].sort().join("_");
      if (dist < AUTO_CONNECT_DISTANCE && !connected.has(key)) {
        connections.push({
          id: uuidv4(),
          waypoint_a_id: wp.id,
          waypoint_b_id: wp2.id,
        });
        connected.add(key);
      }
    });
  });

  return connections;
}

// ─── Validation ──────────────────────────────────────────────────────
function validateMap(rooms, waypoints, connections) {
  const warnings = [];

  // Check each room has at least one waypoint
  const roomsWithWaypoints = new Set(
    waypoints.filter((w) => w.room_id).map((w) => w.room_id),
  );
  const roomsWithout = rooms.filter(
    (r) => r.type !== "corridor" && !roomsWithWaypoints.has(r.id),
  );
  if (roomsWithout.length > 0) {
    warnings.push(
      `${roomsWithout.length} room(s) have no waypoint: ${roomsWithout.map((r) => r.name || "Unnamed").join(", ")}`,
    );
  }

  // Check for stairs or elevator
  const hasTransition = rooms.some(
    (r) => r.type === "stairs" || r.type === "elevator",
  );
  if (!hasTransition && rooms.length > 0) {
    warnings.push(
      "No stairs or elevator room found. Multi-floor navigation won't work.",
    );
  }

  // Check graph connectivity (simple BFS)
  if (waypoints.length > 0 && connections.length > 0) {
    const adj = {};
    waypoints.forEach((w) => (adj[w.id] = []));
    connections.forEach((c) => {
      if (adj[c.waypoint_a_id]) adj[c.waypoint_a_id].push(c.waypoint_b_id);
      if (adj[c.waypoint_b_id]) adj[c.waypoint_b_id].push(c.waypoint_a_id);
    });

    const visited = new Set();
    const queue = [waypoints[0].id];
    visited.add(waypoints[0].id);
    while (queue.length > 0) {
      const current = queue.shift();
      (adj[current] || []).forEach((n) => {
        if (!visited.has(n)) {
          visited.add(n);
          queue.push(n);
        }
      });
    }

    const disconnected = waypoints.length - visited.size;
    if (disconnected > 0) {
      warnings.push(
        `${disconnected} waypoint(s) are disconnected from the main graph.`,
      );
    }
  }

  if (waypoints.length === 0 && rooms.length > 0) {
    warnings.push(
      'No waypoints found. Run "Auto Nav" to generate navigation graph.',
    );
  }

  return warnings;
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════
export default function AdminFloorEditor() {
  const { buildingId, floorId } = useParams();
  const navigate = useNavigate();
  const { isDark } = useTheme();
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const imgRef = useRef(null);

  // ─── State ─────────────────────────────────────────────────────────
  const [floor, setFloor] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [waypoints, setWaypoints] = useState([]);
  const [connections, setConnections] = useState([]);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [selectedRooms, setSelectedRooms] = useState([]); // multi-select
  const [selectedWaypoint, setSelectedWaypoint] = useState(null);
  const [connectStart, setConnectStart] = useState(null);

  const [tool, setTool] = useState(TOOLS.SELECT);
  const [drawing, setDrawing] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState(null);
  const [dragRoom, setDragRoom] = useState(null);
  const [resizing, setResizing] = useState(null); // { roomId, handle, startX, startY, origRoom }
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState(null);
  const [zoom, setZoom] = useState(1);

  const [floorPlanImg, setFloorPlanImg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [roomPanel, setRoomPanel] = useState(false);
  const [qrModal, setQrModal] = useState(null);
  const [newRoomType, setNewRoomType] = useState("classroom");
  const [uploading, setUploading] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [validationWarnings, setValidationWarnings] = useState([]);
  const [showValidation, setShowValidation] = useState(false);

  // Layer visibility
  const [layers, setLayers] = useState({
    rooms: true,
    waypoints: false,
    connections: false,
    floorPlan: true,
  });

  // Undo/Redo history
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const [canvasSize, setCanvasSize] = useState({ w: 1200, h: 800 });

  // ─── Load floor data ──────────────────────────────────────────────
  useEffect(() => {
    api.floors
      .get(floorId)
      .then((data) => {
        setFloor(data);
        setRooms(data.rooms || []);
        setWaypoints(data.waypoints || []);
        setConnections(data.connections || []);
        if (data.floor_plan_url) setFloorPlanImg(data.floor_plan_url);
        // Initial history snapshot
        pushHistory(
          data.rooms || [],
          data.waypoints || [],
          data.connections || [],
        );
      })
      .catch(() => toast.error("Failed to load floor"));
  }, [floorId]);

  // ─── Canvas sizing ────────────────────────────────────────────────
  useEffect(() => {
    const update = () => {
      if (containerRef.current) {
        const { width, height } = containerRef.current.getBoundingClientRect();
        setCanvasSize({ w: width, h: height });
      }
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // ─── Load floor plan image ────────────────────────────────────────
  useEffect(() => {
    if (!floorPlanImg) {
      imgRef.current = null;
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = floorPlanImg;
    img.onload = () => {
      imgRef.current = img;
    };
  }, [floorPlanImg]);

  // ─── History (Undo/Redo) ──────────────────────────────────────────
  const pushHistory = useCallback(
    (r, w, c) => {
      setHistory((prev) => {
        const newHistory = prev.slice(0, historyIndex + 1);
        newHistory.push({
          rooms: JSON.parse(JSON.stringify(r)),
          waypoints: JSON.parse(JSON.stringify(w)),
          connections: JSON.parse(JSON.stringify(c)),
        });
        // Limit history to 50 entries
        if (newHistory.length > 50) newHistory.shift();
        return newHistory;
      });
      setHistoryIndex((prev) => Math.min(prev + 1, 49));
    },
    [historyIndex],
  );

  const saveSnapshot = useCallback(() => {
    pushHistory(rooms, waypoints, connections);
  }, [rooms, waypoints, connections, pushHistory]);

  const undo = useCallback(() => {
    if (historyIndex <= 0) return;
    const newIndex = historyIndex - 1;
    const state = history[newIndex];
    if (state) {
      setRooms(state.rooms);
      setWaypoints(state.waypoints);
      setConnections(state.connections);
      setHistoryIndex(newIndex);
    }
  }, [history, historyIndex]);

  const redo = useCallback(() => {
    if (historyIndex >= history.length - 1) return;
    const newIndex = historyIndex + 1;
    const state = history[newIndex];
    if (state) {
      setRooms(state.rooms);
      setWaypoints(state.waypoints);
      setConnections(state.connections);
      setHistoryIndex(newIndex);
    }
  }, [history, historyIndex]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo]);

  // ─── Canvas coordinate helpers ────────────────────────────────────
  const toCanvas = useCallback(
    (clientX, clientY) => {
      const rect = canvasRef.current.getBoundingClientRect();
      return {
        x: (clientX - rect.left - pan.x) / zoom,
        y: (clientY - rect.top - pan.y) / zoom,
      };
    },
    [pan, zoom],
  );

  const getRoomAt = useCallback(
    (x, y) =>
      [...rooms]
        .reverse()
        .find(
          (r) =>
            x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height,
        ),
    [rooms],
  );

  const getWaypointAt = useCallback(
    (x, y) =>
      waypoints.find(
        (w) => Math.sqrt((w.x - x) ** 2 + (w.y - y) ** 2) < 12 / zoom,
      ),
    [waypoints, zoom],
  );

  // Detect resize handle at position
  const getResizeHandle = useCallback(
    (x, y, room) => {
      if (!room) return null;
      const hs = RESIZE_HANDLE_SIZE / zoom;
      const handles = [
        { id: "tl", hx: room.x, hy: room.y },
        { id: "tr", hx: room.x + room.width, hy: room.y },
        { id: "bl", hx: room.x, hy: room.y + room.height },
        { id: "br", hx: room.x + room.width, hy: room.y + room.height },
      ];
      for (const h of handles) {
        if (Math.abs(x - h.hx) < hs && Math.abs(y - h.hy) < hs) return h.id;
      }
      return null;
    },
    [zoom],
  );

  // ─── Canvas Rendering ─────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    // Use requestAnimationFrame for smooth rendering
    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.translate(pan.x, pan.y);
      ctx.scale(zoom, zoom);

      // Anti-aliasing
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";

      // Floor plan image
      if (layers.floorPlan && imgRef.current && floorPlanImg) {
        ctx.globalAlpha = 0.4;
        ctx.drawImage(
          imgRef.current,
          0,
          0,
          floor?.floor_plan_width || canvasSize.w,
          floor?.floor_plan_height || canvasSize.h,
        );
        ctx.globalAlpha = 1;
      }

      // Grid
      if (snapEnabled) {
        ctx.strokeStyle = isDark
          ? "rgba(255,255,255,0.03)"
          : "rgba(0,0,0,0.04)";
        ctx.lineWidth = 0.5 / zoom;
        for (let x = 0; x < 3000; x += GRID_SIZE * 4) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, 3000);
          ctx.stroke();
        }
        for (let y = 0; y < 3000; y += GRID_SIZE * 4) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(3000, y);
          ctx.stroke();
        }
      }

      // Draw connections
      if (layers.connections || layers.waypoints) {
        connections.forEach((conn) => {
          const a = waypoints.find((w) => w.id === conn.waypoint_a_id);
          const b = waypoints.find((w) => w.id === conn.waypoint_b_id);
          if (!a || !b) return;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.strokeStyle = "rgba(99,102,241,0.4)";
          ctx.lineWidth = 2 / zoom;
          ctx.setLineDash([6, 4]);
          ctx.stroke();
          ctx.setLineDash([]);
        });
      }

      // Draw rooms
      if (layers.rooms) {
        rooms.forEach((room) => {
          const type = ROOM_TYPES[room.type] || ROOM_TYPES.other;
          const isSelected =
            selectedRoom?.id === room.id ||
            selectedRooms.some((r) => r.id === room.id);

          // Room fill
          ctx.fillStyle = room.color || type.bg;
          ctx.beginPath();
          ctx.roundRect(room.x, room.y, room.width, room.height, 6 / zoom);
          ctx.fill();

          // Room border
          ctx.strokeStyle = isSelected
            ? "#6366f1"
            : room.color
              ? room.color + "80"
              : type.color + "60";
          ctx.lineWidth = isSelected ? 2.5 / zoom : 1.5 / zoom;
          ctx.stroke();

          // Room label
          const fontSize = Math.max(10, Math.min(14, room.width / 8)) / zoom;
          ctx.fillStyle = isDark ? "#fff" : "#1e293b";
          ctx.font = `500 ${fontSize}px "DM Sans", sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(
            room.name || "Unnamed",
            room.x + room.width / 2,
            room.y + room.height / 2,
          );

          // Selection glow + resize handles
          if (isSelected) {
            ctx.shadowColor = "#6366f1";
            ctx.shadowBlur = 12;
            ctx.strokeStyle = "#6366f1";
            ctx.lineWidth = 2 / zoom;
            ctx.stroke();
            ctx.shadowBlur = 0;

            // Resize handles (4 corners)
            const hs = RESIZE_HANDLE_SIZE / zoom;
            [
              [room.x, room.y],
              [room.x + room.width, room.y],
              [room.x, room.y + room.height],
              [room.x + room.width, room.y + room.height],
            ].forEach(([hx, hy]) => {
              ctx.fillStyle = "#6366f1";
              ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
              ctx.strokeStyle = "#fff";
              ctx.lineWidth = 1 / zoom;
              ctx.strokeRect(hx - hs / 2, hy - hs / 2, hs, hs);
            });
          }
        });
      }

      // Draw waypoints
      if (layers.waypoints) {
        waypoints.forEach((wp) => {
          const isSelected = selectedWaypoint?.id === wp.id;
          const isConnectSt = connectStart?.id === wp.id;

          // Larger hit area visual
          ctx.beginPath();
          ctx.arc(wp.x, wp.y, 8 / zoom, 0, Math.PI * 2);
          ctx.fillStyle = isConnectSt
            ? "rgba(245,158,11,0.3)"
            : isSelected
              ? "rgba(99,102,241,0.3)"
              : "rgba(139,92,246,0.15)";
          ctx.fill();

          // Waypoint dot
          ctx.beginPath();
          ctx.arc(wp.x, wp.y, 5 / zoom, 0, Math.PI * 2);
          ctx.fillStyle = isConnectSt
            ? "#f59e0b"
            : isSelected
              ? "#6366f1"
              : wp.type === "stairs"
                ? "#f59e0b"
                : wp.type === "elevator"
                  ? "#10b981"
                  : wp.type === "corridor"
                    ? "#94a3b8"
                    : "#8b5cf6";
          ctx.fill();
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 1.5 / zoom;
          ctx.stroke();
        });
      }

      // In-progress room drawing
      if (drawing && tool === TOOLS.DRAW_ROOM) {
        const type = ROOM_TYPES[newRoomType] || ROOM_TYPES.other;
        ctx.fillStyle = type.bg;
        ctx.strokeStyle = type.color;
        ctx.lineWidth = 2 / zoom;
        ctx.setLineDash([6, 4]);
        const dx = Math.min(drawing.startX, drawing.currentX);
        const dy = Math.min(drawing.startY, drawing.currentY);
        const dw = Math.abs(drawing.currentX - drawing.startX);
        const dh = Math.abs(drawing.currentY - drawing.startY);
        ctx.beginPath();
        ctx.roundRect(dx, dy, dw, dh, 6 / zoom);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);

        // Size indicator
        ctx.fillStyle = isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.5)";
        ctx.font = `${10 / zoom}px monospace`;
        ctx.textAlign = "center";
        ctx.fillText(
          `${Math.round(dw)} × ${Math.round(dh)}`,
          dx + dw / 2,
          dy - 8 / zoom,
        );
      }

      ctx.restore();
    };

    render();
  }, [
    rooms,
    waypoints,
    connections,
    drawing,
    selectedRoom,
    selectedRooms,
    selectedWaypoint,
    connectStart,
    pan,
    zoom,
    floorPlanImg,
    layers,
    tool,
    newRoomType,
    canvasSize,
    floor,
    snapEnabled,
    isDark,
  ]);

  // ─── Mouse Handlers ───────────────────────────────────────────────
  const handleMouseDown = useCallback(
    (e) => {
      // Middle click or Alt+click → pan
      if (e.button === 1 || (e.button === 0 && e.altKey)) {
        setIsPanning(true);
        setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
        return;
      }

      const { x, y } = toCanvas(e.clientX, e.clientY);

      if (tool === TOOLS.SELECT) {
        // Check resize handle first
        if (selectedRoom) {
          const handle = getResizeHandle(x, y, selectedRoom);
          if (handle) {
            setResizing({
              roomId: selectedRoom.id,
              handle,
              startX: x,
              startY: y,
              origRoom: { ...selectedRoom },
            });
            return;
          }
        }

        const room = getRoomAt(x, y);
        if (room) {
          if (e.shiftKey) {
            // Multi-select
            setSelectedRooms((prev) => {
              const exists = prev.find((r) => r.id === room.id);
              if (exists) return prev.filter((r) => r.id !== room.id);
              return [...prev, room];
            });
          } else {
            setSelectedRoom(room);
            setSelectedRooms([]);
            setSelectedWaypoint(null);
            setRoomPanel(true);
            setDragRoom(room);
            setDragStart({
              x: e.clientX,
              y: e.clientY,
              origX: room.x,
              origY: room.y,
            });
            setIsDragging(false);
          }
        } else if (layers.waypoints) {
          const wp = getWaypointAt(x, y);
          if (wp) {
            setSelectedWaypoint(wp);
            setSelectedRoom(null);
            setSelectedRooms([]);
            setRoomPanel(false);
          } else {
            setSelectedRoom(null);
            setSelectedRooms([]);
            setSelectedWaypoint(null);
            setRoomPanel(false);
            // Pan with left click on empty space
            setIsPanning(true);
            setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
          }
        } else {
          setSelectedRoom(null);
          setSelectedRooms([]);
          setRoomPanel(false);
          setIsPanning(true);
          setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
        }
      }

      if (tool === TOOLS.DRAW_ROOM) {
        const sx = snapToGrid(x, snapEnabled);
        const sy = snapToGrid(y, snapEnabled);
        setDrawing({ startX: sx, startY: sy, currentX: sx, currentY: sy });
      }

      if (tool === TOOLS.DRAW_WAYPOINT) {
        const wp = {
          id: uuidv4(),
          x: snapToGrid(x, snapEnabled),
          y: snapToGrid(y, snapEnabled),
          type: "manual",
          room_id: null,
          floor_id: floorId,
        };
        setWaypoints((prev) => [...prev, wp]);
        saveSnapshot();
      }

      if (tool === TOOLS.CONNECT_WAYPOINTS) {
        const wp = getWaypointAt(x, y);
        if (wp) {
          if (!connectStart) {
            setConnectStart(wp);
          } else {
            if (connectStart.id !== wp.id) {
              setConnections((prev) => [
                ...prev,
                {
                  id: uuidv4(),
                  waypoint_a_id: connectStart.id,
                  waypoint_b_id: wp.id,
                },
              ]);
              saveSnapshot();
            }
            setConnectStart(null);
          }
        }
      }

      if (tool === TOOLS.DELETE_WAYPOINT) {
        const wp = getWaypointAt(x, y);
        if (wp) {
          setWaypoints((prev) => prev.filter((w) => w.id !== wp.id));
          setConnections((prev) =>
            prev.filter(
              (c) => c.waypoint_a_id !== wp.id && c.waypoint_b_id !== wp.id,
            ),
          );
          saveSnapshot();
        }
      }
    },
    [
      tool,
      pan,
      zoom,
      toCanvas,
      getRoomAt,
      getWaypointAt,
      getResizeHandle,
      selectedRoom,
      connectStart,
      snapEnabled,
      floorId,
      layers,
      saveSnapshot,
    ],
  );

  const handleMouseMove = useCallback(
    (e) => {
      if (isPanning && panStart) {
        setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
        return;
      }

      // Resizing
      if (resizing) {
        const { x, y } = toCanvas(e.clientX, e.clientY);
        const sx = snapToGrid(x, snapEnabled);
        const sy = snapToGrid(y, snapEnabled);
        const orig = resizing.origRoom;

        setRooms((prev) =>
          prev.map((r) => {
            if (r.id !== resizing.roomId) return r;
            let newR = { ...r };
            switch (resizing.handle) {
              case "br":
                newR.width = Math.max(30, sx - orig.x);
                newR.height = Math.max(30, sy - orig.y);
                break;
              case "bl":
                newR.x = Math.min(sx, orig.x + orig.width - 30);
                newR.width = Math.max(30, orig.x + orig.width - newR.x);
                newR.height = Math.max(30, sy - orig.y);
                break;
              case "tr":
                newR.y = Math.min(sy, orig.y + orig.height - 30);
                newR.width = Math.max(30, sx - orig.x);
                newR.height = Math.max(30, orig.y + orig.height - newR.y);
                break;
              case "tl":
                newR.x = Math.min(sx, orig.x + orig.width - 30);
                newR.y = Math.min(sy, orig.y + orig.height - 30);
                newR.width = Math.max(30, orig.x + orig.width - newR.x);
                newR.height = Math.max(30, orig.y + orig.height - newR.y);
                break;
            }
            return newR;
          }),
        );
        return;
      }

      if (dragRoom && dragStart) {
        const dx = e.clientX - dragStart.x;
        const dy = e.clientY - dragStart.y;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
          setIsDragging(true);
          const newX = snapToGrid(dragStart.origX + dx / zoom, snapEnabled);
          const newY = snapToGrid(dragStart.origY + dy / zoom, snapEnabled);
          setRooms((prev) =>
            prev.map((r) =>
              r.id === dragRoom.id ? { ...r, x: newX, y: newY } : r,
            ),
          );
        }
      }

      if (drawing && tool === TOOLS.DRAW_ROOM) {
        const { x, y } = toCanvas(e.clientX, e.clientY);
        setDrawing((d) => ({
          ...d,
          currentX: snapToGrid(x, snapEnabled),
          currentY: snapToGrid(y, snapEnabled),
        }));
      }
    },
    [
      isPanning,
      panStart,
      resizing,
      dragRoom,
      dragStart,
      drawing,
      tool,
      zoom,
      toCanvas,
      snapEnabled,
    ],
  );

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
    setPanStart(null);

    if (resizing) {
      setResizing(null);
      setSelectedRoom(rooms.find((r) => r.id === resizing.roomId) || null);
      saveSnapshot();
    }

    if (dragRoom) {
      if (isDragging) {
        setSelectedRoom(rooms.find((r) => r.id === dragRoom.id));
        saveSnapshot();
      }
      setDragRoom(null);
      setDragStart(null);
      setIsDragging(false);
    }

    if (drawing && tool === TOOLS.DRAW_ROOM) {
      const w = Math.abs(drawing.currentX - drawing.startX);
      const h = Math.abs(drawing.currentY - drawing.startY);
      if (w > 20 && h > 20) {
        const type = ROOM_TYPES[newRoomType] || ROOM_TYPES.other;
        const newRoom = {
          id: uuidv4(),
          floor_id: floorId,
          name: "",
          type: newRoomType,
          x: Math.min(drawing.startX, drawing.currentX),
          y: Math.min(drawing.startY, drawing.currentY),
          width: w,
          height: h,
          color: type.bg,
        };
        setRooms((prev) => [...prev, newRoom]);
        setSelectedRoom(newRoom);
        setRoomPanel(true);
        setTool(TOOLS.SELECT);
        saveSnapshot();
      }
      setDrawing(null);
    }
  }, [
    resizing,
    dragRoom,
    isDragging,
    drawing,
    tool,
    newRoomType,
    floorId,
    rooms,
    saveSnapshot,
  ]);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom((z) => Math.min(5, Math.max(0.2, z * delta)));
  }, []);

  // ─── Room operations ──────────────────────────────────────────────
  const updateRoom = useCallback(
    (field, value) => {
      setRooms((prev) =>
        prev.map((r) =>
          r.id === selectedRoom.id ? { ...r, [field]: value } : r,
        ),
      );
      setSelectedRoom((r) => ({ ...r, [field]: value }));
    },
    [selectedRoom],
  );

  const deleteRoom = useCallback(() => {
    setRooms((prev) => prev.filter((r) => r.id !== selectedRoom.id));
    setWaypoints((prev) => prev.filter((w) => w.room_id !== selectedRoom.id));
    setSelectedRoom(null);
    setRoomPanel(false);
    saveSnapshot();
  }, [selectedRoom, saveSnapshot]);

  // ─── Auto-generate waypoints ──────────────────────────────────────
  const handleAutoWaypoints = useCallback(() => {
    const autoWps = autoGenerateWaypoints(
      rooms.map((r) => ({ ...r, floor_id: floorId })),
      floorId,
    );
    const autoConns = autoConnectWaypoints(autoWps, rooms);
    setWaypoints(autoWps);
    setConnections(autoConns);
    setLayers((l) => ({ ...l, waypoints: true, connections: true }));
    saveSnapshot();
    toast.success(
      `Generated ${autoWps.length} waypoints and ${autoConns.length} connections`,
    );
  }, [rooms, floorId, saveSnapshot]);

  // ─── Upload floor plan ────────────────────────────────────────────
  const handleImageUpload = useCallback(
    async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      setUploading(true);
      try {
        const path = `floor-plans/${floorId}/${file.name}`;
        const url = await uploadFile("campusnav-assets", path, file);
        setFloorPlanImg(url);

        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = url;
        img.onload = async () => {
          imgRef.current = img;
          await api.floors.update(floorId, {
            floor_plan_url: url,
            floor_plan_width: img.naturalWidth,
            floor_plan_height: img.naturalHeight,
          });
        };
        toast.success("Floor plan uploaded");
      } catch (err) {
        toast.error("Upload failed: " + err.message);
      } finally {
        setUploading(false);
      }
    },
    [floorId],
  );

  // ─── Validate before save ─────────────────────────────────────────
  const handleValidate = useCallback(() => {
    const warnings = validateMap(rooms, waypoints, connections);
    setValidationWarnings(warnings);
    setShowValidation(true);
    if (warnings.length === 0) {
      toast.success("Map validation passed! ✓");
    }
  }, [rooms, waypoints, connections]);

  // ─── Save ──────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    // Validate first
    const warnings = validateMap(rooms, waypoints, connections);
    if (warnings.length > 0) {
      setValidationWarnings(warnings);
      setShowValidation(true);
    }

    setSaving(true);
    try {
      await api.floors.saveMap(floorId, {
        rooms: rooms.map((r) => ({
          id: r.id,
          floor_id: floorId,
          name: r.name || "Unnamed",
          type: r.type,
          x: Math.round(r.x),
          y: Math.round(r.y),
          width: Math.round(r.width),
          height: Math.round(r.height),
          color: r.color,
          description: r.description || "",
        })),
        waypoints: waypoints.map((w) => ({
          id: w.id,
          floor_id: floorId,
          x: Math.round(w.x),
          y: Math.round(w.y),
          type: w.type,
          room_id: w.room_id || null,
        })),
        connections: connections.map((c) => ({
          id: c.id,
          floor_id: floorId,
          waypoint_a_id: c.waypoint_a_id,
          waypoint_b_id: c.waypoint_b_id,
        })),
      });

      // Invalidate navigation cache for the building
      try {
        await api.navigation.invalidateCache(buildingId);
      } catch {
        // Non-critical — cache will expire naturally
      }

      toast.success("Map saved successfully!");
    } catch (err) {
      toast.error("Save failed: " + err.message);
    } finally {
      setSaving(false);
    }
  }, [rooms, waypoints, connections, floorId, buildingId]);

  // ─── Export map JSON ──────────────────────────────────────────────
  const handleExport = useCallback(() => {
    const data = {
      floor_id: floorId,
      building_id: buildingId,
      exported_at: new Date().toISOString(),
      rooms,
      waypoints,
      connections,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `map-${floor?.name || floorId}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Map exported");
  }, [rooms, waypoints, connections, floorId, buildingId, floor]);

  // ─── QR Code ──────────────────────────────────────────────────────
  const handleQR = useCallback(async (room) => {
    try {
      const data = await api.qr.room(room.id);
      setQrModal(data);
    } catch (err) {
      toast.error("QR generation failed: " + err.message);
    }
  }, []);

  const resetView = useCallback(() => {
    setPan({ x: 0, y: 0 });
    setZoom(1);
  }, []);

  // ─── Tool label ───────────────────────────────────────────────────
  const toolHint = useMemo(() => {
    switch (tool) {
      case TOOLS.SELECT:
        return "Click to select • Shift+click multi-select • Drag to move • Corners to resize • Scroll zoom • Alt+drag pan";
      case TOOLS.DRAW_ROOM:
        return "Click and drag to draw a room";
      case TOOLS.DRAW_WAYPOINT:
        return "Click to place a navigation waypoint";
      case TOOLS.CONNECT_WAYPOINTS:
        return connectStart
          ? "Click another waypoint to connect"
          : "Click a waypoint to start connecting";
      case TOOLS.DELETE_WAYPOINT:
        return "Click a waypoint to delete it";
      default:
        return "";
    }
  }, [tool, connectStart]);

  // ═══════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════
  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden">
      {/* ��── Top bar ─────────────────────────────────────────────── */}
      <div
        className={`flex items-center gap-3 px-4 py-3 border-b flex-shrink-0 flex-wrap ${
          isDark
            ? "border-white/5 bg-surface-900/50"
            : "border-gray-200 bg-white"
        }`}
      >
        <button
          onClick={() => navigate("/admin/buildings")}
          className={`p-2 rounded-lg transition-all ${
            isDark
              ? "text-white/40 hover:text-white hover:bg-white/5"
              : "text-gray-400 hover:text-gray-900 hover:bg-gray-100"
          }`}
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <h1
            className={`font-display font-semibold text-sm ${isDark ? "text-white" : "text-gray-900"}`}
          >
            {floor?.name || "Floor Editor"}
          </h1>
          <p
            className={`text-xs ${isDark ? "text-white/30" : "text-gray-400"}`}
          >
            {rooms.length} rooms · {waypoints.length} waypoints
          </p>
        </div>

        {/* Tools */}
        <div
          className={`flex items-center gap-1 px-2 py-1.5 rounded-xl ${isDark ? "glass" : "bg-gray-100"}`}
        >
          {[
            { id: TOOLS.SELECT, icon: MousePointer, label: "Select / Move" },
            { id: TOOLS.DRAW_ROOM, icon: Square, label: "Draw Room" },
            { id: TOOLS.DRAW_WAYPOINT, icon: GitMerge, label: "Add Waypoint" },
            {
              id: TOOLS.CONNECT_WAYPOINTS,
              icon: Minus,
              label: "Connect Waypoints",
            },
            {
              id: TOOLS.DELETE_WAYPOINT,
              icon: Trash2,
              label: "Delete Waypoint",
            },
          ].map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => {
                setTool(id);
                setConnectStart(null);
              }}
              title={label}
              className={`p-2 rounded-lg transition-all ${
                tool === id
                  ? "bg-brand-600 text-white"
                  : isDark
                    ? "text-white/40 hover:text-white hover:bg-white/5"
                    : "text-gray-400 hover:text-gray-900 hover:bg-gray-200"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
            </button>
          ))}
        </div>

        {/* Room type selector */}
        {tool === TOOLS.DRAW_ROOM && (
          <select
            className="input w-36 text-xs py-2"
            value={newRoomType}
            onChange={(e) => setNewRoomType(e.target.value)}
          >
            {Object.entries(ROOM_TYPES).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-1.5">
          {/* Snap grid */}
          <button
            onClick={() => setSnapEnabled((v) => !v)}
            title="Toggle snap grid"
            className={`btn-secondary text-xs py-2 ${snapEnabled ? "border-brand-500/40 text-brand-400" : ""}`}
          >
            <Grid className="w-3.5 h-3.5" />
          </button>

          {/* Undo/Redo */}
          <button
            onClick={undo}
            title="Undo (Ctrl+Z)"
            className="btn-secondary text-xs py-2"
            disabled={historyIndex <= 0}
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={redo}
            title="Redo (Ctrl+Shift+Z)"
            className="btn-secondary text-xs py-2"
            disabled={historyIndex >= history.length - 1}
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>

          {/* Upload floor plan */}
          <label className="btn-secondary text-xs py-2 cursor-pointer">
            {uploading ? (
              <div className="w-3.5 h-3.5 border border-current border-t-transparent rounded-full animate-spin" />
            ) : (
              <Upload className="w-3.5 h-3.5" />
            )}
            {floorPlanImg ? "Change Plan" : "Upload Plan"}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleImageUpload}
            />
          </label>

          {/* Auto waypoints */}
          <button
            onClick={handleAutoWaypoints}
            className="btn-secondary text-xs py-2"
            title="Auto-generate waypoints"
          >
            <Navigation className="w-3.5 h-3.5" /> Auto Nav
          </button>

          {/* Layer visibility */}
          <div
            className={`flex items-center gap-1 px-2 py-1.5 rounded-xl ${isDark ? "glass" : "bg-gray-100"}`}
          >
            <button
              onClick={() => setLayers((l) => ({ ...l, rooms: !l.rooms }))}
              title="Toggle rooms"
              className={`p-1.5 rounded-lg transition-all text-xs ${layers.rooms ? "text-brand-400" : isDark ? "text-white/20" : "text-gray-300"}`}
            >
              <Square className="w-3 h-3" />
            </button>
            <button
              onClick={() =>
                setLayers((l) => ({
                  ...l,
                  waypoints: !l.waypoints,
                  connections: !l.waypoints,
                }))
              }
              title="Toggle waypoints"
              className={`p-1.5 rounded-lg transition-all text-xs ${layers.waypoints ? "text-brand-400" : isDark ? "text-white/20" : "text-gray-300"}`}
            >
              <GitMerge className="w-3 h-3" />
            </button>
            <button
              onClick={() =>
                setLayers((l) => ({ ...l, floorPlan: !l.floorPlan }))
              }
              title="Toggle floor plan"
              className={`p-1.5 rounded-lg transition-all text-xs ${layers.floorPlan ? "text-brand-400" : isDark ? "text-white/20" : "text-gray-300"}`}
            >
              <Layers className="w-3 h-3" />
            </button>
          </div>

          {/* Validate */}
          <button
            onClick={handleValidate}
            className="btn-secondary text-xs py-2"
            title="Validate map"
          >
            <AlertTriangle className="w-3.5 h-3.5" /> Validate
          </button>

          {/* Export */}
          <button
            onClick={handleExport}
            className="btn-secondary text-xs py-2"
            title="Export map JSON"
          >
            <Download className="w-3.5 h-3.5" /> Export
          </button>

          {/* Save */}
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-primary text-xs py-2"
          >
            {saving ? (
              <div className="w-3.5 h-3.5 border border-white/60 border-t-white rounded-full animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            Save Map
          </button>
        </div>

        {/* Zoom controls */}
        <div
          className={`flex items-center gap-1 px-1.5 py-1.5 rounded-xl ${isDark ? "glass" : "bg-gray-100"}`}
        >
          <button
            onClick={() => setZoom((z) => Math.min(5, z * 1.2))}
            className={`p-1.5 rounded-lg transition-all ${isDark ? "text-white/40 hover:text-white hover:bg-white/5" : "text-gray-400 hover:text-gray-900"}`}
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <span
            className={`text-xs font-mono w-10 text-center ${isDark ? "text-white/30" : "text-gray-400"}`}
          >
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom((z) => Math.max(0.2, z * 0.8))}
            className={`p-1.5 rounded-lg transition-all ${isDark ? "text-white/40 hover:text-white hover:bg-white/5" : "text-gray-400 hover:text-gray-900"}`}
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={resetView}
            className={`p-1.5 rounded-lg transition-all ${isDark ? "text-white/40 hover:text-white hover:bg-white/5" : "text-gray-400 hover:text-gray-900"}`}
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ─── Main area ───────────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">
        {/* Canvas */}
        <div
          ref={containerRef}
          className="flex-1 relative cursor-crosshair"
          style={{ background: isDark ? "#0f1117" : "#f1f5f9" }}
        >
          <canvas
            ref={canvasRef}
            width={canvasSize.w}
            height={canvasSize.h}
            style={{
              cursor:
                tool === TOOLS.SELECT
                  ? resizing
                    ? "nwse-resize"
                    : isDragging
                      ? "grabbing"
                      : "default"
                  : tool === TOOLS.DELETE_WAYPOINT
                    ? "crosshair"
                    : "crosshair",
            }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onWheel={handleWheel}
          />

          {/* Tool hint */}
          <div
            className={`absolute bottom-4 left-4 px-3 py-2 rounded-xl text-xs ${
              isDark
                ? "glass text-white/40"
                : "bg-white/90 text-gray-500 shadow-sm border border-gray-200"
            }`}
          >
            {toolHint}
          </div>
        </div>

        {/* ─── Room properties panel ─────────────────────────────── */}
        {roomPanel && selectedRoom && (
          <div
            className={`w-72 border-l flex flex-col animate-in overflow-y-auto ${
              isDark
                ? "border-white/5 bg-surface-900/50"
                : "border-gray-200 bg-white"
            }`}
          >
            <div
              className={`flex items-center justify-between px-4 py-3 border-b ${isDark ? "border-white/5" : "border-gray-200"}`}
            >
              <span
                className={`font-display font-semibold text-sm ${isDark ? "text-white" : "text-gray-900"}`}
              >
                Room Properties
              </span>
              <button
                onClick={() => setRoomPanel(false)}
                className={`transition-colors ${isDark ? "text-white/30 hover:text-white" : "text-gray-400 hover:text-gray-900"}`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="p-4 space-y-4 flex-1">
              <div>
                <label className="label">Room Name</label>
                <input
                  className="input"
                  placeholder="e.g. Room 101, Library"
                  value={selectedRoom.name || ""}
                  onChange={(e) => updateRoom("name", e.target.value)}
                />
              </div>

              <div>
                <label className="label">Room Type</label>
                <select
                  className="input"
                  value={selectedRoom.type || "other"}
                  onChange={(e) => {
                    const type = ROOM_TYPES[e.target.value] || ROOM_TYPES.other;
                    updateRoom("type", e.target.value);
                    updateRoom("color", type.bg);
                  }}
                >
                  {Object.entries(ROOM_TYPES).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label">Description (optional)</label>
                <textarea
                  className="input resize-none text-xs"
                  rows={3}
                  placeholder="What's in this room..."
                  value={selectedRoom.description || ""}
                  onChange={(e) => updateRoom("description", e.target.value)}
                />
              </div>

              {/* Color picker */}
              <div>
                <label className="label">Color</label>
                <div className="flex gap-2 flex-wrap">
                  {Object.values(ROOM_TYPES).map(({ bg, color }) => (
                    <button
                      key={color}
                      onClick={() => updateRoom("color", bg)}
                      className="w-7 h-7 rounded-lg border-2 transition-all"
                      style={{
                        background: bg,
                        borderColor:
                          selectedRoom.color === bg ? color : "transparent",
                        transform:
                          selectedRoom.color === bg ? "scale(1.1)" : "scale(1)",
                      }}
                    />
                  ))}
                </div>
              </div>

              {/* Dimensions */}
              <div>
                <label className="label">Size & Position</label>
                <div
                  className={`text-xs font-mono ${isDark ? "text-white/40" : "text-gray-500"}`}
                >
                  {Math.round(selectedRoom.width)} ×{" "}
                  {Math.round(selectedRoom.height)} px &nbsp;&nbsp;at (
                  {Math.round(selectedRoom.x)}, {Math.round(selectedRoom.y)})
                </div>
              </div>
            </div>

            <div
              className={`p-4 border-t space-y-2 ${isDark ? "border-white/5" : "border-gray-200"}`}
            >
              <button
                onClick={() => handleQR(selectedRoom)}
                className="btn-secondary w-full justify-center text-sm"
              >
                <QrCode className="w-3.5 h-3.5" /> Generate QR Code
              </button>
              <button
                onClick={deleteRoom}
                className="btn-danger w-full justify-center text-sm"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete Room
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ─── Validation Modal ────────────────────────────────────── */}
      {showValidation && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-md animate-in">
            <div className="flex items-center justify-between mb-4">
              <h2
                className={`font-display font-semibold ${isDark ? "text-white" : "text-gray-900"}`}
              >
                Map Validation
              </h2>
              <button
                onClick={() => setShowValidation(false)}
                className={
                  isDark
                    ? "text-white/30 hover:text-white"
                    : "text-gray-400 hover:text-gray-900"
                }
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {validationWarnings.length === 0 ? (
              <div className="flex items-center gap-3 py-4">
                <div className="w-10 h-10 bg-green-500/20 rounded-xl flex items-center justify-center">
                  <Check className="w-5 h-5 text-green-400" />
                </div>
                <div>
                  <div
                    className={`font-medium ${isDark ? "text-white" : "text-gray-900"}`}
                  >
                    All checks passed!
                  </div>
                  <div
                    className={`text-sm ${isDark ? "text-white/40" : "text-gray-500"}`}
                  >
                    Your map is ready for navigation.
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {validationWarnings.map((w, i) => (
                  <div
                    key={i}
                    className={`flex items-start gap-3 p-3 rounded-xl ${
                      isDark ? "bg-amber-500/10" : "bg-amber-50"
                    }`}
                  >
                    <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                    <span
                      className={`text-sm ${isDark ? "text-white/80" : "text-gray-700"}`}
                    >
                      {w}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <button
              onClick={() => setShowValidation(false)}
              className="btn-primary w-full justify-center mt-4"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* ─── QR Modal ────────────────────────────────────────────── */}
      {qrModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-sm text-center animate-in">
            <div className="flex items-center justify-between mb-4">
              <h2
                className={`font-display font-semibold ${isDark ? "text-white" : "text-gray-900"}`}
              >
                QR Code
              </h2>
              <button
                onClick={() => setQrModal(null)}
                className={
                  isDark
                    ? "text-white/30 hover:text-white"
                    : "text-gray-400 hover:text-gray-900"
                }
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p
              className={`text-sm mb-4 ${isDark ? "text-white/50" : "text-gray-500"}`}
            >
              {qrModal.room_name}
            </p>
            <img
              src={qrModal.qr}
              alt="QR Code"
              className="w-48 h-48 mx-auto rounded-xl mb-4 bg-white p-2"
            />
            <p
              className={`text-xs mb-4 break-all font-mono ${isDark ? "text-white/30" : "text-gray-400"}`}
            >
              {qrModal.url}
            </p>
            <a
              href={qrModal.qr}
              download={`qr-${qrModal.room_name}.png`}
              className="btn-primary w-full justify-center"
            >
              <Download className="w-4 h-4" /> Download QR Code
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
