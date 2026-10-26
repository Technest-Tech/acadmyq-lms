"use client";

import { AlertTriangle, BellRing, MessageSquare } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useInvoiceUrl } from "@/components/invoices/use-invoice-url";
import { PackageActions, type PackageActionProps } from "@/components/packages/package-card";
import type { LessonPackageRow } from "@/lib/api";
import { formatMoney, formatNumber } from "@/lib/money";
import { formatDateTime, formatHours } from "@/lib/time";
import { cn } from "@/lib/utils";

/** One family on the Due page: a parent and every package their children still owe on. */
export interface DueFamily {
  /** The guardian's id — or the student's, for a row that carries no family. */
  key: string;
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

/**
 * A family's card on the Due page — sized to sit three across, not to fill the page. The parent's
 * name and what the family owes in total lead; each child's package is one line under it (name,
 * package, amount, the leading action and "⋯" — the same actions the full card offers); one
 * WhatsApp message at the foot carries every child's payment link. Each package keeps its own
 * bill, so paying a link still marks exactly that package paid.
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

  function sendFamilyMessage() {
    const lines = [
      t("family.messageGreeting", { name: family.name }),
      t("family.messageIntro"),
      "",
      ...payable.flatMap((r) => [
        t("family.messageLine", { child: r.student_name, label: r.label, amount: money(r.outstanding_minor, r.currency) }),
        invoiceUrl(r.invoice_token as string),
      ]),
      "",
      t("family.messageTotal", { total: owed(payable).map((o) => money(o.amount_minor, o.currency)).join(" + ") }),
      t("family.messageOutro"),
    ];
    const text = encodeURIComponent(lines.join("\n"));
    const digits = (family.phone ?? "").replace(/\D+/g, "");
    window.open(digits ? `https://wa.me/${digits}?text=${text}` : `https://wa.me/?text=${text}`, "_blank", "noopener,noreferrer");
    onMessageOpened();
  }

  return (
    <article
      className="bg-card flex min-w-0 flex-col overflow-hidden rounded-2xl border border-rose-200/70 shadow-sm dark:border-rose-900/50"
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

      <ul className="flex-1 divide-y border-t">
        {family.rows.map((row) => (
          <DueRow key={row.id} row={row} timezone={timezone} actions={actionProps(row)} />
        ))}
      </ul>

      {canSendInvoice && payable.length > 0 && (
        <button
          type="button"
          onClick={sendFamilyMessage}
          className="text-primary hover:bg-primary/5 flex items-center justify-center gap-1.5 border-t px-3 py-2 text-xs font-semibold transition-colors"
          data-testid="due-family-send"
        >
          <MessageSquare className="size-3.5" aria-hidden />
          {payable.length > 1 ? t("family.sendAll", { count: payable.length }) : t("family.sendOne")}
        </button>
      )}
    </article>
  );
}

/** One child's package inside a family card: who, which block, what it owes, and what to do. */
function DueRow({ row, timezone, actions }: { row: LessonPackageRow; timezone: string; actions: PackageActionProps }) {
  const t = useTranslations("packages");
  const locale = useLocale();
  const owes = row.outstanding_minor > 0;
  const unbilled = row.invoice_id === null && row.minutes_consumed > 0;
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
          <div className="text-muted-foreground mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px]">
            <span className="bg-foreground text-background shrink-0 rounded px-1 py-px text-[10px] font-extrabold tabular-nums">
              #{formatNumber(row.sequence_no, locale)}
            </span>
            <span className="truncate">{row.label}</span>
            {row.subject && (
              <span className="shrink-0 rounded bg-violet-500/10 px-1 py-px text-[10px] font-semibold text-violet-700 dark:text-violet-300">
                {row.subject.course ?? row.subject.teacher_name}
              </span>
            )}
            <span className="shrink-0">
              · {t(`status.${row.status}`)}
              {row.status === "ACTIVE" && ` ${formatNumber(row.percent_used, locale)}%`}
            </span>
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
          <p className="text-muted-foreground text-[10px]">
            {new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-days, "day")}
          </p>
        </div>
      </div>

      <div className="mt-1.5 flex items-center justify-between gap-2">
        <div className="text-muted-foreground flex min-w-0 items-center gap-2 text-[10px]">
          {row.reminders_sent > 0 && row.last_reminded_at !== null && (
            <span
              className="inline-flex min-w-0 items-center gap-1 text-sky-700 dark:text-sky-300"
              title={t("card.reminders", {
                count: row.reminders_sent,
                n: formatNumber(row.reminders_sent, locale),
                date: formatDateTime(row.last_reminded_at, timezone, locale),
              })}
            >
              <BellRing className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{t("family.reminded", { count: row.reminders_sent })}</span>
            </span>
          )}
          {row.gap !== null && (
            <span className="inline-flex min-w-0 items-center gap-1 font-semibold text-rose-600 dark:text-rose-400" title={t("card.gapTitle")}>
              <AlertTriangle className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{t("card.gapTitle")}</span>
            </span>
          )}
        </div>
        <PackageActions {...actions} featuredCount={1} className="shrink-0" />
      </div>
    </li>
  );
}
