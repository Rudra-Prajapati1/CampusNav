/**
 * Navigation Instruction Generator for CampusNav
 *
 * Generates human-readable turn-by-turn navigation instructions
 * from a sequence of waypoints.
 *
 * Uses vector angle calculations to detect:
 * - Straight ahead
 * - Turn left / slight left
 * - Turn right / slight right
 * - Floor transitions (stairs up/down, elevator up/down)
 * - Arrival at destination
 *
 * Inspired by IWayPlus instruction generation pipeline.
 */

/**
 * Angle thresholds for turn detection (in degrees).
 * These define what constitutes "straight", "slight turn", or "turn".
 */
const ANGLE_THRESHOLDS = {
  STRAIGHT: 20, // ±20° from straight = "continue straight"
  SLIGHT_TURN: 45, // 20°–45° = "bear left/right"
  TURN: 120, // 45°–120° = "turn left/right"
  SHARP_TURN: 180, // 120°–180° = "sharp turn" or "U-turn"
};

/**
 * Minimum distance (in meters) to report in an instruction.
 * Segments shorter than this are merged into the next instruction.
 */
const MIN_INSTRUCTION_DISTANCE = 2;

/**
 * Default pixels-per-meter scale if floor doesn't specify one.
 */
const DEFAULT_SCALE = 50;

/**
 * Calculate the angle between two vectors in degrees.
 *
 * Vector 1: from point A to point B (incoming direction)
 * Vector 2: from point B to point C (outgoing direction)
 *
 * Returns the signed angle where:
 *   negative = left turn
 *   positive = right turn
 *   near 0 = straight
 *
 * @param {Object} a - Previous waypoint { x, y }
 * @param {Object} b - Current waypoint { x, y }
 * @param {Object} c - Next waypoint { x, y }
 * @returns {number} Signed angle in degrees (-180 to 180)
 */
function calculateTurnAngle(a, b, c) {
  // Vector from A to B (incoming)
  const v1x = b.x - a.x;
  const v1y = b.y - a.y;

  // Vector from B to C (outgoing)
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;

  // Calculate angle using atan2
  // atan2 gives the angle of a vector relative to positive X axis
  const angle1 = Math.atan2(v1y, v1x);
  const angle2 = Math.atan2(v2y, v2x);

  // Difference in angles
  let diff = (angle2 - angle1) * (180 / Math.PI);

  // Normalize to -180 to 180
  while (diff > 180) diff -= 360;
  while (diff < -180) diff += 360;

  return diff;
}

/**
 * Classify a turn angle into a human-readable direction.
 *
 * @param {number} angle - Signed angle in degrees
 * @returns {string} Turn classification
 */
function classifyTurn(angle) {
  const absAngle = Math.abs(angle);

  if (absAngle <= ANGLE_THRESHOLDS.STRAIGHT) {
    return "straight";
  }
  if (absAngle <= ANGLE_THRESHOLDS.SLIGHT_TURN) {
    return angle < 0 ? "slight_left" : "slight_right";
  }
  if (absAngle <= ANGLE_THRESHOLDS.TURN) {
    return angle < 0 ? "left" : "right";
  }
  // Sharp turn or U-turn
  return angle < 0 ? "sharp_left" : "sharp_right";
}

/**
 * Calculate Euclidean distance between two points
 * @param {Object} a - Point { x, y }
 * @param {Object} b - Point { x, y }
 * @returns {number} Distance in pixels
 */
