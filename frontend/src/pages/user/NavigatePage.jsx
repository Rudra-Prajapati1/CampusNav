// CampusNav redesign — NavigatePage.jsx — updated
import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Activity,
  ArrowUpDown,
  Compass,
  Crosshair,
  LocateFixed,
  Moon,
  Navigation,
  Search,
  Sun,
  Wifi,
  X,
} from "lucide-react";
import NavigationMapRenderer from "../../components/navigation/NavigationMapRenderer.jsx";
import { buildCanonicalIndoorMap } from "../../components/navigation/indoorMapModel.js";
import { resolveNavigationAdapter } from "../../components/navigation/adapters/adapterRegistry.js";
import { MAP_PROVIDER } from "../../components/navigation/mapProviderConfig.js";
import { useSensorFusion } from "../../hooks/useSensorFusion.js";
import { useAuthStore } from "../../stores/authStore.js";
import { api } from "../../utils/api.js";
import { useTheme } from "../../context/themeContext.jsx";

function roomCenter(room) {
  if (!room) return null;
  if (Array.isArray(room.polygon_points) && room.polygon_points.length > 0) {
    const xs = room.polygon_points.map((point) => point.x);
    const ys = room.polygon_points.map((point) => point.y);
    return {
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      y: (Math.min(...ys) + Math.max(...ys)) / 2,
    };
  }

  return {
    x: room.x + room.width / 2,
    y: room.y + room.height / 2,
  };
}

function SearchField({ label, room, active, onActivate, accent }) {
  return (
    <button
      type="button"
      onClick={onActivate}
      className={`w-full rounded-xl border px-4 py-4 text-left transition-colors ${
        active
          ? "border-accent bg-accent-light"
          : "border-default bg-surface hover:bg-surface-alt"
      }`}
    >
      <div className="flex items-center gap-3">
        <span className={`h-2.5 w-2.5 rounded-full ${accent}`} />
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
          {label}
        </span>
      </div>
      <div className="mt-2 text-sm font-medium text-primary">
        {room?.name || "Choose a room"}
      </div>
      <div className="mt-1 text-xs subtle-text">
        {room?.type || "Search by room or point of interest"}
      </div>
    </button>
  );
}

