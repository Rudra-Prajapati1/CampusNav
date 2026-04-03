// CampusNav update — AdminFloorEditor.jsx
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Check,
  Eye,
  LayoutGrid,
  Loader2,
  Magnet,
  Moon,
  Redo2,
  Sun,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import toast from "react-hot-toast";
import MapEditor from "../../components/MapEditor.jsx";
import { useTheme } from "../../context/themeContext.jsx";
import { api } from "../../utils/api.js";

function defaultStatus() {
  return {
    tool: "select",
    zoom: 1,
    dirty: false,
    canUndo: false,
    canRedo: false,
    showGrid: true,
    showLabels: true,
    snapToGrid: true,
    cursor: null,
    selectedElement: null,
    counts: { rooms: 0, waypoints: 0, paths: 0, doors: 0, beacons: 0 },
    saveStatus: "Saved",
    readiness: "Needs review",
    issues: [],
  };
}

function IconButton({ title, children, active = false, disabled = false, onClick }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md border border-default text-secondary transition-colors ${
        active ? "bg-accent text-white border-accent" : "bg-surface hover:bg-surface-alt"
      } disabled:cursor-not-allowed disabled:opacity-50`}
    >
      {children}
    </button>
  );
}

export default function AdminFloorEditor() {
  const { buildingId, floorId } = useParams();
  const navigate = useNavigate();
  const { isDark, toggleTheme } = useTheme();
  const editorRef = useRef(null);
  const saveTimerRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSucceeded, setSaveSucceeded] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [previewView, setPreviewView] = useState("2d");
  const [building, setBuilding] = useState(null);
  const [floorData, setFloorData] = useState(null);
  const [floors, setFloors] = useState([]);
  const [editorStatus, setEditorStatus] = useState(defaultStatus());

  const markSaved = useCallback(() => {
    window.clearTimeout(saveTimerRef.current);
    setSaveSucceeded(true);
    saveTimerRef.current = window.setTimeout(() => {
      setSaveSucceeded(false);
    }, 2000);
  }, []);

  useEffect(() => {
    return () => {
      window.clearTimeout(saveTimerRef.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadEditor() {
      setLoading(true);
      try {
        const [buildingData, currentFloor, buildingFloors] = await Promise.all([
          api.buildings.get(buildingId),
          api.floors.get(floorId),
          api.floors.byBuilding(buildingId),
        ]);

        if (cancelled) return;
        setBuilding(buildingData);
        setFloorData(currentFloor);
        setFloors(buildingFloors || []);
      } catch (error) {
        if (!cancelled) {
          toast.error(error.message || "Unable to load floor editor");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadEditor();
    return () => {
      cancelled = true;
    };
  }, [buildingId, floorId]);

  useEffect(() => {
    const handleBeforeUnload = (event) => {
      if (!editorStatus.dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [editorStatus.dirty]);

  const handleSave = useCallback(
    async ({ rooms, waypoints, connections, map_data, scale_pixels_per_meter }) => {
      setSaving(true);
      setSaveSucceeded(false);

      try {
        await api.floors.saveMap(floorId, {
          rooms,
          waypoints,
          connections,
          scale_pixels_per_meter,
        });
        await api.floors.update(floorId, { map_data });
        setFloorData((current) =>
          current
            ? {
                ...current,
                map_data,
                rooms,
                waypoints,
                connections,
                scale_pixels_per_meter,
              }
            : current,
        );
        toast.success("Floor map saved");
        markSaved();
      } catch (error) {
        toast.error(error.message || "Unable to save floor map");
        throw error;
      } finally {
        setSaving(false);
      }
    },
    [floorId, markSaved],
  );

  async function runEditorAction(action) {
    if (!editorRef.current) return;
    try {
      return await action(editorRef.current);
    } catch (error) {
      if (error?.message) {
        toast.error(error.message);
      }
      return null;
    }
  }

  const handleBack = () => {
    if (
      editorStatus.dirty &&
      !window.confirm("You have unsaved changes. Leave the editor anyway?")
    ) {
      return;
    }
    navigate("/admin/buildings");
  };

  const handleSaveClick = async () => {
    await runEditorAction((editor) => editor.save());
  };

  const handleZoomReset = async () => {
    await runEditorAction((editor) => editor.setZoom?.(1));
  };

  const totalElements =
    editorStatus.counts.rooms +
    editorStatus.counts.waypoints +
    editorStatus.counts.paths +
    editorStatus.counts.doors +
    (editorStatus.counts.beacons || 0);

  const statusText = saving
    ? "Saving..."
    : saveSucceeded
      ? "Saved"
      : editorStatus.saveStatus || "Saved";

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg px-6">
        <div className="card-sm flex flex-col items-center gap-4 text-center">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          <div>
            <div className="text-base font-semibold">Loading floor editor</div>
            <p className="mt-1 text-sm subtle-text">
              Preparing map geometry, room data, and editor controls.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!floorData) {
    return (
      <div className="flex h-screen flex-col bg-bg">
        <header className="flex h-12 items-center border-b border-default bg-surface px-3">
          <button type="button" onClick={handleBack} className="btn-ghost px-3">
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
        </header>
        <div className="flex min-h-0 flex-1 items-center justify-center px-6">
          <div className="card max-w-lg text-center">
            <h2 className="text-2xl font-bold tracking-[-0.02em] text-primary">
              Floor not available
            </h2>
            <p className="mt-3 text-sm subtle-text">
              CampusNav could not load the requested floor. Return to the buildings
              workspace and try again.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-bg text-primary">
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-default bg-surface px-3">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={handleBack}
            className="inline-flex h-8 items-center gap-2 rounded-md border border-default bg-surface px-3 text-sm font-medium text-secondary transition-colors hover:bg-surface-alt"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <div className="min-w-0 text-xs text-muted">
            <span className="truncate">{building?.name || "Building"}</span>
            <span className="px-2">/</span>
            <span className="truncate">{floorData.name}</span>
          </div>
          {floors.length > 1 && (
            <select
              className="select h-8 min-w-[170px] py-1 text-sm"
              value={floorData.id}
              onChange={(event) => {
                const nextFloor = floors.find((floor) => floor.id === event.target.value);
                if (!nextFloor || nextFloor.id === floorData.id) return;
                if (
                  editorStatus.dirty &&
                  !window.confirm("You have unsaved changes. Switch floors anyway?")
                ) {
                  return;
                }
                navigate(`/admin/buildings/${buildingId}/floors/${nextFloor.id}/editor`);
              }}
            >
              {floors.map((floor) => (
                <option key={floor.id} value={floor.id}>
                  {floor.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="hidden items-center gap-2 md:flex">
          <IconButton
            title="Undo (Ctrl+Z)"
            disabled={!editorStatus.canUndo || saving}
            onClick={() => runEditorAction((editor) => editor.undo())}
          >
            <Undo2 className="h-4 w-4" />
          </IconButton>
          <IconButton
            title="Redo (Ctrl+Y)"
            disabled={!editorStatus.canRedo || saving}
            onClick={() => runEditorAction((editor) => editor.redo())}
          >
            <Redo2 className="h-4 w-4" />
          </IconButton>

          <div className="h-5 w-px bg-border-default" />

          <IconButton
            title="Zoom Out"
            onClick={() => runEditorAction((editor) => editor.zoomOut())}
          >
            <ZoomOut className="h-4 w-4" />
          </IconButton>
          <button
            type="button"
            title="Reset zoom to 100%"
            onClick={handleZoomReset}
            className="min-w-[64px] rounded-md border border-default bg-surface px-2 py-1 text-sm font-semibold text-secondary transition-colors hover:bg-surface-alt"
          >
            {Math.round((editorStatus.zoom || 1) * 100)}%
          </button>
          <IconButton
            title="Zoom In"
            onClick={() => runEditorAction((editor) => editor.zoomIn())}
          >
            <ZoomIn className="h-4 w-4" />
          </IconButton>

          <div className="h-5 w-px bg-border-default" />

          <IconButton
            title="Toggle Grid"
            active={editorStatus.showGrid}
            onClick={() => runEditorAction((editor) => editor.toggleGrid())}
          >
            <LayoutGrid className="h-4 w-4" />
          </IconButton>
          <IconButton
            title="Toggle Snap"
            active={editorStatus.snapToGrid}
            onClick={() => runEditorAction((editor) => editor.toggleSnap())}
          >
            <Magnet className="h-4 w-4" />
          </IconButton>
        </div>

        <div className="flex items-center gap-2">
          {previewMode && (
            <div className="hidden items-center rounded-md border border-default bg-surface p-1 sm:inline-flex">
              {["2d", "3d"].map((modeOption) => (
                <button
                  key={modeOption}
                  type="button"
                  onClick={() => setPreviewView(modeOption)}
                  className={`rounded px-2 py-1 text-xs font-semibold uppercase tracking-[0.08em] ${
                    previewView === modeOption
                      ? "bg-accent text-white"
                      : "text-secondary"
                  }`}
                >
                  {modeOption}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => setPreviewMode((current) => !current)}
            className={`inline-flex h-8 items-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors ${
              previewMode
                ? "border-accent bg-accent-light text-accent"
                : "border-default bg-surface text-secondary hover:bg-surface-alt"
            }`}
          >
            <Eye className="h-4 w-4" />
            Preview
          </button>
          <button
            type="button"
            onClick={handleSaveClick}
            disabled={saving}
            className="btn-primary h-8 px-3 text-sm"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : saveSucceeded ? (
              <Check className="h-4 w-4" />
            ) : null}
            {saving ? "Saving..." : saveSucceeded ? "Saved" : "Save"}
          </button>
          <IconButton
            title={isDark ? "Switch to light mode" : "Switch to dark mode"}
            onClick={toggleTheme}
          >
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </IconButton>
        </div>
      </header>

      <div className="min-h-0 flex-1">
        <MapEditor
          ref={editorRef}
          floorData={floorData}
          floors={floors}
          building={building}
          buildingIndustry={building?.industry || "education"}
          onSave={handleSave}
          onStateChange={setEditorStatus}
          previewMode={previewMode}
          previewView={previewView}
        />
      </div>

      <footer className="flex h-7 shrink-0 items-center justify-between gap-4 border-t border-default bg-surface px-3 text-[11px] text-muted">
        <div>Tool: {editorStatus.tool || "select"}</div>
        <div className="hidden md:block">
          {totalElements} elements • {editorStatus.counts.rooms} rooms •{" "}
          {editorStatus.counts.waypoints} waypoints • {editorStatus.counts.beacons || 0} beacons
        </div>
        <div className="flex items-center gap-3 font-mono">
          <span className="hidden md:inline">{editorStatus.readiness}</span>
          <span>{statusText}</span>
          <span>
            {editorStatus.cursor
              ? `${Math.round(editorStatus.cursor.x)}, ${Math.round(editorStatus.cursor.y)}`
              : "--, --"}
          </span>
        </div>
      </footer>
    </div>
  );
}
