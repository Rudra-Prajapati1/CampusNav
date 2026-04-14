import express from 'express';
import QRCode from 'qrcode';
import JSZip from "jszip";
import { supabase } from '../utils/supabase.js';
import { requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// Generate QR code for a room (returns base64 image)
router.get('/room/:roomId', requireAdmin, async (req, res) => {
  const { roomId } = req.params;
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

  const { data: room } = await supabase
    .from('rooms')
    .select(`*, floors(building_id)`)
    .eq('id', roomId)
    .single();

  if (!room) return res.status(404).json({ error: 'Room not found' });

  // URL that opens the map at this room's location
  const navUrl = `${frontendUrl}/navigate/${room.floors.building_id}?from=${roomId}`;

  try {
    const qrDataUrl = await QRCode.toDataURL(navUrl, {
      width: 400,
      margin: 2,
      color: {
        dark: '#1a1a2e',
        light: '#ffffff'
      }
    });

    res.json({
      qr: qrDataUrl,
      url: navUrl,
      room_name: room.name
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function safeFileSegment(value, fallback = "item") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || fallback;
}

// Generate QR ZIP for all rooms and waypoints in a floor (batch)
router.get('/floor/:floorId/batch', requireAdmin, async (req, res) => {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

  const { data: rooms } = await supabase
    .from('rooms')
    .select(`*, floors(building_id)`)
    .eq('floor_id', req.params.floorId);

  const { data: waypoints } = await supabase
    .from('waypoints')
    .select('*')
    .eq('floor_id', req.params.floorId);

  if ((!rooms || rooms.length === 0) && (!waypoints || waypoints.length === 0)) {
    return res.status(404).json({ error: 'No rooms or waypoints found' });
  }

  const buildingId = rooms?.[0]?.floors?.building_id || null;
  const zip = new JSZip();
  const files = [];

  if (rooms?.length) {
    const roomFiles = await Promise.all(
      rooms.map(async (room, index) => {
        const navUrl = `${frontendUrl}/navigate/${room.floors.building_id}?from=${room.id}`;
        const payload = JSON.stringify({
          id: room.id,
          name: room.name,
          kind: "room",
          navigate_url: navUrl,
        });
        const buffer = await QRCode.toBuffer(payload, {
          type: "png",
          width: 300,
          margin: 2,
          color: { dark: '#1a1a2e', light: '#ffffff' }
        });
        return {
          name: `${String(index + 1).padStart(2, "0")}-room-${safeFileSegment(room.name, "room")}.png`,
          buffer,
        };
      }),
    );
    roomFiles.forEach((entry) => {
      zip.file(entry.name, entry.buffer);
      files.push(entry.name);
    });
  }

  if (waypoints?.length && buildingId) {
    const waypointFiles = await Promise.all(
      waypoints.map(async (waypoint, index) => {
        const label = waypoint.name || waypoint.type || `Waypoint ${index + 1}`;
        const navUrl = `${frontendUrl}/navigate/${buildingId}?from=${waypoint.id}`;
        const payload = JSON.stringify({
          id: waypoint.id,
          name: label,
          kind: "waypoint",
          navigate_url: navUrl,
        });
        const buffer = await QRCode.toBuffer(payload, {
          type: "png",
          width: 300,
          margin: 2,
          color: { dark: '#1a1a2e', light: '#ffffff' }
        });
        return {
          name: `${String(index + 1).padStart(2, "0")}-waypoint-${safeFileSegment(label, "waypoint")}.png`,
          buffer,
        };
      }),
    );
    waypointFiles.forEach((entry) => {
      zip.file(entry.name, entry.buffer);
      files.push(entry.name);
    });
  }

  if (!files.length) {
    return res.status(404).json({ error: "No QR codes could be generated for this floor." });
  }

  const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  res.setHeader("Content-Type", "application/zip");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="floor-${safeFileSegment(req.params.floorId, "floor")}-qr.zip"`,
  );
  res.send(zipBuffer);
});

export default router;
