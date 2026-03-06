import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Search, Navigation, MapPin, X, ChevronDown, Layers, ArrowRight, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { api } from '../../utils/api.js';

const ROOM_TYPES = {
  classroom: { color: '#6366f1', bg: 'rgba(99,102,241,0.18)' },
  lab: { color: '#8b5cf6', bg: 'rgba(139,92,246,0.18)' },
  office: { color: '#06b6d4', bg: 'rgba(6,182,212,0.18)' },
  toilet: { color: '#64748b', bg: 'rgba(100,116,139,0.18)' },
  stairs: { color: '#f59e0b', bg: 'rgba(245,158,11,0.18)' },
  elevator: { color: '#10b981', bg: 'rgba(16,185,129,0.18)' },
  entrance: { color: '#ef4444', bg: 'rgba(239,68,68,0.18)' },
  canteen: { color: '#f97316', bg: 'rgba(249,115,22,0.18)' },
  corridor: { color: '#94a3b8', bg: 'rgba(148,163,184,0.1)' },
  other: { color: '#a3a3a3', bg: 'rgba(163,163,163,0.12)' },
};

export default function NavigatePage() {
  const { buildingId } = useParams();
  const [searchParams] = useSearchParams();
  const fromRoomId = searchParams.get('from');

  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const animFrameRef = useRef(null);
  const imgRef = useRef(null);

  const [building, setBuilding] = useState(null);
  const [floors, setFloors] = useState([]);
  const [currentFloor, setCurrentFloor] = useState(null);
  const [floorData, setFloorData] = useState(null); // { rooms, waypoints, connections }

  const [fromRoom, setFromRoom] = useState(null);
  const [toRoom, setToRoom] = useState(null);
  const [route, setRoute] = useState(null);
  const [routeLoading, setRouteLoading] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchFocus, setSearchFocus] = useState(false);
  const [selectingFor, setSelectingFor] = useState(null); // 'from' | 'to'

  const [pan, setPan] = useState({ x: 40, y: 40 });
  const [zoom, setZoom] = useState(0.9);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState(null);
  const [canvasSize, setCanvasSize] = useState({ w: 800, h: 600 });

  const [pathAnimOffset, setPathAnimOffset] = useState(0);
  const [showSteps, setShowSteps] = useState(false);
  const [floorPlanImg, setFloorPlanImg] = useState(null);

  // Load building + floors
  useEffect(() => {
    api.buildings.get(buildingId).then(b => {
      setBuilding(b);
      const sorted = (b.floors || []).sort((a, b) => a.level - b.level);
      setFloors(sorted);
      if (sorted.length > 0) setCurrentFloor(sorted[0]);
    }).catch(console.error);
  }, [buildingId]);

  // Load floor data when floor changes
  useEffect(() => {
    if (!currentFloor) return;
    api.floors.get(currentFloor.id).then(data => {
      setFloorData(data);
      if (data.floor_plan_url) {
        const img = new Image();
        img.src = data.floor_plan_url;
        img.onload = () => { imgRef.current = img; };
        setFloorPlanImg(data.floor_plan_url);
      } else {
        imgRef.current = null;
        setFloorPlanImg(null);
      }
    }).catch(console.error);
  }, [currentFloor]);

  // Set from-room from QR parameter
  useEffect(() => {
    if (fromRoomId && !fromRoom) {
      api.rooms.get(fromRoomId).then(room => {
        setFromRoom(room);
        // Switch to the correct floor
        if (room.floor_id && floors.length > 0) {
          const f = floors.find(fl => fl.id === room.floor_id);
          if (f) setCurrentFloor(f);
        }
      }).catch(console.error);
    }
  }, [fromRoomId, floors]);

  // Canvas size
  useEffect(() => {
    const update = () => {
      if (containerRef.current) {
        const { width, height } = containerRef.current.getBoundingClientRect();
        setCanvasSize({ w: width, h: height });
      }
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // Path animation
  useEffect(() => {
    if (!route) return;
    const animate = () => {
      setPathAnimOffset(o => (o + 0.5) % 20);
      animFrameRef.current = requestAnimationFrame(animate);
    };
    animFrameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [route]);

  // Canvas render
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !floorData) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    // Floor plan background
    if (imgRef.current) {
      ctx.globalAlpha = 0.3;
      ctx.drawImage(imgRef.current, 0, 0,
        floorData.floor_plan_width || 1200,
        floorData.floor_plan_height || 800);
      ctx.globalAlpha = 1;
    }

    const { rooms = [], waypoints = [], connections = [] } = floorData;

    // Draw rooms
    rooms.forEach(room => {
      const type = ROOM_TYPES[room.type] || ROOM_TYPES.other;
      const isFrom = fromRoom?.id === room.id;
      const isTo = toRoom?.id === room.id;

      // Highlight rooms on route
      const onRoute = route?.path?.some(wp => wp.room_id === room.id);

      ctx.fillStyle = isFrom ? 'rgba(34,197,94,0.25)'
        : isTo ? 'rgba(239,68,68,0.25)'
        : onRoute ? 'rgba(99,102,241,0.25)'
        : (room.color || type.bg);
      ctx.beginPath();
      ctx.roundRect(room.x, room.y, room.width, room.height, 8 / zoom);
      ctx.fill();

      ctx.strokeStyle = isFrom ? '#22c55e'
        : isTo ? '#ef4444'
        : onRoute ? '#6366f1'
        : type.color + '60';
      ctx.lineWidth = (isFrom || isTo || onRoute ? 2.5 : 1.5) / zoom;
      ctx.stroke();

      // Label
      const fontSize = Math.max(9, Math.min(13, room.width / 8)) / zoom;
      ctx.fillStyle = isFrom || isTo ? '#fff' : 'rgba(255,255,255,0.85)';
      ctx.font = `${isFrom || isTo ? '600' : '500'} ${fontSize}px "DM Sans", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(room.name, room.x + room.width / 2, room.y + room.height / 2);

      // From/To icons
      if (isFrom || isTo) {
        const cx = room.x + room.width / 2;
        const cy = room.y - 14 / zoom;
        ctx.beginPath();
        ctx.arc(cx, cy, 8 / zoom, 0, Math.PI * 2);
        ctx.fillStyle = isFrom ? '#22c55e' : '#ef4444';
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${10 / zoom}px sans-serif`;
        ctx.fillText(isFrom ? 'A' : 'B', cx, cy);
      }
    });

    // Draw animated path
    if (route && route.path) {
      const pathOnFloor = route.path.filter(wp => wp.floor_id === currentFloor?.id);
      if (pathOnFloor.length > 1) {
        ctx.beginPath();
        ctx.moveTo(pathOnFloor[0].x, pathOnFloor[0].y);
        pathOnFloor.slice(1).forEach(wp => ctx.lineTo(wp.x, wp.y));

        // Glowing path
        ctx.shadowColor = '#6366f1';
        ctx.shadowBlur = 12;
        ctx.strokeStyle = '#6366f1';
        ctx.lineWidth = 4 / zoom;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.setLineDash([12, 8]);
        ctx.lineDashOffset = -pathAnimOffset;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.shadowBlur = 0;

        // Dots on waypoints
        pathOnFloor.forEach(wp => {
          ctx.beginPath();
          ctx.arc(wp.x, wp.y, 5 / zoom, 0, Math.PI * 2);
          ctx.fillStyle = '#818cf8';
          ctx.fill();
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1.5 / zoom;
          ctx.stroke();
        });
      }
    }

    ctx.restore();
  }, [floorData, fromRoom, toRoom, route, pan, zoom, canvasSize, pathAnimOffset, currentFloor]);

  // Search rooms
  useEffect(() => {
    if (!searchQuery.trim() || !buildingId) { setSearchResults([]); return; }
    const t = setTimeout(async () => {
      const results = await api.rooms.search(buildingId, searchQuery).catch(() => []);
      setSearchResults(results);
    }, 300);
    return () => clearTimeout(t);
  }, [searchQuery, buildingId]);

  const selectRoom = (room) => {
    if (selectingFor === 'from') setFromRoom(room);
    else setToRoom(room);
    setSearchQuery('');
    setSearchResults([]);
    setSelectingFor(null);
    setSearchFocus(false);
  };

  const getRoute = async () => {
    if (!fromRoom || !toRoom) return;
    setRouteLoading(true);
    try {
      const result = await api.navigation.route(fromRoom.id, toRoom.id, buildingId);
      setRoute(result);
      // Switch to first floor of route
      if (result.floors_involved?.length > 0) {
        const f = floors.find(fl => fl.id === result.floors_involved[0]);
        if (f) setCurrentFloor(f);
      }
      setShowSteps(true);
    } catch (err) {
      alert(err.message);
    } finally {
      setRouteLoading(false);
    }
  };

  const clearRoute = () => {
    setRoute(null);
    setToRoom(null);
    setShowSteps(false);
  };

  // Pan handlers
  const handleMouseDown = (e) => {
    setIsPanning(true);
    setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };
  const handleMouseMove = (e) => {
    if (isPanning && panStart) setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
  };
  const handleMouseUp = () => { setIsPanning(false); setPanStart(null); };
  const handleWheel = (e) => {
    e.preventDefault();
    setZoom(z => Math.min(4, Math.max(0.3, z * (e.deltaY > 0 ? 0.9 : 1.1))));
  };

  // Touch support
  const lastTouchRef = useRef(null);
  const handleTouchStart = (e) => {
    if (e.touches.length === 1) {
      const t = e.touches[0];
      setIsPanning(true);
      setPanStart({ x: t.clientX - pan.x, y: t.clientY - pan.y });
      lastTouchRef.current = { x: t.clientX, y: t.clientY };
    }
  };
  const handleTouchMove = (e) => {
    e.preventDefault();
    if (e.touches.length === 1 && isPanning && panStart) {
      const t = e.touches[0];
      setPan({ x: t.clientX - panStart.x, y: t.clientY - panStart.y });
    }
  };
  const handleTouchEnd = () => { setIsPanning(false); setPanStart(null); };

  return (
    <div className="min-h-screen bg-surface-950 flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 px-4 pt-safe-top">
        {/* Building name */}
        <div className="flex items-center gap-2.5 py-3">
          <div className="w-7 h-7 bg-gradient-to-br from-brand-500 to-violet-500 rounded-lg flex items-center justify-center flex-shrink-0">
            <Navigation className="w-3.5 h-3.5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="font-display font-bold text-white text-sm truncate">{building?.name || 'Loading...'}</h1>
          </div>
          {/* Floor selector */}
          {floors.length > 1 && (
            <div className="relative">
              <select
                className="glass text-white text-xs px-3 py-2 rounded-xl appearance-none pr-7 cursor-pointer focus:outline-none focus:border-brand-500/50 border border-white/10"
                value={currentFloor?.id || ''}
                onChange={e => setCurrentFloor(floors.find(f => f.id === e.target.value))}
              >
                {floors.map(f => (
                  <option key={f.id} value={f.id} style={{ background: '#1e293b' }}>{f.name}</option>
                ))}
              </select>
              <Layers className="w-3 h-3 text-white/30 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          )}
        </div>

        {/* Location pickers */}
        <div className="space-y-2 pb-3">
          {/* From */}
          <div
            className={`flex items-center gap-2.5 glass px-3 py-2.5 rounded-xl cursor-pointer transition-all ${selectingFor === 'from' ? 'border-green-500/40' : 'hover:border-white/20'}`}
            onClick={() => { setSelectingFor('from'); setSearchFocus(true); setSearchQuery(''); }}
          >
            <div className="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center flex-shrink-0">
              <span className="text-white text-[9px] font-bold">A</span>
            </div>
            <span className={`text-sm flex-1 ${fromRoom ? 'text-white' : 'text-white/30'}`}>
              {fromRoom?.name || 'Your location / Starting point'}
            </span>
            {fromRoom && (
              <button onClick={e => { e.stopPropagation(); setFromRoom(null); clearRoute(); }}
                className="text-white/30 hover:text-white">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* To */}
          <div
            className={`flex items-center gap-2.5 glass px-3 py-2.5 rounded-xl cursor-pointer transition-all ${selectingFor === 'to' ? 'border-red-500/40' : 'hover:border-white/20'}`}
            onClick={() => { setSelectingFor('to'); setSearchFocus(true); setSearchQuery(''); }}
          >
            <div className="w-5 h-5 bg-red-500 rounded-full flex items-center justify-center flex-shrink-0">
              <span className="text-white text-[9px] font-bold">B</span>
            </div>
            <span className={`text-sm flex-1 ${toRoom ? 'text-white' : 'text-white/30'}`}>
              {toRoom?.name || 'Where do you want to go?'}
            </span>
            {toRoom && (
              <button onClick={e => { e.stopPropagation(); clearRoute(); }}
                className="text-white/30 hover:text-white">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Search input */}
          {selectingFor && (
            <div className="relative animate-in">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
              <input
                className="input pl-9"
                placeholder={`Search rooms, labs, offices...`}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                autoFocus
              />
              {searchResults.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-2 glass rounded-xl overflow-hidden z-50 max-h-48 overflow-y-auto shadow-xl">
                  {searchResults.map(room => (
                    <button
                      key={room.id}
                      className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 transition-colors text-left"
                      onClick={() => selectRoom(room)}
                    >
                      <MapPin className="w-3.5 h-3.5 text-brand-400 flex-shrink-0" />
                      <div>
                        <div className="text-sm text-white">{room.name}</div>
                        <div className="text-xs text-white/30 capitalize">{room.type}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              <button onClick={() => setSelectingFor(null)} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Navigate button */}
          {fromRoom && toRoom && !route && (
            <button onClick={getRoute} disabled={routeLoading} className="btn-primary w-full justify-center animate-in">
              {routeLoading
                ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                : <Navigation className="w-4 h-4" />
              }
              {routeLoading ? 'Finding route...' : 'Get Directions'}
            </button>
          )}
        </div>
      </div>

      {/* Map canvas */}
      <div ref={containerRef} className="flex-1 map-container relative"
        style={{ minHeight: '300px' }}>
        <canvas
          ref={canvasRef}
          width={canvasSize.w}
          height={canvasSize.h}
          style={{ cursor: isPanning ? 'grabbing' : 'grab', touchAction: 'none' }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        />

        {/* Zoom controls */}
        <div className="absolute top-3 right-3 flex flex-col gap-1">
          <button onClick={() => setZoom(z => Math.min(4, z * 1.2))}
            className="glass w-8 h-8 flex items-center justify-center rounded-xl text-white/50 hover:text-white transition-all">
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setZoom(z => Math.max(0.3, z * 0.8))}
            className="glass w-8 h-8 flex items-center justify-center rounded-xl text-white/50 hover:text-white transition-all">
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => { setPan({ x: 40, y: 40 }); setZoom(0.9); }}
            className="glass w-8 h-8 flex items-center justify-center rounded-xl text-white/50 hover:text-white transition-all">
            <RotateCcw className="w-3 h-3" />
          </button>
        </div>

        {/* No map message */}
        {!floorData && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-white/30 text-sm">Loading map...</p>
            </div>
          </div>
        )}
      </div>

      {/* Steps panel */}
      {route && showSteps && (
        <div className="flex-shrink-0 glass border-t border-white/5 max-h-64 overflow-y-auto animate-in">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 sticky top-0 glass">
            <div>
              <span className="font-display font-semibold text-white text-sm">Directions</span>
              <span className="text-white/30 text-xs ml-2">~{route.distance}m walk</span>
            </div>
            <button onClick={() => setShowSteps(false)} className="text-white/30 hover:text-white">
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>
          <div className="p-4 space-y-2">
            {route.steps?.map((step, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="w-5 h-5 bg-brand-600/20 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-brand-400 text-[10px] font-bold">{i + 1}</span>
                </div>
                <span className="text-sm text-white/80">{step}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Show steps button when hidden */}
      {route && !showSteps && (
        <button
          onClick={() => setShowSteps(true)}
          className="flex-shrink-0 glass border-t border-white/5 w-full flex items-center justify-between px-4 py-3 hover:bg-white/3 transition-colors animate-in"
        >
          <span className="text-sm text-white font-medium">View step-by-step directions</span>
          <ArrowRight className="w-4 h-4 text-brand-400" />
        </button>
      )}

      {/* Branding */}
      <div className="flex-shrink-0 text-center py-2 text-white/15 text-xs">
        Powered by CampusNav
      </div>
    </div>
  );
}
