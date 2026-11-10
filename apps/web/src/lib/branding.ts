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

/**
 * Which workspace design <html> wears. CLASSIC is what every Quran academy always had; MODERN is the
 * new design in the Quran academy's own green and gold (`modern_look`, switched on per client); CENTRE
 * is the learning centre's violet version of the same design; COURSES is the same design in the
 * courses & curricula theme (`courses_art`: an English or curriculum academy that is not a centre,
 * 2026-11-10 — ocean blue and coral, no Quran ornaments, `data-palette="courses"`).
 */
export type WorkspaceLook = "classic" | "modern" | "centre" | "courses";

/**
 * Put the workspace's look on <html>. A classic academy gets exactly what it always got
 * (`applyBranding`, no attribute). The modern design hangs off `data-look="modern"` (centre-look.css)
 * and a centre's palette off `data-profile="centre"` on top of it. Both take their colours from the
 * stylesheet, so the inline colours `applyBranding` writes come off first: an inline custom property
 * beats any selector, and it is written even with nothing saved.
 */
export function applyWorkspaceTheme(look: WorkspaceLook): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (look === "classic") {
    delete root.dataset.profile;
    delete root.dataset.look;
    delete root.dataset.palette;
    applyBranding(loadBranding());
    return;
  }
  root.dataset.look = "modern";
  if (look === "centre") root.dataset.profile = "centre";
  else delete root.dataset.profile;
  if (look === "courses") root.dataset.palette = "courses";
  else delete root.dataset.palette;
  root.style.removeProperty("--primary");
  root.style.removeProperty("--ring");
  root.style.removeProperty("--gold");
}

/** Off the (app) area altogether: back to the default page. */
export function clearWorkspaceTheme(): void {
  if (typeof document === "undefined") return;
  delete document.documentElement.dataset.profile;
  delete document.documentElement.dataset.look;
  delete document.documentElement.dataset.palette;
}

/** The last workspace this browser opened, so a reload paints in its look before /auth/me answers. */
const WORKSPACE_KEY = "acq.workspace";

export function rememberWorkspace(look: WorkspaceLook): void {
  try {
    if (look === "classic") localStorage.removeItem(WORKSPACE_KEY);
    else localStorage.setItem(WORKSPACE_KEY, look);
  } catch {
    // Private mode or blocked storage: the first frame falls back to the default look.
  }
}

export function rememberedLook(): WorkspaceLook {
  try {
    const saved = localStorage.getItem(WORKSPACE_KEY);
    return saved === "centre" || saved === "modern" || saved === "courses" ? saved : "classic";
  } catch {
    return "classic";
  }
}

/**
 * Runs in <body> ahead of the shell's HTML on a hard load, so the loading screen wears the workspace's
 * look from the first frame instead of flashing the classic one while the session is fetched.
 */
export const WORKSPACE_INIT_SCRIPT = `try{var w=localStorage.getItem("${WORKSPACE_KEY}"),d=document.documentElement.dataset;if(w==="centre"||w==="modern"||w==="courses"){d.look="modern";if(w==="centre")d.profile="centre";if(w==="courses")d.palette="courses"}}catch(e){}`;
