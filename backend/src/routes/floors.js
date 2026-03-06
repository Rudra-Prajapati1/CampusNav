import express from 'express';
import { supabase } from '../utils/supabase.js';
import { requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// Public: Get floor with all rooms and waypoints
router.get('/:id', async (req, res) => {
  const { data: floor, error } = await supabase
    .from('floors')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (error) return res.status(404).json({ error: 'Floor not found' });

  const { data: rooms } = await supabase
    .from('rooms')
    .select('*')
    .eq('floor_id', req.params.id);

  const { data: waypoints } = await supabase
    .from('waypoints')
    .select('*')
    .eq('floor_id', req.params.id);

  const { data: connections } = await supabase
    .from('waypoint_connections')
    .select('*')
    .eq('floor_id', req.params.id);

  res.json({ ...floor, rooms, waypoints, connections });
});

// Public: Get all floors for a building
router.get('/building/:buildingId', async (req, res) => {
  const { data, error } = await supabase
    .from('floors')
    .select('*')
    .eq('building_id', req.params.buildingId)
    .order('level', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Admin: Create floor
router.post('/', requireAdmin, async (req, res) => {
  const { building_id, name, level, floor_plan_url, floor_plan_width, floor_plan_height } = req.body;

  const { data, error } = await supabase
    .from('floors')
    .insert({ building_id, name, level, floor_plan_url, floor_plan_width, floor_plan_height })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// Admin: Update floor (including floor plan image URL)
router.put('/:id', requireAdmin, async (req, res) => {
  const updates = req.body;

  const { data, error } = await supabase
    .from('floors')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// Admin: Delete floor
router.delete('/:id', requireAdmin, async (req, res) => {
  const { error } = await supabase
    .from('floors')
    .delete()
    .eq('id', req.params.id);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

// Admin: Save entire floor map (rooms + waypoints + connections in one call)
router.post('/:id/save-map', requireAdmin, async (req, res) => {
  const { rooms, waypoints, connections } = req.body;
  const floorId = req.params.id;

  try {
    // Delete existing data for this floor
    await supabase.from('waypoint_connections').delete().eq('floor_id', floorId);
    await supabase.from('waypoints').delete().eq('floor_id', floorId);
    await supabase.from('rooms').delete().eq('floor_id', floorId);

    // Insert rooms
    let savedRooms = [];
    if (rooms && rooms.length > 0) {
      const { data, error } = await supabase
        .from('rooms')
        .insert(rooms.map(r => ({ ...r, floor_id: floorId })))
        .select();
      if (error) throw error;
      savedRooms = data;
    }

    // Insert waypoints
    let savedWaypoints = [];
    if (waypoints && waypoints.length > 0) {
      const { data, error } = await supabase
        .from('waypoints')
        .insert(waypoints.map(w => ({ ...w, floor_id: floorId })))
        .select();
      if (error) throw error;
      savedWaypoints = data;
    }

    // Insert connections
    if (connections && connections.length > 0) {
      const { error } = await supabase
        .from('waypoint_connections')
        .insert(connections.map(c => ({ ...c, floor_id: floorId })));
      if (error) throw error;
    }

    res.json({ success: true, rooms: savedRooms, waypoints: savedWaypoints });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
