// CampusNav redesign — AdminLogin.jsx — updated
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Compass, Eye, EyeOff, Lock, Mail, Moon, Sun } from "lucide-react";
import toast from "react-hot-toast";
import { useTheme } from "../../context/themeContext.jsx";
import { useAuthStore } from "../../stores/authStore.js";

export default function AdminLogin() {
  const navigate = useNavigate();
  const { isDark, toggleTheme } = useTheme();
  const { user, isAdmin, loading, signInWithEmail } = useAuthStore();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && user && isAdmin) {
      navigate("/admin", { replace: true });
    }
  }, [isAdmin, loading, navigate, user]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    try {
      await signInWithEmail(email, password);
      navigate("/admin", { replace: true });
    } catch (error) {
      toast.error(error.message || "Unable to sign in");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page-shell flex min-h-screen items-center justify-center px-6 py-10">
      <button
        onClick={toggleTheme}
        className="btn-secondary fixed right-6 top-6 z-10 px-3"
        aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      >
        {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>

      <div className="card w-full max-w-[400px]">
        <div className="app-logo justify-center">
          <span className="app-logo-mark">
            <Compass className="h-5 w-5" />
          </span>
          <div className="text-left">
            <div className="text-lg font-semibold">CampusNav</div>
            <div className="text-xs text-muted">Admin workspace</div>
          </div>
        </div>

        <div className="mt-8 text-center">
          <h1 className="text-3xl font-bold tracking-[-0.02em]">Admin sign in</h1>
          <p className="mt-3 text-sm subtle-text">
            Access the building, floor, and editor workspace with your approved
            administrator account.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-8">
          <div>
            <label className="field-label">Email</label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input
                type="email"
                className="input pl-11"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="admin@organization.com"
                autoComplete="email"
                required
              />
            </div>
          </div>

          <div className="mt-4">
            <label className="field-label">Password</label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input
                type={showPassword ? "text" : "password"}
                className="input pl-11 pr-11"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter your password"
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-secondary"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting || !email || !password}
            className="btn-primary mt-6 w-full"
          >
            {submitting ? "Signing in..." : "Continue"}
          </button>
        </form>

        <div className="mt-6 rounded-xl border border-default bg-surface-alt px-4 py-4 text-center">
          <p className="text-sm font-medium text-primary">Admin access only</p>
          <p className="mt-1 text-sm subtle-text">
            Need access? Contact your administrator.
          </p>
        </div>
      </div>
    </div>
  );
}
