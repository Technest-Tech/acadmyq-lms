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
import { AddOnFormModal, PlanFormModal } from "./plan-forms";
import { AdminPageHeader } from "@/components/admin/page-header";
import { StatTile } from "@/components/admin/stat-tile";
import { StatusChip } from "@/components/admin/status-chip";
import { TableCard, Td, Th, TR_HEAD } from "@/components/admin/table";
import { EmptyState } from "@/components/admin/empty-state";
import { useAuth } from "@/components/auth-provider";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  getAdminDashboard,
  getCapabilityCatalog,
  getPlanCatalog,
  MODULE_CODES,
  updatePlan,
  type AddOnCatalogItem,
  type AdminDashboardStats,
  type CapabilityCatalog,
  type ModuleCode,
  type PlanCatalogItem,
} from "@/lib/api";
import { formatMoney, formatNumber } from "@/lib/money";
import { cn } from "@/lib/utils";

/** Inline active/inactive toggle for a plan column. */
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

type ModuleTab = ModuleCode | "ADDONS";

/**
 * Super-Admin plan management (Sprint 9 §8; restyled in superadmin-reorg on the shared admin
 * kit). KPI statistics, one tab per module (EVERY module in MODULE_CODES — a plan saved for a
 * module always has a tab to live on) plus the add-on grants, and a side-by-side comparison
 * matrix of each plan's price, limits and feature entitlements with inline activate/edit.
 * Gated by plan.manage.
 */
