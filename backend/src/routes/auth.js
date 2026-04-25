import express from 'express';
import { supabase } from '../utils/supabase.js';
import { requireAdmin } from '../middleware/auth.js';
import {
  findAdminByEmail,
  findAuthUserByEmail,
  normalizeEmail,
} from '../utils/admins.js';

const router = express.Router();

// Get current admin profile
router.get('/me', requireAdmin, async (req, res) => {
  res.json({ user: req.user, admin: req.admin });
});

// Add new admin (only existing admins can do this)
router.post('/add-admin', requireAdmin, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  const { data: existingAdmin, error: existingAdminError } =
    await findAdminByEmail(normalizedEmail);

  if (existingAdminError) {
    console.error(
      '[auth] add-admin existing admin lookup failed:',
      existingAdminError?.message || existingAdminError,
    );
    return res.status(503).json({
      error: 'Authorization service unavailable',
      message: 'Unable to look up the requested admin record right now.',
    });
  }

  const { data: existingAuthUser, error: existingAuthUserError } =
    await findAuthUserByEmail(normalizedEmail);

  if (existingAuthUserError) {
    console.error(
      '[auth] add-admin auth user lookup failed:',
      existingAuthUserError?.message || existingAuthUserError,
    );
    return res.status(503).json({
      error: 'Authorization service unavailable',
      message: 'Unable to verify the requested admin account right now.',
    });
  }

  if (
    existingAdmin?.user_id &&
    existingAuthUser?.id &&
    existingAdmin.user_id !== existingAuthUser.id
  ) {
    return res.status(409).json({
      error: 'Admin record conflict',
      message: 'This email is already linked to a different auth user.',
    });
  }

  const payload = { email: normalizedEmail };
  const linkedUserId = existingAdmin?.user_id || existingAuthUser?.id || null;
  if (linkedUserId) {
    payload.user_id = linkedUserId;
  }

  const { data, error } = await supabase
    .from('admins')
    .upsert(payload, { onConflict: 'email' })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json({ admin: data });
});

export default router;
