"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

export type Theme = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "theme";

interface ThemeValue {
  /** What the user picked. `system` follows the OS. */
  theme: Theme;
  /** What is actually on screen right now — `system` already resolved. */
  resolved: "light" | "dark";
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (value === null) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return value;
}

/**
 * Applies the `.dark` class the stylesheet's dark palette hangs off. globals.css has carried a full
 * dark theme since the start, but nothing ever put the class on <html>, so it was unreachable.
 *
 * The class is set BEFORE first paint by the inline script in the root layout (see THEME_INIT_SCRIPT)
 * — this provider only keeps it in sync afterwards. Doing it in an effect alone would flash the light
 * theme on every load for a dark-mode user.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Start from whatever the inline script already decided, so the first client render agrees with
  // the DOM. Server-side there is no window: fall back to `system`, which the script resolves anyway.
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === "undefined") return "system";
    return readStoredTheme();
  });

  const [resolved, setResolved] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    return document.documentElement.classList.contains("dark")
      ? "dark"
      : "light";
  });

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    const apply = () => {
      const next: "light" | "dark" =
        theme === "system" ? (media.matches ? "dark" : "light") : theme;
      document.documentElement.classList.toggle("dark", next === "dark");
      // Lets the browser theme native widgets (scrollbars, form controls, autofill) to match.
      document.documentElement.style.colorScheme = next;
      setResolved(next);
    };

    apply();

    // Only a `system` choice should follow the OS flipping mid-session.
    if (theme !== "system") return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage can be unavailable (private mode, blocked cookies). The choice still applies for
      // this session; it just won't survive a reload.
    }
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, resolved, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

function readStoredTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "light" || saved === "dark" || saved === "system") {
      return saved;
    }
  } catch {
    // ignore unavailable storage
  }
  return "system";
}

/**
 * Runs synchronously in <head>, before the first paint, so a dark-mode user never sees a white
 * flash. Kept as a string because it must be inlined — a bundled module would run too late.
 */
export const THEME_INIT_SCRIPT = `
(function () {
  try {
    var saved = localStorage.getItem('${THEME_STORAGE_KEY}');
    var dark = saved === 'dark' ||
      ((saved === 'system' || saved === null) &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  } catch (e) {}
})();
`.trim();
