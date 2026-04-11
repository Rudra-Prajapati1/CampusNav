import express from "express";
import { supabase } from "../utils/supabase.js";
import { requireAdmin } from "../middleware/auth.js";

const router = express.Router();

function isMissingColumnError(error) {
  const message = error?.message || "";
  return (
    message.includes("entrance_lat") ||
    message.includes("entrance_lng") ||
    message.includes("industry")
  );
}

function normalizeCoordinate(value) {
  if (value === "" || value === undefined || value === null) return null;
  const parsed =
    typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeBuildingPayload(body, userId) {
  const payload = {};

  if ("name" in body) payload.name = body.name;
  if ("industry" in body) payload.industry = body.industry || "education";
  if ("description" in body) payload.description = body.description;
  if ("address" in body) payload.address = body.address;
  if ("logo_url" in body) payload.logo_url = body.logo_url;
  if ("entrance_lat" in body) payload.entrance_lat = normalizeCoordinate(body.entrance_lat);
  if ("entrance_lng" in body) payload.entrance_lng = normalizeCoordinate(body.entrance_lng);
  if (userId) payload.created_by = userId;

  return payload;
}

function legacyBuildingPayload(body, userId) {
  const payload = {};
  if ("name" in body) payload.name = body.name;
  if ("description" in body) payload.description = body.description;
  if ("address" in body) payload.address = body.address;
  if ("logo_url" in body) payload.logo_url = body.logo_url;
  if (userId) payload.created_by = userId;
  return payload;
}

// Public: Get all buildings
router.get("/", async (_req, res) => {
  const { data, error } = await supabase
    .from("buildings")
    .select("*, floors(count)")
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Public: Get building by ID (for user navigation)
router.get("/:id", async (req, res) => {
  const { data, error } = await supabase
    .from("buildings")
    .select("*, floors(*)")
    .eq("id", req.params.id)
    .single();

  if (error) return res.status(404).json({ error: "Building not found" });
  res.json(data);
});

// Admin: Create building
router.post("/", requireAdmin, async (req, res) => {
  const body = req.body;
  if (!body.name) return res.status(400).json({ error: "Name required" });

  let { data, error } = await supabase
    .from("buildings")
    .insert(normalizeBuildingPayload(body, req.user.id))
    .select()
    .single();

  if (error && isMissingColumnError(error)) {
    ({ data, error } = await supabase
      .from("buildings")
      .insert(legacyBuildingPayload(body, req.user.id))
      .select()
      .single());
  }

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// Admin: Update building
router.put("/:id", requireAdmin, async (req, res) => {
  const body = req.body;

  let { data, error } = await supabase
    .from("buildings")
    .update(normalizeBuildingPayload(body))
    .eq("id", req.params.id)
    .select()
    .single();

  if (error && isMissingColumnError(error)) {
    ({ data, error } = await supabase
      .from("buildings")
      .update(legacyBuildingPayload(body))
      .eq("id", req.params.id)
      .select()
      .single());
  }

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// Admin: Delete building
router.delete("/:id", requireAdmin, async (req, res) => {
  const { error } = await supabase
    .from("buildings")
    .delete()
    .eq("id", req.params.id);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

export default router;
