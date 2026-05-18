<!-- CampusNav update — MAP_ARCHITECTURE.md -->
# CampusNav Map Architecture

## Current direction

- Product logic stays renderer-agnostic.
- Production navigation renderer is `src/components/navigation/MapLibreNavigationMap.jsx`.
- Dormant renderer/sensor experiments are archived under `src/future/*` and are intentionally excluded from active production imports.

## Separation of concerns

- `NavigatePage.jsx`
  - owns business flow: building selection, floor selection, indoor/outdoor mode, room search, routing, and route summaries.
- `MapLibreNavigationMap.jsx`
  - current production renderer for indoor/outdoor navigation.
- `src/future/3d-navigation/*`
  - archived alternate renderers, indoor canvas, and model experiments retained for future roadmap work.
- `src/future/sensor-fusion/*`
  - archived device-motion and orientation experiments retained for future positioning work.

## Recommended long-term stack

- Renderer: `MapLibre`
- Basemap provider: `MapTiler` first, self-hosted vector tiles later if scale demands it
- Experimental fallback (archived): `Leaflet + OSM/MapTiler`

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
