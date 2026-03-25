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
      <div className="page-shell flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm font-display subtle-text">Loading CampusNav...</p>
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
          background: isDark ? "rgba(10, 22, 37, 0.96)" : "rgba(255, 255, 255, 0.98)",
          color: isDark ? "#edf5ff" : "#112031",
          border: isDark
            ? "1px solid rgba(149,176,211,0.16)"
            : "1px solid rgba(120,137,165,0.2)",
          borderRadius: "18px",
          fontSize: "14px",
          boxShadow: isDark
            ? "0 16px 42px rgba(1,7,14,0.34)"
            : "0 18px 44px rgba(20,42,74,0.12)",
        },
        success: { iconTheme: { primary: "#0f6efd", secondary: "#fff" } },
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
      <BrowserRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <AppRoutes />
      </BrowserRouter>
    </ThemeProvider>
  );
}
