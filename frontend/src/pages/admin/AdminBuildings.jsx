import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import {
  Building2,
  Plus,
  Layers,
  ChevronRight,
  Trash2,
  Edit2,
  X,
  Check,
  Map,
} from "lucide-react";
import { api } from "../../utils/api.js";
import { useTheme } from "../../context/themeContext.jsx";
import toast from "react-hot-toast";

function BuildingModal({ building, onClose, onSave, isDark }) {
  const [form, setForm] = useState({
    name: building?.name || "",
    description: building?.description || "",
    address: building?.address || "",
    entrance_lat: building?.entrance_lat || "",
    entrance_lng: building?.entrance_lng || "",
  });
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSaving) return;

    setIsSaving(true);
    try {
      if (building) {
        await api.buildings.update(building.id, form);
        toast.success("Building updated");
      } else {
        await api.buildings.create(form);
        toast.success("Building created");
      }
      onSave();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div
        className={`w-full max-w-md animate-in rounded-2xl border p-6 ${
          isDark ? "card" : "bg-white border-slate-200 shadow-xl"
        }`}
      >
        <div className="flex items-center justify-between mb-6">
          <h2
            className={`font-display font-semibold ${isDark ? "text-white" : "text-slate-900"}`}
          >
            {building ? "Edit Building" : "New Building"}
          </h2>
          <button
            onClick={onClose}
            disabled={isSaving}
            className={`transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              isDark
                ? "text-white/30 hover:text-white"
                : "text-slate-400 hover:text-slate-700"
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={`label ${!isDark ? "text-slate-700" : ""}`}>
              Building Name *
            </label>
            <input
              className={`input ${!isDark ? "bg-white border-slate-300 text-slate-900 placeholder-slate-400" : ""}`}
              placeholder="e.g. Main Academic Block"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              disabled={isSaving}
              required
            />
          </div>
          <div>
            <label className={`label ${!isDark ? "text-slate-700" : ""}`}>
              Address
            </label>
            <input
              className={`input ${!isDark ? "bg-white border-slate-300 text-slate-900 placeholder-slate-400" : ""}`}
              placeholder="e.g. 123 Campus Road, Ahmedabad"
              value={form.address}
              onChange={(e) =>
                setForm((f) => ({ ...f, address: e.target.value }))
              }
              disabled={isSaving}
            />
          </div>
          <div>
            <label className={`label ${!isDark ? "text-slate-700" : ""}`}>
              Building Entrance GPS Coordinates
            </label>
            <div className="flex gap-2">
              <input
                className={`input ${!isDark ? "bg-white border-slate-300 text-slate-900 placeholder-slate-400" : ""}`}
                placeholder="Latitude"
                type="number"
                step="any"
                value={form.entrance_lat}
                onChange={(e) =>
                  setForm((f) => ({ ...f, entrance_lat: e.target.value }))
                }
                disabled={isSaving}
              />
              <input
                className={`input ${!isDark ? "bg-white border-slate-300 text-slate-900 placeholder-slate-400" : ""}`}
                placeholder="Longitude"
                type="number"
                step="any"
                value={form.entrance_lng}
                onChange={(e) =>
                  setForm((f) => ({ ...f, entrance_lng: e.target.value }))
                }
                disabled={isSaving}
              />
            </div>
            <p
              className={`text-xs mt-1 ${isDark ? "text-white/30" : "text-slate-400"}`}
            >
              Open Google Maps, right-click the building entrance, copy the
              coordinates. Example for Shree PG Ahmedabad: 23.02887, 72.55078
            </p>
          </div>
          <div>
            <label className={`label ${!isDark ? "text-slate-700" : ""}`}>
              Description
            </label>
            <textarea
              className={`input resize-none ${!isDark ? "bg-white border-slate-300 text-slate-900 placeholder-slate-400" : ""}`}
              rows={3}
              placeholder="Brief description..."
              value={form.description}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
              disabled={isSaving}
            />
          </div>
          {isSaving && (
            <p
              className={`text-xs ${isDark ? "text-brand-300" : "text-brand-600"}`}
            >
              Saving building changes...
            </p>
          )}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="btn-secondary flex-1 justify-center"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="btn-primary flex-1 justify-center disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isSaving ? (
                <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              {isSaving
                ? building
                  ? "Saving..."
                  : "Creating..."
                : building
                  ? "Save Changes"
                  : "Create Building"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function FloorModal({ buildingId, floor, onClose, onSave, isDark }) {
  const [form, setForm] = useState({
    name: floor?.name || "",
    level: floor?.level ?? 0,
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (floor) {
        await api.floors.update(floor.id, form);
        toast.success("Floor updated");
      } else {
        await api.floors.create({ ...form, building_id: buildingId });
        toast.success("Floor created");
      }
      onSave();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div
        className={`w-full max-w-sm animate-in rounded-2xl border p-6 ${
          isDark ? "card" : "bg-white border-slate-200 shadow-xl"
        }`}
      >
        <div className="flex items-center justify-between mb-6">
          <h2
            className={`font-display font-semibold ${isDark ? "text-white" : "text-slate-900"}`}
          >
            {floor ? "Edit Floor" : "Add Floor"}
          </h2>
          <button
            onClick={onClose}
            className={`transition-colors ${isDark ? "text-white/30 hover:text-white" : "text-slate-400 hover:text-slate-700"}`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={`label ${!isDark ? "text-slate-700" : ""}`}>
              Floor Name *
            </label>
            <input
              className={`input ${!isDark ? "bg-white border-slate-300 text-slate-900 placeholder-slate-400" : ""}`}
              placeholder="e.g. Ground Floor, Floor 1"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
          </div>
          <div>
            <label className={`label ${!isDark ? "text-slate-700" : ""}`}>
              Floor Level
            </label>
            <input
              className={`input ${!isDark ? "bg-white border-slate-300 text-slate-900 placeholder-slate-400" : ""}`}
              type="number"
              placeholder="0 = Ground"
              value={form.level}
              onChange={(e) =>
                setForm((f) => ({ ...f, level: parseInt(e.target.value) }))
              }
            />
            <p
              className={`text-xs mt-1 ${isDark ? "text-white/30" : "text-slate-400"}`}
            >
              0 = Ground, 1 = First Floor, -1 = Basement
            </p>
          </div>
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary flex-1 justify-center"
            >
              Cancel
            </button>
            <button type="submit" className="btn-primary flex-1 justify-center">
              <Check className="w-4 h-4" />
              {floor ? "Save" : "Add Floor"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function AdminBuildings() {
  const { isDark } = useTheme();
  const [buildings, setBuildings] = useState([]);
  const [floors, setFloors] = useState({});
  const [expandedBuilding, setExpandedBuilding] = useState(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);

  const navigate = useNavigate();

  const loadBuildings = async () => {
    setLoading(true);
    const data = await api.buildings.list().catch(() => []);
    setBuildings(data);
    setLoading(false);
  };

  useEffect(() => {
    loadBuildings();
  }, []);

  const loadFloors = async (buildingId) => {
    const data = await api.floors.byBuilding(buildingId).catch(() => []);
    setFloors((f) => ({ ...f, [buildingId]: data }));
  };

  const toggleBuilding = async (buildingId) => {
    if (expandedBuilding === buildingId) {
      setExpandedBuilding(null);
    } else {
      setExpandedBuilding(buildingId);
      if (!floors[buildingId]) await loadFloors(buildingId);
    }
  };

  const deleteBuilding = async (id) => {
    if (!confirm("Delete this building and all its floors?")) return;
    await api.buildings.delete(id);
    toast.success("Building deleted");
    loadBuildings();
  };

  const deleteFloor = async (floorId, buildingId) => {
    if (!confirm("Delete this floor?")) return;
    await api.floors.delete(floorId);
    toast.success("Floor deleted");
    loadFloors(buildingId);
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-8 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1
              className={`font-display text-2xl font-bold ${isDark ? "text-white" : "text-slate-900"}`}
            >
              Buildings & Maps
            </h1>
            <p
              className={`text-sm mt-1 ${isDark ? "text-white/40" : "text-slate-500"}`}
            >
              Manage your buildings, floors and navigate to the map editor.
            </p>
          </div>
          <button
            onClick={() => setModal({ type: "building", data: null })}
            className="btn-primary"
          >
            <Plus className="w-4 h-4" /> New Building
          </button>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div
                key={i}
                className={`h-16 rounded-2xl animate-pulse ${isDark ? "bg-white/3" : "bg-slate-200"}`}
              />
            ))}
          </div>
        ) : buildings.length === 0 ? (
          <div
            className={`rounded-2xl border p-16 text-center ${isDark ? "card" : "bg-white border-slate-200 shadow-sm"}`}
          >
            <Building2
              className={`w-12 h-12 mx-auto mb-4 ${isDark ? "text-white/20" : "text-slate-300"}`}
            />
            <h3
              className={`font-display font-semibold mb-2 ${isDark ? "text-white" : "text-slate-900"}`}
            >
              No buildings yet
            </h3>
            <p
              className={`text-sm mb-6 ${isDark ? "text-white/40" : "text-slate-500"}`}
            >
              Create your first building to get started.
            </p>
            <button
              onClick={() => setModal({ type: "building", data: null })}
              className="btn-primary mx-auto"
            >
              <Plus className="w-4 h-4" /> Create Building
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {buildings.map((b) => (
              <div
                key={b.id}
                className={`rounded-2xl border overflow-hidden transition-colors ${
                  isDark
                    ? "card p-0"
                    : "bg-white border-slate-200 shadow-sm p-0"
                }`}
              >
                {/* Building row */}
                <div
                  className={`flex items-center gap-4 p-4 cursor-pointer transition-colors ${
                    isDark ? "hover:bg-white/3" : "hover:bg-slate-50"
                  }`}
                  onClick={() => toggleBuilding(b.id)}
                >
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                      isDark ? "bg-brand-600/20" : "bg-brand-50"
                    }`}
                  >
                    <Building2
                      className={`w-5 h-5 ${isDark ? "text-brand-400" : "text-brand-600"}`}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div
                      className={`font-medium text-sm ${isDark ? "text-white" : "text-slate-900"}`}
                    >
                      {b.name}
                    </div>
                    <div
                      className={`text-xs mt-0.5 ${isDark ? "text-white/30" : "text-slate-400"}`}
                    >
                      {b.address || "No address"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setModal({ type: "building", data: b });
                      }}
                      className={`p-2 rounded-lg transition-all ${isDark ? "text-white/30 hover:text-white hover:bg-white/10" : "text-slate-400 hover:text-slate-700 hover:bg-slate-100"}`}
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteBuilding(b.id);
                      }}
                      className={`p-2 rounded-lg transition-all ${isDark ? "text-white/30 hover:text-red-400 hover:bg-red-500/10" : "text-slate-400 hover:text-red-500 hover:bg-red-50"}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <ChevronRight
                      className={`w-4 h-4 transition-transform ${isDark ? "text-white/30" : "text-slate-400"} ${expandedBuilding === b.id ? "rotate-90" : ""}`}
                    />
                  </div>
                </div>

                {/* Floors */}
                {expandedBuilding === b.id && (
                  <div
                    className={`border-t ${isDark ? "border-white/5 bg-white/2" : "border-slate-100 bg-slate-50"}`}
                  >
                    <div className="p-4 pb-2">
                      <div className="flex items-center justify-between mb-3">
                        <span
                          className={`text-xs font-medium uppercase tracking-wider ${isDark ? "text-white/40" : "text-slate-400"}`}
                        >
                          Floors
                        </span>
                        <button
                          onClick={() =>
                            setModal({
                              type: "floor",
                              data: null,
                              buildingId: b.id,
                            })
                          }
                          className={`text-xs flex items-center gap-1 transition-colors ${isDark ? "text-brand-400 hover:text-brand-300" : "text-brand-600 hover:text-brand-500"}`}
                        >
                          <Plus className="w-3 h-3" /> Add Floor
                        </button>
                      </div>
                      <div className="space-y-2">
                        {(floors[b.id] || []).length === 0 ? (
                          <p
                            className={`text-sm py-2 ${isDark ? "text-white/25" : "text-slate-400"}`}
                          >
                            No floors added yet.
                          </p>
                        ) : (
                          (floors[b.id] || []).map((floor) => (
                            <div
                              key={floor.id}
                              className={`flex items-center gap-3 p-3 rounded-xl transition-colors ${
                                isDark
                                  ? "bg-white/3 hover:bg-white/5"
                                  : "bg-white hover:bg-slate-50 border border-slate-200"
                              }`}
                            >
                              <div
                                className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                                  isDark ? "bg-violet-600/20" : "bg-violet-50"
                                }`}
                              >
                                <Layers
                                  className={`w-3.5 h-3.5 ${isDark ? "text-violet-400" : "text-violet-600"}`}
                                />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div
                                  className={`text-sm font-medium ${isDark ? "text-white" : "text-slate-900"}`}
                                >
                                  {floor.name}
                                </div>
                                <div
                                  className={`text-xs ${isDark ? "text-white/30" : "text-slate-400"}`}
                                >
                                  Level {floor.level}
                                </div>
                              </div>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate(
                                    `/admin/buildings/${b.id}/floors/${floor.id}/editor`,
                                  );
                                }}
                                className="btn-primary text-xs py-1.5 px-3"
                              >
                                <Map className="w-3 h-3" /> Edit Map
                              </button>
                              <button
                                onClick={() => deleteFloor(floor.id, b.id)}
                                className={`p-1.5 rounded-lg transition-all ${isDark ? "text-white/20 hover:text-red-400 hover:bg-red-500/10" : "text-slate-400 hover:text-red-500 hover:bg-red-50"}`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                    <div className="p-4 pt-2" />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      {modal?.type === "building" && (
        <BuildingModal
          building={modal.data}
          isDark={isDark}
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
          isDark={isDark}
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
