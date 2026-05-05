import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  Search,
  Utensils,
  UserCircle,
  Star,
  DoorOpen,
  ArrowUpDown,
  Navigation,
} from "lucide-react";
import toast from "react-hot-toast";
import MapLibreNavigationMap from "../../components/navigation/MapLibreNavigationMap.jsx";
import { api } from "../../utils/api.js";

function routePathForFloor(route, floorId) {
  if (!route?.path) return [];
  return route.path.filter((point) => {
    if (!point.floor_id) return true;
    return point.floor_id === floorId;
  });
}

function deriveRouteRoomId(result) {
  if (result?.route_room_id) return result.route_room_id;
  if (
    result?.kind === "room" ||
    result?.entity_kind === "room" ||
    result?.floors
  ) {
    return result.id || null;
  }
  return null;
}

function normalizeSelection(result) {
  if (!result) return null;
  return {
    id: result.id || null,
    name: result.name || "Untitled",
    category:
      result.category ||
      result.type ||
      result.kind ||
      result.entity_kind ||
      "room",
    kind: result.kind || result.entity_kind || result.type || "room",
    type: result.type || result.kind || result.entity_kind || "room",
    floor_id: result.floor_id || result.floors?.id || null,
    floor_name: result.floor_name || result.floors?.name || null,
    route_room_id: deriveRouteRoomId(result),
  };
}

