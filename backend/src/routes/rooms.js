import express from 'express';
import { supabase } from '../utils/supabase.js';
import { requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// Public: Get room by ID
router.get('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('rooms')
    .select(`*, floors(*, buildings(*))`)
    .eq('id', req.params.id)
    .single();

  if (error) return res.status(404).json({ error: 'Room not found' });
  res.json(data);
});

// Public: Search rooms in a building
router.get('/search/:buildingId', async (req, res) => {
  const { q } = req.query;
  const { data, error } = await supabase
    .from('rooms')
    .select(`*, floors!inner(building_id)`)
    .eq('floors.building_id', req.params.buildingId)
    .ilike('name', `%${q}%`);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Admin: Create room
router.post('/', requireAdmin, async (req, res) => {
  const { floor_id, name, type, x, y, width, height, color, description, photo_urls, polygon_points } = req.body;

  const { data, error } = await supabase
    .from('rooms')
    .insert({ floor_id, name, type, x, y, width, height, color, description, photo_urls, polygon_points })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// Admin: Update room
router.put('/:id', requireAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('rooms')
    .update(req.body)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// Admin: Delete room
router.delete('/:id', requireAdmin, async (req, res) => {
  const { error } = await supabase
    .from('rooms')
    .delete()
    .eq('id', req.params.id);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

export default router;
