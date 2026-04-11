import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  ArrowLeft,
  Check,
  MapPin,
  Move,
  RotateCw,
  Sparkles,
} from "lucide-react";
import toast from "react-hot-toast";
import { MAPLIBRE_STYLE } from "../../components/navigation/mapProviderConfig.js";
import { api } from "../../utils/api.js";

const SOURCE_ID = "campusnav-world-position-floor";
const LAYER_ID = "campusnav-world-position-floor-layer";
const INTRO_KEY = "campusnav-hide-world-position-intro";
const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY || "";
const WORLD_POSITION_STYLES = {
  streets: MAPLIBRE_STYLE,
  satellite: MAPTILER_KEY
    ? `https://api.maptiler.com/maps/satellite/style.json?key=${MAPTILER_KEY}`
    : null,
};

function toNumber(value, fallback = 0) {
  const parsed =
    typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function defaultCornersFromEntrance(entranceCenter) {
  const [lat, lng] = entranceCenter || [23.0225, 72.5714];
  const latDelta = 0.00008;
  const lngDelta = 0.00012;

  return [
    { id: "nw", lat: lat + latDelta, lng: lng - lngDelta, label: "NW" },
    { id: "ne", lat: lat + latDelta, lng: lng + lngDelta, label: "NE" },
    { id: "se", lat: lat - latDelta, lng: lng + lngDelta, label: "SE" },
    { id: "sw", lat: lat - latDelta, lng: lng - lngDelta, label: "SW" },
  ];
}

function normalizeCorners(corners, entranceCenter) {
  if (!Array.isArray(corners) || corners.length < 4) {
    return defaultCornersFromEntrance(entranceCenter);
  }

  const normalized = corners
    .map((corner, index) => ({
      id: corner.id || ["nw", "ne", "se", "sw"][index] || `corner-${index + 1}`,
      lat: toNumber(corner.lat, NaN),
      lng: toNumber(corner.lng, NaN),
      label: corner.label || ["NW", "NE", "SE", "SW"][index] || null,
    }))
    .filter((corner) => Number.isFinite(corner.lat) && Number.isFinite(corner.lng));

  return normalized.length >= 4
    ? normalized.slice(0, 4)
    : defaultCornersFromEntrance(entranceCenter);
}

function orderedCorners(corners) {
  const byId = new Map(corners.map((corner) => [corner.id, corner]));
  const ordered = ["nw", "ne", "se", "sw"]
    .map((id) => byId.get(id))
    .filter(Boolean);
  return ordered.length === 4 ? ordered : corners.slice(0, 4);
}

function centroid(corners) {
  if (!corners?.length) return { lat: 0, lng: 0 };
  const total = corners.reduce(
    (sum, corner) => ({
      lat: sum.lat + corner.lat,
      lng: sum.lng + corner.lng,
    }),
    { lat: 0, lng: 0 },
  );
  return {
    lat: total.lat / corners.length,
    lng: total.lng / corners.length,
  };
}

function translateCorners(corners, deltaLat, deltaLng) {
  return corners.map((corner) => ({
    ...corner,
    lat: corner.lat + deltaLat,
    lng: corner.lng + deltaLng,
  }));
}

function rotateCorners(corners, degrees) {
  const center = centroid(corners);
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  return corners.map((corner) => {
    const dx = corner.lng - center.lng;
    const dy = corner.lat - center.lat;
    return {
      ...corner,
      lng: center.lng + dx * cos - dy * sin,
      lat: center.lat + dx * sin + dy * cos,
    };
  });
}

function cornerCoordinates(corners) {
  return orderedCorners(corners).map((corner) => [corner.lng, corner.lat]);
}

function overlayBounds(corners) {
  const lats = corners.map((corner) => corner.lat);
  const lngs = corners.map((corner) => corner.lng);
  return {
    north: Math.max(...lats),
    south: Math.min(...lats),
    east: Math.max(...lngs),
    west: Math.min(...lngs),
  };
}

function projectedCenter(map, corners) {
  const center = centroid(corners);
  return map.project([center.lng, center.lat]);
}

function solveLinear3(matrix, vector) {
  const augmented = matrix.map((row, index) => [...row, vector[index]]);

  for (let pivot = 0; pivot < 3; pivot += 1) {
    let maxRow = pivot;
    for (let row = pivot + 1; row < 3; row += 1) {
      if (Math.abs(augmented[row][pivot]) > Math.abs(augmented[maxRow][pivot])) {
        maxRow = row;
      }
    }

    if (Math.abs(augmented[maxRow][pivot]) < 1e-10) {
      return null;
    }

    if (maxRow !== pivot) {
      [augmented[pivot], augmented[maxRow]] = [augmented[maxRow], augmented[pivot]];
    }

    const divisor = augmented[pivot][pivot];
    for (let col = pivot; col < 4; col += 1) {
      augmented[pivot][col] /= divisor;
    }

    for (let row = 0; row < 3; row += 1) {
      if (row === pivot) continue;
      const factor = augmented[row][pivot];
      for (let col = pivot; col < 4; col += 1) {
        augmented[row][col] -= factor * augmented[pivot][col];
      }
    }
  }

  return augmented.map((row) => row[3]);
}

function solveLeastSquaresAffine(samples, accessor) {
  if (!Array.isArray(samples) || samples.length < 3) return null;

  const sums = {
    uu: 0,
    uv: 0,
    vv: 0,
    u: 0,
    v: 0,
    n: 0,
    ub: 0,
    vb: 0,
    b: 0,
  };

  samples.forEach((sample) => {
    const u = toNumber(sample.imagePoint?.u, NaN);
    const v = toNumber(sample.imagePoint?.v, NaN);
    const b = toNumber(accessor(sample), NaN);
    if (!Number.isFinite(u) || !Number.isFinite(v) || !Number.isFinite(b)) return;
    sums.uu += u * u;
    sums.uv += u * v;
    sums.vv += v * v;
    sums.u += u;
    sums.v += v;
    sums.n += 1;
    sums.ub += u * b;
    sums.vb += v * b;
    sums.b += b;
  });

  if (sums.n < 3) return null;

  return solveLinear3(
    [
      [sums.uu, sums.uv, sums.u],
      [sums.uv, sums.vv, sums.v],
      [sums.u, sums.v, sums.n],
    ],
    [sums.ub, sums.vb, sums.b],
  );
}

function applyAffine(coefficients, u, v) {
  if (!coefficients) return null;
  return coefficients[0] * u + coefficients[1] * v + coefficients[2];
}

function imagePointFromScreen(corners, map, clientX, clientY, containerRect) {
  const ordered = orderedCorners(corners);
  if (ordered.length < 4) return null;

  const projected = ordered.map((corner) => {
    const point = map.project([corner.lng, corner.lat]);
    return {
      x: point.x,
      y: point.y,
    };
  });

  const localX = clientX - containerRect.left;
  const localY = clientY - containerRect.top;
  const solve = solveLinear3(
    [
      [projected[0].x, projected[1].x - projected[0].x, projected[3].x - projected[0].x],
      [projected[0].y, projected[1].y - projected[0].y, projected[3].y - projected[0].y],
      [1, 0, 0],
    ],
    [localX, localY, 1],
  );

  if (!solve) return null;

  return {
    u: Math.max(0, Math.min(1, solve[1])),
    v: Math.max(0, Math.min(1, solve[2])),
  };
}

function bilinearInterpolate(corners, imagePoint) {
  const lookup = Object.fromEntries(corners.map((corner) => [corner.id, corner]));
  const nw = lookup.nw || corners[0];
  const ne = lookup.ne || corners[1];
  const se = lookup.se || corners[2];
  const sw = lookup.sw || corners[3];
  const u = imagePoint.u;
  const v = imagePoint.v;

  return {
    lat:
      nw.lat * (1 - u) * (1 - v) +
      ne.lat * u * (1 - v) +
      se.lat * u * v +
      sw.lat * (1 - u) * v,
    lng:
      nw.lng * (1 - u) * (1 - v) +
      ne.lng * u * (1 - v) +
      se.lng * u * v +
      sw.lng * (1 - u) * v,
  };
}

function applyPinFit(corners, controlPoints) {
  const latCoefficients = solveLeastSquaresAffine(
    controlPoints,
    (sample) => sample.worldPoint?.lat,
  );
  const lngCoefficients = solveLeastSquaresAffine(
    controlPoints,
    (sample) => sample.worldPoint?.lng,
  );

  if (!latCoefficients || !lngCoefficients) {
    return corners;
  }

  const nextCorners = [
    { id: "nw", label: "NW", u: 0, v: 0 },
    { id: "ne", label: "NE", u: 1, v: 0 },
    { id: "se", label: "SE", u: 1, v: 1 },
    { id: "sw", label: "SW", u: 0, v: 1 },
  ].map((corner) => ({
    id: corner.id,
    label: corner.label,
    lat: applyAffine(latCoefficients, corner.u, corner.v),
    lng: applyAffine(lngCoefficients, corner.u, corner.v),
  }));

  if (nextCorners.some((corner) => !Number.isFinite(corner.lat) || !Number.isFinite(corner.lng))) {
    return corners;
  }

  return nextCorners;
}

function IntroModal({ hideAgain, onHideAgainChange, onStart }) {
  return (
    <div className="fixed inset-0 z-[850] flex items-center justify-center bg-slate-950/40 px-6">
      <div className="card max-w-2xl">
        <div className="flex items-start gap-4">
          <div className="icon-chip h-12 w-12 shrink-0">
            <MapPin className="h-5 w-5" />
          </div>
          <div>
            <div className="section-label">World Position</div>
            <h2 className="mt-2 text-3xl font-bold tracking-[-0.03em]">
              Position your building on the world
            </h2>
            <p className="mt-4 text-sm subtle-text">
              Place your floor plan on the world by matching it to the outdoor
              footprint. This keeps the scale accurate and lets your indoor map
              appear in the right outdoor context.
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <label className="inline-flex items-center gap-2 text-sm text-secondary">
            <input
              type="checkbox"
              checked={hideAgain}
              onChange={(event) => onHideAgainChange(event.target.checked)}
            />
            Don&apos;t show again
          </label>
          <button type="button" onClick={onStart} className="btn-primary">
            Start World Position
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminFloorGeoreference() {
  const navigate = useNavigate();
  const { buildingId, floorId } = useParams();
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const dragRef = useRef(null);
  const hasFittedRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [building, setBuilding] = useState(null);
  const [floor, setFloor] = useState(null);
  const [floors, setFloors] = useState([]);
  const [corners, setCorners] = useState([]);
  const [opacity, setOpacity] = useState(0.55);
  const [address, setAddress] = useState("");
  const [levelId, setLevelId] = useState(floorId);
  const [pinMode, setPinMode] = useState(false);
  const [missingFootprintOpen, setMissingFootprintOpen] = useState(false);
  const [controlPoints, setControlPoints] = useState([]);
  const [pendingImagePoint, setPendingImagePoint] = useState(null);
  const [basemapStyle, setBasemapStyle] = useState("streets");
  const [hideIntro, setHideIntro] = useState(
    () => window.localStorage.getItem(INTRO_KEY) !== "1",
  );
  const [showIntro, setShowIntro] = useState(
    () => window.localStorage.getItem(INTRO_KEY) !== "1",
  );

  useEffect(() => {
    hasFittedRef.current = false;
  }, [basemapStyle]);

  const entranceCenter = useMemo(() => {
    const lat = Number.parseFloat(building?.entrance_lat);
    const lng = Number.parseFloat(building?.entrance_lng);
    return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
  }, [building?.entrance_lat, building?.entrance_lng]);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setLoading(true);
      try {
        const [buildingData, floorData, buildingFloors] = await Promise.all([
          api.buildings.get(buildingId),
          api.floors.get(floorId),
          api.floors.byBuilding(buildingId),
        ]);

        if (cancelled) return;

        const existing = floorData?.map_data?.georeference;
        const normalized = normalizeCorners(
          existing?.corners ||
            floorData?.map_data?.floors?.find((entry) => entry.id === floorData.id)?.corners,
          [
            Number.parseFloat(buildingData?.entrance_lat) || 23.0225,
            Number.parseFloat(buildingData?.entrance_lng) || 72.5714,
          ],
        );

        setBuilding(buildingData);
        setFloor(floorData);
        setFloors(buildingFloors || []);
        setAddress(existing?.address || buildingData?.address || "");
        setLevelId(
          (buildingFloors || []).find((entry) => entry.name === existing?.level)?.id ||
            floorData.id,
        );
        setOpacity(toNumber(existing?.opacity, 0.55));
        setControlPoints(existing?.controlPoints || []);
        setCorners(normalized);
        hasFittedRef.current = false;
      } catch (error) {
        toast.error(error.message || "Unable to load world positioning.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadData();
    return () => {
      cancelled = true;
    };
  }, [buildingId, floorId]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current || loading) return undefined;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: WORLD_POSITION_STYLES[basemapStyle] || MAPLIBRE_STYLE,
      center: entranceCenter ? [entranceCenter[1], entranceCenter[0]] : [72.5714, 23.0225],
      zoom: entranceCenter ? 18 : 15,
      pitch: 0,
      bearing: 0,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    });

    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");

    map.on("load", () => {
      map.touchZoomRotate?.disableRotation?.();
      map.setPitch(0);
      map.setBearing(0);
      setMapReady(true);
    });

    const lockFlatView = () => {
      if (map.getPitch() !== 0) map.setPitch(0);
      if (map.getBearing() !== 0) map.setBearing(0);
    };
    map.on("rotate", lockFlatView);
    map.on("pitch", lockFlatView);

    mapRef.current = map;

    return () => {
      setMapReady(false);
      map.off("rotate", lockFlatView);
      map.off("pitch", lockFlatView);
      map.remove();
      mapRef.current = null;
    };
  }, [basemapStyle, entranceCenter, loading]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return undefined;

    const handleMapClick = (event) => {
      if (!pinMode || !pendingImagePoint) return;
      setControlPoints((current) => [
        ...current,
        {
          id: `pin-${current.length + 1}`,
          imagePoint: pendingImagePoint,
          worldPoint: { lat: event.lngLat.lat, lng: event.lngLat.lng },
        },
      ]);
      setPendingImagePoint(null);
    };

    map.on("click", handleMapClick);
    return () => {
      map.off("click", handleMapClick);
    };
  }, [mapReady, pendingImagePoint, pinMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !floor?.floor_plan_url || corners.length < 4) return;

    const coords = cornerCoordinates(corners);
    const existingSource = map.getSource(SOURCE_ID);

    if (existingSource?.updateImage) {
      existingSource.updateImage({ url: floor.floor_plan_url, coordinates: coords });
    } else {
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      map.addSource(SOURCE_ID, {
        type: "image",
        url: floor.floor_plan_url,
        coordinates: coords,
      });
    }

    if (!map.getLayer(LAYER_ID)) {
      map.addLayer({
        id: LAYER_ID,
        type: "raster",
        source: SOURCE_ID,
        paint: { "raster-opacity": opacity },
      });
    } else {
      map.setPaintProperty(LAYER_ID, "raster-opacity", opacity);
    }
  }, [corners, floor?.floor_plan_url, mapReady, opacity]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || corners.length < 4) return;
    if (hasFittedRef.current) return;

    const bounds = new maplibregl.LngLatBounds();
    corners.forEach((corner) => bounds.extend([corner.lng, corner.lat]));
    map.fitBounds(bounds, { padding: 80, maxZoom: 20, duration: 0 });
    hasFittedRef.current = true;
  }, [mapReady, corners]);

  useEffect(() => {
    const handleMove = (event) => {
      if (!dragRef.current || !mapRef.current) return;
      event.preventDefault();

      const map = mapRef.current;
      const nextLngLat = map.unproject([event.clientX, event.clientY]);
      const drag = dragRef.current;

      if (drag.kind === "corner") {
        setCorners((current) =>
          current.map((corner) =>
            corner.id === drag.cornerId
              ? { ...corner, lat: nextLngLat.lat, lng: nextLngLat.lng }
              : corner,
          ),
        );
        return;
      }

      if (drag.kind === "move") {
        const deltaLat = nextLngLat.lat - drag.previous.lat;
        const deltaLng = nextLngLat.lng - drag.previous.lng;
        setCorners((current) => translateCorners(current, deltaLat, deltaLng));
        dragRef.current = {
          ...drag,
          previous: { lat: nextLngLat.lat, lng: nextLngLat.lng },
        };
        return;
      }

      if (drag.kind === "rotate") {
        const centerPoint = projectedCenter(map, drag.startCorners);
        const startAngle = Math.atan2(
          drag.startPointer.y - centerPoint.y,
          drag.startPointer.x - centerPoint.x,
        );
        const currentAngle = Math.atan2(
          event.clientY - centerPoint.y,
          event.clientX - centerPoint.x,
        );
        const deltaDegrees = ((currentAngle - startAngle) * 180) / Math.PI;
        setCorners(rotateCorners(drag.startCorners, deltaDegrees));
      }
    };

    const handleUp = () => {
      dragRef.current = null;
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };

    if (dragRef.current) {
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    }

    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [corners]);

  const handlePositions = useMemo(() => {
    const map = mapRef.current;
    if (!map || !mapReady || corners.length < 4) return [];
    return corners.map((corner) => {
      const point = map.project([corner.lng, corner.lat]);
      return { ...corner, x: point.x, y: point.y };
    });
  }, [corners, mapReady]);

  const centerHandle = useMemo(() => {
    const map = mapRef.current;
    if (!map || !mapReady || corners.length < 4) return null;
    const center = centroid(corners);
    const point = map.project([center.lng, center.lat]);
    return { x: point.x, y: point.y };
  }, [corners, mapReady]);

  const rotationHandle = useMemo(() => {
    if (handlePositions.length < 2) return null;
    const topMid = {
      x: (handlePositions[0].x + handlePositions[1].x) / 2,
      y: (handlePositions[0].y + handlePositions[1].y) / 2 - 42,
    };
    return topMid;
  }, [handlePositions]);

  const activeFloorName =
    floors.find((entry) => entry.id === levelId)?.name || floor?.name || "Floor";

  const saveWorldPosition = async (openAiMapping = false) => {
    if (!floor) return;
    setSaving(true);
    try {
      const center = centroid(corners);
      const [northWest, northEast, , southWest] = orderedCorners(corners);
      const northEdge = northEast || corners[1];
      const westEdge = northWest || corners[0];
      const rotation =
        (Math.atan2(northEdge.lat - westEdge.lat, northEdge.lng - westEdge.lng) *
          180) /
        Math.PI;
      const scaleX =
        Math.hypot(
          (northEast?.lng || 0) - (northWest?.lng || 0),
          (northEast?.lat || 0) - (northWest?.lat || 0),
        ) / Math.max(floor.floor_plan_width || 1, 1);
      const scaleY =
        Math.hypot(
          (southWest?.lng || 0) - (northWest?.lng || 0),
          (southWest?.lat || 0) - (northWest?.lat || 0),
        ) / Math.max(floor.floor_plan_height || 1, 1);
      const response = await api.maps.saveGeoreference({
        floor_id: floor.id,
        anchorLat: center.lat,
        anchorLng: center.lng,
        rotation,
        scaleX,
        scaleY,
        level: activeFloorName,
        opacity,
        corners,
        controlPoints,
        transform: {
          bounds: overlayBounds(corners),
          basemap: basemapStyle,
        },
        address,
        mode: pinMode ? "pins" : "handle",
      });

      setFloor(response.floor || floor);
      toast.success("World position saved");

      if (openAiMapping) {
        navigate(`/admin/buildings/${buildingId}/floors/${floor.id}/editor`, {
          state: { openAiMapping: true },
        });
      }
    } catch (error) {
      toast.error(error.message || "Unable to save world position.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg px-6">
        <div className="card-sm flex flex-col items-center gap-4 text-center">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          <div>
            <div className="text-base font-semibold">Loading world position</div>
            <p className="mt-1 text-sm subtle-text">
              Preparing the outdoor map and floor overlay.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-bg text-primary">
      {showIntro && (
        <IntroModal
          hideAgain={!hideIntro}
          onHideAgainChange={(value) => setHideIntro(!value)}
          onStart={() => {
            if (!hideIntro) {
              window.localStorage.setItem(INTRO_KEY, "1");
            }
            setShowIntro(false);
          }}
        />
      )}

      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-default bg-surface px-4">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(`/admin/buildings/${buildingId}/floors/${floorId}/editor`)}
            className="btn-ghost px-3"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <div>
            <div className="section-label">World Position</div>
            <div className="text-sm font-semibold">
              {building?.name} / {floor?.name}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden items-center gap-1 rounded-full border border-default bg-surface-alt p-1 md:inline-flex">
            <button
              type="button"
              onClick={() => setBasemapStyle("streets")}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                basemapStyle === "streets" ? "bg-accent text-white" : "text-secondary"
              }`}
            >
              Streets
            </button>
            <button
              type="button"
              disabled={!WORLD_POSITION_STYLES.satellite}
              onClick={() => setBasemapStyle("satellite")}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                basemapStyle === "satellite" ? "bg-accent text-white" : "text-secondary"
              } disabled:cursor-not-allowed disabled:opacity-40`}
            >
              Satellite
            </button>
          </div>
          <button
            type="button"
            onClick={() => setPinMode((current) => !current)}
            className={`btn-secondary ${pinMode ? "border-accent text-accent" : ""}`}
          >
            <Sparkles className="h-4 w-4" />
            Georeference with pins (experimental)
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => saveWorldPosition(true)}
            className="btn-primary"
          >
            {saving ? <Check className="h-4 w-4 animate-pulse" /> : null}
            Complete World Position
          </button>
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="h-full w-full" />

        <div className="pointer-events-none absolute inset-0 z-[610]">
          {rotationHandle && handlePositions.length >= 2 && (
            <div
              className="world-position__rotation-line"
              style={{
                left: (handlePositions[0].x + handlePositions[1].x) / 2 - 1,
                top: (handlePositions[0].y + handlePositions[1].y) / 2 - 42,
                height: 42,
              }}
            />
          )}
          {handlePositions.map((handle) => (
            <button
              key={handle.id}
              type="button"
              className="world-position__handle pointer-events-auto"
              style={{ left: handle.x - 8, top: handle.y - 8 }}
              onPointerDown={(event) => {
                event.preventDefault();
                dragRef.current = { kind: "corner", cornerId: handle.id };
              }}
              title={`Drag ${handle.label} corner`}
            />
          ))}

          {centerHandle && (
            <button
              type="button"
              className="world-position__center-handle pointer-events-auto"
              style={{ left: centerHandle.x - 14, top: centerHandle.y - 14 }}
              onPointerDown={(event) => {
                event.preventDefault();
                const map = mapRef.current;
                const nextLngLat = map.unproject([event.clientX, event.clientY]);
                dragRef.current = {
                  kind: "move",
                  previous: { lat: nextLngLat.lat, lng: nextLngLat.lng },
                };
              }}
              title="Drag the floor overlay"
            >
              <Move className="h-4 w-4" />
            </button>
          )}

          {rotationHandle && (
            <button
              type="button"
              className="world-position__rotation-handle pointer-events-auto"
              style={{ left: rotationHandle.x - 14, top: rotationHandle.y - 14 }}
              onPointerDown={(event) => {
                event.preventDefault();
                dragRef.current = {
                  kind: "rotate",
                  startPointer: { x: event.clientX, y: event.clientY },
                  startCorners: corners,
                };
              }}
              title="Rotate overlay"
            >
              <RotateCw className="h-4 w-4" />
            </button>
          )}

          {pinMode && mapReady && (
            <div
              className="world-position__pin-capture pointer-events-auto"
              onClick={(event) => {
                if (!containerRef.current || !mapRef.current) return;
                const imagePoint = imagePointFromScreen(
                  corners,
                  mapRef.current,
                  event.clientX,
                  event.clientY,
                  containerRef.current.getBoundingClientRect(),
                );
                if (!imagePoint) {
                  toast.error("Unable to capture the floor-plan point from the current view.");
                  return;
                }
                setPendingImagePoint(imagePoint);
                toast.success("Image pin added. Click the matching world point on the map.");
              }}
            />
          )}
        </div>

        <div className="absolute bottom-6 left-1/2 z-[650] w-[min(92vw,620px)] -translate-x-1/2 rounded-2xl border border-default bg-[color:var(--color-map-overlay)] p-4 shadow-[var(--shadow-panel)]">
          <div className="grid gap-4 md:grid-cols-[1.6fr_1fr_1fr_auto]">
            <div>
              <label className="field-label">Address</label>
              <input
                className="input"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="Searchable address for the building"
              />
            </div>
            <div>
              <label className="field-label">Level</label>
              <select
                className="select"
                value={levelId}
                onChange={(event) => setLevelId(event.target.value)}
              >
                {floors.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">Opacity</label>
              <input
                className="w-full"
                type="range"
                min="0.15"
                max="0.95"
                step="0.05"
                value={opacity}
                onChange={(event) => setOpacity(Number.parseFloat(event.target.value))}
              />
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => saveWorldPosition(false)}
                className="btn-secondary"
              >
                Save Position
              </button>
            </div>
          </div>

          {pinMode && (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-default bg-surface px-4 py-3 text-sm">
              <span className="font-medium text-primary">
                Experimental pins: {controlPoints.length} pair{controlPoints.length === 1 ? "" : "s"}
              </span>
              {pendingImagePoint && (
                <span className="subtle-text">
                  Image pin ready. Click the outdoor map to match it.
                </span>
              )}
              {!pendingImagePoint && controlPoints.length < 3 && (
                <span className="subtle-text">
                  Add at least 3 matched pairs to solve the affine transform.
                </span>
              )}
              <button
                type="button"
                onClick={() => setCorners((current) => applyPinFit(current, controlPoints))}
                disabled={controlPoints.length < 3}
                className="btn-secondary"
              >
                Apply Pin Fit
              </button>
            </div>
          )}
        </div>

        <div className="absolute bottom-6 left-6 z-[650] max-w-sm">
          <button
            type="button"
            onClick={() => setMissingFootprintOpen((current) => !current)}
            className="btn-secondary"
          >
            Missing building footprint?
          </button>
          {missingFootprintOpen && (
            <div className="mt-3 rounded-2xl border border-default bg-[color:var(--color-map-overlay)] p-4 text-sm subtle-text shadow-[var(--shadow-panel)]">
              Use the blue corner handles to size the floor against the real
              building shape. The center handle moves the overlay, and the
              rotation handle aligns the plan orientation.
            </div>
          )}
        </div>

        <div className="absolute right-6 top-6 z-[650] rounded-2xl border border-default bg-[color:var(--color-map-overlay)] px-4 py-3 shadow-[var(--shadow-panel)]">
          <div className="section-label">Active Level</div>
          <div className="mt-2 text-lg font-semibold">{activeFloorName}</div>
          <div className="mt-1 text-xs subtle-text">
            Flat 2D map locked for precise alignment.
          </div>
        </div>
      </div>
    </div>
  );
}
