"use client";

import { LogIn, ReceiptText, Users, Wallet } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { StatTile } from "@/components/admin/stat-tile";
import type { ClientDetail } from "@/lib/api";
import { formatMoney, formatNumber } from "@/lib/money";
import { formatRelativeTime } from "@/lib/time";
import { agreementPrice, daysSince, fmtDate, isInactive } from "./client-summary";

type Tone = "good" | "warn" | "crit" | "neutral";

/**
 * The four numbers that answer "how is this client doing?" before any tab is opened: what it pays
 * us, what it still owes us, how big it is and how much it teaches, and when anyone last signed in.
 * What it holds and when its clocks ring live on the header's module tags and its banner. All
 * derived from the client read — the tiles never fetch.
 */
export function ClientKpis({ data }: { data: ClientDetail }) {
  const t = useTranslations("clients.detail.kpi");
  const tf = useTranslations("finance");
  const tg = useTranslations("accounts.agreement");
  const locale = useLocale();
  const { modules, summary, client } = data;
  const usage = summary.usage;
  const n = (value: number) => formatNumber(value, locale);

  // What it pays and what it owes — both from its account in the book.
  const account = data.account ?? null;
  const active = modules.filter((m) => m.status === "ACTIVE");
  const trials = active.filter((m) => m.is_trial);
  const price = agreementPrice(account, locale, (interval) => tf(`intervalShort.${interval}`));
  const revenue = price !== "" ? price : account?.plan ? tg(`plan.${account.plan}`) : "";
  let revenueSub = t("revenueNone");
  let revenueTone: Tone = "neutral";
  if (account?.plan) {
    revenueSub = tg(`plan.${account.plan}`);
    revenueTone = "good";
  } else if (trials.length > 0) {
    revenueSub = t("revenueTrial");
    revenueTone = "warn";
  }

  const owing = Object.entries(account?.outstanding ?? {}).filter(([, v]) => v > 0);
  const owed =
    account === null
      ? "—"
      : owing.length === 0
        ? formatMoney({ amount: 0, currency: client.default_currency }, locale, { trimZeroDecimals: true })
        : owing.map(([currency, amount]) => formatMoney({ amount, currency }, locale, { trimZeroDecimals: true })).join(" · ");
  const owedSub =
    account === null
      ? undefined
      : account.has_overdue
        ? t("unpaidOverdue", {
            amount: Object.entries(account.overdue)
              .map(([currency, amount]) => formatMoney({ amount, currency }, locale, { trimZeroDecimals: true }))
              .join(" · "),
          })
        : account.next_due_on
          ? t("unpaidNext", { date: fmtDate(account.next_due_on, locale) })
          : t("unpaidNone");
  const owedTone: Tone = account === null ? "neutral" : account.has_overdue ? "crit" : owing.length > 0 ? "warn" : "good";

  // When anyone last signed in
  const lastLogin = usage?.last_login_at ?? null;
  const stale = usage !== undefined && isInactive(lastLogin, client.created_at);
  const since = daysSince(lastLogin);

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="client-kpis">
      <StatTile
        label={t("revenue")}
        value={revenue === "" ? "—" : revenue}
        sub={revenueSub}
        subTone={revenueTone}
        icon={Wallet}
        testId="kpi-revenue"
      />
      <StatTile label={t("unpaid")} value={owed} sub={owedSub} subTone={owedTone} icon={ReceiptText} testId="kpi-unpaid" />
      <StatTile
        label={t("students")}
        value={n(summary.student_count)}
        sub={[
          t("teachers", { count: n(summary.teacher_count) }),
          usage === undefined ? null : t("lessons", { count: n(usage.lessons_this_month) }),
        ]
          .filter(Boolean)
          .join(" · ")}
        icon={Users}
        testId="kpi-people"
      />
      <StatTile
        label={t("lastLogin")}
        // `auto`: an Arabic "منذ ٣ أيام" is not a left-to-right figure.
        value={<span dir="auto">{lastLogin === null ? t("lastLoginNever") : formatRelativeTime(lastLogin, locale)}</span>}
        sub={
          usage === undefined
            ? undefined
            : stale
              ? since === null
                ? t("lastLoginNever")
                : t("lastLoginStale", { days: n(since) })
              : t("lastLoginFresh")
        }
        subTone={usage === undefined ? "neutral" : stale ? "warn" : "good"}
        icon={LogIn}
        testId="kpi-login"
      />
    </div>
  );
}
