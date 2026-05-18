import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Info, Plus, Minus, ChevronDown, Navigation } from "lucide-react";
import {
  applyHomography,
  homographyFromCorners,
} from "../../utils/georeferenceMath.js";

const OUTDOOR_EXTRUSION_ID = "building-extrusion";
const INDOOR_SPACES_SOURCE = "indoor-spaces";
const INDOOR_WALLS_SOURCE = "indoor-walls";
const INDOOR_POI_SOURCE = "indoor-pois";
const ROUTE_SOURCE = "indoor-route";
const OVERLAY_SOURCE = "floor-overlay";
const OVERLAY_LAYER = "floor-overlay-layer";
const INDOOR_FLOOR_LAYER = "indoor-floor";
const INDOOR_ROOMS_LAYER = "indoor-rooms";
const INDOOR_WALLS_LAYER = "indoor-walls";
const POI_CIRCLE_LAYER = "poi-circles";
const POI_LABEL_LAYER = "poi-labels";
const ROUTE_LAYER = "route-line";
const POI_INTERACTIVE_LAYERS = [POI_CIRCLE_LAYER, POI_LABEL_LAYER];

const MINIMAL_STYLE = {
  version: 8,
  projection: { type: "mercator" },
  sources: {},
  layers: [],
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
};

const FALLBACK_STYLE = {
  ...MINIMAL_STYLE,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [
    {
      id: "osm-tiles",
      type: "raster",
      source: "osm",
      minzoom: 0,
      maxzoom: 19,
    },
  ],
};

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

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

function validateStyleCandidate(styleCandidate) {
  if (
    !styleCandidate ||
    typeof styleCandidate !== "object" ||
    Array.isArray(styleCandidate) ||
    styleCandidate.version !== 8 ||
    !styleCandidate.sources ||
    typeof styleCandidate.sources !== "object" ||
    !Array.isArray(styleCandidate.layers) ||
    !styleCandidate.projection
  ) {
    return null;
  }

  const nextStyle = deepClone(styleCandidate);
  if (!nextStyle.glyphs) {
    nextStyle.glyphs = MINIMAL_STYLE.glyphs;
  }
  return nextStyle;
}

async function resolveMapStyle(styleCandidate) {
  if (typeof styleCandidate === "string") {
    try {
      const response = await fetch(styleCandidate);
      if (!response.ok) {
        throw new Error(`Style request failed with status ${response.status}`);
      }

      const parsed = await response.json();
      const validated = validateStyleCandidate(parsed);
      if (!validated) {
        return { style: deepClone(FALLBACK_STYLE), usedFallback: true };
      }

      return { style: validated, usedFallback: false };
    } catch (error) {
      console.warn("Falling back to the local raster style.", error);
      return { style: deepClone(FALLBACK_STYLE), usedFallback: true };
    }
  }

  const validated = validateStyleCandidate(styleCandidate);
  if (!validated) {
    return { style: deepClone(FALLBACK_STYLE), usedFallback: true };
  }

  return { style: validated, usedFallback: false };
}

function buildHomography(georeference, mapData) {
  if (Array.isArray(georeference?.transform?.homography)) {
    return georeference.transform.homography;
  }

  const corners = Array.isArray(georeference?.corners)
    ? georeference.corners
    : [];
  if (corners.length !== 4) return null;

  const width = Number(mapData?.meta?.imageWidth || 2000);
  const height = Number(mapData?.meta?.imageHeight || 1500);

  return homographyFromCorners(
    [
      [0, 0],
      [width, 0],
      [width, height],
      [0, height],
    ],
    corners.map((corner) => [corner.lng, corner.lat]),
  );
}

function featureCenter(polygon) {
  if (!polygon?.length) return [0, 0];
  const ring = polygon[0] || [];
  const usable = ring.slice(0, -1);
  if (!usable.length) return [0, 0];
  const sum = usable.reduce(
    (acc, coord) => [acc[0] + coord[0], acc[1] + coord[1]],
    [0, 0],
  );
  return [sum[0] / usable.length, sum[1] / usable.length];
}

