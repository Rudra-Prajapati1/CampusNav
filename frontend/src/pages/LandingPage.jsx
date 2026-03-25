import { Link } from "react-router-dom";
import {
  ArrowRight,
  Building2,
  Compass,
  Layers,
  Moon,
  Navigation,
  QrCode,
  ShieldCheck,
  Sparkles,
  Sun,
} from "lucide-react";
import { useTheme } from "../context/themeContext.jsx";

const platformCards = [
  {
    icon: QrCode,
    title: "Scan to start",
    text: "Visitors can enter navigation instantly from a QR checkpoint without installing an app.",
  },
  {
    icon: Navigation,
    title: "Door-to-door routing",
    text: "Routes are designed to feel intentional, from the entrance to the exact destination touchpoint.",
  },
  {
    icon: Layers,
    title: "Multi-floor wayfinding",
    text: "Stairs, elevators, and level changes stay readable across complex academic and healthcare buildings.",
  },
  {
    icon: ShieldCheck,
    title: "Admin-controlled maps",
    text: "Operations teams can manage floor data, entrances, rooms, and navigation updates from one workspace.",
  },
];

const workflow = [
  "Add a building and upload floor plans in the admin workspace.",
  "Model rooms, doors, corridors, stairs, and elevators in the editor.",
  "Generate QR entry points and share a navigation link with visitors.",
  "Guide users through outdoor approach, indoor routing, and floor changes.",
];

const outcomes = [
  { value: "01", label: "single navigation flow", text: "Outdoor arrival, indoor orientation, and turn-by-turn guidance in one experience." },
  { value: "02", label: "clear operational control", text: "Dedicated admin routes keep editing, floor data, and map management separate from the public UX." },
  { value: "03", label: "professional visual language", text: "A calmer, map-first interface gives campus navigation a more trustworthy product feel." },
];

