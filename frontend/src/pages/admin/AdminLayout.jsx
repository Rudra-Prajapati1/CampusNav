// CampusNav redesign — AdminLayout.jsx — updated
import { useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Building2,
  Compass,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  PanelLeftClose,
  Settings2,
  Sun,
} from "lucide-react";
import toast from "react-hot-toast";
import { useTheme } from "../../context/themeContext.jsx";
import { useAuthStore } from "../../stores/authStore.js";

const navGroups = [
  {
    title: "Dashboard",
    items: [
      {
        to: "/admin",
        label: "Overview",
        icon: LayoutDashboard,
        end: true,
      },
    ],
  },
  {
    title: "Buildings",
    items: [
      {
        to: "/admin/buildings",
        label: "Buildings & Floors",
        icon: Building2,
      },
    ],
  },
];

function Sidebar({ user, isDark, onToggleTheme, onSignOut, onNavigate }) {
  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="border-b border-default px-5 py-6">
        <div className="app-logo">
          <span className="app-logo-mark">
            <Compass className="h-5 w-5" />
          </span>
          <div>
            <div className="text-base font-semibold">CampusNav</div>
            <div className="text-xs text-muted">Admin workspace</div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6">
        {navGroups.map((group) => (
          <div key={group.title} className="mb-8">
            <div className="section-label">{group.title}</div>
            <div className="mt-3 space-y-1.5">
              {group.items.map(({ to, label, icon: Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    `group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-accent-light text-accent"
                        : "text-secondary hover:bg-surface-alt hover:text-primary"
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span
                        className={`absolute inset-y-2 left-0 w-[3px] rounded-r-full ${
                          isActive ? "bg-accent" : "bg-transparent"
                        }`}
                      />
                      <Icon className="h-5 w-5" />
                      <span>{label}</span>
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}

        <div>
          <div className="section-label">Settings</div>
          <div className="mt-3 space-y-2">
            <button onClick={onToggleTheme} className="btn-secondary w-full justify-start px-3">
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              {isDark ? "Switch to light mode" : "Switch to dark mode"}
            </button>
            <button onClick={onSignOut} className="btn-ghost w-full justify-start px-3">
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </div>
      </div>

      <div className="border-t border-default px-4 py-4">
        <div className="flex items-center gap-3 rounded-xl bg-surface-alt px-3 py-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-light font-semibold text-accent">
            {(user?.email || "A").slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-primary">
              {user?.user_metadata?.full_name || user?.email || "Admin user"}
            </div>
            <div className="truncate text-xs text-muted">{user?.email}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, signOut } = useAuthStore();
  const { isDark, toggleTheme } = useTheme();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const currentLabel = useMemo(() => {
    for (const group of navGroups) {
      const match = group.items.find((item) =>
        item.end ? location.pathname === item.to : location.pathname.startsWith(item.to),
      );
      if (match) return match.label;
    }
    return "Admin";
  }, [location.pathname]);

  const handleSignOut = async () => {
    await signOut();
    toast.success("Signed out");
    navigate("/admin/login", { replace: true });
  };

  return (
    <div className="min-h-screen bg-bg">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[240px] border-r border-default lg:block">
        <Sidebar
          user={user}
          isDark={isDark}
          onToggleTheme={toggleTheme}
          onSignOut={handleSignOut}
        />
      </aside>

      <header className="sticky top-0 z-20 border-b border-default bg-[color:var(--color-map-overlay)] px-4 py-4 backdrop-blur-md lg:hidden">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setDrawerOpen(true)}
            className="btn-secondary px-3"
            aria-label="Open admin menu"
          >
            <Menu className="h-4 w-4" />
          </button>
          <div className="app-logo">
            <span className="app-logo-mark">
              <Compass className="h-4 w-4" />
            </span>
            <div>
              <div className="text-sm font-semibold">CampusNav</div>
              <div className="text-[11px] text-muted">{currentLabel}</div>
            </div>
          </div>
          <button onClick={toggleTheme} className="btn-ghost px-3">
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
      </header>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 bg-slate-950/35 lg:hidden">
          <div className="h-full w-[280px] max-w-[85vw] border-r border-default bg-surface shadow-xl">
            <div className="flex items-center justify-between border-b border-default px-4 py-4">
              <div className="app-logo">
                <span className="app-logo-mark">
                  <Compass className="h-4 w-4" />
                </span>
                <span className="text-sm font-semibold">CampusNav</span>
              </div>
              <button onClick={() => setDrawerOpen(false)} className="btn-ghost px-3">
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </div>
            <Sidebar
              user={user}
              isDark={isDark}
              onToggleTheme={toggleTheme}
              onSignOut={handleSignOut}
              onNavigate={() => setDrawerOpen(false)}
            />
          </div>
        </div>
      )}

      <main className="min-h-screen lg:pl-[240px]">
        <div className="px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
