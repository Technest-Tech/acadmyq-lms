"use client";

import { Blocks, Ellipsis } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState, type ReactNode } from "react";
import { SectionCard } from "@/components/admin/section-card";
import { StatusChip, type ChipTone } from "@/components/admin/status-chip";
import { useAuth } from "@/components/auth-provider";
import { ModuleIcon } from "@/components/clients/module-chips";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/toast";
import {
  activateClientModule,
  ApiError,
  CLIENT_TYPE_MODULES,
  enableClientModule,
  endClientModule,
  extendClientModuleTrial,
  pauseClientModule,
  type ClientType,
  type ModuleCode,
  type ModuleSubscription,
} from "@/lib/api";
import { daysUntil } from "@/lib/time";
import { cn } from "@/lib/utils";
import { moduleSlots } from "./client-summary";

/**
 * The Modules card (05-MODULES-NOT-PACKAGES §2/§5) — the client page's centerpiece and THE ONLY
 * writer for module on/off, trial, activate and pause. One row per module the client's TYPE may
 * hold, each backed 1:1 by a module_subscriptions row. What the client PAYS is not here: since
 * 2026-11-08 that is its agreement in the accounts book (the panel beside this card).
 *
 * Each row: identity · state chip · the verbs that apply right now. The everyday verbs (Enable,
 * Activate, Extend) are buttons; the two that take something away (Pause, Remove) sit behind the
 * row's "⋯" menu so they are never a slip of the hand away.
 */
