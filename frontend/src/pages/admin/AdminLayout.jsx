import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Building2,
  Compass,
  LayoutDashboard,
  LogOut,
  Moon,
  Settings2,
  Sun,
} from "lucide-react";
import toast from "react-hot-toast";
import { useAuthStore } from "../../stores/authStore.js";
import { useTheme } from "../../context/themeContext.jsx";

const navItems = [
  {
    to: "/admin",
    icon: LayoutDashboard,
    label: "Overview",
    description: "Platform status and quick actions",
    end: true,
  },
  {
    to: "/admin/buildings",
    icon: Building2,
    label: "Buildings",
    description: "Manage campuses, floors, and maps",
  },
];

export default function AdminLayout() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuthStore();
  const { isDark, toggleTheme } = useTheme();

  const currentSection =
    navItems.find((item) =>
      item.end ? pathname === item.to : pathname.startsWith(item.to),
    ) || navItems[0];

  const handleSignOut = async () => {
    await signOut();
    toast.success("Signed out");
    navigate("/admin/login");
  };

  return (
    <div className="page-shell page-grid min-h-screen p-3 sm:p-4">
      <div className="mx-auto flex min-h-[calc(100dvh-1.5rem)] w-full max-w-7xl gap-4 lg:min-h-[calc(100dvh-2rem)]">
        <aside className="glass hidden w-[300px] flex-col rounded-[32px] p-4 lg:flex">
          <div className="flex items-center gap-3 rounded-[26px] border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 via-sky-500 to-cyan-400 text-white">
              <Compass className="h-5 w-5" />
            </div>
            <div>
              <div className="font-display text-lg font-bold">CampusNav</div>
              <div className="text-sm subtle-text">Protected admin workspace</div>
            </div>
          </div>

          <div className="mt-6 rounded-[26px] border border-[var(--border)] bg-[var(--surface-muted)] p-4">
            <div className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--text-soft)]">
              Current focus
            </div>
            <div className="mt-2 font-display text-2xl font-bold">{currentSection.label}</div>
            <p className="mt-2 text-sm leading-7 subtle-text">{currentSection.description}</p>
          </div>

          <nav className="mt-6 space-y-2">
            {navItems.map(({ to, icon: Icon, label, description, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex rounded-[24px] border px-4 py-4 transition-all ${
                    isActive
                      ? "border-brand-400/30 bg-brand-500/10"
                      : "border-transparent bg-transparent hover:border-[var(--border)] hover:bg-[var(--surface-muted)]"
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <div
                      className={`mt-0.5 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl ${
                        isActive ? "bg-brand-500 text-white" : "bg-[var(--surface-strong)] text-[var(--text-muted)]"
                      }`}
                    >
                      <Icon className="h-4.5 w-4.5" />
                    </div>
                    <div className="ml-3">
                      <div className="font-semibold">{label}</div>
                      <div className="mt-1 text-sm subtle-text">{description}</div>
                    </div>
                  </>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="mt-auto space-y-3">
            <button onClick={toggleTheme} className="btn-secondary w-full justify-between rounded-[22px]">
              <span className="flex items-center gap-3">
                {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                {isDark ? "Switch to light mode" : "Switch to dark mode"}
              </span>
              <Settings2 className="h-4 w-4" />
            </button>

            <div className="rounded-[26px] border border-[var(--border)] bg-[var(--surface-strong)] p-4">
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--text-soft)]">
                Authenticated as
              </div>
              <div className="mt-3 flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-500/10 font-display text-sm font-bold text-brand-500">
                  {(user?.email || "A").slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="truncate font-semibold">{user?.user_metadata?.full_name || user?.email}</div>
                  <div className="truncate text-sm subtle-text">Admin access verified</div>
                </div>
              </div>
              <button onClick={handleSignOut} className="btn-danger mt-4 w-full justify-center rounded-[20px]">
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            </div>
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col rounded-[32px] border border-[var(--border)] bg-[var(--surface)] shadow-card">
          <header className="flex flex-col gap-4 border-b border-[var(--border)] px-4 py-4 sm:px-6 lg:hidden">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 via-sky-500 to-cyan-400 text-white">
                  <Compass className="h-5 w-5" />
                </div>
                <div>
                  <div className="font-display text-lg font-bold">CampusNav</div>
                  <div className="text-xs subtle-text">{currentSection.label}</div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button onClick={toggleTheme} className="btn-secondary h-11 w-11 rounded-full p-0">
                  {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                </button>
                <button onClick={handleSignOut} className="btn-danger h-11 w-11 rounded-full p-0">
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {navItems.map(({ to, label, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    `rounded-2xl px-4 py-3 text-sm font-semibold transition-all ${
                      isActive
                        ? "bg-brand-500 text-white"
                        : "border border-[var(--border)] bg-[var(--surface-strong)]"
                    }`
                  }
                >
                  {label}
                </NavLink>
              ))}
            </div>
          </header>

          <Outlet />
        </main>
      </div>
    </div>
  );
}
