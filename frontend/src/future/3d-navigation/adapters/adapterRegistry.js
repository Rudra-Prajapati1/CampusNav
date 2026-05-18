// CampusNav update — adapterRegistry.js
import { leafletAdapter } from "./leafletAdapter.js";
import { mapLibreAdapter } from "./mapLibreAdapter.js";

export const navigationAdapters = {
  leaflet: leafletAdapter,
  maplibre: mapLibreAdapter,
};

export function resolveNavigationAdapter(requestedProvider = "maplibre") {
  const requested = navigationAdapters[requestedProvider] || leafletAdapter;

  if (requested.id === "leaflet" || requested.id === "maplibre") {
    return {
      adapter: requested,
      activeProvider: requested.id,
      requestedProvider,
      fallbackReason: "",
    };
  }

  return {
    adapter: leafletAdapter,
    activeProvider: "leaflet",
    requestedProvider,
    fallbackReason: `${requestedProvider} is not a supported runtime renderer, so CampusNav is using Leaflet instead.`,
  };
}
