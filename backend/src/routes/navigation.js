/**
 * Navigation Route Handler for CampusNav
 *
 * Provides HTTP endpoints for indoor navigation.
 * This is a thin controller layer that delegates all logic to navigationService.
 *
 * Endpoints:
 *   POST /api/v1/navigation/route  — Calculate navigation route
 *   POST /api/v1/navigation/invalidate-cache — Clear cached graph for a building
 *   GET  /api/v1/navigation/cache-stats — View cache statistics (admin)
 *
 * Backward compatible with existing frontend API.
 */

import express from "express";
import {
  calculateRoute,
  invalidateBuildingCache,
  NavigationError,
} from "../services/navigationService.js";
import { getCacheStats } from "../cache/graphCache.js";
import { requireAdmin } from "../middleware/auth.js";

const router = express.Router();

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function haversineMeters(fromLat, fromLng, toLat, toLng) {
  const R = 6371000;
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRad(toLat - fromLat);
  const dLng = toRad(toLng - fromLng);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(fromLat)) *
      Math.cos(toRad(toLat)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

function fallbackOutdoorRoute(fromLat, fromLng, toLat, toLng, message) {
  const distance = haversineMeters(fromLat, fromLng, toLat, toLng);
  return {
    coordinates: [
      [fromLng, fromLat],
      [toLng, toLat],
    ],
    distance,
    duration: Math.max(1, Math.round(distance / 84)),
    fallback: true,
    message,
  };
}

/**
 * POST /api/v1/navigation/route
 *
 * Calculate the optimal navigation route between two rooms.
 *
 * Request body:
 * {
 *   from_room_id: string (required) — Starting room UUID
 *   to_room_id: string (required)   — Destination room UUID
 *   building_id: string (optional)  — Building UUID (auto-detected from rooms)
 * }
 *
 * Response:
 * {
 *   path: Array<Waypoint>          — Ordered waypoints along the route
 *   steps: Array<string>           — Simple text step descriptions (backward compat)
 *   instructions: Array<Object>    — Detailed instruction objects with icons, types, etc.
 *   distance: number               — Total distance in meters
 *   estimated_time: number         — ETA in minutes
 *   estimated_time_seconds: number — ETA in seconds (more precise)
 *   floors_involved: Array<string> — Floor IDs the route passes through
 *   floor_changes: number          — Number of floor transitions
 *   from_room: Object              — Starting room data
 *   to_room: Object                — Destination room data
 *   metadata: Object               — Performance and debug info
 * }
 */
router.post("/route", async (req, res) => {
  const { from_room_id, to_room_id, building_id } = req.body;

  // Input validation
  if (!from_room_id || !to_room_id) {
    return res.status(400).json({
      error: "from_room_id and to_room_id are required",
    });
  }

  // Same room check
  if (from_room_id === to_room_id) {
    return res.status(400).json({
      error: "Start and destination rooms are the same",
    });
  }

  try {
    // Delegate all logic to the navigation service
    const result = await calculateRoute(from_room_id, to_room_id, building_id);

    res.json(result);
  } catch (err) {
    // Handle navigation-specific errors with appropriate status codes
    if (err instanceof NavigationError) {
      const statusMap = {
        ROOM_NOT_FOUND: 404,
        BUILDING_NOT_FOUND: 404,
        NO_GRAPH: 400,
        NO_START_WAYPOINT: 400,
        NO_END_WAYPOINT: 400,
        NO_PATH: 400,
      };

      const status = statusMap[err.code] || 400;
      return res.status(status).json({
        error: err.message,
        code: err.code,
      });
    }

    // Unexpected errors
    console.error("Navigation error:", err);
    res.status(500).json({
      error: "An error occurred while calculating the route",
      message: err.message,
    });
  }
});

// GET /api/v1/navigation/outdoor-route
// Proxies OpenRouteService to keep API key server-side
router.get("/outdoor-route", async (req, res) => {
  const fromLat = toNumber(req.query.fromLat);
  const fromLng = toNumber(req.query.fromLng);
  const toLat = toNumber(req.query.toLat);
  const toLng = toNumber(req.query.toLng);

  if (fromLat === null || fromLng === null || toLat === null || toLng === null) {
    return res.status(400).json({ error: "Missing coordinates" });
  }

  const ORS_KEY = process.env.ORS_API_KEY;
  if (!ORS_KEY) {
    return res.json(
      fallbackOutdoorRoute(
        fromLat,
        fromLng,
        toLat,
        toLng,
        "ORS_API_KEY not set. Showing a direct route instead.",
      ),
    );
  }

  try {
    const url =
      "https://api.openrouteservice.org/v2/directions/foot-walking" +
      `?start=${fromLng},${fromLat}&end=${toLng},${toLat}`;
    const response = await fetch(url, {
      headers: { Authorization: ORS_KEY, Accept: "application/geo+json" },
    });
    if (!response.ok) {
      const text = await response.text();
      return res.json(
        fallbackOutdoorRoute(
          fromLat,
          fromLng,
          toLat,
          toLng,
          `OpenRouteService error. Showing a direct route instead. ${text}`,
        ),
      );
    }

    const data = await response.json();
    const coords = data.features?.[0]?.geometry?.coordinates || [];
    const summary = data.features?.[0]?.properties?.summary || {};
    res.json({
      coordinates: coords,
      distance: Math.round(summary.distance || 0),
      duration: Math.round((summary.duration || 0) / 60),
    });
  } catch (err) {
    console.error("ORS proxy error:", err);
    res.json(
      fallbackOutdoorRoute(
        fromLat,
        fromLng,
        toLat,
        toLng,
        `Could not reach OpenRouteService. Showing a direct route instead. ${err.message}`,
      ),
    );
  }
});

/**
 * POST /api/v1/navigation/invalidate-cache
 *
 * Invalidate the cached navigation graph for a building.
 * Should be called after map data is modified (e.g., after save-map).
 *
 * Admin only.
 *
 * Request body:
 * {
 *   building_id: string (required) — Building UUID to invalidate
 * }
 */
router.post("/invalidate-cache", requireAdmin, async (req, res) => {
  const { building_id } = req.body;

  if (!building_id) {
    return res.status(400).json({ error: "building_id is required" });
  }

  try {
    invalidateBuildingCache(building_id);
    res.json({
      success: true,
      message: `Navigation cache cleared for building ${building_id}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/v1/navigation/cache-stats
 *
 * Returns cache statistics for monitoring and debugging.
 * Admin only.
 */
router.get("/cache-stats", requireAdmin, async (req, res) => {
  try {
    const stats = getCacheStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
