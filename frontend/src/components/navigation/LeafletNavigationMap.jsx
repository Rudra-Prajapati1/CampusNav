// CampusNav update — LeafletNavigationMap.jsx
import { useEffect } from "react";
import {
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Building2, ZoomIn, ZoomOut } from "lucide-react";
import IndoorCanvas from "./IndoorCanvas.jsx";
import { leafletAdapter } from "./adapters/leafletAdapter.js";

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

function FitMapToPoints({ mode, points, fallbackCenter, fallbackZoom = 18 }) {
  const map = useMap();

  useEffect(() => {
    if (mode !== "outdoor") return;
    if (points?.length > 1) {
      map.fitBounds(points, { padding: [46, 46], maxZoom: 20 });
    } else if (fallbackCenter) {
      map.setView(fallbackCenter, fallbackZoom, { animate: true });
    }
  }, [fallbackCenter, fallbackZoom, map, mode, points]);

  return null;
}

function IndoorModeFlyTo({ active, center, zoom = 19 }) {
  const map = useMap();

  useEffect(() => {
    if (!active || !center) return;
    map.flyTo(center, zoom, { animate: true, duration: 0.8 });
  }, [active, center, map, zoom]);

  return null;
}

function OutdoorMapControls() {
  const map = useMap();

  return (
    <div className="absolute bottom-4 right-4 z-[500] flex flex-col gap-2">
      <button onClick={() => map.zoomIn()} className="btn-secondary px-3">
        <ZoomIn className="h-4 w-4" />
      </button>
      <button onClick={() => map.zoomOut()} className="btn-secondary px-3">
        <ZoomOut className="h-4 w-4" />
      </button>
    </div>
  );
}

function IndoorOverlayLayer({
  mode,
  hasGeoAnchor,
  roomPickTarget,
  overlayVisible,
  floorData,
  floorImage,
  currentFloorPath,
  fromRoom,
  toRoom,
  currentFloor,
  isDark,
  currentOverlayBounds,
  selectRoom,
  viewMode,
  sensorPosition,
  showBeacons,
}) {
  const map = useMap();

  return (
    <div
      className="absolute inset-0"
      style={{
        zIndex: mode === "indoor" ? 10 : -1,
        pointerEvents:
          mode !== "indoor"
            ? "none"
            : hasGeoAnchor
              ? roomPickTarget
                ? "auto"
                : "none"
              : "auto",
        opacity: mode === "indoor" ? (overlayVisible ? 1 : 0) : 0,
        transition: "opacity 0.3s ease-out, z-index 0s",
        mixBlendMode: hasGeoAnchor ? "multiply" : "normal",
      }}
    >
      {!hasGeoAnchor && <div className="absolute inset-0 bg-bg" />}
      {floorData ? (
        <IndoorCanvas
          floorData={floorData}
          floorImage={floorImage}
          pathPoints={currentFloorPath}
          fromRoom={fromRoom}
          toRoom={toRoom}
          currentFloorId={currentFloor?.id}
          isDark={isDark}
          mapInstance={map}
          overlayBounds={currentOverlayBounds}
          interactive={Boolean(roomPickTarget)}
          onRoomPick={roomPickTarget ? selectRoom : undefined}
          viewMode={viewMode}
          sensorPosition={sensorPosition}
          showBeacons={showBeacons}
          className="h-full w-full"
        />
      ) : (
        <div className="flex h-full items-center justify-center px-6">
          <div className="card-sm flex items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            <span className="text-sm subtle-text">Loading indoor map...</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function LeafletNavigationMap({
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
  if (entranceCenter) {
    return (
      <MapContainer
        center={entranceCenter}
        zoom={18}
        minZoom={3}
        maxZoom={22}
        zoomControl={false}
        style={{
          width: "100%",
          height: "100%",
          zIndex: mode === "outdoor" ? 1 : 0,
        }}
      >
        <TileLayer {...leafletAdapter.getTileLayerProps()} />
        <FitMapToPoints
          mode={mode}
          points={outdoorFitPoints}
          fallbackCenter={entranceCenter}
        />
        <IndoorModeFlyTo active={mode === "indoor"} center={entranceCenter} />
        {userLocation && (
          <Marker
            position={userLocation}
            icon={leafletAdapter.createPinIcon("#16A34A")}
          />
        )}
        {building?.entrance_lat && building?.entrance_lng && (
          <Marker
            position={[
              Number.parseFloat(building.entrance_lat),
              Number.parseFloat(building.entrance_lng),
            ]}
            icon={leafletAdapter.createPinIcon("#2563EB")}
          />
        )}
        {outdoorRoute?.length > 0 && (
          <Polyline
            positions={outdoorRoute}
            pathOptions={{ color: "#2563EB", weight: 6, opacity: 0.88 }}
          />
        )}
        {mode === "outdoor" && <OutdoorMapControls />}
        <IndoorOverlayLayer
          mode={mode}
          hasGeoAnchor={hasGeoAnchor}
          roomPickTarget={roomPickTarget}
          overlayVisible={overlayVisible}
          floorData={floorData}
          floorImage={floorImage}
          currentFloorPath={currentFloorPath}
          fromRoom={fromRoom}
          toRoom={toRoom}
          currentFloor={currentFloor}
          isDark={isDark}
          currentOverlayBounds={currentOverlayBounds}
          selectRoom={selectRoom}
          viewMode={viewMode}
          sensorPosition={sensorPosition}
          showBeacons={showBeacons}
        />
      </MapContainer>
    );
  }

  if (mode === "indoor") {
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
          <div className="flex h-full items-center justify-center px-6">
            <div className="card-sm flex items-center gap-3">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              <span className="text-sm subtle-text">Loading indoor map...</span>
            </div>
          </div>
        )}
      </div>
    );
  }

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
