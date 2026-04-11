import { randomUUID } from "crypto";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

export function isUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value.trim());
}

export function toNumber(value, fallback = null) {
  const parsed =
    typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizePoint(point = {}) {
  return {
    x: toNumber(point.x, 0),
    y: toNumber(point.y, 0),
  };
}

export function normalizePolygon(points) {
  const normalized = ensureArray(points)
    .map((point) => normalizePoint(point))
    .filter(
      (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
    );
  return normalized.length >= 3 ? normalized : null;
}

export function ensureUuid(value, idMap = new Map()) {
  if (isUuid(value)) return value;

  const key =
    typeof value === "string" && value.trim()
      ? value.trim()
      : value === 0
        ? "0"
        : null;

  if (key && idMap.has(key)) {
    return idMap.get(key);
  }

  const nextId = randomUUID();
  if (key) {
    idMap.set(key, nextId);
  }
  return nextId;
}

function mapId(value, primaryMap, secondaryMap = null) {
  if (primaryMap?.has?.(value)) return primaryMap.get(value);
  if (secondaryMap?.has?.(value)) return secondaryMap.get(value);
  return isUuid(value) ? value : null;
}

function normalizeRoomRecord(room, floorId, roomIdMap) {
  return {
    id: ensureUuid(room?.id, roomIdMap),
    floor_id: floorId,
    name: String(room?.name || "Unnamed").trim() || "Unnamed",
    type: String(room?.type || "other").trim() || "other",
    x: toNumber(room?.x, 0),
    y: toNumber(room?.y, 0),
    width: Math.max(1, toNumber(room?.width, 1)),
    height: Math.max(1, toNumber(room?.height, 1)),
    color: room?.color || null,
    description: room?.description || "",
    polygon_points: normalizePolygon(room?.polygon_points),
  };
}

function normalizeWaypointRecord(waypoint, floorId, waypointIdMap, roomIdMap) {
  return {
    id: ensureUuid(waypoint?.id, waypointIdMap),
    floor_id: floorId,
    room_id: mapId(waypoint?.room_id, roomIdMap),
    x: toNumber(waypoint?.x, 0),
    y: toNumber(waypoint?.y, 0),
    type: String(waypoint?.type || "room_center").trim() || "room_center",
    name: waypoint?.name || "",
    linked_floor_id: isUuid(waypoint?.linked_floor_id)
      ? waypoint.linked_floor_id
      : null,
  };
}

function normalizeConnectionRecord(connection, floorId, connectionIdMap, waypointIdMap) {
  const waypointA = mapId(connection?.waypoint_a_id, waypointIdMap);
  const waypointB = mapId(connection?.waypoint_b_id, waypointIdMap);

  if (!waypointA || !waypointB || waypointA === waypointB) {
    return null;
  }

  return {
    id: ensureUuid(connection?.id, connectionIdMap),
    floor_id: floorId,
    waypoint_a_id: waypointA,
    waypoint_b_id: waypointB,
  };
}

function rewriteElementIdentifiers(mapData, roomIdMap, waypointIdMap) {
  if (!mapData || typeof mapData !== "object") return null;

  const cloned = JSON.parse(JSON.stringify(mapData));
  const elementIdMap = new Map();

  cloned.floors = ensureArray(cloned.floors).map((floor) => {
    const nextFloor = { ...floor };

    nextFloor.elements = ensureArray(floor?.elements).map((element) => {
      const kind = element?.kind || element?.type;
      if (
        (kind === "room" || kind === "rect" || kind === "polygon") &&
        typeof element?.id === "string" &&
        roomIdMap.has(element.id)
      ) {
        return { ...element, id: roomIdMap.get(element.id) };
      }
      if (kind === "waypoint" && typeof element?.id === "string" && waypointIdMap.has(element.id)) {
        return { ...element, id: waypointIdMap.get(element.id) };
      }
      return { ...element, id: ensureUuid(element?.id, elementIdMap) };
    });

    nextFloor.elements = nextFloor.elements.map((element) => ({
      ...element,
      roomId:
        mapId(
          element?.roomId,
          roomIdMap,
          elementIdMap,
        ) || null,
      room_id:
        mapId(
          element?.room_id,
          roomIdMap,
          elementIdMap,
        ) || null,
      linkedRoomId:
        mapId(
          element?.linkedRoomId,
          roomIdMap,
          elementIdMap,
        ) || null,
      linked_room_id:
        mapId(
          element?.linked_room_id,
          roomIdMap,
          elementIdMap,
        ) || null,
      linkedWaypointId:
        mapId(
          element?.linkedWaypointId,
          waypointIdMap,
          elementIdMap,
        ) || null,
      linked_waypoint_id:
        mapId(
          element?.linked_waypoint_id,
          waypointIdMap,
          elementIdMap,
        ) || null,
      linkedDoorId: mapId(element?.linkedDoorId, elementIdMap) || null,
      linked_door_id: mapId(element?.linked_door_id, elementIdMap) || null,
    }));

    return nextFloor;
  });

  return cloned;
}

export function normalizeSaveMapPayload(floorId, payload = {}) {
  const roomIdMap = new Map();
  const waypointIdMap = new Map();
  const connectionIdMap = new Map();

  const rooms = ensureArray(payload.rooms).map((room) =>
    normalizeRoomRecord(room, floorId, roomIdMap),
  );

  const waypoints = ensureArray(payload.waypoints).map((waypoint) =>
    normalizeWaypointRecord(waypoint, floorId, waypointIdMap, roomIdMap),
  );

  const connectionKeys = new Set();
  const connections = ensureArray(payload.connections)
    .map((connection) =>
      normalizeConnectionRecord(
        connection,
        floorId,
        connectionIdMap,
        waypointIdMap,
      ),
    )
    .filter(Boolean)
    .filter((connection) => {
      const key = [connection.waypoint_a_id, connection.waypoint_b_id]
        .sort()
        .join(":");
      if (connectionKeys.has(key)) return false;
      connectionKeys.add(key);
      return true;
    });

  return {
    rooms,
    waypoints,
    connections,
    map_data: rewriteElementIdentifiers(payload.map_data, roomIdMap, waypointIdMap),
    scale_pixels_per_meter: toNumber(payload.scale_pixels_per_meter),
  };
}
