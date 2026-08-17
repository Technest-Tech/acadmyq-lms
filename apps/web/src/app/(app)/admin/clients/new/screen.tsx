"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { AcademyWizard } from "@/components/academies/academy-wizard";
import { AdminPageHeader } from "@/components/admin/page-header";
import { MODULE_STYLE } from "@/components/clients/module-chips";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  ApiError,
  createWhatsappOnlyClient,
  enableClientModule,
  listPlans,
  type ModuleCode,
  type Plan,
} from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * /admin/clients/new — the create-client flow (R2, 04-CLIENT-FIRST-REDESIGN §4). Reuses the
 * existing academy wizard (name / type / management plan / owner) and adds the MODULES choice the
 * old flow never had: tick Video and/or WhatsApp, pick a plan + trial-or-paid for each, and the
 * new client starts with the right module subscriptions from minute one — no follow-up visits to
 * two other pages. The management module itself comes from the wizard's plan + status choice.
 */

type ExtraPick = {
  on: boolean;
  planId: string;
  mode: "trial" | "active";
  days: number;
};

type ExtraModule = Extract<ModuleCode, "VIDEO" | "WHATSAPP">;

const EXTRA_MODULES: readonly ExtraModule[] = ["VIDEO", "WHATSAPP"];

export function NewClientScreen() {
  const t = useTranslations("clients.new");
  const tm = useTranslations("clients.modules");
  const ts = useTranslations("clients.subs");
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();

  const [plans, setPlans] = useState<Plan[]>([]);
  const [picks, setPicks] = useState<Record<ExtraModule, ExtraPick>>({
    VIDEO: { on: false, planId: "", mode: "trial", days: 5 },
    WHATSAPP: { on: false, planId: "", mode: "trial", days: 5 },
  });

  useEffect(() => {
    listPlans()
      .then((res) => setPlans(res.plans))
      .catch(() => setPlans([]));
  }, []);

  const plansFor = useMemo(
    () => (module: ModuleCode) =>
      plans.filter((p) => (p.module ?? "MANAGEMENT") === module && p.is_active),
    [plans],
  );

  const onCreated = async (academyId: string) => {
    for (const mod of EXTRA_MODULES) {
      const pick = picks[mod];
      if (!pick.on) continue;
      try {
        await enableClientModule(academyId, mod, {
          plan_id: pick.planId === "" ? null : pick.planId,
          mode: pick.mode,
          ...(pick.mode === "trial" ? { trial_days: pick.days } : {}),
        });
      } catch (e) {
        toast.error(
          t("enableFailed", {
            module: tm(mod),
            error: e instanceof ApiError ? e.message : String(e),
          }),
        );
      }
    }
    router.push(`/admin/clients/${academyId}`);
  };

  const setPick = (module: ExtraModule, patch: Partial<ExtraPick>) =>
    setPicks((prev) => ({ ...prev, [module]: { ...prev[module], ...patch } }));

  return (
    <div className="space-y-5" data-testid="new-client-screen">
      <AdminPageHeader
        backHref="/admin/clients"
        backLabel={t("back")}
        title={t("title")}
        subtitle={t("subtitle")}
      />

      {/* WhatsApp-only external client (R4, M-CLI-2): no owner login, connected by QR later. */}
      <WhatsappOnlyCard plans={plansFor("WHATSAPP")} />

      {/* Extra modules — applied right after the wizard creates the client. */}
      <section className="bg-card rounded-xl p-4 shadow-sm ring-1 ring-foreground/[0.06]">
        <h2 className="text-sm font-semibold">{t("modulesTitle")}</h2>
        <p className="text-muted-foreground mt-0.5 text-xs">{t("modulesHint")}</p>

        <div className="mt-3 space-y-2.5">
          {EXTRA_MODULES.map((module) => {
            const pick = picks[module];
            const modulePlans = plansFor(module);
            return (
              <div
                key={module}
                className={cn(
                  "rounded-xl border p-3 transition-colors",
                  pick.on ? "border-primary/40 bg-primary/[0.03]" : "bg-muted/20",
                )}
              >
                <label className="flex cursor-pointer items-center gap-2.5 text-sm font-semibold">
                  <input
                    type="checkbox"
                    checked={pick.on}
                    onChange={(e) => setPick(module, { on: e.target.checked })}
                    className="accent-primary size-4"
                    data-testid={`pick-${module}`}
                  />
                  <span
                    className={cn(
                      "inline-flex size-5 items-center justify-center rounded-md text-[10px] font-bold ring-1",
                      MODULE_STYLE[module].on,
                    )}
                    aria-hidden
                  >
                    {MODULE_STYLE[module].label}
                  </span>
                  {tm(module)}
                </label>

                {pick.on && (
                  <div className="mt-2.5 flex flex-wrap items-end gap-2.5 ps-7">
                    <label className="text-xs font-medium">
                      <span className="text-muted-foreground mb-1 block">{ts("plan")}</span>
                      <select
                        value={pick.planId}
                        onChange={(e) => setPick(module, { planId: e.target.value })}
                        className="bg-card h-8 rounded-md border px-2 text-sm"
                      >
                        <option value="">{ts("noPlansForModule")}</option>
                        {modulePlans.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} —{" "}
                            {formatMoney(
                              { amount: p.price_minor, currency: p.currency },
                              locale,
                            )}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs font-medium">
                      <span className="text-muted-foreground mb-1 block">{ts("mode")}</span>
                      <select
                        value={pick.mode}
                        onChange={(e) =>
                          setPick(module, { mode: e.target.value as "trial" | "active" })
                        }
                        className="bg-card h-8 rounded-md border px-2 text-sm"
                      >
                        <option value="trial">{ts("modeTrial")}</option>
                        <option value="active">{ts("modeActive")}</option>
                      </select>
                    </label>
                    {pick.mode === "trial" && (
                      <label className="text-xs font-medium">
                        <span className="text-muted-foreground mb-1 block">
                          {ts("trialDays")}
                        </span>
                        <input
                          type="number"
                          min={1}
                          max={3650}
                          value={pick.days}
                          onChange={(e) => setPick(module, { days: Number(e.target.value) })}
                          className="bg-card h-8 w-20 rounded-md border px-2 text-sm tabular-nums"
                        />
                      </label>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* The existing wizard: name / type / management plan / owner. */}
      <AcademyWizard
        onCreated={(academyId) => void onCreated(academyId)}
        onCancel={() => router.push("/admin/clients")}
      />
    </div>
  );
}

/** Quick-create for a WhatsApp-only external client — name + plan + trial/paid, no owner login. */
function WhatsappOnlyCard({ plans }: { plans: Plan[] }) {
  const t = useTranslations("clients.new");
  const ts = useTranslations("clients.subs");
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [planId, setPlanId] = useState("");
  const [mode, setMode] = useState<"trial" | "active">("trial");
  const [days, setDays] = useState(5);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const res = await createWhatsappOnlyClient({
        name: name.trim(),
        plan_id: planId === "" ? null : planId,
        mode,
        ...(mode === "trial" ? { trial_days: days } : {}),
      });
      router.push(`/admin/clients/${res.clientId}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <section
      className={cn(
        "rounded-xl border p-4 shadow-sm ring-1 ring-foreground/[0.06] transition-colors",
        open ? "border-primary/40 bg-primary/[0.03]" : "bg-card border-transparent",
      )}
      data-testid="wa-only-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <span
              className={cn(
                "inline-flex size-5 items-center justify-center rounded-md text-[10px] font-bold ring-1",
                MODULE_STYLE.WHATSAPP.on,
              )}
              aria-hidden
            >
              W
            </span>
            {t("waOnlyTitle")}
          </h2>
          <p className="text-muted-foreground mt-0.5 text-xs">{t("waOnlyHint")}</p>
        </div>
        {!open && (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="wa-only-open">
            {t("waOnlyStart")}
          </Button>
        )}
      </div>

      {open && (
        <div className="mt-3 flex flex-wrap items-end gap-2.5">
          <label className="min-w-52 flex-1 text-xs font-medium">
            <span className="text-muted-foreground mb-1 block">{t("waOnlyName")}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("waOnlyNamePlaceholder")}
              className="bg-card h-8 w-full rounded-md border px-2 text-sm"
              data-testid="wa-only-name"
            />
          </label>
          <label className="text-xs font-medium">
            <span className="text-muted-foreground mb-1 block">{ts("plan")}</span>
            <select
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
              className="bg-card h-8 rounded-md border px-2 text-sm"
            >
              <option value="">{ts("noPlansForModule")}</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {formatMoney({ amount: p.price_minor, currency: p.currency }, locale)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium">
            <span className="text-muted-foreground mb-1 block">{ts("mode")}</span>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as "trial" | "active")}
              className="bg-card h-8 rounded-md border px-2 text-sm"
            >
              <option value="trial">{ts("modeTrial")}</option>
              <option value="active">{ts("modeActive")}</option>
            </select>
          </label>
          {mode === "trial" && (
            <label className="text-xs font-medium">
              <span className="text-muted-foreground mb-1 block">{ts("trialDays")}</span>
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
            <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
              {ts("cancel")}
            </Button>
            <Button
              size="sm"
              disabled={busy || name.trim() === ""}
              onClick={create}
              data-testid="wa-only-create"
            >
              {t("waOnlyCreate")}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
