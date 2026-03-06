/**
 * Graph Builder for CampusNav
 *
 * Constructs a weighted navigation graph from waypoints and connections.
 * Handles multi-floor connectivity through stairs and elevators.
 *
 * Inspired by IWayPlus architecture:
 * - Corridor edges use pure Euclidean distance
 * - Stairs edges add a penalty of +30 to discourage unnecessary floor changes
 * - Elevator edges add a penalty of +20 (preferred over stairs)
 *
 * This penalty system ensures the router prefers same-floor paths
 * and chooses elevators over stairs when floor changes are necessary.
 */

import { supabase } from "./supabase.js";

/**
 * Edge weight penalties for different transition types.
 * These values are added ON TOP of the Euclidean distance.
 *
 * Rationale:
 * - Stairs are slow and physically demanding → highest penalty
 * - Elevators require waiting but are easier → moderate penalty
 * - Corridors are normal walking → no penalty
 */
const EDGE_PENALTIES = {
  stairs: 30,
  elevator: 20,
  corridor: 0,
  room_center: 0,
  manual: 0,
};

/**
 * Calculate Euclidean distance between two waypoints
 * @param {Object} a - Waypoint with x, y coordinates
 * @param {Object} b - Waypoint with x, y coordinates
 * @returns {number} Distance in pixels
 */
