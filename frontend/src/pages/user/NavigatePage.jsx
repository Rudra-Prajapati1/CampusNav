import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Search,
  Utensils,
  UserCircle,
  Star,
  DoorOpen,
  ArrowUpDown,
  Navigation,
} from "lucide-react";
import MapLibreNavigationMap from "../../components/navigation/MapLibreNavigationMap.jsx";
import { api } from "../../utils/api.js";

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function extractPois(mapData) {
  const spaces = ensureArray(mapData?.spaces?.features);
  const objects = ensureArray(mapData?.objects?.features);

  return [
    ...spaces.map((feature) => ({
      id: feature.id,
      name: feature.properties?.name || "Room",
      category: feature.properties?.kind || "facility",
      type: "space",
      roomId: feature.id,
    })),
    ...objects.map((feature) => ({
      id: feature.id,
      name: feature.properties?.label || feature.properties?.kind || "POI",
      category: feature.properties?.kind || "facility",
      type: "object",
      roomId: null,
    })),
  ];
}

function routePathForFloor(route, floorId) {
  if (!route?.path) return [];
  return route.path.filter((point) => {
    if (!point.floor_id) return true;
    return point.floor_id === floorId;
  });
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
  onSwap,
  routingMode,
  onStartRouting,
  onEndRouting,
  onRoute,
  loadingRoute,
  mobile,
}) {
  const className = mobile
    ? "absolute bottom-0 left-0 right-0 z-[730] rounded-t-2xl bg-white p-4 shadow-2xl"
    : "absolute left-4 top-4 z-[730] w-[min(380px,92vw)] rounded-2xl bg-white p-4 shadow-lg";

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
                placeholder="Search here..."
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

          <div className="mt-3 max-h-72 space-y-2 overflow-auto">
            {results.map((result) => (
              <button
                key={result.id}
                type="button"
                onClick={() => onSelectResult(result)}
                className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-sm"
              >
                <div className="font-medium text-slate-900">{result.name}</div>
                <div className="text-xs text-slate-500">
                  {result.category || result.type}
                </div>
              </button>
            ))}
            {!results.length && query.trim() && (
              <div className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500">
                No results found.
              </div>
            )}
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
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
              To
            </label>
            <input
              value={toQuery}
              onChange={(event) => onToQuery(event.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
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
              className="flex-1 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white"
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
    </div>
  );
}

export default function NavigatePage() {
  const { buildingId } = useParams();
  const [building, setBuilding] = useState(null);
  const [floors, setFloors] = useState([]);
  const [currentFloorId, setCurrentFloorId] = useState(null);
  const [floorMapData, setFloorMapData] = useState(null);
  const [georeference, setGeoreference] = useState(null);
  const [loading, setLoading] = useState(true);

  const [query, setQuery] = useState("");
  const [routingMode, setRoutingMode] = useState(false);
  const [fromQuery, setFromQuery] = useState("");
  const [toQuery, setToQuery] = useState("");
  const [fromRoom, setFromRoom] = useState(null);
  const [toRoom, setToRoom] = useState(null);
  const [route, setRoute] = useState(null);
  const [routeLoading, setRouteLoading] = useState(false);

  const mobile = window.innerWidth < 768;

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
        setGeoreference(
          payload.georeference || payload.map_data?.georeference || null,
        );
      })
      .catch((error) => console.error(error));

    return () => {
      cancelled = true;
    };
  }, [currentFloorId]);

  const pois = useMemo(() => extractPois(floorMapData || {}), [floorMapData]);

  const filteredResults = useMemo(() => {
    if (!query.trim()) return [];
    const text = query.toLowerCase();
    return pois
      .filter((item) =>
        `${item.name} ${item.category}`.toLowerCase().includes(text),
      )
      .slice(0, 24);
  }, [pois, query]);

  const currentFloorRoute = useMemo(
    () => routePathForFloor(route, currentFloorId),
    [route, currentFloorId],
  );

  async function runRoute() {
    if (!fromRoom || !toRoom) return;
    setRouteLoading(true);
    try {
      const result = await api.navigation.route(
        fromRoom.id,
        toRoom.id,
        buildingId,
      );
      setRoute(result);
    } catch (error) {
      alert(error.message || "Unable to calculate route");
    } finally {
      setRouteLoading(false);
    }
  }

  function selectSearchResult(result) {
    setQuery(result.name || "");
    if (!routingMode) return;

    if (!fromRoom) {
      setFromRoom(result);
      setFromQuery(result.name || "");
      return;
    }

    setToRoom(result);
    setToQuery(result.name || "");
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
        }}
        onPoiDirections={(poi) => {
          setRoutingMode(true);
          if (!fromRoom && pois.length) {
            setFromRoom(pois[0]);
            setFromQuery(pois[0].name || "Start");
          }
          setToRoom({ id: poi.id, name: poi.name });
          setToQuery(poi.name || "");
        }}
        onPoiSelect={() => {}}
        infoAction={() => alert("CampusNav indoor/outdoor 3D navigation")}
      />

      <Panel
        query={query}
        onQuery={setQuery}
        results={filteredResults}
        onSelectResult={selectSearchResult}
        fromQuery={fromQuery}
        toQuery={toQuery}
        onFromQuery={setFromQuery}
        onToQuery={setToQuery}
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
        onStartRouting={() => {
          setRoutingMode(true);
          if (!fromRoom && filteredResults.length) {
            setFromRoom(filteredResults[0]);
            setFromQuery(filteredResults[0].name || "");
          }
        }}
        onEndRouting={() => {
          setRoutingMode(false);
          setRoute(null);
        }}
        onRoute={runRoute}
        loadingRoute={routeLoading}
        mobile={mobile}
      />
    </div>
  );
}
