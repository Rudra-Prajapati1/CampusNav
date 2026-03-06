import express from 'express';
import QRCode from 'qrcode';
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

// Generate QR codes for ALL rooms in a floor (batch)
router.get('/floor/:floorId/batch', requireAdmin, async (req, res) => {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

  const { data: rooms } = await supabase
    .from('rooms')
    .select(`*, floors(building_id)`)
    .eq('floor_id', req.params.floorId);

  if (!rooms || rooms.length === 0) {
    return res.status(404).json({ error: 'No rooms found' });
  }

  const qrCodes = await Promise.all(
    rooms.map(async (room) => {
      const navUrl = `${frontendUrl}/navigate/${room.floors.building_id}?from=${room.id}`;
      const qrDataUrl = await QRCode.toDataURL(navUrl, {
        width: 300,
        margin: 2,
        color: { dark: '#1a1a2e', light: '#ffffff' }
      });
      return {
        room_id: room.id,
        room_name: room.name,
        qr: qrDataUrl,
        url: navUrl
      };
    })
  );

  res.json(qrCodes);
});

export default router;
