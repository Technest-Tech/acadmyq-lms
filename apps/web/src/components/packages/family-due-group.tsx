"use client";

import { AlertTriangle, BellRing, Check, Copy, Link2, Loader2, MessageSquare } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useInvoiceUrl } from "@/components/invoices/use-invoice-url";
import { PackageActions, type PackageActionProps } from "@/components/packages/package-card";
import { createFamilyPayLink, type LessonPackageRow, type PackagePurpose } from "@/lib/api";
import { formatMoney, formatNumber } from "@/lib/money";
import { formatDateTime, formatHours } from "@/lib/time";
import { cn } from "@/lib/utils";

/** One family on the Due page: a parent and every package their children still owe on. */
export interface DueFamily {
  /** The guardian's id — or the student's, for a row that carries no family. */
  key: string;
  /** Null for a row that carries no family — it can have no family link. */
  guardianId: string | null;
  name: string;
  phone: string | null;
  /** The children with a package due, in the order their debts first appear. */
  children: string[];
  rows: LessonPackageRow[];
}

/**
 * Gathers due packages under their family, keeping the order they came in — the page sorts oldest
 * debt first, so a family sits where its oldest debt would.
 */
export function groupDueByFamily(rows: LessonPackageRow[]): DueFamily[] {
  const families = new Map<string, DueFamily>();
  for (const row of rows) {
    const key = row.guardian_id ?? `student:${row.student_id}`;
    let family = families.get(key);
    if (family === undefined) {
      family = {
        key,
        guardianId: row.guardian_id ?? null,
        name: row.guardian_name ?? row.student_name,
        phone: row.guardian_phone ?? null,
        children: [],
        rows: [],
      };
      families.set(key, family);
    }
    family.rows.push(row);
    if (!family.children.includes(row.student_name)) family.children.push(row.student_name);
  }
  return [...families.values()];
}

/** What the family owes, per currency — money is never summed across currencies. */
function owed(rows: LessonPackageRow[]): { currency: string; amount_minor: number }[] {
  const by = new Map<string, number>();
  for (const r of rows) {
    if (r.outstanding_minor > 0) by.set(r.currency, (by.get(r.currency) ?? 0) + r.outstanding_minor);
  }
  return [...by.entries()].map(([currency, amount_minor]) => ({ currency, amount_minor }));
}

function initials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0] ?? "")
      .join("")
      .toUpperCase() || "?"
  );
}

/** The colour a purpose wears: new money green, renewals blue, usage violet, problems amber/rose. */
const PURPOSE_TONE: Record<PackagePurpose, string> = {
  NEW: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  RENEWAL: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  AUTO_RENEWAL: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  USAGE: "bg-violet-500/12 text-violet-700 dark:text-violet-300",
  UNBILLED: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  OVERDRAFT: "bg-rose-500/12 text-rose-700 dark:text-rose-300",
};

/**
 * A family's card on the Due page — sized to its content and laid out in masonry columns, so a
 * one-child family is a short card, not a tall empty one. The parent's name and what the family
 * owes in total lead; each child's package is a line under it (what the money is for, hours and
 * lessons, amount, the leading action and "⋯" — the same actions the full card offers). At the
 * foot: with two bills or more, ONE payment link for the whole family (`/f/{token}`); with one,
 * that bill's own link. Each package keeps its own bill, so paying still marks exactly it paid.
 */
