import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { useEffect } from "react";
import { useAuthStore } from "./stores/authStore.js";
import { ThemeProvider, useTheme } from "./context/themeContext.jsx";

// Pages
import LandingPage from "./pages/LandingPage.jsx";
import NavigatePage from "./pages/user/NavigatePage.jsx";
import AdminLayout from "./pages/admin/AdminLayout.jsx";
import AdminDashboard from "./pages/admin/AdminDashboard.jsx";
import AdminBuildings from "./pages/admin/AdminBuildings.jsx";
import AdminFloorEditor from "./pages/admin/AdminFloorEditor.jsx";
import AdminLogin from "./pages/admin/AdminLogin.jsx";
import NotFound from "./pages/NotFound.jsx";

function ProtectedRoute({ children }) {
  const { user, isAdmin, loading } = useAuthStore();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-950 dark:bg-surface-950">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-white/40 text-sm font-display">
            Loading CampusNav...
          </p>
        </div>
      </div>
    );
  }

  if (!user || !isAdmin) return <Navigate to="/admin/login" replace />;
  return children;
}

function ThemedToaster() {
  const { isDark } = useTheme();

  return (
    <Toaster
      position="top-right"
      toastOptions={{
        style: {
          background: isDark ? "#1e293b" : "#ffffff",
          color: isDark ? "#fff" : "#1e293b",
          border: isDark
            ? "1px solid rgba(255,255,255,0.1)"
            : "1px solid rgba(0,0,0,0.1)",
          borderRadius: "12px",
          fontSize: "14px",
          boxShadow: isDark
            ? "0 4px 24px rgba(0,0,0,0.3)"
            : "0 4px 24px rgba(0,0,0,0.08)",
        },
        success: { iconTheme: { primary: "#6366f1", secondary: "#fff" } },
        error: { iconTheme: { primary: "#ef4444", secondary: "#fff" } },
      }}
    />
  );
}

function AppRoutes() {
  const init = useAuthStore((s) => s.init);

  useEffect(() => {
    init();
  }, [init]);

  return (
    <>
      <ThemedToaster />
      <Routes>
        {/* Public */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/navigate/:buildingId" element={<NavigatePage />} />

        {/* Admin */}
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route
          path="/admin"
          element={
            <ProtectedRoute>
              <AdminLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<AdminDashboard />} />
          <Route path="buildings" element={<AdminBuildings />} />
          <Route
            path="buildings/:buildingId/floors/:floorId/editor"
            element={<AdminFloorEditor />}
          />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </ThemeProvider>
  );
}
