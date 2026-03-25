import { useCallback, useEffect, useRef, useState } from "react";

const INITIAL_STATE = {
  supported: false,
  permissionGranted: false,
  permissionNeeded: false,
  heading: null,
  movement: "Idle",
  stepCount: 0,
  acceleration: 0,
  pitch: null,
  roll: null,
  gyroscope: 0,
};

function normalizeHeading(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return (value + 360) % 360;
}

function blendAngle(previous, next, factor = 0.18) {
  if (previous === null) return next;

  const delta = (((next - previous) + 540) % 360) - 180;
  return normalizeHeading(previous + delta * factor);
}

export function useSensorFusion(enabled = true) {
  const [state, setState] = useState(INITIAL_STATE);
  const motionBaselineRef = useRef(0);
  const stepTimestampRef = useRef(0);
  const headingRef = useRef(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const supported =
      "DeviceMotionEvent" in window || "DeviceOrientationEvent" in window;
    const permissionNeeded =
      typeof window.DeviceMotionEvent?.requestPermission === "function" ||
      typeof window.DeviceOrientationEvent?.requestPermission === "function";

    setState((current) => ({
      ...current,
      supported,
      permissionGranted: supported && !permissionNeeded,
      permissionNeeded,
    }));
  }, []);

  const requestPermission = useCallback(async () => {
    if (typeof window === "undefined") return false;

    try {
      const requests = [];

      if (typeof window.DeviceMotionEvent?.requestPermission === "function") {
        requests.push(window.DeviceMotionEvent.requestPermission());
      }

      if (typeof window.DeviceOrientationEvent?.requestPermission === "function") {
        requests.push(window.DeviceOrientationEvent.requestPermission());
      }

      if (!requests.length) {
        setState((current) => ({ ...current, permissionGranted: true }));
        return true;
      }

      const results = await Promise.all(requests);
      const granted = results.every((result) => result === "granted");
      setState((current) => ({ ...current, permissionGranted: granted }));
      return granted;
    } catch {
      setState((current) => ({ ...current, permissionGranted: false }));
      return false;
    }
  }, []);

  useEffect(() => {
    if (!enabled || !state.supported || !state.permissionGranted) return;

    const onMotion = (event) => {
      const acceleration = event.accelerationIncludingGravity;
      const rotationRate = event.rotationRate;
      if (!acceleration) return;

      const magnitude = Math.hypot(
        acceleration.x || 0,
        acceleration.y || 0,
        acceleration.z || 0,
      );

      motionBaselineRef.current =
        motionBaselineRef.current * 0.82 + magnitude * 0.18;

      const delta = Math.abs(magnitude - motionBaselineRef.current);
      const now = Date.now();
      const isStep = delta > 1.15 && now - stepTimestampRef.current > 360;

      if (isStep) {
        stepTimestampRef.current = now;
      }

      setState((current) => ({
        ...current,
        stepCount: isStep ? current.stepCount + 1 : current.stepCount,
        movement: delta > 0.6 ? "Moving" : "Idle",
        acceleration: Number(delta.toFixed(2)),
        gyroscope: Number(
          Math.hypot(
            rotationRate?.alpha || 0,
            rotationRate?.beta || 0,
            rotationRate?.gamma || 0,
          ).toFixed(1),
        ),
      }));
    };

    const onOrientation = (event) => {
      const rawHeading =
        event.webkitCompassHeading ??
        (typeof event.alpha === "number" ? 360 - event.alpha : null);
      const heading = normalizeHeading(rawHeading);

      if (heading !== null) {
        headingRef.current = blendAngle(headingRef.current, heading);
      }

      setState((current) => ({
        ...current,
        heading: headingRef.current,
        pitch:
          typeof event.beta === "number" ? Number(event.beta.toFixed(1)) : null,
        roll:
          typeof event.gamma === "number" ? Number(event.gamma.toFixed(1)) : null,
      }));
    };

    window.addEventListener("devicemotion", onMotion);
    window.addEventListener("deviceorientation", onOrientation, true);

    return () => {
      window.removeEventListener("devicemotion", onMotion);
      window.removeEventListener("deviceorientation", onOrientation, true);
    };
  }, [enabled, state.permissionGranted, state.supported]);

  return {
    ...state,
    requestPermission,
  };
}

export default useSensorFusion;
