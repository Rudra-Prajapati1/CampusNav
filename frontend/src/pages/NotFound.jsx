import { Link } from "react-router-dom";
import { Navigation } from "lucide-react";
import { useTheme } from "../context/themeContext";

export default function NotFound() {
  const { isDark } = useTheme();

  return (
    <div
      className={`min-h-screen flex items-center justify-center px-4 transition-colors duration-300 ${isDark ? "bg-surface-950" : "bg-slate-50"}`}
    >
      <div className="text-center">
        <div className="w-16 h-16 bg-gradient-to-br from-brand-500 to-violet-500 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <Navigation className="w-8 h-8 text-white" />
        </div>
        <h1
          className={`font-display text-6xl font-bold mb-3 ${isDark ? "text-white" : "text-slate-900"}`}
        >
          404
        </h1>
        <p className={`mb-8 ${isDark ? "text-white/40" : "text-slate-500"}`}>
          This location doesn't exist on the map.
        </p>
        <Link to="/" className="btn-primary mx-auto w-fit">
          ← Back to home
        </Link>
      </div>
    </div>
  );
}
