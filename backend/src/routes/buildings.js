import express from 'express';
import { supabase } from '../utils/supabase.js';
import { requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// Public: Get building by ID (for user navigation)
router.get('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('buildings')
    .select(`*, floors(*)`)
    .eq('id', req.params.id)
    .single();

  if (error) return res.status(404).json({ error: 'Building not found' });
  res.json(data);
});

// Admin: Get all buildings
router.get('/', requireAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('buildings')
    .select(`*, floors(count)`)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Admin: Create building
router.post('/', requireAdmin, async (req, res) => {
  const { name, description, address, logo_url } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });

  const { data, error } = await supabase
    .from('buildings')
    .insert({ name, description, address, logo_url, created_by: req.user.id })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// Admin: Update building
router.put('/:id', requireAdmin, async (req, res) => {
  const { name, description, address, logo_url } = req.body;

  const { data, error } = await supabase
    .from('buildings')
    .update({ name, description, address, logo_url })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// Admin: Delete building
router.delete('/:id', requireAdmin, async (req, res) => {
  const { error } = await supabase
    .from('buildings')
    .delete()
    .eq('id', req.params.id);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

export default router;
