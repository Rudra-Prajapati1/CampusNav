/**
 * CampusNav Theme System
 *
 * Provides light/dark mode switching via React Context.
 * Persists preference to localStorage.
 * Applies 'dark' class to document root for Tailwind dark: variants.
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";

const ThemeContext = createContext(null);

const STORAGE_KEY = "campusnav-theme";

/**
 * Read initial theme from localStorage or system preference
 * @returns {'light'|'dark'}
 */
function getInitialTheme() {
  if (typeof window === "undefined") return "dark";

  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;

  // Default to dark (matches current design)
  return "dark";
}

/**
 * Apply theme class to document root
 * @param {'light'|'dark'} theme
 */
function applyThemeToDOM(theme) {
  const root = document.documentElement;
  if (theme === "dark") {
    root.classList.add("dark");
    root.classList.remove("light");
  } else {
    root.classList.add("light");
    root.classList.remove("dark");
  }
  // Also set color-scheme for native elements (scrollbars, inputs)
  root.style.colorScheme = theme;
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(getInitialTheme);

  // Apply theme on mount and changes
  useEffect(() => {
    applyThemeToDOM(theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const setTheme = useCallback((newTheme) => {
    setThemeState(newTheme);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  const isDark = theme === "dark";

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme, isDark }}>
      {children}
    </ThemeContext.Provider>
  );
}

/**
 * Hook to access theme context
 * @returns {{ theme: string, setTheme: Function, toggleTheme: Function, isDark: boolean }}
 */
export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
}

export default ThemeContext;
    