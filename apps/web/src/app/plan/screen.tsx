"use client";

import {
  CheckCircle2,
  GraduationCap,
  Infinity as InfinityIcon,
  Puzzle,
  Sparkles,
  UserCog,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import {
  UnlockChip,
  UpgradePrompt,
} from "@/components/entitlements/upgrade-prompt";
import { AlertBanner } from "@/components/ui/alert";
import { getEntitlements, type Entitlements } from "@/lib/api";
import { formatNumber } from "@/lib/money";
import { cn } from "@/lib/utils";

// PRO capabilities the platform sells; shown as "unlocked" or "locked" against the plan.
const PRO_CAPABILITIES = ["audit.full", "report_field.custom"] as const;

function UsageCard({
  icon: Icon,
  label,
  used,
  limit,
  locale,
}: {
  icon: typeof GraduationCap;
  label: string;
  used: number;
  limit: number | null;
  locale: string;
}) {
  const t = useTranslations("entitlements");
  const unlimited = limit === null;
  const pct = unlimited ? 0 : Math.min(100, Math.round((used / limit) * 100));
  const atLimit = !unlimited && used >= limit;
  const near = !unlimited && !atLimit && pct >= 80;

  return (
    <div className="bg-card rounded-xl border p-4 shadow-sm ring-1 ring-foreground/[0.04]">
      <div className="flex items-center gap-3">
        <div className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-lg">
          <Icon className="size-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-muted-foreground text-xs font-medium">{label}</p>
          <p className="text-xl font-bold tracking-tight tabular-nums">
            {formatNumber(used, locale)}
            <span className="text-muted-foreground text-sm font-medium">
              {" / "}
              {unlimited ? (
                <InfinityIcon
                  className="inline size-4 align-middle"
                  aria-hidden
                />
              ) : (
                formatNumber(limit, locale)
              )}
            </span>
          </p>
        </div>
        {atLimit && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            {t("atLimit")}
          </span>
        )}
      </div>
      {!unlimited && (
        <div className="bg-muted mt-3 h-1.5 overflow-hidden rounded-full">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              atLimit ? "bg-amber-500" : near ? "bg-amber-400" : "bg-primary",
            )}
            style={{ width: `${Math.max(pct, used > 0 ? 6 : 0)}%` }}
            aria-hidden
          />
        </div>
      )}
    </div>
  );
}

/**
 * Owner "My Plan" screen (Sprint 9 §4) — the plan-gating surface as an UPSELL, not a wall.
 * Shows the current plan, live usage against numeric limits (with at-limit cues), active
 * add-ons, and the PRO features still locked (a polished upgrade prompt). Everything here is
 * read from GET /api/entitlements, the same resolution the server gates with.
 */
export function PlanScreen() {
  const t = useTranslations("entitlements");
  const locale = useLocale();
  const { session } = useAuth();

  const [data, setData] = useState<Entitlements | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    setError(false);
    setData(null);
    getEntitlements()
      .then(setData)
      .catch(() => setError(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // A Super Admin outside an academy has no plan to show.
  if (session?.role === "SUPER_ADMIN" && session.academyId === null) {
    return (
      <p className="text-muted-foreground text-sm">{t("noAcademyScope")}</p>
    );
  }

  if (error) {
    return (
      <AlertBanner
        variant="error"
        message={t("loadError")}
        onDismiss={undefined}
      />
    );
  }

  const locked = data
    ? PRO_CAPABILITIES.filter((c) => !data.capabilities.includes(c))
    : [];

  return (
    <div className="space-y-6">
      {/* Premium hero header */}
      <div className="from-primary/[0.10] via-card to-card relative overflow-hidden rounded-2xl border bg-gradient-to-br p-5 shadow-sm ring-1 ring-foreground/[0.04]">
        <div className="flex items-center gap-3.5">
          <div className="bg-primary/12 text-primary flex size-11 items-center justify-center rounded-xl">
            <Sparkles className="size-5.5" aria-hidden />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
            <p className="text-muted-foreground mt-0.5 text-sm">
              {t("subtitle")}
            </p>
          </div>
          {data && (
            <span className="bg-primary/10 text-primary ms-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-bold tracking-wide">
              {data.plan ?? t("noPlan")}
            </span>
          )}
        </div>
      </div>

      {/* Loading skeleton */}
      {!data ? (
        <div className="space-y-6" aria-busy>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div
                key={i}
                className="bg-card h-[92px] animate-pulse rounded-xl border shadow-sm"
                aria-hidden
              />
            ))}
          </div>
          <div
            className="bg-card h-40 animate-pulse rounded-2xl border shadow-sm"
            aria-hidden
          />
        </div>
      ) : (
        <>
          {/* Usage vs limits */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <UsageCard
              icon={GraduationCap}
              label={t("students")}
              used={data.usage.students ?? 0}
              limit={data.limits.maxStudents ?? null}
              locale={locale}
            />
            <UsageCard
              icon={UserCog}
              label={t("teachers")}
              used={data.usage.teachers ?? 0}
              limit={data.limits.maxTeachers ?? null}
              locale={locale}
            />
          </div>

          {/* Active add-ons */}
          {data.addOns.length > 0 && (
            <div className="bg-card rounded-2xl border p-5 shadow-sm ring-1 ring-foreground/[0.04]">
              <div className="mb-3 flex items-center gap-2">
                <Puzzle className="text-primary size-4" aria-hidden />
                <h2 className="text-sm font-semibold">{t("activeAddOns")}</h2>
              </div>
              <div className="flex flex-wrap gap-2">
                {data.addOns.map((key) => (
                  <span
                    key={key}
                    className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                  >
                    <CheckCircle2 className="size-3.5" aria-hidden />
                    {key}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Locked PRO features → upgrade upsell */}
          {locked.length > 0 ? (
            <UpgradePrompt
              unlocks={locked.map((c) => (
                <UnlockChip key={c}>{t(`feature.${c}`)}</UnlockChip>
              ))}
            />
          ) : (
            <div className="flex items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm font-medium text-emerald-800 dark:border-emerald-800/40 dark:bg-emerald-950/30 dark:text-emerald-200">
              <CheckCircle2 className="size-4" aria-hidden />
              {t("allUnlocked")}
            </div>
          )}
        </>
      )}
    </div>
  );
}
