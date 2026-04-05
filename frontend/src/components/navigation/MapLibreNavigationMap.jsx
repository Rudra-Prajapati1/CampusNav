// CampusNav update — MapLibreNavigationMap.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  Building2,
  Layers,
  RotateCcw,
  RotateCw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import IndoorCanvas from "./IndoorCanvas.jsx";
import { mapLibreAdapter } from "./adapters/mapLibreAdapter.js";

const ROUTE_SOURCE_ID = "campusnav-outdoor-route";
const ROUTE_LAYER_ID = "campusnav-outdoor-route-layer";
const FLOOR_IMAGE_SOURCE_ID = "campusnav-floor-image";
const FLOOR_IMAGE_LAYER_ID = "campusnav-floor-image-layer";
const FOCUS_BUILDING_SOURCE_ID = "campusnav-focus-building";
const FOCUS_BUILDING_LAYER_ID = "campusnav-focus-building-layer";

function createMarkerElement(color) {
  const marker = document.createElement("div");
  marker.style.width = "16px";
  marker.style.height = "16px";
  marker.style.borderRadius = "999px";
  marker.style.background = color;
  marker.style.border = "3px solid white";
  marker.style.boxShadow = "0 8px 20px rgba(15,23,42,0.2)";
  return marker;
}

function upsertGeoJsonLine(map, coordinates) {
  const data = {
    type: "FeatureCollection",
    features: coordinates?.length
      ? [
          {
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates,
            },
          },
        ]
      : [],
  };

  const source = map.getSource(ROUTE_SOURCE_ID);
  if (source) {
    source.setData(data);
    return;
  }

  map.addSource(ROUTE_SOURCE_ID, {
    type: "geojson",
    data,
  });

  map.addLayer({
    id: ROUTE_LAYER_ID,
    type: "line",
    source: ROUTE_SOURCE_ID,
    paint: {
      "line-color": "#2563EB",
      "line-width": 6,
      "line-opacity": 0.88,
    },
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
  });
}

function removeRouteLayer(map) {
  if (map.getLayer(ROUTE_LAYER_ID)) map.removeLayer(ROUTE_LAYER_ID);
  if (map.getSource(ROUTE_SOURCE_ID)) map.removeSource(ROUTE_SOURCE_ID);
}

function upsertFloorImageOverlay(map, imageUrl, bounds) {
  const coordinates = mapLibreAdapter.getImageOverlayCoordinates(bounds);
  const existingSource = map.getSource(FLOOR_IMAGE_SOURCE_ID);

  if (existingSource?.updateImage) {
    existingSource.updateImage({ url: imageUrl, coordinates });
  } else {
    if (map.getLayer(FLOOR_IMAGE_LAYER_ID)) map.removeLayer(FLOOR_IMAGE_LAYER_ID);
    if (map.getSource(FLOOR_IMAGE_SOURCE_ID)) map.removeSource(FLOOR_IMAGE_SOURCE_ID);

    map.addSource(FLOOR_IMAGE_SOURCE_ID, {
      type: "image",
      url: imageUrl,
      coordinates,
    });
  }

  if (!map.getLayer(FLOOR_IMAGE_LAYER_ID)) {
    map.addLayer({
      id: FLOOR_IMAGE_LAYER_ID,
      type: "raster",
      source: FLOOR_IMAGE_SOURCE_ID,
      paint: {
        "raster-opacity": 0.28,
      },
    });
  }
}

function removeFloorImageOverlay(map) {
  if (map.getLayer(FLOOR_IMAGE_LAYER_ID)) map.removeLayer(FLOOR_IMAGE_LAYER_ID);
  if (map.getSource(FLOOR_IMAGE_SOURCE_ID)) map.removeSource(FLOOR_IMAGE_SOURCE_ID);
}

