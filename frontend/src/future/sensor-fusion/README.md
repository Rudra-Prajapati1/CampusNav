# Future Sensor Fusion

This folder preserves inactive device motion and orientation experiments. It is
not imported by production navigation today.

The code here is retained for future work on:

- Gyroscope and accelerometer-based heading.
- Motion smoothing and step detection.
- Device-orientation permission handling.
- Indoor blue-dot positioning and AR navigation foundations.

Reactivation should happen behind a capability check and feature flag because
mobile browser sensor permissions vary by platform and can affect user trust.
