import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { ArrowLeft, RotateCw, Search, Target } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "../../utils/api.js";
import {
  applyHomography,
  homographyFromCorners,
  solveLinearSystem,
} from "../../utils/georeferenceMath.js";

const FALLBACK_STYLE = {
  version: 8,
  sources: {
    "osm-tiles": {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [
    {
      id: "osm-tiles-layer",
      type: "raster",
      source: "osm-tiles",
      minzoom: 0,
      maxzoom: 19,
    },
  ],
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
};

function shouldFallbackToOsm(event) {
  const error = event?.error;
  const status = error?.status || error?.response?.status;
  const message = String(error?.message || "").toLowerCase();

  return (
    status === 401 ||
    status === 403 ||
    status === 404 ||
    message.includes("401") ||
    message.includes("403") ||
    message.includes("404") ||
    message.includes("maptiler") ||
    message.includes("failed to load") ||
    message.includes("style")
  );
}

function toNumber(value, fallback = 0) {
  const parsed =
    typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function leastSquaresAffine(samples, accessor) {
  if (!samples || samples.length < 3) return null;
  const sum = {
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

  for (const sample of samples) {
    const u = toNumber(sample.uv?.u, NaN);
    const v = toNumber(sample.uv?.v, NaN);
    const b = toNumber(accessor(sample), NaN);
    if (!Number.isFinite(u) || !Number.isFinite(v) || !Number.isFinite(b))
      continue;
    sum.uu += u * u;
    sum.uv += u * v;
    sum.vv += v * v;
    sum.u += u;
    sum.v += v;
    sum.n += 1;
    sum.ub += u * b;
    sum.vb += v * b;
    sum.b += b;
  }

  if (sum.n < 3) return null;

  return solveLinearSystem(
    [
      [sum.uu, sum.uv, sum.u],
      [sum.uv, sum.vv, sum.v],
      [sum.u, sum.v, sum.n],
    ],
    [sum.ub, sum.vb, sum.b],
  );
}

function normalizePoint(point) {
  return {
    x: toNumber(point.x, 0),
    y: toNumber(point.y, 0),
  };
}

function rotate(point, center, degrees) {
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

function cornersFromState(centerPixel, imageWidth, imageHeight, state) {
  const halfW = (imageWidth * state.scaleX) / 2;
  const halfH = (imageHeight * state.scaleY) / 2;
  const base = [
    { id: "tl", x: centerPixel.x - halfW, y: centerPixel.y - halfH },
    { id: "tr", x: centerPixel.x + halfW, y: centerPixel.y - halfH },
    { id: "br", x: centerPixel.x + halfW, y: centerPixel.y + halfH },
    { id: "bl", x: centerPixel.x - halfW, y: centerPixel.y + halfH },
  ];

  return base.map((entry) => ({
    ...entry,
    ...rotate(entry, centerPixel, state.rotation),
  }));
}

export default function AdminFloorGeoreference() {
  const { buildingId, floorId } = useParams();
  const navigate = useNavigate();
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const imageRef = useRef(null);
  const dragRef = useRef(null);
  const pinModeRef = useRef(false);
  const pendingUvRef = useRef(null);
  const centerRef = useRef({ lat: 23.0225, lng: 72.5714 });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [building, setBuilding] = useState(null);
  const [floor, setFloor] = useState(null);
  const [floors, setFloors] = useState([]);
  const [address, setAddress] = useState("");
  const [level, setLevel] = useState("Ground Floor");
  const [pinMode, setPinMode] = useState(false);
  const [pendingUv, setPendingUv] = useState(null);
  const [pairs, setPairs] = useState([]);
  const [mapLoaded, setMapLoaded] = useState(false);

  const [state, setState] = useState({
    centerLat: 23.0225,
    centerLng: 72.5714,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 0.65,
  });

  const [projectedCenter, setProjectedCenter] = useState(null);

  const imageWidth = Number(floor?.floor_plan_width || 2000);
  const imageHeight = Number(floor?.floor_plan_height || 1500);

  useEffect(() => {
    pinModeRef.current = pinMode;
  }, [pinMode]);

  useEffect(() => {
    pendingUvRef.current = pendingUv;
  }, [pendingUv]);

  useEffect(() => {
    centerRef.current = { lat: state.centerLat, lng: state.centerLng };
  }, [state.centerLat, state.centerLng]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const [buildingData, floorData, buildingFloors] = await Promise.all([
          api.buildings.get(buildingId),
          api.floors.get(floorId),
          api.floors.byBuilding(buildingId),
        ]);

        if (cancelled) return;
        const georef = floorData?.georeference || null;
        const centerLat = toNumber(
          georef?.anchorLat,
          toNumber(buildingData?.entrance_lat, 23.0225),
        );
        const centerLng = toNumber(
          georef?.anchorLng,
          toNumber(buildingData?.entrance_lng, 72.5714),
        );

        setBuilding(buildingData);
        setFloor(floorData);
        setFloors(buildingFloors || []);
        setAddress(georef?.address || buildingData?.address || "");
        setLevel(georef?.level || floorData?.name || "Ground Floor");
        setState((current) => ({
          ...current,
          centerLat,
          centerLng,
          rotation: toNumber(georef?.rotation, 0),
          scaleX: Math.max(0.05, toNumber(georef?.scaleX, 1)),
          scaleY: Math.max(0.05, toNumber(georef?.scaleY, 1)),
          opacity: Math.max(0.1, Math.min(1, toNumber(georef?.opacity, 0.65))),
        }));
      } catch (error) {
        toast.error(error.message || "Unable to load georeference data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [buildingId, floorId]);

  useEffect(() => {
    if (mapRef.current) return;

    if (!mapContainerRef.current) return;

    const maptilerKey = String(import.meta.env.VITE_MAPTILER_KEY || "").trim();
    const mapStyle = maptilerKey
      ? `https://api.maptiler.com/maps/streets/style.json?key=${maptilerKey}`
      : FALLBACK_STYLE;

    let fallbackStyleApplied = !maptilerKey;

    if (!maptilerKey) {
      console.warn(
        "VITE_MAPTILER_KEY is not set. Using OpenStreetMap fallback.",
      );
    }

    setMapLoaded(false);

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: mapStyle,
      center: [centerRef.current.lng, centerRef.current.lat],
      zoom: 17,
      pitch: 0,
      bearing: 0,
      dragRotate: false,
      touchPitch: false,
      pitchWithRotate: false,
      attributionControl: true,
      fadeDuration: 0,
      trackResize: true,
      renderWorldCopies: false,
      maxTileCacheSize: 50,
    });

    map.on("load", () => {
      setMapLoaded(true);
      map.setPitch(0);
      map.setBearing(0);
    });

    map.on("error", (event) => {
      console.error("MapLibre error:", event);

      if (fallbackStyleApplied) return;
      if (shouldFallbackToOsm(event)) {
        fallbackStyleApplied = true;
        setMapLoaded(false);
        map.setStyle(FALLBACK_STYLE);
      }
    });

    const syncCenter = () => {
      const point = map.project([centerRef.current.lng, centerRef.current.lat]);
      setProjectedCenter({ x: point.x, y: point.y });
    };

    map.on("move", syncCenter);
    map.on("zoom", syncCenter);
    map.on("resize", syncCenter);

    map.on("click", (event) => {
      if (!pinModeRef.current || !pendingUvRef.current) return;
      setPairs((current) => [
        ...current,
        {
          id: `pair-${current.length + 1}`,
          uv: pendingUvRef.current,
          geo: { lat: event.lngLat.lat, lng: event.lngLat.lng },
        },
      ]);
      setPendingUv(null);
    });

    mapRef.current = map;
    syncCenter();

    return () => {
      setMapLoaded(false);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const currentCenter = map.getCenter();
    if (
      Math.abs(currentCenter.lng - state.centerLng) > 1e-9 ||
      Math.abs(currentCenter.lat - state.centerLat) > 1e-9
    ) {
      map.setCenter([state.centerLng, state.centerLat]);
    }
    const projected = map.project([state.centerLng, state.centerLat]);
    setProjectedCenter({ x: projected.x, y: projected.y });
  }, [state.centerLat, state.centerLng]);

  const overlayPixelWidth = imageWidth * state.scaleX;
  const overlayPixelHeight = imageHeight * state.scaleY;

  const cornersPx = useMemo(() => {
    if (!projectedCenter) return [];
    return cornersFromState(projectedCenter, imageWidth, imageHeight, state);
  }, [imageHeight, imageWidth, projectedCenter, state]);

  const cornerLngLats = useMemo(() => {
    const map = mapRef.current;
    if (!map || cornersPx.length !== 4) return [];
    return cornersPx.map((corner) => {
      const ll = map.unproject([corner.x, corner.y]);
      return [ll.lng, ll.lat];
    });
  }, [cornersPx]);

  const rotationHandle = useMemo(() => {
    if (cornersPx.length !== 4) return null;
    const topMid = {
      x: (cornersPx[0].x + cornersPx[1].x) / 2,
      y: (cornersPx[0].y + cornersPx[1].y) / 2,
    };
    return rotate({ x: topMid.x, y: topMid.y - 40 }, topMid, state.rotation);
  }, [cornersPx, state.rotation]);

  function beginDrag(kind, event, cornerId = null) {
    event.preventDefault();
    dragRef.current = {
      kind,
      cornerId,
      startClient: { x: event.clientX, y: event.clientY },
      startState: { ...state },
    };
  }

  useEffect(() => {
    function onMove(event) {
      const map = mapRef.current;
      if (
        !map ||
        !dragRef.current ||
        !projectedCenter ||
        cornersPx.length !== 4
      )
        return;
      event.preventDefault();

      const drag = dragRef.current;
      const currentClient = { x: event.clientX, y: event.clientY };
      const dx = currentClient.x - drag.startClient.x;
      const dy = currentClient.y - drag.startClient.y;

      if (drag.kind === "center") {
        const from = map.unproject([projectedCenter.x, projectedCenter.y]);
        const to = map.unproject([
          projectedCenter.x + dx,
          projectedCenter.y + dy,
        ]);
        setState((current) => ({
          ...current,
          centerLat: current.centerLat + (to.lat - from.lat),
          centerLng: current.centerLng + (to.lng - from.lng),
        }));
        dragRef.current.startClient = currentClient;
        return;
      }

      if (drag.kind === "rotation") {
        const startAngle = Math.atan2(
          drag.startClient.y - projectedCenter.y,
          drag.startClient.x - projectedCenter.x,
        );
        const currentAngle = Math.atan2(
          currentClient.y - projectedCenter.y,
          currentClient.x - projectedCenter.x,
        );
        const delta = ((currentAngle - startAngle) * 180) / Math.PI;
        setState((current) => ({
          ...current,
          rotation: drag.startState.rotation + delta,
        }));
        return;
      }

      if (drag.kind === "corner") {
        const cornerIndex = ["tl", "tr", "br", "bl"].indexOf(drag.cornerId);
        if (cornerIndex < 0) return;
        const opposite = cornersPx[(cornerIndex + 2) % 4];
        const current = { x: currentClient.x, y: currentClient.y };
        const midpoint = {
          x: (current.x + opposite.x) / 2,
          y: (current.y + opposite.y) / 2,
        };
        const unrotated = rotate(current, midpoint, -state.rotation);
        const halfW = Math.abs(unrotated.x - midpoint.x);
        const halfH = Math.abs(unrotated.y - midpoint.y);

        const centerLngLat = map.unproject([midpoint.x, midpoint.y]);
        setState((prev) => ({
          ...prev,
          centerLat: centerLngLat.lat,
          centerLng: centerLngLat.lng,
          scaleX: Math.max(0.05, (halfW * 2) / imageWidth),
          scaleY: Math.max(0.05, (halfH * 2) / imageHeight),
        }));
      }
    }

    function onUp() {
      dragRef.current = null;
    }

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [cornersPx, imageHeight, imageWidth, projectedCenter, state]);

  function searchAddress() {
    const map = mapRef.current;
    if (!map) return;
    if (!address.trim()) return;

    fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}`,
    )
      .then((response) => response.json())
      .then((results) => {
        if (!Array.isArray(results) || !results.length) {
          toast.error("Address not found.");
          return;
        }
        const top = results[0];
        const lat = Number(top.lat);
        const lng = Number(top.lon);
        map.flyTo({ center: [lng, lat], zoom: 18, duration: 800 });
        setState((current) => ({ ...current, centerLat: lat, centerLng: lng }));
      })
      .catch(() => toast.error("Geocoding failed."));
  }

  function onImagePinClick(event) {
    if (!pinMode) return;
    const img = imageRef.current;
    if (!img) return;

    const rect = img.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const local = { x: event.clientX - cx, y: event.clientY - cy };
    const unrot = rotate(local, { x: 0, y: 0 }, -state.rotation);
    const u = 0.5 + unrot.x / rect.width;
    const v = 0.5 + unrot.y / rect.height;
    if (u < 0 || u > 1 || v < 0 || v > 1) return;
    setPendingUv({ u, v });
    toast.success("Image pin recorded. Click matching map location.");
  }

  function applyPinTransform() {
    if (pairs.length < 3) {
      toast.error("Add at least 3 pin pairs first.");
      return;
    }

    const latCoef = leastSquaresAffine(pairs, (sample) => sample.geo.lat);
    const lngCoef = leastSquaresAffine(pairs, (sample) => sample.geo.lng);
    if (!latCoef || !lngCoef) {
      toast.error("Unable to compute affine transform from pin pairs.");
      return;
    }

    const corners = [
      { u: 0, v: 0 },
      { u: 1, v: 0 },
      { u: 1, v: 1 },
      { u: 0, v: 1 },
    ].map((entry) => ({
      lng: lngCoef[0] * entry.u + lngCoef[1] * entry.v + lngCoef[2],
      lat: latCoef[0] * entry.u + latCoef[1] * entry.v + latCoef[2],
    }));

    const map = mapRef.current;
    if (!map) return;

    const projected = corners.map((corner) =>
      map.project([corner.lng, corner.lat]),
    );
    const widthPx = Math.hypot(
      projected[1].x - projected[0].x,
      projected[1].y - projected[0].y,
    );
    const heightPx = Math.hypot(
      projected[3].x - projected[0].x,
      projected[3].y - projected[0].y,
    );
    const angle =
      (Math.atan2(
        projected[1].y - projected[0].y,
        projected[1].x - projected[0].x,
      ) *
        180) /
      Math.PI;

    const centerLat = corners.reduce((sum, corner) => sum + corner.lat, 0) / 4;
    const centerLng = corners.reduce((sum, corner) => sum + corner.lng, 0) / 4;

    setState((current) => ({
      ...current,
      centerLat,
      centerLng,
      rotation: angle,
      scaleX: Math.max(0.05, widthPx / imageWidth),
      scaleY: Math.max(0.05, heightPx / imageHeight),
    }));
    toast.success("Affine pin transform applied.");
  }

  function currentCornerLngLats() {
    const map = mapRef.current;
    if (!map || !projectedCenter) return [];

    const corners = cornersFromState(
      projectedCenter,
      imageWidth,
      imageHeight,
      state,
    );
    if (corners.length !== 4) return [];

    return corners.map((corner) => {
      const ll = map.unproject([corner.x, corner.y]);
      return [ll.lng, ll.lat];
    });
  }

  async function completeWorldPosition() {
    if (!floor?.floor_plan_url) {
      toast.error("Floor plan image is required before georeferencing.");
      return;
    }

    if (!mapLoaded) {
      toast.error("Map is still loading. Please wait a moment and try again.");
      return;
    }

    const resolvedCorners =
      cornerLngLats.length === 4 ? cornerLngLats : currentCornerLngLats();

    if (!floor || resolvedCorners.length !== 4) {
      toast.error("Overlay corners are not ready.");
      return;
    }

    const pixelCorners = [
      [0, 0],
      [imageWidth, 0],
      [imageWidth, imageHeight],
      [0, imageHeight],
    ];

    const H = homographyFromCorners(pixelCorners, resolvedCorners);
    if (!H) {
      toast.error("Failed to compute homography matrix.");
      return;
    }

    setSaving(true);
    try {
      await api.maps.saveGeoreference({
        floor_id: floor.id,
        anchorLat: state.centerLat,
        anchorLng: state.centerLng,
        rotation: state.rotation,
        scaleX: state.scaleX,
        scaleY: state.scaleY,
        opacity: state.opacity,
        level,
        corners: [
          {
            id: "tl",
            label: "TL",
            lat: resolvedCorners[0][1],
            lng: resolvedCorners[0][0],
          },
          {
            id: "tr",
            label: "TR",
            lat: resolvedCorners[1][1],
            lng: resolvedCorners[1][0],
          },
          {
            id: "br",
            label: "BR",
            lat: resolvedCorners[2][1],
            lng: resolvedCorners[2][0],
          },
          {
            id: "bl",
            label: "BL",
            lat: resolvedCorners[3][1],
            lng: resolvedCorners[3][0],
          },
        ],
        controlPoints: pairs,
        transform: {
          homography: H,
          sampleTopLeft: applyHomography(H, 0, 0),
          sampleBottomRight: applyHomography(H, imageWidth, imageHeight),
        },
        address,
        mode: pinMode ? "pins" : "handles",
      });

      toast.success("World position saved.");
      navigate(`/admin/buildings/${buildingId}/floors/${floor.id}/editor`);
    } catch (error) {
      toast.error(error.message || "Unable to save world position");
    } finally {
      setSaving(false);
    }
  }

  const projectedPins = useMemo(() => {
    const map = mapRef.current;
    if (!map) return [];
    return pairs.map((pair) => {
      const p = map.project([pair.geo.lng, pair.geo.lat]);
      return { ...pair, x: p.x, y: p.y };
    });
  }, [pairs, state.centerLat, state.centerLng, projectedCenter]);

  return (
    <div className="relative h-screen w-full overflow-hidden bg-bg">
      <div className="absolute left-3 top-3 z-[700]">
        <button
          type="button"
          onClick={() =>
            navigate(`/admin/buildings/${buildingId}/floors/${floorId}/editor`)
          }
          className="inline-flex items-center gap-2 rounded-md bg-white px-3 py-2 text-sm shadow"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
      </div>

      <button
        type="button"
        onClick={completeWorldPosition}
        disabled={saving}
        className="absolute right-4 top-4 z-[700] rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow"
      >
        {saving ? "Saving..." : "Complete World Position"}
      </button>

      <div ref={mapContainerRef} className="h-full w-full" />

      {(loading || !mapLoaded) && (
        <div className="absolute inset-0 z-[710] grid place-items-center bg-white/40">
          <div className="flex items-center gap-2 rounded-md bg-white/90 px-4 py-2 text-sm font-medium text-slate-700 shadow">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" />
            <span>
              {loading ? "Loading georeference workspace..." : "Loading map..."}
            </span>
          </div>
        </div>
      )}

      {projectedCenter && floor?.floor_plan_url && (
        <>
          <img
            ref={imageRef}
            src={floor.floor_plan_url}
            alt="Floor overlay"
            className="absolute z-[620] select-none"
            onClick={onImagePinClick}
            style={{
              left: projectedCenter.x,
              top: projectedCenter.y,
              width: overlayPixelWidth,
              height: overlayPixelHeight,
              opacity: state.opacity,
              transform: `translate(-50%, -50%) rotate(${state.rotation}deg)`,
              transformOrigin: "center center",
              pointerEvents: "auto",
              userSelect: "none",
            }}
          />

          <svg
            className="pointer-events-none absolute inset-0 z-[640]"
            width="100%"
            height="100%"
          >
            {cornersPx.length === 4 && rotationHandle && (
              <line
                x1={(cornersPx[0].x + cornersPx[1].x) / 2}
                y1={(cornersPx[0].y + cornersPx[1].y) / 2}
                x2={rotationHandle.x}
                y2={rotationHandle.y}
                stroke="#2563eb"
                strokeWidth="2"
              />
            )}
          </svg>

          {cornersPx.map((corner) => (
            <button
              key={corner.id}
              type="button"
              className="absolute z-[650] h-3 w-3 bg-blue-600"
              style={{ left: corner.x - 6, top: corner.y - 6 }}
              onPointerDown={(event) => beginDrag("corner", event, corner.id)}
            />
          ))}

          {rotationHandle && (
            <button
              type="button"
              className="absolute z-[650] h-3 w-3 rounded-full border border-blue-600 bg-white"
              style={{ left: rotationHandle.x - 6, top: rotationHandle.y - 6 }}
              onPointerDown={(event) => beginDrag("rotation", event)}
            />
          )}

          <button
            type="button"
            className="absolute z-[650] h-4 w-4 rounded-full bg-blue-600"
            style={{ left: projectedCenter.x - 8, top: projectedCenter.y - 8 }}
            onPointerDown={(event) => beginDrag("center", event)}
          />

          {projectedPins.map((pair, index) => (
            <div
              key={pair.id}
              className="absolute z-[660] flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-[9px] font-semibold text-white"
              style={{ left: pair.x - 8, top: pair.y - 8 }}
            >
              {index + 1}
            </div>
          ))}
        </>
      )}

      <div className="absolute bottom-5 left-1/2 z-[700] w-[min(920px,94vw)] -translate-x-1/2 rounded-2xl bg-white/95 p-4 shadow-lg backdrop-blur">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1.5fr_1fr_1fr_auto_auto]">
          <div>
            <label className="text-xs font-medium text-slate-600">
              Address
            </label>
            <div className="mt-1 flex gap-2">
              <input
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  searchAddress();
                }}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                placeholder="Search address"
              />
              <button
                type="button"
                onClick={searchAddress}
                className="rounded-md bg-slate-100 px-3"
              >
                <Search className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-600">Level</label>
            <select
              value={level}
              onChange={(event) => setLevel(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              {[
                "Ground Floor",
                "Level 1",
                "Level 2",
                "Level 3",
                "Basement",
                ...floors.map((entry) => entry.name).filter(Boolean),
              ]
                .filter((value, index, arr) => arr.indexOf(value) === index)
                .map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-600">
              Opacity
            </label>
            <input
              type="range"
              min="0.1"
              max="1"
              step="0.05"
              value={state.opacity}
              onChange={(event) =>
                setState((current) => ({
                  ...current,
                  opacity: Number(event.target.value),
                }))
              }
              className="mt-2 w-full"
            />
          </div>

          <button
            type="button"
            onClick={() => setPinMode((value) => !value)}
            className={`mt-5 rounded-md px-3 py-2 text-sm ${pinMode ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700"}`}
          >
            <Target className="mr-1 inline h-4 w-4" /> Pin Mode
          </button>

          <button
            type="button"
            onClick={applyPinTransform}
            disabled={pairs.length < 3}
            className="mt-5 rounded-md bg-slate-800 px-3 py-2 text-sm text-white disabled:opacity-40"
          >
            <RotateCw className="mr-1 inline h-4 w-4" /> Apply Pins
          </button>
        </div>

        <div className="mt-3 text-xs text-slate-500">
          {pinMode
            ? pendingUv
              ? "Image pin recorded. Click matching point on the map."
              : "Pin mode active: click floor image, then click map."
            : "Use corner handles to scale, center handle to move, rotation handle to rotate."}
        </div>
      </div>
    </div>
  );
}
