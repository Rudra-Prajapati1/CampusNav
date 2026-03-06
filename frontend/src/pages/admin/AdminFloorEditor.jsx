import { useEffect, useRef, useState, useCallback } from "react";
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
  Info,
  Layers,
  Download,
  X,
  Check,
  Navigation,
} from "lucide-react";
import { api } from "../../utils/api.js";
import { supabase, uploadFile } from "../../utils/supabase.js";
import toast from "react-hot-toast";
import { v4 as uuidv4 } from "uuid";

// Room type config
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

const TOOLS = {
  SELECT: "select",
  DRAW_ROOM: "draw_room",
  DRAW_WAYPOINT: "draw_waypoint",
  CONNECT_WAYPOINTS: "connect_waypoints",
};

// Auto-generate navigation waypoints from rooms
function autoGenerateWaypoints(rooms) {
  return rooms.map((room) => ({
    id: uuidv4(),
    x: room.x + room.width / 2,
    y: room.y + room.height / 2,
    room_id: room.id,
    type:
      room.type === "stairs"
        ? "stairs"
        : room.type === "elevator"
          ? "elevator"
          : "room_center",
    floor_id: room.floor_id,
  }));
}

// Auto-connect nearby waypoints (corridor-based heuristic)
function autoConnectWaypoints(waypoints, rooms) {
  const connections = [];
  const corridorRooms = rooms.filter((r) => r.type === "corridor");

  // Connect each room waypoint to nearest corridor or other rooms within range
  waypoints.forEach((wp, i) => {
    waypoints.forEach((wp2, j) => {
      if (i >= j) return;
      const dist = Math.sqrt(
        Math.pow(wp.x - wp2.x, 2) + Math.pow(wp.y - wp2.y, 2),
      );
      // Connect if within 200px (canvas units)
      if (dist < 200) {
        connections.push({
          id: uuidv4(),
          waypoint_a_id: wp.id,
          waypoint_b_id: wp2.id,
        });
      }
    });
  });

  return connections;
}

