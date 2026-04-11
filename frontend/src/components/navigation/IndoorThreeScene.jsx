import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

function roomPolygon(room) {
  if (Array.isArray(room.polygon_points) && room.polygon_points.length >= 3) {
    return room.polygon_points;
  }

  return [
    { x: room.x, y: room.y },
    { x: room.x + room.width, y: room.y },
    { x: room.x + room.width, y: room.y + room.height },
    { x: room.x, y: room.y + room.height },
  ];
}

function floorBounds(indoorMap) {
  const points = indoorMap.rooms.flatMap((room) => roomPolygon(room));
  if (!points.length) {
    return { minX: 0, minY: 0, maxX: 1200, maxY: 800 };
  }
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

function centeredPoint(point, bounds) {
  return {
    x: point.x - (bounds.minX + bounds.maxX) / 2,
    y: (bounds.maxY + bounds.minY) / 2 - point.y,
  };
}

function roomColor(room) {
  const roomType = room.roomType || room.type || "";
  if (room.iconPreset === "food" || roomType === "cafeteria" || roomType === "canteen") {
    return "#F59E0B";
  }
  if (room.iconPreset === "exit" || roomType === "exit" || roomType === "entrance") {
    return "#16A34A";
  }
  if (room.iconPreset === "info") {
    return "#94A3B8";
  }
  return room.color || "#C4B5FD";
}

function makeTextSprite(text, color = "#0F172A") {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.strokeStyle = "rgba(148,163,184,0.35)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(10, 18, canvas.width - 20, canvas.height - 36, 24);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = "600 24px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text.slice(0, 26), canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(48, 18, 1);
  return sprite;
}

export default function IndoorThreeScene({
  indoorMap,
  pathPoints = [],
  sensorPosition = null,
  showBeacons = true,
  viewMode = "isometric",
  isDark = false,
  className = "",
  style,
}) {
  const containerRef = useRef(null);
  const routeMaterialRef = useRef(null);
  const controlsRef = useRef(null);
  const bounds = useMemo(() => floorBounds(indoorMap), [indoorMap]);

  useEffect(() => {
    if (!containerRef.current) return undefined;

    const container = containerRef.current;
    const scene = new THREE.Scene();
    scene.background = null;

    const width = container.clientWidth || 640;
    const height = container.clientHeight || 480;
    const aspect = width / Math.max(height, 1);
    const camera =
      viewMode === "3d"
        ? new THREE.PerspectiveCamera(48, aspect, 1, 5000)
        : new THREE.OrthographicCamera(
            -220 * aspect,
            220 * aspect,
            220,
            -220,
            1,
            5000,
          );
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    container.innerHTML = "";
    container.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(isDark ? 0x9ca3af : 0xffffff, 0.95);
    scene.add(ambient);

    const directional = new THREE.DirectionalLight(0xffffff, 1.15);
    directional.position.set(180, 220, 280);
    directional.castShadow = true;
    scene.add(directional);

    const gridWidth = bounds.maxX - bounds.minX;
    const gridHeight = bounds.maxY - bounds.minY;
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(gridWidth + 120, gridHeight + 120),
      new THREE.MeshStandardMaterial({
        color: isDark ? 0x111827 : 0xf8fafc,
        roughness: 0.95,
        metalness: 0.02,
      }),
    );
    plane.receiveShadow = true;
    plane.position.set(0, 0, 0);
    scene.add(plane);

    indoorMap.rooms.forEach((room) => {
      const polygon = roomPolygon(room).map((point) => centeredPoint(point, bounds));
      const shape = new THREE.Shape();
      shape.moveTo(polygon[0].x, polygon[0].y);
      polygon.slice(1).forEach((point) => shape.lineTo(point.x, point.y));
      shape.closePath();

      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: viewMode === "3d" ? 18 : 10,
        bevelEnabled: false,
      });
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({
          color: roomColor(room),
          roughness: 0.85,
          metalness: 0.04,
        }),
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);

      const label = makeTextSprite(room.name || "Room", isDark ? "#E2E8F0" : "#0F172A");
      const center = centeredPoint(
        {
          x: room.x + room.width / 2,
          y: room.y + room.height / 2,
        },
        bounds,
      );
      label.position.set(center.x, center.y, viewMode === "3d" ? 28 : 18);
      scene.add(label);
    });

    (indoorMap.walls || []).forEach((wall) => {
      const start = centeredPoint({ x: wall.x1, y: wall.y1 }, bounds);
      const end = centeredPoint({ x: wall.x2, y: wall.y2 }, bounds);
      const length = Math.hypot(end.x - start.x, end.y - start.y);
      const angle = Math.atan2(end.y - start.y, end.x - start.x);
      const wallMesh = new THREE.Mesh(
        new THREE.BoxGeometry(length, Math.max(4, wall.thickness || 6), viewMode === "3d" ? 24 : 14),
        new THREE.MeshStandardMaterial({
          color: 0x9ca3af,
          roughness: 0.9,
          metalness: 0.04,
        }),
      );
      wallMesh.position.set(
        (start.x + end.x) / 2,
        (start.y + end.y) / 2,
        viewMode === "3d" ? 12 : 7,
      );
      wallMesh.rotation.z = angle;
      wallMesh.castShadow = true;
      scene.add(wallMesh);
    });

    if (showBeacons) {
      indoorMap.beacons.forEach((beacon) => {
        const point = centeredPoint(beacon, bounds);
        const beaconMesh = new THREE.Mesh(
          new THREE.CylinderGeometry(4, 4, 12, 20),
          new THREE.MeshStandardMaterial({ color: 0xf59e0b }),
        );
        beaconMesh.position.set(point.x, point.y, 10);
        scene.add(beaconMesh);
      });
    }

    indoorMap.objects.forEach((objectElement) => {
      const point = centeredPoint(objectElement, bounds);
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(7, 24, 24),
        new THREE.MeshStandardMaterial({
          color: objectElement.objectType === "exit" ? 0x16a34a : 0x2563eb,
          roughness: 0.35,
          metalness: 0.12,
        }),
      );
      mesh.position.set(point.x, point.y, 12);
      scene.add(mesh);
    });

    if (pathPoints.length > 1) {
      const routePoints = pathPoints.map((point) => {
        const centered = centeredPoint(point, bounds);
        return new THREE.Vector3(centered.x, centered.y, viewMode === "3d" ? 9 : 6);
      });
      const routeGeometry = new THREE.BufferGeometry().setFromPoints(routePoints);
      const material = new THREE.LineDashedMaterial({
        color: 0x2563eb,
        linewidth: 3,
        dashSize: 12,
        gapSize: 6,
      });
      const route = new THREE.Line(routeGeometry, material);
      route.computeLineDistances();
      scene.add(route);
      routeMaterialRef.current = material;
    }

    if (sensorPosition) {
      const point = centeredPoint(sensorPosition, bounds);
      const sensorMesh = new THREE.Mesh(
        new THREE.SphereGeometry(8, 24, 24),
        new THREE.MeshStandardMaterial({ color: 0x0ea5e9 }),
      );
      sensorMesh.position.set(point.x, point.y, 10);
      scene.add(sensorMesh);
    }

    if (viewMode === "3d") {
      camera.position.set(0, -Math.max(gridWidth, gridHeight) * 0.75, 280);
      camera.lookAt(0, 0, 0);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.enablePan = true;
      controls.maxPolarAngle = Math.PI / 2.1;
      controls.minDistance = 120;
      controls.maxDistance = 1200;
      controlsRef.current = controls;
    } else {
      camera.position.set(-240, -220, 260);
      camera.lookAt(0, 0, 0);
    }

    let animationFrame = 0;
    const renderScene = () => {
      animationFrame = requestAnimationFrame(renderScene);
      if (routeMaterialRef.current) {
        routeMaterialRef.current.dashOffset -= 0.18;
      }
      controlsRef.current?.update();
      renderer.render(scene, camera);
    };

    renderScene();

    const handleResize = () => {
      const nextWidth = container.clientWidth || 640;
      const nextHeight = container.clientHeight || 480;
      renderer.setSize(nextWidth, nextHeight);
      if (camera.isPerspectiveCamera) {
        camera.aspect = nextWidth / Math.max(nextHeight, 1);
      } else {
        const nextAspect = nextWidth / Math.max(nextHeight, 1);
        camera.left = -220 * nextAspect;
        camera.right = 220 * nextAspect;
      }
      camera.updateProjectionMatrix();
    };

    window.addEventListener("resize", handleResize);
    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", handleResize);
      controlsRef.current?.dispose();
      controlsRef.current = null;
      renderer.dispose();
      routeMaterialRef.current = null;
      container.innerHTML = "";
    };
  }, [bounds, indoorMap, isDark, pathPoints, sensorPosition, showBeacons, viewMode]);

  return <div ref={containerRef} className={className} style={style} />;
}
