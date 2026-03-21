import { useEffect, useRef, useState, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";

// ─── Constants ───────────────────────────────────────────────────────────────
const COLORS = {
  room: "#3b82f6",
  corridor: "#22d3a5",
  staircase: "#a78bfa",
  elevator: "#f59e0b",
  outdoor: "#34d399",
  entrance: "#fb923c",
  toilet: "#94a3b8",
  parking: "#64748b",
};
const FILLS = {
  room: "rgba(30,58,95,0.75)",
  corridor: "rgba(26,42,26,0.75)",
  staircase: "rgba(42,26,58,0.75)",
  elevator: "rgba(42,32,10,0.75)",
  outdoor: "rgba(20,40,25,0.75)",
  entrance: "rgba(50,30,15,0.75)",
  toilet: "rgba(30,35,45,0.75)",
  parking: "rgba(20,25,35,0.75)",
};
const ZONE_TYPES = ["room","corridor","staircase","elevator","outdoor","entrance","toilet","parking"];
const TOOLS = ["select","rect","polygon","path","waypoint","door","label","measure"];

const uid = () => uuidv4();
const snap = (v, on) => (on ? Math.round(v / 20) * 20 : v);
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

function distToSegment(px, py, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  if (dx === 0 && dy === 0) return dist(px, py, a.x, a.y);
  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / (dx * dx + dy * dy)));
  return dist(px, py, a.x + t * dx, a.y + t * dy);
}

function pointInPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    if (((pts[i].y > y) !== (pts[j].y > y)) &&
      (x < ((pts[j].x - pts[i].x) * (y - pts[i].y)) / (pts[j].y - pts[i].y) + pts[i].x))
      inside = !inside;
  }
  return inside;
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const css = `
  .cne-root {
    display: flex; flex-direction: column; height: 100vh; overflow: hidden;
    background: #0f1117; color: #e8eaf6;
    font-family: 'SF Pro Display', -apple-system, system-ui, sans-serif;
    --bg:#0f1117; --bg2:#161b27; --bg3:#1e2535; --bg4:#252d3f;
    --border:#2a3450; --border2:#3a4a6a;
    --accent:#4f6ef7; --accent2:#6b8bff; --accentdim:rgba(79,110,247,0.15);
    --text:#e8eaf6; --text2:#8892b0; --text3:#4a5568;
    --green:#22d3a5; --amber:#f59e0b; --red:#ef4444; --purple:#a78bfa;
  }
  .cne-topbar {
    display: flex; align-items: center; gap: 6px; padding: 0 12px;
    height: 52px; background: var(--bg2); border-bottom: 1px solid var(--border);
    flex-shrink: 0; overflow-x: auto; overflow-y: hidden;
  }
  .cne-topbar::-webkit-scrollbar { height: 0 }
  .cne-brand { font-weight: 700; font-size: 14px; color: var(--accent2);
    margin-right: 8px; white-space: nowrap; letter-spacing: .5px; }
  .cne-sep { width: 1px; height: 28px; background: var(--border); flex-shrink: 0; }
  .cne-group { display: flex; gap: 2px; align-items: center; }
  .cne-lbl { font-size: 10px; color: var(--text3); text-transform: uppercase;
    letter-spacing: .8px; padding: 0 4px; white-space: nowrap; }
  .cne-btn {
    display: flex; align-items: center; gap: 4px; padding: 5px 9px;
    border-radius: 7px; border: 1px solid transparent; background: transparent;
    color: var(--text2); font-size: 11px; cursor: pointer; white-space: nowrap;
    transition: all .15s; flex-shrink: 0;
  }
  .cne-btn:hover { background: var(--bg3); color: var(--text); border-color: var(--border); }
  .cne-btn.active { background: var(--accentdim); color: var(--accent2); border-color: var(--accent); }
  .cne-btn.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
  .cne-btn.primary:hover { background: var(--accent2); }
  .cne-btn.danger { color: var(--red); }
  .cne-btn.danger:hover { background: rgba(239,68,68,0.15); border-color: var(--red); }
  .cne-btn svg { width: 13px; height: 13px; flex-shrink: 0; }
  .cne-main { display: flex; flex: 1; overflow: hidden; }
  .cne-left {
    width: 192px; background: var(--bg2); border-right: 1px solid var(--border);
    display: flex; flex-direction: column; flex-shrink: 0; overflow-y: auto;
  }
  .cne-left::-webkit-scrollbar { width: 4px; }
  .cne-left::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 2px; }
  .cne-section { padding: 10px; border-bottom: 1px solid var(--border); }
  .cne-ptitle { font-size: 10px; color: var(--text3); text-transform: uppercase;
    letter-spacing: .8px; margin-bottom: 8px; }
  .cne-tool-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
  .cne-tool {
    display: flex; flex-direction: column; align-items: center; gap: 3px;
    padding: 8px 4px; border-radius: 8px; border: 1px solid var(--border);
    background: var(--bg3); color: var(--text2); font-size: 10px;
    cursor: pointer; transition: all .15s; text-align: center;
  }
  .cne-tool:hover { border-color: var(--border2); color: var(--text); }
  .cne-tool.active { border-color: var(--accent); background: var(--accentdim); color: var(--accent2); }
  .cne-tool svg { width: 17px; height: 17px; }
  .cne-zone {
    display: flex; align-items: center; gap: 7px; padding: 6px 8px;
    border-radius: 7px; border: 1px solid var(--border); background: var(--bg3);
    color: var(--text2); font-size: 11px; cursor: pointer; transition: all .15s;
    width: 100%; margin-bottom: 3px;
  }
  .cne-zone:hover { border-color: var(--border2); color: var(--text); }
  .cne-zone.active { border-color: var(--accent); background: var(--accentdim); color: var(--accent2); }
  .cne-zdot { width: 9px; height: 9px; border-radius: 3px; flex-shrink: 0; }
  .cne-floor {
    display: flex; align-items: center; gap: 6px; padding: 6px 8px;
    border-radius: 7px; cursor: pointer; font-size: 11px; color: var(--text2); transition: all .15s;
  }
  .cne-floor:hover { background: var(--bg3); color: var(--text); }
  .cne-floor.active { background: var(--accentdim); color: var(--accent2); }
  .cne-floor-badge {
    width: 18px; height: 18px; border-radius: 4px; background: var(--bg4);
    display: flex; align-items: center; justify-content: center;
    font-size: 9px; flex-shrink: 0;
  }
  .cne-floor-add {
    display: flex; align-items: center; gap: 6px; padding: 6px 8px;
    border-radius: 7px; cursor: pointer; font-size: 11px; color: var(--accent);
    border: 1px dashed var(--border); margin-top: 4px; justify-content: center;
    transition: all .15s;
  }
  .cne-floor-add:hover { background: var(--accentdim); }
  .cne-stat { display: flex; justify-content: space-between; align-items: center;
    padding: 4px 0; font-size: 11px; }
  .cne-stat-lbl { color: var(--text3); }
  .cne-stat-val { color: var(--text); font-weight: 500; }
  .cne-canvas-wrap { flex: 1; position: relative; overflow: hidden; background: var(--bg); }
  .cne-canvas-wrap canvas { position: absolute; top: 0; left: 0; }
  .cne-info {
    position: absolute; bottom: 12px; left: 12px; background: var(--bg2);
    border: 1px solid var(--border); border-radius: 8px; padding: 5px 10px;
    font-size: 11px; color: var(--text2); pointer-events: none; z-index: 10;
  }
  .cne-zoom { position: absolute; bottom: 12px; right: 12px; display: flex; gap: 4px; z-index: 10; }
  .cne-zoom-btn {
    width: 30px; height: 30px; border-radius: 7px; border: 1px solid var(--border);
    background: var(--bg2); color: var(--text2); cursor: pointer;
    display: flex; align-items: center; justify-content: center; font-size: 15px;
    transition: all .15s;
  }
  .cne-zoom-btn:hover { background: var(--bg3); color: var(--text); }
  .cne-right {
    width: 216px; background: var(--bg2); border-left: 1px solid var(--border);
    display: flex; flex-direction: column; flex-shrink: 0; overflow-y: auto;
  }
  .cne-right::-webkit-scrollbar { width: 4px; }
  .cne-right::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 2px; }
  .cne-empty {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    height: 180px; color: var(--text3); font-size: 12px; gap: 8px;
  }
  .cne-prop-row { padding: 8px 10px; border-bottom: 1px solid var(--border); }
  .cne-prop-lbl { font-size: 10px; color: var(--text3); text-transform: uppercase;
    letter-spacing: .7px; margin-bottom: 5px; }
  .cne-input {
    width: 100%; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--border);
    background: var(--bg3); color: var(--text); font-size: 12px; outline: none;
    transition: border-color .15s;
  }
  .cne-input:focus { border-color: var(--accent); }
  .cne-select {
    width: 100%; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--border);
    background: var(--bg3); color: var(--text); font-size: 12px; outline: none;
  }
  .cne-textarea {
    width: 100%; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--border);
    background: var(--bg3); color: var(--text); font-size: 12px; outline: none;
    resize: vertical; min-height: 60px;
  }
  .cne-pbtn {
    width: 100%; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--border);
    background: var(--bg3); color: var(--text2); font-size: 11px; cursor: pointer;
    transition: all .15s; margin-bottom: 4px;
  }
  .cne-pbtn:hover { background: var(--bg4); color: var(--text); }
  .cne-pbtn.primary { border-color: var(--accent); color: var(--accent2); }
  .cne-pbtn.danger { border-color: var(--red); color: var(--red); }
  .cne-row2 { display: flex; gap: 6px; }
  .cne-row2 .cne-input { width: 50%; }
  .cne-hint { font-size: 11px; color: var(--text3); padding: 4px 0; }
  .cne-toast {
    position: fixed; bottom: 64px; left: 50%; transform: translateX(-50%);
    background: var(--bg3); border: 1px solid var(--border2); border-radius: 10px;
    padding: 8px 16px; font-size: 12px; color: var(--text); z-index: 200;
    opacity: 0; transition: opacity .3s; pointer-events: none;
  }
  .cne-toast.show { opacity: 1; }
`;

