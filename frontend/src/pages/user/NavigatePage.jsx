import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { MapContainer, TileLayer, Marker, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  Search,
  Navigation,
  MapPin,
  X,
  ChevronDown,
  ArrowRight,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  Clock,
  Footprints,
  Crosshair,
  Building2,
  Sun,
  Moon,
} from "lucide-react";
import { api } from "../../utils/api.js";
import { useTheme } from "../../context/themeContext.jsx";

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY;
const USE_MAPTILER = import.meta.env.VITE_USE_MAPTILER === "true" && MAPTILER_KEY;
const TILE_URL = USE_MAPTILER
  ? `https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=${MAPTILER_KEY}`
  : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION = USE_MAPTILER
  ? '&copy; <a href="https://www.maptiler.com">MapTiler</a> &copy; <a href="https://www.openstreetmap.org">OpenStreetMap</a>'
  : '&copy; <a href="https://www.openstreetmap.org">OpenStreetMap</a> contributors';

const ROOM_COLORS = {
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

function MapCenter({ center }) {
  const map = useMap();
  useEffect(() => {
    if (center) map.setView(center, map.getZoom(), { animate: true });
  }, [center, map]);
  return null;
}

function MapResize() {
  const map = useMap();

  useEffect(() => {
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 0);

    return () => clearTimeout(timer);
  }, [map]);

  return null;
}

