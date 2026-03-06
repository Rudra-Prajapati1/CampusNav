import express from "express";
import { supabase } from "../utils/supabase.js";
import { dijkstra, buildGraph } from "../utils/pathfinding.js";

const router = express.Router();

router.post("/route", async (req, res) => {
  const { from_room_id, to_room_id, building_id } = req.body;

  if (!from_room_id || !to_room_id) {
    return res
      .status(400)
      .json({ error: "from_room_id and to_room_id required" });
  }

  try {
    const { data: fromRoom } = await supabase
      .from("rooms")
      .select("*, floors(id, building_id, level, name)")
      .eq("id", from_room_id)
      .single();
    const { data: toRoom } = await supabase
      .from("rooms")
      .select("*, floors(id, building_id, level, name)")
      .eq("id", to_room_id)
      .single();

    if (!fromRoom || !toRoom) {
      return res.status(404).json({ error: "Room not found" });
    }

    const bldId = building_id || fromRoom.floors.building_id;

    // Get ALL floors for this building
    const { data: floors } = await supabase
      .from("floors")
      .select("*")
      .eq("building_id", bldId)
      .order("level");

    const floorIds = floors.map((f) => f.id);

    // Get ALL waypoints and connections across all floors
    const { data: waypoints } = await supabase
      .from("waypoints")
      .select("*")
      .in("floor_id", floorIds);

    const { data: connections } = await supabase
      .from("waypoint_connections")
      .select("*")
      .in("floor_id", floorIds);

    if (!waypoints || waypoints.length === 0) {
      return res
        .status(400)
        .json({
          error:
            "No navigation graph found. Please run Auto Nav and save the map in the admin panel.",
        });
    }

    const startWaypoint = waypoints.find((w) => w.room_id === from_room_id);
    const endWaypoint = waypoints.find((w) => w.room_id === to_room_id);

    if (!startWaypoint) {
      return res
        .status(400)
        .json({
          error: `No waypoint for starting room "${fromRoom.name}". Run Auto Nav and save the map.`,
        });
    }
    if (!endWaypoint) {
      return res
        .status(400)
        .json({
          error: `No waypoint for destination "${toRoom.name}". Run Auto Nav and save the map.`,
        });
    }

    // AUTO-CONNECT STAIRS/ELEVATORS ACROSS FLOORS
    const stairWaypoints = waypoints.filter(
      (w) => w.type === "stairs" || w.type === "elevator",
    );
    const extraConnections = [...(connections || [])];

    // Group stair waypoints by floor level
    const stairsByLevel = {};
    stairWaypoints.forEach((wp) => {
      const floor = floors.find((f) => f.id === wp.floor_id);
      if (!floor) return;
      if (!stairsByLevel[floor.level]) stairsByLevel[floor.level] = [];
      stairsByLevel[floor.level].push(wp);
    });

    // Connect stairs between every pair of adjacent floors
    const levels = Object.keys(stairsByLevel)
      .map(Number)
      .sort((a, b) => a - b);
    for (let i = 0; i < levels.length - 1; i++) {
      const stairsA = stairsByLevel[levels[i]];
      const stairsB = stairsByLevel[levels[i + 1]];
      stairsA.forEach((wpA) => {
        // Find nearest stair on next floor (same staircase = closest position)
        let nearest = stairsB[0];
        let minDist = Infinity;
        stairsB.forEach((wpB) => {
          const d = Math.sqrt((wpA.x - wpB.x) ** 2 + (wpA.y - wpB.y) ** 2);
          if (d < minDist) {
            minDist = d;
            nearest = wpB;
          }
        });
        if (nearest) {
          extraConnections.push({
            id: `xfloor_${wpA.id}_${nearest.id}`,
            waypoint_a_id: wpA.id,
            waypoint_b_id: nearest.id,
          });
        }
      });
    }

    const { graph, waypointMap } = buildGraph(waypoints, extraConnections);
    const result = dijkstra(graph, startWaypoint.id, endWaypoint.id);

    if (!result) {
      return res.status(400).json({
        error:
          "No path found. Make sure both floors have a Stairs room, run Auto Nav on each floor, and save both maps.",
      });
    }

    const pathDetails = result.path.map((wpId) => waypointMap[wpId]);
    const steps = generateSteps(pathDetails, fromRoom, toRoom, floors);
    const floorsInvolved = [...new Set(pathDetails.map((wp) => wp.floor_id))];

    res.json({
      path: pathDetails,
      steps,
      floors_involved: floorsInvolved,
      distance: Math.round(result.distance),
      from_room: fromRoom,
      to_room: toRoom,
    });
  } catch (err) {
    console.error("Navigation error:", err);
    res.status(500).json({ error: err.message });
  }
});

function generateSteps(path, fromRoom, toRoom, floors) {
  const steps = [];
  steps.push(`🚀 Start at ${fromRoom.name}`);
  let currentFloorId = path[0]?.floor_id;

  for (let i = 1; i < path.length; i++) {
    const wp = path[i];
    if (wp.floor_id !== currentFloorId) {
      const prevFloor = floors.find((f) => f.id === currentFloorId);
      const nextFloor = floors.find((f) => f.id === wp.floor_id);
      const goingUp = (nextFloor?.level ?? 0) > (prevFloor?.level ?? 0);
      const via = wp.type === "elevator" ? "🛗 elevator" : "🪜 stairs";
      steps.push(
        `Take the ${via} ${goingUp ? "up" : "down"} to ${nextFloor?.name || "next floor"}`,
      );
      currentFloorId = wp.floor_id;
    }
    if (i === path.length - 1) {
      steps.push(`🎯 Arrive at ${toRoom.name}`);
    }
  }
  return steps;
}

export default router;
