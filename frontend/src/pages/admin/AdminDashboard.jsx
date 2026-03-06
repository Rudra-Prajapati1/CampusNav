import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Building2,
  Map,
  QrCode,
  ArrowRight,
  Plus,
  Layers,
  DoorOpen,
  Upload,
} from "lucide-react";
import { api } from "../../utils/api.js";
import { useAuthStore } from "../../stores/authStore.js";
import { useTheme } from "../../context/themeContext.jsx";

export default function AdminDashboard() {
  const { user } = useAuthStore();
  const { isDark } = useTheme();
  const [buildings, setBuildings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [totalFloors, setTotalFloors] = useState(0);
  const [totalRooms, setTotalRooms] = useState(0);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const buildingsData = await api.buildings.list();
      setBuildings(buildingsData || []);

      // Calculate total floors from buildings data
      let floorCount = 0;
      let roomCount = 0;

      // Load floor/room counts per building
      for (const b of buildingsData || []) {
        try {
          const floorsList = await api.floors.byBuilding(b.id);
          floorCount += floorsList?.length || 0;

          for (const fl of floorsList || []) {
            try {
              const floorDetail = await api.floors.get(fl.id);
              roomCount += floorDetail?.rooms?.length || 0;
            } catch {
              // ignore individual floor errors
            }
          }
        } catch {
          // Fallback to count from building data
          floorCount += b.floors?.[0]?.count || 0;
        }
      }

      setTotalFloors(floorCount);
      setTotalRooms(roomCount);
    } catch (err) {
      console.error("Dashboard load error:", err);
      setBuildings([]);
    } finally {
      setLoading(false);
    }
  };

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  };

  const stats = [
    {
      label: "Buildings",
      value: buildings.length,
      icon: Building2,
      color: "brand",
      bgClass: isDark ? "bg-brand-600/20" : "bg-brand-50",
      iconClass: "text-brand-400",
    },
    {
      label: "Total Floors",
      value: totalFloors,
      icon: Layers,
      color: "violet",
      bgClass: isDark ? "bg-violet-600/20" : "bg-violet-50",
      iconClass: "text-violet-400",
    },
    {
      label: "Total Rooms",
      value: totalRooms,
      icon: DoorOpen,
      color: "cyan",
      bgClass: isDark ? "bg-cyan-600/20" : "bg-cyan-50",
      iconClass: "text-cyan-400",
    },
    {
      label: "QR Codes",
      value: totalRooms > 0 ? totalRooms : "—",
      icon: QrCode,
      color: "emerald",
      bgClass: isDark ? "bg-emerald-600/20" : "bg-emerald-50",
      iconClass: "text-emerald-400",
    },
  ];

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1
            className={`font-display text-2xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}
          >
            {greeting()}, {user?.user_metadata?.given_name || "Admin"} 👋
          </h1>
          <p
            className={`text-sm mt-1 ${isDark ? "text-white/40" : "text-gray-500"}`}
          >
            Here's an overview of your CampusNav platform.
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {stats.map(({ label, value, icon: Icon, bgClass, iconClass }) => (
            <div
              key={label}
              className={`card ${isDark ? "" : "bg-white border-gray-200 shadow-sm"}`}
            >
              <div
                className={`w-9 h-9 ${bgClass} rounded-xl flex items-center justify-center mb-3`}
              >
                <Icon className={`w-4.5 h-4.5 ${iconClass}`} />
              </div>
              <div
                className={`font-display text-2xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}
              >
                {loading ? "—" : value}
              </div>
              <div
                className={`text-sm mt-0.5 ${isDark ? "text-white/40" : "text-gray-500"}`}
              >
                {label}
              </div>
            </div>
          ))}
        </div>

        {/* Quick Actions */}
        <div className="mb-8">
          <h2
            className={`font-display font-semibold mb-4 ${isDark ? "text-white" : "text-gray-900"}`}
          >
            Quick Actions
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Link
              to="/admin/buildings"
              className={`card flex items-center gap-3 hover:border-brand-500/30 transition-all group cursor-pointer ${
                isDark
                  ? ""
                  : "bg-white border-gray-200 shadow-sm hover:border-brand-300"
              }`}
            >
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center ${isDark ? "bg-brand-600/20" : "bg-brand-50"}`}
              >
                <Plus className="w-4 h-4 text-brand-400" />
              </div>
              <div>
                <div
                  className={`text-sm font-medium ${isDark ? "text-white" : "text-gray-900"}`}
                >
                  Create Building
                </div>
                <div
                  className={`text-xs ${isDark ? "text-white/30" : "text-gray-500"}`}
                >
                  Add a new building to your campus
                </div>
              </div>
            </Link>
            <Link
              to="/admin/buildings"
              className={`card flex items-center gap-3 hover:border-violet-500/30 transition-all group cursor-pointer ${
                isDark
                  ? ""
                  : "bg-white border-gray-200 shadow-sm hover:border-violet-300"
              }`}
            >
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center ${isDark ? "bg-violet-600/20" : "bg-violet-50"}`}
              >
                <Upload className="w-4 h-4 text-violet-400" />
              </div>
              <div>
                <div
                  className={`text-sm font-medium ${isDark ? "text-white" : "text-gray-900"}`}
                >
                  Upload Floor Plan
                </div>
                <div
                  className={`text-xs ${isDark ? "text-white/30" : "text-gray-500"}`}
                >
                  Add floor plan images
                </div>
              </div>
            </Link>
            <Link
              to="/admin/buildings"
              className={`card flex items-center gap-3 hover:border-cyan-500/30 transition-all group cursor-pointer ${
                isDark
                  ? ""
                  : "bg-white border-gray-200 shadow-sm hover:border-cyan-300"
              }`}
            >
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center ${isDark ? "bg-cyan-600/20" : "bg-cyan-50"}`}
              >
                <Map className="w-4 h-4 text-cyan-400" />
              </div>
              <div>
                <div
                  className={`text-sm font-medium ${isDark ? "text-white" : "text-gray-900"}`}
                >
                  Open Map Editor
                </div>
                <div
                  className={`text-xs ${isDark ? "text-white/30" : "text-gray-500"}`}
                >
                  Edit rooms and waypoints
                </div>
              </div>
            </Link>
          </div>
        </div>

        {/* Buildings list */}
        <div className="flex items-center justify-between mb-4">
          <h2
            className={`font-display font-semibold ${isDark ? "text-white" : "text-gray-900"}`}
          >
            Your Buildings
          </h2>
          <Link to="/admin/buildings" className="btn-primary text-sm py-2">
            <Plus className="w-3.5 h-3.5" />
            Add Building
          </Link>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className={`card h-16 animate-pulse ${isDark ? "bg-white/3" : "bg-gray-100"}`}
              />
            ))}
          </div>
        ) : buildings.length === 0 ? (
          <div
            className={`card text-center py-12 ${isDark ? "" : "bg-white border-gray-200"}`}
          >
            <Building2
              className={`w-10 h-10 mx-auto mb-3 ${isDark ? "text-white/20" : "text-gray-300"}`}
            />
            <p
              className={`text-sm ${isDark ? "text-white/40" : "text-gray-500"}`}
            >
              No buildings yet.
            </p>
            <Link
              to="/admin/buildings"
              className="btn-primary text-sm mt-4 mx-auto w-fit"
            >
              <Plus className="w-3.5 h-3.5" /> Create your first building
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {buildings.map((b) => (
              <Link
                key={b.id}
                to="/admin/buildings"
                className={`card flex items-center gap-4 transition-all duration-200 group ${
                  isDark
                    ? "hover:border-brand-500/20"
                    : "bg-white border-gray-200 shadow-sm hover:border-brand-300"
                }`}
              >
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    isDark ? "bg-brand-600/20" : "bg-brand-50"
                  }`}
                >
                  <Building2 className="w-5 h-5 text-brand-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div
                    className={`font-medium text-sm ${isDark ? "text-white" : "text-gray-900"}`}
                  >
                    {b.name}
                  </div>
                  <div
                    className={`text-xs mt-0.5 ${isDark ? "text-white/30" : "text-gray-500"}`}
                  >
                    {b.address || "No address set"}
                  </div>
                </div>
                <ArrowRight
                  className={`w-4 h-4 transition-colors ${
                    isDark
                      ? "text-white/20 group-hover:text-white/50"
                      : "text-gray-300 group-hover:text-gray-500"
                  }`}
                />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
