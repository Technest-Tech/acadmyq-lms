"use client";

import {
  CalendarClock,
  CheckCircle2,
  CreditCard,
  GraduationCap,
  Hourglass,
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
import {
  getEntitlements,
  getMySubscription,
  type AcademySubscription,
  type Entitlements,
} from "@/lib/api";
import { formatMoney, formatNumber } from "@/lib/money";
import { cn } from "@/lib/utils";

// PRO-only capabilities the platform sells; shown as "unlocked" or "locked" against the plan.
// These are the features BASIC does not include (see DemoAcademySeeder plan catalog).
const PRO_CAPABILITIES = [
  "staff",
  "custom_roles",
  "trials",
  "certificates",
  "student_reports",
  "audit.full",
  "report_field.custom",
] as const;

/** Whole days from now until an ISO date (negative once past), or null when unset. */
function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

function DatePill({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof CalendarClock;
  label: string;
  value: string;
}) {
  return (
    <div className="bg-background/60 rounded-xl border p-3">
      <p className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
        {label}
      </p>
      <p className="mt-0.5 flex items-center gap-1.5 text-sm font-semibold">
        <Icon className="text-muted-foreground size-3.5" aria-hidden />
        {value}
      </p>
    </div>
  );
}

/**
 * The headline subscription card on the owner's My Plan screen: a trial countdown (with a
 * progress bar and end date) or the live paid-subscription state (cost breakdown + renewal),
 * read from GET /my-subscription.
 */
function SubscriptionCard({
  sub,
  locale,
}: {
  sub: AcademySubscription;
  locale: string;
}) {
  const t = useTranslations("entitlements");
  const ts = useTranslations("academySubscription");

  const fmtDate = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString(locale === "ar" ? "ar" : locale, {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : "—";
  const money = (minor: number) =>
    formatMoney({ amount: minor, currency: sub.currency }, locale);

  const expired = sub.status === "PAUSED";
  const isTrial = sub.is_trial && !expired;
  const trialDays = isTrial ? (daysUntil(sub.trial_end) ?? 0) : 0;

  // Trial progress (elapsed vs the full trial window) for the bar.
  const trialTotal =
    sub.trial_start && sub.trial_end
      ? Math.max(
          1,
          Math.round(
            (new Date(sub.trial_end).getTime() -
              new Date(sub.trial_start).getTime()) /
              86_400_000,
          ),
        )
      : null;
  const pct =
    trialTotal !== null
      ? Math.min(
          100,
          Math.max(0, Math.round(((trialTotal - trialDays) / trialTotal) * 100)),
        )
      : 0;

  const tone = expired
    ? "from-rose-500/[0.10] border-rose-300/50"
    : isTrial
      ? "from-amber-500/[0.10] border-amber-300/50"
      : "from-emerald-500/[0.10] border-emerald-300/50";

  const badge = expired
    ? "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
    : isTrial
      ? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
      : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300";

  return (
    <div
      data-testid="subscription-card"
      className={cn(
        "via-card to-card relative overflow-hidden rounded-2xl border bg-gradient-to-br p-5 shadow-sm ring-1 ring-foreground/[0.04]",
        tone,
      )}
    >
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <CreditCard className="text-muted-foreground size-4" aria-hidden />
          {ts("title")}
        </h2>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
            badge,
          )}
        >
          {(isTrial || expired) && <Hourglass className="size-3" aria-hidden />}
          {expired
            ? ts("status.PAUSED")
            : isTrial
              ? ts("trial")
              : ts(`status.${sub.status}`)}
        </span>
      </div>

      {/* Trial countdown */}
      {isTrial ? (
        <div className="space-y-3">
          <div className="flex items-end justify-between gap-2">
            <span className="text-3xl font-bold tracking-tight tabular-nums">
              {t("trialDaysLeft", { days: Math.max(0, trialDays) })}
            </span>
            <span className="text-muted-foreground text-sm">
              {t("trialEndsOn", { date: fmtDate(sub.trial_end) })}
            </span>
          </div>
          <div className="bg-muted h-2 overflow-hidden rounded-full">
            <div
              className="h-full rounded-full bg-amber-500 transition-all"
              style={{ width: `${pct}%` }}
              aria-hidden
            />
          </div>
          <p className="text-muted-foreground text-xs">{t("trialConvertHint")}</p>
        </div>
      ) : expired ? (
        <div className="space-y-1">
          <p className="text-lg font-bold tracking-tight">{t("trialExpired")}</p>
          <p className="text-muted-foreground text-sm">{t("trialExpiredHint")}</p>
        </div>
      ) : (
        /* Paid subscription */
        <div className="space-y-4">
          <div className="flex items-end gap-1.5">
            <span className="text-3xl font-bold tracking-tight tabular-nums">
              {money(sub.total_cost_minor)}
            </span>
            <span className="text-muted-foreground pb-1 text-sm">
              /{ts(`interval.${sub.billing_interval}`)}
            </span>
          </div>

          {/* Cost breakdown (only when add-ons add to the base). */}
          {sub.addons_price_minor > 0 && (
            <div className="text-muted-foreground space-y-1 text-xs">
              <div className="flex items-center justify-between">
                <span>{ts("basePrice")}</span>
                <span dir="ltr">{money(sub.base_price_minor)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>{ts("addOns")}</span>
                <span dir="ltr">{money(sub.addons_price_minor)}</span>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <DatePill
              icon={CalendarClock}
              label={t("activatedOn")}
              value={fmtDate(sub.activated_at)}
            />
            <DatePill
              icon={CalendarClock}
              label={t("renewsOn")}
              value={fmtDate(sub.current_period_end)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

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
 * Headlines the live subscription state (trial countdown or paid renewal + cost), then shows
 * usage against numeric limits, active add-ons, and the PRO features still locked. Reads
 * GET /api/entitlements (gating) + GET /my-subscription (lifecycle/cost).
 */
export function PlanScreen() {
  const t = useTranslations("entitlements");
  const locale = useLocale();
  const { session } = useAuth();

  const [data, setData] = useState<Entitlements | null>(null);
  const [sub, setSub] = useState<AcademySubscription | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    setError(false);
    setData(null);
    getEntitlements()
      .then(setData)
      .catch(() => setError(true));
    // Subscription is supplementary — a failure just hides the lifecycle card.
    getMySubscription()
      .then((r) => setSub(r.subscription))
      .catch(() => setSub(null));
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
              {data.plan === "FREE"
                ? t("freeTrial")
                : (data.plan ?? t("noPlan"))}
            </span>
          )}
        </div>
      </div>

      {/* Loading skeleton */}
      {!data ? (
        <div className="space-y-6" aria-busy>
          <div
            className="bg-card h-40 animate-pulse rounded-2xl border shadow-sm"
            aria-hidden
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div
                key={i}
                className="bg-card h-[92px] animate-pulse rounded-xl border shadow-sm"
                aria-hidden
              />
            ))}
          </div>
        </div>
      ) : (
        <>
          {/* Subscription lifecycle (trial countdown / paid renewal + cost) */}
          {sub && <SubscriptionCard sub={sub} locale={locale} />}

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
