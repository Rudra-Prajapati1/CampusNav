import express from "express";
import { randomUUID } from "crypto";
import { supabase } from "../utils/supabase.js";
import { requireAdmin } from "../middleware/auth.js";
import graphCache from "../cache/graphCache.js";
import { autoTraceFloorPlan } from "../services/floorPlanAutoTrace.js";
import { normalizeSaveMapPayload } from "../utils/mapPersistence.js";

const router = express.Router();

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function ensureUuid(value) {
  return isUuid(value) ? value : randomUUID();
}

function toNumber(value, fallback = null) {
  const parsed =
    typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function isFeatureCollection(value) {
  return (
    value &&
    typeof value === "object" &&
    value.type === "FeatureCollection" &&
    Array.isArray(value.features)
  );
}

function isMvfMapData(value) {
  if (!value || typeof value !== "object") return false;
  return (
    isFeatureCollection(value.spaces) &&
    isFeatureCollection(value.obstructions) &&
    isFeatureCollection(value.openings) &&
    isFeatureCollection(value.nodes) &&
    isFeatureCollection(value.objects)
  );
}

function ringToPolygonPoints(geometry) {
  const ring = ensureArray(geometry?.coordinates?.[0]);
  if (ring.length < 3) return null;
  const points = ring.map((coord) => ({
    x: toNumber(coord?.[0], 0),
    y: toNumber(coord?.[1], 0),
  }));
  return points.length >= 3 ? points : null;
}

function bboxFromPolygon(points) {
  if (!points?.length) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

function deriveWaypointTypeFromNode(feature) {
  const explicit = String(feature?.properties?.kind || "").toLowerCase();
  if (["stairs", "elevator", "entrance"].includes(explicit)) return explicit;
  if (feature?.properties?.spaceId) return "room_center";
  return "corridor";
}

function deriveFromMvf(mapData, floorId) {
  const roomIdMap = new Map();

  const rooms = mapData.spaces.features
    .filter(
      (feature) =>
        feature?.geometry?.type === "Polygon" &&
        ["room", "corridor"].includes(
          String(feature?.properties?.kind || "").toLowerCase(),
        ),
    )
    .map((feature, index) => {
      const id = ensureUuid(feature.id);
      roomIdMap.set(String(feature.id || id), id);
      const polygon = ringToPolygonPoints(feature.geometry);
      const box = bboxFromPolygon(polygon || []);
      return {
        id,
        floor_id: floorId,
        name: String(feature?.properties?.name || `Space ${index + 1}`),
        type: String(feature?.properties?.kind || "other"),
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        color: feature?.properties?.color || null,
        description: feature?.properties?.description || "",
        polygon_points: polygon,
      };
    });

  const nodeMap = new Map();
  const waypoints = mapData.nodes.features
    .filter((feature) => feature?.geometry?.type === "Point")
    .map((feature, index) => {
      const id = ensureUuid(feature.id);
      const coordinates = ensureArray(feature.geometry.coordinates);
      const x = toNumber(coordinates[0], 0);
      const y = toNumber(coordinates[1], 0);
      const type = deriveWaypointTypeFromNode(feature);
      const sourceSpaceId = feature?.properties?.spaceId;
      const roomId = sourceSpaceId
        ? roomIdMap.get(String(sourceSpaceId)) || null
        : null;

      const record = {
        id,
        floor_id: floorId,
        room_id: roomId,
        x,
        y,
        type,
        name: String(feature?.properties?.name || `Node ${index + 1}`),
        linked_floor_id: isUuid(feature?.properties?.linkedFloorId)
          ? feature.properties.linkedFloorId
          : null,
      };
      nodeMap.set(String(feature.id || id), record);
      nodeMap.set(id, record);
      return record;
    });

  const connectionSet = new Set();
  const connections = [];
  for (const feature of mapData.nodes.features) {
    const source = nodeMap.get(String(feature.id));
    if (!source) continue;
    const neighbors = ensureArray(feature?.properties?.neighbors);
    for (const neighbor of neighbors) {
      const target = nodeMap.get(String(neighbor?.id));
      if (!target || target.id === source.id) continue;
      const key = [source.id, target.id].sort().join(":");
      if (connectionSet.has(key)) continue;
      connectionSet.add(key);
      connections.push({
        id: randomUUID(),
        floor_id: floorId,
        waypoint_a_id: source.id,
        waypoint_b_id: target.id,
      });
    }
  }

  return {
    rooms,
    waypoints,
    connections,
    scale_pixels_per_meter: toNumber(mapData?.meta?.pixelsPerMeter, null),
  };
}

async function saveRelationalMapRecords(floorId, records) {
  await supabase.from("waypoint_connections").delete().eq("floor_id", floorId);
  await supabase.from("waypoints").delete().eq("floor_id", floorId);
  await supabase.from("rooms").delete().eq("floor_id", floorId);

  if (records.rooms.length > 0) {
    const { error } = await supabase.from("rooms").insert(
      records.rooms.map((room) => ({
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

  if (records.waypoints.length > 0) {
    const { error } = await supabase.from("waypoints").insert(
      records.waypoints.map((waypoint) => ({
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

  if (records.connections.length > 0) {
    const { error } = await supabase.from("waypoint_connections").insert(
      records.connections.map((connection) => ({
        id: connection.id,
        floor_id: connection.floor_id,
        waypoint_a_id: connection.waypoint_a_id,
        waypoint_b_id: connection.waypoint_b_id,
      })),
    );
    if (error) throw error;
  }
}

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

// Public: Get floor MVF map-data and georeference
router.get("/:id/map-data", async (req, res) => {
  try {
    const { data: floor, error: floorError } = await supabase
      .from("floors")
      .select("id, building_id, name, level, map_data, scale_pixels_per_meter")
      .eq("id", req.params.id)
      .single();

    if (floorError || !floor) {
      return res.status(404).json({ error: "Floor not found" });
    }

    const { data: georeference } = await supabase
      .from("map_georeferences")
      .select("*")
      .eq("floor_id", req.params.id)
      .maybeSingle();

    return res.json({
      floor_id: floor.id,
      building_id: floor.building_id,
      name: floor.name,
      level: floor.level,
      map_data: floor.map_data || null,
      georeference: georeference || null,
      scale_pixels_per_meter: floor.scale_pixels_per_meter,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ error: error.message || "Unable to load map data" });
  }
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

    const body = req.body || {};
    const hasMvf = isMvfMapData(body.map_data);
    const normalized = hasMvf
      ? {
          ...deriveFromMvf(body.map_data, floorId),
          map_data: body.map_data,
        }
      : normalizeSaveMapPayload(floorId, body);

    await saveRelationalMapRecords(floorId, normalized);

    const floorUpdates = {};
    if ("map_data" in body) {
      floorUpdates.map_data = normalized.map_data;
    }

    const requestedScale = toNumber(
      hasMvf
        ? body?.map_data?.meta?.pixelsPerMeter
        : body.scale_pixels_per_meter,
      null,
    );
    if (requestedScale !== null) {
      floorUpdates.scale_pixels_per_meter = requestedScale;
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

    if (existingFloor?.building_id)
      graphCache.invalidate(existingFloor.building_id);

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
