import express from "express";
import { supabase } from "../utils/supabase.js";
import { requireAdmin } from "../middleware/auth.js";
import graphCache from "../cache/graphCache.js";

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
  const {
    rooms = [],
    waypoints = [],
    connections = [],
    scale_pixels_per_meter,
  } = req.body;

  try {
    await supabase.from("waypoint_connections").delete().eq("floor_id", floorId);
    await supabase.from("waypoints").delete().eq("floor_id", floorId);
    await supabase.from("rooms").delete().eq("floor_id", floorId);

    if (rooms.length > 0) {
      const { error } = await supabase.from("rooms").insert(
        rooms.map((r) => ({
          id: r.id,
          floor_id: floorId,
          name: r.name || "Unnamed",
          type: r.type || "other",
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          color: r.color || null,
          description: r.description || "",
          polygon_points: r.polygon_points || null,
        })),
      );
      if (error) throw error;
    }

    if (waypoints.length > 0) {
      const { error } = await supabase.from("waypoints").insert(
        waypoints.map((w) => ({
          id: w.id,
          floor_id: floorId,
          room_id: w.room_id || null,
          x: w.x,
          y: w.y,
          type: w.type || "room_center",
          name: w.name || "",
          linked_floor_id: w.linked_floor_id || null,
        })),
      );
      if (error) throw error;
    }

    if (connections.length > 0) {
      const { error } = await supabase.from("waypoint_connections").insert(
        connections.map((c) => ({
          id: c.id,
          floor_id: floorId,
          waypoint_a_id: c.waypoint_a_id,
          waypoint_b_id: c.waypoint_b_id,
        })),
      );
      if (error) throw error;
    }

    if (scale_pixels_per_meter) {
      const { error } = await supabase
        .from("floors")
        .update({ scale_pixels_per_meter })
        .eq("id", floorId);
      if (error) throw error;
    }

    const { data: floor } = await supabase
      .from("floors")
      .select("building_id")
      .eq("id", floorId)
      .single();

    if (floor?.building_id) graphCache.invalidate(floor.building_id);

    res.json({
      success: true,
      rooms: rooms.length,
      waypoints: waypoints.length,
      connections: connections.length,
    });
  } catch (err) {
    console.error("save-map error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
