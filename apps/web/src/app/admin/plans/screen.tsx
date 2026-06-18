"use client";

import {
  CheckCircle2,
  GraduationCap,
  Infinity as InfinityIcon,
  Layers,
  Pencil,
  Plus,
  Package,
  Puzzle,
  UserCog,
  XCircle,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { AddOnFormModal, PlanFormModal } from "@/app/admin/plans/plan-forms";
import { useAuth } from "@/components/auth-provider";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  getCapabilityCatalog,
  getPlanCatalog,
  type AddOnCatalogItem,
  type CapabilityCatalog,
  type PlanCatalogItem,
} from "@/lib/api";
import { formatMoney, formatNumber } from "@/lib/money";

function LimitRow({
  icon: Icon,
  label,
  value,
  locale,
}: {
  icon: typeof GraduationCap;
  label: string;
  value: number | null | undefined;
  locale: string;
}) {
  const t = useTranslations("planAdmin");
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-muted-foreground flex items-center gap-1.5">
        <Icon className="size-3.5" aria-hidden />
        {label}
      </span>
      <span className="font-semibold tabular-nums">
        {value === null || value === undefined ? (
          <span className="text-primary inline-flex items-center gap-1">
            <InfinityIcon className="size-3.5" aria-hidden />
            {t("unlimited")}
          </span>
        ) : (
          formatNumber(value, locale)
        )}
      </span>
    </div>
  );
}