export default function LandingPage() {
  const { isDark, toggleTheme } = useTheme();

  return (
    <div className="page-shell page-grid overflow-x-hidden">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-5 pb-10 pt-6 sm:px-8 lg:px-10">
        <nav className="glass-light flex items-center justify-between rounded-full px-4 py-3 sm:px-5">
          <Link to="/" className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 via-sky-500 to-cyan-400 text-white shadow-soft">
              <Compass className="h-5 w-5" />
            </div>
            <div>
              <div className="font-display text-base font-bold">CampusNav</div>
              <div className="text-xs subtle-text">Indoor navigation platform</div>
            </div>
          </Link>

          <div className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={toggleTheme}
              className="btn-ghost h-11 w-11 rounded-full p-0"
              aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <Link to="/admin/login" className="btn-secondary hidden sm:inline-flex">
              Admin login
            </Link>
            <Link to="/admin" className="btn-primary">
              Open workspace
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </nav>

        <section className="grid flex-1 items-center gap-10 py-10 lg:grid-cols-[1.1fr_0.9fr] lg:py-16">
          <div className="max-w-2xl">
            <div className="badge mb-5">
              <Sparkles className="h-3.5 w-3.5 text-brand-500" />
              Inspired by premium map-led product landing pages
            </div>
            <h1 className="font-display text-5xl font-bold tracking-tight sm:text-6xl lg:text-7xl">
              Indoor wayfinding for campuses that should feel{" "}
              <span className="text-gradient">clear, calm, and credible</span>.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 subtle-text sm:text-xl">
              CampusNav helps students, staff, patients, and visitors move from the campus approach to the exact room entrance with a modern, app-free navigation experience.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link to="/admin" className="btn-primary">
                Launch admin workspace
                <ArrowRight className="h-4 w-4" />
              </Link>
              <a href="#platform" className="btn-secondary">
                Explore the platform
              </a>
            </div>

            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              <div className="metric-card">
                <div className="metric-label">Experience</div>
                <div className="metric-value">Door to door</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Access</div>
                <div className="metric-value">QR first</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Coverage</div>
                <div className="metric-value">Multi-floor</div>
              </div>
            </div>
          </div>

          <div className="relative">
            <div className="card relative overflow-hidden p-4 sm:p-5">
              <div className="absolute inset-x-8 top-0 h-36 rounded-full bg-brand-500/10 blur-3xl" />
              <div className="relative rounded-[28px] border border-[var(--border)] bg-[var(--surface-strong)] p-4 shadow-soft">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <div className="font-display text-xl font-bold">Navigation overview</div>
                    <div className="text-sm subtle-text">A map-led experience inspired by clean enterprise wayfinding products</div>
                  </div>
                  <div className="badge">
                    <Building2 className="h-3.5 w-3.5 text-brand-500" />
                    Campus mode
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                  <div className="rounded-[24px] border border-[var(--border)] bg-[var(--surface)] p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <div>
                        <div className="text-sm font-semibold">Route planner</div>
                        <div className="text-xs subtle-text">Entry to destination</div>
                      </div>
                      <div className="rounded-full bg-brand-500/10 px-3 py-1 text-xs font-semibold text-brand-500">
                        Live
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-soft)]">
                          Start
                        </div>
                        <div className="mt-1 text-sm font-semibold">Main gate checkpoint</div>
                      </div>
                      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-soft)]">
                          Destination
                        </div>
                        <div className="mt-1 text-sm font-semibold">AI Lab 2.14</div>
                      </div>
                      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                        <div className="flex items-center justify-between text-sm font-semibold">
                          <span>Estimated route</span>
                          <span className="text-brand-500">4 min</span>
                        </div>
                        <div className="mt-3 space-y-2 text-sm subtle-text">
                          <div className="flex items-center justify-between">
                            <span>Outdoor approach</span>
                            <span>120 m</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span>Indoor guidance</span>
                            <span>2 floors</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span>Arrival precision</span>
                            <span>Door anchor</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-[24px] border border-[var(--border)] bg-[linear-gradient(180deg,rgba(16,67,126,0.10),rgba(4,22,39,0.04))] p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <div>
                        <div className="text-sm font-semibold">Map viewport</div>
                        <div className="text-xs subtle-text">Professional, minimal, and route-first</div>
                      </div>
                      <div className="flex gap-2">
                        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                        <span className="h-2.5 w-2.5 rounded-full bg-brand-400" />
                      </div>
                    </div>

                    <div className="relative h-[320px] overflow-hidden rounded-[22px] border border-[var(--border)] bg-[radial-gradient(circle_at_top_left,rgba(14,110,252,0.22),transparent_32%),linear-gradient(180deg,rgba(246,250,255,0.65),rgba(232,240,249,0.55))] dark:bg-[radial-gradient(circle_at_top_left,rgba(93,162,255,0.16),transparent_32%),linear-gradient(180deg,rgba(9,23,38,0.88),rgba(8,18,32,0.96))]">
                      <div className="absolute inset-0 opacity-60" style={{ backgroundImage: "linear-gradient(var(--grid-line) 1px, transparent 1px), linear-gradient(90deg, var(--grid-line) 1px, transparent 1px)", backgroundSize: "36px 36px" }} />
                      <div className="absolute left-[16%] top-[18%] h-[60%] w-[68%] rounded-[28px] border border-white/40 bg-white/30 dark:border-white/10 dark:bg-white/5" />
                      <div className="absolute left-[28%] top-[24%] h-[14%] w-[42%] rounded-[18px] border border-sky-300/60 bg-sky-200/60 dark:border-sky-400/20 dark:bg-sky-400/10" />
                      <div className="absolute left-[28%] top-[46%] h-[12%] w-[16%] rounded-[16px] border border-brand-300/60 bg-brand-200/60 dark:border-brand-400/20 dark:bg-brand-400/10" />
                      <div className="absolute left-[54%] top-[46%] h-[12%] w-[16%] rounded-[16px] border border-emerald-300/60 bg-emerald-200/60 dark:border-emerald-400/20 dark:bg-emerald-400/10" />
                      <div className="absolute left-[28%] top-[64%] h-[10%] w-[42%] rounded-[14px] border border-slate-300/60 bg-slate-200/60 dark:border-slate-500/20 dark:bg-slate-400/10" />
                      <div className="absolute left-[31%] top-[70%] h-2.5 w-2.5 rounded-full bg-brand-500 shadow-[0_0_0_6px_rgba(15,110,253,0.15)]" />
                      <div className="absolute left-[42%] top-[70%] h-2.5 w-2.5 rounded-full bg-brand-500 shadow-[0_0_0_6px_rgba(15,110,253,0.15)]" />
                      <div className="absolute left-[55%] top-[70%] h-2.5 w-2.5 rounded-full bg-brand-500 shadow-[0_0_0_6px_rgba(15,110,253,0.15)]" />
                      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                        <path
                          d="M30 70 C38 70, 40 70, 43 70 C46 70, 50 70, 55 70 C60 70, 63 62, 66 52 C68 46, 70 40, 70 30"
                          fill="none"
                          stroke="url(#routeGradient)"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2.6"
                          strokeDasharray="7 5"
                        />
                        <defs>
                          <linearGradient id="routeGradient" x1="30%" y1="100%" x2="70%" y2="0%">
                            <stop offset="0%" stopColor="#0f6efd" />
                            <stop offset="100%" stopColor="#18c5b1" />
                          </linearGradient>
                        </defs>
                      </svg>
                      <div className="absolute left-[27%] top-[67%] flex h-8 w-8 items-center justify-center rounded-full bg-white text-xs font-bold text-brand-600 shadow-soft dark:bg-slate-900 dark:text-brand-300">
                        A
                      </div>
                      <div className="absolute left-[66%] top-[22%] flex h-8 w-8 items-center justify-center rounded-full bg-white text-xs font-bold text-emerald-600 shadow-soft dark:bg-slate-900 dark:text-emerald-300">
                        B
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="platform" className="grid gap-5 py-8 md:grid-cols-2 xl:grid-cols-4">
          {platformCards.map(({ icon: Icon, title, text }) => (
            <article key={title} className="card flex h-full flex-col">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-500/10 text-brand-500">
                <Icon className="h-5 w-5" />
              </div>
              <h2 className="font-display text-xl font-bold">{title}</h2>
              <p className="mt-3 text-sm leading-7 subtle-text">{text}</p>
            </article>
          ))}
        </section>

        <section className="grid gap-6 py-8 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="card">
            <div className="badge mb-4">
              <Navigation className="h-3.5 w-3.5 text-brand-500" />
              Platform workflow
            </div>
            <h2 className="font-display text-3xl font-bold">Built for real navigation operations, not only mockups.</h2>
            <div className="mt-5 space-y-4">
              {workflow.map((item, index) => (
                <div key={item} className="flex gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-4">
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-brand-500/10 font-display text-sm font-bold text-brand-500">
                    {index + 1}
                  </div>
                  <p className="text-sm leading-7 subtle-text">{item}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="grid gap-4 sm:grid-cols-3">
              {outcomes.map((item) => (
                <div key={item.value} className="rounded-[24px] border border-[var(--border)] bg-[var(--surface-muted)] p-5">
                  <div className="font-display text-3xl font-bold text-gradient">{item.value}</div>
                  <div className="mt-3 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--text-soft)]">
                    {item.label}
                  </div>
                  <p className="mt-4 text-sm leading-7 subtle-text">{item.text}</p>
                </div>
              ))}
            </div>

            <div className="mt-5 rounded-[28px] border border-[var(--border)] bg-[var(--surface-strong)] p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <div className="font-display text-2xl font-bold">Ready to modernize the public journey and the admin workspace?</div>
                  <p className="mt-2 max-w-2xl text-sm leading-7 subtle-text">
                    The updated platform design is structured so the public navigation flow stays focused, while admin tooling remains isolated under the protected `/admin` route.
                  </p>
                </div>
                <Link to="/admin" className="btn-primary">
                  Go to /admin
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </div>
        </section>

        <footer className="mt-6 flex flex-col gap-3 border-t border-[var(--border)] py-6 text-sm subtle-text sm:flex-row sm:items-center sm:justify-between">
          <div>CampusNav is designed for smart campuses, hospitals, offices, and event venues.</div>
          <div className="font-medium">Professional, minimal, and navigation-first.</div>
        </footer>
      </div>
    </div>
  );
}
