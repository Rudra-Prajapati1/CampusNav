import express from "express";
import { supabase } from "../utils/supabase.js";
import { requireAdmin } from "../middleware/auth.js";

const router = express.Router();

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function scoreMatch(label, query) {
  const normalizedLabel = String(label || "").toLowerCase();
  const normalizedQuery = String(query || "").toLowerCase();
  if (!normalizedLabel || !normalizedQuery) return 0;
  if (normalizedLabel === normalizedQuery) return 300;
  if (normalizedLabel.startsWith(normalizedQuery)) return 220;
  if (normalizedLabel.includes(normalizedQuery)) return 120;
  return 0;
}

function extractPoiSearchResults(floors, query) {
  return floors.flatMap((floor) => {
    const floorDescriptors = ensureArray(floor?.map_data?.floors);
    const matchingFloorEntries = floorDescriptors.filter(
      (entry) =>
        entry?.id === floor.id ||
        entry?.level === floor.level ||
        entry?.name === floor.name,
    );
    const floorEntries = matchingFloorEntries.length
      ? matchingFloorEntries
      : floorDescriptors;

    return floorEntries.flatMap((entry) =>
      ensureArray(entry?.elements)
        .filter((element) => element?.kind === "object")
        .map((element) => {
          const label = String(element?.label || element?.name || "").trim();
          if (!label) return null;
          const score = scoreMatch(label, query);
          if (!score) return null;
          return {
            id: `poi:${floor.id}:${element.id}`,
            kind: "poi",
            entity_kind: "poi",
            name: label,
            type: element?.objectType || "poi",
            description: element?.description || "",
            photo_url: element?.photoUrl || element?.photo_url || null,
            floor_id: floor.id,
            floor_name: floor.name,
            x: element?.x ?? null,
            y: element?.y ?? null,
            route_room_id:
              element?.linkedRoomId ||
              element?.linked_room_id ||
              element?.roomId ||
              element?.room_id ||
              null,
            score,
          };
        })
        .filter(Boolean),
    );
  });
}

// Public: Search rooms in a building
router.get("/search/:buildingId", async (req, res) => {
  const query = String(req.query.q || "").trim();

  if (!query) {
    return res.json([]);
  }

  const { data: rooms, error } = await supabase
    .from("rooms")
    .select(`*, floors!inner(building_id)`)
    .eq("floors.building_id", req.params.buildingId)
    .ilike("name", `%${query}%`);

  if (error) return res.status(500).json({ error: error.message });

  const { data: floors, error: floorsError } = await supabase
    .from("floors")
    .select("id, name, level, map_data")
    .eq("building_id", req.params.buildingId)
    .order("level", { ascending: true });

  if (floorsError) return res.status(500).json({ error: floorsError.message });

  const roomResults = ensureArray(rooms)
    .map((room) => ({
      ...room,
      kind: "room",
      entity_kind: "room",
      route_room_id: room.id,
      score: scoreMatch(room.name, query),
    }))
    .filter((room) => room.score > 0);

  const poiResults = extractPoiSearchResults(ensureArray(floors), query);

  const results = [...roomResults, ...poiResults]
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return String(left.name || "").localeCompare(String(right.name || ""));
    })
    .slice(0, 25);

  res.json(results);
});

// Public: Get room by ID
router.get("/:id", async (req, res) => {
  const { data, error } = await supabase
    .from("rooms")
    .select(`*, floors(*, buildings(*))`)
    .eq("id", req.params.id)
    .single();

  if (error) return res.status(404).json({ error: "Room not found" });
  res.json(data);
});

// Admin: Create room
router.post("/", requireAdmin, async (req, res) => {
  const {
    floor_id,
    name,
    type,
    x,
    y,
    width,
    height,
    color,
    description,
    photo_urls,
    polygon_points,
  } = req.body;

  const { data, error } = await supabase
    .from("rooms")
    .insert({
      floor_id,
      name,
      type,
      x,
      y,
      width,
      height,
      color,
      description,
      photo_urls,
      polygon_points,
    })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// Admin: Update room
router.put("/:id", requireAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from("rooms")
    .update(req.body)
    .eq("id", req.params.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// Admin: Delete room
router.delete("/:id", requireAdmin, async (req, res) => {
  const { error } = await supabase
    .from("rooms")
    .delete()
    .eq("id", req.params.id);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

export default router;
