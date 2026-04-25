import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Info, Plus, Minus, ChevronDown, Navigation } from "lucide-react";
import { MAPLIBRE_STYLE } from "./mapProviderConfig.js";

const OUTDOOR_EXTRUSION_ID = "building-extrusion";
const INDOOR_SPACES_SOURCE = "indoor-spaces";
const INDOOR_WALLS_SOURCE = "indoor-walls";
const INDOOR_POI_SOURCE = "indoor-pois";
const ROUTE_SOURCE = "indoor-route";
const ROUTE_LAYER = "route-line";

function solveLinearSystem(matrix, vector) {
  const n = matrix.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);

  for (let i = 0; i < n; i += 1) {
    let maxRow = i;
    for (let j = i + 1; j < n; j += 1) {
      if (Math.abs(augmented[j][i]) > Math.abs(augmented[maxRow][i])) {
        maxRow = j;
      }
    }
    if (Math.abs(augmented[maxRow][i]) < 1e-12) return null;
    [augmented[i], augmented[maxRow]] = [augmented[maxRow], augmented[i]];
    const pivot = augmented[i][i];
    for (let col = i; col <= n; col += 1) augmented[i][col] /= pivot;
    for (let row = 0; row < n; row += 1) {
      if (row === i) continue;
      const factor = augmented[row][i];
      for (let col = i; col <= n; col += 1) {
        augmented[row][col] -= factor * augmented[i][col];
      }
    }
  }

  return augmented.map((row) => row[n]);
}

function homographyFromCorners(pixelCorners, geoCorners) {
  if (pixelCorners.length !== 4 || geoCorners.length !== 4) return null;
  const matrix = [];
  const vector = [];

  for (let i = 0; i < 4; i += 1) {
    const [x, y] = pixelCorners[i];
    const [lng, lat] = geoCorners[i];

    matrix.push([x, y, 1, 0, 0, 0, -x * lng, -y * lng]);
    vector.push(lng);

    matrix.push([0, 0, 0, x, y, 1, -x * lat, -y * lat]);
    vector.push(lat);
  }

  const solved = solveLinearSystem(matrix, vector);
  if (!solved) return null;
  return [
    [solved[0], solved[1], solved[2]],
    [solved[3], solved[4], solved[5]],
    [solved[6], solved[7], 1],
  ];
}

function applyHomography(H, x, y) {
  if (!H) return null;
  const denom = H[2][0] * x + H[2][1] * y + H[2][2];
  if (Math.abs(denom) < 1e-10) return null;
  const lng = (H[0][0] * x + H[0][1] * y + H[0][2]) / denom;
  const lat = (H[1][0] * x + H[1][1] * y + H[1][2]) / denom;
  return [lng, lat];
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
          return {
            type: "Feature",
            id: feature.id,
            properties: {
              name: feature.properties?.name || "Room",
              category,
              kind,
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
          return {
            type: "Feature",
            id: feature.id,
            properties: {
              name: feature.properties?.label || kind,
              category: kind,
              kind,
            },
            geometry: { type: "Point", coordinates: point },
          };
        })
        .filter(Boolean),
    ],
  };

  return { spacesGeo, wallsGeo, poiGeo };
}

function colorForCategory(category) {
  const value = String(category || "").toLowerCase();
  if (value.includes("dining") || value.includes("canteen")) return "#f59e0b";
  if (value.includes("retail") || value.includes("store")) return "#8b5cf6";
  if (value.includes("exit") || value.includes("entrance")) return "#22c55e";
  if (value.includes("stairs") || value.includes("elevator")) return "#2563eb";
  return "#64748b";
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

function buildPinSvgDataUrl(category) {
  const color = colorForCategory(category);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="18" fill="${color}"/><circle cx="32" cy="32" r="18" fill="none" stroke="#ffffff" stroke-width="5"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function registerGlobalImageMissingHandler(map) {
  const pending = new Set();

  const handler = (event) => {
    const id = event.id;
    if (!id?.startsWith("pin-")) return;
    if (map.hasImage(id)) return;
    if (pending.has(id)) return;

    const category = id.replace("pin-", "");
    pending.add(id);
    const image = new window.Image(64, 64);
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        pending.delete(id);
        return;
      }

      ctx.clearRect(0, 0, 64, 64);
      ctx.drawImage(image, 0, 0, 64, 64);

      if (!map.hasImage(id)) {
        map.addImage(id, ctx.getImageData(0, 0, 64, 64));
      }

      pending.delete(id);
    };

    image.onerror = () => {
      pending.delete(id);
    };

    image.src = buildPinSvgDataUrl(category);
  };

  map.on("styleimagemissing", handler);
  return () => map.off("styleimagemissing", handler);
}

