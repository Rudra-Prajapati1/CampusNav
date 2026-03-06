import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Plus, Layers, ChevronRight, Trash2, Edit2, X, Check, Map } from 'lucide-react';
import { api } from '../../utils/api.js';
import toast from 'react-hot-toast';

function BuildingModal({ building, onClose, onSave }) {
  const [form, setForm] = useState({
    name: building?.name || '',
    description: building?.description || '',
    address: building?.address || '',
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (building) {
        await api.buildings.update(building.id, form);
        toast.success('Building updated');
      } else {
        await api.buildings.create(form);
        toast.success('Building created');
      }
      onSave();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="card w-full max-w-md animate-in">
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-display font-semibold text-white">
            {building ? 'Edit Building' : 'New Building'}
          </h2>
          <button onClick={onClose} className="text-white/30 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Building Name *</label>
            <input className="input" placeholder="e.g. Main Academic Block"
              value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
          </div>
          <div>
            <label className="label">Address</label>
            <input className="input" placeholder="e.g. 123 Campus Road, Ahmedabad"
              value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
          </div>
          <div>
            <label className="label">Description</label>
            <textarea className="input resize-none" rows={3} placeholder="Brief description..."
              value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1 justify-center">Cancel</button>
            <button type="submit" className="btn-primary flex-1 justify-center">
              <Check className="w-4 h-4" />
              {building ? 'Save Changes' : 'Create Building'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function FloorModal({ buildingId, floor, onClose, onSave }) {
  const [form, setForm] = useState({
    name: floor?.name || '',
    level: floor?.level ?? 0,
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (floor) {
        await api.floors.update(floor.id, form);
        toast.success('Floor updated');
      } else {
        await api.floors.create({ ...form, building_id: buildingId });
        toast.success('Floor created');
      }
      onSave();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="card w-full max-w-sm animate-in">
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-display font-semibold text-white">
            {floor ? 'Edit Floor' : 'Add Floor'}
          </h2>
          <button onClick={onClose} className="text-white/30 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Floor Name *</label>
            <input className="input" placeholder="e.g. Ground Floor, Floor 1"
              value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
          </div>
          <div>
            <label className="label">Floor Level</label>
            <input className="input" type="number" placeholder="0 = Ground"
              value={form.level} onChange={e => setForm(f => ({ ...f, level: parseInt(e.target.value) }))} />
            <p className="text-white/30 text-xs mt-1">0 = Ground, 1 = First Floor, -1 = Basement</p>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1 justify-center">Cancel</button>
            <button type="submit" className="btn-primary flex-1 justify-center">
              <Check className="w-4 h-4" />
              {floor ? 'Save' : 'Add Floor'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function AdminBuildings() {
  const [buildings, setBuildings] = useState([]);
  const [floors, setFloors] = useState({});
  const [expandedBuilding, setExpandedBuilding] = useState(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // { type: 'building'|'floor', data: null|obj, buildingId }

  const loadBuildings = async () => {
    setLoading(true);
    const data = await api.buildings.list().catch(() => []);
    setBuildings(data);
    setLoading(false);
  };

  useEffect(() => { loadBuildings(); }, []);

  const loadFloors = async (buildingId) => {
    const data = await api.floors.byBuilding(buildingId).catch(() => []);
    setFloors(f => ({ ...f, [buildingId]: data }));
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
    if (!confirm('Delete this building and all its floors?')) return;
    await api.buildings.delete(id);
    toast.success('Building deleted');
    loadBuildings();
  };

  const deleteFloor = async (floorId, buildingId) => {
    if (!confirm('Delete this floor?')) return;
    await api.floors.delete(floorId);
    toast.success('Floor deleted');
    loadFloors(buildingId);
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-8 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="font-display text-2xl font-bold text-white">Buildings & Maps</h1>
            <p className="text-white/40 text-sm mt-1">Manage your buildings, floors and navigate to the map editor.</p>
          </div>
          <button onClick={() => setModal({ type: 'building', data: null })} className="btn-primary">
            <Plus className="w-4 h-4" /> New Building
          </button>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1,2].map(i => <div key={i} className="card h-16 animate-pulse bg-white/3" />)}
          </div>
        ) : buildings.length === 0 ? (
          <div className="card text-center py-16">
            <Building2 className="w-12 h-12 text-white/20 mx-auto mb-4" />
            <h3 className="font-display font-semibold text-white mb-2">No buildings yet</h3>
            <p className="text-white/40 text-sm mb-6">Create your first building to get started.</p>
            <button onClick={() => setModal({ type: 'building', data: null })} className="btn-primary mx-auto">
              <Plus className="w-4 h-4" /> Create Building
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {buildings.map(b => (
              <div key={b.id} className="card p-0 overflow-hidden">
                {/* Building row */}
                <div
                  className="flex items-center gap-4 p-4 cursor-pointer hover:bg-white/3 transition-colors"
                  onClick={() => toggleBuilding(b.id)}
                >
                  <div className="w-10 h-10 bg-brand-600/20 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Building2 className="w-5 h-5 text-brand-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-white text-sm">{b.name}</div>
                    <div className="text-white/30 text-xs mt-0.5">{b.address || 'No address'}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={e => { e.stopPropagation(); setModal({ type: 'building', data: b }); }}
                      className="p-2 text-white/30 hover:text-white hover:bg-white/10 rounded-lg transition-all">
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={e => { e.stopPropagation(); deleteBuilding(b.id); }}
                      className="p-2 text-white/30 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <ChevronRight className={`w-4 h-4 text-white/30 transition-transform ${expandedBuilding === b.id ? 'rotate-90' : ''}`} />
                  </div>
                </div>

                {/* Floors */}
                {expandedBuilding === b.id && (
                  <div className="border-t border-white/5 bg-white/2">
                    <div className="p-4 pb-2">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs text-white/40 font-medium uppercase tracking-wider">Floors</span>
                        <button
                          onClick={() => setModal({ type: 'floor', data: null, buildingId: b.id })}
                          className="text-xs text-brand-400 hover:text-brand-300 flex items-center gap-1 transition-colors"
                        >
                          <Plus className="w-3 h-3" /> Add Floor
                        </button>
                      </div>
                      <div className="space-y-2">
                        {(floors[b.id] || []).length === 0 ? (
                          <p className="text-white/25 text-sm py-2">No floors added yet.</p>
                        ) : (
                          (floors[b.id] || []).map(floor => (
                            <div key={floor.id} className="flex items-center gap-3 p-3 rounded-xl bg-white/3 hover:bg-white/5 transition-colors">
                              <div className="w-7 h-7 bg-violet-600/20 rounded-lg flex items-center justify-center flex-shrink-0">
                                <Layers className="w-3.5 h-3.5 text-violet-400" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium text-white">{floor.name}</div>
                                <div className="text-xs text-white/30">Level {floor.level}</div>
                              </div>
                              <Link
                                to={`/admin/buildings/${b.id}/floors/${floor.id}/editor`}
                                className="btn-primary text-xs py-1.5 px-3"
                                onClick={e => e.stopPropagation()}
                              >
                                <Map className="w-3 h-3" /> Edit Map
                              </Link>
                              <button onClick={() => deleteFloor(floor.id, b.id)}
                                className="p-1.5 text-white/20 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all">
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
      {modal?.type === 'building' && (
        <BuildingModal
          building={modal.data}
          onClose={() => setModal(null)}
          onSave={() => { setModal(null); loadBuildings(); }}
        />
      )}
      {modal?.type === 'floor' && (
        <FloorModal
          buildingId={modal.buildingId}
          floor={modal.data}
          onClose={() => setModal(null)}
          onSave={() => { setModal(null); loadFloors(modal.buildingId); }}
        />
      )}
    </div>
  );
}
