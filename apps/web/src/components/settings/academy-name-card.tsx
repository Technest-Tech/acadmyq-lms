"use client";

import { Building2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { SectionCard } from "@/components/settings/section-card";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import {
  ApiError,
  getAcademyProfile,
  updateAcademyProfile,
} from "@/lib/api";
import { COUNTRIES, CURRENCIES } from "@/lib/countries";
import { cn } from "@/lib/utils";

const inputBase =
  "border-input bg-background placeholder:text-muted-foreground focus:border-primary focus:ring-primary/15 w-full rounded-xl border text-sm outline-none transition-colors focus:ring-3 disabled:opacity-50";

type OnlineChoice = "AUTO" | "ON" | "OFF";
const ONLINE_CHOICES: OnlineChoice[] = ["AUTO", "ON", "OFF"];
const ONLINE_VALUE: Record<OnlineChoice, boolean | null> = { AUTO: null, ON: true, OFF: false };

/** Settings card for editing the academy display name (and timezone). */
export function AcademyNameCard() {
  const t = useTranslations("settings.academy");
  const { session, refresh } = useAuth();
  // The online-lessons switch is a centre's; nobody else's card grows a control.
  const isCentre = session?.capabilities?.includes("centre") ?? false;
  const [online, setOnline] = useState<OnlineChoice>("AUTO");
  const [savedOnline, setSavedOnline] = useState<OnlineChoice>("AUTO");

  const [name, setName]           = useState("");
  const [timezone, setTimezone]   = useState("");
  // The defaults every new-person form opens on.
  const [country, setCountry]     = useState("");
  const [currency, setCurrency]   = useState("");
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
      setCountry(res.academy.country ?? "");
      setCurrency(res.academy.default_currency ?? "");
      const said: OnlineChoice = res.academy.online_lessons == null ? "AUTO" : res.academy.online_lessons ? "ON" : "OFF";
      setOnline(said);
      setSavedOnline(said);
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
      await updateAcademyProfile({ name: name.trim(), timezone: timezone.trim(), country: country || null, ...(currency ? { default_currency: currency } : {}), ...(isCentre ? { online_lessons: ONLINE_VALUE[online] } : {}) });
      setDirty(false);
      // The Enter button, the meeting link and the Punctuality tab read it from the session.
      if (isCentre && online !== savedOnline) {
        setSavedOnline(online);
        await refresh();
      }
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

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{t("country")}</label>
              <Combobox
                options={[{ value: "", label: "—" }, ...COUNTRIES.map((c) => ({ value: c.code, label: c.name, sublabel: c.dialCode }))]}
                value={country}
                onChange={(v) => {
                  setCountry(v);
                  setDirty(true);
                }}
                placeholder={t("pickCountry")}
                searchPlaceholder={t("search")}
                data-testid="academy-country"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{t("currency")}</label>
              <Combobox
                options={CURRENCIES.map((c) => ({ value: c.code, label: c.code, sublabel: c.name }))}
                value={currency}
                onChange={(v) => {
                  setCurrency(v);
                  setDirty(true);
                }}
                placeholder={t("pickCurrency")}
                searchPlaceholder={t("search")}
                data-testid="academy-currency"
              />
            </div>
            <p className="text-[11px] text-muted-foreground/70 sm:col-span-2">{t("defaultsHint")}</p>
            {isCentre && (
              <div className="sm:col-span-2" data-testid="academy-online">
                <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{t("online.label")}</span>
                <div role="radiogroup" aria-label={t("online.label")} className="grid grid-cols-3 gap-2">
                  {ONLINE_CHOICES.map((choice) => (
                    <button
                      key={choice}
                      type="button"
                      role="radio"
                      aria-checked={online === choice}
                      onClick={() => {
                        setOnline(choice);
                        setDirty(true);
                      }}
                      className={cn(
                        "rounded-xl border px-3 py-2 text-sm font-medium transition-colors",
                        online === choice ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted",
                      )}
                      data-testid={`academy-online-${choice}`}
                    >
                      {t(`online.${choice}`)}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground/70">
                  {t("online.hint")}
                  {online === savedOnline && online === "AUTO" && session?.academy?.onlineLessons !== undefined && (
                    <> {session.academy.onlineLessons ? t("online.nowOn") : t("online.nowOff")}</>
                  )}
                </p>
              </div>
            )}
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