function PlanCard({
  plan,
  catalog,
  locale,
  onEdit,
}: {
  plan: PlanCatalogItem;
  catalog: CapabilityCatalog;
  locale: string;
  onEdit: () => void;
}) {
  const t = useTranslations("planAdmin");
  const enabledCaps = new Set(plan.features?.capabilities ?? []);
  const limits = plan.features?.limits ?? {};
  const allCaps = Object.entries(catalog.capabilities);

  return (
    <div className="from-primary/[0.06] via-card to-card relative flex flex-col gap-4 overflow-hidden rounded-2xl border bg-gradient-to-br p-5 shadow-sm ring-1 ring-foreground/[0.04]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="bg-primary/10 text-primary inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold tracking-wide">
              {plan.code}
            </span>
            {!plan.is_active && (
              <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                {t("inactive")}
              </span>
            )}
          </div>
          <p className="mt-1.5 font-semibold">{plan.name}</p>
        </div>
        <div className="flex items-start gap-2">
          <div className="text-end">
            <p className="text-xl font-bold tracking-tight tabular-nums">
              {formatMoney(
                { amount: plan.price_minor, currency: plan.currency },
                locale,
              )}
            </p>
            <p className="text-muted-foreground text-xs">{t("perMonth")}</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={onEdit}
            aria-label={t("form.editPlan")}
            data-testid={`edit-plan-${plan.code}`}
          >
            <Pencil className="size-3.5" aria-hidden />
          </Button>
        </div>
      </div>

      {/* Limits */}
      <div className="space-y-1.5 border-t pt-3">
        <LimitRow
          icon={GraduationCap}
          label={t("maxStudents")}
          value={limits.maxStudents}
          locale={locale}
        />
        <LimitRow
          icon={UserCog}
          label={t("maxTeachers")}
          value={limits.maxTeachers}
          locale={locale}
        />
      </div>

      {/* Capabilities — show ALL features with on/off state */}
      <div className="border-t pt-3">
        <p className="text-muted-foreground mb-2 text-[10px] font-semibold uppercase tracking-wide">
          {t("capabilities")}
        </p>
        <div className="space-y-1.5">
          {allCaps.map(([key, label]) => {
            const on = enabledCaps.has(key);
            return (
              <div key={key} className="flex items-center gap-2 text-sm">
                {on ? (
                  <CheckCircle2 className="size-4 shrink-0 text-emerald-500" aria-hidden />
                ) : (
                  <XCircle className="text-muted-foreground/40 size-4 shrink-0" aria-hidden />
                )}
                <span className={on ? "font-medium" : "text-muted-foreground"}>
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AddOnCard({
  addOn,
  locale,
  onEdit,
}: {
  addOn: AddOnCatalogItem;
  locale: string;
  onEdit: () => void;
}) {
  const t = useTranslations("planAdmin");
  return (
    <div className="bg-card flex items-center gap-3.5 rounded-xl border p-4 shadow-sm ring-1 ring-foreground/[0.04]">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-600 dark:bg-violet-950/40 dark:text-violet-300">
        <Puzzle className="size-5" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{addOn.name}</p>
        <p
          className="text-muted-foreground truncate font-mono text-xs"
          dir="ltr"
        >
          {addOn.feature_key}
        </p>
      </div>
      <div className="text-end">
        <p className="font-semibold tabular-nums">
          {formatMoney(
            { amount: addOn.price_minor, currency: addOn.currency },
            locale,
          )}
        </p>
        <p className="text-muted-foreground text-[11px]">{t("perMonth")}</p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={onEdit}
        aria-label={t("form.editAddOn")}
        data-testid={`edit-addon-${addOn.code}`}
      >
        <Pencil className="size-3.5" aria-hidden />
      </Button>
    </div>
  );
}

/**
 * Super-Admin plan & add-on catalog (Sprint 9 §8). An organized, card-based overview of the
 * revenue model: every plan with its limits and unlocked capabilities at a glance, plus the
 * add-on catalog and the feature_key each grants. Gated by plan.manage.
 */
export function PlanAdminScreen() {
  const t = useTranslations("planAdmin");
  const locale = useLocale();
  const { can } = useAuth();

  const [plans, setPlans] = useState<PlanCatalogItem[] | null>(null);
  const [addOns, setAddOns] = useState<AddOnCatalogItem[]>([]);
  const [catalog, setCatalog] = useState<CapabilityCatalog | null>(null);
  const [error, setError] = useState(false);

  // Modal state: a value means "open for this item"; `"new"` means create.
  const [planModal, setPlanModal] = useState<PlanCatalogItem | "new" | null>(
    null,
  );
  const [addOnModal, setAddOnModal] = useState<
    AddOnCatalogItem | "new" | null
  >(null);

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
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const afterSave = useCallback(() => {
    setPlanModal(null);
    setAddOnModal(null);
    load();
  }, [load]);

  if (!can("plan.manage")) {
    return <p className="text-muted-foreground text-sm">{t("noPermission")}</p>;
  }

  return (
    <div className="space-y-6">
      {/* Premium hero header */}
      <div className="from-primary/[0.10] via-card to-card relative overflow-hidden rounded-2xl border bg-gradient-to-br p-5 shadow-sm ring-1 ring-foreground/[0.04]">
        <div className="flex items-center gap-3.5">
          <div className="bg-primary/12 text-primary flex size-11 items-center justify-center rounded-xl">
            <Package className="size-5.5" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
            <p className="text-muted-foreground mt-0.5 text-sm">
              {t("subtitle")}
            </p>
          </div>
        </div>
      </div>

      {error && <AlertBanner variant="error" message={t("loadError")} />}

      {/* Plans matrix */}
      <section>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Layers className="text-muted-foreground size-4" aria-hidden />
            {t("plansHeading")}
          </h2>
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={catalog === null}
            onClick={() => setPlanModal("new")}
            data-testid="new-plan"
          >
            <Plus className="size-3.5" aria-hidden />
            {t("form.newPlan")}
          </Button>
        </div>
        {plans === null ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <div
                key={i}
                className="bg-card h-56 animate-pulse rounded-2xl border shadow-sm"
                aria-hidden
              />
            ))}
          </div>
        ) : plans.length === 0 ? (
          <div className="border-border/60 bg-muted/20 rounded-xl border border-dashed p-12 text-center text-sm font-medium">
            {t("noPlans")}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {plans.map((p) => (
              <PlanCard
                key={p.id}
                plan={p}
                catalog={catalog!}
                locale={locale}
                onEdit={() => setPlanModal(p)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Add-ons */}
      <section>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Puzzle className="text-muted-foreground size-4" aria-hidden />
            {t("addOnsHeading")}
          </h2>
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={catalog === null}
            onClick={() => setAddOnModal("new")}
            data-testid="new-addon"
          >
            <Plus className="size-3.5" aria-hidden />
            {t("form.newAddOn")}
          </Button>
        </div>
        {plans === null ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div
                key={i}
                className="bg-card h-[72px] animate-pulse rounded-xl border shadow-sm"
                aria-hidden
              />
            ))}
          </div>
        ) : addOns.length === 0 ? (
          <div className="border-border/60 bg-muted/20 rounded-xl border border-dashed p-8 text-center text-sm font-medium">
            {t("noAddOns")}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {addOns.map((a) => (
              <AddOnCard
                key={a.id}
                addOn={a}
                locale={locale}
                onEdit={() => setAddOnModal(a)}
              />
            ))}
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
