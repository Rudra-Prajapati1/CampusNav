import express from 'express';
import { supabase } from '../utils/supabase.js';
import { requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// Get current admin profile
router.get('/me', requireAdmin, async (req, res) => {
  res.json({ user: req.user, admin: req.admin });
});

// Add new admin (only existing admins can do this)
router.post('/add-admin', requireAdmin, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  const { data, error } = await supabase
    .from('admins')
    .insert({ email })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json({ admin: data });
});

export default router;
