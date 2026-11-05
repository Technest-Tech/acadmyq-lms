"use client";

import { SlidersHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/components/auth-provider";
import { DURATION_PRESETS, apiErrorMessage, fromMinor, toMinor } from "@/components/groups/group-form";
import { fieldClass } from "@/components/groups/group-format";
import { SectionCard } from "@/components/settings/section-card";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { type GroupDefaults, getGroupDefaults, updateGroupDefaults } from "@/lib/group-defaults-api";
import type { GroupBillingMode, GroupMode, GroupTeacherPayMode } from "@/lib/groups-api";

const BILLING_MODES: GroupBillingMode[] = ["MONTHLY", "PER_LESSON", "COURSE"];
const PAY_MODES: Exclude<GroupTeacherPayMode, null>[] = ["PER_LESSON", "PER_HOUR", "PER_STUDENT", "REVENUE_SHARE"];
const MODES: GroupMode[] = ["ONLINE", "OFFLINE"];

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

/**
 * Settings → what a centre's new group opens on (docs/centre-profile/02-COHERENCE-AUDIT §3): lesson
 * length, online or in a room, how students pay, lessons a month, how the teacher is paid. The group
 * form pre-fills from these on create, never over anything typed; a group already made keeps its own.
 * Each money half shows only to whoever may set it, as in the group form.
 */
export function GroupDefaultsManager() {
  const t = useTranslations("groupDefaults");
  const tGroups = useTranslations("groups");
  const { can } = useAuth();
  const canPrice = can("student.set_price");
  const canPay = can("teacher.set_pay");

  const [loaded, setLoaded] = useState(false);
  const [minutes, setMinutes] = useState("");
  const [mode, setMode] = useState("");
  const [billing, setBilling] = useState("");
  const [monthLessons, setMonthLessons] = useState("");
  const [payMode, setPayMode] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [sharePct, setSharePct] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let live = true;
    void getGroupDefaults()
      .then(({ defaults: d }) => {
        if (!live) return;
        setMinutes(d.lesson_minutes != null ? String(d.lesson_minutes) : "");
        setMode(d.mode ?? "");
        setBilling(d.billing_mode ?? "");
        setMonthLessons(d.month_lessons != null ? String(d.month_lessons) : "");
        setPayMode(d.teacher_pay_mode ?? "");
        setPayAmount(fromMinor(d.teacher_pay_minor));
        setSharePct(d.teacher_share_bp != null ? String(d.teacher_share_bp / 100) : "");
        setLoaded(true);
      })
      .catch((err) => {
        if (!live) return;
        setError(apiErrorMessage(err, t("loadFailed")));
        setLoaded(true);
      });
    return () => {
      live = false;
    };
  }, [t]);

  /** What the form says, as the API takes it; a string = what is wrong with it. */
  function patch(): Partial<GroupDefaults> | string {
    const out: Partial<GroupDefaults> = {
      lesson_minutes: minutes ? Number(minutes) : null,
      mode: (mode || null) as GroupMode | null,
    };
    if (canPrice) {
      const lessons = monthLessons.trim();
      if (billing === "MONTHLY" && lessons !== "" && (!Number.isInteger(Number(lessons)) || Number(lessons) < 1 || Number(lessons) > 500)) {
        return t("errors.monthLessons");
      }
      out.billing_mode = (billing || null) as GroupBillingMode | null;
      out.month_lessons = billing === "MONTHLY" && lessons !== "" ? Number(lessons) : null;
    }
    if (canPay) {
      out.teacher_pay_mode = (payMode || null) as GroupTeacherPayMode;
      if (payMode === "REVENUE_SHARE") {
        const pct = Number.parseFloat(sharePct);
        if (Number.isNaN(pct) || pct < 0 || pct > 100) return tGroups("form.errors.share");
        out.teacher_share_bp = Math.round(pct * 100);
      } else if (payMode !== "") {
        const amount = toMinor(payAmount);
        if (amount === null || amount < 0) return tGroups("form.errors.payAmount");
        out.teacher_pay_minor = amount;
      }
    }
    return out;
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const body = patch();
    setSaved(false);
    if (typeof body === "string") {
      setError(body);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await updateGroupDefaults(body);
      setSaved(true);
    } catch (err) {
      setError(apiErrorMessage(err, t("saveFailed")));
    } finally {
      setBusy(false);
    }
  }

  // A length typed on a group's own form may be off the list; it stays pickable here.
  const lengths = minutes !== "" && !DURATION_PRESETS.includes(Number(minutes)) ? [...DURATION_PRESETS, Number(minutes)] : DURATION_PRESETS;

  return (
    <SectionCard
      icon={SlidersHorizontal}
      title={t("cardTitle")}
      description={t("hint")}
      iconClassName="bg-gradient-to-br from-violet-500 to-fuchsia-500 shadow-violet-500/25"
      testId="group-defaults-manager"
    >
      {!loaded ? (
        <div className="flex items-center justify-center py-8">
          <div className="border-primary size-6 animate-spin rounded-full border-2 border-t-transparent" />
        </div>
      ) : (
        <form onSubmit={save} className="space-y-4">
          {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}
          {saved && <AlertBanner variant="success" message={t("saved")} onDismiss={() => setSaved(false)} />}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t("lessonMinutes")}>
              <select className={fieldClass} value={minutes} onChange={(e) => setMinutes(e.target.value)} data-testid="defaults-minutes">
                <option value="">{t("noDefault")}</option>
                {lengths.map((m) => (
                  <option key={m} value={m}>
                    {m} {tGroups("form.minutes")}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={tGroups("form.mode")}>
              <select className={fieldClass} value={mode} onChange={(e) => setMode(e.target.value)} data-testid="defaults-mode">
                <option value="">{t("noDefault")}</option>
                {MODES.map((m) => (
                  <option key={m} value={m}>
                    {tGroups(`mode.${m}`)}
                  </option>
                ))}
              </select>
            </Field>

            {canPrice && (
              <>
                <Field label={tGroups("money.billingMode")}>
                  <select className={fieldClass} value={billing} onChange={(e) => setBilling(e.target.value)} data-testid="defaults-billing">
                    <option value="">{t("noDefault")}</option>
                    {BILLING_MODES.map((m) => (
                      <option key={m} value={m}>
                        {tGroups(`money.mode.${m}`)}
                      </option>
                    ))}
                  </select>
                </Field>
                {billing === "MONTHLY" && (
                  <Field label={tGroups("money.monthLessons")}>
                    <input
                      className={fieldClass}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={500}
                      value={monthLessons}
                      onChange={(e) => setMonthLessons(e.target.value)}
                      data-testid="defaults-month-lessons"
                    />
                  </Field>
                )}
              </>
            )}

            {canPay && (
              <>
                <Field label={tGroups("money.teacherEarns")}>
                  <select className={fieldClass} value={payMode} onChange={(e) => setPayMode(e.target.value)} data-testid="defaults-pay-mode">
                    <option value="">{t("noDefault")}</option>
                    {PAY_MODES.map((m) => (
                      <option key={m} value={m}>
                        {tGroups(`money.payMode.${m}`)}
                      </option>
                    ))}
                  </select>
                </Field>
                {payMode === "REVENUE_SHARE" ? (
                  <Field label={tGroups("money.sharePct")}>
                    <input className={fieldClass} inputMode="decimal" value={sharePct} onChange={(e) => setSharePct(e.target.value)} data-testid="defaults-share" />
                  </Field>
                ) : payMode !== "" ? (
                  <Field label={tGroups(`money.payAmount.${payMode as "PER_LESSON" | "PER_HOUR" | "PER_STUDENT"}`)}>
                    <input className={fieldClass} inputMode="decimal" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} data-testid="defaults-pay-amount" />
                  </Field>
                ) : null}
              </>
            )}
          </div>

          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={busy} data-testid="defaults-save">
              {t("save")}
            </Button>
          </div>
        </form>
      )}
    </SectionCard>
  );
}
