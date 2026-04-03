// CampusNav update — NavigationMapRenderer.jsx
import LeafletNavigationMap from "./LeafletNavigationMap.jsx";
import MapLibreNavigationMap from "./MapLibreNavigationMap.jsx";

const rendererComponents = {
  leaflet: LeafletNavigationMap,
  maplibre: MapLibreNavigationMap,
};

export default function NavigationMapRenderer({ provider, ...props }) {
  const Renderer = rendererComponents[provider] || MapLibreNavigationMap;
  return <Renderer {...props} />;
}