function buildingFeature(bounds, entranceCenter) {
  const safeBounds = bounds
    ? bounds
    : entranceCenter
      ? {
          north: entranceCenter[0] + 0.00008,
          south: entranceCenter[0] - 0.00008,
          east: entranceCenter[1] + 0.00008,
          west: entranceCenter[1] - 0.00008,
        }
      : null;

  if (!safeBounds) return null;

  return {
    type: "Feature",
    properties: {
      extrusionHeight: 28,
      baseHeight: 0,
    },
    geometry: {
      type: "Polygon",
      coordinates: [[
        [safeBounds.west, safeBounds.north],
        [safeBounds.east, safeBounds.north],
        [safeBounds.east, safeBounds.south],
        [safeBounds.west, safeBounds.south],
        [safeBounds.west, safeBounds.north],
      ]],
    },
  };
}

function upsertFocusBuildingExtrusion(map, bounds, entranceCenter) {
  const feature = buildingFeature(bounds, entranceCenter);

  if (!feature) {
    if (map.getLayer(FOCUS_BUILDING_LAYER_ID)) map.removeLayer(FOCUS_BUILDING_LAYER_ID);
    if (map.getSource(FOCUS_BUILDING_SOURCE_ID)) map.removeSource(FOCUS_BUILDING_SOURCE_ID);
    return;
  }

  const data = {
    type: "FeatureCollection",
    features: [feature],
  };

  const source = map.getSource(FOCUS_BUILDING_SOURCE_ID);
  if (source) {
    source.setData(data);
  } else {
    map.addSource(FOCUS_BUILDING_SOURCE_ID, {
      type: "geojson",
      data,
    });
  }

  if (!map.getLayer(FOCUS_BUILDING_LAYER_ID)) {
    map.addLayer({
      id: FOCUS_BUILDING_LAYER_ID,
      type: "fill-extrusion",
      source: FOCUS_BUILDING_SOURCE_ID,
      minzoom: 15,
      paint: {
        "fill-extrusion-color": [
          "interpolate",
          ["linear"],
          ["zoom"],
          15,
          "#93C5FD",
          18.5,
          "#2563EB",
        ],
        "fill-extrusion-height": ["get", "extrusionHeight"],
        "fill-extrusion-base": ["get", "baseHeight"],
        "fill-extrusion-opacity": 0.78,
      },
    });
  }
}

function LoadingIndoorState() {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="card-sm flex items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        <span className="text-sm subtle-text">Loading indoor map...</span>
      </div>
    </div>
  );
}

