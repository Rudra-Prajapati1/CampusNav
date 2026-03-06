import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  Search,
  Navigation,
  MapPin,
  X,
  ChevronDown,
  Layers,
  ArrowRight,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  Clock,
  Footprints,
  Crosshair,
} from "lucide-react";
import { api } from "../../utils/api.js";
import { useTheme } from "../../context/themeContext.jsx";

const ROOM_TYPES = {
  classroom: { color: "#6366f1", bg: "rgba(99,102,241,0.18)" },
  lab: { color: "#8b5cf6", bg: "rgba(139,92,246,0.18)" },
  office: { color: "#06b6d4", bg: "rgba(6,182,212,0.18)" },
  toilet: { color: "#64748b", bg: "rgba(100,116,139,0.18)" },
  stairs: { color: "#f59e0b", bg: "rgba(245,158,11,0.18)" },
  elevator: { color: "#10b981", bg: "rgba(16,185,129,0.18)" },
  entrance: { color: "#ef4444", bg: "rgba(239,68,68,0.18)" },
  canteen: { color: "#f97316", bg: "rgba(249,115,22,0.18)" },
  corridor: { color: "#94a3b8", bg: "rgba(148,163,184,0.1)" },
  other: { color: "#a3a3a3", bg: "rgba(163,163,163,0.12)" },
};

// Step icon mapping
const STEP_ICONS = {
  start: "🚀",
  arrive: "🎯",
  turn_left: "⬅️",
  turn_right: "➡️",
  turn_slight_left: "↖️",
  turn_slight_right: "↗️",
  walk: "⬆️",
  stairs_up: "🪜",
  stairs_down: "🪜",
  elevator_up: "🛗",
  elevator_down: "🛗",
};

function getInstructionIcon(instruction) {
  if (!instruction?.type) return "📍";
  return STEP_ICONS[instruction.type] || "📍";
}

