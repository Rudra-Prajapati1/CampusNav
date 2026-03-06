/**
 * Navigation Service for CampusNav
 *
 * Central service layer that orchestrates the complete navigation pipeline:
 * 1. Room & floor data fetching
 * 2. Graph loading (from cache or building fresh)
 * 3. Pathfinding (A* with Dijkstra fallback)
 * 4. Instruction generation
 * 5. Distance & ETA calculation
 *
 * This service encapsulates all navigation logic, keeping the route
 * handler thin and focused on HTTP concerns.
 *
 * Inspired by IWayPlus's service-oriented navigation architecture.
 */

import { supabase } from "../utils/supabase.js";
import { astar } from "../utils/astar.js";
import { dijkstra } from "../utils/pathfinding.js";
import {
  getOrBuildGraph,
  cacheRoute,
  getCachedRoute,
  clearGraph,
} from "../cache/graphCache.js";
import {
  generateInstructions,
  instructionsToSteps,
  calculateTotalDistance,
} from "../utils/instructionGenerator.js";

/**
 * Average human walking speed in meters per second.
 * Used for ETA calculation.
 * Source: typical indoor walking speed (slightly slower than outdoor 1.4 m/s
 * due to turns and obstacles)
 */
const WALKING_SPEED_MPS = 1.4;

/**
 * Additional time penalty per floor change in seconds.
 * Accounts for waiting for elevator, climbing stairs, etc.
 */
const FLOOR_CHANGE_PENALTY_SECONDS = 30;

/**
 * Default pixels-per-meter scale when floor doesn't specify.
 */
const DEFAULT_SCALE = 50;

/**
 * Calculate the full navigation route between two rooms.
 *
 * This is the main entry point for the navigation system.
 *
 * Pipeline:
 * 1. Fetch room and floor data from Supabase
 * 2. Determine building ID
 * 3. Load navigation graph (cached or build fresh)
 * 4. Find start/end waypoints for the rooms
 * 5. Check route cache for previously computed path
 * 6. Run A* pathfinding (with Dijkstra fallback)
 * 7. Convert pixel distances to meters using floor scale
 * 8. Generate turn-by-turn instructions
 * 9. Calculate ETA based on distance and floor changes
 * 10. Return complete route result
 *
 * @param {string} fromRoomId - Starting room UUID
 * @param {string} toRoomId - Destination room UUID
 * @param {string} [buildingId] - Optional building UUID (auto-detected if omitted)
 * @returns {Object} Complete route result
 */