function updateOrCreateGeoSource(map, id, data) {
  const source = map.getSource(id);
  if (source) {
    source.setData(data);
    return;
  }
  map.addSource(id, { type: "geojson", data });
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

  if (coordinates.length < 2)
    return { type: "FeatureCollection", features: [] };

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
  const [mapReady, setMapReady] = useState(false);
  const [selectedPoi, setSelectedPoi] = useState(null);

  const maptilerKey = import.meta.env.VITE_MAPTILER_KEY || "";
  const style = maptilerKey
    ? `https://api.maptiler.com/maps/streets/style.json?key=${maptilerKey}`
    : MAPLIBRE_STYLE;

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

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style,
      center,
      zoom: 15,
      pitch: 50,
      bearing: -17,
      antialias: true,
      attributionControl: false,
    });

    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-right",
    );

    const cleanupImageMissing = registerGlobalImageMissingHandler(map);

    map.on("load", () => {
      setMapReady(true);

      if (
        map.getSource("openmaptiles") &&
        !map.getLayer(OUTDOOR_EXTRUSION_ID)
      ) {
        map.addLayer({
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
        });
      }

      updateOrCreateGeoSource(map, INDOOR_SPACES_SOURCE, indoorGeo.spacesGeo);
      updateOrCreateGeoSource(map, INDOOR_WALLS_SOURCE, indoorGeo.wallsGeo);
      updateOrCreateGeoSource(map, INDOOR_POI_SOURCE, indoorGeo.poiGeo);
      updateOrCreateGeoSource(map, ROUTE_SOURCE, routeGeo);

      if (!map.getLayer("indoor-floor")) {
        map.addLayer({
          id: "indoor-floor",
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
        });
      }

      if (!map.getLayer("indoor-rooms")) {
        map.addLayer({
          id: "indoor-rooms",
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
        });
      }

      if (!map.getLayer("indoor-walls")) {
        map.addLayer({
          id: "indoor-walls",
          type: "line",
          source: INDOOR_WALLS_SOURCE,
          paint: {
            "line-color": "#374151",
            "line-width": ["interpolate", ["linear"], ["zoom"], 17, 0.5, 18, 2],
            "line-opacity": ["interpolate", ["linear"], ["zoom"], 17, 0, 18, 1],
          },
        });
      }

      if (!map.getLayer("poi-pins")) {
        map.addLayer({
          id: "poi-pins",
          type: "symbol",
          source: INDOOR_POI_SOURCE,
          layout: {
            "icon-image": ["concat", "pin-", ["get", "category"]],
            "icon-size": 1.2,
            "icon-allow-overlap": true,
            "text-field": ["get", "name"],
            "text-size": 11,
            "text-offset": [0, 1.5],
            "text-anchor": "top",
          },
          paint: {
            "text-color": "#0f172a",
            "text-halo-color": "#ffffff",
            "text-halo-width": 1,
          },
        });
      }

      if (!map.getLayer(ROUTE_LAYER)) {
        map.addLayer({
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
        });
      }

      map.on("click", "poi-pins", (event) => {
        const feature = event.features?.[0];
        if (!feature) return;
        setSelectedPoi({
          id: feature.id,
          name: feature.properties?.name,
          category: feature.properties?.category,
          kind: feature.properties?.kind,
          coordinates: feature.geometry?.coordinates,
        });
        if (onPoiSelect) onPoiSelect(feature);
      });

      map.on("mouseenter", "poi-pins", () => {
        map.getCanvas().style.cursor = "pointer";
      });

      map.on("mouseleave", "poi-pins", () => {
        map.getCanvas().style.cursor = "";
      });

      map.on("zoomend", () => {
        const zoom = map.getZoom();
        if (zoom > 18 && map.getPitch() < 45) {
          map.easeTo({ zoom: 18.5, pitch: 50, duration: 800 });
        }
      });
    });

    mapRef.current = map;

    return () => {
      cleanupImageMissing();
      map.remove();
      mapRef.current = null;
    };
  }, [
    center,
    indoorGeo.poiGeo,
    indoorGeo.spacesGeo,
    indoorGeo.wallsGeo,
    onPoiSelect,
    routeGeo,
    style,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    updateOrCreateGeoSource(map, INDOOR_SPACES_SOURCE, indoorGeo.spacesGeo);
    updateOrCreateGeoSource(map, INDOOR_WALLS_SOURCE, indoorGeo.wallsGeo);
    updateOrCreateGeoSource(map, INDOOR_POI_SOURCE, indoorGeo.poiGeo);
  }, [indoorGeo, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    updateOrCreateGeoSource(map, ROUTE_SOURCE, routeGeo);
  }, [mapReady, routeGeo]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !routeGeo.features.length) return;

    let frame;
    const animate = () => {
      const offset = (Date.now() / 50) % 16;
      if (map.getLayer(ROUTE_LAYER)) {
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
        CampusNav • © Maptiler © OpenStreetMap contributors
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
          selectedPoi ? "translate-y-0" : "translate-y-full pointer-events-none"
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