function colorForCategory(category) {
  const value = String(category || "").toLowerCase();
  if (value.includes("dining") || value.includes("canteen")) return "#f59e0b";
  if (value.includes("retail") || value.includes("store")) return "#8b5cf6";
  if (value.includes("exit") || value.includes("entrance")) return "#22c55e";
  if (value.includes("stairs") || value.includes("elevator")) return "#2563eb";
  return "#64748b";
}

function convertIndoorGeojson(mapData, homography) {
  const spaces = mapData?.spaces?.features || [];
  const walls = mapData?.obstructions?.features || [];
  const objects = mapData?.objects?.features || [];

  const spacesGeo = {
    type: "FeatureCollection",
    features: spaces
      .map((feature) => {
        const ring = feature?.geometry?.coordinates?.[0] || [];
        const converted = ring
          .map((coord) => applyHomography(homography, coord[0], coord[1]))
          .filter(Boolean);
        if (converted.length < 4) return null;
        return {
          type: "Feature",
          id: feature.id,
          properties: {
            kind: feature.properties?.kind || "room",
            name: feature.properties?.name || "Room",
            color: feature.properties?.color || "#8b5cf6",
          },
          geometry: {
            type: "Polygon",
            coordinates: [converted],
          },
        };
      })
      .filter(Boolean),
  };

  const wallsGeo = {
    type: "FeatureCollection",
    features: walls
      .map((feature) => {
        const coords = feature?.geometry?.coordinates || [];
        if (coords.length !== 2) return null;
        const a = applyHomography(homography, coords[0][0], coords[0][1]);
        const b = applyHomography(homography, coords[1][0], coords[1][1]);
        if (!a || !b) return null;
        return {
          type: "Feature",
          id: feature.id,
          properties: { kind: "wall" },
          geometry: { type: "LineString", coordinates: [a, b] },
        };
      })
      .filter(Boolean),
  };

  const poiGeo = {
    type: "FeatureCollection",
    features: [
      ...spaces
        .map((feature) => {
          const center = featureCenter(feature.geometry?.coordinates);
          const point = applyHomography(homography, center[0], center[1]);
          if (!point) return null;
          const kind = String(
            feature.properties?.kind || "facility",
          ).toLowerCase();
          const category = kind === "corridor" ? "facility" : kind;
          const routeRoomId =
            feature.properties?.linkedRoomId ||
            feature.properties?.linked_room_id ||
            feature.properties?.roomId ||
            feature.properties?.room_id ||
            feature.id ||
            null;
          return {
            type: "Feature",
            id: feature.id,
            properties: {
              name: feature.properties?.name || "Room",
              category,
              kind,
              color: colorForCategory(category),
              route_room_id: routeRoomId,
            },
            geometry: { type: "Point", coordinates: point },
          };
        })
        .filter(Boolean),
      ...objects
        .map((feature) => {
          const coord = feature?.geometry?.coordinates || [];
          const point = applyHomography(homography, coord[0], coord[1]);
          if (!point) return null;
          const kind = String(
            feature.properties?.kind || "facility",
          ).toLowerCase();
          const routeRoomId =
            feature.properties?.linkedRoomId ||
            feature.properties?.linked_room_id ||
            feature.properties?.roomId ||
            feature.properties?.room_id ||
            null;
          return {
            type: "Feature",
            id: feature.id,
            properties: {
              name: feature.properties?.label || kind,
              category: kind,
              kind,
              color: colorForCategory(kind),
              route_room_id: routeRoomId,
            },
            geometry: { type: "Point", coordinates: point },
          };
        })
        .filter(Boolean),
    ],
  };

  return { spacesGeo, wallsGeo, poiGeo };
}

