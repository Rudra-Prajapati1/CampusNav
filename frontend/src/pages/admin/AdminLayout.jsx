import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { Navigation, LayoutDashboard, Building2, LogOut, ChevronRight } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore.js';
import toast from 'react-hot-toast';

const navItems = [
  { to: '/admin', icon: LayoutDashboard, label: 'Dashboard', end: true },
  { to: '/admin/buildings', icon: Building2, label: 'Buildings & Maps' },
];

export default function AdminLayout() {
  const { user, signOut } = useAuthStore();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    toast.success('Signed out');
    navigate('/admin/login');
  };

  return (
    <div className="min-h-screen bg-surface-950 flex">
      {/* Sidebar */}
      <aside className="w-60 flex-shrink-0 glass border-r border-white/5 flex flex-col">
        {/* Logo */}
        <div className="p-5 border-b border-white/5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-gradient-to-br from-brand-500 to-violet-500 rounded-lg flex items-center justify-center">
              <Navigation className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="font-display font-bold text-sm text-white">CampusNav</div>
              <div className="text-white/30 text-[10px]">Admin Panel</div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map(({ to, icon: Icon, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group ${
                  isActive
                    ? 'bg-brand-600/20 text-brand-300 border border-brand-500/20'
                    : 'text-white/50 hover:text-white hover:bg-white/5'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-brand-400' : ''}`} />
                  {label}
                  {isActive && <ChevronRight className="w-3 h-3 ml-auto text-brand-400" />}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* User */}
        <div className="p-3 border-t border-white/5">
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl">
            <img
              src={user?.user_metadata?.avatar_url || `https://api.dicebear.com/7.x/initials/svg?seed=${user?.email}`}
              alt="avatar"
              className="w-7 h-7 rounded-full ring-1 ring-white/10"
            />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-white truncate">
                {user?.user_metadata?.full_name || user?.email}
              </div>
              <div className="text-[10px] text-brand-400">Admin</div>
            </div>
            <button onClick={handleSignOut} className="text-white/30 hover:text-red-400 transition-colors p-1 rounded-lg hover:bg-red-500/10">
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-hidden flex flex-col min-h-screen">
        <Outlet />
      </main>
    </div>
  );
}