function pinIcon(color) {
  return L.divIcon({
    className: "",
    html: `<div style="width:14px;height:14px;background:${color};border:3px solid white;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.3)"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

function buildDirectRoute(from, to) {
  if (!from || !to) return null;
  return [from, to];
}

export default function NavigatePage() {
  const { buildingId } = useParams();
  const [searchParams] = useSearchParams();
  const fromRoomId = searchParams.get("from");
  const { isDark, toggleTheme } = useTheme();

  const [mode, setMode] = useState(fromRoomId ? "indoor" : "outdoor");

  const [building, setBuilding] = useState(null);
  const [floors, setFloors] = useState([]);
  const [currentFloor, setCurrentFloor] = useState(null);
  const [floorData, setFloorData] = useState(null);

  const [userLocation, setUserLocation] = useState(null);
  const [mapCenter, setMapCenter] = useState(null);
  const [outdoorRoute, setOutdoorRoute] = useState(null);
  const [outdoorRouteMessage, setOutdoorRouteMessage] = useState("");
  const [locationLoading, setLocationLoading] = useState(false);

  const [fromRoom, setFromRoom] = useState(null);
  const [toRoom, setToRoom] = useState(null);
  const [indoorRoute, setIndoorRoute] = useState(null);
  const [routeLoading, setRouteLoading] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [selectingFor, setSelectingFor] = useState(null);
  const [showSteps, setShowSteps] = useState(false);

  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const imgRef = useRef(null);
  const animFrameRef = useRef(null);
  const [pan, setPan] = useState({ x: 40, y: 40 });
  const [zoom, setZoom] = useState(0.9);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState(null);
  const [canvasSize, setCanvasSize] = useState({ w: 800, h: 600 });
  const [pathAnimOffset, setPathAnimOffset] = useState(0);

  useEffect(() => {
    if (!buildingId) return;
    api.buildings
      .get(buildingId)
      .then((b) => {
        setBuilding(b);
        const sorted = (b.floors || []).sort((a, z) => a.level - z.level);
        setFloors(sorted);
        if (sorted.length > 0) setCurrentFloor(sorted[0]);
        if (b.entrance_lat && b.entrance_lng) {
          setMapCenter([parseFloat(b.entrance_lat), parseFloat(b.entrance_lng)]);
        }
      })
      .catch(console.error);
  }, [buildingId]);

  useEffect(() => {
    if (!fromRoomId || !floors.length) return;
    api.rooms
      .get(fromRoomId)
      .then((room) => {
        setFromRoom(room);
        const found = floors.find((floor) => floor.id === room.floor_id);
        if (found) setCurrentFloor(found);
      })
      .catch(console.error);
  }, [fromRoomId, floors]);

  useEffect(() => {
    if (!currentFloor) return;
    api.floors
      .get(currentFloor.id)
      .then((data) => {
        setFloorData(data);
        imgRef.current = null;
        if (data.floor_plan_url) {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.src = data.floor_plan_url;
          img.onload = () => {
            imgRef.current = img;
          };
        }
      })
      .catch(console.error);
  }, [currentFloor]);

  const getUserLocation = useCallback(() => {
    if (!navigator.geolocation) {
      alert("GPS not supported by your browser.");
      return;
    }
    setLocationLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = [pos.coords.latitude, pos.coords.longitude];
        setUserLocation(loc);
        setMapCenter(loc);
        setLocationLoading(false);
        if (building?.entrance_lat && building?.entrance_lng) {
          fetch(
            `/api/v1/navigation/outdoor-route?fromLat=${loc[0]}&fromLng=${loc[1]}&toLat=${building.entrance_lat}&toLng=${building.entrance_lng}`,
          )
            .then(async (r) => {
              const data = await r.json().catch(() => ({}));
              if (!r.ok) {
                throw new Error(data.error || "Could not load outdoor route.");
              }
              return data;
            })
            .then((data) => {
              if (data.coordinates?.length) {
                setOutdoorRoute(data.coordinates.map((c) => [c[1], c[0]]));
                setOutdoorRouteMessage(data.message || "");
              } else {
                setOutdoorRoute(
                  buildDirectRoute(loc, [
                    parseFloat(building.entrance_lat),
                    parseFloat(building.entrance_lng),
                  ]),
                );
                setOutdoorRouteMessage(
                  "Walking directions are unavailable right now, so showing a direct line to the entrance.",
                );
              }
            })
            .catch((err) => {
              console.error(err);
              setOutdoorRoute(
                buildDirectRoute(loc, [
                  parseFloat(building.entrance_lat),
                  parseFloat(building.entrance_lng),
                ]),
              );
              setOutdoorRouteMessage(
                "Walking directions are unavailable right now, so showing a direct line to the entrance.",
              );
            });
        }
      },
      () => {
        setLocationLoading(false);
        alert("Could not get location. Please allow location access.");
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, [building]);

  const getIndoorRoute = useCallback(async () => {
    if (!fromRoom || !toRoom) return;
    setRouteLoading(true);
    try {
      const result = await api.navigation.route(fromRoom.id, toRoom.id, buildingId);
      setIndoorRoute(result);
      setShowSteps(true);
      if (result.floors_involved?.length > 0) {
        const found = floors.find((floor) => floor.id === result.floors_involved[0]);
        if (found) setCurrentFloor(found);
      }
    } catch (err) {
      alert(err.message);
    } finally {
      setRouteLoading(false);
    }
  }, [fromRoom, toRoom, buildingId, floors]);

  useEffect(() => {
    if (!searchQuery.trim() || !buildingId) {
      setSearchResults([]);
      return;
    }
    const timeoutId = setTimeout(() => {
      api.rooms
        .search(buildingId, searchQuery)
        .then(setSearchResults)
        .catch(() => setSearchResults([]));
    }, 300);
    return () => clearTimeout(timeoutId);
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

  useEffect(() => {
    if (!indoorRoute) return;
    const animate = () => {
      setPathAnimOffset((offset) => (offset + 0.5) % 20);
      animFrameRef.current = requestAnimationFrame(animate);
    };
    animFrameRef.current = requestAnimationFrame(animate);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [indoorRoute]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !floorData || mode !== "indoor") return;
    const ctx = canvas.getContext("2d");

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);
    ctx.imageSmoothingEnabled = true;

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

    const rooms = floorData.rooms || [];
    const pathOnFloor = (indoorRoute?.path || []).filter(
      (wp) => wp.floor_id === currentFloor?.id,
    );

    rooms.forEach((room) => {
      const type = ROOM_COLORS[room.type] || ROOM_COLORS.other;
      const isFrom = fromRoom?.id === room.id;
      const isTo = toRoom?.id === room.id;
      const onRoute = pathOnFloor.some((wp) => wp.room_id === room.id);

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

      const fontSize = Math.max(9, Math.min(13, room.width / 8)) / zoom;
      ctx.fillStyle = isDark ? "rgba(255,255,255,0.85)" : "rgba(30,41,59,0.85)";
      ctx.font = `500 ${fontSize}px system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(room.name, room.x + room.width / 2, room.y + room.height / 2);

      if (isFrom || isTo) {
        const cx = room.x + room.width / 2;
        const cy = room.y - 14 / zoom;
        ctx.beginPath();
        ctx.arc(cx, cy, 8 / zoom, 0, Math.PI * 2);
        ctx.fillStyle = isFrom ? "#22c55e" : "#ef4444";
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = `bold ${10 / zoom}px system-ui`;
        ctx.fillText(isFrom ? "A" : "B", cx, cy);
      }
    });

    if (pathOnFloor.length > 1) {
      ctx.beginPath();
      ctx.moveTo(pathOnFloor[0].x, pathOnFloor[0].y);
      pathOnFloor.slice(1).forEach((wp) => ctx.lineTo(wp.x, wp.y));
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
      pathOnFloor.forEach((wp) => {
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
    indoorRoute,
    pan,
    zoom,
    canvasSize,
    pathAnimOffset,
    currentFloor,
    isDark,
    mode,
  ]);

  const onMouseDown = (e) => {
    setIsPanning(true);
    setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const onMouseMove = (e) => {
    if (isPanning && panStart) {
      setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
    }
  };

  const onMouseUp = () => {
    setIsPanning(false);
    setPanStart(null);
  };

  const onWheel = (e) => {
    e.preventDefault();
    setZoom((value) => Math.min(4, Math.max(0.3, value * (e.deltaY > 0 ? 0.9 : 1.1))));
  };

  const touchRef = useRef({ d: 0 });

  const onTouchStart = (e) => {
    if (e.touches.length === 1) {
      setIsPanning(true);
      setPanStart({
        x: e.touches[0].clientX - pan.x,
        y: e.touches[0].clientY - pan.y,
      });
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      touchRef.current.d = Math.sqrt(dx * dx + dy * dy);
    }
  };

  const onTouchMove = (e) => {
    e.preventDefault();
    if (e.touches.length === 1 && isPanning && panStart) {
      setPan({
        x: e.touches[0].clientX - panStart.x,
        y: e.touches[0].clientY - panStart.y,
      });
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (touchRef.current.d > 0) {
        setZoom((value) =>
          Math.min(4, Math.max(0.3, value * distance / touchRef.current.d)),
        );
      }
      touchRef.current.d = distance;
    }
  };

  const onTouchEnd = () => {
    setIsPanning(false);
    setPanStart(null);
    touchRef.current.d = 0;
  };

  return (
    <div className={`h-screen flex flex-col overflow-hidden ${isDark ? "bg-surface-950" : "bg-gray-50"}`}>
      <div className="flex-shrink-0 px-4 pt-safe-top">
        <div className="flex items-center gap-2.5 py-3">
          <div className="w-7 h-7 bg-gradient-to-br from-brand-500 to-violet-500 rounded-lg flex items-center justify-center flex-shrink-0">
            <Navigation className="w-3.5 h-3.5 text-white" />
          </div>
          <h1
            className={`font-display font-bold text-sm flex-1 truncate ${isDark ? "text-white" : "text-gray-900"}`}
          >
            {building?.name || "CampusNav"}
          </h1>
          <button
            onClick={toggleTheme}
            className={`p-2 rounded-xl ${isDark ? "glass text-white/50 hover:text-white" : "bg-gray-100 text-gray-500 hover:text-gray-900"}`}
            aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
          >
            {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
          <div
            className={`flex rounded-xl overflow-hidden border text-xs ${isDark ? "border-white/10" : "border-gray-200"}`}
          >
            {["outdoor", "indoor"].map((entry) => (
              <button
                key={entry}
                onClick={() => setMode(entry)}
                className={`px-3 py-1.5 font-medium transition-all capitalize ${
                  mode === entry
                    ? "bg-brand-600 text-white"
                    : isDark
                      ? "text-white/40 hover:text-white"
                      : "text-gray-500 hover:text-gray-900"
                }`}
              >
                {entry}
              </button>
            ))}
          </div>
          {mode === "indoor" && floors.length > 1 && (
            <select
              value={currentFloor?.id || ""}
              onChange={(e) => {
                const found = floors.find((floor) => floor.id === e.target.value);
                if (found) setCurrentFloor(found);
              }}
              className={`text-xs px-2 py-1.5 rounded-xl border focus:outline-none ${isDark ? "glass text-white border-white/10" : "bg-white text-gray-900 border-gray-200"}`}
            >
              {floors.map((floor) => (
                <option key={floor.id} value={floor.id}>
                  {floor.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {mode === "outdoor" && (
          <div className="pb-3 space-y-2">
            <button
              onClick={getUserLocation}
              disabled={locationLoading}
              className="btn-primary w-full justify-center"
            >
              {locationLoading ? (
                <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              ) : (
                <Crosshair className="w-4 h-4" />
              )}
              {locationLoading ? "Getting location..." : "Find My Location & Get Walking Route"}
            </button>
            {!building?.entrance_lat && (
              <p className="text-xs text-center text-amber-400">
                Entrance coordinates not set. Ask admin to add them.
              </p>
            )}
            {outdoorRouteMessage && (
              <p className={`text-xs text-center ${isDark ? "text-white/50" : "text-gray-500"}`}>
                {outdoorRouteMessage}
              </p>
            )}
            <div
              className={`flex items-center justify-center gap-4 rounded-xl px-3 py-2 text-xs ${
                isDark ? "glass text-white/60" : "bg-white border border-gray-200 text-gray-600"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="block h-3 w-3 rounded-full bg-green-500 ring-2 ring-white" />
                <span>You</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="block h-3 w-3 rounded-full bg-brand-500 ring-2 ring-white" />
                <span>Building entrance</span>
              </div>
            </div>
            <button
              onClick={() => setMode("indoor")}
              className={`w-full flex items-center justify-center gap-2 py-2 rounded-xl text-sm border ${isDark ? "glass text-white/60" : "bg-white border-gray-200 text-gray-600"}`}
            >
              <Building2 className="w-4 h-4" />
              Already inside? Switch to Indoor Navigation
            </button>
          </div>
        )}

        {mode === "indoor" && (
          <div className="space-y-2 pb-3">
            <div
              onClick={() => {
                setSelectingFor("from");
                setSearchQuery("");
              }}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl cursor-pointer border ${
                selectingFor === "from"
                  ? "border-green-500/40"
                  : isDark
                    ? "glass"
                    : "bg-white border-gray-200"
              }`}
            >
              <div className="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center flex-shrink-0">
                <span className="text-white text-[9px] font-bold">A</span>
              </div>
              <span
                className={`text-sm flex-1 ${fromRoom ? (isDark ? "text-white" : "text-gray-900") : isDark ? "text-white/30" : "text-gray-400"}`}
              >
                {fromRoom?.name || "Starting point / your location"}
              </span>
              {fromRoom && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setFromRoom(null);
                    setIndoorRoute(null);
                  }}
                  className="text-white/30 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div
              onClick={() => {
                setSelectingFor("to");
                setSearchQuery("");
              }}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl cursor-pointer border ${
                selectingFor === "to"
                  ? "border-red-500/40"
                  : isDark
                    ? "glass"
                    : "bg-white border-gray-200"
              }`}
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
                    setToRoom(null);
                    setIndoorRoute(null);
                  }}
                  className="text-white/30 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {selectingFor && (
              <div className="relative animate-in">
                <Search
                  className={`w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 ${isDark ? "text-white/30" : "text-gray-400"}`}
                />
                <input
                  className="input pl-9"
                  placeholder="Search rooms..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  autoFocus
                />
                {searchResults.length > 0 && (
                  <div
                    className={`absolute top-full left-0 right-0 mt-2 rounded-xl overflow-hidden z-50 max-h-48 overflow-y-auto shadow-xl ${isDark ? "glass" : "bg-white border border-gray-200"}`}
                  >
                    {searchResults.map((room) => (
                      <button
                        key={room.id}
                        onClick={() => selectRoom(room)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 text-left ${isDark ? "hover:bg-white/5" : "hover:bg-gray-50"}`}
                      >
                        <MapPin className="w-3.5 h-3.5 text-brand-400 flex-shrink-0" />
                        <div>
                          <div className={`text-sm ${isDark ? "text-white" : "text-gray-900"}`}>
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
                  className={`absolute right-3 top-1/2 -translate-y-1/2 ${isDark ? "text-white/30" : "text-gray-400"}`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {fromRoom && toRoom && !indoorRoute && (
              <button
                onClick={getIndoorRoute}
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

            {indoorRoute && (
              <div
                className={`flex items-center gap-4 px-3 py-2 rounded-xl ${isDark ? "glass" : "bg-white border border-gray-200"}`}
              >
                <div className="flex items-center gap-1.5">
                  <Footprints className="w-3.5 h-3.5 text-brand-400" />
                  <span className={`text-sm font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                    {indoorRoute.distance}m
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-brand-400" />
                  <span className={`text-sm font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                    ~{Math.max(1, Math.round(indoorRoute.distance / 84))} min
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {mode === "outdoor" ? (
        <div className="flex-1 min-h-0 px-4 pb-4">
          {mapCenter ? (
            <div
              className={`h-full min-h-0 overflow-hidden rounded-2xl border ${
                isDark ? "border-white/10" : "border-gray-200 bg-white"
              }`}
            >
              <MapContainer
                center={mapCenter}
                zoom={17}
                style={{ width: "100%", height: "100%" }}
                zoomControl={false}
              >
                <TileLayer
                  url={TILE_URL}
                  attribution={TILE_ATTRIBUTION}
                  tileSize={USE_MAPTILER ? 512 : 256}
                  zoomOffset={USE_MAPTILER ? -1 : 0}
                />
                <MapCenter center={mapCenter} />
                <MapResize />
                {userLocation && <Marker position={userLocation} icon={pinIcon("#22c55e")} />}
                {building?.entrance_lat && building?.entrance_lng && (
                  <Marker
                    position={[parseFloat(building.entrance_lat), parseFloat(building.entrance_lng)]}
                    icon={pinIcon("#6366f1")}
                  />
                )}
                {outdoorRoute && (
                  <Polyline
                    positions={outdoorRoute}
                    pathOptions={{ color: "#6366f1", weight: 5, opacity: 0.85 }}
                  />
                )}
              </MapContainer>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-gray-300">
              <div className="text-center px-4">
                <Navigation
                  className={`w-12 h-12 mx-auto mb-3 ${isDark ? "text-white/20" : "text-gray-300"}`}
                />
                <p className={`text-sm ${isDark ? "text-white/40" : "text-gray-500"}`}>
                  Tap "Find My Location" above to load the map
                </p>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div ref={containerRef} className="flex-1 relative" style={{ minHeight: "300px" }}>
          <canvas
            ref={canvasRef}
            width={canvasSize.w}
            height={canvasSize.h}
            style={{ cursor: isPanning ? "grabbing" : "grab", touchAction: "none" }}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
            onWheel={onWheel}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
          />
          <div className="absolute top-3 right-3 flex flex-col gap-1">
            {[
              { icon: <ZoomIn className="w-3.5 h-3.5" />, fn: () => setZoom((value) => Math.min(4, value * 1.2)) },
              { icon: <ZoomOut className="w-3.5 h-3.5" />, fn: () => setZoom((value) => Math.max(0.3, value * 0.8)) },
              { icon: <RotateCcw className="w-3 h-3" />, fn: () => { setPan({ x: 40, y: 40 }); setZoom(0.9); } },
            ].map((button, index) => (
              <button
                key={index}
                onClick={button.fn}
                className={`w-8 h-8 flex items-center justify-center rounded-xl ${isDark ? "glass text-white/50 hover:text-white" : "bg-white text-gray-500 shadow-sm border border-gray-200"}`}
              >
                {button.icon}
              </button>
            ))}
          </div>
          {!floorData && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </div>
      )}

      {mode === "indoor" && indoorRoute && showSteps && (
        <div
          className={`flex-shrink-0 border-t max-h-56 overflow-y-auto animate-in ${isDark ? "glass border-white/5" : "bg-white border-gray-200"}`}
        >
          <div
            className={`flex items-center justify-between px-4 py-3 border-b sticky top-0 ${isDark ? "glass border-white/5" : "bg-white border-gray-200"}`}
          >
            <span className={`font-display font-semibold text-sm ${isDark ? "text-white" : "text-gray-900"}`}>
              Directions
            </span>
            <button
              onClick={() => setShowSteps(false)}
              className={isDark ? "text-white/30" : "text-gray-400"}
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>
          <div className="p-4 space-y-2">
            {(indoorRoute.steps || indoorRoute.instructions || []).map((step, index) => (
              <div
                key={index}
                className={`flex items-start gap-3 p-2 rounded-lg ${isDark ? "hover:bg-white/3" : "hover:bg-gray-50"}`}
              >
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-sm mt-0.5 ${isDark ? "bg-brand-600/20" : "bg-brand-50"}`}
                >
                  Pin
                </div>
                <span className={`text-sm ${isDark ? "text-white/80" : "text-gray-700"}`}>
                  {typeof step === "string" ? step : step.text || step}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {mode === "indoor" && indoorRoute && !showSteps && (
        <button
          onClick={() => setShowSteps(true)}
          className={`flex-shrink-0 border-t w-full flex items-center justify-between px-4 py-3 animate-in ${isDark ? "glass border-white/5" : "bg-white border-gray-200"}`}
        >
          <span className={`text-sm font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
            View step-by-step directions
          </span>
          <ArrowRight className="w-4 h-4 text-brand-400" />
        </button>
      )}

      <div className={`flex-shrink-0 text-center py-2 text-xs ${isDark ? "text-white/15" : "text-gray-300"}`}>
        Powered by CampusNav
      </div>
    </div>
  );
}
