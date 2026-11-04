"use client";

import { AlertTriangle, BellRing, CalendarClock, Eye, Pencil, RefreshCw, Square, Trash2 } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { dayLabel } from "@/components/accounting/accounting-ui";
import { PersonAvatar, SoftBadge } from "@/components/groups/group-look";
import { STATUS_TONE } from "@/components/subscriptions/subscription-detail";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import { subscriptionSubjectText, type SubscriptionRow } from "@/lib/subscriptions-api";
import { formatDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";

export interface RowActions {
  onOpen?: (row: SubscriptionRow) => void;
  onEdit?: (row: SubscriptionRow) => void;
  onRenew?: (row: SubscriptionRow) => void;
  onClose?: (row: SubscriptionRow) => void;
  onCancel?: (row: SubscriptionRow) => void;
  onRemind?: (row: SubscriptionRow, kind: "PAYMENT" | "FINISHED") => void;
}

/** The bill's state as a soft chip: not billed, owed (red), paid (green). */
export function BillChip({ row }: { row: SubscriptionRow }) {
  const t = useTranslations("subscriptions.row");
  const locale = useLocale();
  if (row.status === "CANCELLED") return null;
  const tone = row.invoice_id === null ? "slate" : row.outstanding_minor > 0 ? "rose" : "emerald";
  return (
    <span data-testid="subscription-bill">
      <SoftBadge tone={tone} className="tabular-nums">
        {row.invoice_id === null ? t("notBilled") : row.outstanding_minor > 0 ? t("due", { amount: formatMoney({ amount: row.outstanding_minor, currency: row.currency }, locale) }) : t("paid")}
      </SoftBadge>
    </span>
  );
}

/** Lessons used of sold, as a bar: violet while it runs, amber on the last two, red once finished. */
export function LessonsBar({ row, className }: { row: SubscriptionRow; className?: string }) {
  const t = useTranslations("subscriptions.row");
  const share = row.lessons_sold > 0 ? Math.min(100, Math.round((row.lessons_used / row.lessons_sold) * 100)) : 0;
  const tone = row.lessons_left <= 0 ? "bg-rose-500" : row.lessons_left <= 2 ? "bg-amber-500" : "bg-primary";
  return (
    <div className={className} data-testid="subscription-lessons-bar">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground font-semibold">{t("lessons")}</span>
        <span dir="ltr" className="font-extrabold tabular-nums">
          {t("usedOf", { used: row.lessons_used, sold: row.lessons_sold })}
        </span>
      </div>
      <div className="bg-muted mt-1 h-2 overflow-hidden rounded-full">
        <div className={cn("h-full rounded-full transition-all", tone)} style={{ width: `${share}%` }} />
      </div>
    </div>
  );
}

/**
 * One subscription on the list: who, which subject, the block's facts — lessons used of sold as a
 * bar, the price of one lesson, the bill, the next lesson, lessons taken outside it, a held renewal
 * — and what the desk can do with it. The actions follow the status: an open block is edited or
 * closed (or cancelled while untouched); a finished one is sold again or edited upward to reopen;
 * anything owed can be reminded.
 */
export function SubscriptionRowCard({ row, canManage, canRemind, actions, compact = false }: { row: SubscriptionRow; canManage: boolean; canRemind: boolean; actions: RowActions; compact?: boolean }) {
  const t = useTranslations("subscriptions");
  const locale = useLocale();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  const money = (minor: number) => formatMoney({ amount: minor, currency: row.currency }, locale);
  const subject = subscriptionSubjectText(row);
  const open = row.status === "OPEN";
  const finished = row.status === "FINISHED" || row.status === "CLOSED";

  return (
    <li className={cn("centre-surface bg-card flex flex-col gap-3 rounded-2xl border p-4", row.status === "CANCELLED" && "opacity-60", compact && "rounded-xl p-3")} data-testid={`subscription-${row.id}`}>
      <div className="flex items-start gap-3">
        {!compact && <PersonAvatar name={row.student.full_name} />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {compact ? (
              <button type="button" className="truncate text-start font-extrabold hover:underline" onClick={() => actions.onOpen?.(row)} data-testid="subscription-open">
                {row.label}
              </button>
            ) : (
              <Link href={`/students/${row.student.id}`} className="truncate font-extrabold hover:underline">
                {row.student.full_name}
              </Link>
            )}
            <SoftBadge tone={STATUS_TONE[row.status]}>{t(`status.${row.status}`)}</SoftBadge>
            {row.outside_count > 0 && (
              <span data-testid="subscription-outside">
                <SoftBadge tone="rose">
                  <AlertTriangle className="size-3" aria-hidden />
                  {t("row.outside", { count: row.outside_count })}
                </SoftBadge>
              </span>
            )}
            {row.renewal_held && (
              <span data-testid="subscription-held">
                <SoftBadge tone="amber">{t("row.renewalHeld")}</SoftBadge>
              </span>
            )}
          </div>
          <p className="text-muted-foreground mt-0.5 truncate text-xs">
            {[compact ? null : row.label, subject || t("row.untied"), row.student.guardian_name && !row.student.is_self_guardian && !compact ? row.student.guardian_name : null].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-sm font-extrabold tabular-nums">{money(row.price_minor)}</span>
          <BillChip row={row} />
        </div>
      </div>

      <LessonsBar row={row} />

      <p className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" data-testid="subscription-facts">
        <span>{row.lesson_minutes ? t("row.perLessonLength", { amount: money(row.lesson_price_minor), minutes: row.lesson_minutes }) : t("row.perLesson", { amount: money(row.lesson_price_minor) })}</span>
        <span>{t("row.since", { date: dayLabel(row.starts_on, locale) })}</span>
        {open && row.next_lesson_at && (
          <span className="inline-flex items-center gap-1">
            <CalendarClock className="size-3.5" aria-hidden />
            {t("row.nextLesson", { when: formatDateTime(row.next_lesson_at, timezone, locale) })}
          </span>
        )}
        {open && row.upcoming_lesson_count > 0 && <span>{t("row.upcoming", { count: row.upcoming_lesson_count })}</span>}
        {finished && row.closed_at && <span>{[t("row.closedOn", { date: dayLabel(row.closed_at.slice(0, 10), locale) }), row.closed_reason, row.closed_by_name].filter(Boolean).join(" · ")}</span>}
        {row.settlement === "PENDING" && <span className="font-semibold text-amber-700 dark:text-amber-300">{t("row.settlementPending")}</span>}
      </p>

      <div className="flex flex-wrap items-center justify-end gap-1 border-t pt-2">
        {actions.onOpen && (
          <Button type="button" size="xs" variant="ghost" className="gap-1" onClick={() => actions.onOpen?.(row)} data-testid="subscription-detail-open">
            <Eye className="size-3" aria-hidden />
            {t("actions.detail")}
          </Button>
        )}
        {canManage && (open || row.status === "FINISHED") && actions.onEdit && (
          <Button type="button" size="xs" variant="ghost" className="gap-1" onClick={() => actions.onEdit?.(row)} data-testid="subscription-edit">
            <Pencil className="size-3" aria-hidden />
            {t("actions.edit")}
          </Button>
        )}
        {canManage && finished && actions.onRenew && (
          <Button type="button" size="xs" variant="outline" className="gap-1" onClick={() => actions.onRenew?.(row)} data-testid="subscription-renew">
            <RefreshCw className="size-3" aria-hidden />
            {t("actions.sellNext")}
          </Button>
        )}
        {canManage && open && actions.onClose && (
          <Button type="button" size="xs" variant="ghost" className="gap-1 text-rose-600 dark:text-rose-400" onClick={() => actions.onClose?.(row)} data-testid="subscription-close">
            <Square className="size-3" aria-hidden />
            {t("actions.close")}
          </Button>
        )}
        {canManage && row.deletable && actions.onCancel && (
          <Button type="button" size="xs" variant="ghost" className="text-destructive gap-1" onClick={() => actions.onCancel?.(row)} data-testid="subscription-cancel">
            <Trash2 className="size-3" aria-hidden />
            {t("actions.cancel")}
          </Button>
        )}
        {canRemind && row.outstanding_minor > 0 && actions.onRemind && (
          <Button type="button" size="xs" variant="ghost" className="gap-1" onClick={() => actions.onRemind?.(row, "PAYMENT")} data-testid="subscription-remind-payment">
            <BellRing className="size-3" aria-hidden />
            {t("actions.remindPayment")}
          </Button>
        )}
        {canRemind && row.status === "FINISHED" && actions.onRemind && (
          <Button type="button" size="xs" variant="ghost" className="gap-1" onClick={() => actions.onRemind?.(row, "FINISHED")} data-testid="subscription-remind-finished">
            <BellRing className="size-3" aria-hidden />
            {t("actions.remindFinished")}
          </Button>
        )}
      </div>
    </li>
  );
}

/** One family on the Due tab: a parent and every block their children still owe on. */
export interface DueFamily {
  key: string;
  guardianId: string | null;
  name: string;
  children: string[];
  rows: SubscriptionRow[];
}

/** Gathers due rows under their family, keeping the order they came in. */
export function groupByFamily(rows: SubscriptionRow[]): DueFamily[] {
  const families = new Map<string, DueFamily>();
  for (const row of rows) {
    const key = row.student.guardian_id && !row.student.is_self_guardian ? row.student.guardian_id : `student:${row.student.id}`;
    let family = families.get(key);
    if (family === undefined) {
      family = { key, guardianId: row.student.guardian_id && !row.student.is_self_guardian ? row.student.guardian_id : null, name: (!row.student.is_self_guardian && row.student.guardian_name) || row.student.full_name, children: [], rows: [] };
      families.set(key, family);
    }
    family.rows.push(row);
    if (!family.children.includes(row.student.full_name)) family.children.push(row.student.full_name);
  }
  return [...families.values()];
}

/** What the family owes, per currency — money is never summed across currencies. */
function owed(rows: SubscriptionRow[]): { currency: string; minor: number }[] {
  const by = new Map<string, number>();
  for (const r of rows) if (r.outstanding_minor > 0) by.set(r.currency, (by.get(r.currency) ?? 0) + r.outstanding_minor);
  return [...by.entries()].map(([currency, minor]) => ({ currency, minor }));
}

/** A family's card on the Due tab: the parent, what they owe in all, and each child's block under it. */
export function FamilySubscriptionGroup({ family, canManage, canRemind, actions }: { family: DueFamily; canManage: boolean; canRemind: boolean; actions: RowActions }) {
  const t = useTranslations("subscriptions");
  const locale = useLocale();
  const totals = owed(family.rows);
  return (
    <section className="centre-surface bg-card overflow-hidden rounded-2xl border" data-testid={`family-${family.key}`}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <PersonAvatar name={family.name} />
          <div className="min-w-0">
            {family.guardianId ? (
              <Link href={`/guardians/${family.guardianId}`} className="block truncate font-extrabold hover:underline">
                {family.name}
              </Link>
            ) : (
              <p className="truncate font-extrabold">{family.name}</p>
            )}
            <p className="text-muted-foreground truncate text-xs">{family.children.join(locale.startsWith("ar") ? "، " : ", ")}</p>
          </div>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-muted-foreground text-[11px] font-semibold">{t("family.owes")}</span>
          {totals.map((o) => (
            <span key={o.currency} className="text-sm font-extrabold text-rose-600 tabular-nums dark:text-rose-400">
              {formatMoney({ amount: o.minor, currency: o.currency }, locale)}
            </span>
          ))}
        </div>
      </header>
      <ul className="space-y-2 p-3">
        {family.rows.map((row) => (
          <SubscriptionRowCard key={row.id} row={row} canManage={canManage} canRemind={canRemind} actions={actions} compact />
        ))}
      </ul>
    </section>
  );
}
