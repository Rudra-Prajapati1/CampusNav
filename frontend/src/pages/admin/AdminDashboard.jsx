import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Building2,
  DoorOpen,
  Layers,
  Map,
  Navigation,
  Plus,
  QrCode,
} from "lucide-react";
import { api } from "../../utils/api.js";
import { useAuthStore } from "../../stores/authStore.js";

const quickActions = [
  {
    title: "Create building",
    text: "Set up a new building shell, entrance coordinates, and first floor.",
    to: "/admin/buildings",
    icon: Plus,
  },
  {
    title: "Edit floor maps",
    text: "Open a floor editor and refine rooms, doors, waypoints, and routing flow.",
    to: "/admin/buildings",
    icon: Map,
  },
  {
    title: "Generate route entry points",
    text: "Prepare QR-based public access for real indoor navigation testing.",
    to: "/admin/buildings",
    icon: QrCode,
  },
];

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default function AdminDashboard() {
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [buildings, setBuildings] = useState([]);
  const [stats, setStats] = useState({
    floors: 0,
    rooms: 0,
    qrReady: 0,
  });

  useEffect(() => {
    let cancelled = false;

    async function loadDashboard() {
      setLoading(true);
      try {
        const buildingList = await api.buildings.list();
        if (cancelled) return;

        setBuildings(buildingList || []);

        const floorsByBuilding = await Promise.all(
          (buildingList || []).map(async (building) => {
            const floors = await api.floors.byBuilding(building.id).catch(() => []);
            const details = await Promise.all(
              floors.map((floor) => api.floors.get(floor.id).catch(() => null)),
            );

            return {
              building,
              floors,
              details: details.filter(Boolean),
            };
          }),
        );

        if (cancelled) return;

        const totalFloors = floorsByBuilding.reduce(
          (sum, entry) => sum + entry.floors.length,
          0,
        );
        const totalRooms = floorsByBuilding.reduce(
          (sum, entry) =>
            sum + entry.details.reduce((floorSum, floor) => floorSum + (floor.rooms?.length || 0), 0),
          0,
        );

        setStats({
          floors: totalFloors,
          rooms: totalRooms,
          qrReady: totalRooms,
        });
      } catch (error) {
        console.error("Failed to load dashboard", error);
        if (!cancelled) {
          setBuildings([]);
          setStats({ floors: 0, rooms: 0, qrReady: 0 });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadDashboard();
    return () => {
      cancelled = true;
    };
  }, []);

  const statCards = [
    { label: "Buildings", value: buildings.length, icon: Building2 },
    { label: "Floors", value: stats.floors, icon: Layers },
    { label: "Mapped rooms", value: stats.rooms, icon: DoorOpen },
    { label: "QR-ready points", value: stats.qrReady, icon: QrCode },
  ];

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <section className="card overflow-hidden p-6 sm:p-8">
          <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
            <div>
              <div className="badge mb-4">
                <Navigation className="h-3.5 w-3.5 text-brand-500" />
                Admin overview
              </div>
              <h1 className="font-display text-3xl font-bold sm:text-4xl">
                {getGreeting()}, {user?.user_metadata?.given_name || "Admin"}.
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-8 subtle-text">
                This workspace is now separated under the protected `/admin` route so public navigation stays focused while your operational tools stay secure.
              </p>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Link to="/admin/buildings" className="btn-primary">
                  Manage buildings
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link to="/" className="btn-secondary">
                  View landing page
                </Link>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {statCards.map(({ label, value, icon: Icon }) => (
                <div key={label} className="metric-card">
                  <div className="flex items-center justify-between">
                    <div className="metric-label">{label}</div>
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-500/10 text-brand-500">
                      <Icon className="h-4.5 w-4.5" />
                    </div>
                  </div>
                  <div className="mt-4 font-display text-4xl font-bold">
                    {loading ? "..." : value}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="card p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-2xl font-bold">Quick actions</h2>
                <p className="mt-1 text-sm subtle-text">Keep map operations moving without digging through screens.</p>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {quickActions.map(({ title, text, to, icon: Icon }) => (
                <Link
                  key={title}
                  to={to}
                  className="flex rounded-[24px] border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-4 transition-all hover:border-brand-300/30 hover:bg-[var(--surface-strong)]"
                >
                  <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-brand-500/10 text-brand-500">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="ml-4">
                    <div className="font-semibold">{title}</div>
                    <div className="mt-1 text-sm leading-7 subtle-text">{text}</div>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          <div className="card p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-2xl font-bold">Recent buildings</h2>
                <p className="mt-1 text-sm subtle-text">Use these entries to jump back into active map maintenance.</p>
              </div>
              <Link to="/admin/buildings" className="btn-secondary">
                Open all
              </Link>
            </div>

            <div className="mt-5 space-y-3">
              {loading ? (
                Array.from({ length: 3 }).map((_, index) => (
                  <div
                    key={index}
                    className="h-24 animate-pulse rounded-[24px] border border-[var(--border)] bg-[var(--surface-muted)]"
                  />
                ))
              ) : buildings.length === 0 ? (
                <div className="rounded-[24px] border border-dashed border-[var(--border-strong)] bg-[var(--surface-muted)] px-5 py-10 text-center">
                  <Building2 className="mx-auto h-10 w-10 text-[var(--text-soft)]" />
                  <div className="mt-4 font-display text-2xl font-bold">No buildings yet</div>
                  <p className="mt-2 text-sm leading-7 subtle-text">
                    Add your first building to start testing navigation, QR flows, and indoor map editing.
                  </p>
                  <Link to="/admin/buildings" className="btn-primary mt-5">
                    <Plus className="h-4 w-4" />
                    Create building
                  </Link>
                </div>
              ) : (
                buildings.slice(0, 5).map((building) => (
                  <Link
                    key={building.id}
                    to="/admin/buildings"
                    className="flex rounded-[24px] border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-4 transition-all hover:border-brand-300/30 hover:bg-[var(--surface-strong)]"
                  >
                    <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-brand-500/10 text-brand-500">
                      <Building2 className="h-5 w-5" />
                    </div>
                    <div className="ml-4 min-w-0 flex-1">
                      <div className="truncate font-semibold">{building.name}</div>
                      <div className="mt-1 truncate text-sm subtle-text">
                        {building.address || "No address configured yet"}
                      </div>
                    </div>
                    <ArrowRight className="h-4 w-4 flex-shrink-0 self-center text-[var(--text-soft)]" />
                  </Link>
                ))
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
