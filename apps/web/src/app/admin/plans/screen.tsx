"use client";

import {
  Building2,
  CheckCircle2,
  Coins,
  Crown,
  GraduationCap,
  Infinity as InfinityIcon,
  Layers,
  Package,
  Pencil,
  Plus,
  UserCog,
  XCircle,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PlanFormModal } from "@/app/admin/plans/plan-forms";
import { useAuth } from "@/components/auth-provider";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  getAdminDashboard,
  getCapabilityCatalog,
  getPlanCatalog,
  updatePlan,
  type AdminDashboardStats,
  type CapabilityCatalog,
  type PlanCatalogItem,
} from "@/lib/api";
import { formatMoney, formatNumber } from "@/lib/money";
import { cn } from "@/lib/utils";

/** A compact KPI tile for the statistics strip. */
function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  tone = "primary",
}: {
  icon: typeof Package;
  label: string;
  value: string;
  sub?: string;
  tone?: "primary" | "emerald" | "amber" | "violet";
}) {
  const tones = {
    primary: "bg-primary/10 text-primary",
    emerald: "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300",
    amber: "bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300",
    violet: "bg-violet-100 text-violet-600 dark:bg-violet-950/40 dark:text-violet-300",
  } as const;
  return (
    <div className="bg-card rounded-2xl border p-4 shadow-sm ring-1 ring-foreground/[0.04]">
      <div className="flex items-center gap-3">
        <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg", tones[tone])}>
          <Icon className="size-5" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="text-muted-foreground text-xs font-medium">{label}</p>
          <p className="truncate text-xl font-bold tracking-tight tabular-nums">
            {value}
          </p>
        </div>
      </div>
      {sub && <p className="text-muted-foreground mt-2 text-xs">{sub}</p>}
    </div>
  );
}

