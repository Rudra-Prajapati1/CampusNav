/**
 * Auth Store — Zustand store for authentication state
 * Updated to use api.auth.me() which maps to GET /api/v1/auth/me
 */

import { create } from "zustand";
import { supabase } from "../utils/supabase.js";
import { api } from "../utils/api.js";

export const useAuthStore = create((set, get) => ({
  user: null,
  isAdmin: false,
  authError: null,
  loading: true,

  init: async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.user) {
      await get().setUser(session.user);
    }
    set({ loading: false });

    supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        await get().setUser(session.user);
      } else {
        set({ user: null, isAdmin: false, authError: null });
      }
    });
  },

  setUser: async (user) => {
    try {
      await api.auth.me();
      set({ user, isAdmin: true, authError: null });
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) {
        set({ user, isAdmin: false, authError: null });
        return;
      }

      set({ user, isAdmin: false, authError: error });
    }
  },

  signInWithEmail: async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    if (data.user) await get().setUser(data.user);
  },

  signInWithGoogle: async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/admin` },
    });
    if (error) throw error;
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ user: null, isAdmin: false, authError: null });
  },
}));
