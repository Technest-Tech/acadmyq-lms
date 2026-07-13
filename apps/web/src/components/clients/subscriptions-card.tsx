"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { daysLeft, MODULE_STYLE } from "@/components/clients/module-chips";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  activateClientModule,
  ApiError,
  enableClientModule,
  endClientModule,
  extendClientModuleTrial,
  MODULE_CODES,
  pauseClientModule,
  updateClientModule,
  type ModuleCode,
  type ModuleSubscription,
  type Plan,
} from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * The Subscriptions card (R2, 04-CLIENT-FIRST-REDESIGN §4) — the client page's centerpiece and THE
 * ONLY writer for module on/off / plan / trial / activate / pause ("one writer per fact"). Three
 * fixed rows — Management / Video / WhatsApp — each backed 1:1 by a module_subscriptions row:
 * enable an empty row with a plan + trial-or-paid, extend/activate a trial, change plan, pause or
 * remove. Every state it shows (countdown, price, renewal) reads from the module sub row itself.
 */
export function SubscriptionsCard({
  clientId,
  modules,
  plans,
  onChanged,
}: {
  clientId: string;
  modules: ModuleSubscription[];
  plans: Plan[];
  onChanged: () => void;
}) {
  const t = useTranslations("clients.subs");
  const tm = useTranslations("clients.modules");
  const locale = useLocale();
  const { can } = useAuth();
  const toast = useToast();
  const canManage = can("academy_billing.manage");

  const byModule = useMemo(
    () => new Map(modules.map((m) => [m.module, m])),
    [modules],
  );

  const [busy, setBusy] = useState<ModuleCode | null>(null);
  // Per-module open inline editor: enable form, extend form, or change-plan form.
  const [editor, setEditor] = useState<{
    module: ModuleCode;
    kind: "enable" | "extend" | "plan" | "confirm-pause" | "confirm-end";
  } | null>(null);

  const run = async (module: ModuleCode, fn: () => Promise<unknown>) => {
    setBusy(module);
    try {
      await fn();
      setEditor(null);
      onChanged();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const monthlyTotal = useMemo(() => {
    const active = modules.filter((m) => m.status === "ACTIVE" && !m.is_trial);
    const byCurrency = new Map<string, number>();
    for (const m of active) {
      byCurrency.set(m.currency, (byCurrency.get(m.currency) ?? 0) + m.total_cost_minor);
    }
    return [...byCurrency.entries()]
      .map(([currency, amount]) => formatMoney({ amount, currency }, locale))
      .join(" + ");
  }, [modules, locale]);

  return (
    <section
      className="bg-card overflow-hidden rounded-2xl border shadow-sm"
      data-testid="subscriptions-card"
    >
      <header className="bg-muted/40 flex items-center justify-between border-b px-4 py-2.5">
        <h2 className="text-muted-foreground text-[11px] font-bold uppercase tracking-[0.08em]">
          {t("title")}
        </h2>
        <span className="text-sm font-semibold tabular-nums">
          {monthlyTotal === "" ? "—" : t("total", { total: monthlyTotal })}
        </span>
      </header>

      <div className="divide-y">
        {MODULE_CODES.map((code) => {
          const sub = byModule.get(code) ?? null;
          const modulePlans = plans.filter(
            (p) => (p.module ?? "MANAGEMENT") === code && p.is_active,
          );
          const open = editor?.module === code ? editor.kind : null;
          const isBusy = busy === code;
          const trialDays = sub?.is_trial ? daysLeft(sub.trial_end) : null;

          return (
            <div key={code} className="px-4 py-3" data-testid={`module-row-${code}`}>
              <div className="flex flex-wrap items-center gap-3">
                {/* Module identity */}
                <span className="flex w-32 shrink-0 items-center gap-2 text-sm font-bold">
                  <span
                    className={cn(
                      "inline-flex size-5 items-center justify-center rounded-md text-[10px] ring-1",
                      MODULE_STYLE[code].on,
                    )}
                    aria-hidden
                  >
                    {MODULE_STYLE[code].label}
                  </span>
                  {tm(code)}
                </span>

                {/* State */}
                <div className="min-w-0 flex-1">
                  {sub === null ? (
                    <span className="text-muted-foreground text-sm">{t("off")}</span>
                  ) : (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-sm font-medium">
                        {sub.plan_name ?? sub.plan_code ?? t("noPlan")}
                      </span>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                          sub.status === "PAUSED"
                            ? "bg-muted text-muted-foreground"
                            : sub.is_trial
                              ? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                              : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
                        )}
                      >
                        {sub.status === "PAUSED"
                          ? t("paused")
                          : sub.is_trial
                            ? (trialDays ?? 0) >= 0
                              ? t("trialLeft", { days: trialDays ?? 0 })
                              : t("trialExpired")
                            : sub.current_period_end !== null
                              ? t("renews", {
                                  date: new Date(sub.current_period_end).toLocaleDateString(locale),
                                })
                              : t("active")}
                      </span>
                      {!sub.is_trial && sub.total_cost_minor > 0 && (
                        <span className="text-muted-foreground text-xs tabular-nums">
                          {formatMoney(
                            { amount: sub.total_cost_minor, currency: sub.currency },
                            locale,
                          )}
                          {t("perMonthSuffix")}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Actions — the one writer */}
                {canManage && (
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    {sub === null ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isBusy}
                        onClick={() => setEditor({ module: code, kind: "enable" })}
                        data-testid={`enable-${code}`}
                      >
                        {t("enable")}
                      </Button>
                    ) : (
                      <>
                        {sub.is_trial && sub.status === "ACTIVE" && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={isBusy}
                              onClick={() => setEditor({ module: code, kind: "extend" })}
                            >
                              {t("extend")}
                            </Button>
                            <Button
                              size="sm"
                              disabled={isBusy}
                              onClick={() => run(code, () => activateClientModule(clientId, code))}
                            >
                              {t("activate")}
                            </Button>
                          </>
                        )}
                        {sub.status === "PAUSED" && (
                          <>
                            <Button
                              size="sm"
                              disabled={isBusy}
                              onClick={() => run(code, () => activateClientModule(clientId, code))}
                            >
                              {t("resume")}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={isBusy}
                              onClick={() => setEditor({ module: code, kind: "extend" })}
                            >
                              {t("extend")}
                            </Button>
                          </>
                        )}
                        {!sub.is_trial && sub.status === "ACTIVE" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isBusy}
                            onClick={() => setEditor({ module: code, kind: "plan" })}
                          >
                            {t("changePlan")}
                          </Button>
                        )}
                        {sub.status === "ACTIVE" && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => setEditor({ module: code, kind: "confirm-pause" })}
                            className="text-muted-foreground hover:text-foreground px-1.5 text-xs font-medium"
                          >
                            {t("pause")}
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => setEditor({ module: code, kind: "confirm-end" })}
                          className="text-destructive/70 hover:text-destructive px-1.5 text-xs font-medium"
                        >
                          {t("remove")}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Inline editors */}
              {open === "enable" && (
                <EnableForm
                  module={code}
                  plans={modulePlans}
                  busy={isBusy}
                  onCancel={() => setEditor(null)}
                  onSubmit={(input) => run(code, () => enableClientModule(clientId, code, input))}
                />
              )}
              {open === "extend" && (
                <ExtendForm
                  busy={isBusy}
                  onCancel={() => setEditor(null)}
                  onSubmit={(days) => run(code, () => extendClientModuleTrial(clientId, code, days))}
                />
              )}
              {open === "plan" && sub !== null && (
                <PlanForm
                  plans={modulePlans}
                  currentPlanId={sub.plan_id}
                  locale={locale}
                  busy={isBusy}
                  onCancel={() => setEditor(null)}
                  onSubmit={(planId) =>
                    run(code, () => updateClientModule(clientId, code, { plan_id: planId }))
                  }
                />
              )}
              {(open === "confirm-pause" || open === "confirm-end") && (
                <div className="bg-muted/40 mt-2.5 flex flex-wrap items-center gap-2 rounded-lg border p-2.5 text-sm">
                  <span className="flex-1">
                    {open === "confirm-pause" ? t("confirmPause") : t("confirmEnd")}
                  </span>
                  <Button size="sm" variant="outline" onClick={() => setEditor(null)}>
                    {t("cancel")}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={isBusy}
                    onClick={() =>
                      run(code, () =>
                        open === "confirm-pause"
                          ? pauseClientModule(clientId, code)
                          : endClientModule(clientId, code),
                      )
                    }
                  >
                    {open === "confirm-pause" ? t("pause") : t("remove")}
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Enable a module: plan + trial-or-paid (trial days prefilled from the platform default). */
function EnableForm({
  module,
  plans,
  busy,
  onCancel,
  onSubmit,
}: {
  module: ModuleCode;
  plans: Plan[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (input: {
    plan_id?: string | null;
    mode: "trial" | "active";
    trial_days?: number;
  }) => void;
}) {
  const t = useTranslations("clients.subs");
  const locale = useLocale();
  const [planId, setPlanId] = useState<string>(plans[0]?.id ?? "");
  const [mode, setMode] = useState<"trial" | "active">("trial");
  const [days, setDays] = useState(5);

  return (
    <div
      className="bg-muted/40 mt-2.5 flex flex-wrap items-end gap-2.5 rounded-lg border p-2.5"
      data-testid={`enable-form-${module}`}
    >
      <label className="text-xs font-medium">
        <span className="text-muted-foreground mb-1 block">{t("plan")}</span>
        <select
          value={planId}
          onChange={(e) => setPlanId(e.target.value)}
          className="bg-card h-8 rounded-md border px-2 text-sm"
        >
          {plans.length === 0 && <option value="">{t("noPlansForModule")}</option>}
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} — {formatMoney({ amount: p.price_minor, currency: p.currency }, locale)}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs font-medium">
        <span className="text-muted-foreground mb-1 block">{t("mode")}</span>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as "trial" | "active")}
          className="bg-card h-8 rounded-md border px-2 text-sm"
        >
          <option value="trial">{t("modeTrial")}</option>
          <option value="active">{t("modeActive")}</option>
        </select>
      </label>
      {mode === "trial" && (
        <label className="text-xs font-medium">
          <span className="text-muted-foreground mb-1 block">{t("trialDays")}</span>
          <input
            type="number"
            min={1}
            max={3650}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="bg-card h-8 w-20 rounded-md border px-2 text-sm tabular-nums"
          />
        </label>
      )}
      <div className="ms-auto flex gap-2">
        <Button size="sm" variant="outline" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button
          size="sm"
          disabled={busy || planId === ""}
          onClick={() =>
            onSubmit({
              plan_id: planId === "" ? null : planId,
              mode,
              ...(mode === "trial" ? { trial_days: days } : {}),
            })
          }
        >
          {t("enable")}
        </Button>
      </div>
    </div>
  );
}

function ExtendForm({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (days: number) => void;
}) {
  const t = useTranslations("clients.subs");
  const [days, setDays] = useState(5);

  return (
    <div className="bg-muted/40 mt-2.5 flex flex-wrap items-end gap-2.5 rounded-lg border p-2.5">
      <label className="text-xs font-medium">
        <span className="text-muted-foreground mb-1 block">{t("extendByDays")}</span>
        <input
          type="number"
          min={1}
          max={3650}
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="bg-card h-8 w-20 rounded-md border px-2 text-sm tabular-nums"
        />
      </label>
      <div className="ms-auto flex gap-2">
        <Button size="sm" variant="outline" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button size="sm" disabled={busy || days < 1} onClick={() => onSubmit(days)}>
          {t("extend")}
        </Button>
      </div>
    </div>
  );
}

function PlanForm({
  plans,
  currentPlanId,
  locale,
  busy,
  onCancel,
  onSubmit,
}: {
  plans: Plan[];
  currentPlanId: string | null;
  locale: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (planId: string) => void;
}) {
  const t = useTranslations("clients.subs");
  const [planId, setPlanId] = useState(currentPlanId ?? plans[0]?.id ?? "");

  return (
    <div className="bg-muted/40 mt-2.5 flex flex-wrap items-end gap-2.5 rounded-lg border p-2.5">
      <label className="text-xs font-medium">
        <span className="text-muted-foreground mb-1 block">{t("plan")}</span>
        <select
          value={planId}
          onChange={(e) => setPlanId(e.target.value)}
          className="bg-card h-8 rounded-md border px-2 text-sm"
        >
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} — {formatMoney({ amount: p.price_minor, currency: p.currency }, locale)}
            </option>
          ))}
        </select>
      </label>
      <div className="ms-auto flex gap-2">
        <Button size="sm" variant="outline" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button
          size="sm"
          disabled={busy || planId === "" || planId === currentPlanId}
          onClick={() => onSubmit(planId)}
        >
          {t("changePlan")}
        </Button>
      </div>
    </div>
  );
}
