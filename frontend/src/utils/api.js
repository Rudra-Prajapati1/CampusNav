/**
 * CampusNav API Client
 *
 * Handles all HTTP communication with the backend.
 * Features:
 * - Correct /api/v1 base path matching backend routes
 * - Request timeout protection (15s default)
 * - Robust error handling with fallback JSON parsing
 * - Automatic auth header injection from Supabase session
 */

import { supabase } from "./supabase.js";

// PART 1: Correct base URL — backend serves all routes under /api/v1
const BASE_URL = import.meta.env.VITE_API_URL || "/api/v1";

// Request timeout in milliseconds
const REQUEST_TIMEOUT = 15000;
const AUTH_TIMEOUT = 3000;
let cachedAccessToken = null;

supabase.auth.onAuthStateChange((_event, session) => {
  cachedAccessToken = session?.access_token || null;
});

function withTimeout(promise, timeoutMs, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]);
}

/**
 * Get authorization headers from current Supabase session
 * @returns {Object} Headers object with Bearer token if authenticated
 */
async function getAuthHeaders() {
  try {
    if (cachedAccessToken) {
      return { Authorization: `Bearer ${cachedAccessToken}` };
    }

    const {
      data: { session },
    } = await withTimeout(
      supabase.auth.getSession(),
      AUTH_TIMEOUT,
      "Authentication lookup timed out.",
    );

    cachedAccessToken = session?.access_token || null;

    if (!session?.access_token) return {};
    return { Authorization: `Bearer ${session.access_token}` };
  } catch {
    return cachedAccessToken
      ? { Authorization: `Bearer ${cachedAccessToken}` }
      : {};
  }
}

/**
 * Core request function with timeout, error handling, and retry logic
 *
 * @param {string} method - HTTP method (GET, POST, PUT, DELETE)
 * @param {string} path - API path (appended to BASE_URL)
 * @param {Object|null} body - Request body for POST/PUT
 * @returns {Promise<any>} Parsed JSON response
 * @throws {Error} With descriptive message on failure
 */
async function request(method, path, body = null) {
  const headers = {
    "Content-Type": "application/json",
    ...(await getAuthHeaders()),
  };

  // Create AbortController for timeout protection
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : null,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Attempt to parse JSON response, with fallback
    let data;
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      try {
        data = await res.json();
      } catch {
        data = { error: "Invalid JSON response from server" };
      }
    } else {
      // Non-JSON response — read as text for error messages
      const text = await res.text().catch(() => "");
      data = { error: text || `Server returned status ${res.status}` };
    }

    if (!res.ok) {
      const message =
        data?.error ||
        data?.message ||
        `Request failed with status ${res.status}`;
      const error = new Error(message);
      error.status = res.status;
      error.code = data?.code || null;
      error.data = data;
      throw error;
    }

    return data;
  } catch (err) {
    clearTimeout(timeoutId);

    // Handle abort (timeout)
    if (err.name === "AbortError") {
      throw new Error(
        "Request timed out. Please check your connection and try again.",
      );
    }

    // Handle network errors (no connection, DNS failure, etc.)
    if (err instanceof TypeError && err.message === "Failed to fetch") {
      throw new Error("Network error. Please check your internet connection.");
    }

    // Re-throw API errors
    throw err;
  }
}

async function requestFormData(path, formData) {
  const headers = {
    ...(await getAuthHeaders()),
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers,
      body: formData,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    let data;
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      try {
        data = await res.json();
      } catch {
        data = { error: "Invalid JSON response from server" };
      }
    } else {
      const text = await res.text().catch(() => "");
      data = { error: text || `Server returned status ${res.status}` };
    }

    if (!res.ok) {
      const message =
        data?.error ||
        data?.message ||
        `Request failed with status ${res.status}`;
      const error = new Error(message);
      error.status = res.status;
      error.code = data?.code || null;
      error.data = data;
      throw error;
    }

    return data;
  } catch (err) {
    clearTimeout(timeoutId);

    if (err.name === "AbortError") {
      throw new Error(
        "Request timed out. Please check your connection and try again.",
      );
    }

    if (err instanceof TypeError && err.message === "Failed to fetch") {
      throw new Error("Network error. Please check your internet connection.");
    }

    throw err;
  }
}

async function requestBlob(path) {
  const headers = {
    ...(await getAuthHeaders()),
  };
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) {
      let message = `Request failed with status ${res.status}`;
      try {
        const payload = await res.json();
        message = payload?.error || payload?.message || message;
      } catch {
        const text = await res.text().catch(() => "");
        if (text) message = text;
      }
      throw new Error(message);
    }
    return await res.blob();
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      throw new Error(
        "Request timed out. Please check your connection and try again.",
      );
    }
    if (err instanceof TypeError && err.message === "Failed to fetch") {
      throw new Error("Network error. Please check your internet connection.");
    }
    throw err;
  }
}

/**
 * API client with methods matching all backend endpoints exactly.
 * Every path here corresponds to a route in the backend under /api/v1.
 */
export const api = {
  get: (path) => request("GET", path),
  post: (path, body) => request("POST", path, body),
  put: (path, body) => request("PUT", path, body),
  delete: (path) => request("DELETE", path),

  // Auth: GET /api/v1/auth/me
  auth: {
    me: () => api.get("/auth/me"),
  },

  // Buildings: /api/v1/buildings
  buildings: {
    list: () => api.get("/buildings"),
    get: (id) => api.get(`/buildings/${id}`),
    create: (data) => api.post("/buildings", data),
    update: (id, data) => api.put(`/buildings/${id}`, data),
    delete: (id) => api.delete(`/buildings/${id}`),
  },

  // Floors: /api/v1/floors
  floors: {
    get: (id) => api.get(`/floors/${id}`),
    byBuilding: (buildingId) => api.get(`/floors/building/${buildingId}`),
    create: (data) => api.post("/floors", data),
    update: (id, data) => api.put(`/floors/${id}`, data),
    delete: (id) => api.delete(`/floors/${id}`),
    saveMap: (id, data) => api.post(`/floors/${id}/save-map`, data),
    autoTrace: (id) => api.post(`/floors/${id}/auto-trace`, {}),
  },

  // Rooms: /api/v1/rooms
  rooms: {
    get: (id) => api.get(`/rooms/${id}`),
    search: (buildingId, q) =>
      api.get(`/rooms/search/${buildingId}?q=${encodeURIComponent(q)}`),
    create: (data) => api.post("/rooms", data),
    update: (id, data) => api.put(`/rooms/${id}`, data),
    delete: (id) => api.delete(`/rooms/${id}`),
  },

  // Navigation: POST /api/v1/navigation/route
  navigation: {
    route: (fromRoomId, toRoomId, buildingId) =>
      api.post("/navigation/route", {
        from_room_id: fromRoomId,
        to_room_id: toRoomId,
        building_id: buildingId,
      }),
    invalidateCache: (buildingId) =>
      api.post("/navigation/invalidate-cache", { building_id: buildingId }),
    cacheStats: () => api.get("/navigation/cache-stats"),
  },

  // QR Codes: /api/v1/qr
  qr: {
    room: (roomId) => api.get(`/qr/room/${roomId}`),
    floorZip: (floorId) => requestBlob(`/qr/floor/${floorId}/batch`),
  },

  maps: {
    aiTrace: (formData) => requestFormData("/maps/ai-trace", formData),
    latestAiTrace: (floorId) => api.get(`/maps/ai-trace/latest/${floorId}`),
    saveGeoreference: (data) => api.post("/maps/georeference", data),
  },
};
