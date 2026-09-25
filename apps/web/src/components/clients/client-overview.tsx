"use client";

import {
  BadgeCheck,
  Blocks,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  GraduationCap,
  Info,
  Link2,
  MessageCircle,
  MonitorPlay,
  Receipt,
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
import { StatusChip, type ChipTone } from "@/components/admin/status-chip";
import { ModuleIcon } from "@/components/clients/module-chips";
import { buttonVariants } from "@/components/ui/button";
import {
  whatsappStatus,
  type ClientDetail,
  type ModuleSubscription,
} from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { daysUntil } from "@/lib/time";
import { cn } from "@/lib/utils";
import {
  clientTabHref,
  displayHost,
  featuresOffCount,
  fmtDate,
  subdomainUrl,
  type ClientTab,
} from "./client-summary";

/**
 * The Overview tab — the page an operator lands on. Read-only by design: it says what needs a
 * decision (and which tab makes it), what the client holds, and the facts that come up on a
 * call. Every writer stays on its own tab (one writer per fact); this tab only points at them.
 */

interface Issue {
  key: string;
  tone: "crit" | "warn" | "info";
  text: string;
  tab?: ClientTab;
}

const ISSUE_ICON: Record<
  Issue["tone"],
  { icon: LucideIcon; className: string }
> = {
  crit: { icon: ShieldAlert, className: "text-rose-600 dark:text-rose-400" },
  warn: {
    icon: TriangleAlert,
    className: "text-amber-600 dark:text-amber-400",
  },
  info: { icon: Info, className: "text-blue-600 dark:text-blue-400" },
};
const ISSUE_RANK: Record<Issue["tone"], number> = { crit: 0, warn: 1, info: 2 };

export function ClientOverview({
  data,
  clientId,
}: {
  data: ClientDetail;
  clientId: string;
}) {
  const t = useTranslations("clients.detail.overview");
  const td = useTranslations("clients.detail");
  const ts = useTranslations("clients");
  const tm = useTranslations("clients.modules");
  const tsubs = useTranslations("clients.subs");
  const locale = useLocale();
  const { client, summary, modules, catalog } = data;

  // The one thing the client read cannot say: whether the WhatsApp session is actually up.
  const hasWhatsapp = modules.some(
    (m) => m.module === "WHATSAPP" && m.status === "ACTIVE",
  );
  const [waConnected, setWaConnected] = useState<boolean | null>(null);
  useEffect(() => {
    if (!hasWhatsapp) return;
    let alive = true;
    void whatsappStatus(clientId)
      .then(
        (s) =>
          alive &&
          setWaConnected((s.state ?? "").toLowerCase() === "connected"),
      )
      .catch(() => alive && setWaConnected(null));
    return () => {
      alive = false;
    };
  }, [clientId, hasWhatsapp]);

  const address = subdomainUrl(client.subdomain);
  const byModule = useMemo(
    () => new Map(modules.map((m) => [m.module, m])),
    [modules],
  );

  const issues = useMemo<Issue[]>(() => {
    const list: Issue[] = [];
    if (client.status === "SUSPENDED") {
      list.push({ key: "suspended", tone: "crit", text: t("issue.suspended") });
    }
    for (const m of modules) {
      const name = tm(m.module);
      if (m.status === "PAUSED") {
        list.push({
          key: `paused-${m.module}`,
          tone: "warn",
          text: t("issue.paused", { module: name }),
          tab: "modules",
        });
        continue;
      }
      if (m.status !== "ACTIVE" || !m.is_trial) continue;
      const days = daysUntil(m.trial_end);
      if (days === null) continue;
      if (days < 0) {
        list.push({
          key: `trial-${m.module}`,
          tone: "crit",
          text: t("issue.trialExpired", { module: name }),
          tab: "modules",
        });
      } else if (days === 0) {
        list.push({
          key: `trial-${m.module}`,
          tone: "warn",
          text: t("issue.trialEndsToday", { module: name }),
          tab: "modules",
        });
      } else if (days <= 7) {
        list.push({
          key: `trial-${m.module}`,
          tone: "warn",
          text: t("issue.trialEnding", { module: name, days }),
          tab: "modules",
        });
      }
    }
    // A WhatsApp-only client has no login and no address by design — neither is missing.
    if (client.client_type !== "WHATSAPP") {
      if (summary.owner === null) {
        list.push({
          key: "no-owner",
          tone: "warn",
          text: t("issue.noOwner"),
          tab: "settings",
        });
      }
      if (address === null) {
        list.push({
          key: "no-address",
          tone: "info",
          text: t("issue.noAddress"),
          tab: "settings",
        });
      }
    }
    const off = featuresOffCount(modules);
    if (off > 0) {
      list.push({
        key: "features-off",
        tone: "info",
        text: t("issue.featuresOff", { count: off }),
        tab: "modules",
      });
    }
    if (waConnected === false) {
      list.push({
        key: "wa-disconnected",
        tone: "warn",
        text: t("issue.waDisconnected"),
        tab: "whatsapp",
      });
    }
    return list.sort((a, b) => ISSUE_RANK[a.tone] - ISSUE_RANK[b.tone]);
  }, [client, modules, summary.owner, address, waConnected, t, tm]);

  const grouping =
    client.invoice_grouping === "PER_GUARDIAN" ||
    client.invoice_grouping === "PER_STUDENT"
      ? t(`grouping.${client.invoice_grouping}`)
      : client.invoice_grouping;

  const links: {
    key: string;
    href: string;
    label: string;
    icon: LucideIcon;
    external?: boolean;
  }[] = [];
  if (address !== null) {
    links.push({
      key: "address",
      href: address,
      label: t(client.client_type === "LMS" ? "linkCourseSite" : "linkSignIn"),
      icon: ExternalLink,
      external: true,
    });
  }
  links.push({
    key: "billing",
    href: clientTabHref(clientId, "billing"),
    label: t("linkBilling"),
    icon: Receipt,
  });
  if (byModule.has("VIDEO")) {
    links.push({
      key: "video",
      href: `/admin/video/${clientId}`,
      label: t("linkVideoOps"),
      icon: MonitorPlay,
    });
  }
  if (byModule.has("LMS")) {
    links.push({
      key: "lms",
      href: `/admin/lms/${clientId}`,
      label: t("linkLmsOps"),
      icon: GraduationCap,
    });
  }
  if (byModule.has("WHATSAPP")) {
    links.push({
      key: "wa",
      href: "/admin/automation",
      label: t("linkWaOps"),
      icon: MessageCircle,
    });
  }

  /** One module's lifecycle as a chip — the same words the Modules card uses for the same row. */
  const moduleState = (
    sub: ModuleSubscription,
  ): { tone: ChipTone; label: string } => {
    if (sub.status === "PAUSED")
      return { tone: "neutral", label: tsubs("paused") };
    if (sub.is_trial) {
      const days = daysUntil(sub.trial_end) ?? 0;
      return days >= 0
        ? { tone: "warn", label: tsubs("trialLeft", { days }) }
        : { tone: "crit", label: tsubs("trialExpired") };
    }
    return { tone: "good", label: tsubs("active") };
  };

  return (
    <div
      className="grid grid-cols-1 gap-4 lg:grid-cols-3"
      data-testid="client-overview"
    >
      <div className="space-y-4 lg:col-span-2">
        {/* ── Needs attention ─────────────────────────────────────────────── */}
        <SectionCard
          icon={CircleAlert}
          title={t("attentionTitle")}
          description={t("attentionHint")}
          flush
          testId="client-attention"
        >
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
                  <li
                    key={issue.key}
                    className="flex items-start gap-3 px-5 py-3"
                    data-testid={`issue-${issue.key}`}
                  >
                    <Icon
                      className={cn("mt-0.5 size-4 shrink-0", className)}
                      aria-hidden
                    />
                    <p className="min-w-0 flex-1 text-sm leading-relaxed">
                      {issue.text}
                    </p>
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

        {/* ── Modules at a glance ─────────────────────────────────────────── */}
        <SectionCard
          icon={Blocks}
          title={t("modulesTitle")}
          description={t("modulesHint")}
          flush
          action={
            <Link
              href={clientTabHref(clientId, "modules")}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              {t("manage")}
            </Link>
          }
          testId="client-modules-summary"
        >
          <ul className="divide-y">
            {catalog.allowedModules.map((code) => {
              const sub = byModule.get(code) ?? null;
              const state = sub === null ? null : moduleState(sub);
              return (
                <li
                  key={code}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5"
                  data-testid={`overview-module-${code}`}
                >
                  <ModuleIcon code={code} />
                  <div className="min-w-0 flex-1 basis-40">
                    <p className="text-sm font-semibold">{tm(code)}</p>
                    <p className="text-muted-foreground truncate text-xs">
                      {td(`moduleHint.${code}`)}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    {state === null ? (
                      <StatusChip tone="neutral">{t("off")}</StatusChip>
                    ) : (
                      <StatusChip tone={state.tone} dot>
                        {state.label}
                      </StatusChip>
                    )}
                    {sub !== null && (
                      <div className="min-w-24 text-end">
                        <p
                          className="text-sm font-semibold tabular-nums"
                          dir="ltr"
                        >
                          {sub.base_price_minor > 0
                            ? formatMoney(
                                {
                                  amount: sub.base_price_minor,
                                  currency: sub.currency,
                                },
                                locale,
                              ) +
                              tsubs(
                                sub.billing_interval === "YEARLY"
                                  ? "perYearSuffix"
                                  : "perMonthSuffix",
                              )
                            : tsubs("free")}
                        </p>
                        <p className="text-muted-foreground text-[11px]">
                          {sub.is_trial
                            ? t("trialEnds", {
                                date: fmtDate(sub.trial_end, locale),
                              })
                            : sub.current_period_end !== null
                              ? t("renews", {
                                  date: fmtDate(sub.current_period_end, locale),
                                })
                              : " "}
                        </p>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </SectionCard>
      </div>

      <div className="space-y-4">
        {/* ── Details ─────────────────────────────────────────────────────── */}
        <SectionCard
          icon={UserRound}
          title={t("detailsTitle")}
          action={
            <Link
              href={clientTabHref(clientId, "settings")}
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
            >
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
                  <span
                    className="text-muted-foreground block text-xs font-normal"
                    dir="ltr"
                  >
                    {summary.owner.email}
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground font-normal italic">
                  {t("ownerNone")}
                </span>
              )}
            </Fact>
            <Fact label={t("clientType")}>
              {ts(`type.${client.client_type}`)}
            </Fact>
            <Fact label={t("address")} mono={address !== null}>
              {address !== null ? (
                <a
                  href={address}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary break-all hover:underline"
                >
                  {displayHost(address)}
                </a>
              ) : (
                <span className="text-muted-foreground font-normal italic">
                  {t("addressNone")}
                </span>
              )}
            </Fact>
            <Fact label={t("currency")} mono>
              {client.default_currency}
            </Fact>
            <Fact label={t("timezone")} mono>
              {client.timezone}
            </Fact>
            <Fact label={t("billingDay")}>
              {t("billingDayValue", { day: client.billing_day })}
            </Fact>
            <Fact label={t("invoiceGrouping")}>{grouping}</Fact>
            <Fact label={t("created")}>
              {fmtDate(client.created_at, locale)}
            </Fact>
          </FactList>
        </SectionCard>

        {/* ── Quick links ─────────────────────────────────────────────────── */}
        <SectionCard
          icon={Link2}
          title={t("linksTitle")}
          flush
          testId="client-links"
        >
          <ul className="divide-y">
            {links.map(({ key, href, label, icon: Icon, external }) => {
              const row = (
                <>
                  <Icon
                    className="text-muted-foreground size-4 shrink-0"
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                  {external ? (
                    <ExternalLink
                      className="text-muted-foreground/60 size-3.5 shrink-0"
                      aria-hidden
                    />
                  ) : (
                    <ChevronRight
                      className="text-muted-foreground/60 size-4 shrink-0 rtl:rotate-180"
                      aria-hidden
                    />
                  )}
                </>
              );
              const rowClass =
                "hover:bg-muted/40 flex items-center gap-3 px-5 py-3 text-sm font-medium transition-colors";
              return (
                <li key={key}>
                  {external ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      className={rowClass}
                    >
                      {row}
                    </a>
                  ) : (
                    <Link href={href} className={rowClass}>
                      {row}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </SectionCard>
      </div>
    </div>
  );
}
