import type { CSSProperties, ReactNode } from "react";

/**
 * Per-academy brand theming for the public course site (docs/lms/09).
 *
 * The whole app is already token-driven (`--primary`, `--ring`, … in globals.css), so re-pointing
 * those variables on the site's root element recolours every shared component — buttons, focus
 * rings, links, badges — without a single conditional in the section kit. That is what makes "one
 * template, many clients" hold: the client picks a colour, not a stylesheet.
 *
 * Scoped to the wrapper, never to `:root`, so the dashboard's own palette is untouched if the two
 * ever render in the same document (tests, previews).
 */

/** A `#rrggbb` string, or the platform emerald when the client hasn't picked one. */
export function normalizeColor(color: string | undefined): string {
  return typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#12836a";
}

/**
 * Black or white text for a given background, by perceived luminance (WCAG relative-luminance
 * coefficients). A client who picks a pale yellow brand must still get readable button labels.
 */
export function readableOn(hex: string): string {
  const value = normalizeColor(hex).slice(1);
  const channel = (i: number) => {
    const c = parseInt(value.slice(i * 2, i * 2 + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
  return luminance > 0.45 ? "oklch(0.15 0 0)" : "oklch(0.99 0 0)";
}

/** The CSS-variable overrides for a brand colour — usable as an inline `style` on any element. */
export function brandVars(color: string | undefined): CSSProperties {
  const brand = normalizeColor(color);
  return {
    "--primary": brand,
    "--primary-foreground": readableOn(brand),
    "--ring": brand,
    "--brand": brand,
    // Tints the sections use for washes, chips and borders. color-mix keeps them in step with the
    // brand automatically, so there is only ever one colour to configure.
    "--brand-soft": `color-mix(in oklab, ${brand} 10%, transparent)`,
    "--brand-line": `color-mix(in oklab, ${brand} 22%, transparent)`,
    "--brand-deep": `color-mix(in oklab, ${brand} 78%, black)`,
  } as CSSProperties;
}

export function SiteTheme({ color, children }: { color: string | undefined; children: ReactNode }) {
  // `learn-site` (globals.css) pins the whole public site to the LIGHT palette — a student-facing
  // marketing site should never inherit a staff member's dark-mode preference.
  return (
    <div style={brandVars(color)} className="learn-site bg-background text-foreground min-h-screen">
      {children}
    </div>
  );
}
