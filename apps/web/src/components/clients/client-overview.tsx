"use client";

import {
  Activity,
  BadgeCheck,
  BookOpenCheck,
  CircleAlert,
  Info,
  LogIn,
  ReceiptText,
  ShieldAlert,
  TriangleAlert,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { Fact, FactList } from "@/components/admin/fact-list";
import { SectionCard } from "@/components/admin/section-card";
import { buttonVariants } from "@/components/ui/button";
import { whatsappStatus, type ClientDetail } from "@/lib/api";
import { formatMoney, formatNumber } from "@/lib/money";
import { daysUntil, formatRelativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import {
  clientTabHref,
  daysSince,
  displayHost,
  featuresOffCount,
  fmtDate,
  isInactive,
  subdomainUrl,
  type ClientTab,
} from "./client-summary";

/**
 * The Overview tab — the page an operator lands on. Read-only by design: what needs a decision (and
 * which tab makes it), whether the client is actually using the system, and the facts that come up
 * on a call, said once. What it holds and pays lives on Subscription & money; this tab only points
 * there. Every writer stays on its own tab (one writer per fact).
 */

interface Issue {
  key: string;
  tone: "crit" | "warn" | "info";
  text: string;
  tab?: ClientTab;
}

const ISSUE_ICON: Record<Issue["tone"], { icon: LucideIcon; className: string }> = {
  crit: { icon: ShieldAlert, className: "text-rose-600 dark:text-rose-400" },
  warn: { icon: TriangleAlert, className: "text-amber-600 dark:text-amber-400" },
  info: { icon: Info, className: "text-blue-600 dark:text-blue-400" },
};
const ISSUE_RANK: Record<Issue["tone"], number> = { crit: 0, warn: 1, info: 2 };

export function ClientOverview({ data, clientId }: { data: ClientDetail; clientId: string }) {
  const t = useTranslations("clients.detail.overview");
  const tu = useTranslations("clients.detail.usage");
  const th = useTranslations("clients.detail.header");
  const ts = useTranslations("clients");
  const tm = useTranslations("clients.modules");
  const locale = useLocale();
  const { client, summary, modules } = data;
  const usage = summary.usage;

  // The one thing the client read cannot say: whether the WhatsApp session is actually up.
  const hasWhatsapp = modules.some((m) => m.module === "WHATSAPP" && m.status === "ACTIVE");
  const [waConnected, setWaConnected] = useState<boolean | null>(null);
  useEffect(() => {
    if (!hasWhatsapp) return;
    let alive = true;
    void whatsappStatus(clientId)
      .then((s) => alive && setWaConnected((s.state ?? "").toLowerCase() === "connected"))
      .catch(() => alive && setWaConnected(null));
    return () => {
      alive = false;
    };
  }, [clientId, hasWhatsapp]);

  const address = subdomainUrl(client.subdomain);

  const issues = useMemo<Issue[]>(() => {
    const n = (value: number) => formatNumber(value, locale);
    const list: Issue[] = [];
    if (client.status === "SUSPENDED") {
      list.push({ key: "suspended", tone: "crit", text: t("issue.suspended") });
    }
    for (const m of modules) {
      const name = tm(m.module);
      if (m.status === "PAUSED") {
        list.push({ key: `paused-${m.module}`, tone: "warn", text: t("issue.paused", { module: name }), tab: "subscription" });
        continue;
      }
      if (m.status !== "ACTIVE") continue;
      if (!m.is_trial) continue;
      const days = daysUntil(m.trial_end);
      if (days === null) continue;
      if (days < 0) {
        list.push({ key: `trial-${m.module}`, tone: "crit", text: t("issue.trialExpired", { module: name }), tab: "subscription" });
      } else if (days === 0) {
        list.push({ key: `trial-${m.module}`, tone: "warn", text: t("issue.trialEndsToday", { module: name }), tab: "subscription" });
      } else if (days <= 7) {
        list.push({
          key: `trial-${m.module}`,
          tone: "warn",
          text: t("issue.trialEnding", { module: name, days: n(days) }),
          tab: "subscription",
        });
      }
    }
    // Money it owes us (the accounts book): late is the loudest thing; due within the week is worth
    // knowing before the call; paid modules with no agreement mean nothing will ever be chased.
    const account = data.account ?? null;
    const paying = modules.some((m) => m.status === "ACTIVE" && !m.is_trial);
    if (account?.has_overdue) {
      list.push({
        key: "payment-late",
        tone: "crit",
        text: t("issue.paymentLate", {
          amount: Object.entries(account.overdue)
            .map(([currency, amount]) => formatMoney({ amount, currency }, locale, { trimZeroDecimals: true }))
            .join(" · "),
        }),
        tab: "subscription",
      });
    } else if (account?.next_due_on) {
      const due = daysUntil(account.next_due_on);
      if (due !== null && due <= 7) {
        list.push({
          key: "payment-soon",
          tone: "info",
          text: t("issue.paymentSoon", {
            days: n(Math.max(0, due)),
            amount: formatMoney({ amount: account.next_due_minor ?? 0, currency: account.next_due_currency ?? client.default_currency }, locale, { trimZeroDecimals: true }),
          }),
          tab: "subscription",
        });
      }
    } else if (!account && paying) {
      list.push({ key: "no-agreement", tone: "warn", text: t("issue.noAgreement"), tab: "subscription" });
    }
    // Nobody signing in is the earliest sign of a cancellation. A WhatsApp-only client has no login.
    if (usage && client.client_type !== "WHATSAPP" && client.status !== "SUSPENDED" && isInactive(usage.last_login_at, client.created_at)) {
      const since = daysSince(usage.last_login_at);
      list.push({
        key: "inactive",
        tone: "warn",
        text: since === null ? t("issue.noLogin") : t("issue.inactive", { days: n(since) }),
      });
    }
    // A WhatsApp-only client has no login and no address by design — neither is missing.
    if (client.client_type !== "WHATSAPP") {
      if (summary.owner === null) {
        list.push({ key: "no-owner", tone: "warn", text: t("issue.noOwner"), tab: "settings" });
      }
      if (address === null) {
        list.push({ key: "no-address", tone: "info", text: t("issue.noAddress"), tab: "settings" });
      }
    }
    const off = featuresOffCount(modules);
    if (off > 0) {
      list.push({ key: "features-off", tone: "info", text: t("issue.featuresOff", { count: n(off) }), tab: "features" });
    }
    if (waConnected === false) {
      list.push({ key: "wa-disconnected", tone: "warn", text: t("issue.waDisconnected"), tab: "connections" });
    }
    return list.sort((a, b) => ISSUE_RANK[a.tone] - ISSUE_RANK[b.tone]);
  }, [client, modules, summary.owner, usage, address, waConnected, t, tm, locale, data.account]);

  const n = (value: number) => formatNumber(value, locale);
  const money = (minor: number, currency: string) =>
    formatMoney({ amount: minor, currency }, locale, { trimZeroDecimals: true });

  const grouping =
    client.invoice_grouping === "PER_GUARDIAN" || client.invoice_grouping === "PER_STUDENT"
      ? t(`grouping.${client.invoice_grouping}`)
      : client.invoice_grouping;

  const lastLogin = usage?.last_login_at ?? null;
  const loginStale = usage !== undefined && isInactive(lastLogin, client.created_at);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3" data-testid="client-overview">
      <div className="space-y-4 lg:col-span-2">
        {/* ── Needs attention ─────────────────────────────────────────────── */}
        <SectionCard icon={CircleAlert} title={t("attentionTitle")} description={t("attentionHint")} flush testId="client-attention">
          {issues.length === 0 ? (
            <p className="flex items-center gap-2 px-5 py-4 text-sm font-medium text-emerald-700 dark:text-emerald-300">
              <BadgeCheck className="size-4 shrink-0" aria-hidden />
              {t("allClear")}
            </p>
          ) : (
            <ul className="divide-y">
              {issues.map((issue) => {
                const { icon: Icon, className } = ISSUE_ICON[issue.tone];
                return (
                  <li key={issue.key} className="flex items-start gap-3 px-5 py-3" data-testid={`issue-${issue.key}`}>
                    <Icon className={cn("mt-0.5 size-4 shrink-0", className)} aria-hidden />
                    <p className="min-w-0 flex-1 text-sm leading-relaxed">{issue.text}</p>
                    {issue.tab && (
                      <Link
                        href={clientTabHref(clientId, issue.tab)}
                        className="text-primary shrink-0 text-xs font-semibold hover:underline"
                      >
                        {t("open")}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>

        {/* ── Is it being used? ───────────────────────────────────────────── */}
        {usage !== undefined && (
          <SectionCard icon={Activity} title={tu("title")} description={tu("hint")} testId="client-usage">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <UsageFact
                Icon={LogIn}
                label={tu("lastLogin")}
                tone={loginStale ? "warn" : "good"}
                value={lastLogin === null ? tu("never") : formatRelativeTime(lastLogin, locale)}
                sub={lastLogin === null ? undefined : fmtDate(lastLogin, locale)}
                testId="usage-last-login"
              />
              <UsageFact
                Icon={BookOpenCheck}
                label={tu("lessons")}
                tone={usage.lessons_this_month === 0 ? "warn" : "neutral"}
                value={n(usage.lessons_this_month)}
                testId="usage-lessons"
              />
              <UsageFact
                Icon={ReceiptText}
                label={tu("unpaid")}
                tone={data.account?.has_overdue ? "crit" : "neutral"}
                value={
                  !data.account
                    ? tu("noAgreement")
                    : Object.values(data.account.outstanding).every((v) => v <= 0)
                      ? tu("unpaidNone")
                      : Object.entries(data.account.outstanding)
                          .filter(([, v]) => v > 0)
                          .map(([currency, amount]) => money(amount, currency))
                          .join(" · ")
                }
                sub={
                  data.account?.has_overdue
                    ? tu("overdueAmount", {
                        amount: Object.entries(data.account.overdue)
                          .map(([currency, amount]) => money(amount, currency))
                          .join(" · "),
                      })
                    : data.account?.next_due_on
                      ? tu("nextDue", { date: fmtDate(data.account.next_due_on, locale) })
                      : undefined
                }
                href={clientTabHref(clientId, "subscription")}
                testId="usage-unpaid"
              />
            </div>
          </SectionCard>
        )}
      </div>

      {/* ── Details: every fact for a call, said once ─────────────────────── */}
      <SectionCard
        icon={UserRound}
        title={t("detailsTitle")}
        action={
          <Link href={clientTabHref(clientId, "settings")} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
            {t("edit")}
          </Link>
        }
        testId="client-details"
      >
        <FactList>
          <Fact label={t("owner")} testId="fact-owner">
            {summary.owner ? (
              <>
                <span className="block">{summary.owner.full_name}</span>
                <span className="text-muted-foreground block text-xs font-normal" dir="ltr">
                  {summary.owner.email}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground font-normal italic">{t("ownerNone")}</span>
            )}
          </Fact>
          {summary.owner?.phone && (
            <Fact label={t("phone")} mono>
              <span dir="ltr">{summary.owner.phone}</span>
            </Fact>
          )}
          <Fact label={t("clientType")}>{ts(`type.${client.client_type}`)}</Fact>
          {client.client_type === "MANAGEMENT" && <Fact label={t("profile")}>{th(`profile.${data.profile ?? "QURAN"}`)}</Fact>}
          <Fact label={t("address")} mono={address !== null}>
            {address !== null ? (
              <a href={address} target="_blank" rel="noreferrer" className="text-primary break-all hover:underline">
                {displayHost(address)}
              </a>
            ) : (
              <span className="text-muted-foreground font-normal italic">{t("addressNone")}</span>
            )}
          </Fact>
          <Fact label={t("currency")} mono>
            {client.default_currency}
          </Fact>
          <Fact label={t("timezone")} mono>
            {client.timezone}
          </Fact>
          <Fact label={t("billingDay")}>{t("billingDayValue", { day: n(client.billing_day) })}</Fact>
          <Fact label={t("invoiceGrouping")}>{grouping}</Fact>
          <Fact label={t("created")}>{fmtDate(client.created_at, locale)}</Fact>
        </FactList>
      </SectionCard>
    </div>
  );
}

const USAGE_TONE = {
  good: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  warn: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  crit: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  neutral: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
} as const;

/** One usage signal: a pastel tile whose colour is the verdict, the figure, and its detail. */
function UsageFact({
  Icon,
  label,
  value,
  sub,
  tone,
  href,
  testId,
}: {
  Icon: LucideIcon;
  label: string;
  value: string;
  sub?: string;
  tone: keyof typeof USAGE_TONE;
  href?: string;
  testId?: string;
}) {
  // The test id rides the body, not the link: it then survives any link wrapper.
  const body = (
    <div className="flex items-start gap-3" data-testid={testId}>
      <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", USAGE_TONE[tone])}>
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-muted-foreground text-xs font-semibold">{label}</p>
        <p className="mt-0.5 text-base font-extrabold tabular-nums">{value}</p>
        {sub && <p className="text-muted-foreground text-xs">{sub}</p>}
      </div>
    </div>
  );
  return href ? (
    <Link href={href} className="hover:bg-muted/50 -m-2 rounded-xl p-2 transition-colors">
      {body}
    </Link>
  ) : (
    body
  );
}