function calculateDistance(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Determine the edge weight between two waypoints.
 * Weight = Euclidean distance + type-based penalty
 *
 * @param {Object} wpA - First waypoint
 * @param {Object} wpB - Second waypoint
 * @returns {number} Weighted edge cost
 */
function calculateEdgeWeight(wpA, wpB) {
  const distance = calculateDistance(wpA, wpB);

  // Apply penalty based on waypoint types
  // If either endpoint is stairs/elevator, add the corresponding penalty
  let penalty = 0;

  if (wpA.type === "stairs" || wpB.type === "stairs") {
    penalty = EDGE_PENALTIES.stairs;
  } else if (wpA.type === "elevator" || wpB.type === "elevator") {
    penalty = EDGE_PENALTIES.elevator;
  }

  // For cross-floor connections (different floor_id), always apply penalty
  // This handles the case where stairs/elevator connects two floors
  if (wpA.floor_id !== wpB.floor_id) {
    // Use the higher penalty if not already set
    const crossFloorPenalty = Math.max(EDGE_PENALTIES.stairs, penalty);
    // If one of them is an elevator, use elevator penalty instead
    if (wpA.type === "elevator" || wpB.type === "elevator") {
      penalty = EDGE_PENALTIES.elevator;
    } else {
      penalty = crossFloorPenalty;
    }
  }

  return distance + penalty;
}

/**
 * Auto-connect stairs and elevator waypoints across adjacent floors.
 *
 * Strategy: For each stair/elevator waypoint on floor N, find the nearest
 * stair/elevator waypoint of the same type on floor N+1 and create a
 * virtual connection between them.
 *
 * This allows the pathfinding algorithm to navigate across floors
 * without requiring manual cross-floor connections.
 *
 * @param {Array} waypoints - All waypoints across all floors
 * @param {Array} floors - Floor data with level information
 * @returns {Array} Additional cross-floor connections
 */
function generateCrossFloorConnections(waypoints, floors) {
  const crossConnections = [];

  // Filter waypoints that can connect floors
  const transitionWaypoints = waypoints.filter(
    (wp) => wp.type === "stairs" || wp.type === "elevator",
  );

  if (transitionWaypoints.length === 0) return crossConnections;

  // Create a floor lookup map for quick level access
  const floorMap = new Map();
  floors.forEach((f) => floorMap.set(f.id, f));

  // Group transition waypoints by floor level
  const waypointsByLevel = new Map();
  transitionWaypoints.forEach((wp) => {
    const floor = floorMap.get(wp.floor_id);
    if (!floor) return;
    const level = floor.level;
    if (!waypointsByLevel.has(level)) {
      waypointsByLevel.set(level, []);
    }
    waypointsByLevel.get(level).push(wp);
  });

  // Sort levels in ascending order
  const levels = Array.from(waypointsByLevel.keys()).sort((a, b) => a - b);

  // Connect waypoints between adjacent floor levels
  for (let i = 0; i < levels.length - 1; i++) {
    const currentLevel = levels[i];
    const nextLevel = levels[i + 1];
    const currentWaypoints = waypointsByLevel.get(currentLevel);
    const nextWaypoints = waypointsByLevel.get(nextLevel);

    // For each transition waypoint on the current floor,
    // find the nearest matching type waypoint on the next floor
    for (const wpA of currentWaypoints) {
      let bestMatch = null;
      let bestDistance = Infinity;

      for (const wpB of nextWaypoints) {
        // Prefer matching types (stairs↔stairs, elevator↔elevator)
        // but allow cross-type if no match found
        const typeMatch = wpA.type === wpB.type;
        const dist = calculateDistance(wpA, wpB);

        // Prioritize same-type matches with a distance bonus
        const effectiveDist = typeMatch ? dist : dist + 100;

        if (effectiveDist < bestDistance) {
          bestDistance = effectiveDist;
          bestMatch = wpB;
        }
      }

      if (bestMatch) {
        crossConnections.push({
          id: `xfloor_${wpA.id}_${bestMatch.id}`,
          waypoint_a_id: wpA.id,
          waypoint_b_id: bestMatch.id,
          floor_id: wpA.floor_id, // Mark with source floor
          is_cross_floor: true,
        });
      }
    }
  }

  return crossConnections;
}

/**
 * Build a complete navigation graph for a building.
 *
 * This is the main entry point for graph construction.
 * It creates an adjacency list representation where each node
 * maps to an array of { node, weight } neighbors.
 *
 * @param {Array} waypoints - All waypoints in the building
 * @param {Array} connections - All waypoint connections (edges)
 * @param {Array} floors - All floor data for the building
 * @returns {{ graph: Object, waypointMap: Object }} The navigation graph and waypoint lookup
 */
export function buildNavigationGraph(waypoints, connections, floors) {
  const graph = {};
  const waypointMap = {};

  // Initialize graph nodes
  waypoints.forEach((wp) => {
    graph[wp.id] = [];
    waypointMap[wp.id] = wp;
  });

  // Generate cross-floor connections for stairs/elevators
  const crossFloorConnections = generateCrossFloorConnections(
    waypoints,
    floors,
  );

  // Merge all connections: explicit + auto-generated cross-floor
  const allConnections = [...connections, ...crossFloorConnections];

  // Deduplicate connections to avoid double edges
  const edgeSet = new Set();

  allConnections.forEach((conn) => {
    const aId = conn.waypoint_a_id;
    const bId = conn.waypoint_b_id;

    // Skip invalid connections
    if (!waypointMap[aId] || !waypointMap[bId]) return;

    // Create a canonical edge key for deduplication
    const edgeKey = aId < bId ? `${aId}_${bId}` : `${bId}_${aId}`;
    if (edgeSet.has(edgeKey)) return;
    edgeSet.add(edgeKey);

    const wpA = waypointMap[aId];
    const wpB = waypointMap[bId];

    // Calculate weighted edge cost
    const weight = calculateEdgeWeight(wpA, wpB);

    // Add bidirectional edges
    graph[aId].push({ node: bId, weight });
    graph[bId].push({ node: aId, weight });
  });

  return { graph, waypointMap };
}

/**
 * Fetch all navigation data for a building from Supabase
 * and build the complete graph.
 *
 * @param {string} buildingId - The building UUID
 * @returns {{ graph, waypointMap, floors, waypoints }}
 */
export async function buildGraphForBuilding(buildingId) {
  // Fetch all floors for this building
  const { data: floors, error: floorsError } = await supabase
    .from("floors")
    .select("*")
    .eq("building_id", buildingId)
    .order("level");

  if (floorsError)
    throw new Error(`Failed to fetch floors: ${floorsError.message}`);
  if (!floors || floors.length === 0) {
    throw new Error("No floors found for this building");
  }

  const floorIds = floors.map((f) => f.id);

  // Fetch all waypoints across all floors
  const { data: waypoints, error: wpError } = await supabase
    .from("waypoints")
    .select("*")
    .in("floor_id", floorIds);

  if (wpError) throw new Error(`Failed to fetch waypoints: ${wpError.message}`);

  // Fetch all connections across all floors
  const { data: connections, error: connError } = await supabase
    .from("waypoint_connections")
    .select("*")
    .in("floor_id", floorIds);

  if (connError)
    throw new Error(`Failed to fetch connections: ${connError.message}`);

  if (!waypoints || waypoints.length === 0) {
    throw new Error(
      "No navigation graph found. Please run Auto Nav and save the map in the admin panel.",
    );
  }

  // Build the graph
  const { graph, waypointMap } = buildNavigationGraph(
    waypoints,
    connections || [],
    floors,
  );

  return {
    graph,
    waypointMap,
    floors,
    waypoints,
    connections: connections || [],
  };
}

export default {
  buildNavigationGraph,
  buildGraphForBuilding,
  calculateDistance,
};
