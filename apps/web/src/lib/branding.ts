"use client";

/**
 * Academy branding (logo + colors). Persisted client-side for now — no backend
 * column yet — and applied live by writing CSS custom properties on :root so the
 * whole app picks up the academy's primary/accent colors immediately.
 */
export interface Branding {
  logoUrl: string;
  primary: string;
  accent: string;
}

export const DEFAULT_BRANDING: Branding = {
  logoUrl: "",
  // Defaults mirror the emerald/gold theme in globals.css (expressed as hex so the
  // native color picker can edit them).
  primary: "#2f9e6f",
  accent: "#e3b34d",
};

const STORAGE_KEY = "academiq.branding";

/** Read the saved branding from localStorage, falling back to the theme defaults. */
export function loadBranding(): Branding {
  if (typeof window === "undefined") return DEFAULT_BRANDING;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_BRANDING;
    return { ...DEFAULT_BRANDING, ...(JSON.parse(raw) as Partial<Branding>) };
  } catch {
    return DEFAULT_BRANDING;
  }
}

/** Persist branding and apply it immediately. */
export function saveBranding(branding: Branding): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(branding));
  applyBranding(branding);
}

/** Write the branding colors onto :root as CSS variables (no-op for the logo). */
export function applyBranding(branding: Branding): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty("--primary", branding.primary);
  root.style.setProperty("--ring", branding.primary);
  root.style.setProperty("--gold", branding.accent);
}
