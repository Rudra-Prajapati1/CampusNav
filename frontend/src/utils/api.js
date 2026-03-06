import { supabase } from './supabase.js';

const BASE_URL = import.meta.env.VITE_API_URL || '/api';

async function getAuthHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return {};
  return { Authorization: `Bearer ${session.access_token}` };
}

async function request(method, path, body = null) {
  const headers = {
    'Content-Type': 'application/json',
    ...(await getAuthHeaders())
  };

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  put: (path, body) => request('PUT', path, body),
  delete: (path) => request('DELETE', path),

  // Buildings
  buildings: {
    list: () => api.get('/buildings'),
    get: (id) => api.get(`/buildings/${id}`),
    create: (data) => api.post('/buildings', data),
    update: (id, data) => api.put(`/buildings/${id}`, data),
    delete: (id) => api.delete(`/buildings/${id}`),
  },

  // Floors
  floors: {
    get: (id) => api.get(`/floors/${id}`),
    byBuilding: (buildingId) => api.get(`/floors/building/${buildingId}`),
    create: (data) => api.post('/floors', data),
    update: (id, data) => api.put(`/floors/${id}`, data),
    delete: (id) => api.delete(`/floors/${id}`),
    saveMap: (id, data) => api.post(`/floors/${id}/save-map`, data),
  },

  // Rooms
  rooms: {
    get: (id) => api.get(`/rooms/${id}`),
    search: (buildingId, q) => api.get(`/rooms/search/${buildingId}?q=${encodeURIComponent(q)}`),
    create: (data) => api.post('/rooms', data),
    update: (id, data) => api.put(`/rooms/${id}`, data),
    delete: (id) => api.delete(`/rooms/${id}`),
  },

  // Navigation
  navigation: {
    route: (fromRoomId, toRoomId, buildingId) =>
      api.post('/navigation/route', { from_room_id: fromRoomId, to_room_id: toRoomId, building_id: buildingId }),
  },

  // QR Codes
  qr: {
    room: (roomId) => api.get(`/qr/room/${roomId}`),
    floor: (floorId) => api.get(`/qr/floor/${floorId}/batch`),
  },
};