export default function AdminFloorEditor() {
  const { buildingId, floorId } = useParams();
  const navigate = useNavigate();
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const imgRef = useRef(null);

  const [floor, setFloor] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [waypoints, setWaypoints] = useState([]);
  const [connections, setConnections] = useState([]);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [selectedWaypoint, setSelectedWaypoint] = useState(null);
  const [connectStart, setConnectStart] = useState(null);

  const [tool, setTool] = useState(TOOLS.SELECT);
  const [drawing, setDrawing] = useState(null); // { x, y, w, h }
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState(null);
  const [dragRoom, setDragRoom] = useState(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState(null);
  const [zoom, setZoom] = useState(1);

  const [floorPlanImg, setFloorPlanImg] = useState(null);
  const [showWaypoints, setShowWaypoints] = useState(false);
  const [saving, setSaving] = useState(false);
  const [roomPanel, setRoomPanel] = useState(false);
  const [qrModal, setQrModal] = useState(null);
  const [newRoomType, setNewRoomType] = useState("classroom");
  const [uploading, setUploading] = useState(false);

  // Load floor data
  useEffect(() => {
    api.floors
      .get(floorId)
      .then((data) => {
        setFloor(data);
        setRooms(data.rooms || []);
        setWaypoints(data.waypoints || []);
        setConnections(data.connections || []);
        if (data.floor_plan_url) setFloorPlanImg(data.floor_plan_url);
      })
      .catch(() => toast.error("Failed to load floor"));
  }, [floorId]);

  // Canvas dimensions
  const [canvasSize, setCanvasSize] = useState({ w: 1200, h: 800 });
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

  // Draw canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    // Draw floor plan image
    if (imgRef.current && floorPlanImg) {
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
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 1 / zoom;
    for (let x = 0; x < 3000; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 3000);
      ctx.stroke();
    }
    for (let y = 0; y < 3000; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(3000, y);
      ctx.stroke();
    }

    // Draw waypoint connections
    if (showWaypoints) {
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
    rooms.forEach((room) => {
      const type = ROOM_TYPES[room.type] || ROOM_TYPES.other;
      const isSelected = selectedRoom?.id === room.id;

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
      ctx.fillStyle = "#fff";
      ctx.font = `500 ${fontSize}px "DM Sans", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        room.name || "Unnamed",
        room.x + room.width / 2,
        room.y + room.height / 2,
      );

      // Selection glow
      if (isSelected) {
        ctx.shadowColor = "#6366f1";
        ctx.shadowBlur = 12;
        ctx.strokeStyle = "#6366f1";
        ctx.lineWidth = 2 / zoom;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
    });

    // Draw waypoints
    if (showWaypoints) {
      waypoints.forEach((wp) => {
        const isSelected = selectedWaypoint?.id === wp.id;
        const isConnectStart = connectStart?.id === wp.id;

        ctx.beginPath();
        ctx.arc(wp.x, wp.y, 6 / zoom, 0, Math.PI * 2);
        ctx.fillStyle = isConnectStart
          ? "#f59e0b"
          : isSelected
            ? "#6366f1"
            : "#8b5cf6";
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5 / zoom;
        ctx.stroke();
      });
    }

    // Draw in-progress room
    if (drawing && tool === TOOLS.DRAW_ROOM) {
      const type = ROOM_TYPES[newRoomType] || ROOM_TYPES.other;
      ctx.fillStyle = type.bg;
      ctx.strokeStyle = type.color;
      ctx.lineWidth = 2 / zoom;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.roundRect(
        Math.min(drawing.startX, drawing.currentX),
        Math.min(drawing.startY, drawing.currentY),
        Math.abs(drawing.currentX - drawing.startX),
        Math.abs(drawing.currentY - drawing.startY),
        6 / zoom,
      );
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
  }, [
    rooms,
    waypoints,
    connections,
    drawing,
    selectedRoom,
    selectedWaypoint,
    connectStart,
    pan,
    zoom,
    floorPlanImg,
    showWaypoints,
    tool,
    newRoomType,
    canvasSize,
  ]);

  // Load floor plan image
  useEffect(() => {
    if (!floorPlanImg) return;
    const img = new Image();
    img.src = floorPlanImg;
    img.onload = () => {
      imgRef.current = img;
    };
  }, [floorPlanImg]);

  // Canvas coordinate conversion
  const toCanvas = (clientX, clientY) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: (clientX - rect.left - pan.x) / zoom,
      y: (clientY - rect.top - pan.y) / zoom,
    };
  };

  const getRoomAt = (x, y) =>
    [...rooms]
      .reverse()
      .find(
        (r) =>
          x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height,
      );

  const getWaypointAt = (x, y) =>
    waypoints.find(
      (w) => Math.sqrt((w.x - x) ** 2 + (w.y - y) ** 2) < 10 / zoom,
    );

  // Mouse handlers
  const handleMouseDown = (e) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      return;
    }

    const { x, y } = toCanvas(e.clientX, e.clientY);

    if (tool === TOOLS.SELECT) {
      const room = getRoomAt(x, y);
      if (room) {
        setSelectedRoom(room);
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
      } else {
        setSelectedRoom(null);
        setRoomPanel(false);
        // Pan with left click on empty space
        setIsPanning(true);
        setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      }
    }

    if (tool === TOOLS.DRAW_ROOM) {
      setDrawing({ startX: x, startY: y, currentX: x, currentY: y });
    }

    if (tool === TOOLS.DRAW_WAYPOINT) {
      const wp = {
        id: uuidv4(),
        x,
        y,
        type: "manual",
        room_id: null,
        floor_id: floorId,
      };
      setWaypoints((prev) => [...prev, wp]);
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
          }
          setConnectStart(null);
        }
      }
    }
  };

  const handleMouseMove = (e) => {
    if (isPanning && panStart) {
      setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
      return;
    }

    if (dragRoom && dragStart) {
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        setIsDragging(true);
        setRooms((prev) =>
          prev.map((r) =>
            r.id === dragRoom.id
              ? {
                  ...r,
                  x: dragStart.origX + dx / zoom,
                  y: dragStart.origY + dy / zoom,
                }
              : r,
          ),
        );
      }
    }

    if (drawing && tool === TOOLS.DRAW_ROOM) {
      const { x, y } = toCanvas(e.clientX, e.clientY);
      setDrawing((d) => ({ ...d, currentX: x, currentY: y }));
    }
  };

  const handleMouseUp = (e) => {
    setIsPanning(false);
    setPanStart(null);

    if (dragRoom) {
      if (isDragging) {
        setSelectedRoom(rooms.find((r) => r.id === dragRoom.id));
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
      }
      setDrawing(null);
    }
  };

  const handleWheel = (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom((z) => Math.min(5, Math.max(0.2, z * delta)));
  };

  // Update selected room inline
  const updateRoom = (field, value) => {
    setRooms((prev) =>
      prev.map((r) =>
        r.id === selectedRoom.id ? { ...r, [field]: value } : r,
      ),
    );
    setSelectedRoom((r) => ({ ...r, [field]: value }));
  };

  const deleteRoom = () => {
    setRooms((prev) => prev.filter((r) => r.id !== selectedRoom.id));
    setWaypoints((prev) => prev.filter((w) => w.room_id !== selectedRoom.id));
    setSelectedRoom(null);
    setRoomPanel(false);
  };

  // Auto-generate waypoints from all rooms
  const handleAutoWaypoints = () => {
    const autoWps = autoGenerateWaypoints(
      rooms.map((r) => ({ ...r, floor_id: floorId })),
    );
    const autoConns = autoConnectWaypoints(autoWps, rooms);
    setWaypoints(autoWps);
    setConnections(autoConns);
    setShowWaypoints(true);
    toast.success(
      `Generated ${autoWps.length} waypoints and ${autoConns.length} connections`,
    );
  };

  // Upload floor plan image
  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    try {
      const path = `floor-plans/${floorId}/${file.name}`;
      const url = await uploadFile("campusnav-assets", path, file);
      setFloorPlanImg(url);

      const img = new Image();
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
  };

  // Save everything
  const handleSave = async () => {
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
      toast.success("Map saved successfully!");
    } catch (err) {
      toast.error("Save failed: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  // QR Code for a room
  const handleQR = async (room) => {
    try {
      const data = await api.qr.room(room.id);
      setQrModal(data);
    } catch (err) {
      toast.error("QR generation failed: " + err.message);
    }
  };

  const resetView = () => {
    setPan({ x: 0, y: 0 });
    setZoom(1);
  };

  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5 bg-surface-900/50 flex-shrink-0">
        <button
          onClick={() => navigate("/admin/buildings")}
          className="p-2 text-white/40 hover:text-white hover:bg-white/5 rounded-lg transition-all"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="font-display font-semibold text-sm text-white">
            {floor?.name || "Floor Editor"}
          </h1>
          <p className="text-white/30 text-xs">
            {rooms.length} rooms · {waypoints.length} waypoints
          </p>
        </div>

        {/* Tools */}
        <div className="flex items-center gap-1 glass px-2 py-1.5 rounded-xl">
          {[
            { id: TOOLS.SELECT, icon: MousePointer, label: "Select / Move" },
            { id: TOOLS.DRAW_ROOM, icon: Square, label: "Draw Room" },
            { id: TOOLS.DRAW_WAYPOINT, icon: GitMerge, label: "Add Waypoint" },
            {
              id: TOOLS.CONNECT_WAYPOINTS,
              icon: Minus,
              label: "Connect Waypoints",
            },
          ].map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => setTool(id)}
              title={label}
              className={`p-2 rounded-lg transition-all ${tool === id ? "bg-brand-600 text-white" : "text-white/40 hover:text-white hover:bg-white/5"}`}
            >
              <Icon className="w-3.5 h-3.5" />
            </button>
          ))}
        </div>

        {/* Room type selector (only when drawing) */}
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

        <div className="flex items-center gap-1.5 ml-2">
          {/* Upload floor plan */}
          <label className="btn-secondary text-xs py-2 cursor-pointer">
            {uploading ? (
              <div className="w-3.5 h-3.5 border border-white/40 border-t-white rounded-full animate-spin" />
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
            <Navigation className="w-3.5 h-3.5" />
            Auto Nav
          </button>

          {/* Toggle waypoints */}
          <button
            onClick={() => setShowWaypoints((v) => !v)}
            className={`btn-secondary text-xs py-2 ${showWaypoints ? "border-brand-500/40 text-brand-400" : ""}`}
          >
            {showWaypoints ? (
              <Eye className="w-3.5 h-3.5" />
            ) : (
              <EyeOff className="w-3.5 h-3.5" />
            )}
            Waypoints
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
        <div className="flex items-center gap-1 glass px-1.5 py-1.5 rounded-xl">
          <button
            onClick={() => setZoom((z) => Math.min(5, z * 1.2))}
            className="p-1.5 text-white/40 hover:text-white hover:bg-white/5 rounded-lg transition-all"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <span className="text-white/30 text-xs font-mono w-10 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom((z) => Math.max(0.2, z * 0.8))}
            className="p-1.5 text-white/40 hover:text-white hover:bg-white/5 rounded-lg transition-all"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={resetView}
            className="p-1.5 text-white/40 hover:text-white hover:bg-white/5 rounded-lg transition-all"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Canvas */}
        <div
          ref={containerRef}
          className="flex-1 map-container relative cursor-crosshair"
        >
          <canvas
            ref={canvasRef}
            width={canvasSize.w}
            height={canvasSize.h}
            style={{
              cursor:
                tool === TOOLS.SELECT
                  ? isDragging
                    ? "grabbing"
                    : "default"
                  : "crosshair",
            }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onWheel={handleWheel}
          />

          {/* Tool hint */}
          <div className="absolute bottom-4 left-4 glass px-3 py-2 rounded-xl text-xs text-white/40">
            {tool === TOOLS.SELECT &&
              "Click to select • Drag to move • Scroll to zoom • Alt+drag to pan"}
            {tool === TOOLS.DRAW_ROOM && "Click and drag to draw a room"}
            {tool === TOOLS.DRAW_WAYPOINT &&
              "Click to place a navigation waypoint"}
            {tool === TOOLS.CONNECT_WAYPOINTS &&
              (connectStart
                ? "Click another waypoint to connect"
                : "Click a waypoint to start connecting")}
          </div>
        </div>

        {/* Room properties panel */}
        {roomPanel && selectedRoom && (
          <div className="w-72 border-l border-white/5 bg-surface-900/50 flex flex-col animate-in overflow-y-auto">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
              <span className="font-display font-semibold text-sm text-white">
                Room Properties
              </span>
              <button
                onClick={() => setRoomPanel(false)}
                className="text-white/30 hover:text-white transition-colors"
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

              {/* Room color picker */}
              <div>
                <label className="label">Color</label>
                <div className="flex gap-2 flex-wrap">
                  {Object.values(ROOM_TYPES).map(({ bg, color }) => (
                    <button
                      key={color}
                      onClick={() => updateRoom("color", bg)}
                      className={`w-7 h-7 rounded-lg border-2 transition-all ${selectedRoom.color === bg ? "border-white scale-110" : "border-transparent"}`}
                      style={{
                        background: bg,
                        borderColor:
                          selectedRoom.color === bg ? color : "transparent",
                      }}
                    />
                  ))}
                </div>
              </div>

              {/* Dimensions (read-only) */}
              <div>
                <label className="label">Size</label>
                <div className="text-xs text-white/40 font-mono">
                  {Math.round(selectedRoom.width)} ×{" "}
                  {Math.round(selectedRoom.height)} px &nbsp;&nbsp;at (
                  {Math.round(selectedRoom.x)}, {Math.round(selectedRoom.y)})
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-white/5 space-y-2">
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

      {/* QR Modal */}
      {qrModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-sm text-center animate-in">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display font-semibold text-white">QR Code</h2>
              <button
                onClick={() => setQrModal(null)}
                className="text-white/30 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-white/50 text-sm mb-4">{qrModal.room_name}</p>
            <img
              src={qrModal.qr}
              alt="QR Code"
              className="w-48 h-48 mx-auto rounded-xl mb-4 bg-white p-2"
            />
            <p className="text-white/30 text-xs mb-4 break-all font-mono">
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