function routeToGeojson(routePath, homography) {
  if (!Array.isArray(routePath) || !routePath.length || !homography) {
    return { type: "FeatureCollection", features: [] };
  }

  const coordinates = routePath
    .map((point) =>
      applyHomography(homography, Number(point.x), Number(point.y)),
    )
    .filter(Boolean);

  if (coordinates.length < 2) {
    return { type: "FeatureCollection", features: [] };
  }

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "LineString", coordinates },
        properties: {},
      },
    ],
  };
}

function floorShortLabel(floor) {
  const level = Number(floor?.level);
  if (Number.isFinite(level)) {
    if (level === 0) return "GF";
    if (level === -1) return "LG";
    if (level < -1) return `L${Math.abs(level)}G`;
    return `${level}F`;
  }

  const name = String(floor?.name || "").trim();
  if (!name) return "FL";
  if (/ground/i.test(name)) return "GF";
  const levelMatch = name.match(/level\s*(-?\d+)/i);
  if (levelMatch) {
    const parsed = Number(levelMatch[1]);
    if (Number.isFinite(parsed)) {
      if (parsed === 0) return "GF";
      if (parsed < 0) return parsed === -1 ? "LG" : `L${Math.abs(parsed)}G`;
      return `${parsed}F`;
    }
  }
  return name.slice(0, 3).toUpperCase();
}

function isStyleReady(map, styleLoadedRef) {
  return Boolean(map) && styleLoadedRef.current && map.isStyleLoaded();
}

function getStyleSource(map, id, styleLoadedRef) {
  if (!isStyleReady(map, styleLoadedRef)) return null;
  return map.getSource(id);
}

function hasStyleLayer(map, id, styleLoadedRef) {
  if (!isStyleReady(map, styleLoadedRef)) return false;
  return Boolean(map.getLayer(id));
}

function updateOrCreateGeoSource(map, id, data, styleLoadedRef) {
  if (!isStyleReady(map, styleLoadedRef)) return;
  const source = map.getSource(id);
  if (source && typeof source.setData === "function") {
    source.setData(data);
    return;
  }
  map.addSource(id, { type: "geojson", data });
}

function ensureLayer(map, layerConfig, styleLoadedRef, beforeId = null) {
  if (!isStyleReady(map, styleLoadedRef)) return;
  if (map.getLayer(layerConfig.id)) return;

  if (beforeId && map.getLayer(beforeId)) {
    map.addLayer(layerConfig, beforeId);
    return;
  }

  map.addLayer(layerConfig);
}

function findFloorEntry(mapData, currentFloorId) {
  const floors = Array.isArray(mapData?.floors) ? mapData.floors : [];
  return (
    floors.find((entry) => entry.id === currentFloorId) ||
    floors.find((entry) => entry.level === mapData?.level) ||
    floors[0] ||
    null
  );
}

function resolveOverlayConfig(mapData, georeference, currentFloorId) {
  const floorEntry = findFloorEntry(mapData, currentFloorId);
  const imageUrl =
    floorEntry?.backgroundDataUrl || mapData?.meta?.backgroundDataUrl || null;
  const corners = Array.isArray(georeference?.corners)
    ? georeference.corners
    : Array.isArray(floorEntry?.corners)
      ? floorEntry.corners
      : [];

  if (!imageUrl || corners.length < 4) return null;

  const coordinates = corners
    .slice(0, 4)
    .map((corner) => [Number(corner.lng), Number(corner.lat)]);

  if (
    coordinates.some(
      (coord) => !Number.isFinite(coord[0]) || !Number.isFinite(coord[1]),
    )
  ) {
    return null;
  }

  return { url: imageUrl, coordinates };
}

function buildPoiSelection(feature) {
  if (!feature) return null;
  return {
    id: feature.id,
    name: feature.properties?.name,
    category: feature.properties?.category,
    kind: feature.properties?.kind,
    route_room_id: feature.properties?.route_room_id || null,
    coordinates: feature.geometry?.coordinates || null,
  };
}