/** Inline active/inactive toggle (reuses the platform-settings switch styling). */
function StatusSwitch({
  on,
  busy,
  onClick,
  label,
}: {
  on: boolean;
  busy: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={busy}
      onClick={onClick}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
        on ? "bg-emerald-500" : "bg-muted-foreground/30",
      )}
    >
      <span
        className={cn(
          "inline-block size-4 transform rounded-full bg-white shadow transition-transform",
          on ? "translate-x-4 rtl:-translate-x-4" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

/** A limit value: a number, or an ∞ badge when uncapped. */
function LimitValue({ value, locale }: { value: number | null | undefined; locale: string }) {
  const t = useTranslations("planAdmin");
  if (value === null || value === undefined) {
    return (
      <span className="text-primary inline-flex items-center gap-1 font-semibold">
        <InfinityIcon className="size-3.5" aria-hidden />
        {t("unlimited")}
      </span>
    );
  }
  return <span className="font-semibold tabular-nums">{formatNumber(value, locale)}</span>;
}

/**
 * Super-Admin plan management (Sprint 9 §8). A professional control surface for the revenue
 * model: KPI statistics (plan count, academies, estimated MRR, most popular tier), then a
 * side-by-side comparison matrix of every plan's price, limits and feature entitlements with
 * inline activate/deactivate and edit. Gated by plan.manage. (Add-ons are intentionally hidden
 * for now — the catalog still supports them, they're just not surfaced here.)
 */
export function PlanAdminScreen() {
  const t = useTranslations("planAdmin");
  const locale = useLocale();
  const { can } = useAuth();

  const [plans, setPlans] = useState<PlanCatalogItem[] | null>(null);
  const [catalog, setCatalog] = useState<CapabilityCatalog | null>(null);
  const [stats, setStats] = useState<AdminDashboardStats | null>(null);
  const [error, setError] = useState(false);
  const [toggleError, setToggleError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Modal state: a value means "open for this plan"; `"new"` means create.
  const [planModal, setPlanModal] = useState<PlanCatalogItem | "new" | null>(null);

  const load = useCallback(() => {
    setError(false);
    setPlans(null);
    Promise.all([getPlanCatalog(), getCapabilityCatalog()])
      .then(([cat, caps]) => {
        setPlans(cat.plans);
        setCatalog(caps);
      })
      .catch(() => setError(true));
    // Stats are best-effort: a failure here must not blank the management surface.
    getAdminDashboard()
      .then((d) => setStats(d.stats))
      .catch(() => setStats(null));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const afterSave = useCallback(() => {
    setPlanModal(null);
    load();
  }, [load]);

  const toggleActive = useCallback(
    (plan: PlanCatalogItem) => {
      setBusyId(plan.id);
      setToggleError(false);
      updatePlan(plan.id, { is_active: !plan.is_active })
        .then(() => load())
        .catch(() => setToggleError(true))
        .finally(() => setBusyId(null));
    },
    [load],
  );

  // Academy count per plan (from the platform dashboard distribution).
  const countByPlan = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of stats?.plan_distribution ?? []) {
      map.set(row.plan_id, row.academy_count);
    }
    return map;
  }, [stats]);

  // Estimated MRR = Σ price × academies, grouped by currency (FREE/$0 contributes nothing).
  const mrr = useMemo(() => {
    const byCurrency = new Map<string, number>();
    for (const p of plans ?? []) {
      const count = countByPlan.get(p.id) ?? 0;
      if (p.price_minor <= 0 || count === 0) continue;
      byCurrency.set(p.currency, (byCurrency.get(p.currency) ?? 0) + p.price_minor * count);
    }
    return [...byCurrency.entries()].map(([currency, amount]) => ({ currency, amount }));
  }, [plans, countByPlan]);

  const topPlan = useMemo(() => {
    let best: { code: string; count: number } | null = null;
    for (const p of plans ?? []) {
      const count = countByPlan.get(p.id) ?? 0;
      if (count > 0 && (best === null || count > best.count)) best = { code: p.code, count };
    }
    return best;
  }, [plans, countByPlan]);

  if (!can("plan.manage")) {
    return <p className="text-muted-foreground text-sm">{t("noPermission")}</p>;
  }

  const activeCount = plans?.filter((p) => p.is_active).length ?? 0;
  const capabilityEntries = catalog ? Object.entries(catalog.capabilities) : [];

  return (
    <div className="space-y-6">
      {/* Hero header */}
      <div className="from-primary/[0.10] via-card to-card relative overflow-hidden rounded-2xl border bg-gradient-to-br p-5 shadow-sm ring-1 ring-foreground/[0.04]">
        <div className="flex flex-wrap items-center gap-3.5">
          <div className="bg-primary/12 text-primary flex size-11 items-center justify-center rounded-xl">
            <Package className="size-5.5" aria-hidden />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
            <p className="text-muted-foreground mt-0.5 text-sm">{t("subtitle")}</p>
          </div>
          <Button
            type="button"
            size="sm"
            className="ms-auto"
            disabled={catalog === null}
            onClick={() => setPlanModal("new")}
            data-testid="new-plan"
          >
            <Plus className="size-4" aria-hidden />
            {t("form.newPlan")}
          </Button>
        </div>
      </div>

      {error && <AlertBanner variant="error" message={t("loadError")} />}
      {toggleError && <AlertBanner variant="error" message={t("toggleError")} />}

      {/* Statistics strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon={Package}
          label={t("statPlans")}
          value={plans === null ? "—" : formatNumber(plans.length, locale)}
          sub={plans === null ? undefined : t("statActive", { count: activeCount })}
        />
        <StatCard
          icon={Building2}
          tone="emerald"
          label={t("statAcademies")}
          value={stats === null ? "—" : formatNumber(stats.academies.total, locale)}
          sub={
            stats === null
              ? undefined
              : t("statTrialActive", {
                  active: stats.academies.active,
                  trial: stats.academies.trial,
                })
          }
        />
        <StatCard
          icon={Coins}
          tone="amber"
          label={t("statMrr")}
          value={formatMoney(
            {
              amount: mrr[0]?.amount ?? 0,
              currency: mrr[0]?.currency ?? plans?.[0]?.currency ?? "EGP",
            },
            locale,
          )}
          sub={mrr.length > 1 ? t("statMrrMore", { count: mrr.length - 1 }) : t("statMrrHint")}
        />
        <StatCard
          icon={Crown}
          tone="violet"
          label={t("statTopPlan")}
          value={topPlan?.code ?? "—"}
          sub={topPlan ? t("academiesCount", { count: topPlan.count }) : t("statNoAcademies")}
        />
      </div>

      {/* Comparison matrix */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Layers className="text-muted-foreground size-4" aria-hidden />
          {t("comparison")}
        </h2>

        {plans === null || catalog === null ? (
          <div className="bg-card h-72 animate-pulse rounded-2xl border shadow-sm" aria-hidden />
        ) : plans.length === 0 ? (
          <div className="border-border/60 bg-muted/20 rounded-2xl border border-dashed p-12 text-center text-sm font-medium">
            {t("noPlans")}
          </div>
        ) : (
          <div className="bg-card overflow-x-auto rounded-2xl border shadow-sm ring-1 ring-foreground/[0.04]">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b">
                  <th className="w-44 p-3 text-start align-bottom">
                    <span className="text-muted-foreground text-[10px] font-semibold uppercase tracking-wide">
                      {t("planColumn")}
                    </span>
                  </th>
                  {plans.map((p) => (
                    <th key={p.id} className="border-s p-3 align-top">
                      <div className="flex flex-col items-start gap-2">
                        <div className="flex w-full items-center justify-between gap-2">
                          <span className="bg-primary/10 text-primary inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold tracking-wide">
                            {p.code}
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => setPlanModal(p)}
                            aria-label={t("form.editPlan")}
                            data-testid={`edit-plan-${p.code}`}
                          >
                            <Pencil className="size-3.5" aria-hidden />
                          </Button>
                        </div>
                        <span className="font-semibold">{p.name}</span>
                        {p.price_minor === 0 ? (
                          <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                            {t("freeTrial")}
                          </span>
                        ) : (
                          <span className="text-lg font-bold tracking-tight tabular-nums">
                            {formatMoney({ amount: p.price_minor, currency: p.currency }, locale)}
                            <span className="text-muted-foreground text-xs font-medium">
                              {" "}
                              {t("perMonth")}
                            </span>
                          </span>
                        )}
                        <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                          <Building2 className="size-3" aria-hidden />
                          {t("academiesCount", { count: countByPlan.get(p.id) ?? 0 })}
                        </span>
                        <div className="flex items-center gap-2 pt-0.5">
                          <StatusSwitch
                            on={p.is_active}
                            busy={busyId === p.id}
                            onClick={() => toggleActive(p)}
                            label={p.is_active ? t("deactivate") : t("activate")}
                          />
                          <span
                            className={cn(
                              "text-[11px] font-medium",
                              p.is_active ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
                            )}
                          >
                            {p.is_active ? t("active") : t("inactive")}
                          </span>
                        </div>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* Limits section */}
                <tr className="bg-muted/30">
                  <td
                    colSpan={plans.length + 1}
                    className="text-muted-foreground px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide"
                  >
                    {t("limitsSection")}
                  </td>
                </tr>
                <tr className="border-b">
                  <td className="text-muted-foreground p-3">
                    <span className="flex items-center gap-1.5">
                      <GraduationCap className="size-3.5" aria-hidden />
                      {t("maxStudents")}
                    </span>
                  </td>
                  {plans.map((p) => (
                    <td key={p.id} className="border-s p-3 text-center">
                      <LimitValue value={p.features?.limits?.maxStudents} locale={locale} />
                    </td>
                  ))}
                </tr>
                <tr className="border-b">
                  <td className="text-muted-foreground p-3">
                    <span className="flex items-center gap-1.5">
                      <UserCog className="size-3.5" aria-hidden />
                      {t("maxTeachers")}
                    </span>
                  </td>
                  {plans.map((p) => (
                    <td key={p.id} className="border-s p-3 text-center">
                      <LimitValue value={p.features?.limits?.maxTeachers} locale={locale} />
                    </td>
                  ))}
                </tr>

                {/* Capabilities section */}
                <tr className="bg-muted/30">
                  <td
                    colSpan={plans.length + 1}
                    className="text-muted-foreground px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide"
                  >
                    {t("capabilitiesSection")}
                  </td>
                </tr>
                {capabilityEntries.map(([key, label]) => (
                  <tr key={key} className="border-b last:border-b-0">
                    <td className="p-3">{label}</td>
                    {plans.map((p) => {
                      const on = (p.features?.capabilities ?? []).includes(key);
                      return (
                        <td key={p.id} className="border-s p-3 text-center">
                          {on ? (
                            <CheckCircle2 className="mx-auto size-4 text-emerald-500" aria-hidden />
                          ) : (
                            <XCircle className="text-muted-foreground/30 mx-auto size-4" aria-hidden />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {catalog && planModal !== null && (
        <PlanFormModal
          open
          plan={planModal === "new" ? null : planModal}
          catalog={catalog}
          onClose={() => setPlanModal(null)}
          onSaved={afterSave}
        />
      )}
    </div>
  );
}
