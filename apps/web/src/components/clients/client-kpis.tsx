"use client";

import { Blocks, CalendarClock, Users, Wallet } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { StatTile } from "@/components/admin/stat-tile";
import type { ClientDetail } from "@/lib/api";
import { formatNumber } from "@/lib/money";
import { daysUntil } from "@/lib/time";
import {
  fmtDate,
  nextUpcoming,
  revenueBuckets,
  revenueLabel,
} from "./client-summary";

type Tone = "good" | "warn" | "crit" | "neutral";

/**
 * The four numbers that answer "how is this client doing?" before any tab is opened: what it
 * pays us, how much of what it could hold it does hold, how big it is, and the next clock that
 * will ring. All derived from the client read — the tiles never fetch.
 */
export function ClientKpis({ data }: { data: ClientDetail }) {
  const t = useTranslations("clients.detail.kpi");
  const tm = useTranslations("clients.modules");
  const tsubs = useTranslations("clients.subs");
  const locale = useLocale();
  const { modules, catalog, summary } = data;

  // Revenue
  const revenue = revenueLabel(revenueBuckets(modules), locale, (interval) =>
    tsubs(interval === "YEARLY" ? "perYearSuffix" : "perMonthSuffix"),
  );
  const active = modules.filter((m) => m.status === "ACTIVE");
  const paid = active.filter((m) => !m.is_trial);
  const trials = active.filter((m) => m.is_trial);
  const paused = modules.filter((m) => m.status === "PAUSED");
  const total = catalog.allowedModules.length;

  let revenueSub = t("revenueNone");
  let revenueTone: Tone = "neutral";
  if (paid.length > 0) {
    revenueSub = t("revenuePaid", { count: paid.length });
    revenueTone = "good";
  } else if (trials.length > 0) {
    revenueSub = t("revenueTrial");
    revenueTone = "warn";
  }

  // Modules
  const soonestTrial = trials
    .map((m) => ({ module: m.module, days: daysUntil(m.trial_end) }))
    .filter(
      (x): x is { module: (typeof x)["module"]; days: number } =>
        x.days !== null,
    )
    .sort((a, b) => a.days - b.days)[0];
  let modulesSub: string;
  let modulesTone: Tone;
  if (soonestTrial !== undefined) {
    modulesSub =
      soonestTrial.days >= 0
        ? t("modulesTrial", {
            module: tm(soonestTrial.module),
            days: soonestTrial.days,
          })
        : t("modulesTrialExpired", { module: tm(soonestTrial.module) });
    modulesTone = soonestTrial.days >= 0 ? "warn" : "crit";
  } else if (paused.length > 0) {
    modulesSub = t("modulesPaused", { count: paused.length });
    modulesTone = "neutral";
  } else if (active.length === 0) {
    modulesSub = t("modulesNone");
    modulesTone = "neutral";
  } else {
    modulesSub = t("modulesAllOn");
    modulesTone = "good";
  }

  // Next date
  const upcoming = nextUpcoming(modules);
  let upcomingSub = t("upcomingNone");
  let upcomingTone: Tone = "neutral";
  if (upcoming !== null) {
    const name = tm(upcoming.module);
    const days = Math.abs(upcoming.days);
    if (upcoming.trial) {
      upcomingSub =
        upcoming.days > 0
          ? t("trialEnds", { module: name, days })
          : upcoming.days === 0
            ? t("trialEndsToday", { module: name })
            : t("trialEnded", { module: name, days });
    } else {
      upcomingSub =
        upcoming.days > 0
          ? t("renewal", { module: name, days })
          : upcoming.days === 0
            ? t("renewalToday", { module: name })
            : t("renewalOverdue", { module: name, days });
    }
    upcomingTone =
      upcoming.days < 0 ? "crit" : upcoming.days <= 7 ? "warn" : "neutral";
  }

  return (
    <div
      className="grid grid-cols-2 gap-3 lg:grid-cols-4"
      data-testid="client-kpis"
    >
      <StatTile
        label={t("revenue")}
        value={revenue === "" ? "—" : revenue}
        sub={revenueSub}
        subTone={revenueTone}
        icon={Wallet}
        testId="kpi-revenue"
      />
      <StatTile
        label={t("modules")}
        value={t("modulesOf", { active: active.length, total })}
        sub={modulesSub}
        subTone={modulesTone}
        icon={Blocks}
        testId="kpi-modules"
      />
      <StatTile
        label={t("students")}
        value={formatNumber(summary.student_count, locale)}
        sub={t("teachers", {
          count: formatNumber(summary.teacher_count, locale),
        })}
        icon={Users}
        testId="kpi-people"
      />
      <StatTile
        label={t("upcoming")}
        value={upcoming === null ? "—" : fmtDate(upcoming.date, locale)}
        sub={upcomingSub}
        subTone={upcomingTone}
        icon={CalendarClock}
        testId="kpi-upcoming"
      />
    </div>
  );
}
