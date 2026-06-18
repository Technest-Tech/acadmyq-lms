"use client";

import { Check, Palette, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { SectionCard } from "@/components/settings/section-card";
import { Button } from "@/components/ui/button";
import {
  type Branding,
  DEFAULT_BRANDING,
  loadBranding,
  saveBranding,
} from "@/lib/branding";
import { cn } from "@/lib/utils";

/** Preset brand colors users pick from (no free-form color picking). */
const PRIMARY_PALETTE = [
  "#2f9e6f", // emerald (default)
  "#0d9488", // teal
  "#2563eb", // blue
  "#4f46e5", // indigo
  "#7c3aed", // violet
  "#db2777", // pink
  "#dc2626", // red
  "#ea580c", // orange
  "#0f766e", // deep teal
  "#475569", // slate
];

const ACCENT_PALETTE = [
  "#e3b34d", // gold (default)
  "#f59e0b", // amber
  "#facc15", // yellow
  "#84cc16", // lime
  "#22d3ee", // cyan
  "#38bdf8", // sky
  "#fb7185", // rose
  "#a78bfa", // light violet
];

/** Pick the academy's brand colors from a curated palette. Applied live on save. */
export function ColorsManager() {
  const t = useTranslations("settings.branding");
  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);
  const [primary, setPrimary] = useState(DEFAULT_BRANDING.primary);
  const [accent, setAccent] = useState(DEFAULT_BRANDING.accent);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const b = loadBranding();
    setBranding(b);
    setPrimary(b.primary);
    setAccent(b.accent);
  }, []);

  const dirty = primary !== branding.primary || accent !== branding.accent;

  function save() {
    const next = { ...branding, primary, accent };
    saveBranding(next);
    setBranding(next);
    setSaved(true);
  }

  function reset() {
    const next = {
      ...branding,
      primary: DEFAULT_BRANDING.primary,
      accent: DEFAULT_BRANDING.accent,
    };
    setPrimary(next.primary);
    setAccent(next.accent);
    saveBranding(next);
    setBranding(next);
    setSaved(true);
  }

  return (
    <SectionCard
      icon={Palette}
      title={t("colorsCardTitle")}
      description={t("colorsCardDesc")}
      iconClassName="bg-gradient-to-br from-fuchsia-500 to-rose-500 shadow-rose-500/25"
      testId="colors-manager"
    >
      <div className="space-y-6">
        {/* Live preview */}
        <div
          className="flex items-center gap-3 rounded-2xl border bg-gradient-to-br from-muted/30 to-transparent p-4"
          data-testid="theme-preview"
        >
          <div
            className="flex size-12 items-center justify-center rounded-xl text-sm font-bold text-white shadow-sm"
            style={{ backgroundColor: primary }}
          >
            Aa
          </div>
          <div className="flex-1 space-y-1.5">
            <div
              className="h-2.5 w-3/4 rounded-full"
              style={{ backgroundColor: primary }}
            />
            <div
              className="h-2.5 w-1/3 rounded-full opacity-80"
              style={{ backgroundColor: accent }}
            />
          </div>
          <span
            className="rounded-full px-3 py-1 text-xs font-semibold text-white shadow-sm"
            style={{ backgroundColor: accent }}
          >
            {t("previewBadge")}
          </span>
        </div>

        <Swatches
          label={t("primaryLabel")}
          palette={PRIMARY_PALETTE}
          value={primary}
          onChange={(v) => {
            setPrimary(v);
            setSaved(false);
          }}
          testId="primary"
        />
        <Swatches
          label={t("accentLabel")}
          palette={ACCENT_PALETTE}
          value={accent}
          onChange={(v) => {
            setAccent(v);
            setSaved(false);
          }}
          testId="accent"
        />

        <div className="flex items-center gap-3 border-t pt-4">
          <Button
            type="button"
            size="sm"
            className="gap-1.5"
            disabled={!dirty}
            onClick={save}
            data-testid="save-colors"
          >
            <Check className="size-3.5" />
            {saved && !dirty ? t("saved") : t("save")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="gap-1.5 text-muted-foreground"
            onClick={reset}
            data-testid="reset-colors"
          >
            <RotateCcw className="size-3.5" />
            {t("reset")}
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}

function Swatches({
  label,
  palette,
  value,
  onChange,
  testId,
}: {
  label: string;
  palette: readonly string[];
  value: string;
  onChange: (value: string) => void;
  testId: string;
}) {
  return (
    <div className="space-y-2.5">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex flex-wrap gap-2.5" data-testid={`${testId}-palette`}>
        {palette.map((color) => {
          const selected = color.toLowerCase() === value.toLowerCase();
          return (
            <button
              key={color}
              type="button"
              aria-label={color}
              aria-pressed={selected}
              title={color}
              onClick={() => onChange(color)}
              className={cn(
                "flex size-9 items-center justify-center rounded-full ring-offset-2 ring-offset-card transition-transform hover:scale-110",
                selected
                  ? "ring-2 ring-foreground"
                  : "ring-1 ring-black/5 hover:ring-black/10",
              )}
              style={{ backgroundColor: color }}
            >
              {selected && (
                <Check className="size-4 text-white drop-shadow" aria-hidden />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
