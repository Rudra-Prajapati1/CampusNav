import { Link } from "react-router-dom";
import {
  MapPin,
  Navigation,
  QrCode,
  Layers,
  Zap,
  Shield,
  Sun,
  Moon,
} from "lucide-react";
import { useTheme } from "../context/themeContext";

export default function LandingPage() {
  const { isDark, toggleTheme } = useTheme();

  return (
    <div
      className={`min-h-screen overflow-x-hidden transition-colors duration-300 ${isDark ? "bg-surface-950" : "bg-slate-50"}`}
    >
      {/* Grid background */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage: isDark
            ? `linear-gradient(rgba(99,102,241,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.03) 1px, transparent 1px)`
            : `linear-gradient(rgba(99,102,241,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.06) 1px, transparent 1px)`,
          backgroundSize: "60px 60px",
        }}
      />

      {/* Glow blobs */}
      <div
        className={`fixed top-0 left-1/4 w-96 h-96 rounded-full blur-3xl pointer-events-none ${isDark ? "bg-brand-600/20" : "bg-brand-400/10"}`}
      />
      <div
        className={`fixed bottom-1/4 right-1/4 w-64 h-64 rounded-full blur-3xl pointer-events-none ${isDark ? "bg-violet-600/15" : "bg-violet-400/10"}`}
      />

      {/* Nav */}
      <nav className="relative z-10 flex items-center justify-between px-6 py-5 max-w-6xl mx-auto">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-gradient-to-br from-brand-500 to-violet-500 rounded-lg flex items-center justify-center">
            <Navigation className="w-4 h-4 text-white" />
          </div>
          <span
            className={`font-display font-bold text-lg ${isDark ? "text-white" : "text-slate-900"}`}
          >
            CampusNav
          </span>
        </div>
        <div className="flex items-center gap-3">
          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className={`p-2 rounded-lg transition-all duration-200 ${
              isDark
                ? "text-white/40 hover:text-white hover:bg-white/10"
                : "text-slate-500 hover:text-slate-900 hover:bg-slate-200"
            }`}
            aria-label="Toggle theme"
          >
            {isDark ? (
              <Sun className="w-4 h-4" />
            ) : (
              <Moon className="w-4 h-4" />
            )}
          </button>
          <Link to="/admin/login" className="btn-secondary text-sm py-2">
            Admin Portal →
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative z-10 max-w-5xl mx-auto px-6 pt-20 pb-32 text-center">
        <div
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm mb-8 animate-in border ${
            isDark
              ? "glass text-brand-300 border-brand-500/20"
              : "bg-white text-brand-600 border-brand-200 shadow-sm"
          }`}
        >
          <Zap className="w-3.5 h-3.5" />
          Indoor Navigation for Smart Institutions
        </div>

        <h1
          className={`font-display text-5xl md:text-7xl font-bold mb-6 leading-tight tracking-tight ${isDark ? "text-white" : "text-slate-900"}`}
        >
          Navigate any campus{" "}
          <span className="text-gradient">without asking</span> for directions
        </h1>

        <p
          className={`text-lg md:text-xl max-w-2xl mx-auto mb-10 leading-relaxed ${isDark ? "text-white/50" : "text-slate-500"}`}
        >
          Scan a QR code. Find your destination. Follow the route. CampusNav
          brings smart indoor navigation to colleges, hospitals, events, and
          more.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link to="/admin/login" className="btn-primary text-base px-6 py-3">
            Get Started Free →
          </Link>
          <a
            href="#how-it-works"
            className={`btn-secondary text-base px-6 py-3 ${!isDark ? "bg-white border-slate-200 text-slate-700 hover:bg-slate-50" : ""}`}
          >
            See how it works
          </a>
        </div>
      </section>

      {/* How it works */}
      <section
        id="how-it-works"
        className="relative z-10 max-w-5xl mx-auto px-6 pb-20"
      >
        <h2
          className={`font-display text-3xl font-bold text-center mb-12 ${isDark ? "text-white" : "text-slate-900"}`}
        >
          How it works
        </h2>
        <div className="grid md:grid-cols-4 gap-4">
          {[
            {
              icon: QrCode,
              step: "01",
              title: "Scan QR",
              desc: "Visitor scans a QR code placed at their location",
            },
            {
              icon: MapPin,
              step: "02",
              title: "Opens Map",
              desc: "Website opens instantly with their current location marked",
            },
            {
              icon: Navigation,
              step: "03",
              title: "Pick Destination",
              desc: "Search and select where they want to go",
            },
            {
              icon: Layers,
              step: "04",
              title: "Follow Route",
              desc: "Shortest path shown with step-by-step directions",
            },
          ].map(({ icon: Icon, step, title, desc }) => (
            <div
              key={step}
              className={`relative group transition-all duration-300 rounded-2xl border p-5 ${
                isDark
                  ? "card hover:border-brand-500/30 bg-surface-900"
                  : "bg-white border-slate-200 hover:border-brand-300 shadow-sm hover:shadow-md"
              }`}
            >
              <div
                className={`text-xs font-mono mb-3 ${isDark ? "text-brand-500/60" : "text-brand-400"}`}
              >
                {step}
              </div>
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 transition-colors ${
                  isDark
                    ? "bg-brand-600/20 group-hover:bg-brand-600/30"
                    : "bg-brand-50 group-hover:bg-brand-100"
                }`}
              >
                <Icon
                  className={`w-5 h-5 ${isDark ? "text-brand-400" : "text-brand-600"}`}
                />
              </div>
              <h3
                className={`font-display font-semibold mb-1.5 ${isDark ? "text-white" : "text-slate-900"}`}
              >
                {title}
              </h3>
              <p
                className={`text-sm leading-relaxed ${isDark ? "text-white/40" : "text-slate-500"}`}
              >
                {desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="relative z-10 max-w-5xl mx-auto px-6 pb-24">
        <div
          className={`rounded-3xl p-8 md:p-12 border ${
            isDark ? "glass" : "bg-white border-slate-200 shadow-sm"
          }`}
        >
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                icon: Layers,
                title: "Multi-Floor",
                desc: "Navigate across floors with staircase and elevator routing",
              },
              {
                icon: Shield,
                title: "No App Needed",
                desc: "Entirely web-based. Works on any smartphone instantly.",
              },
              {
                icon: Zap,
                title: "Admin Tools",
                desc: "Powerful map editor with drag & drop room creation.",
              },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex gap-4">
                <div
                  className={`w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center mt-0.5 ${
                    isDark ? "bg-brand-600/20" : "bg-brand-50"
                  }`}
                >
                  <Icon
                    className={`w-5 h-5 ${isDark ? "text-brand-400" : "text-brand-600"}`}
                  />
                </div>
                <div>
                  <h3
                    className={`font-display font-semibold mb-1 ${isDark ? "text-white" : "text-slate-900"}`}
                  >
                    {title}
                  </h3>
                  <p
                    className={`text-sm leading-relaxed ${isDark ? "text-white/40" : "text-slate-500"}`}
                  >
                    {desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer
        className={`relative z-10 border-t px-6 py-8 text-center text-sm ${
          isDark
            ? "border-white/5 text-white/30"
            : "border-slate-200 text-slate-400"
        }`}
      >
        <p>© 2025 CampusNav · Built for smart campuses</p>
      </footer>
    </div>
  );
}
