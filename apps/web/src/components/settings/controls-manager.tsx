"use client";

import { Lock, SlidersHorizontal, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { SectionCard } from "@/components/settings/section-card";
import { AlertBanner } from "@/components/ui/alert";
import { ApiError, type AcademyControls, getAcademyControls, updateAcademyControls } from "@/lib/api";
import { cn } from "@/lib/utils";

type ControlKey = keyof AcademyControls;

/** Every switch on the page, in display order. A new control is one entry here + its copy. */
const CONTROLS: ReadonlyArray<{ key: ControlKey; icon: LucideIcon }> = [
  { key: "teacher_lessons_read_only", icon: Lock },
];

/**
 * Settings → Controls: switches that turn system features on or off for this academy's users.
 * Each switch saves the moment it is flipped and rolls back if the save fails. What a switch does
 * is enforced by the API (it trims the affected role's capabilities) — this only stores it.
 */
export function ControlsManager() {
  const t = useTranslations("settings.controls");
  const [settings, setSettings] = useState<AcademyControls | null>(null);
  const [saving, setSaving] = useState<ControlKey | null>(null);
  const [savedKey, setSavedKey] = useState<ControlKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSettings((await getAcademyControls()).settings);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(key: ControlKey) {
    if (!settings || saving) return;
    const previous = settings;
    const next = { ...settings, [key]: !settings[key] };
    setSettings(next);
    setSaving(key);
    setError(null);
    try {
      setSettings((await updateAcademyControls(next)).settings);
      setSavedKey(key);
      setTimeout(() => setSavedKey((k) => (k === key ? null : k)), 2000);
    } catch (err) {
      setSettings(previous);
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(null);
    }
  }

  return (
    <SectionCard
      icon={SlidersHorizontal}
      title={t("cardTitle")}
      description={t("cardDesc")}
      iconClassName="bg-gradient-to-br from-indigo-500 to-violet-600 shadow-indigo-500/25"
      testId="controls-card"
    >
      {error && (
        <div className="mb-4">
          <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      {settings === null ? (
        <div className="flex items-center justify-center py-8">
          <div className="border-primary size-6 animate-spin rounded-full border-2 border-t-transparent" />
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
            {t("groups.lessons")}
          </p>
          <ul className="divide-y rounded-xl border">
            {CONTROLS.map(({ key, icon: Icon }) => {
              const on = settings[key];
              return (
                <li key={key} className="flex items-start gap-3 p-4">
                  <div
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-xl transition-colors",
                      on ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                    )}
                  >
                    <Icon className="size-4" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{t(`items.${key}.title`)}</p>
                    <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                      {t(`items.${key}.desc`)}
                    </p>
                    {savedKey === key && (
                      <p className="mt-1 text-xs font-medium text-emerald-600">{t("saved")}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={t(`items.${key}.title`)}
                    disabled={saving !== null}
                    onClick={() => void toggle(key)}
                    data-testid={`control-${key}`}
                    className={cn(
                      "relative mt-1 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                      on ? "bg-primary" : "bg-muted-foreground/30",
                    )}
                  >
                    <span
                      className={cn(
                        "bg-background inline-block size-5 rounded-full shadow-sm transition-transform",
                        on ? "translate-x-[22px] rtl:-translate-x-[22px]" : "translate-x-0.5 rtl:-translate-x-0.5",
                      )}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </SectionCard>
  );
}
