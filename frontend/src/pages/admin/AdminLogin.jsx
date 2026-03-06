import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Navigation,
  Mail,
  Lock,
  Eye,
  EyeOff,
  Loader2,
  Sun,
  Moon,
} from "lucide-react";
import { useAuthStore } from "../../stores/authStore.js";
import { useTheme } from "../../context/themeContext.jsx";
import toast from "react-hot-toast";

export default function AdminLogin() {
  const { user, isAdmin, loading, signInWithEmail } = useAuthStore();
  const { isDark, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && user && isAdmin) navigate("/admin");
  }, [user, isAdmin, loading, navigate]);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!email || !password) return;
    setSubmitting(true);
    try {
      await signInWithEmail(email, password);
    } catch (err) {
      toast.error(err.message || "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className={`min-h-screen flex items-center justify-center px-4 transition-colors duration-300 ${isDark ? "bg-surface-950" : "bg-slate-50"}`}
    >
      {/* Background blobs */}
      <div className="fixed inset-0 pointer-events-none">
        <div
          className={`absolute top-1/4 left-1/3 w-96 h-96 rounded-full blur-3xl ${isDark ? "bg-brand-600/15" : "bg-brand-400/10"}`}
        />
        <div
          className={`absolute bottom-1/4 right-1/3 w-64 h-64 rounded-full blur-3xl ${isDark ? "bg-violet-600/10" : "bg-violet-400/8"}`}
        />
      </div>

      {/* Theme toggle — top right */}
      <button
        onClick={toggleTheme}
        className={`fixed top-5 right-6 z-20 p-2 rounded-lg transition-all duration-200 ${
          isDark
            ? "text-white/40 hover:text-white hover:bg-white/10"
            : "text-slate-500 hover:text-slate-900 hover:bg-slate-200"
        }`}
        aria-label="Toggle theme"
      >
        {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
      </button>

      <div className="relative z-10 w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 bg-gradient-to-br from-brand-500 to-violet-500 rounded-2xl flex items-center justify-center mb-4 shadow-lg glow-brand">
            <Navigation className="w-7 h-7 text-white" />
          </div>
          <h1
            className={`font-display text-2xl font-bold ${isDark ? "text-white" : "text-slate-900"}`}
          >
            CampusNav
          </h1>
          <p
            className={`text-sm mt-1 ${isDark ? "text-white/40" : "text-slate-500"}`}
          >
            Admin Portal
          </p>
        </div>

        {/* Card */}
        <div
          className={`rounded-2xl border p-8 transition-colors duration-300 ${
            isDark ? "card" : "bg-white border-slate-200 shadow-md"
          }`}
        >
          <h2
            className={`font-display text-xl font-semibold mb-1 ${isDark ? "text-white" : "text-slate-900"}`}
          >
            Welcome back
          </h2>
          <p
            className={`text-sm mb-6 leading-relaxed ${isDark ? "text-white/40" : "text-slate-500"}`}
          >
            Sign in to manage your campus maps.
          </p>

          <form onSubmit={handleLogin} className="space-y-4">
            {/* Email */}
            <div>
              <label className={`label ${!isDark ? "text-slate-700" : ""}`}>
                Email
              </label>
              <div className="relative">
                <Mail
                  className={`w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 ${isDark ? "text-white/30" : "text-slate-400"}`}
                />
                <input
                  type="email"
                  className={`input pl-9 ${!isDark ? "bg-white border-slate-300 text-slate-900 placeholder-slate-400 focus:border-brand-400 focus:ring-brand-100" : ""}`}
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className={`label ${!isDark ? "text-slate-700" : ""}`}>
                Password
              </label>
              <div className="relative">
                <Lock
                  className={`w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 ${isDark ? "text-white/30" : "text-slate-400"}`}
                />
                <input
                  type={showPassword ? "text" : "password"}
                  className={`input pl-9 pr-10 ${!isDark ? "bg-white border-slate-300 text-slate-900 placeholder-slate-400 focus:border-brand-400 focus:ring-brand-100" : ""}`}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className={`absolute right-3 top-1/2 -translate-y-1/2 transition-colors ${isDark ? "text-white/30 hover:text-white/60" : "text-slate-400 hover:text-slate-600"}`}
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting || !email || !password}
              className="btn-primary w-full justify-center mt-2"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Navigation className="w-4 h-4" />
              )}
              {submitting ? "Signing in..." : "Sign In"}
            </button>
          </form>

          <div
            className={`mt-6 pt-5 border-t ${isDark ? "border-white/5" : "border-slate-100"}`}
          >
            <p
              className={`text-xs text-center leading-relaxed ${isDark ? "text-white/25" : "text-slate-400"}`}
            >
              Only pre-authorized admin accounts can access this panel.
              <br />
              <span className={isDark ? "text-brand-500/60" : "text-brand-400"}>
                Google OAuth can be enabled later.
              </span>
            </p>
          </div>
        </div>

        <p
          className={`text-center text-xs mt-6 ${isDark ? "text-white/20" : "text-slate-400"}`}
        >
          © 2025 CampusNav
        </p>
      </div>
    </div>
  );
}
