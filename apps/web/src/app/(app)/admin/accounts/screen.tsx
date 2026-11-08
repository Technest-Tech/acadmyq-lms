"use client";

import {
  AlarmClock,
  AlertTriangle,
  BellOff,
  CalendarClock,
  CalendarRange,
  Coins,
  FileWarning,
  Hourglass,
  MessageCircle,
  Plus,
  ReceiptText,
  TrendingUp,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/admin/empty-state";
import { AdminPageHeader } from "@/components/admin/page-header";
import { SectionCard } from "@/components/admin/section-card";
import { StatTile } from "@/components/admin/stat-tile";
import { StatusChip } from "@/components/admin/status-chip";
import { useAuth } from "@/components/auth-provider";
import { accountHref, payUrlFor, waLink } from "@/components/finance/account-format";
import { AccountsTabs } from "@/components/finance/accounts-tabs";
import { AgreementFormModal, type AgreementTarget } from "@/components/finance/agreement-form-modal";
import { ClientPaymentModal, type PayerFacts } from "@/components/finance/client-payment-modal";
import { formatDay, money } from "@/components/finance/finance-format";
import { ProofList } from "@/components/finance/proof-list";
import { Button, buttonVariants } from "@/components/ui/button";
import { getDues, type DuesPayload, type FinanceTotals, type OpenDue } from "@/lib/api";
import { formatNumber } from "@/lib/money";

/** One client's dues in a bucket: the row the owner acts on. */
interface ClientDues {
  clientId: string;
  academyId: string | null;
  name: string;
  phone: string | null;
  payToken: string | null;
  dues: OpenDue[];
  /** currency → what is owed in this bucket */
  totals: Record<string, number>;
  oldest: OpenDue;
}

function groupByClient(dues: OpenDue[]): ClientDues[] {
  const map = new Map<string, ClientDues>();
  for (const d of dues) {
    const row = map.get(d.client_id) ?? {
      clientId: d.client_id,
      academyId: d.academy_id,
      name: d.academy_name ?? d.client_name,
      phone: d.phone,
      payToken: d.pay_token,
      dues: [],
      totals: {},
      oldest: d,
    };
    row.dues.push(d);
    row.totals[d.currency] = (row.totals[d.currency] ?? 0) + d.remaining_minor;
    if (d.due_on < row.oldest.due_on) row.oldest = d;
    map.set(d.client_id, row);
  }
  return [...map.values()];
}

/**
 * Accounts → Dues: the owner's money to-do list and the first screen of Accounts (2026-11-08).
 * Top to bottom it is the order of the day: what came in and what is owed, proofs waiting for a
 * yes/no, who is late (longest first), who pays this week and this month, trials about to end
 * (agree a price) and paying clients with no agreement yet. Every row has its next step — record
 * the money, send a WhatsApp reminder with the pay link, or open the client.
 */
export function AccountsDuesScreen() {
  const t = useTranslations("accounts.dues");
  const ta = useTranslations("accounts");
  const locale = useLocale();
  const { can } = useAuth();
  const [data, setData] = useState<DuesPayload | null>(null);
  const [error, setError] = useState(false);
  const [paying, setPaying] = useState<PayerFacts | null>(null);
  const [agreement, setAgreement] = useState<AgreementTarget | null>(null);

  const load = useCallback(async () => {
    setError(false);
    try {
      setData(await getDues());
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    if (can("platform.manage")) void load();
  }, [load, can]);

  const late = useMemo(() => groupByClient(data?.late ?? []), [data]);
  const week = useMemo(() => groupByClient(data?.week ?? []), [data]);
  const month = useMemo(() => groupByClient(data?.month ?? []), [data]);

  /** The lead currency (most money) first; other currencies ride along in the tile's sub-line. */
  const totals: FinanceTotals[] = useMemo(
    () => [...(data?.totals ?? [])].sort((a, b) => b.total_minor + b.outstanding_minor - (a.total_minor + a.outstanding_minor)),
    [data],
  );
  const lead = totals[0];
  const others = (pick: (x: FinanceTotals) => number) =>
    totals
      .slice(1)
      .filter((x) => pick(x) > 0)
      .map((x) => money(pick(x), x.currency, locale))
      .join(" · ") || undefined;

  if (!can("platform.manage")) {
    return <p className="text-muted-foreground text-sm">{ta("noPermission")}</p>;
  }

  const payerFrom = (row: ClientDues): PayerFacts => ({
    id: row.clientId,
    name: row.name,
    academy_name: null,
    overdue: Object.fromEntries(Object.entries(row.totals).filter(() => row.oldest.days_late > 0)),
    outstanding: row.totals,
    has_overdue: row.oldest.days_late > 0,
    next_due_on: row.oldest.due_on,
    next_due_minor: row.oldest.remaining_minor,
    next_due_currency: row.oldest.currency,
    rec_currency: null,
  });

  const reminder = (row: ClientDues): string => {
    const lines = row.dues.map((d) => `• ${d.title}: ${money(d.remaining_minor, d.currency, "ar")} — ${d.due_on}`);
    const url = payUrlFor(row.payToken);
    return [t("waGreeting", { name: row.name }), ...lines, url ? t("waLink", { url }) : ""].filter(Boolean).join("\n");
  };

  const nothing =
    data !== null &&
    data.late.length + data.week.length + data.month.length + data.proofs.length + data.trials.length + data.unagreed.length === 0;

  const bucket = (rows: ClientDues[], tone: "crit" | "warn" | "neutral", testId: string) => (
    <ul className="divide-y" data-testid={testId}>
      {rows.map((row) => {
        const total = Object.entries(row.totals)
          .map(([c, v]) => money(v, c, locale))
          .join(" · ");
        const days = row.oldest.days_late;
        return (
          <li key={row.clientId} className="flex flex-col gap-2 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between" data-client={row.clientId}>
            <div className="min-w-0">
              <Link href={accountHref({ id: row.clientId, academy_id: row.academyId })} className="hover:text-primary font-semibold break-words hover:underline">
                {row.name}
              </Link>
              <p className="text-muted-foreground text-xs break-words">
                {row.dues.length > 1 ? t("lines", { title: row.oldest.title, count: row.dues.length, n: formatNumber(row.dues.length, locale) }) : row.oldest.title}
                {" · "}
                {formatDay(row.oldest.due_on, locale)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <span className="font-bold tabular-nums">{total}</span>
              <StatusChip tone={tone}>
                {days > 0
                  ? t("daysLate", { count: days, n: formatNumber(days, locale) })
                  : days === 0
                    ? t("dueToday")
                    : t("inDays", { count: -days, n: formatNumber(-days, locale) })}
              </StatusChip>
              <Button size="xs" onClick={() => setPaying(payerFrom(row))} data-testid={`receive-${row.clientId}`}>
                <Coins className="size-3" aria-hidden />
                {t("received")}
              </Button>
              {row.phone ? (
                <a
                  href={waLink(row.phone, reminder(row))}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonVariants({ size: "xs", variant: "outline" })}
                >
                  <MessageCircle className="size-3" aria-hidden />
                  {t("remind")}
                </a>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title={ta("title")}
        subtitle={ta("subtitle")}
        actions={
          <Button onClick={() => setAgreement({ kind: "new" })} data-testid="new-external">
            <Plus data-icon="inline-start" />
            {ta("newExternal")}
          </Button>
        }
      />
      <AccountsTabs />

      {error ? (
        <EmptyState
          icon={AlertTriangle}
          message={ta("loadError")}
          action={
            <Button variant="outline" size="sm" onClick={load}>
              {ta("retry")}
            </Button>
          }
        />
      ) : (
        <>
          {data && !data.reminders.ready && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-300/50 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200" data-testid="reminders-off">
              <BellOff className="size-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">{t("remindersOff")}</span>
              <Link href="/admin/accounts/settings" className="font-semibold underline">
                {t("remindersSetup")}
              </Link>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile icon={Wallet} label={t("kpi.collected")} value={lead ? money(lead.month_minor, lead.currency, locale) : "—"} sub={others((x) => x.month_minor)} loading={data === null} />
            <StatTile
              icon={AlarmClock}
              label={t("kpi.late")}
              value={lead ? money(lead.overdue_minor, lead.currency, locale) : "—"}
              sub={others((x) => x.overdue_minor) ?? t("kpi.lateClients", { count: late.length, n: formatNumber(late.length, locale) })}
              subTone={late.length > 0 ? "crit" : "neutral"}
              loading={data === null}
            />
            <StatTile icon={CalendarRange} label={t("kpi.upcoming")} value={lead ? money(lead.upcoming_minor, lead.currency, locale) : "—"} sub={others((x) => x.upcoming_minor)} loading={data === null} />
            <StatTile icon={TrendingUp} label={t("kpi.runRate")} value={lead ? money(lead.mrr_minor, lead.currency, locale) : "—"} sub={lead ? t("kpi.perYear", { amount: money(lead.mrr_minor * 12, lead.currency, locale) }) : undefined} loading={data === null} />
          </div>

          {nothing && <EmptyState icon={Coins} message={t("nothing")} />}

          {data && data.proofs.length > 0 && (
            <SectionCard icon={ReceiptText} title={t("proofs", { count: data.proofs.length, n: formatNumber(data.proofs.length, locale) })} testId="dues-proofs">
              <ProofList proofs={data.proofs} onChanged={() => void load()} />
            </SectionCard>
          )}

          {late.length > 0 && (
            <SectionCard icon={AlarmClock} title={t("late")} description={t("lateHint")} flush testId="dues-late">
              {bucket(late, "crit", "late-list")}
            </SectionCard>
          )}

          {week.length > 0 && (
            <SectionCard icon={CalendarClock} title={t("week")} flush testId="dues-week">
              {bucket(week, "warn", "week-list")}
            </SectionCard>
          )}

          {month.length > 0 && (
            <SectionCard icon={CalendarRange} title={t("month")} flush testId="dues-month">
              {bucket(month, "neutral", "month-list")}
            </SectionCard>
          )}

          {data && data.trials.length > 0 && (
            <SectionCard icon={Hourglass} title={t("trials")} description={t("trialsHint")} flush testId="dues-trials">
              <ul className="divide-y">
                {data.trials.map((tr) => (
                  <li key={tr.academy_id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                    <Link href={`/admin/clients/${tr.academy_id}?tab=subscription`} className="hover:text-primary min-w-0 font-semibold break-words hover:underline">
                      {tr.name}
                    </Link>
                    <div className="flex items-center gap-2">
                      <StatusChip tone={tr.days < 0 ? "crit" : "warn"}>
                        {tr.days < 0 ? t("trialEnded") : t("trialLeft", { count: tr.days, n: formatNumber(tr.days, locale) })}
                      </StatusChip>
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => setAgreement({ kind: "academy", academyId: tr.academy_id, name: tr.name, inTrial: true, trialEnd: tr.trial_end })}
                      >
                        {t("setAgreement")}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </SectionCard>
          )}

          {data && data.unagreed.length > 0 && (
            <SectionCard icon={FileWarning} title={t("unagreed")} description={t("unagreedHint")} flush testId="dues-unagreed">
              <ul className="divide-y">
                {data.unagreed.map((u) => (
                  <li key={u.academy_id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                    <div className="min-w-0">
                      <Link href={`/admin/clients/${u.academy_id}?tab=subscription`} className="hover:text-primary font-semibold break-words hover:underline">
                        {u.name}
                      </Link>
                      {u.suggested_minor > 0 && (
                        <p className="text-muted-foreground text-xs">
                          {t("modulesAt", { amount: money(u.suggested_minor, u.currency, locale), per: t(`per.${u.interval}`) })}
                        </p>
                      )}
                    </div>
                    <Button
                      size="xs"
                      onClick={() =>
                        setAgreement({
                          kind: "academy",
                          academyId: u.academy_id,
                          name: u.name,
                          suggested: { amount_minor: u.suggested_minor, currency: u.currency, interval: u.interval },
                        })
                      }
                      data-testid={`agree-${u.academy_id}`}
                    >
                      {t("setAgreement")}
                    </Button>
                  </li>
                ))}
              </ul>
            </SectionCard>
          )}
        </>
      )}

      <ClientPaymentModal
        open={paying !== null}
        account={paying}
        onClose={() => setPaying(null)}
        onSaved={() => {
          setPaying(null);
          void load();
        }}
      />
      <AgreementFormModal
        open={agreement !== null}
        target={agreement}
        onClose={() => setAgreement(null)}
        onSaved={() => {
          setAgreement(null);
          void load();
        }}
      />
    </div>
  );
}
