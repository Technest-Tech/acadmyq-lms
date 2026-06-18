"use client";

import { Building2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { SectionCard } from "@/components/settings/section-card";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  ApiError,
  getAcademyProfile,
  updateAcademyProfile,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const inputBase =
  "border-input bg-background placeholder:text-muted-foreground focus:border-primary focus:ring-primary/15 w-full rounded-xl border text-sm outline-none transition-colors focus:ring-3 disabled:opacity-50";

/** Settings card for editing the academy display name (and timezone). */
export function AcademyNameCard() {
  const t = useTranslations("settings.academy");

  const [name, setName]           = useState("");
  const [timezone, setTimezone]   = useState("");
  const [dirty, setDirty]         = useState(false);
  const [busy, setBusy]           = useState(false);
  const [loading, setLoading]     = useState(true);
  const [savedFlag, setSavedFlag] = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getAcademyProfile();
      setName(res.academy.name);
      setTimezone(res.academy.timezone);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function handleNameChange(v: string) {
    setName(v);
    setDirty(true);
  }

  function handleTimezoneChange(v: string) {
    setTimezone(v);
    setDirty(true);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await updateAcademyProfile({ name: name.trim(), timezone: timezone.trim() });
      setDirty(false);
      setSavedFlag(true);
      setTimeout(() => setSavedFlag(false), 2000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard
      icon={Building2}
      title={t("cardTitle")}
      description={t("cardDesc")}
      iconClassName="bg-gradient-to-br from-slate-500 to-zinc-600 shadow-slate-500/25"
      testId="academy-name-card"
    >
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="border-primary size-6 animate-spin rounded-full border-2 border-t-transparent" />
        </div>
      ) : (
        <div className="space-y-4">
          {error && (
            <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                {t("name")}
              </label>
              <input
                className={cn(inputBase, "px-3.5 py-2.5")}
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder={t("namePlaceholder")}
                maxLength={120}
                data-testid="academy-name-input"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                {t("timezone")}
              </label>
              <input
                className={cn(inputBase, "px-3.5 py-2.5 font-mono text-xs")}
                value={timezone}
                onChange={(e) => handleTimezoneChange(e.target.value)}
                placeholder="e.g. Africa/Cairo"
                data-testid="academy-timezone-input"
              />
              <p className="mt-1 text-[11px] text-muted-foreground/70">
                {t("timezoneHint")}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            {savedFlag && (
              <span className="text-xs font-medium text-emerald-600">{t("saved")}</span>
            )}
            {dirty && !savedFlag && (
              <span className="text-xs text-muted-foreground">{t("unsaved")}</span>
            )}
            <Button
              type="button"
              size="sm"
              disabled={busy || !dirty || name.trim().length < 2}
              onClick={save}
              data-testid="save-academy-name"
            >
              {busy ? t("saving") : t("save")}
            </Button>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