export default function NavigatePage() {
  const { buildingId } = useParams();
  const [searchParams] = useSearchParams();
  const fromRoomId = searchParams.get("from");
  const { isDark, toggleTheme } = useTheme();

  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const animFrameRef = useRef(null);
  const imgRef = useRef(null);

  const [building, setBuilding] = useState(null);
  const [floors, setFloors] = useState([]);
  const [currentFloor, setCurrentFloor] = useState(null);
  const [floorData, setFloorData] = useState(null);

  const [fromRoom, setFromRoom] = useState(null);
  const [toRoom, setToRoom] = useState(null);
  const [route, setRoute] = useState(null);
  const [routeLoading, setRouteLoading] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [selectingFor, setSelectingFor] = useState(null);

  const [pan, setPan] = useState({ x: 40, y: 40 });
  const [zoom, setZoom] = useState(0.9);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState(null);
  const [canvasSize, setCanvasSize] = useState({ w: 800, h: 600 });

  const [pathAnimOffset, setPathAnimOffset] = useState(0);
  const [showSteps, setShowSteps] = useState(false);
  const [floorPlanImg, setFloorPlanImg] = useState(null);
  const [floorBanner, setFloorBanner] = useState(null);

  // ─── Load building + floors ────────────────────────────────────
  useEffect(() => {
    api.buildings
      .get(buildingId)
      .then((b) => {
        setBuilding(b);
        const sorted = (b.floors || []).sort((a, b) => a.level - b.level);
        setFloors(sorted);
        if (sorted.length > 0) setCurrentFloor(sorted[0]);
      })
      .catch(console.error);
  }, [buildingId]);

  // ─── Load floor data ──────────────────────────────────────────
  useEffect(() => {
    if (!currentFloor) return;
    api.floors
      .get(currentFloor.id)
      .then((data) => {
        setFloorData(data);
        if (data.floor_plan_url) {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.src = data.floor_plan_url;
          img.onload = () => {
            imgRef.current = img;
          };
          setFloorPlanImg(data.floor_plan_url);
        } else {
          imgRef.current = null;
          setFloorPlanImg(null);
        }
      })
      .catch(console.error);
  }, [currentFloor]);

  // ─── Set from-room from QR parameter ──────────────────────────
  useEffect(() => {
    if (fromRoomId && !fromRoom) {
      api.rooms
        .get(fromRoomId)
        .then((room) => {
          setFromRoom(room);
          if (room.floor_id && floors.length > 0) {
            const f = floors.find((fl) => fl.id === room.floor_id);
            if (f) setCurrentFloor(f);
          }
        })
        .catch(console.error);
    }
  }, [fromRoomId, floors, fromRoom]);

  // ─── Canvas size ──────────────────────────────────────────────
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

  // ─── Path animation ──────────────────────────────────────────
  useEffect(() => {
    if (!route) return;
    const animate = () => {
      setPathAnimOffset((o) => (o + 0.5) % 20);
      animFrameRef.current = requestAnimationFrame(animate);
    };
    animFrameRef.current = requestAnimationFrame(animate);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [route]);

  // ─── Path on current floor (memoized) ─────────────────────────
  const pathOnCurrentFloor = useMemo(() => {
    if (!route?.path || !currentFloor) return [];
    return route.path.filter((wp) => wp.floor_id === currentFloor.id);
  }, [route, currentFloor]);

  const pathOnOtherFloors = useMemo(() => {
    if (!route?.path || !currentFloor) return [];
    return route.path.filter((wp) => wp.floor_id !== currentFloor.id);
  }, [route, currentFloor]);

  // ─── Canvas render ────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !floorData) return;
    const ctx = canvas.getContext("2d");

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    // Anti-aliasing
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    // Floor plan background
    if (imgRef.current) {
      ctx.globalAlpha = 0.3;
      ctx.drawImage(
        imgRef.current,
        0,
        0,
        floorData.floor_plan_width || 1200,
        floorData.floor_plan_height || 800,
      );
      ctx.globalAlpha = 1;
    }

    const { rooms = [] } = floorData;

    // Draw rooms
    rooms.forEach((room) => {
      const type = ROOM_TYPES[room.type] || ROOM_TYPES.other;
      const isFrom = fromRoom?.id === room.id;
      const isTo = toRoom?.id === room.id;
      const onRoute = route?.path?.some((wp) => wp.room_id === room.id);

      ctx.fillStyle = isFrom
        ? "rgba(34,197,94,0.25)"
        : isTo
          ? "rgba(239,68,68,0.25)"
          : onRoute
            ? "rgba(99,102,241,0.25)"
            : room.color || type.bg;
      ctx.beginPath();
      ctx.roundRect(room.x, room.y, room.width, room.height, 8 / zoom);
      ctx.fill();

      ctx.strokeStyle = isFrom
        ? "#22c55e"
        : isTo
          ? "#ef4444"
          : onRoute
            ? "#6366f1"
            : type.color + "60";
      ctx.lineWidth = (isFrom || isTo || onRoute ? 2.5 : 1.5) / zoom;
      ctx.stroke();

      // Label
      const fontSize = Math.max(9, Math.min(13, room.width / 8)) / zoom;
      ctx.fillStyle =
        isFrom || isTo
          ? "#fff"
          : isDark
            ? "rgba(255,255,255,0.85)"
            : "rgba(30,41,59,0.85)";
      ctx.font = `${isFrom || isTo ? "600" : "500"} ${fontSize}px "DM Sans", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        room.name,
        room.x + room.width / 2,
        room.y + room.height / 2,
      );

      // From/To marker
      if (isFrom || isTo) {
        const cx = room.x + room.width / 2;
        const cy = room.y - 14 / zoom;
        ctx.beginPath();
        ctx.arc(cx, cy, 8 / zoom, 0, Math.PI * 2);
        ctx.fillStyle = isFrom ? "#22c55e" : "#ef4444";
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = `bold ${10 / zoom}px sans-serif`;
        ctx.fillText(isFrom ? "A" : "B", cx, cy);
      }
    });

    // Draw animated path on current floor (bright)
    if (pathOnCurrentFloor.length > 1) {
      ctx.beginPath();
      ctx.moveTo(pathOnCurrentFloor[0].x, pathOnCurrentFloor[0].y);
      pathOnCurrentFloor.slice(1).forEach((wp) => ctx.lineTo(wp.x, wp.y));

      // Glow effect
      ctx.shadowColor = "#6366f1";
      ctx.shadowBlur = 16;
      ctx.strokeStyle = "#6366f1";
      ctx.lineWidth = 4 / zoom;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.setLineDash([12, 8]);
      ctx.lineDashOffset = -pathAnimOffset;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;

      // Path dots
      pathOnCurrentFloor.forEach((wp) => {
        ctx.beginPath();
        ctx.arc(wp.x, wp.y, 5 / zoom, 0, Math.PI * 2);
        ctx.fillStyle = "#818cf8";
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5 / zoom;
        ctx.stroke();
      });
    }

    ctx.restore();
  }, [
    floorData,
    fromRoom,
    toRoom,
    route,
    pan,
    zoom,
    canvasSize,
    pathAnimOffset,
    currentFloor,
    pathOnCurrentFloor,
    isDark,
  ]);

  // ─── Search rooms ─────────────────────────────────────────────
  useEffect(() => {
    if (!searchQuery.trim() || !buildingId) {
      setSearchResults([]);
      return;
    }
    const t = setTimeout(async () => {
      const results = await api.rooms
        .search(buildingId, searchQuery)
        .catch(() => []);
      setSearchResults(results);
    }, 300);
    return () => clearTimeout(t);
  }, [searchQuery, buildingId]);

  const selectRoom = useCallback(
    (room) => {
      if (selectingFor === "from") setFromRoom(room);
      else setToRoom(room);
      setSearchQuery("");
      setSearchResults([]);
      setSelectingFor(null);
    },
    [selectingFor],
  );

  // ─── Get route ────────────────────────────────────────────────
  const getRoute = useCallback(async () => {
    if (!fromRoom || !toRoom) return;
    setRouteLoading(true);
    try {
      const result = await api.navigation.route(
        fromRoom.id,
        toRoom.id,
        buildingId,
      );
      setRoute(result);

      // Switch to first floor of route
      if (result.floors_involved?.length > 0) {
        const f = floors.find((fl) => fl.id === result.floors_involved[0]);
        if (f) setCurrentFloor(f);
      }
      setShowSteps(true);

      // Smooth zoom to first waypoint
      if (result.path?.length > 0) {
        const firstWp = result.path[0];
        setTimeout(() => {
          setPan({
            x: canvasSize.w / 2 - firstWp.x * zoom,
            y: canvasSize.h / 2 - firstWp.y * zoom,
          });
        }, 100);
      }
    } catch (err) {
      alert(err.message);
    } finally {
      setRouteLoading(false);
    }
  }, [fromRoom, toRoom, buildingId, floors, canvasSize, zoom]);

  const clearRoute = useCallback(() => {
    setRoute(null);
    setToRoom(null);
    setShowSteps(false);
    setFloorBanner(null);
  }, []);

  // ─── Center on route ──────────────────────────────────────────
  const centerOnRoute = useCallback(() => {
    if (!pathOnCurrentFloor.length) return;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    pathOnCurrentFloor.forEach((wp) => {
      minX = Math.min(minX, wp.x);
      minY = Math.min(minY, wp.y);
      maxX = Math.max(maxX, wp.x);
      maxY = Math.max(maxY, wp.y);
    });
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const pathWidth = maxX - minX + 100;
    const pathHeight = maxY - minY + 100;
    const scaleX = canvasSize.w / pathWidth;
    const scaleY = canvasSize.h / pathHeight;
    const newZoom = Math.min(scaleX, scaleY, 2) * 0.8;

    setZoom(newZoom);
    setPan({
      x: canvasSize.w / 2 - centerX * newZoom,
      y: canvasSize.h / 2 - centerY * newZoom,
    });
  }, [pathOnCurrentFloor, canvasSize]);

  // ─── Floor change detection ───────────────────────────────────
  const handleFloorSwitch = useCallback(
    (floorId) => {
      const f = floors.find((fl) => fl.id === floorId);
      if (f) {
        setCurrentFloor(f);
        // Show floor change banner
        setFloorBanner(f.name);
        setTimeout(() => setFloorBanner(null), 3000);
      }
    },
    [floors],
  );

  // ─── Mouse handlers ───────────────────────────────────────────
  const handleMouseDown = useCallback(
    (e) => {
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    },
    [pan],
  );

  const handleMouseMove = useCallback(
    (e) => {
      if (isPanning && panStart) {
        setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
      }
    },
    [isPanning, panStart],
  );

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
    setPanStart(null);
  }, []);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    setZoom((z) => Math.min(4, Math.max(0.3, z * (e.deltaY > 0 ? 0.9 : 1.1))));
  }, []);

  // ─── Touch support (pinch zoom + drag) ────────────────────────
  const touchRef = useRef({ lastDist: 0, lastPan: null });

  const handleTouchStart = useCallback(
    (e) => {
      if (e.touches.length === 1) {
        const t = e.touches[0];
        setIsPanning(true);
        setPanStart({ x: t.clientX - pan.x, y: t.clientY - pan.y });
      } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        touchRef.current.lastDist = Math.sqrt(dx * dx + dy * dy);
      }
    },
    [pan],
  );

  const handleTouchMove = useCallback(
    (e) => {
      e.preventDefault();
      if (e.touches.length === 1 && isPanning && panStart) {
        const t = e.touches[0];
        setPan({ x: t.clientX - panStart.x, y: t.clientY - panStart.y });
      } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (touchRef.current.lastDist > 0) {
          const scale = dist / touchRef.current.lastDist;
          setZoom((z) => Math.min(4, Math.max(0.3, z * scale)));
        }
        touchRef.current.lastDist = dist;
      }
    },
    [isPanning, panStart],
  );

  const handleTouchEnd = useCallback(() => {
    setIsPanning(false);
    setPanStart(null);
    touchRef.current.lastDist = 0;
  }, []);

  // ─── Instruction list with floor badges ────────────────────────
  const instructionsList = useMemo(() => {
    if (!route) return [];
    // Prefer detailed instructions, fallback to steps
    if (route.instructions?.length > 0) return route.instructions;
    return (route.steps || []).map((text, i) => ({
      text: typeof text === "string" ? text : text,
      type: "step",
      icon: "📍",
      index: i,
    }));
  }, [route]);

  return (
    <div
      className={`min-h-screen flex flex-col ${isDark ? "bg-surface-950" : "bg-gray-50"}`}
    >
      {/* ─── Header ──────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-4 pt-safe-top">
        {/* Building name */}
        <div className="flex items-center gap-2.5 py-3">
          <div className="w-7 h-7 bg-gradient-to-br from-brand-500 to-violet-500 rounded-lg flex items-center justify-center flex-shrink-0">
            <Navigation className="w-3.5 h-3.5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h1
              className={`font-display font-bold text-sm truncate ${isDark ? "text-white" : "text-gray-900"}`}
            >
              {building?.name || "Loading..."}
            </h1>
          </div>

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className={`p-2 rounded-xl transition-all ${isDark ? "glass text-white/50 hover:text-white" : "bg-gray-100 text-gray-500 hover:text-gray-900"}`}
          >
            {isDark ? "☀️" : "🌙"}
          </button>

          {/* Floor selector */}
          {floors.length > 1 && (
            <div className="relative">
              <select
                className={`text-xs px-3 py-2 rounded-xl appearance-none pr-7 cursor-pointer focus:outline-none border ${
                  isDark
                    ? "glass text-white border-white/10 focus:border-brand-500/50"
                    : "bg-white text-gray-900 border-gray-200"
                }`}
                value={currentFloor?.id || ""}
                onChange={(e) => handleFloorSwitch(e.target.value)}
              >
                {floors.map((f) => (
                  <option
                    key={f.id}
                    value={f.id}
                    style={{ background: isDark ? "#1e293b" : "#fff" }}
                  >
                    {f.name}
                    {route?.floors_involved?.includes(f.id) ? " 📍" : ""}
                  </option>
                ))}
              </select>
              <Layers
                className={`w-3 h-3 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none ${isDark ? "text-white/30" : "text-gray-400"}`}
              />
            </div>
          )}
        </div>

        {/* Location pickers */}
        <div className="space-y-2 pb-3">
          {/* From */}
          <div
            className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl cursor-pointer transition-all border ${
              selectingFor === "from"
                ? "border-green-500/40"
                : isDark
                  ? "glass hover:border-white/20"
                  : "bg-white border-gray-200 hover:border-gray-300"
            }`}
            onClick={() => {
              setSelectingFor("from");
              setSearchQuery("");
            }}
          >
            <div className="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center flex-shrink-0">
              <span className="text-white text-[9px] font-bold">A</span>
            </div>
            <span
              className={`text-sm flex-1 ${fromRoom ? (isDark ? "text-white" : "text-gray-900") : isDark ? "text-white/30" : "text-gray-400"}`}
            >
              {fromRoom?.name || "Your location / Starting point"}
            </span>
            {fromRoom && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setFromRoom(null);
                  clearRoute();
                }}
                className={
                  isDark
                    ? "text-white/30 hover:text-white"
                    : "text-gray-400 hover:text-gray-900"
                }
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* To */}
          <div
            className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl cursor-pointer transition-all border ${
              selectingFor === "to"
                ? "border-red-500/40"
                : isDark
                  ? "glass hover:border-white/20"
                  : "bg-white border-gray-200 hover:border-gray-300"
            }`}
            onClick={() => {
              setSelectingFor("to");
              setSearchQuery("");
            }}
          >
            <div className="w-5 h-5 bg-red-500 rounded-full flex items-center justify-center flex-shrink-0">
              <span className="text-white text-[9px] font-bold">B</span>
            </div>
            <span
              className={`text-sm flex-1 ${toRoom ? (isDark ? "text-white" : "text-gray-900") : isDark ? "text-white/30" : "text-gray-400"}`}
            >
              {toRoom?.name || "Where do you want to go?"}
            </span>
            {toRoom && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  clearRoute();
                }}
                className={
                  isDark
                    ? "text-white/30 hover:text-white"
                    : "text-gray-400 hover:text-gray-900"
                }
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Search input */}
          {selectingFor && (
            <div className="relative animate-in">
              <Search
                className={`w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 ${isDark ? "text-white/30" : "text-gray-400"}`}
              />
              <input
                className="input pl-9"
                placeholder="Search rooms, labs, offices..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
              />
              {searchResults.length > 0 && (
                <div
                  className={`absolute top-full left-0 right-0 mt-2 rounded-xl overflow-hidden z-50 max-h-48 overflow-y-auto shadow-xl ${
                    isDark ? "glass" : "bg-white border border-gray-200"
                  }`}
                >
                  {searchResults.map((room) => (
                    <button
                      key={room.id}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left ${
                        isDark ? "hover:bg-white/5" : "hover:bg-gray-50"
                      }`}
                      onClick={() => selectRoom(room)}
                    >
                      <MapPin className="w-3.5 h-3.5 text-brand-400 flex-shrink-0" />
                      <div>
                        <div
                          className={`text-sm ${isDark ? "text-white" : "text-gray-900"}`}
                        >
                          {room.name}
                        </div>
                        <div
                          className={`text-xs capitalize ${isDark ? "text-white/30" : "text-gray-500"}`}
                        >
                          {room.type}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              <button
                onClick={() => setSelectingFor(null)}
                className={`absolute right-3 top-1/2 -translate-y-1/2 ${isDark ? "text-white/30 hover:text-white" : "text-gray-400 hover:text-gray-900"}`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Navigate button */}
          {fromRoom && toRoom && !route && (
            <button
              onClick={getRoute}
              disabled={routeLoading}
              className="btn-primary w-full justify-center animate-in"
            >
              {routeLoading ? (
                <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              ) : (
                <Navigation className="w-4 h-4" />
              )}
              {routeLoading ? "Finding route..." : "Get Directions"}
            </button>
          )}

          {/* ETA display */}
          {route && (
            <div
              className={`flex items-center gap-4 px-3 py-2 rounded-xl ${isDark ? "glass" : "bg-white border border-gray-200"}`}
            >
              <div className="flex items-center gap-1.5">
                <Footprints className="w-3.5 h-3.5 text-brand-400" />
                <span
                  className={`text-sm font-medium ${isDark ? "text-white" : "text-gray-900"}`}
                >
                  {route.distance}m
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-brand-400" />
                <span
                  className={`text-sm font-medium ${isDark ? "text-white" : "text-gray-900"}`}
                >
                  ~
                  {route.estimated_time ||
                    Math.max(1, Math.round(route.distance / 84))}{" "}
                  min
                </span>
              </div>
              {route.floor_changes > 0 && (
                <div className="flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-amber-400" />
                  <span
                    className={`text-sm ${isDark ? "text-white/60" : "text-gray-600"}`}
                  >
                    {route.floor_changes} floor change
                    {route.floor_changes > 1 ? "s" : ""}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ─── Floor change banner ─────────────────────────────────── */}
      {floorBanner && (
        <div className="flex-shrink-0 mx-4 mb-2 bg-brand-600 text-white text-sm font-medium px-4 py-2.5 rounded-xl text-center animate-in">
          📍 Now viewing: {floorBanner}
        </div>
      )}

      {/* ─── Map canvas ──────────────────────────────────────────── */}
      <div
        ref={containerRef}
        className="flex-1 relative"
        style={{ minHeight: "300px" }}
      >
        <canvas
          ref={canvasRef}
          width={canvasSize.w}
          height={canvasSize.h}
          style={{
            cursor: isPanning ? "grabbing" : "grab",
            touchAction: "none",
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        />

        {/* Zoom + utility buttons */}
        <div className="absolute top-3 right-3 flex flex-col gap-1">
          <button
            onClick={() => setZoom((z) => Math.min(4, z * 1.2))}
            className={`w-8 h-8 flex items-center justify-center rounded-xl transition-all ${isDark ? "glass text-white/50 hover:text-white" : "bg-white text-gray-500 hover:text-gray-900 shadow-sm border border-gray-200"}`}
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setZoom((z) => Math.max(0.3, z * 0.8))}
            className={`w-8 h-8 flex items-center justify-center rounded-xl transition-all ${isDark ? "glass text-white/50 hover:text-white" : "bg-white text-gray-500 hover:text-gray-900 shadow-sm border border-gray-200"}`}
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => {
              setPan({ x: 40, y: 40 });
              setZoom(0.9);
            }}
            title="Reset View"
            className={`w-8 h-8 flex items-center justify-center rounded-xl transition-all ${isDark ? "glass text-white/50 hover:text-white" : "bg-white text-gray-500 hover:text-gray-900 shadow-sm border border-gray-200"}`}
          >
            <RotateCcw className="w-3 h-3" />
          </button>
          {route && pathOnCurrentFloor.length > 0 && (
            <button
              onClick={centerOnRoute}
              title="Center on route"
              className={`w-8 h-8 flex items-center justify-center rounded-xl transition-all ${isDark ? "glass text-white/50 hover:text-white" : "bg-white text-gray-500 hover:text-gray-900 shadow-sm border border-gray-200"}`}
            >
              <Crosshair className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Loading overlay */}
        {!floorData && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p
                className={`text-sm ${isDark ? "text-white/30" : "text-gray-400"}`}
              >
                Loading map...
              </p>
            </div>
          </div>
        )}

        {/* Floor buttons during route (quick switch to involved floors) */}
        {route && route.floors_involved?.length > 1 && (
          <div className="absolute bottom-3 left-3 flex gap-1">
            {route.floors_involved.map((fId) => {
              const f = floors.find((fl) => fl.id === fId);
              if (!f) return null;
              const isActive = currentFloor?.id === fId;
              return (
                <button
                  key={fId}
                  onClick={() => handleFloorSwitch(fId)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    isActive
                      ? "bg-brand-600 text-white"
                      : isDark
                        ? "glass text-white/50 hover:text-white"
                        : "bg-white/90 text-gray-500 hover:text-gray-900 shadow-sm border border-gray-200"
                  }`}
                >
                  {f.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── Steps panel ─────────────────────────────────────────── */}
      {route && showSteps && (
        <div
          className={`flex-shrink-0 border-t max-h-64 overflow-y-auto animate-in ${
            isDark ? "glass border-white/5" : "bg-white border-gray-200"
          }`}
        >
          <div
            className={`flex items-center justify-between px-4 py-3 border-b sticky top-0 ${
              isDark ? "glass border-white/5" : "bg-white border-gray-200"
            }`}
          >
            <div>
              <span
                className={`font-display font-semibold text-sm ${isDark ? "text-white" : "text-gray-900"}`}
              >
                Directions
              </span>
              <span
                className={`text-xs ml-2 ${isDark ? "text-white/30" : "text-gray-500"}`}
              >
                ~{route.distance}m ·{" "}
                {route.estimated_time ||
                  Math.max(1, Math.round(route.distance / 84))}{" "}
                min
              </span>
            </div>
            <button
              onClick={() => setShowSteps(false)}
              className={
                isDark
                  ? "text-white/30 hover:text-white"
                  : "text-gray-400 hover:text-gray-900"
              }
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>
          <div className="p-4 space-y-2">
            {instructionsList.map((instr, i) => {
              const icon = instr.icon || getInstructionIcon(instr);
              const text =
                typeof instr === "string" ? instr : instr.text || instr;

              // Detect floor change instructions
              const isFloorChange =
                instr.type?.includes("stairs") ||
                instr.type?.includes("elevator");

              return (
                <div
                  key={i}
                  className={`flex items-start gap-3 p-2 rounded-lg transition-colors cursor-pointer ${
                    isFloorChange
                      ? isDark
                        ? "bg-amber-500/10 hover:bg-amber-500/15"
                        : "bg-amber-50 hover:bg-amber-100"
                      : isDark
                        ? "hover:bg-white/3"
                        : "hover:bg-gray-50"
                  }`}
                  onClick={() => {
                    if (instr.floor_id) handleFloorSwitch(instr.floor_id);
                  }}
                >
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 text-sm ${
                      isFloorChange
                        ? "bg-amber-500/20"
                        : isDark
                          ? "bg-brand-600/20"
                          : "bg-brand-50"
                    }`}
                  >
                    {icon}
                  </div>
                  <div className="flex-1">
                    <span
                      className={`text-sm ${isDark ? "text-white/80" : "text-gray-700"}`}
                    >
                      {text}
                    </span>
                    {instr.floor_name && isFloorChange && (
                      <div
                        className={`text-xs mt-0.5 ${isDark ? "text-amber-400/60" : "text-amber-600"}`}
                      >
                        Tap to view {instr.floor_name}
                      </div>
                    )}
                  </div>
                  {instr.distance_meters > 0 && (
                    <span
                      className={`text-xs ${isDark ? "text-white/20" : "text-gray-400"}`}
                    >
                      {instr.distance_meters}m
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Show steps button when hidden */}
      {route && !showSteps && (
        <button
          onClick={() => setShowSteps(true)}
          className={`flex-shrink-0 border-t w-full flex items-center justify-between px-4 py-3 transition-colors animate-in ${
            isDark
              ? "glass border-white/5 hover:bg-white/3"
              : "bg-white border-gray-200 hover:bg-gray-50"
          }`}
        >
          <span
            className={`text-sm font-medium ${isDark ? "text-white" : "text-gray-900"}`}
          >
            View step-by-step directions
          </span>
          <ArrowRight className="w-4 h-4 text-brand-400" />
        </button>
      )}

      {/* Branding */}
      <div
        className={`flex-shrink-0 text-center py-2 text-xs ${isDark ? "text-white/15" : "text-gray-300"}`}
      >
        Powered by CampusNav
      </div>
    </div>
  );
}