export async function calculateRoute(fromRoomId, toRoomId, buildingId) {
  const startTime = Date.now();

  // ─── Step 1: Fetch room data ───────────────────────────────────────
  const [fromRoomResult, toRoomResult] = await Promise.all([
    supabase
      .from("rooms")
      .select("*, floors(id, building_id, level, name, scale_pixels_per_meter)")
      .eq("id", fromRoomId)
      .single(),
    supabase
      .from("rooms")
      .select("*, floors(id, building_id, level, name, scale_pixels_per_meter)")
      .eq("id", toRoomId)
      .single(),
  ]);

  const fromRoom = fromRoomResult.data;
  const toRoom = toRoomResult.data;

  if (!fromRoom) {
    throw new NavigationError("Starting room not found", "ROOM_NOT_FOUND");
  }
  if (!toRoom) {
    throw new NavigationError("Destination room not found", "ROOM_NOT_FOUND");
  }

  // ─── Step 2: Determine building ────────────────────────────────────
  const resolvedBuildingId = buildingId || fromRoom.floors?.building_id;
  if (!resolvedBuildingId) {
    throw new NavigationError(
      "Could not determine building",
      "BUILDING_NOT_FOUND",
    );
  }

  // ─── Step 3: Load navigation graph ────────────────────────────────
  const graphData = await getOrBuildGraph(resolvedBuildingId);
  const { graph, waypointMap, floors, waypoints } = graphData;

  if (!waypoints || waypoints.length === 0) {
    throw new NavigationError(
      "No navigation graph found. Please run Auto Nav and save the map in the admin panel.",
      "NO_GRAPH",
    );
  }

  // ─── Step 4: Find start and end waypoints ─────────────────────────
  const startWaypoint = waypoints.find((w) => w.room_id === fromRoomId);
  const endWaypoint = waypoints.find((w) => w.room_id === toRoomId);

  if (!startWaypoint) {
    throw new NavigationError(
      `No waypoint found for starting room "${fromRoom.name}". Run Auto Nav and save the map.`,
      "NO_START_WAYPOINT",
    );
  }
  if (!endWaypoint) {
    throw new NavigationError(
      `No waypoint found for destination "${toRoom.name}". Run Auto Nav and save the map.`,
      "NO_END_WAYPOINT",
    );
  }

  // ─── Step 5: Check route cache ───��────────────────────────────────
  const cachedRoute = getCachedRoute(
    resolvedBuildingId,
    startWaypoint.id,
    endWaypoint.id,
  );
  let pathResult;

  if (cachedRoute) {
    pathResult = { path: cachedRoute.path, distance: cachedRoute.distance };
  } else {
    // ─── Step 6: Run A* pathfinding ─────────────────────────────────
    pathResult = astar(graph, startWaypoint.id, endWaypoint.id, waypointMap);

    // Fallback to Dijkstra if A* fails (shouldn't happen, but safety net)
    if (!pathResult) {
      console.warn("⚠️ A* failed, falling back to Dijkstra");
      pathResult = dijkstra(graph, startWaypoint.id, endWaypoint.id);
    }

    if (!pathResult) {
      throw new NavigationError(
        "No path found. Make sure both floors have stairs/elevator waypoints, " +
          "run Auto Nav on each floor, and save both maps.",
        "NO_PATH",
      );
    }

    // Cache the computed route
    cacheRoute(
      resolvedBuildingId,
      startWaypoint.id,
      endWaypoint.id,
      pathResult,
    );
  }

  // ─── Step 7: Convert path IDs to waypoint objects ─────────────────
  const pathWaypoints = pathResult.path
    .map((wpId) => waypointMap[wpId])
    .filter(Boolean);

  // ─── Step 8: Calculate real-world distance ────────────────────────
  const floorScaleMap = new Map();
  floors.forEach((f) => {
    floorScaleMap.set(f.id, f.scale_pixels_per_meter || DEFAULT_SCALE);
  });

  const distanceMeters = calculatePathDistanceMeters(
    pathWaypoints,
    floorScaleMap,
  );

  // ─── Step 9: Generate instructions ────────────────────────────────
  const instructions = generateInstructions(
    pathWaypoints,
    fromRoom,
    toRoom,
    floors,
  );
  const steps = instructionsToSteps(instructions);

  // ─── Step 10: Calculate ETA ───────────────────────────────────────
  const floorsInvolved = [...new Set(pathWaypoints.map((wp) => wp.floor_id))];
  const floorChanges = countFloorChanges(pathWaypoints);

  const walkingTimeSeconds = distanceMeters / WALKING_SPEED_MPS;
  const floorChangePenalty = floorChanges * FLOOR_CHANGE_PENALTY_SECONDS;
  const totalTimeSeconds = walkingTimeSeconds + floorChangePenalty;
  const estimatedTimeMinutes = Math.max(1, Math.round(totalTimeSeconds / 60));

  const computeTime = Date.now() - startTime;
  console.log(
    `🧭 Route computed: ${fromRoom.name} → ${toRoom.name} | ` +
      `${Math.round(distanceMeters)}m | ${estimatedTimeMinutes}min | ` +
      `${pathWaypoints.length} waypoints | ${computeTime}ms`,
  );

  // ─── Return complete route result ─────────────────────────────────
  return {
    path: pathWaypoints,
    steps,
    instructions,
    distance: Math.round(distanceMeters),
    estimated_time: estimatedTimeMinutes,
    estimated_time_seconds: Math.round(totalTimeSeconds),
    floors_involved: floorsInvolved,
    floor_changes: floorChanges,
    from_room: fromRoom,
    to_room: toRoom,
    metadata: {
      algorithm: cachedRoute ? "cached" : "astar",
      compute_time_ms: computeTime,
      waypoint_count: pathWaypoints.length,
      graph_size: waypoints.length,
    },
  };
}

/**
 * Calculate the total path distance in meters, accounting for
 * different floor scales.
 *
 * Each segment's pixel distance is converted to meters using the
 * scale of the floor where that segment exists.
 *
 * @param {Array} pathWaypoints - Ordered waypoints in the path
 * @param {Map} floorScaleMap - Map of floor_id → scale_pixels_per_meter
 * @returns {number} Total distance in meters
 */
function calculatePathDistanceMeters(pathWaypoints, floorScaleMap) {
  let totalMeters = 0;

  for (let i = 1; i < pathWaypoints.length; i++) {
    const prev = pathWaypoints[i - 1];
    const curr = pathWaypoints[i];

    // Pixel distance
    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;
    const pixelDist = Math.sqrt(dx * dx + dy * dy);

    // Use the scale of the floor where this segment starts
    // For cross-floor segments, use a fixed estimate
    if (prev.floor_id !== curr.floor_id) {
      // Cross-floor distance: estimate ~5 meters per floor transition
      totalMeters += 5;
    } else {
      const scale = floorScaleMap.get(prev.floor_id) || DEFAULT_SCALE;
      totalMeters += pixelDist / scale;
    }
  }

  return totalMeters;
}

/**
 * Count the number of floor changes in a path.
 *
 * @param {Array} pathWaypoints - Ordered waypoints
 * @returns {number} Number of floor transitions
 */
function countFloorChanges(pathWaypoints) {
  let changes = 0;
  for (let i = 1; i < pathWaypoints.length; i++) {
    if (pathWaypoints[i].floor_id !== pathWaypoints[i - 1].floor_id) {
      changes++;
    }
  }
  return changes;
}

/**
 * Invalidate the navigation cache for a building.
 * Should be called when map data is modified.
 *
 * @param {string} buildingId - Building UUID
 */
export function invalidateBuildingCache(buildingId) {
  clearGraph(buildingId);
}

/**
 * Custom error class for navigation-specific errors.
 * Includes an error code for programmatic handling.
 */
export class NavigationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "NavigationError";
    this.code = code;
  }
}

export default {
  calculateRoute,
  invalidateBuildingCache,
  NavigationError,
};