export function FamilyDueGroup({
  family,
  timezone,
  canSendInvoice,
  actionProps,
  onMessageOpened,
}: {
  family: DueFamily;
  timezone: string;
  canSendInvoice: boolean;
  actionProps: (row: LessonPackageRow) => PackageActionProps;
  onMessageOpened: () => void;
}) {
  const t = useTranslations("packages");
  const locale = useLocale();
  const invoiceUrl = useInvoiceUrl();
  const totals = owed(family.rows);
  const payable = family.rows.filter((r) => r.invoice_token !== null && r.outstanding_minor > 0);
  const money = (amount: number, currency: string) => formatMoney({ amount, currency }, locale);
  // Two bills or more under a real family: one link pays them all.
  const familyLink = family.guardianId !== null && payable.length > 1;
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);

  /** The link the parent gets: the family's page, or the one bill's own page. */
  async function link(): Promise<string> {
    if (familyLink && family.guardianId !== null) return (await createFamilyPayLink(family.guardianId)).url;
    return invoiceUrl(payable[0]!.invoice_token as string);
  }

  function message(url: string): string {
    return [
      t("family.messageGreeting", { name: family.name }),
      t("family.messageIntro"),
      "",
      ...payable.map((r) =>
        t("family.messageLine", {
          child: r.student_name,
          purpose: t(`purpose.${r.purpose ?? "NEW"}`),
          label: r.label,
          amount: money(r.outstanding_minor, r.currency),
        }),
      ),
      "",
      t("family.messageTotal", { total: owed(payable).map((o) => money(o.amount_minor, o.currency)).join(" + ") }),
      t(familyLink ? "family.messagePayAll" : "family.messagePayOne"),
      url,
    ].join("\n");
  }

  async function sendMessage() {
    // Opened on the click itself — a tab opened after the request returns is a blocked popup.
    const tab = window.open("", "_blank");
    setBusy(true);
    setError(false);
    try {
      const text = encodeURIComponent(message(await link()));
      const digits = (family.phone ?? "").replace(/\D+/g, "");
      const target = digits ? `https://wa.me/${digits}?text=${text}` : `https://wa.me/?text=${text}`;
      if (tab !== null) {
        tab.opener = null;
        tab.location.href = target;
      } else {
        window.open(target, "_blank", "noopener,noreferrer");
      }
      onMessageOpened();
    } catch {
      tab?.close();
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    setError(false);
    try {
      await navigator.clipboard.writeText(await link());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError(true);
    }
  }

  return (
    <article
      className="bg-card mb-3 min-w-0 break-inside-avoid overflow-hidden rounded-2xl border border-rose-200/70 shadow-sm dark:border-rose-900/50"
      data-testid={`due-family-${family.key}`}
    >
      <header className="flex items-start gap-3 bg-gradient-to-br from-rose-500/[0.09] via-rose-500/[0.03] to-transparent px-4 py-3">
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-rose-600 text-xs font-bold text-white shadow-sm"
          aria-hidden
        >
          {initials(family.name)}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-bold" data-testid="due-family-name" title={family.name}>
            {family.name}
          </h3>
          <p className="text-muted-foreground truncate text-xs" title={family.children.join("، ")}>
            {t("family.children", { count: family.children.length, names: family.children.join("، ") })}
          </p>
        </div>
        <div className="shrink-0 text-end">
          <p className="text-muted-foreground text-[10px] font-medium">{t("family.totalLabel")}</p>
          {totals.length === 0 ? (
            <p className="text-sm font-bold text-amber-600 dark:text-amber-400">{t("family.notBilled")}</p>
          ) : (
            totals.map((o) => (
              <p
                key={o.currency}
                className="text-base leading-tight font-extrabold text-rose-600 tabular-nums dark:text-rose-400"
                data-testid="due-family-total"
              >
                {money(o.amount_minor, o.currency)}
              </p>
            ))
          )}
        </div>
      </header>

      <ul className="divide-y border-t">
        {family.rows.map((row) => (
          <DueRow key={row.id} row={row} timezone={timezone} actions={actionProps(row)} />
        ))}
      </ul>

      {canSendInvoice && payable.length > 0 && (
        <div className="flex items-stretch border-t">
          <button
            type="button"
            onClick={() => void sendMessage()}
            disabled={busy}
            className="text-primary hover:bg-primary/5 flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-60"
            data-testid="due-family-send"
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : familyLink ? (
              <Link2 className="size-3.5" aria-hidden />
            ) : (
              <MessageSquare className="size-3.5" aria-hidden />
            )}
            {familyLink ? t("family.sendFamilyLink", { count: payable.length }) : t("family.sendOne")}
          </button>
          <button
            type="button"
            onClick={() => void copyLink()}
            className="text-muted-foreground hover:bg-muted hover:text-foreground flex w-10 shrink-0 items-center justify-center border-s transition-colors"
            aria-label={copied ? t("actions.copied") : t("actions.copyLink")}
            title={copied ? t("actions.copied") : t("actions.copyLink")}
            data-testid="due-family-copy"
          >
            {copied ? <Check className="size-3.5 text-emerald-600" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
          </button>
        </div>
      )}
      {error && <p className="text-destructive border-t px-3 py-1.5 text-center text-[11px]">{t("family.linkFailed")}</p>}
    </article>
  );
}

