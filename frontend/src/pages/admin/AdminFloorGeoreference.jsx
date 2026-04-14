import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { ArrowLeft, Check, MapPin, Move, RotateCw, Sparkles } from "lucide-react";
import toast from "react-hot-toast";
import { MAPLIBRE_STYLE } from "../../components/navigation/mapProviderConfig.js";
import { api } from "../../utils/api.js";

const INTRO_KEY = "campusnav-hide-world-position-intro";
const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY || "";
const WORLD_POSITION_STYLES = {
  streets: MAPLIBRE_STYLE,
  satellite: MAPTILER_KEY
    ? `https://api.maptiler.com/maps/satellite/style.json?key=${MAPTILER_KEY}`
    : null,
};

const MIN_SCALE = 0.05;

function toNumber(value, fallback = 0) {
  const parsed =
    typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeCorners(corners, fallbackCenter = [23.0225, 72.5714]) {
  if (!Array.isArray(corners) || corners.length < 4) {
    const [lat, lng] = fallbackCenter;
    return [
      { id: "nw", lat: lat + 0.00008, lng: lng - 0.00012, label: "NW" },
      { id: "ne", lat: lat + 0.00008, lng: lng + 0.00012, label: "NE" },
      { id: "se", lat: lat - 0.00008, lng: lng + 0.00012, label: "SE" },
      { id: "sw", lat: lat - 0.00008, lng: lng - 0.00012, label: "SW" },
    ];
  }
  return corners
    .slice(0, 4)
    .map((corner, index) => ({
      id: corner.id || ["nw", "ne", "se", "sw"][index],
      label: corner.label || ["NW", "NE", "SE", "SW"][index],
      lat: toNumber(corner.lat, NaN),
      lng: toNumber(corner.lng, NaN),
    }))
    .filter((entry) => Number.isFinite(entry.lat) && Number.isFinite(entry.lng));
}

function centroid(corners) {
  const total = corners.reduce(
    (sum, corner) => ({ lat: sum.lat + corner.lat, lng: sum.lng + corner.lng }),
    { lat: 0, lng: 0 },
  );
  return { lat: total.lat / corners.length, lng: total.lng / corners.length };
}

function rotatePoint(point, center, degrees) {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
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
    if (Math.abs(augmented[maxRow][pivot]) < 1e-10) return null;
    if (maxRow !== pivot) [augmented[pivot], augmented[maxRow]] = [augmented[maxRow], augmented[pivot]];
    const divisor = augmented[pivot][pivot];
    for (let col = pivot; col < 4; col += 1) augmented[pivot][col] /= divisor;
    for (let row = 0; row < 3; row += 1) {
      if (row === pivot) continue;
      const factor = augmented[row][pivot];
      for (let col = pivot; col < 4; col += 1) augmented[row][col] -= factor * augmented[pivot][col];
    }
  }
  return augmented.map((row) => row[3]);
}

