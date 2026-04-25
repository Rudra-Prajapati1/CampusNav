import { supabase } from "../utils/supabase.js";
import {
  findAdminByEmail,
  findAdminByUserId,
  linkAdminToUser,
  normalizeEmail,
} from "../utils/admins.js";

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const OFFLINE_ADMIN_ENABLED =
  process.env.ALLOW_OFFLINE_ADMIN === "true" ||
  (!IS_PRODUCTION && process.env.ALLOW_OFFLINE_ADMIN !== "false");

let warnedOfflineBypass = false;

function maybeWarnOfflineBypass() {
  if (warnedOfflineBypass) return;
  warnedOfflineBypass = true;
  console.warn(
    "[auth] Supabase auth bypass is enabled for local development. Set ALLOW_OFFLINE_ADMIN=false to enforce real auth.",
  );
}

function attachOfflineUser(req) {
  req.user = {
    id: "offline-admin-user",
    email: "offline-admin@localhost",
    role: "admin",
  };
}

function attachOfflineAdmin(req) {
  attachOfflineUser(req);
  req.admin = {
    id: "offline-admin-record",
    user_id: "offline-admin-user",
    role: "owner",
  };
}

function readBearerToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  return authHeader.split(" ")[1];
}

export async function requireAuth(req, res, next) {
  if (OFFLINE_ADMIN_ENABLED) {
    maybeWarnOfflineBypass();
    attachOfflineUser(req);
    return next();
  }

  const token = readBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: "Invalid token" });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error("[auth] requireAuth failed:", error?.message || error);
    return res.status(503).json({
      error: "Authentication service unavailable",
      message: "Unable to verify user token at the moment.",
    });
  }
}

export async function requireAdmin(req, res, next) {
  if (OFFLINE_ADMIN_ENABLED) {
    maybeWarnOfflineBypass();
    attachOfflineAdmin(req);
    return next();
  }

  const token = readBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: "Invalid token" });
    }

    const { data: adminByUserId, error: adminByUserIdError } =
      await findAdminByUserId(user.id);

    if (adminByUserIdError) {
      console.error(
        "[auth] admin lookup by user_id failed:",
        adminByUserIdError?.message || adminByUserIdError,
      );
      return res.status(503).json({
        error: "Authorization service unavailable",
        message: "Unable to verify admin privileges right now.",
      });
    }

    if (adminByUserId) {
      req.user = user;
      req.admin = adminByUserId;
      return next();
    }

    const normalizedEmail = normalizeEmail(user.email);
    const { data: adminByEmail, error: adminByEmailError } =
      await findAdminByEmail(normalizedEmail);

    if (adminByEmailError) {
      console.error(
        "[auth] admin lookup by email failed:",
        adminByEmailError?.message || adminByEmailError,
      );
      return res.status(503).json({
        error: "Authorization service unavailable",
        message: "Unable to verify admin privileges right now.",
      });
    }

    if (!adminByEmail) {
      return res
        .status(403)
        .json({ error: "Forbidden: Admin access required" });
    }

    if (!adminByEmail.user_id) {
      const { data: linkedAdmin, error: linkError } = await linkAdminToUser(
        adminByEmail.id,
        user.id,
      );

      if (linkError) {
        console.error(
          "[auth] admin auto-link failed:",
          linkError?.message || linkError,
        );
        return res.status(503).json({
          error: "Authorization service unavailable",
          message: "Unable to verify admin privileges right now.",
        });
      }

      req.user = user;
      req.admin = linkedAdmin;
      return next();
    }

    console.error(
      "[auth] admin email matched but user_id is linked to a different auth user:",
      {
        adminId: adminByEmail.id,
        adminUserId: adminByEmail.user_id,
        authenticatedUserId: user.id,
        email: normalizedEmail,
      },
    );
    return res.status(503).json({
      error: "Authorization service unavailable",
      message: "Admin access is misconfigured for this account.",
    });
  } catch (error) {
    console.error("[auth] requireAdmin failed:", error?.message || error);
    return res.status(503).json({
      error: "Authorization service unavailable",
      message: "Unable to validate admin token at the moment.",
    });
  }
}
