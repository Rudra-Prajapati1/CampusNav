// CampusNav update — mapProviderConfig.js
// Environment-driven renderer config. Product logic should use the adapter
// registry and avoid branching on renderer details directly.

export const MAP_PROVIDER =
  (import.meta.env.VITE_MAP_PROVIDER || "maplibre").toLowerCase();

export const SUPPORTED_MAP_PROVIDERS = ["leaflet", "maplibre"];

export const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY || "";
export const MAPTILER_MAPLIBRE_STYLE_URL =
  import.meta.env.VITE_MAPTILER_MAPLIBRE_STYLE_URL || "";

export const USE_MAPTILER = Boolean(MAPTILER_KEY);

export const MAPLIBRE_STYLE =
  MAPTILER_MAPLIBRE_STYLE_URL ||
  (MAPTILER_KEY
    ? `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}`
    : {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution:
              '&copy; <a href="https://www.openstreetmap.org">OpenStreetMap</a> contributors',
          },
        },
        layers: [
          {
            id: "osm-raster",
            type: "raster",
            source: "osm",
          },
        ],
      });

export const TILE_URL = USE_MAPTILER
  ? `https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=${MAPTILER_KEY}`
  : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

export const TILE_ATTRIBUTION = USE_MAPTILER
  ? '&copy; <a href="https://www.maptiler.com">MapTiler</a> &copy; <a href="https://www.openstreetmap.org">OpenStreetMap</a>'
  : '&copy; <a href="https://www.openstreetmap.org">OpenStreetMap</a> contributors';
