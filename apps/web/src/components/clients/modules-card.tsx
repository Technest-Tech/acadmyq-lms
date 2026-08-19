"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { MODULE_STYLE } from "@/components/clients/module-chips";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  activateClientModule,
  ApiError,
  CLIENT_TYPE_MODULES,
  enableClientModule,
  endClientModule,
  extendClientModuleTrial,
  pauseClientModule,
  updateClientModule,
  type ClientType,
  type ModuleCode,
  type ModuleSubscription,
} from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { daysUntil } from "@/lib/time";
import { cn } from "@/lib/utils";

/**
 * The Modules card (05-MODULES-NOT-PACKAGES §2/§5) — the client page's centerpiece and THE ONLY
 * writer for module on/off, price, trial, activate and pause. One row per module the client's TYPE
 * may hold, each backed 1:1 by a module_subscriptions row. There is no package to pick: a module is
 * either sold to this client (at a price we type here) or it isn't.
 */
export function ModulesCard({
  clientId,
  clientType,
  modules,
  currency,
  defaultPricing,
  onChanged,
}: {
  clientId: string;
  clientType: ClientType;
  modules: ModuleSubscription[];
  currency: string;
  defaultPricing?: Partial<Record<ModuleCode, { price_minor: number; currency: string }>>;
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
  const [editor, setEditor] = useState<{
    module: ModuleCode;
    kind: "enable" | "extend" | "price" | "confirm-pause" | "confirm-end";
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
      .map(([cur, amount]) => formatMoney({ amount, currency: cur }, locale))
      .join(" + ");
  }, [modules, locale]);

  return (
    <section
      className="bg-card overflow-hidden rounded-xl shadow-sm ring-1 ring-foreground/[0.06]"
      data-testid="modules-card"
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
        {CLIENT_TYPE_MODULES[clientType].map((code) => {
          const sub = byModule.get(code) ?? null;
          const open = editor?.module === code ? editor.kind : null;
          const isBusy = busy === code;
          const trialDays = sub?.is_trial ? daysUntil(sub.trial_end) : null;

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
                      <span className="text-sm font-medium tabular-nums">
                        {sub.base_price_minor > 0
                          ? formatMoney(
                              { amount: sub.base_price_minor, currency: sub.currency },
                              locale,
                            ) + t(sub.billing_interval === "YEARLY" ? "perYearSuffix" : "perMonthSuffix")
                          : t("free")}
                      </span>
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
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isBusy}
                          onClick={() => setEditor({ module: code, kind: "price" })}
                          data-testid={`price-${code}`}
                        >
                          {t("changePrice")}
                        </Button>
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
                  currency={defaultPricing?.[code]?.currency ?? currency}
                  suggestedPriceMinor={defaultPricing?.[code]?.price_minor ?? 0}
                  busy={isBusy}
                  onCancel={() => setEditor(null)}
                  onSubmit={(input) => run(code, () => enableClientModule(clientId, code, input))}
                />
              )}
              {open === "price" && sub !== null && (
                <PriceForm
                  priceMinor={sub.base_price_minor}
                  currency={sub.currency}
                  interval={sub.billing_interval}
                  busy={isBusy}
                  onCancel={() => setEditor(null)}
                  onSubmit={(patch) => run(code, () => updateClientModule(clientId, code, patch))}
                />
              )}
              {open === "extend" && (
                <ExtendForm
                  busy={isBusy}
                  onCancel={() => setEditor(null)}
                  onSubmit={(days) => run(code, () => extendClientModuleTrial(clientId, code, days))}
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

/** Sell a module to this client: its price, its interval, trial-or-paid. */
function EnableForm({
  module,
  currency,
  suggestedPriceMinor,
  busy,
  onCancel,
  onSubmit,
}: {
  module: ModuleCode;
  currency: string;
  suggestedPriceMinor: number;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (input: {
    mode: "trial" | "active";
    trial_days?: number;
    price_minor: number;
    currency: string;
    billing_interval: "MONTHLY" | "YEARLY";
  }) => void;
}) {
  const t = useTranslations("clients.subs");
  const [mode, setMode] = useState<"trial" | "active">("trial");
  const [days, setDays] = useState(5);
  const [price, setPrice] = useState(String(suggestedPriceMinor / 100));
  const [interval, setInterval] = useState<"MONTHLY" | "YEARLY">("MONTHLY");

  return (
    <div
      className="bg-muted/40 mt-2.5 flex flex-wrap items-end gap-2.5 rounded-lg border p-2.5"
      data-testid={`enable-form-${module}`}
    >
      <PriceFields
        price={price}
        setPrice={setPrice}
        currency={currency}
        interval={interval}
        setInterval={setInterval}
      />
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
          disabled={busy}
          onClick={() =>
            onSubmit({
              mode,
              price_minor: Math.max(0, Math.round(Number(price || 0) * 100)),
              currency,
              billing_interval: interval,
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

/** Reprice a module for this client — a custom or yearly deal is just a number typed here. */
function PriceForm({
  priceMinor,
  currency,
  interval: current,
  busy,
  onCancel,
  onSubmit,
}: {
  priceMinor: number;
  currency: string;
  interval: "MONTHLY" | "YEARLY";
  busy: boolean;
  onCancel: () => void;
  onSubmit: (patch: {
    price_minor: number;
    billing_interval: "MONTHLY" | "YEARLY";
  }) => void;
}) {
  const t = useTranslations("clients.subs");
  const [price, setPrice] = useState(String(priceMinor / 100));
  const [interval, setInterval] = useState(current);

  return (
    <div className="bg-muted/40 mt-2.5 flex flex-wrap items-end gap-2.5 rounded-lg border p-2.5">
      <PriceFields
        price={price}
        setPrice={setPrice}
        currency={currency}
        interval={interval}
        setInterval={setInterval}
      />
      <div className="ms-auto flex gap-2">
        <Button size="sm" variant="outline" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button
          size="sm"
          disabled={busy}
          onClick={() =>
            onSubmit({
              price_minor: Math.max(0, Math.round(Number(price || 0) * 100)),
              billing_interval: interval,
            })
          }
        >
          {t("savePrice")}
        </Button>
      </div>
    </div>
  );
}

/** Price + interval, shared by the enable and reprice forms. */
function PriceFields({
  price,
  setPrice,
  currency,
  interval,
  setInterval,
}: {
  price: string;
  setPrice: (v: string) => void;
  currency: string;
  interval: "MONTHLY" | "YEARLY";
  setInterval: (v: "MONTHLY" | "YEARLY") => void;
}) {
  const t = useTranslations("clients.subs");

  return (
    <>
      <label className="text-xs font-medium">
        <span className="text-muted-foreground mb-1 block">{t("price", { currency })}</span>
        <input
          type="number"
          min={0}
          step="0.01"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className="bg-card h-8 w-28 rounded-md border px-2 text-sm tabular-nums"
        />
      </label>
      <label className="text-xs font-medium">
        <span className="text-muted-foreground mb-1 block">{t("interval")}</span>
        <select
          value={interval}
          onChange={(e) => setInterval(e.target.value as "MONTHLY" | "YEARLY")}
          className="bg-card h-8 rounded-md border px-2 text-sm"
        >
          <option value="MONTHLY">{t("monthly")}</option>
          <option value="YEARLY">{t("yearly")}</option>
        </select>
      </label>
    </>
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
