"use client";

import { Check, CreditCard, Package } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  ApiError,
  getAcademyAddOns,
  getPlanCatalog,
  setAcademyAddOn,
  setAcademyPlan,
  type AcademyAddOnGrant,
  type AddOnCatalogItem,
  type PlanCatalogItem,
} from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * Per-academy plan & add-on assignment (admin panel — Phase 2). Surfaces the already-built
 * `setAcademyPlan` / `setAcademyAddOn` APIs: pick the academy's plan and toggle add-ons on or
 * off. Gated by plan.manage (server Gate is the real control; this is UX only).
 */
export function AcademyPlanManager({
  academyId,
  currentPlanId,
  onPlanChanged,
}: {
  academyId: string;
  currentPlanId: string | null;
  onPlanChanged: () => void;
}) {
  const t = useTranslations("academies.detail");
  const tw = useTranslations("academies.wizard");
  const locale = useLocale();
  const { can } = useAuth();
  const toast = useToast();

  const [plans, setPlans] = useState<PlanCatalogItem[] | null>(null);
  const [addOns, setAddOns] = useState<AddOnCatalogItem[]>([]);
  const [grants, setGrants] = useState<AcademyAddOnGrant[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [catalog, granted] = await Promise.all([
      getPlanCatalog(),
      getAcademyAddOns(academyId),
    ]);
    setPlans(catalog.plans);
    setAddOns(catalog.addOns);
    setGrants(granted.addOns);
  }, [academyId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!can("plan.manage")) return null;

  async function changePlan(planId: string) {
    setBusy(true);
    try {
      await setAcademyPlan(academyId, planId);
      toast.success(t("planChanged"));
      onPlanChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleAddOn(addOnId: string, nextActive: boolean) {
    setBusy(true);
    try {
      await setAcademyAddOn(academyId, addOnId, nextActive);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const isGranted = (addOnId: string) =>
    grants.some((g) => g.add_on_id === addOnId && g.is_active);

  return (
    <section className="space-y-3" data-testid="academy-plan-manager">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Package className="text-muted-foreground size-4" aria-hidden />
        {t("planSection")}
      </h2>

      <div className="space-y-2">
        <span className="text-sm font-medium">{t("changePlan")}</span>
        {plans === null ? (
          <div className="bg-muted h-24 animate-pulse rounded-xl" aria-hidden />
        ) : (
          <div className="grid gap-2" data-testid="plan-tiers">
            {plans.map((p) => {
              const current = p.id === currentPlanId;
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={busy || current}
                  aria-pressed={current}
                  onClick={() => void changePlan(p.id)}
                  data-testid={`plan-tier-${p.code}`}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-xl border p-3 text-start transition-colors",
                    current
                      ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                      : "hover:bg-muted/40 disabled:opacity-60",
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <CreditCard
                        className="text-primary size-4 shrink-0"
                        aria-hidden
                      />
                      <span className="text-sm font-semibold">{p.name}</span>
                      {p.code === "FREE" && (
                        <span className="inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                          {tw("trialBadge")}
                        </span>
                      )}
                    </div>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {p.price_minor === 0
                        ? tw("free")
                        : `${formatMoney({ amount: p.price_minor, currency: p.currency }, locale)}${tw("perMonth")}`}
                      {p.features?.limits?.maxStudents != null &&
                        ` · ${tw("studentsLimit", { count: p.features.limits.maxStudents })}`}
                    </p>
                  </div>
                  {current && (
                    <span className="text-primary inline-flex items-center gap-1 text-xs font-semibold">
                      <Check className="size-3.5" aria-hidden />
                      {t("currentPlan")}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <span className="text-sm font-medium">{t("addOns")}</span>
        {plans === null ? (
          <div className="bg-muted h-12 animate-pulse rounded-lg" aria-hidden />
        ) : addOns.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("noAddOns")}</p>
        ) : (
          <div className="space-y-2">
            {addOns.map((a) => {
              const granted = isGranted(a.id);
              return (
                <div
                  key={a.id}
                  className="bg-muted/30 flex items-center justify-between gap-3 rounded-lg px-3 py-2.5"
                  data-addon={a.id}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{a.name}</p>
                    <p
                      className="text-muted-foreground truncate font-mono text-xs"
                      dir="ltr"
                    >
                      {a.feature_key}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="xs"
                    variant={granted ? "destructive" : "outline"}
                    disabled={busy}
                    onClick={() => void toggleAddOn(a.id, !granted)}
                    data-testid={`addon-toggle-${a.code}`}
                  >
                    {granted ? t("addOnRevoke") : t("addOnGrant")}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
