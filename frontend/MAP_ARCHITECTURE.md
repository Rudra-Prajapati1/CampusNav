<!-- CampusNav update — MAP_ARCHITECTURE.md -->
# CampusNav Map Architecture

## Current direction

- Product logic stays renderer-agnostic.
- Indoor map data is normalized through `src/components/navigation/indoorMapModel.js`.
- Renderer-specific code starts only inside:
  - `src/components/navigation/LeafletNavigationMap.jsx`
  - `src/components/navigation/MapLibreNavigationMap.jsx`
  - `src/components/navigation/adapters/*`

## Separation of concerns

- `NavigatePage.jsx`
  - owns business flow: building selection, floor selection, indoor/outdoor mode, room search, routing, and route summaries.
- `NavigationMapRenderer.jsx`
  - chooses the active renderer after adapter resolution.
- `adapters/*`
  - own renderer capabilities such as tile config, coordinate projection bridges, and renderer configuration requirements.
- `IndoorCanvas.jsx`
  - renders the canonical indoor map model and does not depend on a specific map library.
- `indoorMapModel.js`
  - defines the canonical indoor schema for rooms, doors, waypoints, paths, walls, beacons, floors, overlay bounds, and future 3D metadata.

## Recommended long-term stack

- Renderer: `MapLibre`
- Basemap provider: `MapTiler` first, self-hosted vector tiles later if scale demands it
- Development fallback: `Leaflet + OSM/MapTiler`

Why:

- `MapLibre` is the best long-term fit for custom indoor overlays and future 2.5D/3D work.
- `MapTiler` gives a practical hosted vector stack without relying on public OSM tile servers for production.
- Public OSM tiles should stay a dev/testing fallback only, not the SaaS production plan.

## Pointr-inspired direction

- Focus on workflow quality, not just rendering:
  - clean admin CMS flow
  - route clarity first
  - strong multi-floor transitions
  - clear room and POI semantics
  - 2.5D-ready geometry
  - beacon-aware positioning metadata
- CampusNav should treat the indoor map model as the source of truth so the same data can power:
  - 2D admin editing
  - 2D user navigation
  - future 2.5D and 3D preview
  - blue-dot positioning