export function PlanAdminScreen() {
  const t = useTranslations("planAdmin");
  const tModules = useTranslations("clients.modules");
  const locale = useLocale();
  const { can } = useAuth();

  const [plans, setPlans] = useState<PlanCatalogItem[] | null>(null);
  const [addOns, setAddOns] = useState<AddOnCatalogItem[]>([]);
  const [catalog, setCatalog] = useState<CapabilityCatalog | null>(null);
  const [stats, setStats] = useState<AdminDashboardStats | null>(null);
  const [error, setError] = useState(false);
  const [toggleError, setToggleError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  // R3 (client-first redesign): one catalog, one tab per module — plus the add-on grants.
  const [moduleTab, setModuleTab] = useState<ModuleTab>("MANAGEMENT");

  // Modal state: a value means "open for this plan/add-on"; `"new"` means create.
  const [planModal, setPlanModal] = useState<PlanCatalogItem | "new" | null>(null);
  const [addOnModal, setAddOnModal] = useState<AddOnCatalogItem | "new" | null>(null);

  const load = useCallback(() => {
    setError(false);
    setPlans(null);
    Promise.all([getPlanCatalog(), getCapabilityCatalog()])
      .then(([cat, caps]) => {
        setPlans(cat.plans);
        setAddOns(cat.addOns);
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
    setAddOnModal(null);
    load();
  }, [load]);

  // The tab's plans (a plan with no module yet counts as MANAGEMENT — the server default).
  const visible = useMemo(
    () =>
      plans === null || moduleTab === "ADDONS"
        ? []
        : plans.filter((p) => (p.module ?? "MANAGEMENT") === moduleTab),
    [plans, moduleTab],
  );

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
    <div className="space-y-5">
      <AdminPageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <Button
            type="button"
            size="sm"
            disabled={catalog === null}
            onClick={() => setPlanModal("new")}
            data-testid="new-plan"
          >
            <Plus className="size-4" aria-hidden />
            {t("form.newPlan")}
          </Button>
        }
      />

      {error && <AlertBanner variant="error" message={t("loadError")} />}
      {toggleError && <AlertBanner variant="error" message={t("toggleError")} />}

      {/* Statistics strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          icon={Package}
          label={t("statPlans")}
          value={plans === null ? "—" : formatNumber(plans.length, locale)}
          sub={plans === null ? undefined : t("statActive", { count: activeCount })}
          loading={plans === null}
        />
        <StatTile
          icon={Building2}
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
        <StatTile
          icon={Coins}
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
        <StatTile
          icon={Crown}
          label={t("statTopPlan")}
          value={topPlan?.code ?? "—"}
          sub={topPlan ? t("academiesCount", { count: topPlan.count }) : t("statNoAcademies")}
        />
      </div>

      {/* Module tabs (R3): one per module + Add-ons — driven by MODULE_CODES so a new
          module's plans can never become unreachable again. */}
      <div className="flex gap-1 overflow-x-auto border-b" role="tablist" data-testid="plan-module-tabs">
        {([...MODULE_CODES, "ADDONS"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={moduleTab === tab}
            onClick={() => setModuleTab(tab)}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-semibold transition-colors",
              moduleTab === tab
                ? "border-primary text-primary"
                : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            {tab === "ADDONS" ? t("addOnsTab") : tModules(tab)}
            <span className="text-muted-foreground/70 ms-1.5 text-xs tabular-nums">
              {tab === "ADDONS"
                ? addOns.length
                : (plans ?? []).filter((p) => (p.module ?? "MANAGEMENT") === tab).length}
            </span>
          </button>
        ))}
      </div>

      {/* Add-ons tab (R3: the editor exists since Sprint 9 — now surfaced) */}
      {moduleTab === "ADDONS" ? (
        <section>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Layers className="text-muted-foreground size-4" aria-hidden />
              {t("addOnsTitle")}
            </h2>
            <Button
              type="button"
              size="sm"
              disabled={catalog === null}
              onClick={() => setAddOnModal("new")}
              data-testid="new-addon"
            >
              <Plus className="size-4" aria-hidden />
              {t("form.newAddOn")}
            </Button>
          </div>
          <TableCard>
            <table className="w-full text-sm">
              <thead>
                <tr className={TR_HEAD}>
                  <Th>{t("addOnCode")}</Th>
                  <Th>{t("addOnName")}</Th>
                  <Th>{t("addOnFeature")}</Th>
                  <Th className="text-end">{t("addOnPrice")}</Th>
                  <Th />
                </tr>
              </thead>
              <tbody className="divide-y">
                {addOns.length === 0 ? (
                  <tr>
                    <Td colSpan={5} className="text-muted-foreground py-10 text-center">
                      {t("noAddOns")}
                    </Td>
                  </tr>
                ) : (
                  addOns.map((a) => (
                    <tr key={a.id} className="hover:bg-muted/30 transition-colors">
                      <Td className="font-semibold">{a.code}</Td>
                      <Td>{a.name}</Td>
                      <Td className="text-muted-foreground font-mono text-xs" >
                        <span dir="ltr">{a.feature_key}</span>
                      </Td>
                      <Td className="text-end font-semibold tabular-nums">
                        {formatMoney({ amount: a.price_minor, currency: a.currency }, locale)}
                      </Td>
                      <Td className="text-end">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => setAddOnModal(a)}
                          aria-label={t("form.editAddOn")}
                        >
                          <Pencil className="size-3.5" aria-hidden />
                        </Button>
                      </Td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </TableCard>
        </section>
      ) : (
      /* Comparison matrix */
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Layers className="text-muted-foreground size-4" aria-hidden />
          {t("comparison")}
        </h2>

        {plans === null || catalog === null ? (
          <div className="bg-card h-72 animate-pulse rounded-xl shadow-sm ring-1 ring-foreground/[0.06]" aria-hidden />
        ) : visible.length === 0 ? (
          <EmptyState icon={Package} message={t("noPlans")} />
        ) : (
          <TableCard>
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b">
                  <th className="w-44 p-3 text-start align-bottom">
                    <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
                      {t("planColumn")}
                    </span>
                  </th>
                  {visible.map((p) => (
                    <th key={p.id} className="border-s p-3 align-top">
                      <div className="flex flex-col items-start gap-2">
                        <div className="flex w-full items-center justify-between gap-2">
                          <StatusChip tone="accent">{p.code}</StatusChip>
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
                          <StatusChip tone="good">{t("freeTrial")}</StatusChip>
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
                    colSpan={visible.length + 1}
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
                  {visible.map((p) => (
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
                  {visible.map((p) => (
                    <td key={p.id} className="border-s p-3 text-center">
                      <LimitValue value={p.features?.limits?.maxTeachers} locale={locale} />
                    </td>
                  ))}
                </tr>

                {/* Capabilities section */}
                <tr className="bg-muted/30">
                  <td
                    colSpan={visible.length + 1}
                    className="text-muted-foreground px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide"
                  >
                    {t("capabilitiesSection")}
                  </td>
                </tr>
                {capabilityEntries.map(([key, label]) => (
                  <tr key={key} className="border-b last:border-b-0">
                    <td className="p-3">{label}</td>
                    {visible.map((p) => {
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
          </TableCard>
        )}
      </section>
      )}

      {catalog && planModal !== null && (
        <PlanFormModal
          open
          plan={planModal === "new" ? null : planModal}
          catalog={catalog}
          onClose={() => setPlanModal(null)}
          onSaved={afterSave}
        />
      )}
      {catalog && addOnModal !== null && (
        <AddOnFormModal
          open
          addOn={addOnModal === "new" ? null : addOnModal}
          catalog={catalog}
          onClose={() => setAddOnModal(null)}
          onSaved={afterSave}
        />
      )}
    </div>
  );
}
