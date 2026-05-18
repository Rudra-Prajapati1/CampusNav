// CampusNav update — leafletAdapter.js
import L from "leaflet";
import {
  TILE_ATTRIBUTION,
  TILE_URL,
  USE_MAPTILER,
} from "../mapProviderConfig.js";

export function buildLeafletProjectionBridge(mapInstance) {
  if (
    !mapInstance ||
    typeof mapInstance.latLngToContainerPoint !== "function" ||
    typeof mapInstance.on !== "function" ||
    typeof mapInstance.off !== "function"
  ) {
    return null;
  }

  return {
    latLngToContainerPoint: (coords) => mapInstance.latLngToContainerPoint(coords),
    subscribeViewportChange: (handler) => {
      mapInstance.on("move zoom resize", handler);
      return () => mapInstance.off("move zoom resize", handler);
    },
  };
}

export function createLeafletPinIcon(color, size = 16) {
  return L.divIcon({
    className: "",
    html: `<div style="width:${size}px;height:${size}px;background:${color};border:3px solid white;border-radius:999px;box-shadow:0 8px 20px rgba(15,23,42,0.2)"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

export const leafletAdapter = {
  id: "leaflet",
  label: "Leaflet",
  status: "active",
  supports: {
    mapInitialization: true,
    cameraMovement: true,
    markerRendering: true,
    polylineRendering: true,
    overlayBoundsProjection: true,
    floorOverlayAnchoring: true,
  },
  getTileLayerProps() {
    return {
      url: TILE_URL,
      attribution: TILE_ATTRIBUTION,
      maxZoom: 22,
      maxNativeZoom: USE_MAPTILER ? 22 : 19,
      tileSize: USE_MAPTILER ? 512 : 256,
      zoomOffset: USE_MAPTILER ? -1 : 0,
    };
  },
  createPinIcon: createLeafletPinIcon,
  buildProjectionBridge: buildLeafletProjectionBridge,
};
