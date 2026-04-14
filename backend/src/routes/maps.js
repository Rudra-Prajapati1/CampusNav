import express from "express";
import multer from "multer";
import { requireAdmin } from "../middleware/auth.js";
import { supabase } from "../utils/supabase.js";
import {
  callAiTraceService,
  createUploadedFilePayload,
  fetchRemoteFile,
} from "../services/aiTraceClient.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });
const FLOOR_PLAN_BUCKET =
  process.env.SUPABASE_FLOOR_PLAN_BUCKET || "floor-plans";

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function confidenceSummary(result) {
  return {
    walls: result.walls.length,
    rooms: result.rooms.length,
    doors: result.doors.length,
    windows: result.windows.length,
    objects: result.objects.length,
    nodes: result.nodes.length,
    edges: result.edges.length,
  };
}

function buildStoragePath(floorId, filename = "floor-plan.png") {
  const extension = filename.includes(".")
    ? filename.slice(filename.lastIndexOf("."))
    : ".png";
  const safeName = filename
    .replace(/\.[^.]+$/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `floors/${floorId}/source/${Date.now()}-${safeName || "floor"}${extension}`;
}

async function uploadFloorPlanAsset(floorId, file) {
  const storagePath = buildStoragePath(floorId, file.originalname);
  const { error } = await supabase.storage
    .from(FLOOR_PLAN_BUCKET)
    .upload(storagePath, file.buffer, {
      upsert: true,
      contentType: file.mimetype,
    });

  if (error) {
    throw new Error(error.message || "Unable to store the floor plan asset.");
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(FLOOR_PLAN_BUCKET).getPublicUrl(storagePath);

  return publicUrl;
}

function overlayBoundsFromCorners(corners) {
  if (!Array.isArray(corners) || corners.length < 4) return null;
  const lats = corners.map((corner) => Number.parseFloat(corner.lat));
  const lngs = corners.map((corner) => Number.parseFloat(corner.lng));
  if (
    lats.some((value) => !Number.isFinite(value)) ||
    lngs.some((value) => !Number.isFinite(value))
  ) {
    return null;
  }
  return {
    north: Math.max(...lats),
    south: Math.min(...lats),
    east: Math.max(...lngs),
    west: Math.min(...lngs),
  };
}

function normalizeCorners(corners) {
  return ensureArray(corners)
    .map((corner, index) => ({
      id: corner.id || `corner-${index + 1}`,
      lat: Number.parseFloat(corner.lat),
      lng: Number.parseFloat(corner.lng),
      label: corner.label || null,
    }))
    .filter(
      (corner) => Number.isFinite(corner.lat) && Number.isFinite(corner.lng),
    );
}

function updateFloorMapData(mapData = {}, floor, georeference, overlayBounds) {
  const nextMapData = { ...(mapData || {}) };
  const floors = ensureArray(nextMapData.floors);
  const matchIndex = floors.findIndex(
    (entry) =>
      entry?.id === floor.id ||
      entry?.level === floor.level ||
      entry?.name === floor.name,
  );
  const nextFloorEntry = {
    ...(matchIndex >= 0 ? floors[matchIndex] : {}),
    id: floor.id,
    name: floor.name,
    level: floor.level,
    overlayBounds,
    georeference,
    corners: georeference.corners,
  };

  if (matchIndex >= 0) {
    floors[matchIndex] = nextFloorEntry;
  } else {
    floors.push(nextFloorEntry);
  }

  nextMapData.floors = floors;
  nextMapData.georeference = georeference;
  return nextMapData;
}

async function insertAiTraceRecord(record) {
  try {
    await supabase.from("map_ai_trace_results").insert(record);
  } catch (error) {
    console.warn("Unable to persist map_ai_trace_results:", error.message);
  }
}

async function upsertGeoreferenceRecord(record) {
  try {
    await supabase.from("map_georeferences").upsert(record, {
      onConflict: "floor_id",
    });
  } catch (error) {
    console.warn("Unable to persist map_georeferences:", error.message);
  }
}

function toNumber(value, fallback = null) {
  const parsed =
    typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function centroid(corners) {
  if (!corners.length) {
    return { lat: null, lng: null };
  }

  const total = corners.reduce(
    (sum, corner) => ({
      lat: sum.lat + corner.lat,
      lng: sum.lng + corner.lng,
    }),
    { lat: 0, lng: 0 },
  );

  return {
    lat: total.lat / corners.length,
    lng: total.lng / corners.length,
  };
}

function canonicalFloorId(floors = []) {
  const exactGround = floors.find((floor) => Number(floor.level) === 0);
  if (exactGround) return exactGround.id;

  return [...floors]
    .sort((left, right) => {
      const leftLevel = toNumber(left.level, 0);
      const rightLevel = toNumber(right.level, 0);
      const distance = Math.abs(leftLevel) - Math.abs(rightLevel);
      if (distance !== 0) return distance;
      return leftLevel - rightLevel;
    })[0]?.id;
}

async function syncBuildingAnchorFromGeoreference(floor, georeference) {
  if (!floor?.building_id) {
    return { synced: false, canonical_floor_id: null };
  }

  const { data: floors, error } = await supabase
    .from("floors")
    .select("id, level")
    .eq("building_id", floor.building_id);

  if (error) {
    throw error;
  }

  const canonicalFloor = canonicalFloorId(floors || []);
  if (!canonicalFloor || canonicalFloor !== floor.id) {
    return { synced: false, canonical_floor_id: canonicalFloor || null };
  }

  const { error: buildingError } = await supabase
    .from("buildings")
    .update({
      entrance_lat: georeference.anchorLat,
      entrance_lng: georeference.anchorLng,
    })
    .eq("id", floor.building_id);

  if (buildingError) {
    throw buildingError;
  }

  return { synced: true, canonical_floor_id: canonicalFloor };
}

router.post(
  "/ai-trace",
  requireAdmin,
  upload.single("file"),
  async (req, res) => {
    try {
      const floorId = req.body.floor_id;
      const scope = req.body.scope === "all_floors" ? "all_floors" : "current_floor";
      const options =
        typeof req.body.options === "string"
          ? JSON.parse(req.body.options || "{}")
          : req.body.options || {};

      if (!floorId) {
        return res.status(400).json({ error: "floor_id is required." });
      }

      const { data: targetFloor, error: floorError } = await supabase
        .from("floors")
        .select("*")
        .eq("id", floorId)
        .single();

      if (floorError || !targetFloor) {
        return res.status(404).json({ error: "Floor not found." });
      }

      const floorsToTrace =
        scope === "all_floors"
          ? (
              await supabase
                .from("floors")
                .select("*")
                .eq("building_id", targetFloor.building_id)
                .order("level", { ascending: true })
            ).data || [targetFloor]
          : [targetFloor];

      let uploadedUrl = null;
      if (req.file) {
        uploadedUrl = await uploadFloorPlanAsset(targetFloor.id, req.file);
        await supabase
          .from("floors")
          .update({ floor_plan_url: uploadedUrl })
          .eq("id", targetFloor.id);
        targetFloor.floor_plan_url = uploadedUrl;
      }

      const results = [];

      for (const floor of floorsToTrace) {
        const currentFile =
          req.file && floor.id === targetFloor.id
            ? createUploadedFilePayload(req.file)
            : floor.floor_plan_url
              ? {
                  ...(await fetchRemoteFile(floor.floor_plan_url)),
                  filename: `floor-${floor.id}.png`,
                }
              : null;

        if (!currentFile) {
          results.push({
            floor_id: floor.id,
            floor_name: floor.name,
            status: "skipped",
            message: "No floor plan asset was attached to this floor.",
            result: {
              walls: [],
              doors: [],
              windows: [],
              rooms: [],
              nodes: [],
              edges: [],
              objects: [],
            },
          });
          continue;
        }

        const trace = await callAiTraceService({
          file: currentFile,
          options,
        });

        await insertAiTraceRecord({
          floor_id: floor.id,
          status: "completed",
          options,
          result: trace,
          confidence_summary: confidenceSummary(trace),
          created_by: req.user.id,
        });

        results.push({
          floor_id: floor.id,
          floor_name: floor.name,
          status: "completed",
          result: trace,
          confidence_summary: confidenceSummary(trace),
        });
      }

      return res.json({
        floor_id: floorId,
        scope,
        floor_plan_url: uploadedUrl || targetFloor.floor_plan_url || null,
        results,
        result: results[0]?.result || {
          walls: [],
          doors: [],
          windows: [],
          rooms: [],
          nodes: [],
          edges: [],
          objects: [],
        },
      });
    } catch (error) {
      return res.status(400).json({
        error: error.message || "AI trace failed.",
      });
    }
  },
);

router.get("/ai-trace/latest/:floorId", requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("map_ai_trace_results")
      .select("*")
      .eq("floor_id", req.params.floorId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (!data) {
      return res.status(404).json({ error: "No AI trace result found for this floor." });
    }
    return res.json(data);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to load AI trace result." });
  }
});

router.post("/georeference", requireAdmin, async (req, res) => {
  try {
    const {
      floor_id: floorId,
      anchorLat,
      anchorLng,
      rotation = 0,
      scaleX = 1,
      scaleY = 1,
      level = null,
      opacity = 0.55,
      corners = [],
      controlPoints = [],
      transform = {},
      address = "",
      mode = "handle",
    } = req.body || {};

    if (!floorId) {
      return res.status(400).json({ error: "floor_id is required." });
    }

    const { data: floor, error } = await supabase
      .from("floors")
      .select("*")
      .eq("id", floorId)
      .single();

    if (error || !floor) {
      return res.status(404).json({ error: "Floor not found." });
    }

    const normalizedCorners = normalizeCorners(corners);
    if (normalizedCorners.length < 4) {
      return res.status(400).json({ error: "At least four corners are required." });
    }

    const overlayBounds = overlayBoundsFromCorners(normalizedCorners);
    const center = centroid(normalizedCorners);
    const georeference = {
      anchorLat: toNumber(anchorLat, center.lat),
      anchorLng: toNumber(anchorLng, center.lng),
      rotation: toNumber(rotation, 0) || 0,
      scaleX: toNumber(scaleX, 1) || 1,
      scaleY: toNumber(scaleY, 1) || 1,
      level,
      opacity: toNumber(opacity, 0.55) || 0.55,
      corners: normalizedCorners,
      controlPoints: ensureArray(controlPoints),
      transform: {
        ...(transform || {}),
        overlayBounds,
        anchor: {
          lat: toNumber(anchorLat, center.lat),
          lng: toNumber(anchorLng, center.lng),
        },
        rotation: toNumber(rotation, 0) || 0,
        scaleX: toNumber(scaleX, 1) || 1,
        scaleY: toNumber(scaleY, 1) || 1,
      },
      address,
      mode,
      updatedAt: new Date().toISOString(),
    };

    const nextMapData = updateFloorMapData(
      floor.map_data,
      floor,
      georeference,
      overlayBounds,
    );

    const { data: updatedFloor, error: updateError } = await supabase
      .from("floors")
      .update({ map_data: nextMapData })
      .eq("id", floorId)
      .select("*")
      .single();

    if (updateError) {
      throw updateError;
    }

    await upsertGeoreferenceRecord({
      floor_id: floorId,
      anchor_lat: georeference.anchorLat,
      anchor_lng: georeference.anchorLng,
      rotation: georeference.rotation,
      scale_x: georeference.scaleX,
      scale_y: georeference.scaleY,
      level: georeference.level,
      opacity: georeference.opacity,
      corners: georeference.corners,
      control_points: georeference.controlPoints,
      transform: georeference.transform,
      created_by: req.user.id,
    });

    const buildingAnchor = await syncBuildingAnchorFromGeoreference(
      updatedFloor,
      georeference,
    );

    return res.json({
      floor: updatedFloor,
      georeference,
      overlayBounds,
      building_anchor: buildingAnchor,
    });
  } catch (error) {
    return res
      .status(400)
      .json({ error: error.message || "Unable to save georeference data." });
  }
});

export default router;
