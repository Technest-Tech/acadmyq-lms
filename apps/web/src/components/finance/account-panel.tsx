"use client";

import {
  CalendarClock,
  Coins,
  Copy,
  FileSignature,
  ListChecks,
  MessageCircle,
  Plus,
  ReceiptText,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { SectionCard, SectionCardFooter } from "@/components/admin/section-card";
import { StatusChip } from "@/components/admin/status-chip";
import { Button, buttonVariants } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { AccountPayload } from "@/lib/api";
import { cn } from "@/lib/utils";
import { discountPct, PLAN_TONE, sumLabel, waLink } from "./account-format";
import { AgreementFormModal, type AgreementTarget } from "./agreement-form-modal";
import { ClientPaymentModal } from "./client-payment-modal";
import { DealFormModal } from "./deal-form-modal";
import { daysBetween, DEAL_TONE, dueTone, formatDay, INSTALLMENT_TONE, money, todayIso } from "./finance-format";
import { ProofList } from "./proof-list";

/**
 * One client's money, in one place (Accounts, 2026-11-08): the agreement and what it costs, what
 * falls due next and what is late, proofs waiting for a yes/no, every line of the agreement and
 * the money received. The client page's Subscription tab and an off-platform client's account
 * page both render exactly this, so there is one way to read — and change — what a client pays.
 */
export function AccountPanel({
  payload,
  target,
  onChanged,
}: {
  /** Null = no agreement yet (a platform client before its first one). */
  payload: AccountPayload | null;
  /** Who a new/changed agreement is for. */
  target: AgreementTarget;
  onChanged: (payload?: AccountPayload) => void;
}) {
  const t = useTranslations("accounts.panel");
  const ta = useTranslations("accounts.agreement");
  const tf = useTranslations("finance");
  const locale = useLocale();
  const toast = useToast();
  const [agreementOpen, setAgreementOpen] = useState(false);
  const [paying, setPaying] = useState(false);
  const [extraOpen, setExtraOpen] = useState(false);

  const account = payload?.account ?? null;
  const today = todayIso();

  const activeDeals = useMemo(() => (payload?.deals ?? []).filter((d) => d.status === "ACTIVE"), [payload]);
  const recurring = activeDeals.find((d) => d.kind === "SUBSCRIPTION" && !d.ends_on) ?? null;
  const purchases = activeDeals.filter((d) => d.kind === "ONE_TIME");

  /** Every open due across the active lines, oldest first. */
  const openDues = useMemo(
    () =>
      activeDeals
        .flatMap((d) => d.schedule.filter((s) => s.remaining_minor > 0).map((s) => ({ ...s, title: d.title, currency: d.currency })))
        .sort((a, b) => a.due_on.localeCompare(b.due_on)),
    [activeDeals],
  );

  const agreementTarget: AgreementTarget =
    target.kind === "new" ? target : { ...target, current: account };

  const copyLink = async () => {
    if (!payload) return;
    try {
      await navigator.clipboard.writeText(payload.pay_url);
      toast.success(t("linkCopied"));
    } catch {
      toast.error(payload.pay_url);
    }
  };

  const reminderText = (): string => {
    if (!payload || !account) return "";
    const name = account.academy_name ?? account.name;
    const lines = openDues
      .filter((d) => daysBetween(today, d.due_on) <= 7)
      .map((d) => `• ${d.title}: ${money(d.remaining_minor, d.currency, "ar")} — ${d.due_on}`);
    return [t("waGreeting", { name }), ...(lines.length > 0 ? lines : [t("waNothing")]), t("waLink", { url: payload.pay_url })].join("\n");
  };

  if (!payload || !account) {
    return (
      <>
        <SectionCard icon={FileSignature} title={t("title")} description={t("emptyHint")} testId="account-empty">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-muted-foreground text-sm">{t("empty")}</p>
            <Button onClick={() => setAgreementOpen(true)} data-testid="set-agreement">
              <FileSignature data-icon="inline-start" />
              {t("setAgreement")}
            </Button>
          </div>
        </SectionCard>
        <AgreementFormModal
          open={agreementOpen}
          target={agreementTarget}
          onClose={() => setAgreementOpen(false)}
          onSaved={(p) => {
            setAgreementOpen(false);
            onChanged(p);
          }}
        />
      </>
    );
  }

  const pct = recurring ? discountPct(recurring.amount_minor, recurring.list_amount_minor ?? null) : null;
  const overdue = sumLabel(account.overdue, locale);
  const nextTone = dueTone(account.next_due_on, today);

  return (
    <div className="space-y-4" data-testid="account-panel">
      <SectionCard
        icon={FileSignature}
        title={t("title")}
        action={
          account.plan ? (
            <span data-testid="account-plan">
              <StatusChip tone={PLAN_TONE[account.plan]}>{ta(`plan.${account.plan}`)}</StatusChip>
            </span>
          ) : undefined
        }
        testId="account-agreement"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="min-w-0">
            <p className="text-muted-foreground text-xs font-medium">{t("pays")}</p>
            {recurring ? (
              <p className="mt-1 text-lg font-extrabold break-words tabular-nums" data-testid="account-cycle">
                {money(recurring.amount_minor, recurring.currency, locale)}
                <span className="text-muted-foreground text-sm font-semibold"> / {tf(`intervalShort.${recurring.billing_interval}`)}</span>
              </p>
            ) : (
              <p className="mt-1 text-sm font-semibold">{t("noRecurring")}</p>
            )}
            {pct !== null && recurring?.list_amount_minor ? (
              <p className="text-emerald-700 dark:text-emerald-400 text-xs font-semibold">
                {t("discount", { pct, list: money(recurring.list_amount_minor, recurring.currency, locale) })}
              </p>
            ) : null}
            {purchases.map((d) => (
              <p key={d.id} className="text-muted-foreground mt-1 text-xs break-words">
                {t("purchase", {
                  title: d.title,
                  total: money(d.amount_minor, d.currency, locale),
                  left: money(d.outstanding_minor, d.currency, locale),
                })}
              </p>
            ))}
          </div>
          <div className="min-w-0">
            <p className="text-muted-foreground text-xs font-medium">{t("next")}</p>
            {account.next_due_on ? (
              <>
                <p className={cn("mt-1 text-lg font-extrabold tabular-nums", nextTone === "crit" && "text-rose-600 dark:text-rose-400", nextTone === "warn" && "text-amber-600 dark:text-amber-400")}>
                  {formatDay(account.next_due_on, locale)}
                </p>
                {account.next_due_minor ? (
                  <p className="text-muted-foreground text-xs tabular-nums">{money(account.next_due_minor, account.next_due_currency ?? "EGP", locale)}</p>
                ) : null}
              </>
            ) : (
              <p className="mt-1 text-sm font-semibold text-emerald-700 dark:text-emerald-400">{t("allPaid")}</p>
            )}
          </div>
          <div className="min-w-0">
            <p className="text-muted-foreground text-xs font-medium">{t("late")}</p>
            <p className={cn("mt-1 text-lg font-extrabold break-words tabular-nums", overdue !== "" ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground")} data-testid="account-overdue">
              {overdue !== "" ? overdue : "—"}
            </p>
            <p className="text-muted-foreground text-xs">{t("received", { amount: sumLabel(account.received, locale) || "—" })}</p>
          </div>
        </div>
        <SectionCardFooter className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setPaying(true)} data-testid="account-receive">
            <Coins data-icon="inline-start" />
            {tf("actions.recordPayment")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setAgreementOpen(true)} data-testid="change-agreement">
            <FileSignature data-icon="inline-start" />
            {t("changeAgreement")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => void copyLink()}>
            <Copy data-icon="inline-start" />
            {t("copyLink")}
          </Button>
          {account.phone ? (
            <a href={waLink(account.phone, reminderText())} target="_blank" rel="noopener noreferrer" className={buttonVariants({ size: "sm", variant: "outline" })}>
              <MessageCircle data-icon="inline-start" />
              {t("sendWhatsapp")}
            </a>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => setExtraOpen(true)}>
            <Plus data-icon="inline-start" />
            {t("extraSale")}
          </Button>
        </SectionCardFooter>
      </SectionCard>

      {payload.submissions.some((s) => s.status === "PENDING") && (
        <SectionCard icon={ReceiptText} title={t("proofs")} testId="account-proofs">
          <ProofList proofs={payload.submissions.filter((s) => s.status === "PENDING")} showClient={false} onChanged={() => onChanged()} />
        </SectionCard>
      )}

      <SectionCard icon={CalendarClock} title={t("dues")} description={t("duesHint")} flush testId="account-dues">
        {openDues.length === 0 ? (
          <p className="text-muted-foreground px-5 py-6 text-sm">{t("allPaid")}</p>
        ) : (
          <ul className="divide-y">
            {openDues.slice(0, 12).map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium break-words">{d.title}</p>
                  <p className="text-muted-foreground text-xs tabular-nums">{formatDay(d.due_on, locale)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="font-semibold tabular-nums">{money(d.remaining_minor, d.currency, locale)}</span>
                  <StatusChip tone={INSTALLMENT_TONE[d.status]}>{tf(`installmentStatus.${d.status}`)}</StatusChip>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard icon={ListChecks} title={t("lines")} description={t("linesHint")} flush testId="account-lines">
        <ul className="divide-y">
          {payload.deals.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium break-words">{d.title}</p>
                <p className="text-muted-foreground text-xs">
                  {tf(`service.${d.service}`)} ·{" "}
                  {d.kind === "SUBSCRIPTION" && d.billing_interval
                    ? `${money(d.amount_minor, d.currency, locale)} / ${tf(`intervalShort.${d.billing_interval}`)}`
                    : money(d.amount_minor, d.currency, locale)}
                  {d.ends_on ? ` · ${t("endsOn", { date: formatDay(d.ends_on, locale) })}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {d.outstanding_minor > 0 && (
                  <span className="text-xs font-semibold tabular-nums">{t("left", { amount: money(d.outstanding_minor, d.currency, locale) })}</span>
                )}
                <StatusChip tone={DEAL_TONE[d.status]}>{tf(`dealStatus.${d.status}`)}</StatusChip>
                <Link href={`/admin/accounts/deals/${d.id}`} className="text-primary text-xs font-semibold hover:underline">
                  {t("details")}
                </Link>
              </div>
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard icon={Coins} title={t("payments")} flush testId="account-payments">
        {payload.payments.length === 0 ? (
          <p className="text-muted-foreground px-5 py-6 text-sm">{tf("deal.paymentsEmpty")}</p>
        ) : (
          <ul className="divide-y">
            {payload.payments.slice(0, 10).map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium tabular-nums">{formatDay(p.paid_on, locale)}</p>
                  <p className="text-muted-foreground text-xs break-words">
                    {tf(`method.${p.method}`)} · {p.deal_title}
                    {p.reference ? ` · ${p.reference}` : ""}
                  </p>
                </div>
                <span className="shrink-0 font-semibold text-emerald-700 tabular-nums dark:text-emerald-400">{money(p.amount_minor, p.currency, locale)}</span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <AgreementFormModal
        open={agreementOpen}
        target={agreementTarget}
        onClose={() => setAgreementOpen(false)}
        onSaved={(p) => {
          setAgreementOpen(false);
          onChanged(p);
        }}
      />
      <ClientPaymentModal
        open={paying}
        account={account}
        onClose={() => setPaying(false)}
        onSaved={(p) => {
          setPaying(false);
          onChanged(p);
        }}
      />
      <DealFormModal
        open={extraOpen}
        presetClientId={account.id}
        onClose={() => setExtraOpen(false)}
        onSaved={() => {
          setExtraOpen(false);
          onChanged();
        }}
      />
    </div>
  );
}

