import { supabase } from "./supabase.js";

const ADMIN_SELECT = "*";
const AUTH_USER_PAGE_SIZE = 200;

export function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

export async function findAdminByUserId(userId) {
  if (!userId) {
    return { data: null, error: null };
  }

  return supabase
    .from("admins")
    .select(ADMIN_SELECT)
    .eq("user_id", userId)
    .maybeSingle();
}

export async function findAdminByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return { data: null, error: null };
  }

  return supabase
    .from("admins")
    .select(ADMIN_SELECT)
    .ilike("email", normalizedEmail)
    .maybeSingle();
}

export async function linkAdminToUser(adminId, userId) {
  return supabase
    .from("admins")
    .update({ user_id: userId })
    .eq("id", adminId)
    .select(ADMIN_SELECT)
    .single();
}

export async function findAuthUserByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return { data: null, error: null };
  }

  let page = 1;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: AUTH_USER_PAGE_SIZE,
    });

    if (error) {
      return { data: null, error };
    }

    const match = data.users.find(
      (user) => normalizeEmail(user.email) === normalizedEmail,
    );

    if (match) {
      return { data: match, error: null };
    }

    if (!data.nextPage || data.users.length < AUTH_USER_PAGE_SIZE) {
      return { data: null, error: null };
    }

    page = data.nextPage;
  }
}
