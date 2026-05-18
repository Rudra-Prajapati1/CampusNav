// CampusNav update — mapLibreAdapter.js
import { MAPLIBRE_STYLE } from "../mapProviderConfig.js";

export function toMapLibreLngLat(coords = []) {
  return [coords[1], coords[0]];
}

export function buildMapLibreProjectionBridge(mapInstance) {
  if (
    !mapInstance ||
    typeof mapInstance.project !== "function" ||
    typeof mapInstance.on !== "function" ||
    typeof mapInstance.off !== "function"
  ) {
    return null;
  }

  return {
    latLngToContainerPoint: ([lat, lng]) => mapInstance.project([lng, lat]),
    subscribeViewportChange: (handler) => {
      const events = ["move", "zoom", "resize", "rotate", "pitch"];
      events.forEach((eventName) => mapInstance.on(eventName, handler));
      return () => {
        events.forEach((eventName) => mapInstance.off(eventName, handler));
      };
    },
  };
}

export const mapLibreAdapter = {
  id: "maplibre",
  label: "MapLibre",
  status: "active",
  supports: {
    mapInitialization: true,
    cameraMovement: true,
    markerRendering: true,
    polylineRendering: true,
    overlayBoundsProjection: true,
    floorOverlayAnchoring: true,
  },
  getMapOptions(center) {
    return {
      style: MAPLIBRE_STYLE,
      center: center ? toMapLibreLngLat(center) : [72.8777, 19.076],
      zoom: 18,
      minZoom: 3,
      maxZoom: 22,
      pitch: 45,
      bearing: -17,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
    };
  },
  toLngLat: toMapLibreLngLat,
  buildProjectionBridge: buildMapLibreProjectionBridge,
  getImageOverlayCoordinates(bounds) {
    return [
      [bounds.west, bounds.north],
      [bounds.east, bounds.north],
      [bounds.east, bounds.south],
      [bounds.west, bounds.south],
    ];
  },
};