export default function MapLibreNavigationMap({
  mode,
  entranceCenter,
  building,
  floorData,
  floorImage,
  currentFloorPath,
  fromRoom,
  toRoom,
  currentFloor,
  isDark,
  currentOverlayBounds,
  roomPickTarget,
  overlayVisible,
  selectRoom,
  hasGeoAnchor,
  outdoorFitPoints,
  outdoorRoute,
  userLocation,
  viewMode = "2d",
  sensorPosition = null,
  showBeacons = true,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const entranceMarkerRef = useRef(null);
  const userMarkerRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapBridge, setMapBridge] = useState(null);
  const [mapZoom, setMapZoom] = useState(17);

  const shouldUseMapOverlay = Boolean(hasGeoAnchor);
  const autoIndoorReveal = shouldUseMapOverlay && mapZoom >= 18.15;
  const indoorVisible = shouldUseMapOverlay
    ? mapZoom >= 18.05 && (mode === "indoor" || autoIndoorReveal)
    : mode === "indoor" || (!entranceCenter && floorData);
  const floorImageUrl =
    floorData?.floor_plan_url ||
    floorData?.map_data?.floors?.find((entry) => entry.id === floorData?.id)?.backgroundDataUrl ||
    null;
  const outdoorRouteCoordinates = useMemo(
    () => (outdoorRoute || []).map(mapLibreAdapter.toLngLat),
    [outdoorRoute],
  );

  useEffect(() => {
    if (!containerRef.current || mapRef.current || !entranceCenter) return undefined;

    const map = new maplibregl.Map({
      container: containerRef.current,
      ...mapLibreAdapter.getMapOptions(entranceCenter, isDark),
    });

    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-left",
    );

    map.on("load", () => {
      setMapReady(true);
      setMapBridge(mapLibreAdapter.buildProjectionBridge(map));
      setMapZoom(map.getZoom());
    });

    const syncViewport = () => setMapZoom(map.getZoom());
    map.on("move", syncViewport);

    mapRef.current = map;

    return () => {
      map.off("move", syncViewport);
      entranceMarkerRef.current?.remove();
      entranceMarkerRef.current = null;
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
      setMapBridge(null);
      setMapReady(false);
      map.remove();
      mapRef.current = null;
    };
  }, [entranceCenter, isDark]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;

    if (outdoorFitPoints?.length > 1 && mode === "outdoor") {
      const bounds = new maplibregl.LngLatBounds();
      outdoorFitPoints.forEach((point) =>
        bounds.extend(mapLibreAdapter.toLngLat(point)),
      );
      map.fitBounds(bounds, { padding: 46, maxZoom: 20, duration: 800 });
      return;
    }

    if (entranceCenter && mode === "outdoor") {
      map.easeTo({
        center: mapLibreAdapter.toLngLat(entranceCenter),
        zoom: 18,
        duration: 800,
      });
    }
  }, [entranceCenter, mapReady, mode, outdoorFitPoints]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !entranceCenter || mode !== "indoor") return;

    map.easeTo({
      center: mapLibreAdapter.toLngLat(entranceCenter),
      zoom: 19,
      pitch: 55,
      duration: 900,
    });
  }, [entranceCenter, mapReady, mode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !entranceCenter || !roomPickTarget) return;
    if (map.getZoom() >= 18.2) return;

    map.easeTo({
      center: mapLibreAdapter.toLngLat(entranceCenter),
      zoom: 19,
      pitch: 55,
      duration: 650,
    });
  }, [entranceCenter, mapReady, roomPickTarget]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;

    if (!building?.entrance_lat || !building?.entrance_lng) {
      entranceMarkerRef.current?.remove();
      entranceMarkerRef.current = null;
      return;
    }

    const lngLat = [
      Number.parseFloat(building.entrance_lng),
      Number.parseFloat(building.entrance_lat),
    ];

    if (!entranceMarkerRef.current) {
      entranceMarkerRef.current = new maplibregl.Marker({
        element: createMarkerElement("#2563EB"),
      })
        .setLngLat(lngLat)
        .addTo(map);
      return;
    }

    entranceMarkerRef.current.setLngLat(lngLat);
  }, [building?.entrance_lat, building?.entrance_lng, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;

    if (!userLocation) {
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
      return;
    }

    const lngLat = mapLibreAdapter.toLngLat(userLocation);
    if (!userMarkerRef.current) {
      userMarkerRef.current = new maplibregl.Marker({
        element: createMarkerElement("#16A34A"),
      })
        .setLngLat(lngLat)
        .addTo(map);
      return;
    }

    userMarkerRef.current.setLngLat(lngLat);
  }, [mapReady, userLocation]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;

    if (!outdoorRouteCoordinates.length) {
      removeRouteLayer(map);
      return;
    }

    upsertGeoJsonLine(map, outdoorRouteCoordinates);
  }, [mapReady, outdoorRouteCoordinates]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    upsertFocusBuildingExtrusion(map, currentOverlayBounds, entranceCenter);
  }, [currentOverlayBounds, entranceCenter, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;

    const visible =
      indoorVisible &&
      shouldUseMapOverlay &&
      Boolean(currentOverlayBounds) &&
      Boolean(floorImageUrl);

    if (!visible) {
      removeFloorImageOverlay(map);
      return;
    }

    upsertFloorImageOverlay(map, floorImageUrl, currentOverlayBounds);
  }, [
    currentOverlayBounds,
    floorImageUrl,
    mapReady,
    indoorVisible,
    shouldUseMapOverlay,
  ]);

  if (!entranceCenter && mode === "indoor") {
    return (
      <div className="absolute inset-0 bg-bg">
        {floorData ? (
          <IndoorCanvas
            floorData={floorData}
            floorImage={floorImage}
            pathPoints={currentFloorPath}
            fromRoom={fromRoom}
            toRoom={toRoom}
            currentFloorId={currentFloor?.id}
            isDark={isDark}
            interactive={Boolean(roomPickTarget)}
            onRoomPick={roomPickTarget ? selectRoom : undefined}
            viewMode={viewMode}
            sensorPosition={sensorPosition}
            showBeacons={showBeacons}
            className="h-full w-full"
          />
        ) : (
          <LoadingIndoorState />
        )}
      </div>
    );
  }

  if (!entranceCenter) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="card max-w-lg text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-accent-light text-accent">
            <Building2 className="h-6 w-6" />
          </div>
          <h2 className="mt-6 text-2xl font-bold tracking-[-0.02em]">
            Entrance coordinates missing
          </h2>
          <p className="mt-3 text-sm subtle-text">
            Ask an administrator to set the building entrance latitude and
            longitude before using outdoor navigation.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full" />

      {mapReady && (
        <div className="absolute bottom-4 right-4 z-[500] flex flex-col gap-2">
          <button
            type="button"
            onClick={() => mapRef.current?.zoomIn()}
            className="btn-secondary px-3"
            title="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => mapRef.current?.zoomOut()}
            className="btn-secondary px-3"
            title="Zoom out"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() =>
              mapRef.current?.easeTo({
                pitch: mapRef.current.getPitch() > 10 ? 0 : 55,
                duration: 500,
              })
            }
            className="btn-secondary px-3"
            title="Toggle tilt"
          >
            <Layers className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() =>
              mapRef.current?.easeTo({
                bearing: (mapRef.current.getBearing() || 0) - 30,
                duration: 400,
              })
            }
            className="btn-secondary px-3"
            title="Rotate left"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() =>
              mapRef.current?.easeTo({
                bearing: (mapRef.current.getBearing() || 0) + 30,
                duration: 400,
              })
            }
            className="btn-secondary px-3"
            title="Rotate right"
          >
            <RotateCw className="h-4 w-4" />
          </button>
        </div>
      )}

      <div
        className="absolute inset-0"
        style={{
          zIndex: indoorVisible ? 10 : -1,
          pointerEvents:
            !indoorVisible
              ? "none"
              : shouldUseMapOverlay
                ? roomPickTarget
                  ? "auto"
                  : "none"
                : "auto",
          opacity: indoorVisible ? (overlayVisible || autoIndoorReveal ? 1 : 0) : 0,
          transition: "opacity 0.3s ease-out, z-index 0s",
          mixBlendMode: shouldUseMapOverlay ? "multiply" : "normal",
        }}
      >
        {!shouldUseMapOverlay && <div className="absolute inset-0 bg-bg" />}
        {floorData ? (
          <IndoorCanvas
            floorData={floorData}
            floorImage={shouldUseMapOverlay ? null : floorImage}
            pathPoints={currentFloorPath}
            fromRoom={fromRoom}
            toRoom={toRoom}
            currentFloorId={currentFloor?.id}
            isDark={isDark}
            mapAdapter={mapBridge}
            overlayBounds={currentOverlayBounds}
            interactive={Boolean(roomPickTarget)}
            onRoomPick={roomPickTarget ? selectRoom : undefined}
            viewMode={viewMode}
            sensorPosition={sensorPosition}
            showBeacons={showBeacons}
            className="h-full w-full"
          />
        ) : (
          <LoadingIndoorState />
        )}
      </div>
    </div>
  );
}
