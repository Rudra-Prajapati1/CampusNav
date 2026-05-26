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

const CORNER_IDS = ["tl", "tr", "br", "bl"];

function normalizeGeoCorners(corners) {
  if (!Array.isArray(corners) || corners.length < 4) return [];

  const byId = new Map(
    corners
      .filter((corner) => corner && typeof corner === "object" && corner.id)
      .map((corner) => [corner.id, corner]),
  );
  const ordered = CORNER_IDS.every((id) => byId.has(id))
    ? CORNER_IDS.map((id) => byId.get(id))
    : corners.slice(0, 4);

  const normalized = ordered.map((corner, index) => {
    const lng = toNumber(Array.isArray(corner) ? corner[0] : corner?.lng, NaN);
    const lat = toNumber(Array.isArray(corner) ? corner[1] : corner?.lat, NaN);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { id: CORNER_IDS[index], lat, lng };
  });

  return normalized.every(Boolean) ? normalized : [];
}

function legacyStateToGeoCorners(map, imageWidth, imageHeight, state) {
  if (!map) return [];
  const centerPixel = map.project([state.centerLng, state.centerLat]);
  return cornersFromState(centerPixel, imageWidth, imageHeight, state).map(
    (corner, index) => {
      const lngLat = map.unproject([corner.x, corner.y]);
      return { id: CORNER_IDS[index], lat: lngLat.lat, lng: lngLat.lng };
    },
  );
}

function overlayViewFromGeoCorners(map, geoCorners) {
  const normalized = normalizeGeoCorners(geoCorners);
  if (!map || normalized.length !== 4) return null;

  const corners = normalized.map((corner, index) => {
    const point = map.project([corner.lng, corner.lat]);
    return {
      id: CORNER_IDS[index],
      x: point.x,
      y: point.y,
    };
  });

  const center = corners.reduce(
    (sum, corner) => ({
      x: sum.x + corner.x / corners.length,
      y: sum.y + corner.y / corners.length,
    }),
    { x: 0, y: 0 },
  );
  const width = Math.hypot(
    corners[1].x - corners[0].x,
    corners[1].y - corners[0].y,
  );
  const height = Math.hypot(
    corners[3].x - corners[0].x,
    corners[3].y - corners[0].y,
  );
  const rotation =
    (Math.atan2(corners[1].y - corners[0].y, corners[1].x - corners[0].x) *
      180) /
    Math.PI;

  return { center, corners, height, rotation, width };
}

function geoCornersToLngLats(geoCorners) {
  return normalizeGeoCorners(geoCorners).map((corner) => [
    corner.lng,
    corner.lat,
  ]);
}

function isMapInteractionEnabled(interaction) {
  return typeof interaction?.isEnabled === "function"
    ? interaction.isEnabled()
    : true;
}

function setMapInteractionsEnabled(map, enabled, previousState = null) {
  const interactions = [
    ["dragPan", map?.dragPan],
    ["dragRotate", map?.dragRotate],
    ["scrollZoom", map?.scrollZoom],
  ];

  if (!enabled) {
    return interactions.reduce((snapshot, [name, interaction]) => {
      snapshot[name] = isMapInteractionEnabled(interaction);
      interaction?.disable?.();
      return snapshot;
    }, {});
  }

  interactions.forEach(([name, interaction]) => {
    if (previousState?.[name] === false) {
      interaction?.disable?.();
      return;
    }
    interaction?.enable?.();
  });
  return null;
}