function Panel({
  query,
  onQuery,
  results,
  onSelectResult,
  fromQuery,
  toQuery,
  onFromQuery,
  onToQuery,
  onFromFocus,
  onToFocus,
  onSwap,
  routingMode,
  onStartRouting,
  onEndRouting,
  onRoute,
  loadingRoute,
  mobile,
  searchText,
  searching,
  searchError,
  activeSearchTarget,
}) {
  const className = mobile
    ? "absolute bottom-0 left-0 right-0 z-[730] rounded-t-2xl bg-white p-4 shadow-2xl"
    : "absolute left-4 top-4 z-[730] w-[min(420px,92vw)] rounded-2xl bg-white p-4 shadow-lg";

  const showResults = Boolean(searchText.trim());
  const emptyMessage = routingMode
    ? "No matching rooms or POIs found in this building."
    : "No results found in this building.";

  return (
    <div className={className}>
      {!routingMode ? (
        <>
          <div className="rounded-xl border border-slate-200 px-3 py-2">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-slate-500" />
              <input
                value={query}
                onChange={(event) => onQuery(event.target.value)}
                placeholder="Search rooms, departments, dining..."
                className="w-full bg-transparent text-sm outline-none"
              />
            </div>
          </div>

          <div className="mt-3 grid grid-cols-4 gap-2 text-center text-[11px]">
            <button
              type="button"
              onClick={() => onQuery("dining")}
              className="rounded-xl border border-slate-200 py-2"
            >
              <Utensils className="mx-auto h-4 w-4" />
              Dining
            </button>
            <button
              type="button"
              onClick={() => onQuery("help")}
              className="rounded-xl border border-slate-200 py-2"
            >
              <UserCircle className="mx-auto h-4 w-4" />
              Help
            </button>
            <button
              type="button"
              onClick={() => onQuery("department")}
              className="rounded-xl border border-slate-200 py-2"
            >
              <Star className="mx-auto h-4 w-4" />
              Departments
            </button>
            <button
              type="button"
              onClick={() => onQuery("exit")}
              className="rounded-xl border border-slate-200 py-2"
            >
              <DoorOpen className="mx-auto h-4 w-4" />
              Exits
            </button>
          </div>

          <button
            type="button"
            onClick={onStartRouting}
            className="mt-3 w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white"
          >
            Start routing
          </button>
        </>
      ) : (
        <>
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
              From
            </label>
            <input
              value={fromQuery}
              onChange={(event) => onFromQuery(event.target.value)}
              onFocus={onFromFocus}
              placeholder="Choose a starting room"
              className={`w-full rounded-md border px-3 py-2 text-sm ${
                activeSearchTarget === "from"
                  ? "border-blue-500 ring-2 ring-blue-100"
                  : "border-slate-300"
              }`}
            />
            <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
              To
            </label>
            <input
              value={toQuery}
              onChange={(event) => onToQuery(event.target.value)}
              onFocus={onToFocus}
              placeholder="Choose a destination"
              className={`w-full rounded-md border px-3 py-2 text-sm ${
                activeSearchTarget === "to"
                  ? "border-blue-500 ring-2 ring-blue-100"
                  : "border-slate-300"
              }`}
            />
          </div>

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={onSwap}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <ArrowUpDown className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onRoute}
              disabled={loadingRoute}
              className="flex-1 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-70"
            >
              <Navigation className="mr-1 inline h-4 w-4" />
              {loadingRoute ? "Routing..." : "Get Directions"}
            </button>
            <button
              type="button"
              onClick={onEndRouting}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              End
            </button>
          </div>
        </>
      )}

      {showResults && (
        <div className="mt-3 max-h-72 space-y-2 overflow-auto">
          {searching && (
            <div className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500">
              Searching the building...
            </div>
          )}

          {!searching &&
            results.map((result) => {
              const disabled = routingMode && !result.route_room_id;

              return (
                <button
                  key={result.id}
                  type="button"
                  onClick={() => onSelectResult(result)}
                  disabled={disabled}
                  className={`block w-full rounded-lg border px-3 py-2 text-left text-sm ${
                    disabled
                      ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400"
                      : "border-slate-200"
                  }`}
                >
                  <div className="font-medium text-slate-900">{result.name}</div>
                  <div className="text-xs text-slate-500">
                    {[result.category || result.type, result.floor_name]
                      .filter(Boolean)
                      .join(" • ")}
                  </div>
                  {disabled && (
                    <div className="mt-1 text-[11px] text-slate-400">
                      Directions unavailable for this POI.
                    </div>
                  )}
                </button>
              );
            })}

          {!searching && searchError && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {searchError}
            </div>
          )}

          {!searching && !searchError && !results.length && (
            <div className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500">
              {emptyMessage}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function NavigatePage() {
  const { buildingId } = useParams();
  const [searchParams] = useSearchParams();
  const [building, setBuilding] = useState(null);
  const [floors, setFloors] = useState([]);
  const [currentFloorId, setCurrentFloorId] = useState(null);
  const [floorMapData, setFloorMapData] = useState(null);
  const [georeference, setGeoreference] = useState(null);
  const [loading, setLoading] = useState(true);

  const [query, setQuery] = useState("");
  const [routingMode, setRoutingMode] = useState(false);
  const [activeSearchTarget, setActiveSearchTarget] = useState("browse");
  const [fromQuery, setFromQuery] = useState("");
  const [toQuery, setToQuery] = useState("");
  const [fromRoom, setFromRoom] = useState(null);
  const [toRoom, setToRoom] = useState(null);
  const [route, setRoute] = useState(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < 768 : false,
  );
  const [pendingAutoRoute, setPendingAutoRoute] = useState(false);

  const deeplinkFromId = searchParams.get("from");

  useEffect(() => {
    function handleResize() {
      setIsMobile(window.innerWidth < 768);
    }

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const [buildingData, floorsData] = await Promise.all([
          api.buildings.get(buildingId),
          api.floors.byBuilding(buildingId),
        ]);
        if (cancelled) return;

        const orderedFloors = [...(floorsData || [])].sort(
          (a, b) => Number(b.level || 0) - Number(a.level || 0),
        );

        setBuilding(buildingData);
        setFloors(orderedFloors);
        setCurrentFloorId((current) => current || orderedFloors[0]?.id || null);
      } catch (error) {
        console.error(error);
        toast.error(error.message || "Unable to load navigation data.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [buildingId]);

  useEffect(() => {
    if (!currentFloorId) return;
    let cancelled = false;

    api.floors
      .getMapData(currentFloorId)
      .then((payload) => {
        if (cancelled) return;
        setFloorMapData(payload.map_data || null);
        setGeoreference(payload.georeference || null);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error(error);
        toast.error(error.message || "Unable to load floor map.");
        setFloorMapData(null);
        setGeoreference(null);
      });

    return () => {
      cancelled = true;
    };
  }, [currentFloorId]);

  useEffect(() => {
    if (!deeplinkFromId) return;
    let cancelled = false;

    async function loadDeeplinkRoom() {
      try {
        const room = await api.rooms.get(deeplinkFromId);
        if (cancelled) return;
        const selection = normalizeSelection(room);
        if (!selection?.route_room_id) {
          toast.error("That QR code does not point to a routable room.");
          return;
        }
        setRoutingMode(true);
        setActiveSearchTarget("to");
        setFromRoom(selection);
        setFromQuery(selection.name);
        if (selection.floor_id) {
          setCurrentFloorId(selection.floor_id);
        }
        setPendingAutoRoute(Boolean(toRoom?.route_room_id));
      } catch (error) {
        if (cancelled) return;
        console.error(error);
        toast.error(error.message || "Unable to load the QR starting point.");
      }
    }

    loadDeeplinkRoom();

    return () => {
      cancelled = true;
    };
  }, [deeplinkFromId]);

  const searchText = useMemo(() => {
    if (!routingMode) return query;
    if (activeSearchTarget === "from") return fromQuery;
    if (activeSearchTarget === "to") return toQuery;
    return "";
  }, [activeSearchTarget, fromQuery, query, routingMode, toQuery]);

  useEffect(() => {
    const trimmed = searchText.trim();
    if (!trimmed) {
      setSearchLoading(false);
      setSearchError("");
      setSearchResults([]);
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      setSearchLoading(true);
      setSearchError("");
      try {
        const results = await api.rooms.search(buildingId, trimmed);
        if (cancelled) return;
        setSearchResults((results || []).map(normalizeSelection).filter(Boolean));
      } catch (error) {
        if (cancelled) return;
        console.error(error);
        setSearchResults([]);
        setSearchError(error.message || "Unable to search this building right now.");
      } finally {
        if (!cancelled) setSearchLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [buildingId, searchText]);

  useEffect(() => {
    if (!pendingAutoRoute || !fromRoom?.route_room_id || !toRoom?.route_room_id) {
      return;
    }

    setPendingAutoRoute(false);
    void runRoute();
  }, [fromRoom, pendingAutoRoute, toRoom]);

  const currentFloorRoute = useMemo(
    () => routePathForFloor(route, currentFloorId),
    [route, currentFloorId],
  );

  async function runRoute() {
    if (!fromRoom?.route_room_id || !toRoom?.route_room_id) {
      toast("Choose both a start and destination before routing.");
      return;
    }

    if (fromRoom.route_room_id === toRoom.route_room_id) {
      toast("Start and destination are the same room.");
      return;
    }

    setRouteLoading(true);
    try {
      const result = await api.navigation.route(
        fromRoom.route_room_id,
        toRoom.route_room_id,
        buildingId,
      );
      setRoute(result);
    } catch (error) {
      toast.error(error.message || "Unable to calculate route.");
    } finally {
      setRouteLoading(false);
    }
  }

  function selectSearchResult(result) {
    const selection = normalizeSelection(result);
    if (!selection?.route_room_id) {
      toast("Directions are not available for this POI yet.");
      return;
    }

    setRoute(null);

    if (!routingMode) {
      setQuery(selection.name || "");
      setRoutingMode(true);
      setActiveSearchTarget(fromRoom?.route_room_id ? "to" : "from");
      setToRoom(selection);
      setToQuery(selection.name || "");
      if (selection.floor_id) {
        setCurrentFloorId(selection.floor_id);
      }
      return;
    }

    if (activeSearchTarget === "from") {
      setFromRoom(selection);
      setFromQuery(selection.name || "");
    } else {
      setToRoom(selection);
      setToQuery(selection.name || "");
    }

    if (selection.floor_id) {
      setCurrentFloorId(selection.floor_id);
    }
  }

  function startRouting() {
    setRoutingMode(true);
    setRoute(null);
    setActiveSearchTarget(fromRoom?.route_room_id ? "to" : "from");
  }

  function endRouting() {
    setRoutingMode(false);
    setActiveSearchTarget("browse");
    setRoute(null);
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg text-sm text-secondary">
        Loading navigation...
      </div>
    );
  }

  return (
    <div className="relative h-screen w-full overflow-hidden bg-bg">
      <MapLibreNavigationMap
        building={building}
        floors={floors}
        currentFloorId={currentFloorId}
        onFloorSelect={setCurrentFloorId}
        mapData={floorMapData}
        georeference={georeference}
        routePath={currentFloorRoute}
        destinationLabel={toRoom?.name || toQuery}
        routeDistanceMeters={route?.distance}
        routeEtaMinutes={route?.estimated_time || route?.duration}
        onExitBuilding={() => {
          setRoute(null);
          setRoutingMode(false);
          setActiveSearchTarget("browse");
        }}
        onPoiDirections={(poi) => {
          const selection = normalizeSelection(poi);
          if (!selection?.route_room_id) {
            toast("Directions are not available for this POI yet.");
            return;
          }

          setRoutingMode(true);
          setRoute(null);
          setToRoom(selection);
          setToQuery(selection.name || "");

          if (!fromRoom?.route_room_id) {
            setActiveSearchTarget("from");
            toast("Choose your starting room to get directions.");
          } else {
            setActiveSearchTarget("to");
          }
        }}
        onPoiSelect={() => {}}
        infoAction={() => toast("CampusNav indoor/outdoor 3D navigation")}
      />

      <Panel
        query={query}
        onQuery={(value) => {
          setActiveSearchTarget("browse");
          setQuery(value);
        }}
        results={searchResults}
        onSelectResult={selectSearchResult}
        fromQuery={fromQuery}
        toQuery={toQuery}
        onFromQuery={(value) => {
          setActiveSearchTarget("from");
          setFromQuery(value);
          setFromRoom(null);
          setRoute(null);
        }}
        onToQuery={(value) => {
          setActiveSearchTarget("to");
          setToQuery(value);
          setToRoom(null);
          setRoute(null);
        }}
        onFromFocus={() => setActiveSearchTarget("from")}
        onToFocus={() => setActiveSearchTarget("to")}
        onSwap={() => {
          const oldFrom = fromRoom;
          const oldFromText = fromQuery;
          setFromRoom(toRoom);
          setFromQuery(toQuery);
          setToRoom(oldFrom);
          setToQuery(oldFromText);
          setRoute(null);
        }}
        routingMode={routingMode}
        onStartRouting={startRouting}
        onEndRouting={endRouting}
        onRoute={runRoute}
        loadingRoute={routeLoading}
        mobile={isMobile}
        searchText={searchText}
        searching={searchLoading}
        searchError={searchError}
        activeSearchTarget={activeSearchTarget}
      />
    </div>
  );
}