export function ModulesCard({
  clientId,
  clientType,
  modules,
  currency,
  defaultPricing,
  onChanged,
  onActivate,
}: {
  clientId: string;
  clientType: ClientType;
  modules: ModuleSubscription[];
  currency: string;
  defaultPricing?: Partial<
    Record<ModuleCode, { price_minor: number; currency: string }>
  >;
  onChanged: () => void;
  /**
   * Ending a trial is when the client starts paying, so with no agreement yet the client page
   * opens the agreement form here instead (it ends the trial on save).
   */
  onActivate?: (module: ModuleCode) => void;
}) {
  const t = useTranslations("clients.subs");
  const tm = useTranslations("clients.modules");
  const td = useTranslations("clients.detail");
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
    kind: "enable" | "extend" | "confirm-pause" | "confirm-end";
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

  /** One module's lifecycle as chip words: paused, trial countdown, or active + renewal date. */
  const stateOf = (
    sub: ModuleSubscription,
  ): { tone: ChipTone; label: string } => {
    if (sub.status === "PAUSED") return { tone: "neutral", label: t("paused") };
    if (sub.is_trial) {
      const days = daysUntil(sub.trial_end) ?? 0;
      return days >= 0
        ? { tone: "warn", label: t("trialLeft", { days }) }
        : { tone: "crit", label: t("trialExpired") };
    }
    // A paid module just runs: when the client pays next is its agreement's business.
    return { tone: "good", label: t("active") };
  };

  return (
    <SectionCard
      icon={Blocks}
      title={t("title")}
      description={t("hint")}
      flush
      testId="modules-card"
    >
      <div className="divide-y">
        {moduleSlots(CLIENT_TYPE_MODULES[clientType], modules.map((m) => m.module)).map((code) => {
          const sub = byModule.get(code) ?? null;
          const open = editor?.module === code ? editor.kind : null;
          const isBusy = busy === code;
          const state = sub === null ? null : stateOf(sub);

          return (
            <div
              key={code}
              className="px-5 py-4"
              data-testid={`module-row-${code}`}
            >
              <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                {/* Identity */}
                <div className="flex min-w-0 flex-1 basis-48 items-center gap-3">
                  <ModuleIcon code={code} />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{tm(code)}</p>
                    <p className="text-muted-foreground truncate text-xs">
                      {td(`moduleHint.${code}`)}
                    </p>
                  </div>
                </div>

                {/* State */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:basis-64">
                  {sub === null || state === null ? (
                    <StatusChip tone="neutral">{t("off")}</StatusChip>
                  ) : (
                    <>
                      <StatusChip tone={state.tone} dot>
                        {state.label}
                      </StatusChip>
                    </>
                  )}
                </div>

                {/* Actions — the one writer */}
                {canManage && (
                  <div className="ms-auto flex shrink-0 flex-wrap items-center gap-1.5">
                    {sub === null ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isBusy}
                        onClick={() =>
                          setEditor({ module: code, kind: "enable" })
                        }
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
                              onClick={() =>
                                setEditor({ module: code, kind: "extend" })
                              }
                            >
                              {t("extend")}
                            </Button>
                            <Button
                              size="sm"
                              disabled={isBusy}
                              onClick={() =>
                                onActivate
                                  ? onActivate(code)
                                  : run(code, () =>
                                      activateClientModule(clientId, code),
                                    )
                              }
                              data-testid={`activate-${code}`}
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
                              onClick={() =>
                                run(code, () =>
                                  activateClientModule(clientId, code),
                                )
                              }
                            >
                              {t("resume")}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={isBusy}
                              onClick={() =>
                                setEditor({ module: code, kind: "extend" })
                              }
                            >
                              {t("extend")}
                            </Button>
                          </>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger>
                            <button
                              type="button"
                              aria-label={t("more")}
                              disabled={isBusy}
                              className={cn(
                                buttonVariants({
                                  variant: "ghost",
                                  size: "icon-sm",
                                }),
                              )}
                              data-testid={`more-${code}`}
                            >
                              <Ellipsis className="size-4" aria-hidden />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            {sub.status === "ACTIVE" && (
                              <DropdownMenuItem
                                onClick={() =>
                                  setEditor({
                                    module: code,
                                    kind: "confirm-pause",
                                  })
                                }
                                data-testid={`pause-${code}`}
                              >
                                {t("pause")}
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              destructive
                              onClick={() =>
                                setEditor({ module: code, kind: "confirm-end" })
                              }
                              data-testid={`remove-${code}`}
                            >
                              {t("remove")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Inline editors */}
              {open === "enable" && (
                <Editor title={t("editorEnable", { module: tm(code) })}>
                  <EnableForm
                    module={code}
                    currency={defaultPricing?.[code]?.currency ?? currency}
                    suggestedPriceMinor={
                      defaultPricing?.[code]?.price_minor ?? 0
                    }
                    busy={isBusy}
                    onCancel={() => setEditor(null)}
                    onSubmit={(input) =>
                      run(code, () => enableClientModule(clientId, code, input))
                    }
                  />
                </Editor>
              )}
              {open === "extend" && (
                <Editor title={t("editorExtend")}>
                  <ExtendForm
                    busy={isBusy}
                    onCancel={() => setEditor(null)}
                    onSubmit={(days) =>
                      run(code, () =>
                        extendClientModuleTrial(clientId, code, days),
                      )
                    }
                  />
                </Editor>
              )}
              {(open === "confirm-pause" || open === "confirm-end") && (
                <div className="bg-muted/40 mt-3 flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm">
                  <span className="flex-1">
                    {open === "confirm-pause"
                      ? t("confirmPause")
                      : t("confirmEnd")}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditor(null)}
                  >
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
                    data-testid={`confirm-${open === "confirm-pause" ? "pause" : "remove"}-${code}`}
                  >
                    {open === "confirm-pause" ? t("pause") : t("remove")}
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}

/** The inline editor frame under a row: a muted panel with the verb spelled out on top. */
function Editor({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bg-muted/40 mt-3 rounded-lg border p-3">
      <p className="mb-2.5 text-xs font-semibold">{title}</p>
      {children}
    </div>
  );
}

const editorField =
  "border-input bg-background h-8 rounded-lg border px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

/** Turn a module on for this client: a trial of N days, or running from today. The money is its agreement. */
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

  return (
    <div
      className="flex flex-wrap items-end gap-3"
      data-testid={`enable-form-${module}`}
    >
      <label className="text-xs font-medium">
        <span className="text-muted-foreground mb-1 block">{t("mode")}</span>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as "trial" | "active")}
          className={editorField}
        >
          <option value="trial">{t("modeTrial")}</option>
          <option value="active">{t("modeActive")}</option>
        </select>
      </label>
      {mode === "trial" && (
        <label className="text-xs font-medium">
          <span className="text-muted-foreground mb-1 block">
            {t("trialDays")}
          </span>
          <input
            type="number"
            min={1}
            max={3650}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className={cn(editorField, "w-20 tabular-nums")}
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
              // What the client pays is its agreement (Accounts); the module keeps the default
              // price only as the agreement form's starting point.
              price_minor: suggestedPriceMinor,
              currency,
              billing_interval: "MONTHLY",
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
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-xs font-medium">
        <span className="text-muted-foreground mb-1 block">
          {t("extendByDays")}
        </span>
        <input
          type="number"
          min={1}
          max={3650}
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className={cn(editorField, "w-20 tabular-nums")}
        />
      </label>
      <div className="ms-auto flex gap-2">
        <Button size="sm" variant="outline" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button
          size="sm"
          disabled={busy || days < 1}
          onClick={() => onSubmit(days)}
        >
          {t("extend")}
        </Button>
      </div>
    </div>
  );
}