export default function AdminFloorGeoreference() {
  const { buildingId, floorId } = useParams();
  const navigate = useNavigate();
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const imageRef = useRef(null);
  const dragRef = useRef(null);
  const mapInteractionStateRef = useRef(null);
  const overlayFrameRef = useRef(null);
  const overlayVisibleRef = useRef(false);
  const cornerHandleRefs = useRef([]);
  const rotationHandleRef = useRef(null);
  const centerHandleRef = useRef(null);
  const rotationLineRef = useRef(null);
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
  const stateRef = useRef(state);
  const [geoCorners, setGeoCorners] = useState([]);
  const geoCornersRef = useRef([]);
  const [overlayView, setOverlayView] = useState(null);
  const overlayViewRef = useRef(null);
  const imageSizeRef = useRef({ width: 2000, height: 1500 });

  const imageWidth = Number(floor?.floor_plan_width || 2000);
  const imageHeight = Number(floor?.floor_plan_height || 1500);

  function clientToMapPoint(clientX, clientY) {
    const map = mapRef.current;
    if (!map) return { x: clientX, y: clientY };
    const rect = map.getContainer().getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  }

  function mapPointToOverlayPoint(mapX, mapY) {
    const map = mapRef.current;
    const container = mapContainerRef.current;
    if (!map || !container) return { x: mapX, y: mapY };
    const mapRect = map.getContainer().getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    return {
      x: mapX + (mapRect.left - containerRect.left),
      y: mapY + (mapRect.top - containerRect.top),
    };
  }

  function overlayDisplayFromView(view) {
    if (!view) return null;

    const corners = view.corners.map((corner) => ({
      ...corner,
      ...mapPointToOverlayPoint(corner.x, corner.y),
    }));
    const center = mapPointToOverlayPoint(view.center.x, view.center.y);
    const width = Math.hypot(
      corners[1].x - corners[0].x,
      corners[1].y - corners[0].y,
    );
    const height = Math.hypot(
      corners[3].x - corners[0].x,
      corners[3].y - corners[0].y,
    );
    const rotation =
      (Math.atan2(corners[1].y - corners[0].y, corners[1].x - corners[0].x) *
        180) /
      Math.PI;

    return { center, corners, height, rotation, width };
  }

  function applyHandlePositions(display) {
    if (!display || display.corners.length !== 4) return;

    display.corners.forEach((corner, index) => {
      const el = cornerHandleRefs.current[index];
      if (!el) return;
      el.style.left = `${corner.x}px`;
      el.style.top = `${corner.y}px`;
    });

    const centerEl = centerHandleRef.current;
    if (centerEl) {
      centerEl.style.left = `${display.center.x}px`;
      centerEl.style.top = `${display.center.y}px`;
    }

    const topCenter = {
      x: (display.corners[0].x + display.corners[1].x) / 2,
      y: (display.corners[0].y + display.corners[1].y) / 2,
    };
    const angle = (display.rotation * Math.PI) / 180;
    const offsetX = -Math.sin(angle) * 40;
    const offsetY = -Math.cos(angle) * 40;
    const rotationX = topCenter.x + offsetX;
    const rotationY = topCenter.y + offsetY;

    const rotEl = rotationHandleRef.current;
    if (rotEl) {
      rotEl.style.left = `${rotationX}px`;
      rotEl.style.top = `${rotationY}px`;
    }

    const lineEl = rotationLineRef.current;
    if (lineEl) {
      lineEl.setAttribute("x1", topCenter.x);
      lineEl.setAttribute("y1", topCenter.y);
      lineEl.setAttribute("x2", rotationX);
      lineEl.setAttribute("y2", rotationY);
    }
  }

  function applyOverlayImageStyle(view) {
    const image = imageRef.current;
    const display = overlayDisplayFromView(view);
    if (!image || !display) return;
    image.style.left = `${display.center.x}px`;
    image.style.top = `${display.center.y}px`;
    image.style.width = `${Math.max(1, display.width)}px`;
    image.style.height = `${Math.max(1, display.height)}px`;
    image.style.opacity = String(stateRef.current.opacity);
    image.style.transform = `translate(-50%, -50%) rotate(${display.rotation}deg)`;
    image.style.transformOrigin = "center center";
    applyHandlePositions(display);
  }

  function projectOverlayNow(cornersOverride = null) {
    const map = mapRef.current;
    const view = overlayViewFromGeoCorners(
      map,
      cornersOverride || geoCornersRef.current,
    );

    if (!view) {
      overlayViewRef.current = null;
      overlayVisibleRef.current = false;
      setOverlayView(null);
      return null;
    }

    const shouldShowOverlay = !overlayVisibleRef.current;
    applyOverlayImageStyle(view);
    overlayViewRef.current = view;
    if (shouldShowOverlay) {
      overlayVisibleRef.current = true;
      setOverlayView(view);
    }
    return view;
  }

  function scheduleOverlayProjection() {
    if (overlayFrameRef.current !== null) {
      window.cancelAnimationFrame(overlayFrameRef.current);
    }
    overlayFrameRef.current = window.requestAnimationFrame(() => {
      overlayFrameRef.current = window.requestAnimationFrame(() => {
        overlayFrameRef.current = null;
        projectOverlayNow();
      });
    });
  }

  function deriveOverlayState(corners, viewOverride = null) {
    const map = mapRef.current;
    const view = viewOverride || overlayViewFromGeoCorners(map, corners);
    if (!map || !view) return null;
    const centerLngLat = map.unproject([view.center.x, view.center.y]);
    const { width, height } = imageSizeRef.current;
    return {
      centerLat: centerLngLat.lat,
      centerLng: centerLngLat.lng,
      rotation: view.rotation,
      scaleX: Math.max(0.05, view.width / width),
      scaleY: Math.max(0.05, view.height / height),
    };
  }

  function setCanonicalGeoCorners(nextCorners, options = {}) {
    const normalized = normalizeGeoCorners(nextCorners);
    if (normalized.length !== 4) return;

    geoCornersRef.current = normalized;
    setGeoCorners(normalized);
    const view = projectOverlayNow(normalized);

    if (options.syncState === false) return;
    const derivedState = deriveOverlayState(normalized, view);
    if (!derivedState) return;
    setState((current) => ({ ...current, ...derivedState }));
  }

  useEffect(() => {
    pinModeRef.current = pinMode;
  }, [pinMode]);

  useEffect(() => {
    pendingUvRef.current = pendingUv;
  }, [pendingUv]);

  useEffect(() => {
    stateRef.current = state;
    centerRef.current = { lat: state.centerLat, lng: state.centerLng };
    if (imageRef.current) {
      imageRef.current.style.opacity = String(state.opacity);
    }
  }, [state]);

  useEffect(() => {
    imageSizeRef.current = { width: imageWidth, height: imageHeight };
  }, [imageHeight, imageWidth]);

  useEffect(() => {
    geoCornersRef.current = geoCorners;
    scheduleOverlayProjection();
  }, [geoCorners]);

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
        centerRef.current = { lat: centerLat, lng: centerLng };
        setState((current) => ({
          ...current,
          centerLat,
          centerLng,
          rotation: toNumber(georef?.rotation, 0),
          scaleX: Math.max(0.05, toNumber(georef?.scaleX, 1)),
          scaleY: Math.max(0.05, toNumber(georef?.scaleY, 1)),
          opacity: Math.max(0.1, Math.min(1, toNumber(georef?.opacity, 0.65))),
        }));
        const savedGeoCorners = normalizeGeoCorners(georef?.corners);
        geoCornersRef.current = savedGeoCorners;
        setGeoCorners(savedGeoCorners);
        const map = mapRef.current;
        if (map) {
          map.setCenter([centerLng, centerLat]);
          projectOverlayNow(savedGeoCorners);
        }
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
      scrollZoom: { around: "center" },
      doubleClickZoom: false,
      touchPitch: false,
      pitchWithRotate: false,
      dragRotate: false,
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
      scheduleOverlayProjection();
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

    const syncOverlay = () => {
      if (overlayFrameRef.current !== null) {
        window.cancelAnimationFrame(overlayFrameRef.current);
        overlayFrameRef.current = null;
      }
      projectOverlayNow();
    };

    map.on("move", syncOverlay);
    map.on("zoom", syncOverlay);
    map.on("rotate", syncOverlay);
    map.on("pitch", syncOverlay);
    map.on("resize", syncOverlay);

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
    scheduleOverlayProjection();

    return () => {
      setMapLoaded(false);
      if (overlayFrameRef.current !== null) {
        window.cancelAnimationFrame(overlayFrameRef.current);
        overlayFrameRef.current = null;
      }
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;
    scheduleOverlayProjection();
  }, [state.centerLat, state.centerLng]);

  useEffect(() => {
    const map = mapRef.current;
    if (
      !map ||
      !mapLoaded ||
      !floor?.floor_plan_url ||
      geoCorners.length === 4
    )
      return;

    const seededCorners = legacyStateToGeoCorners(
      map,
      imageWidth,
      imageHeight,
      stateRef.current,
    );
    setCanonicalGeoCorners(seededCorners, { syncState: false });
  }, [
    floor?.floor_plan_url,
    geoCorners.length,
    imageHeight,
    imageWidth,
    mapLoaded,
  ]);

  function beginDrag(kind, event, cornerId = null) {
    event.preventDefault();
    event.stopPropagation();
    const map = mapRef.current;
    if (map && !mapInteractionStateRef.current) {
      mapInteractionStateRef.current = setMapInteractionsEnabled(map, false);
    }
    dragRef.current = {
      kind,
      cornerId,
      startClient: { x: event.clientX, y: event.clientY },
      startMapPoint: clientToMapPoint(event.clientX, event.clientY),
      startGeoCorners: geoCornersRef.current,
      startView: overlayViewRef.current,
    };
  }

  useEffect(() => {
    function finishDrag() {
      const map = mapRef.current;
      if (map && mapInteractionStateRef.current) {
        setMapInteractionsEnabled(map, true, mapInteractionStateRef.current);
      }
      mapInteractionStateRef.current = null;
      dragRef.current = null;
    }

    function onMove(event) {
      const map = mapRef.current;
      const drag = dragRef.current;
      const startGeoCorners = normalizeGeoCorners(drag?.startGeoCorners);
      const startView = drag?.startView;
      if (!map || !drag || startGeoCorners.length !== 4 || !startView) return;
      event.preventDefault();
      event.stopPropagation();

      const currentMapPoint = clientToMapPoint(event.clientX, event.clientY);
      const startMapPoint =
        drag.startMapPoint ||
        clientToMapPoint(drag.startClient.x, drag.startClient.y);
      const dx = currentMapPoint.x - startMapPoint.x;
      const dy = currentMapPoint.y - startMapPoint.y;

      if (drag.kind === "center") {
        const translatedCorners = startGeoCorners.map((corner) => {
          const startPoint = map.project([corner.lng, corner.lat]);
          const lngLat = map.unproject([startPoint.x + dx, startPoint.y + dy]);
          return { ...corner, lat: lngLat.lat, lng: lngLat.lng };
        });
        setCanonicalGeoCorners(translatedCorners);
        return;
      }

      if (drag.kind === "rotation") {
        const startAngle = Math.atan2(
          startMapPoint.y - startView.center.y,
          startMapPoint.x - startView.center.x,
        );
        const currentAngle = Math.atan2(
          currentMapPoint.y - startView.center.y,
          currentMapPoint.x - startView.center.x,
        );
        const delta = ((currentAngle - startAngle) * 180) / Math.PI;
        const rotatedCorners = startView.corners.map((corner, index) => {
          const rotated = rotate(corner, startView.center, delta);
          const lngLat = map.unproject([rotated.x, rotated.y]);
          return {
            id: CORNER_IDS[index],
            lat: lngLat.lat,
            lng: lngLat.lng,
          };
        });
        setCanonicalGeoCorners(rotatedCorners);
        return;
      }

      if (drag.kind === "corner") {
        const cornerIndex = CORNER_IDS.indexOf(drag.cornerId);
        if (cornerIndex < 0) return;
        const opposite = startView.corners[(cornerIndex + 2) % 4];
        const midpoint = {
          x: (currentMapPoint.x + opposite.x) / 2,
          y: (currentMapPoint.y + opposite.y) / 2,
        };
        const unrotated = rotate(currentMapPoint, midpoint, -startView.rotation);
        const halfWidth = Math.abs(unrotated.x - midpoint.x);
        const halfHeight = Math.abs(unrotated.y - midpoint.y);
        const resizedPoints = [
          { x: midpoint.x - halfWidth, y: midpoint.y - halfHeight },
          { x: midpoint.x + halfWidth, y: midpoint.y - halfHeight },
          { x: midpoint.x + halfWidth, y: midpoint.y + halfHeight },
          { x: midpoint.x - halfWidth, y: midpoint.y + halfHeight },
        ].map((point) => rotate(point, midpoint, startView.rotation));
        const resizedCorners = resizedPoints.map((point, index) => {
          const lngLat = map.unproject([point.x, point.y]);
          return {
            id: CORNER_IDS[index],
            lat: lngLat.lat,
            lng: lngLat.lng,
          };
        });
        setCanonicalGeoCorners(resizedCorners, { syncState: false });
      }
    }

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", finishDrag);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
    };
  }, []);

  function moveGeoCornersToCenter(lat, lng) {
    const map = mapRef.current;
    const currentCorners = normalizeGeoCorners(geoCornersRef.current);
    const currentView = overlayViewRef.current || projectOverlayNow();
    if (!map || currentCorners.length !== 4 || !currentView) return false;

    const target = map.project([lng, lat]);
    const dx = target.x - currentView.center.x;
    const dy = target.y - currentView.center.y;
    const translatedCorners = currentCorners.map((corner) => {
      const point = map.project([corner.lng, corner.lat]);
      const lngLat = map.unproject([point.x + dx, point.y + dy]);
      return { ...corner, lat: lngLat.lat, lng: lngLat.lng };
    });
    setCanonicalGeoCorners(translatedCorners);
    return true;
  }

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
        if (!moveGeoCornersToCenter(lat, lng)) {
          setState((current) => ({
            ...current,
            centerLat: lat,
            centerLng: lng,
          }));
        }
      })
      .catch(() => toast.error("Geocoding failed."));
  }

  function onImagePinClick(event) {
    if (!pinMode) return;
    const img = imageRef.current;
    if (!img) return;

    const rect = img.getBoundingClientRect();
    const view = overlayViewRef.current;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const local = { x: event.clientX - cx, y: event.clientY - cy };
    const unrot = rotate(local, { x: 0, y: 0 }, -(view?.rotation || 0));
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

    setCanonicalGeoCorners(
      corners.map((corner, index) => ({
        id: CORNER_IDS[index],
        lat: corner.lat,
        lng: corner.lng,
      })),
    );
    toast.success("Affine pin transform applied.");
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

    const resolvedGeoCorners =
      normalizeGeoCorners(geoCornersRef.current).length === 4
        ? normalizeGeoCorners(geoCornersRef.current)
        : legacyStateToGeoCorners(
            mapRef.current,
            imageWidth,
            imageHeight,
            stateRef.current,
          );
    const resolvedCorners = geoCornersToLngLats(resolvedGeoCorners);

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

    const saveView = overlayViewFromGeoCorners(mapRef.current, resolvedGeoCorners);
    const saveState =
      deriveOverlayState(resolvedGeoCorners, saveView) || stateRef.current;

    setSaving(true);
    try {
      await api.maps.saveGeoreference({
        floor_id: floor.id,
        anchorLat: saveState.centerLat,
        anchorLng: saveState.centerLng,
        rotation: saveState.rotation,
        scaleX: saveState.scaleX,
        scaleY: saveState.scaleY,
        opacity: stateRef.current.opacity,
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
  }, [overlayView, pairs]);

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

      {overlayView && floor?.floor_plan_url && (
        <div className="pointer-events-none absolute inset-0 z-[620]">
          <img
            ref={imageRef}
            src={floor.floor_plan_url}
            alt="Floor overlay"
            className="absolute z-[620] select-none"
            onClick={onImagePinClick}
            style={{
              transformOrigin: "center center",
              pointerEvents: pinMode ? "auto" : "none",
              userSelect: "none",
              willChange: "transform, left, top, width, height, opacity",
            }}
          />

          <svg
            className="pointer-events-none absolute inset-0 z-[640]"
            width="100%"
            height="100%"
          >
            <line
              ref={rotationLineRef}
              x1="0"
              y1="0"
              x2="0"
              y2="0"
              stroke="#2563eb"
              strokeWidth="2"
            />
          </svg>

          {CORNER_IDS.map((cornerId, index) => (
            <button
              key={cornerId}
              ref={(el) => {
                cornerHandleRefs.current[index] = el;
              }}
              type="button"
              className="absolute z-[650] h-3 w-3 bg-blue-600"
              style={{
                left: 0,
                top: 0,
                pointerEvents: "auto",
                transform: "translate(-50%, -50%)",
              }}
              onPointerDown={(event) => beginDrag("corner", event, cornerId)}
            />
          ))}

          <button
            ref={rotationHandleRef}
            type="button"
            className="absolute z-[650] h-3 w-3 rounded-full border border-blue-600 bg-white"
            style={{
              left: 0,
              top: 0,
              pointerEvents: "auto",
              transform: "translate(-50%, -50%)",
            }}
            onPointerDown={(event) => beginDrag("rotation", event)}
          />

          <button
            ref={centerHandleRef}
            type="button"
            className="absolute z-[650] h-4 w-4 rounded-full bg-blue-600"
            style={{
              left: 0,
              top: 0,
              pointerEvents: "auto",
              transform: "translate(-50%, -50%)",
            }}
            onPointerDown={(event) => beginDrag("center", event)}
          />

          {projectedPins.map((pair, index) => {
            const point = mapPointToOverlayPoint(pair.x, pair.y);
            return (
              <div
                key={pair.id}
                className="absolute z-[660] flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-[9px] font-semibold text-white"
                style={{ left: point.x - 8, top: point.y - 8 }}
              >
                {index + 1}
              </div>
            );
          })}
        </div>
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