export default function NavigatePage() {
  const navigate = useNavigate();
  const { buildingId } = useParams();
  const [searchParams] = useSearchParams();
  const fromRoomId = searchParams.get("from");
  const { isDark, toggleTheme } = useTheme();
  const isAdmin = useAuthStore((store) => store.isAdmin);
  const [sensorFusionEnabled, setSensorFusionEnabled] = useState(false);
  const sensorFusion = useSensorFusion(sensorFusionEnabled);

  const [mode, setMode] = useState(fromRoomId ? "indoor" : "outdoor");
  const [building, setBuilding] = useState(null);
  const [buildingOptions, setBuildingOptions] = useState([]);
  const [floors, setFloors] = useState([]);
  const [currentFloor, setCurrentFloor] = useState(null);
  const [floorData, setFloorData] = useState(null);
  const [floorImage, setFloorImage] = useState(null);
  const [selectingFor, setSelectingFor] = useState("from");
  const [roomPickTarget, setRoomPickTarget] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [fromRoom, setFromRoom] = useState(null);
  const [toRoom, setToRoom] = useState(null);
  const [indoorRoute, setIndoorRoute] = useState(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [userLocation, setUserLocation] = useState(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [outdoorRoute, setOutdoorRoute] = useState(null);
  const [outdoorRouteMessage, setOutdoorRouteMessage] = useState("");
  const [recentSearches, setRecentSearches] = useState([]);
  const [mobileSheetExpanded, setMobileSheetExpanded] = useState(false);
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [indoorViewMode, setIndoorViewMode] = useState("3d");
  const [sensorPosition, setSensorPosition] = useState(null);
  const dragStartRef = useRef(null);
  const lastStepCountRef = useRef(0);

  const deferredSearchQuery = useDeferredValue(searchQuery.trim());
  const recentKey = `campusnav-recent-searches:${buildingId}`;
  const entranceCenter = useMemo(() => {
    const lat = Number.parseFloat(building?.entrance_lat);
    const lng = Number.parseFloat(building?.entrance_lng);

    return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
  }, [building?.entrance_lat, building?.entrance_lng]);
  const indoorMap = useMemo(() => buildCanonicalIndoorMap(floorData), [floorData]);
  const currentOverlayBounds = useMemo(
    () => indoorMap.floor.overlayBounds,
    [indoorMap],
  );
  const hasGeoAnchor = Boolean(entranceCenter && currentOverlayBounds);
  const bluetoothSupported =
    typeof navigator !== "undefined" && "bluetooth" in navigator;
  const rendererResolution = useMemo(
    () => resolveNavigationAdapter(MAP_PROVIDER),
    [],
  );
  const currentFloorBeacons = useMemo(
    () =>
      indoorMap.beacons.filter(
        (beacon) =>
          !beacon.floorId ||
          beacon.floorId === currentFloor?.id ||
          beacon.floorId === floorData?.id,
      ),
    [currentFloor?.id, floorData?.id, indoorMap.beacons],
  );

  useEffect(() => {
    api.buildings
      .list()
      .then((data) => setBuildingOptions(data || []))
      .catch(() => setBuildingOptions([]));
  }, []);

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
        setCurrentFloor((previous) => previous || orderedFloors[0] || null);
      })
      .catch((error) => console.error(error));
  }, [buildingId]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(recentKey);
      setRecentSearches(saved ? JSON.parse(saved) : []);
    } catch {
      setRecentSearches([]);
    }
  }, [recentKey]);

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
    const matchingFloor = floors.find(
      (entry) => entry.id === fromRoom.floor_id,
    );
    if (matchingFloor) setCurrentFloor(matchingFloor);
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

  useEffect(() => {
    if (mode !== "indoor") {
      setOverlayVisible(false);
      setRoomPickTarget(null);
      return;
    }

    setOverlayVisible(false);
    const timer = window.setTimeout(() => setOverlayVisible(true), 50);
    return () => window.clearTimeout(timer);
  }, [currentFloor?.id, floorData?.id, mode]);

  useEffect(() => {
    lastStepCountRef.current = sensorFusion.stepCount;
  }, [sensorFusionEnabled]);

  useEffect(() => {
    if (!sensorFusionEnabled || !sensorPosition || sensorFusion.heading === null) return;
    if (sensorPosition.floorId !== currentFloor?.id) return;

    const deltaSteps = sensorFusion.stepCount - lastStepCountRef.current;
    if (deltaSteps <= 0) return;
    lastStepCountRef.current = sensorFusion.stepCount;

    const pixelsPerMeter = indoorMap.metadata.pixelsPerMeter || 40;
    const stepPixels = pixelsPerMeter * 0.72 * deltaSteps;
    const radians = (sensorFusion.heading * Math.PI) / 180;
    const dx = Math.sin(radians) * stepPixels;
    const dy = -Math.cos(radians) * stepPixels;

    setSensorPosition((current) =>
      current
        ? {
            ...current,
            x: current.x + dx,
            y: current.y + dy,
          }
        : current,
    );
  }, [
    currentFloor?.id,
    indoorMap.metadata.pixelsPerMeter,
    sensorFusion.heading,
    sensorFusion.stepCount,
    sensorFusionEnabled,
    sensorPosition,
  ]);

  const visibleFloors = useMemo(() => {
    if (!indoorRoute?.floors_involved?.length) return floors;
    const routeFloorIds = new Set(indoorRoute.floors_involved);
    return floors.filter((floor) => routeFloorIds.has(floor.id));
  }, [floors, indoorRoute]);

  const floorPathMap = useMemo(() => {
    const grouped = new Map();
    (indoorRoute?.path || []).forEach((point) => {
      if (!grouped.has(point.floor_id)) grouped.set(point.floor_id, []);
      grouped.get(point.floor_id).push(point);
    });
    return grouped;
  }, [indoorRoute]);

  const currentFloorPath = currentFloor
    ? floorPathMap.get(currentFloor.id) || []
    : [];

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

  const routeSummary = useMemo(() => {
    if (!indoorRoute) return null;
    return {
      distance: indoorRoute.distance,
      duration:
        indoorRoute.estimated_time ||
        Math.max(1, Math.round(indoorRoute.distance / 84)),
      steps: (indoorRoute.instructions || indoorRoute.steps || []).length,
    };
  }, [indoorRoute]);

  const currentSensorRoomCenter = useMemo(() => {
    if (!fromRoom || fromRoom.floor_id !== currentFloor?.id) return null;
    const room = indoorMap.rooms.find((entry) => entry.id === fromRoom.id) || fromRoom;
    return roomCenter(room);
  }, [currentFloor?.id, fromRoom, indoorMap.rooms]);

  const persistRecentSearch = useCallback(
    (from, to) => {
      if (!from || !to) return;
      const next = [
        {
          id: `${from.id}:${to.id}`,
          fromId: from.id,
          fromName: from.name,
          toId: to.id,
          toName: to.name,
        },
        ...recentSearches.filter((entry) => entry.id !== `${from.id}:${to.id}`),
      ].slice(0, 3);

      setRecentSearches(next);
      try {
        window.localStorage.setItem(recentKey, JSON.stringify(next));
      } catch {
        // Ignore storage failures.
      }
    },
    [recentKey, recentSearches],
  );

  const selectRoom = useCallback(
    (room) => {
      const target = roomPickTarget || selectingFor;
      if (target === "from") setFromRoom(room);
      else setToRoom(room);
      setSelectingFor(target);
      setRoomPickTarget(null);
      setSearchQuery("");
      setSearchResults([]);
      setIndoorRoute(null);
      setMode("indoor");
      setMobileSheetExpanded(true);
    },
    [roomPickTarget, selectingFor],
  );

  const placeBlueDotFromStart = useCallback(() => {
    if (!fromRoom || fromRoom.floor_id !== currentFloor?.id || !currentSensorRoomCenter) return;
    setSensorPosition({
      floorId: currentFloor.id,
      x: currentSensorRoomCenter.x,
      y: currentSensorRoomCenter.y,
      source: "start-room",
    });
    lastStepCountRef.current = sensorFusion.stepCount;
  }, [
    currentFloor?.id,
    currentSensorRoomCenter,
    fromRoom,
    sensorFusion.stepCount,
  ]);

  const snapBlueDotToNearestBeacon = useCallback(() => {
    if (!sensorPosition || !currentFloorBeacons.length) return;
    const nearest = [...currentFloorBeacons].sort((left, right) => {
      const leftDistance = Math.hypot(left.x - sensorPosition.x, left.y - sensorPosition.y);
      const rightDistance = Math.hypot(right.x - sensorPosition.x, right.y - sensorPosition.y);
      return leftDistance - rightDistance;
    })[0];

    if (!nearest) return;
    setSensorPosition({
      floorId: currentFloor?.id,
      x: nearest.x,
      y: nearest.y,
      source: "beacon-snap",
    });
  }, [currentFloor?.id, currentFloorBeacons, sensorPosition]);

  const enableSensorFusion = useCallback(async () => {
    if (sensorFusion.permissionNeeded && !sensorFusion.permissionGranted) {
      const granted = await sensorFusion.requestPermission();
      if (!granted) {
        window.alert("Motion and orientation permission is required for sensor-assisted positioning.");
        return;
      }
    }

    setSensorFusionEnabled(true);
    lastStepCountRef.current = sensorFusion.stepCount;
  }, [
    sensorFusion.permissionGranted,
    sensorFusion.permissionNeeded,
    sensorFusion.requestPermission,
    sensorFusion.stepCount,
  ]);

  const dismissRecentSearch = (id) => {
    const next = recentSearches.filter((entry) => entry.id !== id);
    setRecentSearches(next);
    try {
      window.localStorage.setItem(recentKey, JSON.stringify(next));
    } catch {
      // Ignore storage failures.
    }
  };

  const applyRecentSearch = async (entry) => {
    try {
      const [from, to] = await Promise.all([
        api.rooms.get(entry.fromId),
        api.rooms.get(entry.toId),
      ]);
      setFromRoom(from);
      setToRoom(to);
      setRoomPickTarget(null);
      setMode("indoor");
    } catch (error) {
      console.error(error);
    }
  };

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
            setOutdoorRoute(
              data.coordinates.map((coord) => [coord[1], coord[0]]),
            );
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
        window.alert(
          "Unable to access location. Please enable GPS permission.",
        );
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, [building]);

  const getIndoorRoute = useCallback(async () => {
    if (!fromRoom || !toRoom) return;

    setRouteLoading(true);
    try {
      const result = await api.navigation.route(
        fromRoom.id,
        toRoom.id,
        buildingId,
      );
      setIndoorRoute(result);
      setRoomPickTarget(null);
      setMode("indoor");
      const firstFloor = floors.find(
        (floor) => floor.id === result.floors_involved?.[0],
      );
      if (firstFloor) setCurrentFloor(firstFloor);
      persistRecentSearch(fromRoom, toRoom);
    } catch (error) {
      window.alert(error.message || "Unable to calculate route.");
    } finally {
      setRouteLoading(false);
    }
  }, [buildingId, floors, fromRoom, persistRecentSearch, toRoom]);

  const handleSwapRooms = () => {
    setFromRoom(toRoom);
    setToRoom(fromRoom);
    setIndoorRoute(null);
    setRoomPickTarget(null);
  };

  const handleBuildingChange = (nextBuildingId) => {
    if (!nextBuildingId || nextBuildingId === buildingId) return;
    navigate(`/navigate/${nextBuildingId}`);
  };

  const handleTouchStart = (event) => {
    dragStartRef.current = event.touches[0].clientY;
  };

  const handleTouchEnd = (event) => {
    if (dragStartRef.current === null) return;
    const delta = event.changedTouches[0].clientY - dragStartRef.current;
    if (delta > 40) setMobileSheetExpanded(false);
    if (delta < -40) setMobileSheetExpanded(true);
    dragStartRef.current = null;
  };

  const panelContent = (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="app-logo">
          <span className="app-logo-mark">
            <Compass className="h-4 w-4" />
          </span>
          <div>
            <div className="text-sm font-semibold">CampusNav</div>
            <div className="text-[11px] text-muted">
              {building?.name || "Navigation"}
            </div>
          </div>
        </div>
        <button onClick={toggleTheme} className="btn-ghost px-3">
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </div>

      <div className="inline-flex rounded-full border border-default bg-surface-alt p-1">
        {["outdoor", "indoor"].map((entry) => (
          <button
            key={entry}
            onClick={() => setMode(entry)}
            className={`rounded-full px-4 py-2 text-sm font-semibold capitalize transition-colors ${
              mode === entry ? "bg-accent text-white" : "text-secondary"
            }`}
          >
            {entry}
          </button>
        ))}
      </div>

      {mode === "indoor" && (
        <div className="inline-flex rounded-full border border-default bg-surface-alt p-1">
          {["2d", "3d"].map((entry) => (
            <button
              key={entry}
              onClick={() => setIndoorViewMode(entry)}
              className={`rounded-full px-4 py-2 text-sm font-semibold uppercase transition-colors ${
                indoorViewMode === entry ? "bg-accent text-white" : "text-secondary"
              }`}
            >
              {entry}
            </button>
          ))}
        </div>
      )}

      {buildingOptions.length > 1 && (
        <div>
          <label className="field-label">Building</label>
          <select
            className="select"
            value={buildingId || ""}
            onChange={(event) => handleBuildingChange(event.target.value)}
          >
            {buildingOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {mode === "indoor" ? (
        <>
          <div className="space-y-3">
            <SearchField
              label="From"
              room={fromRoom}
              active={selectingFor === "from"}
              onActivate={() => {
                setSelectingFor("from");
                setRoomPickTarget("from");
                setMode("indoor");
              }}
              accent="bg-emerald-500"
            />
            <div className="flex justify-center">
              <button onClick={handleSwapRooms} className="btn-secondary px-3">
                <ArrowUpDown className="h-4 w-4" />
              </button>
            </div>
            <SearchField
              label="To"
              room={toRoom}
              active={selectingFor === "to"}
              onActivate={() => {
                setSelectingFor("to");
                setRoomPickTarget("to");
                setMode("indoor");
              }}
              accent="bg-rose-500"
            />
          </div>

          <div>
            <label className="field-label">
              {selectingFor === "from"
                ? "Search starting point"
                : "Search destination"}
            </label>
            <div className="map-editor__search">
              <Search className="h-4 w-4 text-muted" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search rooms or points of interest"
              />
            </div>
            <div className="mt-3 max-h-60 space-y-2 overflow-y-auto">
              {searchLoading ? (
                <div className="rounded-xl border border-default bg-surface px-4 py-3 text-sm subtle-text">
                  Searching available rooms...
                </div>
              ) : searchResults.length === 0 ? (
                <div className="rounded-xl border border-default bg-surface px-4 py-3 text-sm subtle-text">
                  Start typing to search available rooms.
                </div>
              ) : (
                searchResults.map((room) => (
                  <button
                    key={room.id}
                    type="button"
                    onClick={() => selectRoom(room)}
                    className="w-full rounded-xl border border-default bg-surface px-4 py-3 text-left transition-colors hover:bg-surface-alt"
                  >
                    <div className="font-medium text-primary">{room.name}</div>
                    <div className="mt-1 text-sm subtle-text">{room.type}</div>
                  </button>
                ))
              )}
            </div>
          </div>

          {mode === "indoor" && currentFloor && (
            <div>
              <label className="field-label">Current Floor</label>
              <select
                className="select"
                value={currentFloor.id}
                onChange={(event) =>
                  setCurrentFloor(
                    floors.find((floor) => floor.id === event.target.value) ||
                      null,
                  )
                }
              >
                {floors.map((floor) => (
                  <option key={floor.id} value={floor.id}>
                    {floor.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            onClick={getIndoorRoute}
            disabled={!fromRoom || !toRoom || routeLoading}
            className="btn-primary w-full"
          >
            <Navigation className="h-4 w-4" />
            {routeLoading ? "Calculating..." : "Get Directions"}
          </button>

          <div className="rounded-xl border border-default bg-surface px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-primary">Positioning Pilot</div>
                <div className="mt-1 text-xs subtle-text">
                  Sensor fusion combines heading and motion into a live indoor estimate.
                </div>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full bg-surface-alt px-3 py-1 text-[11px] font-medium text-secondary">
                <Wifi className="h-3.5 w-3.5" />
                {currentFloorBeacons.length} beacons
              </div>
            </div>
            <div className="mt-3 grid gap-2">
              <div className="rounded-lg border border-default bg-surface-alt px-3 py-2 text-xs text-secondary">
                Browser BLE: {bluetoothSupported ? "available" : "not available"} • Sensors:{" "}
                {sensorFusion.supported ? "available" : "not available"}
              </div>
              <div className="rounded-lg border border-default bg-surface-alt px-3 py-2 text-xs text-secondary">
                Heading: {sensorFusion.heading !== null ? `${Math.round(sensorFusion.heading)}°` : "--"} • Steps:{" "}
                {sensorFusion.stepCount} • Movement: {sensorFusion.movement}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={enableSensorFusion}
                disabled={!sensorFusion.supported}
                className="btn-secondary px-3"
              >
                <Activity className="h-4 w-4" />
                {sensorFusionEnabled ? "Sensors Active" : "Enable Sensors"}
              </button>
              <button
                type="button"
                onClick={placeBlueDotFromStart}
                disabled={!currentSensorRoomCenter}
                className="btn-secondary px-3"
              >
                <LocateFixed className="h-4 w-4" />
                Set From Start Room
              </button>
              <button
                type="button"
                onClick={snapBlueDotToNearestBeacon}
                disabled={!sensorPosition || !currentFloorBeacons.length}
                className="btn-secondary px-3"
              >
                <Wifi className="h-4 w-4" />
                Snap to Beacon
              </button>
            </div>
          </div>

          {recentSearches.length > 0 && (
            <div>
              <div className="field-label">Recent Searches</div>
              <div className="space-y-2">
                {recentSearches.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-default bg-surface px-4 py-3"
                  >
                    <button
                      type="button"
                      onClick={() => applyRecentSearch(entry)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="truncate text-sm font-medium text-primary">
                        {entry.fromName} to {entry.toName}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => dismissRecentSearch(entry.id)}
                      className="text-muted"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="rounded-xl border border-default bg-surface px-4 py-4">
            <div className="text-sm font-medium text-primary">
              Building entrance
            </div>
            <div className="mt-2 text-sm subtle-text">
              {building?.address || "Entrance details have not been added yet."}
            </div>
          </div>
          <button
            onClick={getUserLocation}
            disabled={locationLoading}
            className="btn-primary w-full"
          >
            <Crosshair className="h-4 w-4" />
            {locationLoading ? "Finding your location..." : "Find My Location"}
          </button>
          {outdoorRouteMessage && (
            <div className="rounded-xl border border-default bg-surface px-4 py-3 text-sm subtle-text">
              {outdoorRouteMessage}
            </div>
          )}
        </>
      )}
    </div>
  );

  return (
    <div className="page-shell relative h-screen overflow-hidden bg-bg">
      <div className="absolute inset-0">
        <NavigationMapRenderer
          provider={rendererResolution.activeProvider}
          mode={mode}
          entranceCenter={entranceCenter}
          building={building}
          floorData={floorData}
          floorImage={floorImage}
          currentFloorPath={currentFloorPath}
          fromRoom={fromRoom}
          toRoom={toRoom}
          currentFloor={currentFloor}
          isDark={isDark}
          currentOverlayBounds={currentOverlayBounds}
          roomPickTarget={roomPickTarget}
          overlayVisible={overlayVisible}
          selectRoom={selectRoom}
          hasGeoAnchor={hasGeoAnchor}
          outdoorFitPoints={outdoorFitPoints}
          outdoorRoute={outdoorRoute}
          userLocation={userLocation}
          viewMode={mode === "indoor" ? indoorViewMode : "2d"}
          sensorPosition={
            sensorPosition?.floorId === currentFloor?.id ? sensorPosition : null
          }
          showBeacons={mode === "indoor"}
        />
      </div>

      {rendererResolution.fallbackReason && (
        <div className="absolute left-1/2 top-4 z-[710] -translate-x-1/2 rounded-md border border-default bg-[color:var(--color-map-overlay)] px-3 py-2 text-xs text-secondary shadow-sm">
          {rendererResolution.fallbackReason}
        </div>
      )}

      {mode === "indoor" && isAdmin && (!entranceCenter || !currentOverlayBounds) && (
        <div className="absolute left-1/2 top-4 z-[710] -translate-x-1/2 rounded-md border border-default bg-[color:var(--color-map-overlay)] px-3 py-2 text-xs text-secondary shadow-sm">
          Add building coordinates and floor overlay bounds in admin settings to enable map overlay.
        </div>
      )}

      <div className="absolute left-4 top-4 z-[700] hidden w-full max-w-[360px] lg:block">
        <div className="map-panel rounded-xl border border-default p-4">
          {panelContent}
        </div>
      </div>

      {routeSummary && (
        <div className="absolute right-4 top-4 z-[700] hidden w-[280px] lg:block">
          <div className="map-panel rounded-xl border border-default p-4">
            <div className="section-label">Route Summary</div>
            <div className="mt-4 grid gap-3">
              <div className="rounded-xl border border-default bg-surface px-4 py-3">
                <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                  Distance
                </div>
                <div className="mt-1 text-2xl font-bold tracking-[-0.02em]">
                  {routeSummary.distance} m
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-default bg-surface px-4 py-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                    Duration
                  </div>
                  <div className="mt-1 text-xl font-bold">
                    {routeSummary.duration} min
                  </div>
                </div>
                <div className="rounded-xl border border-default bg-surface px-4 py-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                    Steps
                  </div>
                  <div className="mt-1 text-xl font-bold">
                    {routeSummary.steps}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {mode === "indoor" && visibleFloors.length > 1 && (
        <div
          className="absolute bottom-5 left-1/2 z-[700] hidden -translate-x-1/2 items-center gap-2 rounded-full bg-[color:var(--color-map-overlay)] px-2 py-2 lg:flex"
          style={{ boxShadow: "var(--shadow-panel)" }}
        >
          {visibleFloors.map((floor) => (
            <button
              key={floor.id}
              onClick={() => setCurrentFloor(floor)}
              className={`map-floor-pill ${
                currentFloor?.id === floor.id ? "is-active" : ""
              }`}
            >
              {floor.name}
            </button>
          ))}
        </div>
      )}

      <div className="fixed bottom-0 left-0 right-0 z-[720] lg:hidden">
        <div
          className={`rounded-t-[20px] border border-default bg-[color:var(--color-map-overlay)] px-4 pb-5 pt-3 shadow-[0_-14px_32px_rgba(15,23,42,0.14)] transition-all ${
            mobileSheetExpanded ? "max-h-[78vh]" : "max-h-[190px]"
          } overflow-hidden`}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <button
            type="button"
            onClick={() => setMobileSheetExpanded((value) => !value)}
            className="block w-full"
          >
            <span className="sheet-handle" />
          </button>
          {panelContent}

          {routeSummary && (
            <div className="mt-4 rounded-xl border border-default bg-surface px-4 py-4">
              <div className="section-label">Route Summary</div>
              <div className="mt-3 grid grid-cols-3 gap-3 text-center">
                <div>
                  <div className="text-xs uppercase tracking-[0.12em] text-muted">
                    Meters
                  </div>
                  <div className="mt-1 text-lg font-bold">
                    {routeSummary.distance}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-[0.12em] text-muted">
                    Minutes
                  </div>
                  <div className="mt-1 text-lg font-bold">
                    {routeSummary.duration}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-[0.12em] text-muted">
                    Steps
                  </div>
                  <div className="mt-1 text-lg font-bold">
                    {routeSummary.steps}
                  </div>
                </div>
              </div>
            </div>
          )}

          {mode === "indoor" && visibleFloors.length > 1 && (
            <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
              {visibleFloors.map((floor) => (
                <button
                  key={floor.id}
                  onClick={() => setCurrentFloor(floor)}
                  className={`map-floor-pill ${
                    currentFloor?.id === floor.id ? "is-active" : ""
                  }`}
                >
                  {floor.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
