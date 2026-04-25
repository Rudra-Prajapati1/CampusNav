// CampusNav redesign — App.jsx — updated
import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { useAuthStore } from "./stores/authStore.js";
import { ThemeProvider, useTheme } from "./context/themeContext.jsx";
import LandingPage from "./pages/LandingPage.jsx";
import NotFound from "./pages/NotFound.jsx";
import AdminBuildings from "./pages/admin/AdminBuildings.jsx";
import AdminDashboard from "./pages/admin/AdminDashboard.jsx";
import AdminFloorEditor from "./pages/admin/AdminFloorEditor.jsx";
import AdminFloorGeoreference from "./pages/admin/AdminFloorGeoreference.jsx";
import AdminLayout from "./pages/admin/AdminLayout.jsx";
import AdminLogin from "./pages/admin/AdminLogin.jsx";
import NavigatePage from "./pages/user/NavigatePage.jsx";

function ProtectedRoute({ children }) {
  const { user, isAdmin, loading, authError } = useAuthStore();

  if (loading) {
    return (
      <div className="page-shell flex min-h-screen items-center justify-center px-6">
        <div className="card-sm flex flex-col items-center gap-4 text-center">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          <div>
            <div className="text-base font-semibold">Loading admin workspace</div>
            <p className="mt-1 text-sm subtle-text">
              Checking your CampusNav access.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (user && authError && !isAdmin) {
    return (
      <div className="page-shell flex min-h-screen items-center justify-center px-6">
        <div className="card-sm max-w-md text-center">
          <div className="text-base font-semibold">Admin access check failed</div>
          <p className="mt-2 text-sm subtle-text">
            {authError.message ||
              "CampusNav could not verify your admin access right now."}
          </p>
        </div>
      </div>
    );
  }

  if (!user || !isAdmin) {
    return <Navigate to="/admin/login" replace />;
  }

  return children;
}

function ThemedToaster() {
  const { isDark } = useTheme();

  return (
    <Toaster
      position="top-right"
      toastOptions={{
        duration: 3500,
        style: {
          background: isDark ? "#131929" : "#ffffff",
          color: isDark ? "#f1f5f9" : "#0f172a",
          border: `1px solid ${isDark ? "#1E2D45" : "#E2E8F0"}`,
          borderRadius: "12px",
          boxShadow: "0 10px 24px rgba(15, 23, 42, 0.12)",
          fontSize: "14px",
        },
        success: {
          iconTheme: { primary: "#16A34A", secondary: "#ffffff" },
        },
        error: {
          iconTheme: { primary: "#DC2626", secondary: "#ffffff" },
        },
      }}
    />
  );
}

function AppRoutes() {
  const init = useAuthStore((store) => store.init);

  useEffect(() => {
    init();
  }, [init]);

  return (
    <>
      <ThemedToaster />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/navigate/:buildingId" element={<NavigatePage />} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route
          path="/admin/buildings/:buildingId/floors/:floorId/georeference"
          element={
            <ProtectedRoute>
              <AdminFloorGeoreference />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/buildings/:buildingId/floors/:floorId/editor"
          element={
            <ProtectedRoute>
              <AdminFloorEditor />
            </ProtectedRoute>
          }
        />
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
