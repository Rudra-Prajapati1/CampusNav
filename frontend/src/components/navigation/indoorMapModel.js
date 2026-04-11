// CampusNav update — indoorMapModel.js
// Canonical indoor map model utilities.
// Product logic should read from this normalized model rather than directly
// from any renderer-specific object shape.

function toFiniteNumber(value) {
  const parsed =
    typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizePoint(point = {}) {
  return {
    x: toFiniteNumber(point.x) ?? 0,
    y: toFiniteNumber(point.y) ?? 0,
  };
}

function normalizeOverlayBounds(bounds) {
  if (!bounds) return null;

  const normalized = {
    north: toFiniteNumber(bounds.north),
    south: toFiniteNumber(bounds.south),
    east: toFiniteNumber(bounds.east),
    west: toFiniteNumber(bounds.west),
  };

  return Object.values(normalized).every((value) => Number.isFinite(value))
    ? normalized
    : null;
}

function normalizeFloorDescriptor(entry = {}, fallback = {}) {
  return {
    id: entry.id || fallback.id || null,
    name: entry.name || fallback.name || "Untitled floor",
    level: toFiniteNumber(entry.level ?? fallback.level) ?? 0,
    overlayBounds: normalizeOverlayBounds(entry.overlayBounds),
    corners: Array.isArray(entry.corners) ? entry.corners : [],
    georeference: entry.georeference || null,
    metadata: {
      backgroundDataUrl: entry.backgroundDataUrl || null,
      threeD: entry.threeD || {},
    },
  };
}

function normalizeRoom(room = {}) {
  return {
    ...room,
    kind: "room",
    x: toFiniteNumber(room.x) ?? 0,
    y: toFiniteNumber(room.y) ?? 0,
    width: toFiniteNumber(room.width) ?? 0,
    height: toFiniteNumber(room.height) ?? 0,
    shape: room.shape || room.type || "rect",
    shapePreset: room.shapePreset || "rectangle",
    iconPreset: room.iconPreset || "auto",
    rotation: toFiniteNumber(room.rotation) ?? 0,
    layerIndex: toFiniteNumber(room.layerIndex) ?? 100,
    polygon_points: Array.isArray(room.polygon_points)
      ? room.polygon_points.map(normalizePoint)
      : Array.isArray(room.points)
        ? room.points.map(normalizePoint)
      : [],
  };
}

function normalizePath(path = {}) {
  return {
    ...path,
    points: Array.isArray(path.points) ? path.points.map(normalizePoint) : [],
  };
}

function normalizeElement(element = {}) {
  return {
    ...element,
    kind: element.kind || element.type || "unknown",
    x: toFiniteNumber(element.x) ?? 0,
    y: toFiniteNumber(element.y) ?? 0,
    width: toFiniteNumber(element.width) ?? 0,
    height: toFiniteNumber(element.height) ?? 0,
    points: Array.isArray(element.points)
      ? element.points.map(normalizePoint)
      : [],
    polygon_points: Array.isArray(element.polygon_points)
      ? element.polygon_points.map(normalizePoint)
      : [],
    shapePreset: element.shapePreset || "rectangle",
    iconPreset: element.iconPreset || "auto",
    rotation: toFiniteNumber(element.rotation) ?? 0,
    layerIndex: toFiniteNumber(element.layerIndex) ?? 0,
    radiusMeters: toFiniteNumber(element.radiusMeters ?? element.radius_meters) ?? null,
    txPower: toFiniteNumber(element.txPower ?? element.tx_power) ?? null,
    floorId: element.floorId || element.floor_id || null,
    roomId: element.roomId || element.room_id || null,
    edge: element.edge || "right",
    offset: toFiniteNumber(element.offset) ?? 0.5,
    linkedRoomId: element.linkedRoomId || element.linked_room_id || null,
    linkedDoorId: element.linkedDoorId || element.linked_door_id || null,
  };
}

export function findMatchingFloorEntry(floorData) {
  const floors = floorData?.map_data?.floors;
  if (!Array.isArray(floors) || floors.length === 0) return null;

  return (
    floors.find((entry) => entry.id === floorData?.id) ||
    floors.find((entry) => entry.name === floorData?.name) ||
    floors.find((entry) => entry.level === floorData?.level) ||
    floors[0]
  );
}

export function buildCanonicalIndoorMap(floorData) {
  const floorEntry = findMatchingFloorEntry(floorData);
  const mapData = floorData?.map_data || {};
  const elements = Array.isArray(floorEntry?.elements)
    ? floorEntry.elements.map(normalizeElement)
    : [];
  const elementRooms = elements
    .filter((element) => element.kind === "room")
    .map((element) =>
      normalizeRoom({
        ...element,
        polygon_points: element.polygon_points?.length ? element.polygon_points : element.points,
      }),
    );
  const rooms = elementRooms.length
    ? elementRooms
    : Array.isArray(floorData?.rooms)
      ? floorData.rooms.map(normalizeRoom)
      : [];
  const elementWaypoints = elements
    .filter((element) => element.kind === "waypoint")
    .map(normalizeElement);
  const waypoints = elementWaypoints.length
    ? elementWaypoints
    : Array.isArray(floorData?.waypoints)
      ? floorData.waypoints.map(normalizeElement)
      : [];
  const paths = elements
    .filter((element) => element.kind === "path")
    .map(normalizePath);
  const doors = elements.filter((element) => element.kind === "door");
  const walls = elements.filter((element) => element.kind === "wall");
  const windows = elements.filter((element) => element.kind === "window");
  const beacons = elements.filter((element) => element.kind === "beacon");
  const objects = elements.filter((element) => element.kind === "object");

  return {
    version: 1,
    floor: normalizeFloorDescriptor(floorEntry || {}, floorData || {}),
    floors: Array.isArray(mapData.floors)
      ? mapData.floors.map((entry) => normalizeFloorDescriptor(entry, floorData))
      : floorData
        ? [normalizeFloorDescriptor({}, floorData)]
        : [],
    rooms,
    doors,
    waypoints,
    paths,
    walls,
    windows,
    beacons,
    objects,
    metadata: {
      showGrid: mapData.showGrid ?? true,
      showLabels: mapData.showLabels ?? true,
      snapToGrid: mapData.snapToGrid ?? true,
      pixelsPerMeter:
        toFiniteNumber(mapData.pixelsPerMeter) ??
        toFiniteNumber(floorData?.scale_pixels_per_meter),
      floorPlanWidth: toFiniteNumber(floorData?.floor_plan_width) ?? 0,
      floorPlanHeight: toFiniteNumber(floorData?.floor_plan_height) ?? 0,
      future3d: {
        extrusionHeight:
          toFiniteNumber(floorEntry?.threeD?.extrusionHeight) ?? 3.2,
        wallHeight: toFiniteNumber(floorEntry?.threeD?.wallHeight) ?? 3.2,
        ceilingHeight: toFiniteNumber(floorEntry?.threeD?.ceilingHeight) ?? 3.6,
      },
    },
    raw: {
      floorData,
      floorEntry,
      elements,
    },
  };
}

export function getIndoorOverlayBounds(floorData) {
  return buildCanonicalIndoorMap(floorData).floor.overlayBounds;
}

export function getIndoorMapElements(floorData) {
  return buildCanonicalIndoorMap(floorData).raw.elements;
}
