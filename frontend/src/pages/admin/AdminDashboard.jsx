import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Map, QrCode, ArrowRight, Plus } from 'lucide-react';
import { api } from '../../utils/api.js';
import { useAuthStore } from '../../stores/authStore.js';

export default function AdminDashboard() {
  const { user } = useAuthStore();
  const [buildings, setBuildings] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.buildings.list()
      .then(setBuildings)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const stats = [
    { label: 'Buildings', value: buildings.length, icon: Building2, color: 'brand' },
    { label: 'Total Floors', value: buildings.reduce((a, b) => a + (b.floors?.[0]?.count || 0), 0), icon: Map, color: 'violet' },
    { label: 'QR Codes', value: '—', icon: QrCode, color: 'emerald' },
  ];

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="font-display text-2xl font-bold text-white">
            {greeting()}, {user?.user_metadata?.given_name || 'Admin'} 👋
          </h1>
          <p className="text-white/40 text-sm mt-1">Here's an overview of your CampusNav platform.</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          {stats.map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="card">
              <div className={`w-9 h-9 bg-${color}-600/20 rounded-xl flex items-center justify-center mb-3`}>
                <Icon className={`w-4.5 h-4.5 text-${color}-400`} />
              </div>
              <div className="font-display text-2xl font-bold text-white">{loading ? '—' : value}</div>
              <div className="text-white/40 text-sm mt-0.5">{label}</div>
            </div>
          ))}
        </div>

        {/* Buildings list */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display font-semibold text-white">Your Buildings</h2>
          <Link to="/admin/buildings" className="btn-primary text-sm py-2">
            <Plus className="w-3.5 h-3.5" />
            Add Building
          </Link>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1,2,3].map(i => (
              <div key={i} className="card h-16 animate-pulse bg-white/3" />
            ))}
          </div>
        ) : buildings.length === 0 ? (
          <div className="card text-center py-12">
            <Building2 className="w-10 h-10 text-white/20 mx-auto mb-3" />
            <p className="text-white/40 text-sm">No buildings yet.</p>
            <Link to="/admin/buildings" className="btn-primary text-sm mt-4 mx-auto w-fit">
              <Plus className="w-3.5 h-3.5" /> Create your first building
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {buildings.map(b => (
              <Link key={b.id} to="/admin/buildings"
                className="card flex items-center gap-4 hover:border-brand-500/20 transition-all duration-200 group">
                <div className="w-10 h-10 bg-brand-600/20 rounded-xl flex items-center justify-center flex-shrink-0">
                  <Building2 className="w-5 h-5 text-brand-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-white text-sm">{b.name}</div>
                  <div className="text-white/30 text-xs mt-0.5">{b.address || 'No address set'}</div>
                </div>
                <ArrowRight className="w-4 h-4 text-white/20 group-hover:text-white/50 transition-colors" />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
