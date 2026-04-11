import express from "express";
import { supabase } from "../utils/supabase.js";
import { requireAdmin } from "../middleware/auth.js";
import graphCache from "../cache/graphCache.js";
import { autoTraceFloorPlan } from "../services/floorPlanAutoTrace.js";
import { normalizeSaveMapPayload } from "../utils/mapPersistence.js";

const router = express.Router();

// Public: Get floor with all rooms and waypoints
router.get("/:id", async (req, res) => {
  const { data: floor, error } = await supabase
    .from("floors")
    .select("*")
    .eq("id", req.params.id)
    .single();

  if (error) return res.status(404).json({ error: "Floor not found" });

  const { data: rooms } = await supabase
    .from("rooms")
    .select("*")
    .eq("floor_id", req.params.id);

  const { data: waypoints } = await supabase
    .from("waypoints")
    .select("*")
    .eq("floor_id", req.params.id);

  const { data: connections } = await supabase
    .from("waypoint_connections")
    .select("*")
    .eq("floor_id", req.params.id);

  res.json({ ...floor, rooms, waypoints, connections });
});

// Public: Get all floors for a building
router.get("/building/:buildingId", async (req, res) => {
  const { data, error } = await supabase
    .from("floors")
    .select("*")
    .eq("building_id", req.params.buildingId)
    .order("level", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Admin: Create floor
router.post("/", requireAdmin, async (req, res) => {
  const {
    building_id,
    name,
    level,
    floor_plan_url,
    floor_plan_width,
    floor_plan_height,
  } = req.body;

  const { data, error } = await supabase
    .from("floors")
    .insert({
      building_id,
      name,
      level,
      floor_plan_url,
      floor_plan_width,
      floor_plan_height,
    })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// Admin: Update floor (including floor plan image URL)
router.put("/:id", requireAdmin, async (req, res) => {
  const updates = req.body;

  const { data, error } = await supabase
    .from("floors")
    .update(updates)
    .eq("id", req.params.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// Admin: Generate an editable draft from the uploaded floor plan image
router.post("/:id/auto-trace", requireAdmin, async (req, res) => {
  try {
    const { data: floor, error } = await supabase
      .from("floors")
      .select("id, floor_plan_url")
      .eq("id", req.params.id)
      .single();

    if (error || !floor) {
      return res.status(404).json({ error: "Floor not found" });
    }

    const traced = await autoTraceFloorPlan(floor.floor_plan_url);
    res.json(traced);
  } catch (error) {
    res.status(400).json({ error: error.message || "Auto trace failed" });
  }
});

// Admin: Delete floor
router.delete("/:id", requireAdmin, async (req, res) => {
  const { error } = await supabase
    .from("floors")
    .delete()
    .eq("id", req.params.id);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

// Admin: Save entire floor map (rooms + waypoints + connections in one call)
router.post("/:id/save-map", requireAdmin, async (req, res) => {
  const { id: floorId } = req.params;

  try {
    const { data: existingFloor, error: floorError } = await supabase
      .from("floors")
      .select("id, building_id, map_data, scale_pixels_per_meter")
      .eq("id", floorId)
      .single();

    if (floorError || !existingFloor) {
      return res.status(404).json({ error: "Floor not found" });
    }

    const normalized = normalizeSaveMapPayload(floorId, req.body || {});

    await supabase.from("waypoint_connections").delete().eq("floor_id", floorId);
    await supabase.from("waypoints").delete().eq("floor_id", floorId);
    await supabase.from("rooms").delete().eq("floor_id", floorId);

    if (normalized.rooms.length > 0) {
      const { error } = await supabase.from("rooms").insert(
        normalized.rooms.map((room) => ({
          id: room.id,
          floor_id: room.floor_id,
          name: room.name,
          type: room.type,
          x: room.x,
          y: room.y,
          width: room.width,
          height: room.height,
          color: room.color,
          description: room.description,
          polygon_points: room.polygon_points,
        })),
      );
      if (error) throw error;
    }

    if (normalized.waypoints.length > 0) {
      const { error } = await supabase.from("waypoints").insert(
        normalized.waypoints.map((waypoint) => ({
          id: waypoint.id,
          floor_id: waypoint.floor_id,
          room_id: waypoint.room_id,
          x: waypoint.x,
          y: waypoint.y,
          type: waypoint.type,
          name: waypoint.name,
          linked_floor_id: waypoint.linked_floor_id,
        })),
      );
      if (error) throw error;
    }

    if (normalized.connections.length > 0) {
      const { error } = await supabase.from("waypoint_connections").insert(
        normalized.connections.map((connection) => ({
          id: connection.id,
          floor_id: connection.floor_id,
          waypoint_a_id: connection.waypoint_a_id,
          waypoint_b_id: connection.waypoint_b_id,
        })),
      );
      if (error) throw error;
    }

    const floorUpdates = {};
    if ("map_data" in (req.body || {})) {
      floorUpdates.map_data = normalized.map_data;
    }
    if ("scale_pixels_per_meter" in (req.body || {})) {
      floorUpdates.scale_pixels_per_meter = normalized.scale_pixels_per_meter;
    }

    let updatedFloor = existingFloor;
    if (Object.keys(floorUpdates).length > 0) {
      const { data, error } = await supabase
        .from("floors")
        .update(floorUpdates)
        .eq("id", floorId)
        .select("*")
        .single();

      if (error) throw error;
      updatedFloor = data;
    }

    if (existingFloor?.building_id) graphCache.invalidate(existingFloor.building_id);

    res.json({
      success: true,
      floor: updatedFloor,
      rooms: normalized.rooms.length,
      waypoints: normalized.waypoints.length,
      connections: normalized.connections.length,
    });
  } catch (err) {
    console.error("save-map error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
