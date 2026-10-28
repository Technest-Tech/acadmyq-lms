"use client";

import { CalendarClock, ExternalLink } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState, type ReactNode } from "react";
import { AlertBanner } from "@/components/ui/alert";
import { ProfileCard } from "@/components/ui/profile-card";
import { getStudentMonth, type StudentMonth } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { formatDateTime, formatHours } from "@/lib/time";
import { cn } from "@/lib/utils";

const STATE_TONE: Record<"PAID" | "PARTIAL" | "UNPAID", string> = {
  PAID: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  PARTIAL: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  UNPAID: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
};

/**
 * The running month on the Subscription tab — what the agreed terms have turned into so far:
 * lessons taught against the monthly quota, what is still to come or waiting to be marked, this
 * month's bill and what the family owes overall. The terms card above says what was agreed; this
 * says where it stands, which is what a parent on the phone is asking.
 *
 * `quota` is the monthly lesson count (null for a package or an hourly student — then "taught"
 * stands alone). `refreshKey` reloads it after the profile changes something.
 */
export function StudentMonthCard({
  studentId,
  quota,
  refreshKey,
}: {
  studentId: string;
  quota: number | null;
  refreshKey?: unknown;
}) {
  const t = useTranslations("students");
  const locale = useLocale();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  const [data, setData] = useState<StudentMonth | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getStudentMonth(studentId)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(false);
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [studentId, refreshKey]);

  if (error) return <AlertBanner variant="error" message={t("subscription.month.loadFailed")} />;
  if (data === null) return null;

  const monthName = new Date(`${data.month}-01T00:00:00`).toLocaleDateString(locale, { month: "long", year: "numeric" });
  const { lessons, bill } = data;
  const money = (amount: number, currency: string) => formatMoney({ amount, currency }, locale);
  const owes = data.family_due.length > 0;

  return (
    <ProfileCard
      icon={CalendarClock}
      title={t("subscription.month.title")}
      description={t("subscription.month.description", { month: monthName })}
      tone="emerald"
      testId="student-month"
      bodyClassName="p-0"
    >
      <div className="bg-border grid grid-cols-2 gap-px border-b sm:grid-cols-4">
        <Stat label={t("subscription.month.taught")} testId="month-taught">
          {quota !== null && quota > 0
            ? t("subscription.month.taughtOf", { taught: lessons.taught, quota })
            : lessons.taught}
          {lessons.taught_minutes > 0 && (
            <span className="text-muted-foreground ms-1.5 text-xs font-medium">
              {formatHours(lessons.taught_minutes, locale)}
            </span>
          )}
        </Stat>
        <Stat label={t("subscription.month.upcoming")}>{lessons.upcoming}</Stat>
        <Stat label={t("subscription.month.unmarked")} warn={lessons.unmarked > 0}>
          {lessons.unmarked}
        </Stat>
        <Stat label={t("subscription.month.cancelled")}>{lessons.cancelled}</Stat>
      </div>

      {quota !== null && quota > 0 && (
        <div className="bg-muted mx-5 mt-4 h-1.5 overflow-hidden rounded-full">
          <div
            className="bg-emerald-500 h-full"
            style={{ width: `${Math.min(100, (lessons.taught / quota) * 100)}%` }}
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-3">
        <Line label={t("subscription.month.nextLesson")}>
          {data.next_lesson_at
            ? formatDateTime(data.next_lesson_at, timezone, locale)
            : <span className="text-muted-foreground">{t("subscription.month.noNextLesson")}</span>}
        </Line>

        <Line label={t("subscription.month.bill")} testId="month-bill">
          {bill === null ? (
            <span className="text-muted-foreground">{t("subscription.month.noBill")}</span>
          ) : (
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="tabular-nums">{money(bill.total_minor, bill.currency)}</span>
              <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", STATE_TONE[bill.state])}>
                {t(`subscription.month.state.${bill.state}`)}
              </span>
              <a
                href={bill.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary inline-flex items-center gap-0.5 text-xs font-semibold hover:underline"
              >
                {t("subscription.month.openBill")}
                <ExternalLink className="size-3" aria-hidden />
              </a>
            </span>
          )}
          {bill !== null && (bill.shared || bill.due_minor > 0) && (
            <span className="text-muted-foreground mt-0.5 block text-xs">
              {[
                bill.shared ? t("subscription.month.billOwn", { amount: money(bill.own_minor, bill.currency) }) : null,
                bill.due_minor > 0 && bill.state === "PARTIAL" ? t("subscription.month.billDue", { amount: money(bill.due_minor, bill.currency) }) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          )}
        </Line>

        <Line label={t("subscription.month.familyDue")} testId="month-family-due">
          {owes ? (
            <span className="font-semibold text-rose-600 tabular-nums dark:text-rose-400">
              {data.family_due.map((d) => money(d.due_minor, d.currency)).join(" + ")}
            </span>
          ) : (
            <span className="text-emerald-600 dark:text-emerald-400">{t("subscription.month.familyNothing")}</span>
          )}
        </Line>
      </div>
    </ProfileCard>
  );
}

function Stat({ label, warn, testId, children }: { label: string; warn?: boolean; testId?: string; children: ReactNode }) {
  return (
    <div className="bg-card px-5 py-4" data-testid={testId}>
      <p className="text-muted-foreground/80 text-[10px] font-bold uppercase tracking-wider">{label}</p>
      <p className={cn("mt-1 text-lg font-bold leading-none tabular-nums", warn && "text-amber-600 dark:text-amber-400")}>
        {children}
      </p>
    </div>
  );
}

function Line({ label, testId, children }: { label: string; testId?: string; children: ReactNode }) {
  return (
    <div className="min-w-0 text-sm" data-testid={testId}>
      <p className="text-muted-foreground/80 mb-1 text-[10px] font-bold uppercase tracking-wider">{label}</p>
      <div className="font-medium">{children}</div>
    </div>
  );
}
