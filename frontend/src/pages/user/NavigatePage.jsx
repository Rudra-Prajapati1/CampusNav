import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { MapContainer, Marker, Polyline, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  Building2,
  Compass,
  Crosshair,
  Moon,
  Navigation,
  Search,
  Sparkles,
  Sun,
  Wifi,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import IndoorCanvas from "../../components/navigation/IndoorCanvas.jsx";
import { useSensorFusion } from "../../hooks/useSensorFusion.js";
import { api } from "../../utils/api.js";
import { useTheme } from "../../context/themeContext.jsx";

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY;
const USE_MAPTILER =
  import.meta.env.VITE_USE_MAPTILER === "true" && Boolean(MAPTILER_KEY);
const TILE_URL = USE_MAPTILER
  ? `https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=${MAPTILER_KEY}`
  : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION = USE_MAPTILER
  ? '&copy; <a href="https://www.maptiler.com">MapTiler</a> &copy; <a href="https://www.openstreetmap.org">OpenStreetMap</a>'
  : '&copy; <a href="https://www.openstreetmap.org">OpenStreetMap</a> contributors';

function pinIcon(color, size = 16) {
  return L.divIcon({
    className: "",
    html: `<div style="width:${size}px;height:${size}px;background:${color};border:3px solid white;border-radius:999px;box-shadow:0 10px 24px rgba(15,23,42,0.2)"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function FitMapToPoints({ points, fallbackCenter, fallbackZoom = 18 }) {
  const map = useMap();

  useEffect(() => {
    if (points?.length > 1) {
      map.fitBounds(points, { padding: [46, 46], maxZoom: 20 });
    } else if (fallbackCenter) {
      map.setView(fallbackCenter, fallbackZoom, { animate: true });
    }
  }, [fallbackCenter, fallbackZoom, map, points]);

  return null;
}

function OutdoorMapControls() {
  const map = useMap();

  return (
    <div className="absolute bottom-4 right-4 z-[500] flex flex-col gap-2">
      <button onClick={() => map.zoomIn()} className="btn-secondary h-11 w-11 rounded-full p-0">
        <ZoomIn className="h-4 w-4" />
      </button>
      <button onClick={() => map.zoomOut()} className="btn-secondary h-11 w-11 rounded-full p-0">
        <ZoomOut className="h-4 w-4" />
      </button>
    </div>
  );
}

function getStepVisual(step) {
  const type = typeof step === "string" ? "" : step?.type || "";
  const text = typeof step === "string" ? step : step?.text || "";

  if (type.includes("stairs") || type.includes("elevator")) {
    return { label: "Floor", accent: "text-amber-500", text };
  }
  if (type.includes("turn")) {
    return { label: "Turn", accent: "text-brand-500", text };
  }
  if (type === "start") {
    return { label: "Start", accent: "text-emerald-500", text };
  }
  if (type === "arrive") {
    return { label: "Arrive", accent: "text-rose-500", text };
  }

  return { label: "Walk", accent: "text-sky-500", text };
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
  const [floorImage, setFloorImage] = useState(null);

  const [userLocation, setUserLocation] = useState(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [outdoorRoute, setOutdoorRoute] = useState(null);
  const [outdoorRouteMessage, setOutdoorRouteMessage] = useState("");

  const [fromRoom, setFromRoom] = useState(null);
  const [toRoom, setToRoom] = useState(null);
  const [indoorRoute, setIndoorRoute] = useState(null);
  const [routeLoading, setRouteLoading] = useState(false);

  const [selectingFor, setSelectingFor] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const deferredSearchQuery = useDeferredValue(searchQuery.trim());
  const sensorFusion = useSensorFusion(mode === "indoor");

  useEffect(() => {
    if (!buildingId) return;

    api.buildings
      .get(buildingId)
      .then((data) => {
        setBuilding(data);
        const orderedFloors = [...(data.floors || [])].sort(
          (left, right) => left.level - right.level,
        );
        setFloors(orderedFloors);
        if (orderedFloors.length > 0) {
          setCurrentFloor((previous) => previous || orderedFloors[0]);
        }
      })
      .catch((error) => console.error(error));
  }, [buildingId]);

  useEffect(() => {
    if (!fromRoomId) return;

    api.rooms
      .get(fromRoomId)
      .then((room) => {
        setFromRoom(room);
        setMode("indoor");
      })
      .catch((error) => console.error(error));
  }, [fromRoomId]);

  useEffect(() => {
    if (!fromRoom?.floor_id || !floors.length) return;
    const floor = floors.find((entry) => entry.id === fromRoom.floor_id);
    if (floor) setCurrentFloor(floor);
  }, [floors, fromRoom]);

  useEffect(() => {
    if (!currentFloor) return;

    let cancelled = false;
    setFloorData(null);
    setFloorImage(null);

    api.floors
      .get(currentFloor.id)
      .then((data) => {
        if (cancelled) return;
        setFloorData(data);

        if (!data.floor_plan_url) return;

        const image = new Image();
        image.crossOrigin = "anonymous";
        image.onload = () => {
          if (!cancelled) setFloorImage(image);
        };
        image.src = data.floor_plan_url;
      })
      .catch((error) => console.error(error));

    return () => {
      cancelled = true;
    };
  }, [currentFloor]);

  useEffect(() => {
    if (!deferredSearchQuery || !buildingId) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    let cancelled = false;
    setSearchLoading(true);

    const timer = setTimeout(() => {
      api.rooms
        .search(buildingId, deferredSearchQuery)
        .then((results) => {
          if (cancelled) return;
          startTransition(() => setSearchResults(results || []));
        })
        .catch(() => {
          if (!cancelled) setSearchResults([]);
        })
        .finally(() => {
          if (!cancelled) setSearchLoading(false);
        });
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [buildingId, deferredSearchQuery]);

  const selectRoom = useCallback(
    (room) => {
      if (selectingFor === "from") setFromRoom(room);
      else setToRoom(room);

      setSearchQuery("");
      setSearchResults([]);
      setSelectingFor(null);
      setIndoorRoute(null);
    },
    [selectingFor],
  );

  const floorPathMap = useMemo(() => {
    const grouped = new Map();
    (indoorRoute?.path || []).forEach((point) => {
      if (!grouped.has(point.floor_id)) grouped.set(point.floor_id, []);
      grouped.get(point.floor_id).push(point);
    });
    return grouped;
  }, [indoorRoute]);

  const currentFloorPath = currentFloor ? floorPathMap.get(currentFloor.id) || [] : [];

  const outdoorFitPoints = useMemo(() => {
    if (outdoorRoute?.length) return outdoorRoute;

    const points = [];
    if (userLocation) points.push(userLocation);
    if (building?.entrance_lat && building?.entrance_lng) {
      points.push([
        Number.parseFloat(building.entrance_lat),
        Number.parseFloat(building.entrance_lng),
      ]);
    }
    return points;
  }, [building, outdoorRoute, userLocation]);

  const visibleFloors = useMemo(() => {
    if (!indoorRoute?.floors_involved?.length) return floors;
    const routeFloorIds = new Set(indoorRoute.floors_involved);
    return floors.filter((floor) => routeFloorIds.has(floor.id));
  }, [floors, indoorRoute]);

  const getUserLocation = useCallback(() => {
    if (!navigator.geolocation) {
      window.alert("Geolocation is not supported by this browser.");
      return;
    }

    setLocationLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const currentLocation = [
          position.coords.latitude,
          position.coords.longitude,
        ];
        setUserLocation(currentLocation);

        if (!building?.entrance_lat || !building?.entrance_lng) {
          setLocationLoading(false);
          return;
        }

        try {
          const response = await fetch(
            `/api/v1/navigation/outdoor-route?fromLat=${currentLocation[0]}&fromLng=${currentLocation[1]}&toLat=${building.entrance_lat}&toLng=${building.entrance_lng}`,
          );
          const data = await response.json();

          if (data.coordinates?.length) {
            setOutdoorRoute(data.coordinates.map((coord) => [coord[1], coord[0]]));
            setOutdoorRouteMessage(data.message || "");
          } else {
            setOutdoorRoute([
              currentLocation,
              [
                Number.parseFloat(building.entrance_lat),
                Number.parseFloat(building.entrance_lng),
              ],
            ]);
            setOutdoorRouteMessage(
              "Walking directions are temporarily unavailable, so a direct approach line is shown instead.",
            );
          }
        } catch (error) {
          console.error(error);
          setOutdoorRoute([
            currentLocation,
            [
              Number.parseFloat(building.entrance_lat),
              Number.parseFloat(building.entrance_lng),
            ],
          ]);
          setOutdoorRouteMessage(
            "Walking directions are temporarily unavailable, so a direct approach line is shown instead.",
          );
        } finally {
          setLocationLoading(false);
        }
      },
      () => {
        setLocationLoading(false);
        window.alert("Unable to access location. Please enable GPS permission.");
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
      const firstFloor = floors.find((floor) => floor.id === result.floors_involved?.[0]);
      if (firstFloor) setCurrentFloor(firstFloor);
    } catch (error) {
      window.alert(error.message || "Unable to calculate route.");
    } finally {
      setRouteLoading(false);
    }
  }, [buildingId, floors, fromRoom, toRoom]);

  return (
    <div className="page-shell page-grid min-h-screen p-3 sm:p-4">
      <div className="mx-auto flex h-[calc(100dvh-1.5rem)] w-full max-w-[1600px] flex-col overflow-hidden rounded-[32px] border border-[var(--border)] bg-[var(--surface)] shadow-card lg:h-[calc(100dvh-2rem)]">
        <header className="flex flex-col gap-4 border-b border-[var(--border)] px-4 py-4 sm:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-[22px] bg-gradient-to-br from-brand-500 via-sky-500 to-cyan-400 text-white">
                <Compass className="h-5 w-5" />
              </div>
              <div>
                <div className="badge mb-2">
                  <Sparkles className="h-3.5 w-3.5 text-brand-500" />
                  Navigation workspace
                </div>
                <h1 className="font-display text-2xl font-bold sm:text-3xl">
                  {building?.name || "Campus navigation"}
                </h1>
                <p className="text-sm subtle-text">
                  A cleaner, map-first route experience for outdoor and indoor wayfinding.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-full border border-[var(--border)] bg-[var(--surface-strong)] p-1">
                {["outdoor", "indoor"].map((entry) => (
                  <button
                    key={entry}
                    onClick={() => setMode(entry)}
                    className={`rounded-full px-4 py-2 text-sm font-semibold capitalize transition-all ${
                      mode === entry ? "bg-brand-500 text-white" : "text-[var(--text-muted)]"
                    }`}
                  >
                    {entry}
                  </button>
                ))}
              </div>
              <button onClick={toggleTheme} className="btn-secondary h-11 w-11 rounded-full p-0">
                {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </header>

        <div className="min-h-0 flex-1 lg:grid lg:grid-cols-[370px_minmax(0,1fr)]">
          <aside className="min-h-0 overflow-y-auto border-b border-[var(--border)] p-4 lg:border-b-0 lg:border-r lg:p-5">
            <div className="card-muted rounded-[28px] p-5">
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--text-soft)]">
                Route summary
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <div>
                  <div className="font-display text-2xl font-bold">
                    {mode === "outdoor" ? "Approach the building" : "Plan your indoor route"}
                  </div>
                  <p className="mt-1 text-sm leading-7 subtle-text">
                    {building?.address || "Ask an admin to configure building details and entrances."}
                  </p>
                </div>
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-500/10 text-brand-500">
                  {mode === "outdoor" ? <Navigation className="h-5 w-5" /> : <Navigation className="h-5 w-5" />}
                </div>
              </div>
            </div>

            {mode === "outdoor" ? (
              <div className="mt-4 space-y-4">
                <div className="card p-5">
                  <div className="text-sm font-semibold">Get walking guidance</div>
                  <p className="mt-2 text-sm leading-7 subtle-text">
                    Outdoor routing uses your live GPS position and the building entrance saved by the admin team.
                  </p>
                  <button onClick={getUserLocation} disabled={locationLoading} className="btn-primary mt-5 w-full">
                    <Crosshair className="h-4 w-4" />
                    {locationLoading ? "Locating..." : "Find my location"}
                  </button>
                  {outdoorRouteMessage && <p className="mt-3 text-sm subtle-text">{outdoorRouteMessage}</p>}
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                <div className="card p-5">
                  <div className="text-sm font-semibold">Indoor planner</div>
                  <div className="mt-4 space-y-3">
                    {[
                      { key: "from", label: "Starting point", room: fromRoom, accent: "bg-emerald-500" },
                      { key: "to", label: "Destination", room: toRoom, accent: "bg-rose-500" },
                    ].map((field) => (
                      <button
                        key={field.key}
                        onClick={() => {
                          setSelectingFor(field.key);
                          setSearchQuery("");
                        }}
                        className={`w-full rounded-[22px] border px-4 py-4 text-left transition-all ${
                          selectingFor === field.key
                            ? "border-brand-400/40 bg-brand-500/10"
                            : "border-[var(--border)] bg-[var(--surface-muted)]"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <span className={`h-3.5 w-3.5 rounded-full ${field.accent}`} />
                          <span className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--text-soft)]">
                            {field.label}
                          </span>
                        </div>
                        <div className="mt-2 font-semibold">{field.room?.name || "Choose a room"}</div>
                      </button>
                    ))}
                  </div>

                  {selectingFor && (
                    <div className="mt-4">
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-soft)]" />
                        <input
                          className="input pl-11"
                          placeholder="Search rooms..."
                          autoFocus
                          value={searchQuery}
                          onChange={(event) => setSearchQuery(event.target.value)}
                        />
                      </div>
                      <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
                        {searchLoading ? (
                          <div className="rounded-[20px] border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-4 text-sm subtle-text">
                            Searching rooms...
                          </div>
                        ) : searchResults.length === 0 ? (
                          <div className="rounded-[20px] border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-4 text-sm subtle-text">
                            Start typing to search available rooms.
                          </div>
                        ) : (
                          searchResults.map((room) => (
                            <button
                              key={room.id}
                              onClick={() => selectRoom(room)}
                              className="w-full rounded-[20px] border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-4 text-left transition-all hover:border-brand-300/30 hover:bg-[var(--surface-strong)]"
                            >
                              <div className="font-semibold">{room.name}</div>
                              <div className="mt-1 text-sm capitalize subtle-text">{room.type}</div>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  )}

                  <button onClick={getIndoorRoute} disabled={!fromRoom || !toRoom || routeLoading} className="btn-primary mt-5 w-full">
                    <Navigation className="h-4 w-4" />
                    {routeLoading ? "Calculating route..." : "Get best route"}
                  </button>
                </div>

                {indoorRoute && (
                  <div className="card p-5">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="metric-card p-4">
                        <div className="metric-label">Distance</div>
                        <div className="mt-2 font-display text-3xl font-bold">{indoorRoute.distance}m</div>
                      </div>
                      <div className="metric-card p-4">
                        <div className="metric-label">ETA</div>
                        <div className="mt-2 font-display text-3xl font-bold">
                          {indoorRoute.estimated_time || Math.max(1, Math.round(indoorRoute.distance / 84))}m
                        </div>
                      </div>
                      <div className="metric-card p-4">
                        <div className="metric-label">Floor changes</div>
                        <div className="mt-2 font-display text-3xl font-bold">{indoorRoute.floor_changes || 0}</div>
                      </div>
                    </div>

                    {visibleFloors.length > 0 && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {visibleFloors.map((floor) => (
                          <button
                            key={floor.id}
                            onClick={() => setCurrentFloor(floor)}
                            className={`rounded-full px-4 py-2 text-sm font-semibold transition-all ${
                              currentFloor?.id === floor.id
                                ? "bg-brand-500 text-white"
                                : "border border-[var(--border)] bg-[var(--surface-muted)]"
                            }`}
                          >
                            {floor.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="card p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">Sensor fusion beta</div>
                      <p className="mt-1 text-sm subtle-text">
                        Motion and orientation data are available as a progressive enhancement for supported devices.
                      </p>
                    </div>
                    <Wifi className="h-4.5 w-4.5 text-brand-500" />
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3">
                    {[
                      ["Heading", sensorFusion.heading !== null ? `${Math.round(sensorFusion.heading)}°` : "--"],
                      ["Steps", sensorFusion.stepCount],
                      ["Motion", sensorFusion.movement],
                      ["Gyro", sensorFusion.gyroscope || 0],
                    ].map(([label, value]) => (
                      <div key={label} className="metric-card p-4">
                        <div className="metric-label">{label}</div>
                        <div className="mt-2 font-display text-2xl font-bold">{value}</div>
                      </div>
                    ))}
                  </div>

                  {sensorFusion.permissionNeeded && !sensorFusion.permissionGranted && (
                    <button onClick={sensorFusion.requestPermission} className="btn-secondary mt-4 w-full">
                      Enable motion sensors
                    </button>
                  )}
                </div>

                {indoorRoute && (
                  <div className="card p-5">
                    <div className="text-sm font-semibold">Directions</div>
                    <div className="mt-4 space-y-3">
                      {(indoorRoute.instructions || indoorRoute.steps || []).map((step, index) => {
                        const visual = getStepVisual(step);
                        return (
                          <div key={index} className="rounded-[22px] border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-4">
                            <div className={`text-xs font-bold uppercase tracking-[0.18em] ${visual.accent}`}>
                              {visual.label}
                            </div>
                            <div className="mt-2 text-sm leading-7">{visual.text}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </aside>

          <section className="min-h-0 overflow-hidden p-4 lg:p-5">
            <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-4">
              <div className="card-muted flex flex-col gap-3 rounded-[28px] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="font-semibold">
                    {mode === "outdoor" ? "Outdoor approach view" : currentFloor?.name || "Indoor map"}
                  </div>
                  <div className="text-sm subtle-text">
                    {mode === "outdoor"
                      ? "High zoom and auto-fit are enabled for the outdoor map."
                      : "Indoor zooming and floor alignment are recalculated when the route or floor changes."}
                  </div>
                </div>

                {mode === "indoor" && floors.length > 1 && (
                  <div className="flex flex-wrap gap-2">
                    {floors.map((floor) => (
                      <button
                        key={floor.id}
                        onClick={() => setCurrentFloor(floor)}
                        className={`rounded-full px-4 py-2 text-sm font-semibold transition-all ${
                          currentFloor?.id === floor.id
                            ? "bg-brand-500 text-white"
                            : "border border-[var(--border)] bg-[var(--surface-strong)]"
                        }`}
                      >
                        {floor.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="min-h-0">
                {mode === "outdoor" ? (
                  <div className="h-full overflow-hidden rounded-[28px] border border-[var(--border)]">
                    {building?.entrance_lat && building?.entrance_lng ? (
                      <MapContainer
                        center={[
                          Number.parseFloat(building.entrance_lat),
                          Number.parseFloat(building.entrance_lng),
                        ]}
                        zoom={18}
                        minZoom={3}
                        maxZoom={22}
                        zoomControl={false}
                        style={{ width: "100%", height: "100%" }}
                      >
                        <TileLayer
                          url={TILE_URL}
                          attribution={TILE_ATTRIBUTION}
                          maxZoom={22}
                          maxNativeZoom={USE_MAPTILER ? 22 : 19}
                          tileSize={USE_MAPTILER ? 512 : 256}
                          zoomOffset={USE_MAPTILER ? -1 : 0}
                        />
                        <FitMapToPoints
                          points={outdoorFitPoints}
                          fallbackCenter={[
                            Number.parseFloat(building.entrance_lat),
                            Number.parseFloat(building.entrance_lng),
                          ]}
                        />
                        {userLocation && <Marker position={userLocation} icon={pinIcon("#059669")} />}
                        <Marker
                          position={[
                            Number.parseFloat(building.entrance_lat),
                            Number.parseFloat(building.entrance_lng),
                          ]}
                          icon={pinIcon("#0f6efd")}
                        />
                        {outdoorRoute?.length > 0 && (
                          <Polyline positions={outdoorRoute} pathOptions={{ color: "#0f6efd", weight: 6, opacity: 0.88 }} />
                        )}
                        <OutdoorMapControls />
                      </MapContainer>
                    ) : (
                      <div className="flex h-full items-center justify-center p-6">
                        <div className="text-center">
                          <Building2 className="mx-auto h-12 w-12 text-[var(--text-soft)]" />
                          <div className="mt-4 font-display text-2xl font-bold">Entrance coordinates missing</div>
                          <p className="mt-2 text-sm leading-7 subtle-text">
                            Ask an admin to set the building entrance latitude and longitude before using outdoor navigation.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                ) : floorData ? (
                  <IndoorCanvas
                    floorData={floorData}
                    floorImage={floorImage}
                    pathPoints={currentFloorPath}
                    fromRoom={fromRoom}
                    toRoom={toRoom}
                    currentFloorId={currentFloor?.id}
                    isDark={isDark}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center rounded-[28px] border border-[var(--border)] bg-[var(--surface-strong)]">
                    <div className="flex flex-col items-center gap-4">
                      <div className="h-10 w-10 rounded-full border-2 border-brand-500 border-t-transparent animate-spin" />
                      <div className="text-sm subtle-text">Loading indoor map...</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