function pixelDistance(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Convert pixel distance to meters using floor scale.
 *
 * @param {number} pixels - Distance in pixels
 * @param {Object} floorMap - Map of floor_id → floor data
 * @param {string} floorId - The floor where this distance is measured
 * @returns {number} Distance in meters
 */
function pixelsToMeters(pixels, floorMap, floorId) {
  const floor = floorMap.get(floorId);
  const scale = floor?.scale_pixels_per_meter || DEFAULT_SCALE;
  return pixels / scale;
}

/**
 * Generate turn-by-turn navigation instructions from a path of waypoints.
 *
 * This is the main instruction generation function. It:
 * 1. Walks through the path waypoint by waypoint
 * 2. Detects floor changes (stairs/elevator transitions)
 * 3. Calculates turn angles between consecutive segments
 * 4. Accumulates distance for "walk straight" segments
 * 5. Generates a human-readable instruction for each meaningful event
 *
 * @param {Array} pathWaypoints - Ordered array of waypoint objects in the path
 * @param {Object} fromRoom - Starting room { name }
 * @param {Object} toRoom - Destination room { name }
 * @param {Array} floors - Floor data array [{ id, name, level, scale_pixels_per_meter }]
 * @returns {Array<Object>} Array of instruction objects
 */
export function generateInstructions(pathWaypoints, fromRoom, toRoom, floors) {
  if (!pathWaypoints || pathWaypoints.length === 0) {
    return [{ text: "No path available", type: "error", icon: "❌" }];
  }

  // Create lookup maps for quick access
  const floorMap = new Map();
  floors.forEach((f) => floorMap.set(f.id, f));

  const instructions = [];

  // Step 1: Start instruction
  instructions.push({
    text: `Start at ${fromRoom.name}`,
    type: "start",
    icon: "🚀",
    floor_id: pathWaypoints[0].floor_id,
    floor_name:
      floorMap.get(pathWaypoints[0].floor_id)?.name || "Unknown Floor",
    distance_meters: 0,
    waypoint_index: 0,
  });

  // Track state as we walk the path
  let currentFloorId = pathWaypoints[0].floor_id;
  let accumulatedDistance = 0; // Pixels accumulated since last instruction
  let lastInstructionIndex = 0;

  // Step 2: Walk through the path and generate instructions
  for (let i = 1; i < pathWaypoints.length; i++) {
    const prev = pathWaypoints[i - 1];
    const current = pathWaypoints[i];
    const next = i < pathWaypoints.length - 1 ? pathWaypoints[i + 1] : null;

    const segmentDistPixels = pixelDistance(prev, current);
    const segmentDistMeters = pixelsToMeters(
      segmentDistPixels,
      floorMap,
      prev.floor_id,
    );
    accumulatedDistance += segmentDistMeters;

    // Check for floor change
    if (current.floor_id !== currentFloorId) {
      const prevFloor = floorMap.get(currentFloorId);
      const nextFloor = floorMap.get(current.floor_id);
      const goingUp = (nextFloor?.level ?? 0) > (prevFloor?.level ?? 0);
      const direction = goingUp ? "up" : "down";

      // Emit accumulated walking distance before floor change
      if (accumulatedDistance > MIN_INSTRUCTION_DISTANCE) {
        instructions.push({
          text: `Walk for ${Math.round(accumulatedDistance)} meters`,
          type: "walk",
          icon: "🚶",
          distance_meters: Math.round(accumulatedDistance),
          floor_id: currentFloorId,
          floor_name: prevFloor?.name || "Unknown Floor",
          waypoint_index: i - 1,
        });
      }

      // Determine transition type
      const isElevator =
        prev.type === "elevator" || current.type === "elevator";
      const transitionType = isElevator ? "elevator" : "stairs";
      const icon = isElevator ? "🛗" : "🪜";

      instructions.push({
        text: `Take the ${transitionType} ${direction} to ${nextFloor?.name || "next floor"}`,
        type: `${transitionType}_${direction}`,
        icon,
        floor_id: current.floor_id,
        floor_name: nextFloor?.name || "Unknown Floor",
        from_floor: prevFloor?.name || "Unknown",
        to_floor: nextFloor?.name || "Unknown",
        direction,
        waypoint_index: i,
      });

      currentFloorId = current.floor_id;
      accumulatedDistance = 0;
      lastInstructionIndex = i;
      continue;
    }

    // Check for turns (need at least 3 points: prev → current → next)
    if (next && next.floor_id === current.floor_id && i > 0) {
      // Only consider turns at corridor junctions or decision points
      const angle = calculateTurnAngle(prev, current, next);
      const turnType = classifyTurn(angle);

      if (turnType !== "straight") {
        // Emit accumulated walking distance before the turn
        if (accumulatedDistance > MIN_INSTRUCTION_DISTANCE) {
          const currentFloor = floorMap.get(currentFloorId);
          instructions.push({
            text: `Walk straight for ${Math.round(accumulatedDistance)} meters`,
            type: "walk",
            icon: "🚶",
            distance_meters: Math.round(accumulatedDistance),
            floor_id: currentFloorId,
            floor_name: currentFloor?.name || "Unknown Floor",
            waypoint_index: i,
          });
          accumulatedDistance = 0;
        }

        // Generate turn instruction
        const turnInstruction = generateTurnInstruction(turnType, current);
        instructions.push({
          ...turnInstruction,
          floor_id: currentFloorId,
          floor_name: floorMap.get(currentFloorId)?.name || "Unknown Floor",
          angle: Math.round(angle),
          waypoint_index: i,
        });

        lastInstructionIndex = i;
      }
    }
  }

  // Emit any remaining walking distance before arrival
  if (accumulatedDistance > MIN_INSTRUCTION_DISTANCE) {
    const currentFloor = floorMap.get(currentFloorId);
    instructions.push({
      text: `Walk for ${Math.round(accumulatedDistance)} meters`,
      type: "walk",
      icon: "🚶",
      distance_meters: Math.round(accumulatedDistance),
      floor_id: currentFloorId,
      floor_name: currentFloor?.name || "Unknown Floor",
      waypoint_index: pathWaypoints.length - 1,
    });
  }

  // Step 3: Arrival instruction
  // Determine arrival side hint based on last segment direction
  const arrivalHint = getArrivalHint(pathWaypoints);

  instructions.push({
    text: `Arrive at ${toRoom.name}${arrivalHint}`,
    type: "arrive",
    icon: "🎯",
    floor_id: currentFloorId,
    floor_name: floorMap.get(currentFloorId)?.name || "Unknown Floor",
    distance_meters: 0,
    waypoint_index: pathWaypoints.length - 1,
  });

  return instructions;
}

/**
 * Generate a turn instruction object based on turn classification.
 *
 * @param {string} turnType - Classification: 'left', 'right', 'slight_left', etc.
 * @param {Object} waypoint - The waypoint where the turn occurs
 * @returns {Object} Instruction object
 */
function generateTurnInstruction(turnType, waypoint) {
  const turnTextMap = {
    left: { text: "Turn left", icon: "⬅️" },
    right: { text: "Turn right", icon: "➡️" },
    slight_left: { text: "Bear left", icon: "↖️" },
    slight_right: { text: "Bear right", icon: "↗️" },
    sharp_left: { text: "Sharp left turn", icon: "↩️" },
    sharp_right: { text: "Sharp right turn", icon: "↪️" },
  };

  const turnInfo = turnTextMap[turnType] || { text: "Continue", icon: "➡️" };

  // Add context based on waypoint type
  let context = "";
  if (waypoint.type === "corridor") {
    context = " down the corridor";
  }

  return {
    text: `${turnInfo.text}${context}`,
    type: `turn_${turnType}`,
    icon: turnInfo.icon,
  };
}

/**
 * Generate an arrival direction hint based on the final approach angle.
 * Tells the user which side the destination is on.
 *
 * @param {Array} pathWaypoints - The full path
 * @returns {string} Hint string like " — on your right" or ""
 */
function getArrivalHint(pathWaypoints) {
  if (pathWaypoints.length < 3) return "";

  const len = pathWaypoints.length;
  const beforeLast = pathWaypoints[len - 3];
  const secondToLast = pathWaypoints[len - 2];
  const last = pathWaypoints[len - 1];

  // Only provide hint if all three are on the same floor
  if (
    beforeLast.floor_id !== secondToLast.floor_id ||
    secondToLast.floor_id !== last.floor_id
  ) {
    return "";
  }

  const angle = calculateTurnAngle(beforeLast, secondToLast, last);
  const absAngle = Math.abs(angle);

  if (absAngle <= ANGLE_THRESHOLDS.STRAIGHT) {
    return " — straight ahead";
  }
  if (absAngle <= 90) {
    return angle < 0 ? " — on your left" : " — on your right";
  }

  return "";
}

/**
 * Generate simplified text-only steps (backward compatible).
 * This maintains compatibility with the existing frontend that expects
 * a simple string array for the `steps` field.
 *
 * @param {Array<Object>} instructions - Full instruction objects
 * @returns {Array<string>} Simple text steps
 */
export function instructionsToSteps(instructions) {
  return instructions.map((instr) => `${instr.icon} ${instr.text}`);
}

/**
 * Calculate total walking distance from instructions.
 *
 * @param {Array<Object>} instructions - Full instruction objects
 * @returns {number} Total distance in meters
 */
export function calculateTotalDistance(instructions) {
  return instructions.reduce((total, instr) => {
    return total + (instr.distance_meters || 0);
  }, 0);
}

export default {
  generateInstructions,
  instructionsToSteps,
  calculateTotalDistance,
};