// ─── Main Component ───────────────────────────────────────────────────────────
export default function MapEditor({ onSave, buildingId, floorId }) {
  const bgRef = useRef(null);
  const mainRef = useRef(null);
  const wrapRef = useRef(null);
  const stateRef = useRef({
    floors: [{ id: uid(), name: "Ground Floor", level: 0, elements: [], bgImage: null }],
    currentFloor: 0,
    tool: "select",
    zoneType: "room",
    zoom: 1, panX: 0, panY: 0,
    selected: [],
    drawing: false, drawStart: null, drawCurrent: null,
    polyPoints: [], pathPoints: null,
    dragging: false, dragStart: null, dragOriginals: [],
    snapToGrid: true, showGrid: true,
    pixelsPerMeter: null,
    history: [], future: [],
    measurePoints: [],
    isPanning: false, panStart: null, panningCanvas: false,
    spaceDown: false,
    bgImages: {},
  });
  const S = stateRef.current;

  const [, forceUpdate] = useState(0);
  const refresh = useCallback(() => forceUpdate(n => n + 1), []);
  const [toast, setToast] = useState({ msg: "", show: false });
  const toastTimer = useRef(null);

  const showToast = (msg) => {
    clearTimeout(toastTimer.current);
    setToast({ msg, show: true });
    toastTimer.current = setTimeout(() => setToast(t => ({ ...t, show: false })), 2000);
  };

  const floor = () => S.floors[S.currentFloor];
  const els = () => floor().elements;

  // ── Canvas setup ─────────────────────────────────────────────────────────
  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    return () => document.head.removeChild(style);
  }, []);

  useEffect(() => {
    const resize = () => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const w = wrap.clientWidth, h = wrap.clientHeight;
      [bgRef, mainRef].forEach(r => {
        if (r.current) { r.current.width = w; r.current.height = h; }
      });
      S.panX = w / 2 - 400; S.panY = h / 2 - 300;
      draw();
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  // ── Draw ─────────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const bgCanvas = bgRef.current, mainCanvas = mainRef.current;
    if (!bgCanvas || !mainCanvas) return;
    const bgCtx = bgCanvas.getContext("2d"), ctx = mainCanvas.getContext("2d");
    const w = mainCanvas.width, h = mainCanvas.height;
    bgCtx.clearRect(0, 0, w, h);
    ctx.clearRect(0, 0, w, h);

    // Grid
    if (S.showGrid) {
      bgCtx.strokeStyle = "rgba(42,52,80,0.5)"; bgCtx.lineWidth = 0.5;
      const step = 20 * S.zoom;
      const ox = ((S.panX % step) + step) % step, oy = ((S.panY % step) + step) % step;
      for (let x = ox; x < w; x += step) { bgCtx.beginPath(); bgCtx.moveTo(x, 0); bgCtx.lineTo(x, h); bgCtx.stroke(); }
      for (let y = oy; y < h; y += step) { bgCtx.beginPath(); bgCtx.moveTo(0, y); bgCtx.lineTo(w, y); bgCtx.stroke(); }
      const step5 = step * 5, ox5 = ((S.panX % step5) + step5) % step5, oy5 = ((S.panY % step5) + step5) % step5;
      bgCtx.strokeStyle = "rgba(58,74,106,0.7)"; bgCtx.lineWidth = 1;
      for (let x = ox5; x < w; x += step5) { bgCtx.beginPath(); bgCtx.moveTo(x, 0); bgCtx.lineTo(x, h); bgCtx.stroke(); }
      for (let y = oy5; y < h; y += step5) { bgCtx.beginPath(); bgCtx.moveTo(0, y); bgCtx.lineTo(w, y); bgCtx.stroke(); }
    }

    // BG Image
    const f = floor();
    const bgImg = S.bgImages[f.id];
    if (bgImg) {
      bgCtx.save(); bgCtx.globalAlpha = 0.35;
      bgCtx.translate(S.panX, S.panY); bgCtx.scale(S.zoom, S.zoom);
      bgCtx.drawImage(bgImg, 0, 0); bgCtx.restore();
    }

    // Elements
    const elems = els();
    elems.filter(e => e.type === "path").forEach(e => drawPath(ctx, e));
    elems.filter(e => e.type !== "path" && e.type !== "waypoint").forEach(e => drawEl(ctx, e));
    elems.filter(e => e.type === "waypoint").forEach(e => drawWaypoint(ctx, e));
    S.selected.forEach(id => { const el = elems.find(e => e.id === id); if (el) drawSel(ctx, el); });

    // Overlay
    drawOverlay(ctx);
  }, []);

  const toCanvas = (wx, wy) => ({ x: wx * S.zoom + S.panX, y: wy * S.zoom + S.panY });
  const toWorld = (cx, cy) => ({ x: (cx - S.panX) / S.zoom, y: (cy - S.panY) / S.zoom });
  const wToC = (el) => {
    const c = toCanvas(el.x, el.y);
    return { x: c.x, y: c.y, w: el.w * S.zoom, h: el.h * S.zoom };
  };

  const drawEl = (ctx, el) => {
    ctx.save();
    const sel = S.selected.includes(el.id);
    if (el.type === "rect" || el.type === "zone") {
      const { x, y, w, h } = wToC(el);
      if (w === 0 || h === 0) { ctx.restore(); return; }
      ctx.fillStyle = FILLS[el.zoneType] || FILLS.room;
      ctx.strokeStyle = sel ? "#ffffff" : (COLORS[el.zoneType] || COLORS.room);
      ctx.lineWidth = sel ? 2.5 : 1.5;
      ctx.beginPath(); ctx.roundRect(x, y, w, h, Math.max(2, 4 * S.zoom)); ctx.fill(); ctx.stroke();
      const fs = Math.max(10, Math.min(14, Math.abs(w) / 6));
      ctx.fillStyle = "rgba(255,255,255,0.92)"; ctx.font = `500 ${fs}px -apple-system, system-ui`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(el.name || "Unnamed", x + w / 2, y + h / 2);
      if (el.zoneType && el.zoneType !== "room") {
        const bfs = Math.max(8, 9 * S.zoom), bh = bfs + 6, bw = bfs * 6;
        ctx.fillStyle = (COLORS[el.zoneType] || "#fff") + "33";
        ctx.strokeStyle = (COLORS[el.zoneType] || "#fff") + "99"; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.roundRect(x + w / 2 - bw / 2, y + 3 * S.zoom, bw, bh, 2 * S.zoom);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = COLORS[el.zoneType] || "#fff"; ctx.font = `${bfs}px -apple-system`;
        ctx.fillText(el.zoneType.toUpperCase(), x + w / 2, y + 3 * S.zoom + bh / 2);
      }
    } else if (el.type === "polygon" && el.points?.length >= 3) {
      ctx.fillStyle = FILLS[el.zoneType] || FILLS.room;
      ctx.strokeStyle = sel ? "#fff" : (COLORS[el.zoneType] || COLORS.room);
      ctx.lineWidth = sel ? 2.5 : 1.5;
      ctx.beginPath();
      const p0 = toCanvas(el.points[0].x, el.points[0].y); ctx.moveTo(p0.x, p0.y);
      el.points.slice(1).forEach(p => { const c = toCanvas(p.x, p.y); ctx.lineTo(c.x, c.y); });
      ctx.closePath(); ctx.fill(); ctx.stroke();
      const cx2 = el.points.reduce((a, p) => a + p.x, 0) / el.points.length;
      const cy2 = el.points.reduce((a, p) => a + p.y, 0) / el.points.length;
      const cc = toCanvas(cx2, cy2);
      ctx.fillStyle = "rgba(255,255,255,0.92)"; ctx.font = `500 12px system-ui`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(el.name || "Unnamed", cc.x, cc.y);
    } else if (el.type === "door") {
      const c = toCanvas(el.x, el.y);
      ctx.fillStyle = "#fb923c"; ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(c.x, c.y, 6 * S.zoom, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.font = `bold ${Math.max(8, 9 * S.zoom)}px system-ui`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("D", c.x, c.y);
      if (el.name) {
        ctx.fillStyle = "rgba(255,255,255,0.7)"; ctx.font = `${Math.max(8, 9 * S.zoom)}px system-ui`;
        ctx.fillText(el.name, c.x, c.y + 13 * S.zoom);
      }
    } else if (el.type === "label") {
      const c = toCanvas(el.x, el.y);
      ctx.fillStyle = "rgba(255,255,255,0.92)"; ctx.font = `500 ${Math.max(10, 13 * S.zoom)}px system-ui`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(el.text || "Label", c.x, c.y);
    }
    ctx.restore();
  };

  const drawPath = (ctx, el) => {
    if (!el.points || el.points.length < 2) return;
    ctx.save();
    const sel = S.selected.includes(el.id);
    ctx.strokeStyle = sel ? "#fff" : "rgba(79,110,247,0.8)";
    ctx.lineWidth = (sel ? 2.5 : 1.5);
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    const p0 = toCanvas(el.points[0].x, el.points[0].y); ctx.moveTo(p0.x, p0.y);
    el.points.slice(1).forEach(p => { const c = toCanvas(p.x, p.y); ctx.lineTo(c.x, c.y); });
    ctx.stroke(); ctx.setLineDash([]);
    if (S.pixelsPerMeter && el.points.length >= 2) {
      let total = 0;
      for (let i = 1; i < el.points.length; i++) {
        const dx = el.points[i].x - el.points[i - 1].x, dy = el.points[i].y - el.points[i - 1].y;
        total += Math.sqrt(dx * dx + dy * dy);
      }
      const meters = (total / S.pixelsPerMeter).toFixed(1);
      const mid = toCanvas(
        (el.points[0].x + el.points[el.points.length - 1].x) / 2,
        (el.points[0].y + el.points[el.points.length - 1].y) / 2
      );
      ctx.fillStyle = "rgba(79,110,247,0.9)"; ctx.font = `10px system-ui`;
      ctx.textAlign = "center"; ctx.fillText(`${meters}m`, mid.x, mid.y - 8);
    }
    ctx.restore();
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem("campusnav-editor");
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved?.floors?.length) {
        S.floors = saved.floors;
        S.currentFloor = 0;
      }
      if (typeof saved?.pixelsPerMeter === "number") {
        S.pixelsPerMeter = saved.pixelsPerMeter;
      }
      refresh();
      draw();
    } catch {
      // Ignore stale editor state in localStorage
    }
  }, [draw, refresh]);

  const drawWaypoint = (ctx, el) => {
    const c = toCanvas(el.x, el.y);
    const sel = S.selected.includes(el.id);
    ctx.save();
    ctx.fillStyle = "rgba(79,110,247,0.9)";
    ctx.strokeStyle = sel ? "#fff" : "rgba(79,110,247,0.4)";
    ctx.lineWidth = 6 * S.zoom;
    ctx.beginPath(); ctx.arc(c.x, c.y, 5 * S.zoom, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    if (el.linkedFloor) {
      ctx.fillStyle = "#a78bfa"; ctx.font = `bold ${Math.max(8, 9 * S.zoom)}px system-ui`;
      ctx.textAlign = "center"; ctx.fillText("↕", c.x, c.y - 10 * S.zoom);
    }
    ctx.restore();
  };

  const drawSel = (ctx, el) => {
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
    if (el.type === "rect" || el.type === "zone") {
      const { x, y, w, h } = wToC(el);
      const pad = 4 * S.zoom;
      ctx.strokeRect(x - pad, y - pad, w + pad * 2, h + pad * 2);
      const handles = [[x, y], [x + w / 2, y], [x + w, y], [x + w, y + h / 2],
      [x + w, y + h], [x + w / 2, y + h], [x, y + h], [x, y + h / 2]];
      ctx.fillStyle = "#fff"; ctx.setLineDash([]);
      handles.forEach(([hx, hy]) => ctx.fillRect(hx - 3, hy - 3, 6, 6));
    } else if (el.type === "polygon" && el.points) {
      el.points.forEach(p => {
        const c = toCanvas(p.x, p.y);
        ctx.fillStyle = "#fff"; ctx.fillRect(c.x - 3, c.y - 3, 6, 6);
      });
    }
    ctx.setLineDash([]);
    ctx.restore();
  };

  const drawOverlay = (ctx) => {
    if (!S.drawing) return;
    ctx.save();
    ctx.strokeStyle = "rgba(79,110,247,0.8)"; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
    if (S.tool === "rect" && S.drawStart && S.drawCurrent) {
      const s = toCanvas(S.drawStart.x, S.drawStart.y), e = toCanvas(S.drawCurrent.x, S.drawCurrent.y);
      ctx.fillStyle = "rgba(79,110,247,0.08)"; ctx.fillRect(s.x, s.y, e.x - s.x, e.y - s.y);
      ctx.strokeRect(s.x, s.y, e.x - s.x, e.y - s.y);
    } else if (S.tool === "polygon" && S.polyPoints.length > 0) {
      ctx.beginPath();
      const p0 = toCanvas(S.polyPoints[0].x, S.polyPoints[0].y); ctx.moveTo(p0.x, p0.y);
      S.polyPoints.slice(1).forEach(p => { const c = toCanvas(p.x, p.y); ctx.lineTo(c.x, c.y); });
      if (S.drawCurrent) { const c = toCanvas(S.drawCurrent.x, S.drawCurrent.y); ctx.lineTo(c.x, c.y); }
      ctx.stroke();
      ctx.setLineDash([]);
      S.polyPoints.forEach(p => {
        const c = toCanvas(p.x, p.y);
        ctx.fillStyle = "#4f6ef7"; ctx.beginPath(); ctx.arc(c.x, c.y, 4, 0, Math.PI * 2); ctx.fill();
      });
    } else if (S.tool === "path" && S.pathPoints?.length >= 1) {
      ctx.beginPath();
      const p0 = toCanvas(S.pathPoints[0].x, S.pathPoints[0].y); ctx.moveTo(p0.x, p0.y);
      S.pathPoints.slice(1).forEach(p => { const c = toCanvas(p.x, p.y); ctx.lineTo(c.x, c.y); });
      if (S.drawCurrent) { const c = toCanvas(S.drawCurrent.x, S.drawCurrent.y); ctx.lineTo(c.x, c.y); }
      ctx.stroke();
    } else if (S.tool === "measure" && S.measurePoints.length === 1 && S.drawCurrent) {
      const s = toCanvas(S.measurePoints[0].x, S.measurePoints[0].y);
      const e = toCanvas(S.drawCurrent.x, S.drawCurrent.y);
      ctx.strokeStyle = "#f59e0b"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y); ctx.stroke();
      const dx = S.drawCurrent.x - S.measurePoints[0].x, dy = S.drawCurrent.y - S.measurePoints[0].y;
      const px = Math.round(Math.sqrt(dx * dx + dy * dy));
      ctx.fillStyle = "#f59e0b"; ctx.font = "12px system-ui"; ctx.textAlign = "center";
      const label = S.pixelsPerMeter ? `${px}px / ${(px / S.pixelsPerMeter).toFixed(1)}m` : `${px}px`;
      ctx.fillText(label, (s.x + e.x) / 2, (s.y + e.y) / 2 - 8);
    }
    ctx.setLineDash([]);
    ctx.restore();
  };

  // ── Hit test ─────────────────────────────────────────────────────────────
  const hitTest = (wx, wy) => {
    const elems = [...els()].reverse();
    for (const el of elems) {
      if (el.type === "rect" || el.type === "zone") {
        if (wx >= el.x && wx <= el.x + el.w && wy >= el.y && wy <= el.y + el.h) return el;
      } else if (el.type === "polygon" && el.points) {
        if (pointInPoly(wx, wy, el.points)) return el;
      } else if (["waypoint", "door", "label"].includes(el.type)) {
        if (dist(wx, wy, el.x, el.y) < 12 / S.zoom) return el;
      } else if (el.type === "path" && el.points) {
        for (let i = 1; i < el.points.length; i++) {
          if (distToSegment(wx, wy, el.points[i - 1], el.points[i]) < 8 / S.zoom) return el;
        }
      }
    }
    return null;
  };

  // ── Mouse events ─────────────────────────────────────────────────────────
  const getPos = (e) => {
    const r = mainRef.current.getBoundingClientRect();
    const cx = e.clientX - r.left, cy = e.clientY - r.top;
    const w = toWorld(cx, cy);
    return { cx, cy, wx: snap(w.x, S.snapToGrid), wy: snap(w.y, S.snapToGrid), wxRaw: w.x, wyRaw: w.y };
  };

  const onMouseDown = (e) => {
    if (e.button === 1 || (e.button === 0 && S.spaceDown)) {
      S.isPanning = true; S.panStart = { x: e.clientX - S.panX, y: e.clientY - S.panY };
      e.preventDefault(); return;
    }
    const p = getPos(e);
    if (S.tool === "select") {
      const hit = hitTest(p.wxRaw, p.wyRaw);
      if (hit) {
        if (!e.shiftKey) S.selected = [hit.id];
        else if (!S.selected.includes(hit.id)) S.selected.push(hit.id);
        else S.selected = S.selected.filter(id => id !== hit.id);
        S.dragging = true; S.dragStart = { x: p.wxRaw, y: p.wyRaw };
        S.dragOriginals = S.selected.map(id => {
          const el = els().find(e => e.id === id); if (!el) return null;
          return { id, x: el.x, y: el.y, points: el.points ? el.points.map(pp => ({ ...pp })) : null };
        }).filter(Boolean);
        renderPropPanel(hit);
      } else {
        if (!e.shiftKey) { S.selected = []; renderPropPanel(null); }
        S.panningCanvas = true; S.panStart = { x: e.clientX - S.panX, y: e.clientY - S.panY };
      }
    } else if (S.tool === "rect") {
      S.drawing = true; S.drawStart = { x: p.wx, y: p.wy }; S.drawCurrent = { x: p.wx, y: p.wy };
    } else if (S.tool === "polygon") {
      if (!S.drawing) { S.drawing = true; S.polyPoints = [{ x: p.wx, y: p.wy }]; }
      else S.polyPoints.push({ x: p.wx, y: p.wy });
    } else if (S.tool === "path") {
      if (!S.pathPoints) { S.pathPoints = [{ x: p.wx, y: p.wy }]; S.drawing = true; }
      else S.pathPoints.push({ x: p.wx, y: p.wy });
    } else if (S.tool === "waypoint") {
      pushHistory(); els().push({ id: uid(), type: "waypoint", x: p.wx, y: p.wy, name: "", linkedFloor: null });
    } else if (S.tool === "door") {
      pushHistory(); els().push({ id: uid(), type: "door", x: p.wx, y: p.wy, name: "Door" });
    } else if (S.tool === "label") {
      const txt = window.prompt("Label text:"); if (!txt) return;
      pushHistory(); els().push({ id: uid(), type: "label", x: p.wx, y: p.wy, text: txt });
    } else if (S.tool === "measure") {
      S.measurePoints.push({ x: p.wxRaw, y: p.wyRaw });
      if (S.measurePoints.length === 2) {
        const dx = S.measurePoints[1].x - S.measurePoints[0].x;
        const dy = S.measurePoints[1].y - S.measurePoints[0].y;
        const px = Math.round(Math.sqrt(dx * dx + dy * dy));
        let msg = `Distance: ${px} pixels`;
        if (S.pixelsPerMeter) msg += ` = ${(px / S.pixelsPerMeter).toFixed(2)} meters`;
        else msg += `\n\nUse Set Scale to convert to meters.`;
        window.alert(msg); S.measurePoints = []; S.drawing = false;
      } else S.drawing = true;
    }
    refresh(); draw();
  };

  const onMouseMove = (e) => {
    if (S.isPanning || S.panningCanvas) {
      S.panX = e.clientX - S.panStart.x; S.panY = e.clientY - S.panStart.y; draw(); return;
    }
    const p = getPos(e);
    if (S.drawing) {
      S.drawCurrent = S.tool === "measure" ? { x: p.wxRaw, y: p.wyRaw } : { x: p.wx, y: p.wy };
    }
    if (S.dragging && S.dragStart) {
      const dx = p.wxRaw - S.dragStart.x, dy = p.wyRaw - S.dragStart.y;
      S.dragOriginals.forEach(orig => {
        const el = els().find(e => e.id === orig.id); if (!el) return;
        if (el.x !== undefined) { el.x = snap(orig.x + dx, S.snapToGrid); el.y = snap(orig.y + dy, S.snapToGrid); }
        if (el.points && orig.points) el.points = orig.points.map(pp => ({ x: snap(pp.x + dx, S.snapToGrid), y: snap(pp.y + dy, S.snapToGrid) }));
      });
    }
    const hit = hitTest(p.wxRaw, p.wyRaw);
    mainRef.current.style.cursor = S.tool === "select" ? (hit ? "move" : "default") : "crosshair";
    draw();
  };

  const onMouseUp = (e) => {
    if (S.isPanning) { S.isPanning = false; return; }
    if (S.panningCanvas) { S.panningCanvas = false; return; }
    const p = getPos(e);
    if (S.tool === "rect" && S.drawing && S.drawStart) {
      const x = Math.min(S.drawStart.x, p.wx), y = Math.min(S.drawStart.y, p.wy);
      const w = Math.abs(p.wx - S.drawStart.x), h = Math.abs(p.wy - S.drawStart.y);
      if (w > 10 && h > 10) {
        pushHistory();
        els().push({ id: uid(), type: "rect", zoneType: S.zoneType, x, y, w, h, name: "", description: "", doors: [] });
      }
      S.drawing = false; S.drawStart = null; S.drawCurrent = null;
    }
    if (S.dragging) { pushHistory(); S.dragging = false; S.dragStart = null; }
    refresh(); draw();
  };

  const onDblClick = (e) => {
    const p = getPos(e);
    if (S.tool === "polygon" && S.drawing && S.polyPoints.length >= 3) {
      pushHistory();
      els().push({ id: uid(), type: "polygon", zoneType: S.zoneType, points: [...S.polyPoints], name: "", description: "" });
      S.polyPoints = []; S.drawing = false; refresh(); draw(); return;
    }
    if (S.tool === "path" && S.pathPoints?.length >= 2) {
      pushHistory();
      els().push({ id: uid(), type: "path", points: [...S.pathPoints] });
      S.pathPoints = null; S.drawing = false; refresh(); draw(); return;
    }
    if (S.tool === "select") {
      const hit = hitTest(p.wxRaw, p.wyRaw);
      if (hit) { S.selected = [hit.id]; renderPropPanel(hit); refresh(); draw(); }
    }
  };

  const onWheel = (e) => {
    e.preventDefault();
    const r = mainRef.current.getBoundingClientRect();
    const cx = e.clientX - r.left, cy = e.clientY - r.top;
    const wx = (cx - S.panX) / S.zoom, wy = (cy - S.panY) / S.zoom;
    S.zoom = Math.min(Math.max(S.zoom * (e.deltaY > 0 ? 0.9 : 1.1), 0.1), 8);
    S.panX = cx - wx * S.zoom; S.panY = cy - wy * S.zoom;
    draw();
  };

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.key === "Delete" || e.key === "Backspace") deleteSelected();
      if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.shiftKey ? redo() : undo(); e.preventDefault(); }
      if ((e.ctrlKey || e.metaKey) && e.key === "y") { redo(); e.preventDefault(); }
      if ((e.ctrlKey || e.metaKey) && e.key === "a") { S.selected = els().map(e => e.id); refresh(); draw(); e.preventDefault(); }
      if ((e.ctrlKey || e.metaKey) && e.key === "d") { duplicateSelected(); e.preventDefault(); }
      if ((e.ctrlKey || e.metaKey) && e.key === "s") { saveMap(); e.preventDefault(); }
      if (e.code === "Space") { S.spaceDown = true; e.preventDefault(); }
      if (e.key === "Escape") { S.drawing = false; S.polyPoints = []; S.pathPoints = null; S.measurePoints = []; setTool("select"); draw(); }
    };
    const onKeyUp = (e) => { if (e.code === "Space") S.spaceDown = false; };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("keyup", onKeyUp); };
  }, []);

  // ── History ───────────────────────────────────────────────────────────────
  const pushHistory = () => {
    S.history.push(JSON.stringify(S.floors));
    if (S.history.length > 60) S.history.shift();
    S.future = [];
  };
  const undo = () => {
    if (!S.history.length) return;
    S.future.push(JSON.stringify(S.floors));
    S.floors = JSON.parse(S.history.pop());
    S.selected = []; refresh(); draw(); showToast("Undo");
  };
  const redo = () => {
    if (!S.future.length) return;
    S.history.push(JSON.stringify(S.floors));
    S.floors = JSON.parse(S.future.pop());
    S.selected = []; refresh(); draw(); showToast("Redo");
  };

  // ── Actions ───────────────────────────────────────────────────────────────
  const deleteSelected = () => {
    if (!S.selected.length) return;
    pushHistory();
    S.floors[S.currentFloor].elements = els().filter(e => !S.selected.includes(e.id));
    S.selected = []; setPropEl(null); refresh(); draw();
  };
  const duplicateSelected = () => {
    if (!S.selected.length) return; pushHistory();
    const newEls = S.selected.map(id => {
      const el = els().find(e => e.id === id); if (!el) return null;
      return { ...JSON.parse(JSON.stringify(el)), id: uid(), x: (el.x || 0) + 30, y: (el.y || 0) + 30 };
    }).filter(Boolean);
    newEls.forEach(e => els().push(e));
    S.selected = newEls.map(e => e.id); refresh(); draw();
  };
  const setTool = (t) => {
    S.tool = t; S.drawing = false; S.polyPoints = []; S.pathPoints = null; S.measurePoints = [];
    refresh(); draw();
  };
  const setZone = (z) => { S.zoneType = z; refresh(); };
  const fitAll = () => {
    const elems = els(); if (!elems.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    elems.forEach(el => {
      if (el.x !== undefined) { minX = Math.min(minX, el.x); minY = Math.min(minY, el.y); maxX = Math.max(maxX, (el.x || 0) + (el.w || 0)); maxY = Math.max(maxY, (el.y || 0) + (el.h || 0)); }
      el.points?.forEach(p => { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); });
    });
    const pad = 60, w = mainRef.current.width - pad * 2, h = mainRef.current.height - pad * 2;
    const rw = maxX - minX, rh = maxY - minY;
    if (rw <= 0 || rh <= 0) return;
    S.zoom = Math.min(w / rw, h / rh, 4);
    S.panX = pad - minX * S.zoom + (w - rw * S.zoom) / 2;
    S.panY = pad - minY * S.zoom + (h - rh * S.zoom) / 2;
    draw();
  };
  const autoNav = () => {
    const rooms = els().filter(e =>
      e.type === "rect" &&
      ["room", "corridor", "staircase", "elevator", "entrance"].includes(e.zoneType)
    );
    if (rooms.length < 2) { showToast("Need at least 2 rooms"); return; }
    pushHistory();
    S.floors[S.currentFloor].elements =
      els().filter(e => e.type !== "waypoint" && e.type !== "path");
    const wps = rooms.map(r => ({
      id: uid(),
      type: "waypoint",
      x: r.x + r.w / 2,
      y: r.y + r.h / 2,
      name: r.name,
      linkedFloor: null,
      floor_id: null,
    }));
    const corridorWps = wps.filter((_, i) => rooms[i].zoneType === "corridor");
    const roomWps = wps.filter((_, i) => rooms[i].zoneType !== "corridor");
    const paths = [];

    if (corridorWps.length >= 2) {
      const sorted = [...corridorWps].sort((a, b) => a.x - b.x);
      paths.push({ id: uid(), type: "path", points: sorted.map(w => ({ x: w.x, y: w.y })) });
    }

    roomWps.forEach(rwp => {
      const target = corridorWps.length > 0
        ? corridorWps.reduce((best, cwp) =>
            Math.hypot(rwp.x - cwp.x, rwp.y - cwp.y) <
            Math.hypot(rwp.x - best.x, rwp.y - best.y) ? cwp : best)
        : null;
      if (target) {
        paths.push({
          id: uid(),
          type: "path",
          points: [{ x: rwp.x, y: rwp.y }, { x: target.x, y: target.y }],
        });
      }
    });

    if (corridorWps.length === 0 && wps.length >= 2) {
      paths.push({ id: uid(), type: "path", points: wps.map(w => ({ x: w.x, y: w.y })) });
    }

    wps.forEach(w => els().push(w));
    paths.forEach(p => els().push(p));
    refresh(); draw();
    showToast(`Generated ${wps.length} waypoints and ${paths.length} paths`);
  };
  const validateMap = () => {
    const issues = [];
    const rooms = els().filter(e => e.type === "rect" && e.zoneType === "room");
    const unnamed = rooms.filter(r => !r.name || r.name === "");
    if (unnamed.length) issues.push(`${unnamed.length} unnamed room(s)`);
    const wps = els().filter(e => e.type === "waypoint");
    if (wps.length === 0 && rooms.length > 0) issues.push("No waypoints — run Auto Waypoints");
    if (!S.pixelsPerMeter) issues.push("Scale not set");
    if (issues.length) window.alert("Issues:\n\n• " + issues.join("\n• "));
    else showToast("Map looks good!");
  };
  const exportJSON = () => {
    const data = JSON.stringify({ floors: S.floors, pixelsPerMeter: S.pixelsPerMeter, version: "1.0" }, null, 2);
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([data], { type: "application/json" }));
    a.download = "campusnav-map.json"; a.click(); showToast("Exported");
  };
  const importJSON = () => { document.getElementById("cne-json-input").click(); };
  const loadJSON = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (data.floors) { S.floors = data.floors; if (data.pixelsPerMeter) S.pixelsPerMeter = data.pixelsPerMeter; S.currentFloor = 0; S.selected = []; refresh(); draw(); showToast("Imported"); }
      } catch { showToast("Invalid JSON"); }
    };
    reader.readAsText(file);
  };
  const uploadBg = () => { document.getElementById("cne-bg-input").click(); };
  const loadBgImage = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const f = floor(); f.bgImage = ev.target.result;
      const img = new Image(); img.onload = () => { S.bgImages[f.id] = img; draw(); };
      img.src = ev.target.result; showToast("Background loaded");
    };
    reader.readAsDataURL(file);
  };
  const setScale = () => {
    const px = window.prompt("How many pixels = 1 meter?\n\nTip: Use the Measure tool first on a known distance.");
    if (px && !isNaN(px)) { S.pixelsPerMeter = parseFloat(px); refresh(); draw(); showToast("Scale set"); }
  };
  const addFloor = () => {
    const name = window.prompt("Floor name:", `Floor ${S.floors.length}`); if (!name) return;
    const level = parseInt(window.prompt("Floor level (0=ground, 1=first...):", "1") || "1");
    S.floors.push({ id: uid(), name, level, elements: [], bgImage: null });
    refresh(); draw();
  };
  const switchFloor = (i) => {
    S.currentFloor = i;
    const f = S.floors[i];
    if (f.bgImage && !S.bgImages[f.id]) {
      const img = new Image(); img.onload = () => { S.bgImages[f.id] = img; draw(); }; img.src = f.bgImage;
    }
    S.selected = []; setPropEl(null); refresh(); draw();
  };
  const saveMap = () => {
    const currentFloorData = S.floors[S.currentFloor];
    const elements = currentFloorData.elements;

    const zoneToType = {
      room: "other",
      corridor: "corridor",
      staircase: "stairs",
      elevator: "elevator",
      outdoor: "other",
      entrance: "entrance",
      toilet: "toilet",
      parking: "other",
    };

    const findRoomId = (wx, wy) => {
      const room = elements.find(el =>
        el.type === "rect" &&
        wx >= el.x && wx <= el.x + el.w &&
        wy >= el.y && wy <= el.y + el.h
      );
      return room ? room.id : null;
    };

    const rooms = elements
      .filter(el => el.type === "rect" || el.type === "polygon")
      .map(el => ({
        id: el.id,
        name: el.name || "Unnamed",
        type: zoneToType[el.zoneType] || "other",
        x: Math.round(el.x || 0),
        y: Math.round(el.y || 0),
        width: Math.round(el.w || el.width || 100),
        height: Math.round(el.h || el.height || 100),
        color: null,
        description: el.description || "",
        polygon_points: el.type === "polygon" ? el.points : null,
      }));

    const waypointElements = elements.filter(el => el.type === "waypoint");

    const waypoints = waypointElements.map(el => ({
      id: el.id,
      x: Math.round(el.x),
      y: Math.round(el.y),
      type: el.linkedFloor ? "stairs" : "room_center",
      room_id: findRoomId(el.x, el.y),
      name: el.name || "",
      linked_floor_id: el.linkedFloor || null,
    }));

    const connections = [];
    const connectedPairs = new Set();

    elements.filter(el => el.type === "path").forEach(path => {
      if (!path.points || path.points.length < 2) return;
      for (let i = 0; i < path.points.length - 1; i++) {
        const findNearestWp = (px, py) => {
          let nearest = null, minDist = Infinity;
          waypointElements.forEach(wp => {
            const d = Math.hypot(wp.x - px, wp.y - py);
            if (d < minDist) { minDist = d; nearest = wp; }
          });
          return nearest && minDist < 40 ? nearest : null;
        };
        const wpA = findNearestWp(path.points[i].x, path.points[i].y);
        const wpB = findNearestWp(path.points[i + 1].x, path.points[i + 1].y);
        if (wpA && wpB && wpA.id !== wpB.id) {
          const key = [wpA.id, wpB.id].sort().join("_");
          if (!connectedPairs.has(key)) {
            connectedPairs.add(key);
            connections.push({
              id: uuidv4(),
              waypoint_a_id: wpA.id,
              waypoint_b_id: wpB.id,
            });
          }
        }
      }
    });

    const fullEditorState = {
      floors: S.floors,
      pixelsPerMeter: S.pixelsPerMeter,
    };

    if (onSave) {
      onSave({
        rooms,
        waypoints,
        connections,
        map_data: fullEditorState,
        scale_pixels_per_meter: S.pixelsPerMeter || null,
      });
    }

    try {
      localStorage.setItem("campusnav-editor", JSON.stringify(fullEditorState));
    } catch {}

    showToast("Map saved");
  };
  const genQRCodes = () => {
    const rooms = els().filter(e => e.type === "rect");
    if (!rooms.length) { showToast("No rooms on this floor"); return; }
    const f = floor();
    const data = rooms.map(r => ({
      roomId: r.id,
      name: r.name || "Unnamed",
      floorId: f.id,
      floorName: f.name,
      url: `${window.location.origin}/navigate/${buildingId || "BUILDING_ID"}?from=${r.id}`,
    }));
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    a.download = "qr-data.json"; a.click(); showToast(`QR data for ${rooms.length} rooms exported`);
  };

  // ── Property panel state ──────────────────────────────────────────────────
  const [propEl, setPropEl] = useState(null);
  const renderPropPanel = (el) => setPropEl(el ? { ...el } : null);

  const updateProp = (key, value) => {
    S.selected.forEach(id => {
      const el = els().find(e => e.id === id); if (!el) return;
      if (key === "name") { el.name = value; el.text = value; }
      else el[key] = value;
    });
    const updated = els().find(e => e.id === (propEl?.id));
    if (updated) setPropEl({ ...updated });
    draw();
  };

  // ── Stats ─────────────────────────────────────────────────────────────────
  const stats = {
    rooms: els().filter(e => e.type === "rect" || e.type === "polygon").length,
    waypoints: els().filter(e => e.type === "waypoint").length,
    paths: els().filter(e => e.type === "path").length,
    doors: els().filter(e => e.type === "door").length,
  };

  const toolHints = {
    select: "Click to select • Drag to move • Drag canvas to pan • Double-click to edit",
    rect: `Drawing ${S.zoneType} — click and drag to draw`,
    polygon: "Click to add points • Double-click to finish polygon",
    path: "Click to add path points • Double-click to end pathway",
    waypoint: "Click to place navigation waypoint",
    door: "Click to place door or entry point",
    label: "Click to place a text label",
    measure: "Click two points to measure distance",
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="cne-root">
      {/* TOPBAR */}
      <div className="cne-topbar">
        <span className="cne-brand">⬡ CampusNav Editor</span>
        <div className="cne-sep" />
        <div className="cne-group">
          <span className="cne-lbl">File</span>
          <button className="cne-btn" onClick={uploadBg}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
            Upload Plan
          </button>
          <button className="cne-btn" onClick={() => { S.floors[S.currentFloor].bgImage = null; delete S.bgImages[floor().id]; draw(); showToast("BG cleared"); }}>Clear BG</button>
          <button className="cne-btn" onClick={exportJSON}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
            Export JSON
          </button>
          <button className="cne-btn" onClick={importJSON}>Import JSON</button>
        </div>
        <div className="cne-sep" />
        <div className="cne-group">
          <span className="cne-lbl">Edit</span>
          <button className="cne-btn" onClick={undo}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 14 4 9 9 4" /><path d="M20 20v-7a4 4 0 00-4-4H4" /></svg>Undo
          </button>
          <button className="cne-btn" onClick={redo}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 14 20 9 15 4" /><path d="M4 20v-7a4 4 0 014-4h12" /></svg>Redo
          </button>
          <button className="cne-btn danger" onClick={deleteSelected}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /></svg>Delete
          </button>
          <button className="cne-btn" onClick={() => { S.selected = els().map(e => e.id); refresh(); draw(); }}>Select All</button>
          <button className="cne-btn" onClick={duplicateSelected}>Duplicate</button>
        </div>
        <div className="cne-sep" />
        <div className="cne-group">
          <span className="cne-lbl">Map</span>
          <button className="cne-btn" onClick={autoNav}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" /></svg>
            Auto Waypoints
          </button>
          <button className="cne-btn" onClick={setScale}>Set Scale</button>
          <button className="cne-btn" onClick={validateMap}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>Validate
          </button>
          <button className="cne-btn" onClick={genQRCodes}>Gen QR Data</button>
          <button className="cne-btn" onClick={() => { S.showGrid = !S.showGrid; draw(); showToast(S.showGrid ? "Grid on" : "Grid off"); }}>Toggle Grid</button>
          <button className="cne-btn" onClick={() => { S.snapToGrid = !S.snapToGrid; refresh(); showToast(S.snapToGrid ? "Snap on" : "Snap off"); }}>
            Snap: {S.snapToGrid ? "ON" : "OFF"}
          </button>
        </div>
        <div className="cne-sep" />
        <button className="cne-btn primary" onClick={saveMap}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
          Save Map
        </button>
      </div>

      <div className="cne-main">
        {/* LEFT PANEL */}
        <div className="cne-left">
          <div className="cne-section">
            <div className="cne-ptitle">Tools</div>
            <div className="cne-tool-grid">
              {[
                { id: "select", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 3l14 9-7 1-3 7z" /></svg>, label: "Select" },
                { id: "rect", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /></svg>, label: "Rectangle" },
                { id: "polygon", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5" /></svg>, label: "Polygon" },
                { id: "path", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12h18M3 6l9 6 9-6" /></svg>, label: "Pathway" },
                { id: "waypoint", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="9" /></svg>, label: "Waypoint" },
                { id: "door", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 21h18M9 21V3l12 2v16" /></svg>, label: "Door/Entry" },
                { id: "label", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="4 7 4 4 20 4 20 7" /><line x1="12" y1="4" x2="12" y2="20" /><line x1="9" y1="20" x2="15" y2="20" /></svg>, label: "Label" },
                { id: "measure", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 12h20M2 12l4-4M2 12l4 4M22 12l-4-4M22 12l-4 4" /></svg>, label: "Measure" },
              ].map(t => (
                <button key={t.id} className={`cne-tool${S.tool === t.id ? " active" : ""}`} onClick={() => setTool(t.id)}>
                  {t.icon}{t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="cne-section">
            <div className="cne-ptitle">Zone Type</div>
            {ZONE_TYPES.map(z => (
              <button key={z} className={`cne-zone${S.zoneType === z ? " active" : ""}`} onClick={() => setZone(z)}>
                <span className="cne-zdot" style={{ background: COLORS[z] }} />
                {z.charAt(0).toUpperCase() + z.slice(1)}
              </button>
            ))}
          </div>

          <div className="cne-section">
            <div className="cne-ptitle">Floors</div>
            {S.floors.map((f, i) => (
              <div key={f.id} className={`cne-floor${i === S.currentFloor ? " active" : ""}`} onClick={() => switchFloor(i)}>
                <span className="cne-floor-badge">{f.level}</span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
              </div>
            ))}
            <div className="cne-floor-add" onClick={addFloor}>+ Add Floor</div>
          </div>

          <div className="cne-section">
            <div className="cne-ptitle">Stats</div>
            {[["Rooms/Zones", stats.rooms], ["Waypoints", stats.waypoints], ["Paths", stats.paths], ["Doors", stats.doors]].map(([l, v]) => (
              <div key={l} className="cne-stat"><span className="cne-stat-lbl">{l}</span><span className="cne-stat-val">{v}</span></div>
            ))}
          </div>
        </div>

        {/* CANVAS */}
        <div className="cne-canvas-wrap" ref={wrapRef}>
          <canvas ref={bgRef} style={{ zIndex: 0 }} />
          <canvas ref={mainRef} style={{ zIndex: 1 }}
            onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp}
            onDoubleClick={onDblClick} onWheel={onWheel} />
          <div className="cne-info">{toolHints[S.tool] || ""}</div>
          <div className="cne-zoom">
            <button className="cne-zoom-btn" onClick={() => { S.zoom = Math.min(S.zoom * 1.2, 8); draw(); }}>+</button>
            <button className="cne-zoom-btn" onClick={fitAll}>⊙</button>
            <button className="cne-zoom-btn" onClick={() => { S.zoom = Math.max(S.zoom / 1.2, 0.1); draw(); }}>−</button>
          </div>
        </div>

        {/* RIGHT PANEL */}
        <div className="cne-right">
          <div className="cne-section">
            <div className="cne-ptitle">Properties</div>
            {!propEl ? (
              <div className="cne-empty">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 9h6M9 12h6M9 15h4" /></svg>
                <span>Select an element</span>
              </div>
            ) : (
              <>
                <div className="cne-prop-row">
                  <div className="cne-prop-lbl">Name</div>
                  <input className="cne-input" value={propEl.name || propEl.text || ""} onChange={e => { updateProp("name", e.target.value); setPropEl(p => ({ ...p, name: e.target.value })); }} />
                </div>
                {(propEl.type === "rect" || propEl.type === "polygon") && (
                  <>
                    <div className="cne-prop-row">
                      <div className="cne-prop-lbl">Zone Type</div>
                      <select className="cne-select" value={propEl.zoneType || "room"} onChange={e => { updateProp("zoneType", e.target.value); setPropEl(p => ({ ...p, zoneType: e.target.value })); }}>
                        {ZONE_TYPES.map(z => <option key={z} value={z}>{z}</option>)}
                      </select>
                    </div>
                    <div className="cne-prop-row">
                      <div className="cne-prop-lbl">Description</div>
                      <textarea className="cne-textarea" value={propEl.description || ""} onChange={e => { updateProp("description", e.target.value); setPropEl(p => ({ ...p, description: e.target.value })); }} />
                    </div>
                  </>
                )}
                {propEl.type === "rect" && (
                  <>
                    <div className="cne-prop-row">
                      <div className="cne-prop-lbl">Width × Height (px)</div>
                      <div className="cne-row2">
                        <input className="cne-input" type="number" value={Math.round(propEl.w || 0)} onChange={e => { updateProp("w", +e.target.value); setPropEl(p => ({ ...p, w: +e.target.value })); }} />
                        <input className="cne-input" type="number" value={Math.round(propEl.h || 0)} onChange={e => { updateProp("h", +e.target.value); setPropEl(p => ({ ...p, h: +e.target.value })); }} />
                      </div>
                    </div>
                    <div className="cne-prop-row">
                      <div className="cne-prop-lbl">Position X, Y</div>
                      <div className="cne-row2">
                        <input className="cne-input" type="number" value={Math.round(propEl.x || 0)} onChange={e => { updateProp("x", +e.target.value); setPropEl(p => ({ ...p, x: +e.target.value })); }} />
                        <input className="cne-input" type="number" value={Math.round(propEl.y || 0)} onChange={e => { updateProp("y", +e.target.value); setPropEl(p => ({ ...p, y: +e.target.value })); }} />
                      </div>
                    </div>
                    {S.pixelsPerMeter && (
                      <div className="cne-prop-row">
                        <div className="cne-prop-lbl">Real Size</div>
                        <div className="cne-hint">{(propEl.w / S.pixelsPerMeter).toFixed(1)}m × {(propEl.h / S.pixelsPerMeter).toFixed(1)}m &nbsp;({((propEl.w * propEl.h) / (S.pixelsPerMeter * S.pixelsPerMeter)).toFixed(1)} m²)</div>
                      </div>
                    )}
                  </>
                )}
                {propEl.type === "waypoint" && (
                  <div className="cne-prop-row">
                    <div className="cne-prop-lbl">Link to Floor (staircase/elevator)</div>
                    <select className="cne-select" value={propEl.linkedFloor || ""} onChange={e => { updateProp("linkedFloor", e.target.value || null); setPropEl(p => ({ ...p, linkedFloor: e.target.value || null })); }}>
                      <option value="">None</option>
                      {S.floors.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </select>
                  </div>
                )}
                <div className="cne-prop-row">
                  <button className="cne-pbtn primary" onClick={() => {
                    const f = floor();
                    const url = `${window.location.origin}/navigate/${buildingId || "BUILDING_ID"}?from=${propEl.id}`;
                    window.alert(`QR URL:\n${url}\n\nRoom: ${propEl.name || "Unnamed"}\nFloor: ${f.name}`);
                  }}>Generate QR Code</button>
                  <button className="cne-pbtn" onClick={duplicateSelected}>Duplicate</button>
                  <button className="cne-pbtn danger" onClick={deleteSelected}>Delete</button>
                </div>
              </>
            )}
          </div>
          <div className="cne-section">
            <div className="cne-ptitle">Quick Actions</div>
            <button className="cne-pbtn" onClick={fitAll}>Fit All in View</button>
            <button className="cne-pbtn" onClick={() => { S.panX = mainRef.current.width / 2; S.panY = mainRef.current.height / 2; draw(); }}>Center View</button>
            <button className="cne-pbtn" onClick={() => { if (window.confirm("Clear this floor?")) { pushHistory(); S.floors[S.currentFloor].elements = []; S.selected = []; setPropEl(null); refresh(); draw(); } }}>Clear Floor</button>
            <button className="cne-pbtn danger" onClick={() => { if (window.confirm("Clear ALL floors?")) { pushHistory(); S.floors.forEach(f => f.elements = []); S.selected = []; setPropEl(null); refresh(); draw(); } }}>Clear Everything</button>
          </div>
          <div className="cne-section">
            <div className="cne-ptitle">Scale</div>
            <div className="cne-hint">{S.pixelsPerMeter ? `1 meter = ${S.pixelsPerMeter.toFixed(1)} pixels` : "Not set — click Set Scale"}</div>
          </div>
        </div>
      </div>

      {/* Hidden inputs */}
      <input type="file" id="cne-bg-input" accept="image/*" style={{ display: "none" }} onChange={loadBgImage} />
      <input type="file" id="cne-json-input" accept=".json" style={{ display: "none" }} onChange={loadJSON} />

      {/* Toast */}
      <div className={`cne-toast${toast.show ? " show" : ""}`}>{toast.msg}</div>
    </div>
  );
}
