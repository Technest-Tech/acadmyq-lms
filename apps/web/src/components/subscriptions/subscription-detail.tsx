"use client";

import { Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { dayLabel } from "@/components/accounting/accounting-ui";
import { apiErrorMessage } from "@/components/groups/group-form";
import { SoftBadge, type PastelTone } from "@/components/groups/group-look";
import { AlertBanner } from "@/components/ui/alert";
import { formatMoney } from "@/lib/money";
import { closedReasonText, getSubscription, subscriptionSubjectText, type SubscriptionLessonRow, type SubscriptionRow, type SubscriptionStatus } from "@/lib/subscriptions-api";
import { formatDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";

export const STATUS_TONE: Record<SubscriptionStatus, PastelTone> = { OPEN: "emerald", FINISHED: "amber", CLOSED: "slate", CANCELLED: "rose" };

/**
 * A block's facts and its lessons, numbered 1..sold as they were counted (docs/centre-profile/01
 * rule 3): read-only on purpose — recording a lesson is the Attendance page's job, and the popup
 * that did it here was the duplicate-lesson source. One attended past the block is flagged, not
 * numbered: it waits for the next block sold.
 */
export function SubscriptionDetail({ id, initial }: { id: string; initial?: SubscriptionRow }) {
  const t = useTranslations("subscriptions");
  const locale = useLocale();
  const [row, setRow] = useState<SubscriptionRow | null>(initial ?? null);
  const [lessons, setLessons] = useState<SubscriptionLessonRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";

  useEffect(() => {
    let live = true;
    getSubscription(id)
      .then((r) => {
        if (!live) return;
        setRow(r.subscription);
        setLessons(r.lessons);
      })
      .catch((err) => live && setError(apiErrorMessage(err, t("loadFailed"))));
    return () => {
      live = false;
    };
  }, [id, t]);

  if (error) return <AlertBanner variant="error" message={error} />;
  if (row === null) return <Loader2 className="text-muted-foreground mx-auto my-6 size-5 animate-spin" aria-hidden />;

  const money = (minor: number) => formatMoney({ amount: minor, currency: row.currency }, locale);
  const facts: { label: string; value: string }[] = [
    { label: t("detail.student"), value: row.student.full_name },
    { label: t("detail.subject"), value: subscriptionSubjectText(row) || t("row.untied") },
    { label: t("detail.lessons"), value: t("row.usedOf", { used: row.lessons_used, sold: row.lessons_sold }) },
    { label: t("detail.lessonPrice"), value: row.lesson_minutes ? t("row.perLessonLength", { amount: money(row.lesson_price_minor), minutes: row.lesson_minutes }) : t("row.perLesson", { amount: money(row.lesson_price_minor) }) },
    { label: t("detail.total"), value: money(row.price_minor) },
    { label: t("detail.bill"), value: row.invoice_id === null ? t("row.notBilled") : row.outstanding_minor > 0 ? t("row.due", { amount: money(row.outstanding_minor) }) : t("row.paid") },
    { label: t("detail.startsOn"), value: dayLabel(row.starts_on, locale) },
    ...(row.closed_at ? [{ label: t("detail.closedOn"), value: [dayLabel(row.closed_at.slice(0, 10), locale), closedReasonText(row.closed_reason, t), row.closed_by_name].filter(Boolean).join(" · ") }] : []),
    ...(row.opened_by_name ? [{ label: t("detail.openedBy"), value: row.opened_by_name }] : []),
  ];

  return (
    <div className="space-y-4" data-testid="subscription-detail">
      <div className="flex flex-wrap items-center gap-2">
        <SoftBadge tone={STATUS_TONE[row.status]}>{t(`status.${row.status}`)}</SoftBadge>
        <span className="text-muted-foreground text-xs">#{row.sequence_no}</span>
        {row.outside_count > 0 && <SoftBadge tone="rose">{t("row.outside", { count: row.outside_count })}</SoftBadge>}
        {row.renewal_held && <SoftBadge tone="amber">{t("row.renewalHeld")}</SoftBadge>}
      </div>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
        {facts.map((f) => (
          <div key={f.label} className="flex items-baseline justify-between gap-3 border-b border-dashed py-1.5">
            <dt className="text-muted-foreground text-xs">{f.label}</dt>
            <dd className="text-end font-medium break-words">{f.value}</dd>
          </div>
        ))}
      </dl>
      <section>
        <h4 className="text-muted-foreground mb-2 text-xs font-semibold uppercase tracking-wide">{t("detail.lessonsTitle")}</h4>
        {lessons === null ? (
          <Loader2 className="text-muted-foreground mx-auto my-4 size-5 animate-spin" aria-hidden />
        ) : lessons.length === 0 ? (
          <p className="text-muted-foreground py-3 text-center text-sm">{t("detail.noLessons")}</p>
        ) : (
          <ol className="divide-y rounded-xl border" data-testid="subscription-lessons">
            {lessons.map((l) => (
              <li key={l.session_id} className={cn("flex items-center gap-3 px-3 py-2 text-sm", l.number === null && "bg-rose-500/[0.06]")} data-testid={`subscription-lesson-${l.session_id}`} data-outside={l.number === null}>
                <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums", l.number === null ? "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300" : "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300")}>
                  {l.number ?? "!"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{formatDateTime(l.scheduled_at_utc, timezone, locale)}</span>
                  <span className="text-muted-foreground block text-xs">
                    {[l.teacher_name, t("detail.minutes", { minutes: l.duration_minutes }), l.number === null ? t("detail.outsideLesson") : null].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