function solveLeastSquaresAffine(samples, accessor) {
  if (!Array.isArray(samples) || samples.length < 3) return null;
  const sums = { uu: 0, uv: 0, vv: 0, u: 0, v: 0, n: 0, ub: 0, vb: 0, b: 0 };
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
            <h2 className="mt-2 text-3xl font-bold tracking-[-0.03em]">Position your building on the world</h2>
            <p className="mt-4 text-sm subtle-text">
              Place your floor plan on the world by matching it to the outdoor footprint.
            </p>
          </div>
        </div>
        <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <label className="inline-flex items-center gap-2 text-sm text-secondary">
            <input type="checkbox" checked={hideAgain} onChange={(event) => onHideAgainChange(event.target.checked)} />
            Don&apos;t show again
          </label>
          <button type="button" onClick={onStart} className="btn-primary">Start World Position</button>
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
  const hasFittedRef = useRef(false);
  const dragRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapTick, setMapTick] = useState(0);
  const [building, setBuilding] = useState(null);
  const [floor, setFloor] = useState(null);
  const [floors, setFloors] = useState([]);
  const [opacity, setOpacity] = useState(0.55);
  const [address, setAddress] = useState("");
  const [levelId, setLevelId] = useState(floorId);
  const [pinMode, setPinMode] = useState(false);
  const [missingFootprintOpen, setMissingFootprintOpen] = useState(false);
  const [controlPoints, setControlPoints] = useState([]);
  const [pendingImagePoint, setPendingImagePoint] = useState(null);
  const [basemapStyle, setBasemapStyle] = useState("streets");
  const [hideIntro, setHideIntro] = useState(() => window.localStorage.getItem(INTRO_KEY) !== "1");
  const [showIntro, setShowIntro] = useState(() => window.localStorage.getItem(INTRO_KEY) !== "1");

  const [overlay, setOverlay] = useState({
    centerLat: 23.0225,
    centerLng: 72.5714,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
  });

  const imageWidth = Math.max(64, Number(floor?.floor_plan_width) || 1200);
  const imageHeight = Math.max(64, Number(floor?.floor_plan_height) || 900);

  useEffect(() => {
    hasFittedRef.current = false;
  }, [basemapStyle]);

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
        const georef = floorData?.map_data?.georeference || {};
        const centerLat = toNumber(georef.anchorLat, Number.parseFloat(buildingData?.entrance_lat) || 23.0225);
        const centerLng = toNumber(georef.anchorLng, Number.parseFloat(buildingData?.entrance_lng) || 72.5714);
        setBuilding(buildingData);
        setFloor(floorData);
        setFloors(buildingFloors || []);
        setAddress(georef.address || buildingData?.address || "");
        setLevelId((buildingFloors || []).find((entry) => entry.name === georef.level)?.id || floorData.id);
        setOpacity(toNumber(georef.opacity, 0.55));
        setControlPoints(georef.controlPoints || []);
        setOverlay({
          centerLat,
          centerLng,
          rotation: toNumber(georef.rotation, 0),
          scaleX: Math.max(MIN_SCALE, toNumber(georef.scaleX, 1)),
          scaleY: Math.max(MIN_SCALE, toNumber(georef.scaleY, 1)),
        });
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
      center: [overlay.centerLng, overlay.centerLat],
      zoom: 17,
      pitch: 0,
      bearing: 0,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    });

    const syncTick = () => setMapTick((value) => value + 1);
    map.on("load", () => {
      map.touchZoomRotate?.disableRotation?.();
      map.setPitch(0);
      map.setBearing(0);
      setMapReady(true);
      syncTick();
    });
    map.on("move", syncTick);
    map.on("zoom", syncTick);

    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");
    mapRef.current = map;
    return () => {
      map.off("move", syncTick);
      map.off("zoom", syncTick);
      setMapReady(false);
      map.remove();
      mapRef.current = null;
    };
  }, [basemapStyle, loading]);

  const centerPixel = useMemo(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return null;
    const point = map.project([overlay.centerLng, overlay.centerLat]);
    return { x: point.x, y: point.y };
  }, [mapReady, mapTick, overlay.centerLat, overlay.centerLng]);

  const scaledSize = useMemo(
    () => ({ width: imageWidth * overlay.scaleX, height: imageHeight * overlay.scaleY }),
    [imageHeight, imageWidth, overlay.scaleX, overlay.scaleY],
  );

  const cornersPx = useMemo(() => {
    if (!centerPixel) return [];
    const halfW = scaledSize.width / 2;
    const halfH = scaledSize.height / 2;
    const base = [
      { id: "nw", label: "NW", x: centerPixel.x - halfW, y: centerPixel.y - halfH },
      { id: "ne", label: "NE", x: centerPixel.x + halfW, y: centerPixel.y - halfH },
      { id: "se", label: "SE", x: centerPixel.x + halfW, y: centerPixel.y + halfH },
      { id: "sw", label: "SW", x: centerPixel.x - halfW, y: centerPixel.y + halfH },
    ];
    return base.map((corner) => ({ ...corner, ...rotatePoint(corner, centerPixel, overlay.rotation) }));
  }, [centerPixel, overlay.rotation, scaledSize.height, scaledSize.width]);

  const worldCorners = useMemo(() => {
    const map = mapRef.current;
    if (!map || cornersPx.length < 4) return [];
    return cornersPx.map((corner) => {
      const lngLat = map.unproject([corner.x, corner.y]);
      return { id: corner.id, label: corner.label, lat: lngLat.lat, lng: lngLat.lng };
    });
  }, [cornersPx]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || hasFittedRef.current || worldCorners.length < 4) return;
    const bounds = new maplibregl.LngLatBounds();
    worldCorners.forEach((corner) => bounds.extend([corner.lng, corner.lat]));
    map.fitBounds(bounds, { padding: 80, maxZoom: 20, duration: 0 });
    hasFittedRef.current = true;
  }, [mapReady, worldCorners]);

  const rotationHandle = useMemo(() => {
    if (cornersPx.length < 2) return null;
    const topMid = {
      x: (cornersPx[0].x + cornersPx[1].x) / 2,
      y: (cornersPx[0].y + cornersPx[1].y) / 2,
    };
    const offset = rotatePoint({ x: topMid.x, y: topMid.y - 42 }, topMid, overlay.rotation);
    return offset;
  }, [cornersPx, overlay.rotation]);

  const activeFloorName = floors.find((entry) => entry.id === levelId)?.name || floor?.name || "Floor";

  const placedPinPositions = useMemo(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return [];
    return controlPoints.map((point) => {
      const projected = map.project([point.worldPoint.lng, point.worldPoint.lat]);
      return { id: point.id, x: projected.x, y: projected.y };
    });
  }, [controlPoints, mapReady, mapTick]);

  const pendingWorldPoint = useMemo(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !pendingImagePoint || worldCorners.length < 4) return null;
    const ordered = normalizeCorners(worldCorners);
    const nw = ordered[0];
    const ne = ordered[1];
    const se = ordered[2];
    const sw = ordered[3];
    const u = pendingImagePoint.u;
    const v = pendingImagePoint.v;
    const lat = nw.lat * (1 - u) * (1 - v) + ne.lat * u * (1 - v) + se.lat * u * v + sw.lat * (1 - u) * v;
    const lng = nw.lng * (1 - u) * (1 - v) + ne.lng * u * (1 - v) + se.lng * u * v + sw.lng * (1 - u) * v;
    const projected = map.project([lng, lat]);
    return { x: projected.x, y: projected.y };
  }, [mapReady, mapTick, pendingImagePoint, worldCorners]);

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
    return () => map.off("click", handleMapClick);
  }, [mapReady, pendingImagePoint, pinMode]);

  const searchAddress = async () => {
    const query = address.trim();
    if (!query || !mapRef.current) return;
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json`);
      const results = await response.json();
      if (!Array.isArray(results) || !results.length) {
        toast.error("No search result found for this address.");
        return;
      }
      const top = results[0];
      const lat = Number.parseFloat(top.lat);
      const lng = Number.parseFloat(top.lon);
      mapRef.current.flyTo({ center: [lng, lat], zoom: 17 });
      setOverlay((current) => ({ ...current, centerLat: lat, centerLng: lng }));
    } catch (error) {
      toast.error(error.message || "Unable to search this address.");
    }
  };

  const beginDrag = (kind, event, cornerId = null) => {
    event.preventDefault();
    dragRef.current = {
      kind,
      cornerId,
      startClient: { x: event.clientX, y: event.clientY },
      startOverlay: { ...overlay },
      lastClient: { x: event.clientX, y: event.clientY },
    };
  };

  useEffect(() => {
    const handleMove = (event) => {
      if (!dragRef.current || !mapRef.current || !containerRef.current) return;
      event.preventDefault();
      const map = mapRef.current;
      const rect = containerRef.current.getBoundingClientRect();
      const client = { x: event.clientX, y: event.clientY };
      const local = { x: client.x - rect.left, y: client.y - rect.top };
      const drag = dragRef.current;

      if (drag.kind === "move") {
        const prevLocal = { x: drag.lastClient.x - rect.left, y: drag.lastClient.y - rect.top };
        const prevLngLat = map.unproject([prevLocal.x, prevLocal.y]);
        const nextLngLat = map.unproject([local.x, local.y]);
        setOverlay((current) => ({
          ...current,
          centerLat: current.centerLat + (nextLngLat.lat - prevLngLat.lat),
          centerLng: current.centerLng + (nextLngLat.lng - prevLngLat.lng),
        }));
        dragRef.current = { ...drag, lastClient: client };
        return;
      }

      if (!centerPixel) return;

      if (drag.kind === "rotate") {
        const startAngle = Math.atan2(drag.startClient.y - rect.top - centerPixel.y, drag.startClient.x - rect.left - centerPixel.x);
        const currentAngle = Math.atan2(local.y - centerPixel.y, local.x - centerPixel.x);
        const delta = ((currentAngle - startAngle) * 180) / Math.PI;
        setOverlay((current) => ({ ...current, rotation: drag.startOverlay.rotation + delta }));
        return;
      }

      if (drag.kind === "corner" && cornersPx.length === 4) {
        const index = ["nw", "ne", "se", "sw"].indexOf(drag.cornerId);
        if (index < 0) return;
        const opposite = cornersPx[(index + 2) % 4];
        const mid = { x: (local.x + opposite.x) / 2, y: (local.y + opposite.y) / 2 };
        const unrot = rotatePoint(local, mid, -overlay.rotation);
        const halfW = Math.max((Math.abs(unrot.x - mid.x)), (imageWidth * MIN_SCALE) / 2);
        const halfH = Math.max((Math.abs(unrot.y - mid.y)), (imageHeight * MIN_SCALE) / 2);
        const centerLngLat = map.unproject([mid.x, mid.y]);
        setOverlay((current) => ({
          ...current,
          centerLat: centerLngLat.lat,
          centerLng: centerLngLat.lng,
          scaleX: Math.max(MIN_SCALE, (halfW * 2) / imageWidth),
          scaleY: Math.max(MIN_SCALE, (halfH * 2) / imageHeight),
        }));
      }
    };

    const handleUp = () => {
      dragRef.current = null;
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("touchmove", handleMove);
      window.removeEventListener("touchend", handleUp);
    };

    if (dragRef.current) {
      window.addEventListener("pointermove", handleMove, { passive: false });
      window.addEventListener("pointerup", handleUp);
      window.addEventListener("touchmove", handleMove, { passive: false });
      window.addEventListener("touchend", handleUp);
    }

    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("touchmove", handleMove);
      window.removeEventListener("touchend", handleUp);
    };
  }, [centerPixel, cornersPx, imageHeight, imageWidth, overlay.rotation]);

  const saveWorldPosition = async (openAiMapping = false) => {
    if (!floor) return;
    setSaving(true);
    try {
      const corners = worldCorners;
      const lats = corners.map((entry) => entry.lat);
      const lngs = corners.map((entry) => entry.lng);
      const response = await api.maps.saveGeoreference({
        floor_id: floor.id,
        anchorLat: overlay.centerLat,
        anchorLng: overlay.centerLng,
        rotation: overlay.rotation,
        scaleX: overlay.scaleX,
        scaleY: overlay.scaleY,
        level: activeFloorName,
        opacity,
        corners,
        controlPoints,
        transform: {
          bounds: {
            north: Math.max(...lats),
            south: Math.min(...lats),
            east: Math.max(...lngs),
            west: Math.min(...lngs),
          },
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

  const applyPinFit = () => {
    const latCoefficients = solveLeastSquaresAffine(controlPoints, (sample) => sample.worldPoint?.lat);
    const lngCoefficients = solveLeastSquaresAffine(controlPoints, (sample) => sample.worldPoint?.lng);
    if (!latCoefficients || !lngCoefficients || !mapRef.current) {
      toast.error("Need 3+ valid pin pairs to solve affine fit.");
      return;
    }
    const corners = [
      { u: 0, v: 0 },
      { u: 1, v: 0 },
      { u: 1, v: 1 },
      { u: 0, v: 1 },
    ].map((entry, index) => ({
      id: ["nw", "ne", "se", "sw"][index],
      lat: latCoefficients[0] * entry.u + latCoefficients[1] * entry.v + latCoefficients[2],
      lng: lngCoefficients[0] * entry.u + lngCoefficients[1] * entry.v + lngCoefficients[2],
    }));
    const center = centroid(corners);
    const map = mapRef.current;
    const projected = corners.map((corner) => map.project([corner.lng, corner.lat]));
    const widthPx = Math.hypot(projected[1].x - projected[0].x, projected[1].y - projected[0].y);
    const heightPx = Math.hypot(projected[3].x - projected[0].x, projected[3].y - projected[0].y);
    const angle = (Math.atan2(projected[1].y - projected[0].y, projected[1].x - projected[0].x) * 180) / Math.PI;
    setOverlay((current) => ({
      ...current,
      centerLat: center.lat,
      centerLng: center.lng,
      rotation: angle,
      scaleX: Math.max(MIN_SCALE, widthPx / imageWidth),
      scaleY: Math.max(MIN_SCALE, heightPx / imageHeight),
    }));
    toast.success("Applied pin-based affine fit.");
  };

  if (loading) {
    return <div className="flex h-screen items-center justify-center bg-bg px-6"><div className="card-sm">Loading world position...</div></div>;
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-bg text-primary">
      {showIntro && (
        <IntroModal
          hideAgain={!hideIntro}
          onHideAgainChange={(value) => setHideIntro(!value)}
          onStart={() => {
            if (!hideIntro) window.localStorage.setItem(INTRO_KEY, "1");
            setShowIntro(false);
          }}
        />
      )}

      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-default bg-surface px-4">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={() => navigate(`/admin/buildings/${buildingId}/floors/${floorId}/editor`)} className="btn-ghost px-3">
            <ArrowLeft className="h-4 w-4" />Back
          </button>
          <div><div className="section-label">World Position</div><div className="text-sm font-semibold">{building?.name} / {floor?.name}</div></div>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden items-center gap-1 rounded-full border border-default bg-surface-alt p-1 md:inline-flex">
            <button type="button" onClick={() => setBasemapStyle("streets")} className={`rounded-full px-3 py-1 text-xs font-semibold ${basemapStyle === "streets" ? "bg-accent text-white" : "text-secondary"}`}>Streets</button>
            <button type="button" disabled={!WORLD_POSITION_STYLES.satellite} onClick={() => setBasemapStyle("satellite")} className={`rounded-full px-3 py-1 text-xs font-semibold ${basemapStyle === "satellite" ? "bg-accent text-white" : "text-secondary"} disabled:opacity-40`}>Satellite</button>
          </div>
          <button type="button" onClick={() => setPinMode((current) => !current)} className={`btn-secondary ${pinMode ? "border-accent text-accent" : ""}`}><Sparkles className="h-4 w-4" />Georeference with pins</button>
          <button type="button" disabled={saving} onClick={() => saveWorldPosition(true)} className="btn-primary">{saving ? <Check className="h-4 w-4 animate-pulse" /> : null}Complete World Position</button>
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="h-full w-full" />

        {centerPixel && floor?.floor_plan_url && (
          <div className="pointer-events-none absolute inset-0 z-[620]" style={{ touchAction: "none" }}>
            <div
              className="absolute"
              style={{
                left: centerPixel.x,
                top: centerPixel.y,
                width: imageWidth,
                height: imageHeight,
                transform: `translate(-50%, -50%) rotate(${overlay.rotation}deg) scale(${overlay.scaleX}, ${overlay.scaleY})`,
                transformOrigin: "center center",
              }}
            >
              <img
                src={floor.floor_plan_url}
                alt="Floor overlay"
                draggable={false}
                onPointerDown={(event) => beginDrag("move", event)}
                onTouchStart={(event) => {
                  const touch = event.touches?.[0];
                  if (!touch) return;
                  beginDrag("move", touch);
                }}
                onClick={(event) => {
                  if (!pinMode) return;
                  const rect = event.currentTarget.getBoundingClientRect();
                  const cx = rect.left + rect.width / 2;
                  const cy = rect.top + rect.height / 2;
                  const local = { x: event.clientX - cx, y: event.clientY - cy };
                  const unrot = rotatePoint({ x: local.x, y: local.y }, { x: 0, y: 0 }, -overlay.rotation);
                  const u = 0.5 + unrot.x / Math.max(rect.width, 1);
                  const v = 0.5 + unrot.y / Math.max(rect.height, 1);
                  if (u < 0 || u > 1 || v < 0 || v > 1) return;
                  setPendingImagePoint({ u, v });
                  toast.success("Image pin added. Click matching point on map.");
                }}
                style={{ width: "100%", height: "100%", opacity, pointerEvents: "auto", touchAction: "none", userSelect: "none" }}
              />
            </div>

            {cornersPx.length >= 2 && rotationHandle ? (
              <div className="world-position__rotation-line" style={{ left: (cornersPx[0].x + cornersPx[1].x) / 2 - 1, top: (cornersPx[0].y + cornersPx[1].y) / 2, height: 42 }} />
            ) : null}

            {cornersPx.map((corner) => (
              <button
                key={corner.id}
                type="button"
                className="world-position__handle pointer-events-auto"
                style={{ left: corner.x - 8, top: corner.y - 8 }}
                onPointerDown={(event) => beginDrag("corner", event, corner.id)}
                onTouchStart={(event) => {
                  const touch = event.touches?.[0];
                  if (!touch) return;
                  beginDrag("corner", touch, corner.id);
                }}
                title={`Drag ${corner.label}`}
              />
            ))}

            <button
              type="button"
              className="world-position__center-handle pointer-events-auto"
              style={{ left: centerPixel.x - 14, top: centerPixel.y - 14 }}
              onPointerDown={(event) => beginDrag("move", event)}
              onTouchStart={(event) => {
                const touch = event.touches?.[0];
                if (!touch) return;
                beginDrag("move", touch);
              }}
              title="Drag overlay"
            >
              <Move className="h-4 w-4" />
            </button>

            <button
              type="button"
              className="world-position__rotation-handle pointer-events-auto"
              style={{ left: (rotationHandle?.x || 0) - 14, top: (rotationHandle?.y || 0) - 14 }}
              onPointerDown={(event) => beginDrag("rotate", event)}
              onTouchStart={(event) => {
                const touch = event.touches?.[0];
                if (!touch) return;
                beginDrag("rotate", touch);
              }}
              title="Rotate overlay"
            >
              <RotateCw className="h-4 w-4" />
            </button>

            {placedPinPositions.map((pin) => (
              <div key={pin.id} className="pointer-events-none absolute h-4 w-4 rounded-full border-2 border-white bg-emerald-500" style={{ left: pin.x - 8, top: pin.y - 8 }} />
            ))}
            {pendingWorldPoint ? <div className="pointer-events-none absolute h-3 w-3 rounded-full bg-amber-400 ring-2 ring-white" style={{ left: pendingWorldPoint.x - 6, top: pendingWorldPoint.y - 6 }} /> : null}
          </div>
        )}

        <div className="absolute bottom-6 left-1/2 z-[650] w-[min(92vw,700px)] -translate-x-1/2 rounded-2xl border border-default bg-[color:var(--color-map-overlay)] p-4 shadow-[var(--shadow-panel)]">
          <div className="grid gap-4 md:grid-cols-[1.6fr_1fr_1fr_auto]">
            <div>
              <label className="field-label">Address</label>
              <input className="input" value={address} onChange={(event) => setAddress(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void searchAddress(); } }} placeholder="Searchable address for the building" />
              <button type="button" onClick={() => void searchAddress()} className="btn-secondary mt-2">Search</button>
            </div>
            <div><label className="field-label">Level</label><select className="select" value={levelId} onChange={(event) => setLevelId(event.target.value)}>{floors.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></div>
            <div><label className="field-label">Opacity</label><input className="w-full" type="range" min="0.15" max="0.95" step="0.05" value={opacity} onChange={(event) => setOpacity(Number.parseFloat(event.target.value))} /></div>
            <div className="flex items-end"><button type="button" onClick={() => saveWorldPosition(false)} className="btn-secondary">Save Position</button></div>
          </div>

          {pinMode && (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-default bg-surface px-4 py-3 text-sm">
              <span className="font-medium text-primary">Pins: {controlPoints.length} pair{controlPoints.length === 1 ? "" : "s"}</span>
              {pendingImagePoint ? <span className="subtle-text">Image pin ready. Click outdoor map.</span> : null}
              {!pendingImagePoint && controlPoints.length < 3 ? <span className="subtle-text">Add at least 3 pairs.</span> : null}
              <button type="button" className="btn-secondary" disabled={controlPoints.length < 3} onClick={applyPinFit}>Apply Pin Fit</button>
            </div>
          )}
        </div>

        <div className="absolute bottom-6 left-6 z-[650] max-w-sm">
          <button type="button" onClick={() => setMissingFootprintOpen((current) => !current)} className="btn-secondary">Missing building footprint?</button>
          {missingFootprintOpen ? <div className="mt-3 rounded-2xl border border-default bg-[color:var(--color-map-overlay)] p-4 text-sm subtle-text shadow-[var(--shadow-panel)]">Blue handles resize, center handle moves, top handle rotates. Supports mouse and touch.</div> : null}
        </div>

        <div className="absolute right-6 top-6 z-[650] rounded-2xl border border-default bg-[color:var(--color-map-overlay)] px-4 py-3 shadow-[var(--shadow-panel)]">
          <div className="section-label">Active Level</div>
          <div className="mt-2 text-lg font-semibold">{activeFloorName}</div>
          <div className="mt-1 text-xs subtle-text">DOM overlay mode active.</div>
        </div>
      </div>
    </div>
  );
}
