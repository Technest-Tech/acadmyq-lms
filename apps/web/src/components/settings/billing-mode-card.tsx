"use client";

import { CalendarCheck, CalendarClock, Receipt, type LucideIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { SectionCard } from "@/components/settings/section-card";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ApiError } from "@/lib/api";
import {
  type BillingMode,
  type BillingModeState,
  type BillingPreview,
  getBillingMode,
  issueBillingNow,
  previewBilling,
  saveBillingMode,
} from "@/lib/billing-mode-api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

const MODES: ReadonlyArray<{ key: BillingMode; icon: LucideIcon; i18n: "after" | "prepaid" }> = [
  { key: "AFTER_LESSONS", icon: CalendarCheck, i18n: "after" },
  { key: "PREPAID_MONTHLY", icon: CalendarClock, i18n: "prepaid" },
];

const DAYS = Array.from({ length: 28 }, (_, i) => i + 1);

/**
 * Settings → طريقة التحصيل: bill each lesson after it happens (the default), or bill next month in
 * full from the issue day with this month's not-charged lessons taken off. The owner's choice
 * (settings.manage). Saving is explicit — the choice moves money — and switching on starts with
 * next month. While billing in advance it shows what the next run bills, and can run it now.
 */
export function BillingModeCard() {
  const t = useTranslations("settings.billingMode");
  const locale = useLocale();
  const [state, setState] = useState<BillingModeState | null>(null);
  const [mode, setMode] = useState<BillingMode>("AFTER_LESSONS");
  const [issueDay, setIssueDay] = useState(27);
  const [dueDay, setDueDay] = useState(5);
  const [whatsapp, setWhatsapp] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<BillingPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [issued, setIssued] = useState<number | null>(null);

  const adopt = useCallback((s: BillingModeState) => {
    setState(s);
    setMode(s.settings.mode);
    setIssueDay(s.settings.issue_day);
    setDueDay(s.settings.due_day);
    setWhatsapp(s.settings.whatsapp);
  }, []);

  const loadPreview = useCallback(async () => {
    setPreviewLoading(true);
    try {
      setPreview(await previewBilling());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    getBillingMode()
      .then((s) => {
        if (cancelled) return;
        adopt(s);
        if (s.settings.mode === "PREPAID_MONTHLY") void loadPreview();
      })
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [adopt, loadPreview]);

  const monthName = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(locale === "ar" ? "ar-u-nu-latn" : "en-US", { month: "long", year: "numeric" }).format(
          new Date(`${iso.slice(0, 10)}T12:00:00Z`),
        )
      : "";
  const money = (minor: number, currency: string) => formatMoney({ amount: minor, currency }, locale);

  const savedMode = state?.settings.mode ?? "AFTER_LESSONS";
  const switchingOn = mode === "PREPAID_MONTHLY" && savedMode !== "PREPAID_MONTHLY";
  const dirty =
    state !== null &&
    (mode !== savedMode ||
      (mode === "PREPAID_MONTHLY" &&
        (issueDay !== state.settings.issue_day || dueDay !== state.settings.due_day || whatsapp !== state.settings.whatsapp)));

  // The month a fresh switch would start with: next month on the device's calendar (the API decides).
  const nextMonthIso = (() => {
    const d = new Date();
    return new Date(Date.UTC(d.getFullYear(), d.getMonth() + 1, 1)).toISOString().slice(0, 10);
  })();

  async function save() {
    if (!state || saving) return;
    setSaving(true);
    setError(null);
    try {
      const next = await saveBillingMode(
        mode === "PREPAID_MONTHLY" ? { mode, issue_day: issueDay, due_day: dueDay, whatsapp } : { mode },
      );
      adopt(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      setPreview(null);
      if (next.settings.mode === "PREPAID_MONTHLY") void loadPreview();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function issueNow() {
    if (issuing) return;
    setIssuing(true);
    setError(null);
    try {
      const res = await issueBillingNow();
      setIssued(res.students);
      void loadPreview();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setIssuing(false);
    }
  }

  if (state !== null && !state.available) return null;

  return (
    <SectionCard
      icon={Receipt}
      title={t("title")}
      description={t("desc")}
      iconClassName="bg-gradient-to-br from-emerald-500 to-teal-600 shadow-emerald-500/25"
      testId="billing-mode-card"
    >
      {error && (
        <div className="mb-4">
          <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      {state === null ? (
        <div className="flex items-center justify-center py-8">
          <div className="border-primary size-6 animate-spin rounded-full border-2 border-t-transparent" />
        </div>
      ) : (
        <div className="space-y-4">
          <div role="radiogroup" aria-label={t("title")} className="grid gap-3 sm:grid-cols-2">
            {MODES.map(({ key, icon: Icon, i18n }) => {
              const selected = mode === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setMode(key)}
                  data-testid={`billing-mode-${key}`}
                  className={cn(
                    "flex items-start gap-3 rounded-xl border p-4 text-start transition-colors",
                    selected ? "border-primary bg-primary/5 ring-primary/30 ring-1" : "hover:bg-muted/50",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-xl",
                      selected ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                    )}
                  >
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{t(`${i18n}.title`)}</span>
                    <span className="text-muted-foreground mt-0.5 block text-xs leading-relaxed">{t(`${i18n}.desc`)}</span>
                  </span>
                </button>
              );
            })}
          </div>

          {mode === "PREPAID_MONTHLY" && (
            <div className="space-y-4 rounded-xl border p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="font-medium">{t("issueDay")}</span>
                  <select
                    className="border-input bg-background mt-1 block h-9 w-full rounded-lg border px-2 text-sm"
                    value={issueDay}
                    onChange={(e) => setIssueDay(Number(e.target.value))}
                    data-testid="billing-issue-day"
                  >
                    {DAYS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                  <span className="text-muted-foreground mt-1 block text-xs">{t("issueDayHint")}</span>
                </label>
                <label className="block text-sm">
                  <span className="font-medium">{t("dueDay")}</span>
                  <select
                    className="border-input bg-background mt-1 block h-9 w-full rounded-lg border px-2 text-sm"
                    value={dueDay}
                    onChange={(e) => setDueDay(Number(e.target.value))}
                    data-testid="billing-due-day"
                  >
                    {DAYS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                  <span className="text-muted-foreground mt-1 block text-xs">{t("dueDayHint")}</span>
                </label>
              </div>
              <label className="flex items-start gap-3 text-sm">
                <Switch checked={whatsapp} onChange={(e) => setWhatsapp(e.target.checked)} data-testid="billing-whatsapp" />
                <span>
                  <span className="block font-medium">{t("whatsapp")}</span>
                  <span className="text-muted-foreground block text-xs">{t("whatsappHint")}</span>
                </span>
              </label>
              <p className="text-muted-foreground text-xs leading-relaxed">{t("rules")}</p>
            </div>
          )}

          {switchingOn && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200" data-testid="billing-starts-with">
              {t("startsWith", { month: monthName(nextMonthIso) })}
            </p>
          )}

          <div className="flex items-center gap-3">
            <Button type="button" onClick={() => void save()} disabled={!dirty || saving} data-testid="billing-save">
              {saving ? t("saving") : t("save")}
            </Button>
            {saved && <span className="text-xs font-medium text-emerald-600">{t("saved")}</span>}
          </div>

          {savedMode === "PREPAID_MONTHLY" && state.next_period && (
            <div className="space-y-3 rounded-xl border p-4" data-testid="billing-preview">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-semibold">{t("preview.title", { month: monthName(state.next_period) })}</h4>
                {state.issue_open ? (
                  <Button type="button" size="sm" onClick={() => void issueNow()} disabled={issuing} data-testid="billing-issue-now">
                    {issuing ? t("preview.issuing") : t("preview.issue")}
                  </Button>
                ) : (
                  <span className="text-muted-foreground text-xs">{t("preview.notYet", { day: state.settings.issue_day })}</span>
                )}
              </div>
              {issued !== null && (
                <p className="text-xs font-medium text-emerald-600" data-testid="billing-issued">
                  {t("preview.issued", { count: issued, month: monthName(state.next_period) })}
                </p>
              )}
              {previewLoading || preview === null ? (
                <p className="text-muted-foreground text-xs">{t("preview.loading")}</p>
              ) : preview.summary ? (
                <>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="bg-primary/10 text-primary rounded-full px-2.5 py-1 font-medium">
                      {t("preview.billed", { count: preview.summary.billed })}
                    </span>
                    {preview.summary.totals.map((tot) => (
                      <span key={tot.currency} className="rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                        {money(tot.total_minor, tot.currency)}
                      </span>
                    ))}
                    <span className="bg-muted rounded-full px-2.5 py-1">{t("preview.deducted", { count: preview.summary.deducted_lessons })}</span>
                    {preview.summary.already > 0 && (
                      <span className="bg-muted rounded-full px-2.5 py-1">{t("preview.already", { count: preview.summary.already })}</span>
                    )}
                  </div>
                  {(preview.summary.no_price > 0 || preview.summary.no_timetable > 0) && (
                    <ul className="text-muted-foreground list-disc space-y-0.5 ps-5 text-xs">
                      {preview.summary.no_price > 0 && <li>{t("preview.noPrice", { count: preview.summary.no_price })}</li>}
                      {preview.summary.no_timetable > 0 && <li>{t("preview.noTimetable", { count: preview.summary.no_timetable })}</li>}
                    </ul>
                  )}
                  {preview.students.some((s) => s.skip === null) && (
                    <div className="max-h-72 overflow-auto rounded-lg border">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/60 sticky top-0">
                          <tr>
                            <th className="px-3 py-2 text-start font-medium">{t("preview.student")}</th>
                            <th className="px-3 py-2 text-end font-medium">{t("preview.fee")}</th>
                            <th className="px-3 py-2 text-end font-medium">{t("preview.off")}</th>
                            <th className="px-3 py-2 text-end font-medium">{t("preview.total")}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {preview.students
                            .filter((s) => s.skip === null)
                            .map((s) => (
                              <tr key={s.student_id}>
                                <td className="px-3 py-2">{s.full_name}</td>
                                <td className="px-3 py-2 text-end tabular-nums whitespace-nowrap">
                                  {s.fee_minor !== null ? money(s.fee_minor, s.currency) : "—"}
                                </td>
                                <td className="px-3 py-2 text-end tabular-nums whitespace-nowrap text-emerald-700 dark:text-emerald-300">
                                  {s.deducted_minor > 0 ? `−${money(s.deducted_minor, s.currency)}` : "—"}
                                </td>
                                <td className="px-3 py-2 text-end font-semibold tabular-nums whitespace-nowrap">
                                  {money(s.total_minor, s.currency)}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <p className="text-muted-foreground text-xs">{t("preview.where", { month: monthName(state.next_period) })}</p>
                </>
              ) : null}
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}