/**
 * One child's package inside a family card, in three lines: who and how much; what the money is for
 * (a new subscription, a renewal, the hours used…) and how long it has waited; the hours and lessons
 * behind it, with the leading action and "⋯".
 */
function DueRow({ row, timezone, actions }: { row: LessonPackageRow; timezone: string; actions: PackageActionProps }) {
  const t = useTranslations("packages");
  const locale = useLocale();
  const owes = row.outstanding_minor > 0;
  const unbilled = row.invoice_id === null && row.minutes_consumed > 0;
  const purpose = row.purpose ?? "NEW";
  const days = Math.max(0, Math.floor((Date.now() - new Date(row.created_at).getTime()) / 86_400_000));

  return (
    <li className="px-4 py-2.5" data-testid="due-package-row">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={actions.onOpenDetail}
            className="hover:text-primary block max-w-full truncate text-start text-sm font-semibold transition-colors"
          >
            {row.student_name}
          </button>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px]">
            <span
              className={cn("shrink-0 rounded px-1.5 py-px text-[10px] font-bold", PURPOSE_TONE[purpose])}
              data-testid="due-package-purpose"
            >
              {t(`purpose.${purpose}`)}
            </span>
            <span className="text-muted-foreground shrink-0 font-semibold tabular-nums">#{formatNumber(row.sequence_no, locale)}</span>
            <span className="text-muted-foreground truncate">{row.label}</span>
            {row.subject && (
              <span className="shrink-0 rounded bg-violet-500/10 px-1 py-px text-[10px] font-semibold text-violet-700 dark:text-violet-300">
                {row.subject.course ?? row.subject.teacher_name}
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-end">
          <p
            className={cn(
              "text-sm font-bold tabular-nums",
              owes ? "text-rose-600 dark:text-rose-400" : "text-amber-600 dark:text-amber-400",
            )}
          >
            {owes
              ? formatMoney({ amount: row.outstanding_minor, currency: row.currency }, locale)
              : unbilled
                ? t("family.notBilled")
                : t("card.overdrawn", { over: formatHours(row.minutes_overdrawn, locale) })}
          </p>
          <p className="text-muted-foreground flex items-center justify-end gap-1 text-[10px]">
            {row.reminders_sent > 0 && row.last_reminded_at !== null && (
              <span
                className="inline-flex items-center gap-0.5 text-sky-700 dark:text-sky-300"
                title={t("card.reminders", {
                  count: row.reminders_sent,
                  n: formatNumber(row.reminders_sent, locale),
                  date: formatDateTime(row.last_reminded_at, timezone, locale),
                })}
              >
                <BellRing className="size-3" aria-hidden />
                {formatNumber(row.reminders_sent, locale)} ·
              </span>
            )}
            {new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-days, "day")}
          </p>
        </div>
      </div>

      <div className="mt-1.5 flex items-center justify-between gap-2">
        <p className="text-muted-foreground min-w-0 truncate text-[11px]" data-testid="due-package-usage">
          {formatHours(row.minutes_sold, locale)} · {t("family.lessonsTaken", { count: row.lesson_count, n: formatNumber(row.lesson_count, locale) })}
          {row.status === "ACTIVE" ? ` · ${formatNumber(row.percent_used, locale)}%` : ` · ${t(`status.${row.status}`)}`}
          {row.gap !== null && (
            <span className="ms-1 inline-flex items-center gap-0.5 font-semibold text-rose-600 dark:text-rose-400" title={t("card.gapTitle")}>
              <AlertTriangle className="size-3" aria-hidden />
            </span>
          )}
        </p>
        <PackageActions {...actions} featuredCount={1} className="shrink-0" />
      </div>
    </li>
  );
}
