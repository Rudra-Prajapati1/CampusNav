import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Compass,
  Eye,
  EyeOff,
  Lock,
  Mail,
  Moon,
  ShieldCheck,
  Sun,
} from "lucide-react";
import toast from "react-hot-toast";
import { useAuthStore } from "../../stores/authStore.js";
import { useTheme } from "../../context/themeContext.jsx";

export default function AdminLogin() {
  const navigate = useNavigate();
  const { user, isAdmin, loading, signInWithEmail } = useAuthStore();
  const { isDark, toggleTheme } = useTheme();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && user && isAdmin) {
      navigate("/admin", { replace: true });
    }
  }, [user, isAdmin, loading, navigate]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!email || !password || submitting) return;

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
    <div className="page-shell page-grid flex min-h-screen items-center justify-center px-4 py-6 sm:px-6">
      <button
        onClick={toggleTheme}
        className="btn-secondary fixed right-5 top-5 z-20 h-11 w-11 rounded-full p-0"
        aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      >
        {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>

      <div className="mx-auto grid w-full max-w-6xl gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="card hidden min-h-[640px] flex-col justify-between p-8 lg:flex">
          <div>
            <div className="badge mb-5">
              <ShieldCheck className="h-3.5 w-3.5 text-brand-500" />
              Protected admin route
            </div>
            <div className="flex items-center gap-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-[22px] bg-gradient-to-br from-brand-500 via-sky-500 to-cyan-400 text-white">
                <Compass className="h-6 w-6" />
              </div>
              <div>
                <div className="font-display text-3xl font-bold">CampusNav</div>
                <div className="text-sm subtle-text">Operational workspace for indoor navigation</div>
              </div>
            </div>

            <h1 className="mt-12 max-w-xl font-display text-5xl font-bold leading-tight">
              Manage buildings, floor data, and route quality from one secure admin surface.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-8 subtle-text">
              Public users stay in the navigation flow while authenticated admins handle map editing, QR setup, entrances, and floor-level routing under `/admin`.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {[
              ["Buildings", "Keep campuses and entrances organized."],
              ["Floors", "Maintain multi-level indoor navigation data."],
              ["Routes", "Improve navigation quality before public rollout."],
            ].map(([title, text]) => (
              <div key={title} className="rounded-[24px] border border-[var(--border)] bg-[var(--surface-muted)] p-5">
                <div className="font-display text-xl font-bold">{title}</div>
                <p className="mt-3 text-sm leading-7 subtle-text">{text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="glass-light rounded-[32px] p-6 sm:p-8 lg:p-10">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 via-sky-500 to-cyan-400 text-white">
              <Compass className="h-5 w-5" />
            </div>
            <div>
              <div className="font-display text-2xl font-bold">CampusNav</div>
              <div className="text-sm subtle-text">Admin sign in</div>
            </div>
          </div>

          <div className="badge mb-5">
            <ShieldCheck className="h-3.5 w-3.5 text-brand-500" />
            Admin authentication required
          </div>
          <h2 className="font-display text-4xl font-bold">Sign in to `/admin`</h2>
          <p className="mt-3 text-base leading-8 subtle-text">
            Only approved admin accounts can access map operations and routing controls.
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            <div>
              <label className="label">Email</label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-soft)]" />
                <input
                  type="email"
                  className="input pl-11"
                  placeholder="admin@campusnav.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  required
                />
              </div>
            </div>

            <div>
              <label className="label">Password</label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-soft)]" />
                <input
                  type={showPassword ? "text" : "password"}
                  className="input pl-11 pr-11"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--text-soft)] transition-colors hover:text-[var(--text)]"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <button type="submit" disabled={submitting || !email || !password} className="btn-primary w-full">
              {submitting ? "Signing in..." : "Continue to admin"}
            </button>
          </form>

          <div className="mt-8 rounded-[24px] border border-[var(--border)] bg-[var(--surface-muted)] px-5 py-4">
            <div className="text-sm font-semibold">Access note</div>
            <p className="mt-2 text-sm leading-7 subtle-text">
              If authentication succeeds but your account is not in the `admins` table, the backend will still block entry. This keeps `/admin` limited to verified operators.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
