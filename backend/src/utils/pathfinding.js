/**
 * Pathfinding Utilities for CampusNav
 *
 * This module contains:
 * - Dijkstra's algorithm (kept as fallback for A*)
 * - Legacy buildGraph function (kept for backward compatibility)
 * - Utility functions for waypoint operations
 *
 * NOTE: For new navigation requests, the system uses:
 * - utils/astar.js for pathfinding (faster with heuristic)
 * - utils/graphBuilder.js for graph construction (handles penalties & cross-floor)
 * - services/navigationService.js for orchestration
 *
 * This file is preserved to avoid breaking any imports.
 */

/**
 * Dijkstra's shortest path algorithm.
 *
 * Used as a fallback when A* fails (e.g., if waypointMap is incomplete).
 * Unlike A*, Dijkstra explores all directions equally — it's slower
 * but guaranteed to work without a heuristic.
 *
 * Time complexity: O(V²) with array-based min extraction
 * (sufficient for graphs < 10,000 nodes)
 *
 * @param {Object} graph - Adjacency list: { nodeId: [{ node, weight }] }
 * @param {string} startId - Starting node ID
 * @param {string} endId - Goal node ID
 * @returns {{ path: string[], distance: number } | null} Shortest path or null
 */
export function dijkstra(graph, startId, endId) {
  const distances = {};
  const previous = {};
  const visited = new Set();
  const nodes = Object.keys(graph);

  // Validate that start and end exist in graph
  if (!graph[startId] || !graph[endId]) {
    return null;
  }

  // Initialize all distances to Infinity
  nodes.forEach((node) => {
    distances[node] = Infinity;
    previous[node] = null;
  });
  distances[startId] = 0;

  while (true) {
    // Find unvisited node with smallest distance
    // NOTE: A binary heap would be faster, but for fallback usage
    // this linear scan is acceptable
    let current = null;
    let smallestDist = Infinity;
    nodes.forEach((node) => {
      if (!visited.has(node) && distances[node] < smallestDist) {
        smallestDist = distances[node];
        current = node;
      }
    });

    // No more reachable nodes, or we've reached the goal
    if (!current || current === endId) break;
    visited.add(current);

    // Relax all edges from current node
    const neighbors = graph[current] || [];
    neighbors.forEach(({ node: neighbor, weight }) => {
      if (visited.has(neighbor)) return;
      const newDist = distances[current] + weight;
      if (newDist < distances[neighbor]) {
        distances[neighbor] = newDist;
        previous[neighbor] = current;
      }
    });
  }

  // Reconstruct path by following previous pointers
  const path = [];
  let current = endId;
  while (current) {
    path.unshift(current);
    current = previous[current];
  }

  // Verify path starts at the start node
  if (path[0] !== startId) return null;

  return {
    path,
    distance: distances[endId],
  };
}

/**
 * Build a navigation graph from waypoints and connections.
 *
 * LEGACY: This is the original graph builder kept for backward compatibility.
 * New code should use utils/graphBuilder.js → buildNavigationGraph() which
 * handles edge penalties for stairs/elevators and cross-floor connections.
 *
 * @param {Array} waypoints - Array of { id, x, y, floor_id }
 * @param {Array} connections - Array of { waypoint_a_id, waypoint_b_id }
 * @returns {{ graph: Object, waypointMap: Object }}
 */
export function buildGraph(waypoints, connections) {
  const graph = {};
  const waypointMap = {};

  waypoints.forEach((wp) => {
    graph[wp.id] = [];
    waypointMap[wp.id] = wp;
  });

  connections.forEach((conn) => {
    const a = waypointMap[conn.waypoint_a_id];
    const b = waypointMap[conn.waypoint_b_id];
    if (!a || !b) return;

    // Pure Euclidean distance (no penalties in legacy mode)
    const weight = Math.sqrt(Math.pow(b.x - a.x, 2) + Math.pow(b.y - a.y, 2));

    graph[conn.waypoint_a_id].push({ node: conn.waypoint_b_id, weight });
    graph[conn.waypoint_b_id].push({ node: conn.waypoint_a_id, weight });
  });

  return { graph, waypointMap };
}

/**
 * Generate a center waypoint for a room.
 * Used when admin creates a room to auto-create its navigation node.
 *
 * @param {Object} room - Room object with x, y, width, height, floor_id, id
 * @returns {Object} Waypoint data for the room center
 */
export function generateRoomWaypoint(room) {
  return {
    x: room.x + room.width / 2,
    y: room.y + room.height / 2,
    floor_id: room.floor_id,
    room_id: room.id,
    type: "room_center",
  };
}

/**
 * Find the nearest waypoint to a given coordinate.
 * Useful for "navigate from my current position" feature.
 *
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {Array} waypoints - Array of waypoints to search
 * @returns {Object|null} Nearest waypoint or null if array is empty
 */
export function findNearestWaypoint(x, y, waypoints) {
  if (!waypoints || waypoints.length === 0) return null;

  let nearest = null;
  let minDist = Infinity;

  waypoints.forEach((wp) => {
    const dist = Math.sqrt(Math.pow(wp.x - x, 2) + Math.pow(wp.y - y, 2));
    if (dist < minDist) {
      minDist = dist;
      nearest = wp;
    }
  });

  return nearest;
}

/**
 * Find the nearest waypoint on a specific floor.
 *
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {string} floorId - Floor UUID to filter by
 * @param {Array} waypoints - Array of all waypoints
 * @returns {Object|null} Nearest waypoint on the specified floor
 */
export function findNearestWaypointOnFloor(x, y, floorId, waypoints) {
  const floorWaypoints = waypoints.filter((wp) => wp.floor_id === floorId);
  return findNearestWaypoint(x, y, floorWaypoints);
}
