/**
 * Dijkstra's shortest path algorithm for CampusNav
 * Works on a graph of waypoints (nodes) connected by edges
 */

export function dijkstra(graph, startId, endId) {
  const distances = {};
  const previous = {};
  const visited = new Set();
  const nodes = Object.keys(graph);

  // Initialize distances
  nodes.forEach(node => {
    distances[node] = Infinity;
    previous[node] = null;
  });
  distances[startId] = 0;

  while (true) {
    // Find unvisited node with smallest distance
    let current = null;
    let smallestDist = Infinity;
    nodes.forEach(node => {
      if (!visited.has(node) && distances[node] < smallestDist) {
        smallestDist = distances[node];
        current = node;
      }
    });

    if (!current || current === endId) break;
    visited.add(current);

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

  // Reconstruct path
  const path = [];
  let current = endId;
  while (current) {
    path.unshift(current);
    current = previous[current];
  }

  if (path[0] !== startId) return null; // No path found

  return {
    path,
    distance: distances[endId]
  };
}

/**
 * Build a navigation graph from waypoints and connections
 * @param {Array} waypoints - Array of {id, x, y, floor_id}
 * @param {Array} connections - Array of {waypoint_a_id, waypoint_b_id}
 */
export function buildGraph(waypoints, connections) {
  const graph = {};
  const waypointMap = {};

  waypoints.forEach(wp => {
    graph[wp.id] = [];
    waypointMap[wp.id] = wp;
  });

  connections.forEach(conn => {
    const a = waypointMap[conn.waypoint_a_id];
    const b = waypointMap[conn.waypoint_b_id];
    if (!a || !b) return;

    // Euclidean distance as weight
    const weight = Math.sqrt(
      Math.pow(b.x - a.x, 2) + Math.pow(b.y - a.y, 2)
    );

    graph[conn.waypoint_a_id].push({ node: conn.waypoint_b_id, weight });
    graph[conn.waypoint_b_id].push({ node: conn.waypoint_a_id, weight });
  });

  return { graph, waypointMap };
}

/**
 * Auto-generate waypoints along room perimeter and corridor centers
 * Called when admin saves a room to auto-create navigation nodes
 */
export function generateRoomWaypoint(room) {
  // Center point of the room as its navigation waypoint
  return {
    x: room.x + room.width / 2,
    y: room.y + room.height / 2,
    floor_id: room.floor_id,
    room_id: room.id,
    type: 'room_center'
  };
}

/**
 * Find nearest waypoint to a given coordinate
 */
export function findNearestWaypoint(x, y, waypoints) {
  let nearest = null;
  let minDist = Infinity;

  waypoints.forEach(wp => {
    const dist = Math.sqrt(Math.pow(wp.x - x, 2) + Math.pow(wp.y - y, 2));
    if (dist < minDist) {
      minDist = dist;
      nearest = wp;
    }
  });

  return nearest;
}
