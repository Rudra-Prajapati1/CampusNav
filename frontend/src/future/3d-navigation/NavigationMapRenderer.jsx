// Archived experimental renderer selector.
// This module is intentionally isolated from production imports and kept for
// future renderer experiments and potential fallback implementations.
import LeafletNavigationMap from "./LeafletNavigationMap.jsx";
import MapLibreNavigationMap from "../../components/navigation/MapLibreNavigationMap.jsx";

const rendererComponents = {
  leaflet: LeafletNavigationMap,
  maplibre: MapLibreNavigationMap,
};

export default function NavigationMapRenderer({ provider, ...props }) {
  const Renderer = rendererComponents[provider] || MapLibreNavigationMap;
  return <Renderer {...props} />;
}
