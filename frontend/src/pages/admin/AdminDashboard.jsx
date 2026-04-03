// CampusNav redesign — AdminDashboard.jsx — updated
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Building2,
  Compass,
  DoorOpen,
  GitBranch,
  Layers,
  Pencil,
  Plus,
} from "lucide-react";
import { getIndustry } from "../../config/poiTypes.js";
import { api } from "../../utils/api.js";
import { useAuthStore } from "../../stores/authStore.js";

function formatDate(dateValue) {
  if (!dateValue) return "Not available";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(dateValue));
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function industryBadgeStyle(industryId) {
  const palette = {
    education: {
      color: "#1D4ED8",
      background: "rgba(37, 99, 235, 0.12)",
      borderColor: "rgba(37, 99, 235, 0.2)",
    },
    healthcare: {
      color: "#15803D",
      background: "rgba(22, 163, 74, 0.12)",
      borderColor: "rgba(22, 163, 74, 0.2)",
    },
    corporate: {
      color: "#7C3AED",
      background: "rgba(124, 58, 237, 0.12)",
      borderColor: "rgba(124, 58, 237, 0.2)",
    },
    mall: {
      color: "#C2410C",
      background: "rgba(217, 119, 6, 0.12)",
      borderColor: "rgba(217, 119, 6, 0.2)",
    },
    events: {
      color: "#DB2777",
      background: "rgba(236, 72, 153, 0.12)",
      borderColor: "rgba(236, 72, 153, 0.2)",
    },
    hospitality: {
      color: "#0F766E",
      background: "rgba(13, 148, 136, 0.12)",
      borderColor: "rgba(13, 148, 136, 0.2)",
    },
  };

  return (
    palette[industryId] || {
      color: "var(--color-text-secondary)",
      background: "var(--color-surface-alt)",
      borderColor: "var(--color-border)",
    }
  );
}

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [buildings, setBuildings] = useState([]);
  const [buildingSummaries, setBuildingSummaries] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function loadDashboard() {
      setLoading(true);
      try {
        const buildingList = await api.buildings.list();
        if (cancelled) return;

        const summaries = await Promise.all(
          (buildingList || []).map(async (building) => {
            const floors = await api.floors.byBuilding(building.id).catch(() => []);
            const floorDetails = await Promise.all(
              floors.map((floor) => api.floors.get(floor.id).catch(() => null)),
            );

            const validDetails = floorDetails.filter(Boolean);
            const mappedRooms = validDetails.reduce(
              (total, floor) => total + (floor.rooms?.length || 0),
              0,
            );
            const paths = validDetails.reduce(
              (total, floor) => total + (floor.connections?.length || 0),
              0,
            );

            return {
              ...building,
              floors,
              mappedRooms,
              paths,
              status: mappedRooms > 0 ? "active" : "inactive",
            };
          }),
        );

        if (cancelled) return;

        setBuildings(buildingList || []);
        setBuildingSummaries(summaries);
      } catch (error) {
        console.error("Failed to load dashboard", error);
        if (!cancelled) {
          setBuildings([]);
          setBuildingSummaries([]);
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

  const stats = useMemo(() => {
    return {
      buildings: buildingSummaries.length,
      floors: buildingSummaries.reduce((sum, building) => sum + building.floors.length, 0),
      mappedRooms: buildingSummaries.reduce(
        (sum, building) => sum + building.mappedRooms,
        0,
      ),
      paths: buildingSummaries.reduce((sum, building) => sum + building.paths, 0),
      unmappedFloors: buildingSummaries.reduce((sum, building) => {
        return (
          sum +
          building.floors.filter((floor) => {
            const detail = buildingSummaries
              .find((entry) => entry.id === building.id)
              ?.floors.find((entry) => entry.id === floor.id);
            return !detail;
          }).length
        );
      }, 0),
    };
  }, [buildingSummaries]);

  const floorsWithoutRooms = useMemo(() => {
    return buildingSummaries.reduce((sum, building) => {
      const totalFloors = building.floors.length;
      if (totalFloors === 0) return sum;
      if (building.mappedRooms === 0) return sum + totalFloors;
      return sum;
    }, 0);
  }, [buildingSummaries]);

  const editorOptions = useMemo(() => {
    return buildingSummaries.flatMap((building) =>
      building.floors.map((floor) => ({
        value: `${building.id}:${floor.id}`,
        label: `${building.name} — ${floor.name}`,
      })),
    );
  }, [buildingSummaries]);

  const handleEditorSelect = (event) => {
    if (!event.target.value) return;
    const [buildingId, floorId] = event.target.value.split(":");
    navigate(`/admin/buildings/${buildingId}/floors/${floorId}/editor`);
  };

  return (
    <div className="mx-auto flex max-w-page flex-col gap-6">
      <section className="page-header">
        <span className="section-label">Dashboard</span>
        <h1>
          {getGreeting()}
          {user?.user_metadata?.given_name ? `, ${user.user_metadata.given_name}` : ""}.
        </h1>
        <p>
          Review building coverage, mapping progress, and quick editor access from
          one operational dashboard.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Total Buildings", value: stats.buildings, icon: Building2 },
          { label: "Total Floors", value: stats.floors, icon: Layers },
          { label: "Mapped Rooms / POIs", value: stats.mappedRooms, icon: DoorOpen },
          { label: "Navigation Paths", value: stats.paths, icon: GitBranch },
        ].map(({ label, value, icon: Icon }) => (
          <article key={label} className="stat-card">
            <div className="flex items-center justify-between gap-3">
              <span className="stat-label">{label}</span>
              <span className="icon-chip h-10 w-10">
                <Icon className="h-4 w-4" />
              </span>
            </div>
            <div className="stat-value">{loading ? "..." : value}</div>
          </article>
        ))}
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="card">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="section-label">Quick Actions</div>
              <h2 className="mt-3 text-2xl font-bold tracking-[-0.02em]">
                Keep mapping work moving
              </h2>
            </div>
          </div>
          <div className="mt-6 grid gap-3">
            <Link to="/admin/buildings" className="btn-primary justify-start">
              <Plus className="h-4 w-4" />
              Add Building
            </Link>
            <Link to="/admin/buildings" className="btn-secondary justify-start">
              <Building2 className="h-4 w-4" />
              View All Buildings
            </Link>
            <div>
              <label className="field-label">Open Map Editor</label>
              <select
                className="select"
                defaultValue=""
                onChange={handleEditorSelect}
                disabled={editorOptions.length === 0}
              >
                <option value="">Select a floor</option>
                {editorOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="section-label">System Health</div>
          <h2 className="mt-3 text-2xl font-bold tracking-[-0.02em]">
            Mapping coverage overview
          </h2>
          <p className="mt-3 text-sm subtle-text">
            {floorsWithoutRooms > 0
              ? `${floorsWithoutRooms} floor${floorsWithoutRooms === 1 ? "" : "s"} still need room mapping.`
              : "All current floors have at least one mapped room or point of interest."}
          </p>
          <div className="mt-5 rounded-xl border border-default bg-surface-alt p-4">
            <div className="flex items-center gap-3">
              <span className="icon-chip">
                <Compass className="h-4 w-4" />
              </span>
              <div>
                <div className="text-sm font-semibold text-primary">Suggested next step</div>
                <div className="text-sm subtle-text">
                  Review newly created buildings and publish editor-ready floor
                  plans for teams that have not started mapping yet.
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="card overflow-hidden p-0">
        <div className="flex items-center justify-between gap-4 px-5 py-4">
          <h2 className="text-lg font-semibold text-primary">Recent Buildings</h2>
          <Link to="/admin/buildings" className="btn-ghost px-0 text-sm">
            View All
          </Link>
        </div>

        <div className="hidden items-center gap-4 border-y border-default bg-surface-alt px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted sm:flex">
          <div className="flex-1">Building Name</div>
          <div className="w-[120px]">Industry</div>
          <div className="w-20 text-right">Floors</div>
          <div className="w-32 text-right">Last Updated</div>
          <div className="w-8 text-right">Edit</div>
        </div>

        {loading ? (
          <div className="space-y-3 px-5 py-5">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-16 animate-pulse rounded-lg bg-surface-alt" />
            ))}
          </div>
        ) : buildingSummaries.length === 0 ? (
          <div className="px-5 py-12">
            <div className="flex flex-col items-center justify-center gap-4 text-center">
              <div className="icon-chip h-12 w-12">
                <Building2 className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-primary">No buildings yet</h3>
                <p className="mt-1 text-sm subtle-text">
                  Add your first building to start managing floors and map data.
                </p>
              </div>
              <Link to="/admin/buildings" className="btn-primary">
                <Plus className="h-4 w-4" />
                Add Building
              </Link>
            </div>
          </div>
        ) : (
          buildingSummaries.slice(0, 6).map((building, index, rows) => {
            const industry = getIndustry(building.industry || "education");

            return (
              <div
                key={building.id}
                className={`flex flex-col gap-3 px-5 py-4 transition-colors hover:bg-surface-alt sm:flex-row sm:items-center sm:gap-4 ${
                  index === rows.length - 1 ? "" : "border-b border-default"
                }`}
              >
                <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-primary">{building.name}</div>
                    <div className="mt-1 text-sm subtle-text sm:hidden">
                      {building.floors.length} floor{building.floors.length === 1 ? "" : "s"}
                    </div>
                  </div>
                  <span
                    className="badge shrink-0"
                    style={industryBadgeStyle(industry.id)}
                  >
                    {industry.label}
                  </span>
                </div>

                <div className="hidden w-20 text-right text-sm text-muted sm:block">
                  {building.floors.length}
                </div>

                <div className="hidden w-32 text-right text-sm text-muted md:block">
                  {formatDate(building.updated_at)}
                </div>

                <div className="flex w-8 shrink-0 justify-end">
                  <Link
                    to={`/admin/buildings?edit=${building.id}`}
                    className="btn-ghost h-8 w-8 px-0"
                    aria-label={`Edit ${building.name}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </Link>
                </div>
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}
