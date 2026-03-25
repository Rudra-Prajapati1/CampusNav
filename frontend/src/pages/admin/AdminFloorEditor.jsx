import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Compass, Save } from "lucide-react";
import toast from "react-hot-toast";
import MapEditor from "../../components/MapEditor.jsx";
import { api } from "../../utils/api.js";

export default function AdminFloorEditor() {
  const { buildingId, floorId } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [floorName, setFloorName] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadFloor() {
      try {
        const floor = await api.floors.get(floorId);
        if (cancelled) return;

        setFloorName(floor.name);
        if (floor.map_data) {
          localStorage.setItem("campusnav-editor", JSON.stringify(floor.map_data));
        } else {
          localStorage.removeItem("campusnav-editor");
        }
      } catch (error) {
        toast.error(`Failed to load floor: ${error.message}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadFloor();
    return () => {
      cancelled = true;
    };
  }, [floorId]);

  const handleSave = useCallback(
    async ({ rooms, waypoints, connections, map_data, scale_pixels_per_meter }) => {
      setSaving(true);
      try {
        await api.floors.saveMap(floorId, {
          rooms,
          waypoints,
          connections,
          scale_pixels_per_meter,
        });
        await api.floors.update(floorId, { map_data });
        toast.success("Map saved");
      } catch (error) {
        toast.error(`Failed to save: ${error.message}`);
      } finally {
        setSaving(false);
      }
    },
    [floorId],
  );

  if (loading) {
    return (
      <div className="page-shell flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 rounded-full border-2 border-brand-500 border-t-transparent animate-spin" />
          <div className="text-sm subtle-text">Loading floor editor...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell page-grid min-h-screen p-3 sm:p-4">
      <div className="mx-auto flex h-[calc(100dvh-1.5rem)] w-full max-w-[1500px] flex-col overflow-hidden rounded-[32px] border border-[var(--border)] bg-[var(--surface)] shadow-card lg:h-[calc(100dvh-2rem)]">
        <header className="flex flex-col gap-4 border-b border-[var(--border)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-4">
            <button onClick={() => navigate("/admin/buildings")} className="btn-secondary">
              <ArrowLeft className="h-4 w-4" />
              Back to buildings
            </button>
            <div>
              <div className="badge mb-2">
                <Compass className="h-3.5 w-3.5 text-brand-500" />
                Floor editor
              </div>
              <h1 className="font-display text-2xl font-bold">{floorName}</h1>
              <p className="text-sm subtle-text">
                Improve room geometry, waypoints, doors, and route quality for this floor.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="rounded-full border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-2 text-sm font-semibold">
              {saving ? "Saving changes..." : "Editor ready"}
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-500/10 text-brand-500">
              <Save className="h-4 w-4" />
            </div>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-hidden">
          <MapEditor buildingId={buildingId} floorId={floorId} onSave={handleSave} />
        </div>
      </div>
    </div>
  );
}
