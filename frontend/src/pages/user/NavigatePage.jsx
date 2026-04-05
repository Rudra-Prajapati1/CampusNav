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
  ArrowUpDown,
  Compass,
  Crosshair,
  Moon,
  Navigation,
  Search,
  Sun,
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

function SearchField({
  label,
  room,
  active,
  accent,
  query,
  loading = false,
  results = [],
  mapPicking = false,
  onFocus,
  onQueryChange,
  onPickOnMap,
  onSelectRoom,
}) {
  return (
    <div
      className={`rounded-xl border px-4 py-4 transition-colors ${
        active ? "border-accent bg-accent-light" : "border-default bg-surface"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className={`h-2.5 w-2.5 rounded-full ${accent}`} />
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
            {label}
          </span>
        </div>
        <button
          type="button"
          onClick={onPickOnMap}
          className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${
            mapPicking
              ? "border-accent bg-accent text-white"
              : "border-default bg-surface-alt text-secondary"
          }`}
        >
          Pick on map
        </button>
      </div>

      <div className="map-editor__search mt-3">
        <Search className="h-4 w-4 text-muted" />
        <input
          value={query}
          onFocus={onFocus}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={`Type a ${label.toLowerCase()} room or POI`}
        />
      </div>

      <div className="mt-2 text-xs subtle-text">
        {mapPicking
          ? "Click directly on the map to choose this location."
          : room?.type || "Search by room name or point of interest"}
      </div>

      {active && (query.trim() || loading) && (
        <div className="mt-3 max-h-52 space-y-2 overflow-y-auto">
          {loading ? (
            <div className="rounded-xl border border-default bg-surface px-4 py-3 text-sm subtle-text">
              Searching available rooms...
            </div>
          ) : results.length === 0 ? (
            <div className="rounded-xl border border-default bg-surface px-4 py-3 text-sm subtle-text">
              No matching rooms found yet.
            </div>
          ) : (
            results.map((result) => (
              <button
                key={result.id}
                type="button"
                onClick={() => onSelectRoom(result)}
                className="w-full rounded-xl border border-default bg-surface px-4 py-3 text-left transition-colors hover:bg-surface-alt"
              >
                <div className="font-medium text-primary">{result.name}</div>
                <div className="mt-1 text-sm subtle-text">{result.type}</div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function NavigatePage() {
  const navigate = useNavigate();
  const { buildingId } = useParams();
  const [searchParams] = useSearchParams();
  const fromRoomId = searchParams.get("from");
  const { isDark, toggleTheme } = useTheme();
  const isAdmin = useAuthStore((store) => store.isAdmin);
  const [sensorFusionEnabled] = useState(true);
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
  const [fromQuery, setFromQuery] = useState("");
  const [toQuery, setToQuery] = useState("");
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
  const [mobileSheetExpanded, setMobileSheetExpanded] = useState(false);
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [indoorViewMode, setIndoorViewMode] = useState("3d");
  const [sensorPosition, setSensorPosition] = useState(null);
  const dragStartRef = useRef(null);
  const lastStepCountRef = useRef(0);

  const activeSearchQuery = selectingFor === "from" ? fromQuery : toQuery;
  const deferredSearchQuery = useDeferredValue(activeSearchQuery.trim());
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
    if (!fromRoomId) return;

    api.rooms
      .get(fromRoomId)
      .then((room) => {
        setFromRoom(room);
        setFromQuery(room.name || "");
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
    if (!sensorFusion.supported) return undefined;
    if (!sensorFusion.permissionNeeded || sensorFusion.permissionGranted) return undefined;

    const requestOnFirstInteraction = () => {
      sensorFusion.requestPermission().catch(() => {});
      window.removeEventListener("pointerdown", requestOnFirstInteraction);
    };

    window.addEventListener("pointerdown", requestOnFirstInteraction, { once: true });
    return () => window.removeEventListener("pointerdown", requestOnFirstInteraction);
  }, [
    sensorFusion.permissionGranted,
    sensorFusion.permissionNeeded,
    sensorFusion.requestPermission,
    sensorFusion.supported,
  ]);

  const currentSensorRoomCenter = useMemo(() => {
    if (!fromRoom || fromRoom.floor_id !== currentFloor?.id) return null;
    const room = indoorMap.rooms.find((entry) => entry.id === fromRoom.id) || fromRoom;
    return roomCenter(room);
  }, [currentFloor?.id, fromRoom, indoorMap.rooms]);

  useEffect(() => {
    if (!currentSensorRoomCenter || !currentFloor?.id) return;
    setSensorPosition((current) => {
      if (
        current?.floorId === currentFloor.id &&
        current.source !== "start-room" &&
        current.roomId === fromRoom?.id
      ) {
        return current;
      }
      return {
        floorId: currentFloor.id,
        x: currentSensorRoomCenter.x,
        y: currentSensorRoomCenter.y,
        source: "start-room",
        roomId: fromRoom?.id || null,
      };
    });
    lastStepCountRef.current = sensorFusion.stepCount;
  }, [currentFloor?.id, currentSensorRoomCenter, fromRoom?.id, sensorFusion.stepCount]);

  useEffect(() => {
    if (!sensorPosition || !currentFloorBeacons.length) return;
    const nearest = [...currentFloorBeacons].sort((left, right) => {
      const leftDistance = Math.hypot(left.x - sensorPosition.x, left.y - sensorPosition.y);
      const rightDistance = Math.hypot(right.x - sensorPosition.x, right.y - sensorPosition.y);
      return leftDistance - rightDistance;
    })[0];

    if (!nearest) return;
    const distance = Math.hypot(nearest.x - sensorPosition.x, nearest.y - sensorPosition.y);
    if (distance > Math.max(48, (nearest.radiusMeters || 2.5) * 24)) return;

    setSensorPosition((current) =>
      current
        ? {
            ...current,
            floorId: currentFloor?.id,
            x: nearest.x,
            y: nearest.y,
            source: "beacon-snap",
          }
        : current,
    );
  }, [currentFloor?.id, currentFloorBeacons, sensorPosition]);

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

  const currentInstruction = useMemo(() => {
    const instructions = indoorRoute?.instructions || [];
    if (!instructions.length) return null;
    return (
      instructions.find((instruction) => instruction.floor_id === currentFloor?.id) ||
      instructions[0]
    );
  }, [currentFloor?.id, indoorRoute?.instructions]);

  const selectRoom = useCallback(
    (room) => {
      const target = roomPickTarget || selectingFor;
      if (target === "from") {
        setFromRoom(room);
        setFromQuery(room.name || "");
      } else {
        setToRoom(room);
        setToQuery(room.name || "");
      }
      setSelectingFor(target);
      setRoomPickTarget(null);
      setSearchResults([]);
      setIndoorRoute(null);
      setMode("indoor");
      setMobileSheetExpanded(true);
    },
    [roomPickTarget, selectingFor],
  );

  const getUserLocation = useCallback(() => {
    if (!navigator.geolocation) {
      window.alert("Geolocation is not supported by this browser.");
      return;
    }

    setMode("outdoor");
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
    } catch (error) {
      window.alert(error.message || "Unable to calculate route.");
    } finally {
      setRouteLoading(false);
    }
  }, [buildingId, floors, fromRoom, toRoom]);

  const handleSwapRooms = () => {
    setFromRoom(toRoom);
    setToRoom(fromRoom);
    setFromQuery(toRoom?.name || "");
    setToQuery(fromRoom?.name || "");
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
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto pr-1">
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

      <div className="rounded-xl border border-default bg-surface px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-primary">Unified Map View</div>
            <div className="mt-1 text-xs subtle-text">
              Outdoor map stays live. Indoor layers appear as you zoom into mapped buildings.
            </div>
          </div>
          <span className="badge-neutral">{mode === "indoor" ? "Indoor focus" : "Outdoor focus"}</span>
        </div>
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

      <>
        <div className="rounded-xl border border-default bg-surface px-4 py-4">
          <div className="text-sm font-medium text-primary">
            Building entrance
          </div>
          <div className="mt-2 text-sm subtle-text">
            {building?.address || "Entrance details have not been added yet."}
          </div>
          <div className="mt-3">
            <button
              onClick={getUserLocation}
              disabled={locationLoading}
              className="btn-primary w-full"
            >
              <Crosshair className="h-4 w-4" />
              {locationLoading ? "Finding your location..." : "Find My Location"}
            </button>
          </div>
          {outdoorRouteMessage && (
            <div className="mt-3 rounded-xl border border-default bg-surface-alt px-4 py-3 text-sm subtle-text">
              {outdoorRouteMessage}
            </div>
          )}
        </div>

        <>
          <div className="space-y-3">
            <SearchField
              label="From"
              room={fromRoom}
              active={selectingFor === "from"}
              query={fromQuery}
              loading={selectingFor === "from" && searchLoading}
              results={selectingFor === "from" ? searchResults : []}
              mapPicking={roomPickTarget === "from"}
              onFocus={() => {
                setSelectingFor("from");
                setRoomPickTarget(null);
                setMode("indoor");
              }}
              onQueryChange={(value) => {
                setSelectingFor("from");
                setFromQuery(value);
                if (!value.trim()) setFromRoom(null);
              }}
              onPickOnMap={() => {
                setSelectingFor("from");
                setRoomPickTarget("from");
                setMode("indoor");
              }}
              onSelectRoom={selectRoom}
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
              query={toQuery}
              loading={selectingFor === "to" && searchLoading}
              results={selectingFor === "to" ? searchResults : []}
              mapPicking={roomPickTarget === "to"}
              onFocus={() => {
                setSelectingFor("to");
                setRoomPickTarget(null);
                setMode("indoor");
              }}
              onQueryChange={(value) => {
                setSelectingFor("to");
                setToQuery(value);
                if (!value.trim()) setToRoom(null);
              }}
              onPickOnMap={() => {
                setSelectingFor("to");
                setRoomPickTarget("to");
                setMode("indoor");
              }}
              onSelectRoom={selectRoom}
              accent="bg-rose-500"
            />
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
        </>
      </>
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

      {currentInstruction && (
        <div className="absolute left-1/2 top-4 z-[705] w-[min(90vw,560px)] -translate-x-1/2">
          <div className="map-panel rounded-2xl border border-default px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
              Live Navigation
            </div>
            <div className="mt-1 text-sm font-medium text-primary">
              {currentInstruction.text || "Follow the highlighted route"}
            </div>
          </div>
        </div>
      )}

      <div className="absolute left-4 top-4 z-[700] hidden w-full max-w-[380px] lg:block">
        <div className="map-panel h-[calc(100vh-2rem)] overflow-hidden rounded-xl border border-default p-4">
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
          <div className="max-h-[calc(78vh-3rem)] overflow-y-auto">
            {panelContent}
          </div>

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
