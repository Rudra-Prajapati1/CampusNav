# Future 3D Navigation

This folder preserves the inactive indoor 3D and spatial visualization stack.
It is not part of the production navigation bundle today.

The code here is retained for future work on:

- Indoor 3D rendering and 2.5D visualization.
- Three.js-based floor previews.
- Spatial metadata that can support AR/navigation experiences.
- Reusable indoor map-model normalization for richer renderers.

Reactivation checklist:

- Add a feature flag or separate experimental route.
- Confirm `three` and any required control/helper modules are installed.
- Verify route-level code splitting so 3D assets stay out of normal navigation
  and landing bundles.
- Run a production build and navigation smoke test before shipping.