export default function MapLibreNavigationMap({
  building,
  floors,
  currentFloorId,
  onFloorSelect,
  mapData,
  georeference,
  routePath,
  destinationLabel,
  routeDistanceMeters,
  routeEtaMinutes,
  onExitBuilding,
  onPoiDirections,
  onPoiSelect,
  infoAction,
}) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const styleLoadedRef = useRef(false);
  const mapLoadedRef = useRef(false);
  const fallbackStyleAppliedRef = useRef(false);
  const pendingStyledataListenersRef = useRef([]);
  const poiLayerListenersRef = useRef([]);
  const styleRequestTokenRef = useRef(0);
  const latestStateRef = useRef({
    indoorGeo: null,
    routeGeo: null,
    overlayConfig: null,
    onPoiSelect: null,
  });
  const [mapReady, setMapReady] = useState(false);
  const [selectedPoi, setSelectedPoi] = useState(null);

  const maptilerKey = String(import.meta.env.VITE_MAPTILER_KEY || "").trim();
  const maptilerStyleUrl = String(
    import.meta.env.VITE_MAPTILER_MAPLIBRE_STYLE_URL || "",
  ).trim();
  const primaryStyleRequest = maptilerKey
    ? maptilerStyleUrl ||
      `https://api.maptiler.com/maps/streets-v2/style.json?key=${maptilerKey}`
    : FALLBACK_STYLE;

  const center = useMemo(() => {
    const lat = Number(building?.entrance_lat);
    const lng = Number(building?.entrance_lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return [lng, lat];
    return [72.5714, 23.0225];
  }, [building?.entrance_lat, building?.entrance_lng]);

  const homography = useMemo(
    () => buildHomography(georeference, mapData),
    [georeference, mapData],
  );
  const indoorGeo = useMemo(
    () => convertIndoorGeojson(mapData || {}, homography),
    [mapData, homography],
  );
  const routeGeo = useMemo(
    () => routeToGeojson(routePath, homography),
    [routePath, homography],
  );
  const overlayConfig = useMemo(
    () => resolveOverlayConfig(mapData, georeference, currentFloorId),
    [currentFloorId, georeference, mapData],
  );
  const routeDistanceLabel = useMemo(() => {
    const meters = Number(routeDistanceMeters);
    if (!Number.isFinite(meters) || meters <= 0) return "--";
    if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
    return `${Math.round(meters)} m`;
  }, [routeDistanceMeters]);
  const routeEtaLabel = useMemo(() => {
    const minutes = Number(routeEtaMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0) return "--";
    return `${Math.max(1, Math.round(minutes))} min`;
  }, [routeEtaMinutes]);

  latestStateRef.current = {
    indoorGeo,
    routeGeo,
    overlayConfig,
    onPoiSelect,
  };

  const cancelPendingStyledataListeners = (map) => {
    if (!map) {
      pendingStyledataListenersRef.current = [];
      return;
    }

    pendingStyledataListenersRef.current.forEach((listener) => {
      map.off("styledata", listener);
    });
    pendingStyledataListenersRef.current = [];
  };

  const registerStyledataListener = (map, listener) => {
    pendingStyledataListenersRef.current.push(listener);
    map.once("styledata", listener);
  };

  const clearPoiLayerListeners = (map) => {
    if (!map) {
      poiLayerListenersRef.current = [];
      return;
    }

    poiLayerListenersRef.current.forEach(({ event, layerId, handler }) => {
      map.off(event, layerId, handler);
    });
    poiLayerListenersRef.current = [];
  };

  const scheduleWhenStyleReady = (map, callback) => {
    if (!map) return;
    if (isStyleReady(map, styleLoadedRef)) {
      callback();
      return;
    }

    const queuedListener = () => {
      pendingStyledataListenersRef.current =
        pendingStyledataListenersRef.current.filter(
          (entry) => entry !== queuedListener,
        );
      callback();
    };

    registerStyledataListener(map, queuedListener);
  };

  const bindPoiInteractions = (map) => {
    if (!isStyleReady(map, styleLoadedRef)) return;
    clearPoiLayerListeners(map);

    if (
      !hasStyleLayer(map, POI_CIRCLE_LAYER, styleLoadedRef) ||
      !hasStyleLayer(map, POI_LABEL_LAYER, styleLoadedRef)
    ) {
      return;
    }

    const handlePoiClick = (event) => {
      const feature = event.features?.[0];
      const selection = buildPoiSelection(feature);
      if (!selection) return;
      setSelectedPoi(selection);
      latestStateRef.current.onPoiSelect?.(feature);
    };

    const handlePointerEnter = () => {
      map.getCanvas().style.cursor = "pointer";
    };

    const handlePointerLeave = () => {
      map.getCanvas().style.cursor = "";
    };

    POI_INTERACTIVE_LAYERS.forEach((layerId) => {
      map.on("click", layerId, handlePoiClick);
      poiLayerListenersRef.current.push({
        event: "click",
        layerId,
        handler: handlePoiClick,
      });

      map.on("mouseenter", layerId, handlePointerEnter);
      poiLayerListenersRef.current.push({
        event: "mouseenter",
        layerId,
        handler: handlePointerEnter,
      });

      map.on("mouseleave", layerId, handlePointerLeave);
      poiLayerListenersRef.current.push({
        event: "mouseleave",
        layerId,
        handler: handlePointerLeave,
      });
    });
  };

  const reapplyImageOverlay = (map) => {
    if (!isStyleReady(map, styleLoadedRef)) return;

    const existingLayer = map.getLayer(OVERLAY_LAYER);
    const existingSource = getStyleSource(map, OVERLAY_SOURCE, styleLoadedRef);
    const nextOverlay = latestStateRef.current.overlayConfig;

    if (!nextOverlay) {
      if (existingLayer) map.removeLayer(OVERLAY_LAYER);
      if (existingSource) map.removeSource(OVERLAY_SOURCE);
      return;
    }

    if (existingSource && typeof existingSource.updateImage === "function") {
      existingSource.updateImage({
        url: nextOverlay.url,
        coordinates: nextOverlay.coordinates,
      });
    } else {
      if (existingLayer) map.removeLayer(OVERLAY_LAYER);
      if (existingSource) map.removeSource(OVERLAY_SOURCE);
      map.addSource(OVERLAY_SOURCE, {
        type: "image",
        url: nextOverlay.url,
        coordinates: nextOverlay.coordinates,
      });
    }

    ensureLayer(
      map,
      {
        id: OVERLAY_LAYER,
        type: "raster",
        source: OVERLAY_SOURCE,
        paint: {
          "raster-opacity": 0.4,
        },
      },
      styleLoadedRef,
      INDOOR_FLOOR_LAYER,
    );
  };

  const rehydrateStyle = (map) => {
    if (!isStyleReady(map, styleLoadedRef)) return;

    if (
      getStyleSource(map, "openmaptiles", styleLoadedRef) &&
      !hasStyleLayer(map, OUTDOOR_EXTRUSION_ID, styleLoadedRef)
    ) {
      ensureLayer(
        map,
        {
          id: OUTDOOR_EXTRUSION_ID,
          type: "fill-extrusion",
          source: "openmaptiles",
          "source-layer": "building",
          paint: {
            "fill-extrusion-color": "#aaaaaa",
            "fill-extrusion-height": ["coalesce", ["get", "render_height"], 12],
            "fill-extrusion-base": [
              "coalesce",
              ["get", "render_min_height"],
              0,
            ],
            "fill-extrusion-opacity": [
              "interpolate",
              ["linear"],
              ["zoom"],
              17,
              1,
              18,
              0,
            ],
          },
        },
        styleLoadedRef,
      );
    }

    updateOrCreateGeoSource(
      map,
      INDOOR_SPACES_SOURCE,
      latestStateRef.current.indoorGeo.spacesGeo,
      styleLoadedRef,
    );
    updateOrCreateGeoSource(
      map,
      INDOOR_WALLS_SOURCE,
      latestStateRef.current.indoorGeo.wallsGeo,
      styleLoadedRef,
    );
    updateOrCreateGeoSource(
      map,
      INDOOR_POI_SOURCE,
      latestStateRef.current.indoorGeo.poiGeo,
      styleLoadedRef,
    );
    updateOrCreateGeoSource(
      map,
      ROUTE_SOURCE,
      latestStateRef.current.routeGeo,
      styleLoadedRef,
    );

    reapplyImageOverlay(map);

    ensureLayer(
      map,
      {
        id: INDOOR_FLOOR_LAYER,
        type: "fill",
        source: INDOOR_SPACES_SOURCE,
        paint: {
          "fill-color": "#f8fafc",
          "fill-opacity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            17,
            0,
            18,
            0.75,
          ],
        },
      },
      styleLoadedRef,
    );

    ensureLayer(
      map,
      {
        id: INDOOR_ROOMS_LAYER,
        type: "fill-extrusion",
        source: INDOOR_SPACES_SOURCE,
        paint: {
          "fill-extrusion-color": ["coalesce", ["get", "color"], "#8b5cf6"],
          "fill-extrusion-height": 3.5,
          "fill-extrusion-base": 0,
          "fill-extrusion-opacity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            17,
            0,
            18,
            0.85,
          ],
        },
      },
      styleLoadedRef,
    );

    ensureLayer(
      map,
      {
        id: INDOOR_WALLS_LAYER,
        type: "line",
        source: INDOOR_WALLS_SOURCE,
        paint: {
          "line-color": "#374151",
          "line-width": ["interpolate", ["linear"], ["zoom"], 17, 0.5, 18, 2],
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 17, 0, 18, 1],
        },
      },
      styleLoadedRef,
    );

    ensureLayer(
      map,
      {
        id: ROUTE_LAYER,
        type: "line",
        source: ROUTE_SOURCE,
        paint: {
          "line-color": "#2563eb",
          "line-width": 5,
          "line-dasharray": [2, 8],
          "line-opacity": 0.95,
        },
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
      },
      styleLoadedRef,
    );

    ensureLayer(
      map,
      {
        id: POI_CIRCLE_LAYER,
        type: "circle",
        source: INDOOR_POI_SOURCE,
        paint: {
          "circle-radius": 7,
          "circle-color": ["coalesce", ["get", "color"], "#64748b"],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      },
      styleLoadedRef,
    );

    ensureLayer(
      map,
      {
        id: POI_LABEL_LAYER,
        type: "symbol",
        source: INDOOR_POI_SOURCE,
        layout: {
          "text-field": ["get", "name"],
          "text-size": 11,
          "text-offset": [0, 1.4],
          "text-anchor": "top",
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: {
          "text-color": "#0f172a",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1,
        },
      },
      styleLoadedRef,
    );

    bindPoiInteractions(map);
  };

  const applyStyleChangeRef = useRef(async () => {});
  applyStyleChangeRef.current = async (styleCandidate) => {
    const map = mapRef.current;
    if (!map) return;

    const requestToken = ++styleRequestTokenRef.current;
    const { style: nextStyle, usedFallback } =
      await resolveMapStyle(styleCandidate);

    if (!mapRef.current || map !== mapRef.current) return;
    if (requestToken !== styleRequestTokenRef.current) return;

    cancelPendingStyledataListeners(map);
    clearPoiLayerListeners(map);
    fallbackStyleAppliedRef.current = !maptilerKey || usedFallback;
    setSelectedPoi(null);
    setMapReady(false);

    const onStyleData = () => {
      pendingStyledataListenersRef.current =
        pendingStyledataListenersRef.current.filter(
          (listener) => listener !== onStyleData,
        );

      if (!mapRef.current || map !== mapRef.current) return;

      styleLoadedRef.current = true;

      const finishRehydrate = () => {
        if (!mapRef.current || map !== mapRef.current) return;
        if (!isStyleReady(map, styleLoadedRef)) {
          scheduleWhenStyleReady(map, finishRehydrate);
          return;
        }

        rehydrateStyle(map);
        setMapReady(true);
      };

      finishRehydrate();
    };

    registerStyledataListener(map, onStyleData);
    styleLoadedRef.current = false;
    map.setStyle(nextStyle);
    styleLoadedRef.current = false;
  };

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    let cancelled = false;
    fallbackStyleAppliedRef.current = !maptilerKey;

    if (!maptilerKey) {
      console.warn(
        "VITE_MAPTILER_KEY is not set. Using OpenStreetMap fallback.",
      );
    }

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: deepClone(FALLBACK_STYLE),
      center,
      zoom: 15,
      pitch: 50,
      bearing: -17,
      antialias: true,
      attributionControl: false,
      fadeDuration: 0,
      trackResize: true,
      renderWorldCopies: false,
      maxTileCacheSize: 50,
    });

    mapRef.current = map;

    const handleError = (event) => {
      console.error("MapLibre error:", event);

      if (fallbackStyleAppliedRef.current) return;
      if (!shouldFallbackToOsm(event)) return;

      fallbackStyleAppliedRef.current = true;
      void applyStyleChangeRef.current(FALLBACK_STYLE);
    };

    const handleZoomEnd = () => {
      const zoom = map.getZoom();
      if (zoom > 18 && map.getPitch() < 45) {
        map.easeTo({ zoom: 18.5, pitch: 50, duration: 800 });
      }
    };

    const handleLoad = () => {
      if (cancelled) return;
      mapLoadedRef.current = true;
      styleLoadedRef.current = true;
      setMapReady(true);
      void applyStyleChangeRef.current(primaryStyleRequest);
    };

    map.on("error", handleError);
    map.on("zoomend", handleZoomEnd);
    map.on("load", handleLoad);

    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-right",
    );

    return () => {
      cancelled = true;
      setMapReady(false);
      styleLoadedRef.current = false;
      mapLoadedRef.current = false;
      cancelPendingStyledataListeners(map);
      clearPoiLayerListeners(map);
      map.off("error", handleError);
      map.off("zoomend", handleZoomEnd);
      map.off("load", handleLoad);
      map.remove();
      mapRef.current = null;
    };
  }, [center, maptilerKey, primaryStyleRequest]);

  useEffect(() => {
    if (!mapLoadedRef.current || !mapRef.current || !currentFloorId) return;
    void applyStyleChangeRef.current(primaryStyleRequest);
  }, [currentFloorId, primaryStyleRequest]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    scheduleWhenStyleReady(map, () => {
      updateOrCreateGeoSource(
        map,
        INDOOR_SPACES_SOURCE,
        indoorGeo.spacesGeo,
        styleLoadedRef,
      );
      updateOrCreateGeoSource(
        map,
        INDOOR_WALLS_SOURCE,
        indoorGeo.wallsGeo,
        styleLoadedRef,
      );
      updateOrCreateGeoSource(
        map,
        INDOOR_POI_SOURCE,
        indoorGeo.poiGeo,
        styleLoadedRef,
      );
    });
  }, [indoorGeo]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    scheduleWhenStyleReady(map, () => {
      updateOrCreateGeoSource(map, ROUTE_SOURCE, routeGeo, styleLoadedRef);
    });
  }, [routeGeo]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    scheduleWhenStyleReady(map, () => {
      reapplyImageOverlay(map);
    });
  }, [overlayConfig]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !routeGeo.features.length) return;

    let frame = null;

    const animate = () => {
      if (!mapRef.current || map !== mapRef.current) return;
      if (!isStyleReady(map, styleLoadedRef)) {
        frame = requestAnimationFrame(animate);
        return;
      }

      if (hasStyleLayer(map, ROUTE_LAYER, styleLoadedRef)) {
        const offset = (Date.now() / 50) % 16;
        map.setPaintProperty(ROUTE_LAYER, "line-dasharray", [2, 2 + offset]);
      }

      frame = requestAnimationFrame(animate);
    };

    frame = requestAnimationFrame(animate);

    return () => {
      if (frame) cancelAnimationFrame(frame);
    };
  }, [mapReady, routeGeo.features.length]);

  return (
    <div className="relative h-full w-full">
      <div ref={mapContainerRef} className="h-full w-full" />

      <div className="absolute right-4 top-4 z-[700] flex items-center gap-2">
        <button
          type="button"
          onClick={onExitBuilding}
          className="rounded-full bg-slate-200 px-4 py-2 text-sm font-medium text-slate-700"
        >
          Exit {building?.name || "Building"}
        </button>
        <button
          type="button"
          onClick={infoAction}
          className="grid h-9 w-9 place-items-center rounded-full bg-white text-slate-700 shadow"
        >
          <Info className="h-4 w-4" />
        </button>
      </div>

      <div className="absolute right-4 top-20 z-[700] hidden flex-col gap-2 md:flex">
        {[...floors]
          .sort((a, b) => Number(b.level || 0) - Number(a.level || 0))
          .map((floor) => {
            const active = floor.id === currentFloorId;
            return (
              <button
                key={floor.id}
                type="button"
                onClick={() => onFloorSelect?.(floor.id)}
                title={floor.name || `Level ${floor.level}`}
                className={`min-w-[56px] rounded-md border px-2 py-2 text-sm font-semibold ${
                  active
                    ? "border-blue-600 bg-blue-600 text-white"
                    : "border-slate-300 bg-white text-slate-700"
                }`}
              >
                {floorShortLabel(floor)}
              </button>
            );
          })}
      </div>

      <div className="absolute bottom-5 right-4 z-[700] flex flex-col gap-2">
        <button
          type="button"
          onClick={() => mapRef.current?.zoomIn()}
          className="grid h-9 w-9 place-items-center rounded-md bg-white shadow"
        >
          <Plus className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => mapRef.current?.zoomOut()}
          className="grid h-9 w-9 place-items-center rounded-md bg-white shadow"
        >
          <Minus className="h-4 w-4" />
        </button>
      </div>

      <div className="absolute bottom-5 left-4 z-[700] flex items-center gap-1 rounded-full bg-white px-3 py-2 text-xs text-slate-700 shadow">
        <span>English (US)</span>
        <ChevronDown className="h-3.5 w-3.5" />
      </div>

      <div className="absolute bottom-4 left-1/2 z-[700] -translate-x-1/2 text-xs text-slate-700">
        CampusNav • © MapTiler © OpenStreetMap contributors
      </div>

      {routeGeo.features.length > 0 && (
        <div className="absolute bottom-14 left-1/2 z-[710] w-[min(92vw,560px)] -translate-x-1/2 rounded-xl bg-white p-4 shadow">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
            <Navigation className="h-4 w-4 text-blue-600" />
            <span>Walk to {destinationLabel || "destination"}</span>
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {routeDistanceLabel} • ETA {routeEtaLabel}
          </div>
        </div>
      )}

      <div
        className={`absolute bottom-0 left-0 right-0 z-[720] rounded-t-2xl bg-white p-4 shadow-2xl transition-transform duration-300 ease-out ${
          selectedPoi ? "translate-y-0" : "pointer-events-none translate-y-full"
        }`}
      >
        {selectedPoi && (
          <>
            <div className="text-base font-semibold text-slate-900">
              {selectedPoi.name}
            </div>
            <div className="mt-1 text-sm text-slate-500">
              {selectedPoi.category}
            </div>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white"
                onClick={() => onPoiDirections?.(selectedPoi)}
              >
                Get Directions
              </button>
              <button
                type="button"
                className="rounded-md border border-slate-300 px-4 py-2 text-sm"
                onClick={() => setSelectedPoi(null)}
              >
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
