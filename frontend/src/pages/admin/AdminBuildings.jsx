import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Building2,
  ChevronDown,
  Edit2,
  Layers,
  Map,
  MapPin,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import toast from "react-hot-toast";
import { api } from "../../utils/api.js";

function ModalShell({ title, onClose, children, width = "max-w-xl" }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-sm">
      <div className={`glass-light w-full ${width} rounded-[30px] p-6 sm:p-7`}>
        <div className="mb-6 flex items-center justify-between gap-3">
          <h2 className="font-display text-2xl font-bold">{title}</h2>
          <button onClick={onClose} className="btn-ghost h-11 w-11 rounded-full p-0">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function BuildingModal({ building, onClose, onSave }) {
  const [form, setForm] = useState({
    name: building?.name || "",
    description: building?.description || "",
    address: building?.address || "",
    entrance_lat: building?.entrance_lat || "",
    entrance_lng: building?.entrance_lng || "",
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (saving) return;

    setSaving(true);
    try {
      if (building) {
        await api.buildings.update(building.id, form);
        toast.success("Building updated");
      } else {
        await api.buildings.create(form);
        toast.success("Building created");
      }
      onSave();
    } catch (error) {
      toast.error(error.message || "Unable to save building");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title={building ? "Edit building" : "Create building"} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label">Building name</label>
          <input
            className="input"
            placeholder="Main Academic Block"
            value={form.name}
            onChange={(event) =>
              setForm((current) => ({ ...current, name: event.target.value }))
            }
            required
          />
        </div>

        <div>
          <label className="label">Address</label>
          <input
            className="input"
            placeholder="123 Campus Road"
            value={form.address}
            onChange={(event) =>
              setForm((current) => ({ ...current, address: event.target.value }))
            }
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Entrance latitude</label>
            <input
              className="input"
              type="number"
              step="any"
              placeholder="23.02887"
              value={form.entrance_lat}
              onChange={(event) =>
                setForm((current) => ({ ...current, entrance_lat: event.target.value }))
              }
            />
          </div>
          <div>
            <label className="label">Entrance longitude</label>
            <input
              className="input"
              type="number"
              step="any"
              placeholder="72.55078"
              value={form.entrance_lng}
              onChange={(event) =>
                setForm((current) => ({ ...current, entrance_lng: event.target.value }))
              }
            />
          </div>
        </div>

        <div>
          <label className="label">Description</label>
          <textarea
            className="input min-h-[130px] resize-y"
            placeholder="Brief context about the building, departments, or public use."
            value={form.description}
            onChange={(event) =>
              setForm((current) => ({ ...current, description: event.target.value }))
            }
          />
        </div>

        <div className="flex flex-col gap-3 pt-2 sm:flex-row">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="btn-primary flex-1">
            {saving ? "Saving..." : building ? "Save changes" : "Create building"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function FloorModal({ buildingId, floor, onClose, onSave }) {
  const [form, setForm] = useState({
    name: floor?.name || "",
    level: floor?.level ?? 0,
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (saving) return;

    setSaving(true);
    try {
      if (floor) {
        await api.floors.update(floor.id, form);
        toast.success("Floor updated");
      } else {
        await api.floors.create({ ...form, building_id: buildingId });
        toast.success("Floor created");
      }
      onSave();
    } catch (error) {
      toast.error(error.message || "Unable to save floor");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title={floor ? "Edit floor" : "Add floor"} onClose={onClose} width="max-w-lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label">Floor name</label>
          <input
            className="input"
            placeholder="Ground floor"
            value={form.name}
            onChange={(event) =>
              setForm((current) => ({ ...current, name: event.target.value }))
            }
            required
          />
        </div>

        <div>
          <label className="label">Level</label>
          <input
            className="input"
            type="number"
            value={form.level}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                level: Number.parseInt(event.target.value || "0", 10),
              }))
            }
          />
          <p className="mt-2 text-sm subtle-text">Use `0` for ground floor, `1` for first floor, and `-1` for basement.</p>
        </div>

        <div className="flex flex-col gap-3 pt-2 sm:flex-row">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="btn-primary flex-1">
            {saving ? "Saving..." : floor ? "Save floor" : "Create floor"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

export default function AdminBuildings() {
  const navigate = useNavigate();
  const [buildings, setBuildings] = useState([]);
  const [floorsByBuilding, setFloorsByBuilding] = useState({});
  const [expandedBuilding, setExpandedBuilding] = useState(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);

  const loadBuildings = async () => {
    setLoading(true);
    try {
      const data = await api.buildings.list();
      setBuildings(data || []);
    } catch (error) {
      console.error(error);
      toast.error("Unable to load buildings");
      setBuildings([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBuildings();
  }, []);

  const loadFloors = async (buildingId) => {
    const floors = await api.floors.byBuilding(buildingId).catch(() => []);
    setFloorsByBuilding((current) => ({ ...current, [buildingId]: floors }));
  };

  const toggleBuilding = async (buildingId) => {
    const next = expandedBuilding === buildingId ? null : buildingId;
    setExpandedBuilding(next);
    if (next && !floorsByBuilding[buildingId]) {
      await loadFloors(buildingId);
    }
  };

  const handleDeleteBuilding = async (buildingId) => {
    if (!window.confirm("Delete this building and its floors?")) return;
    try {
      await api.buildings.delete(buildingId);
      toast.success("Building deleted");
      loadBuildings();
    } catch (error) {
      toast.error(error.message || "Unable to delete building");
    }
  };

  const handleDeleteFloor = async (floorId, buildingId) => {
    if (!window.confirm("Delete this floor?")) return;
    try {
      await api.floors.delete(floorId);
      toast.success("Floor deleted");
      loadFloors(buildingId);
    } catch (error) {
      toast.error(error.message || "Unable to delete floor");
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <section className="card p-6 sm:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="badge mb-4">
                <Building2 className="h-3.5 w-3.5 text-brand-500" />
                Map operations
              </div>
              <h1 className="font-display text-3xl font-bold sm:text-4xl">Buildings and floor maps</h1>
              <p className="mt-3 max-w-3xl text-base leading-8 subtle-text">
                Keep the admin route focused on operations: building setup, floor creation, and map editing all live here while public navigation stays separate.
              </p>
            </div>

            <button
              onClick={() => setModal({ type: "building", data: null })}
              className="btn-primary"
            >
              <Plus className="h-4 w-4" />
              New building
            </button>
          </div>
        </section>

        {loading ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                key={index}
                className="h-36 animate-pulse rounded-[28px] border border-[var(--border)] bg-[var(--surface)]"
              />
            ))}
          </div>
        ) : buildings.length === 0 ? (
          <section className="card p-10 text-center">
            <Building2 className="mx-auto h-12 w-12 text-[var(--text-soft)]" />
            <h2 className="mt-5 font-display text-3xl font-bold">No buildings configured yet</h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-7 subtle-text">
              Create your first building, set the entrance coordinates, and add floors so you can start testing navigation end to end.
            </p>
            <button
              onClick={() => setModal({ type: "building", data: null })}
              className="btn-primary mt-6"
            >
              <Plus className="h-4 w-4" />
              Create first building
            </button>
          </section>
        ) : (
          <div className="space-y-4">
            {buildings.map((building) => {
              const floors = floorsByBuilding[building.id] || [];
              const isExpanded = expandedBuilding === building.id;

              return (
                <article key={building.id} className="card overflow-hidden p-0">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleBuilding(building.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        toggleBuilding(building.id);
                      }
                    }}
                    className="flex w-full flex-col gap-4 px-5 py-5 text-left sm:px-6"
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                      <div className="flex items-center gap-4">
                        <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-[22px] bg-brand-500/10 text-brand-500">
                          <Building2 className="h-6 w-6" />
                        </div>
                        <div className="min-w-0">
                          <div className="truncate font-display text-2xl font-bold">{building.name}</div>
                          <div className="mt-1 flex flex-wrap gap-3 text-sm subtle-text">
                            <span className="inline-flex items-center gap-1.5">
                              <MapPin className="h-4 w-4" />
                              {building.address || "No address set"}
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                              <Layers className="h-4 w-4" />
                              {floors.length || building.floors?.[0]?.count || 0} floors
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="ml-auto flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setModal({ type: "building", data: building });
                          }}
                          className="btn-secondary"
                        >
                          <Edit2 className="h-4 w-4" />
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleDeleteBuilding(building.id);
                          }}
                          className="btn-danger"
                        >
                          <Trash2 className="h-4 w-4" />
                          Delete
                        </button>
                        <div className="btn-ghost rounded-full border border-[var(--border)]">
                          <ChevronDown
                            className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-[var(--border)] px-5 pb-5 pt-4 sm:px-6">
                      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--text-soft)]">
                            Floors
                          </div>
                          <div className="mt-1 text-sm subtle-text">
                            Add levels and open the editor for map, doors, and route improvements.
                          </div>
                        </div>
                        <button
                          onClick={() =>
                            setModal({ type: "floor", data: null, buildingId: building.id })
                          }
                          className="btn-secondary"
                        >
                          <Plus className="h-4 w-4" />
                          Add floor
                        </button>
                      </div>

                      <div className="space-y-3">
                        {floors.length === 0 ? (
                          <div className="rounded-[22px] border border-dashed border-[var(--border-strong)] bg-[var(--surface-muted)] px-4 py-6 text-sm subtle-text">
                            No floors yet. Add one to start the indoor map editor.
                          </div>
                        ) : (
                          floors.map((floor) => (
                            <div
                              key={floor.id}
                              className="flex flex-col gap-4 rounded-[24px] border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-4 lg:flex-row lg:items-center"
                            >
                              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-500/10 text-brand-500">
                                <Layers className="h-5 w-5" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="font-semibold">{floor.name}</div>
                                <div className="mt-1 text-sm subtle-text">Level {floor.level}</div>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  onClick={() => setModal({ type: "floor", data: floor, buildingId: building.id })}
                                  className="btn-secondary"
                                >
                                  <Edit2 className="h-4 w-4" />
                                  Edit
                                </button>
                                <button
                                  onClick={() =>
                                    navigate(`/admin/buildings/${building.id}/floors/${floor.id}/editor`)
                                  }
                                  className="btn-primary"
                                >
                                  <Map className="h-4 w-4" />
                                  Open editor
                                </button>
                                <button
                                  onClick={() => handleDeleteFloor(floor.id, building.id)}
                                  className="btn-danger"
                                >
                                  <Trash2 className="h-4 w-4" />
                                  Delete
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>

      {modal?.type === "building" && (
        <BuildingModal
          building={modal.data}
          onClose={() => setModal(null)}
          onSave={() => {
            setModal(null);
            loadBuildings();
          }}
        />
      )}

      {modal?.type === "floor" && (
        <FloorModal
          buildingId={modal.buildingId}
          floor={modal.data}
          onClose={() => setModal(null)}
          onSave={() => {
            setModal(null);
            loadFloors(modal.buildingId);
          }}
        />
      )}
    </div>
  );
}
