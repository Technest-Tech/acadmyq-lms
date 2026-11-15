"use client";

import { CalendarClock, ChevronDown, Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { blockAmount } from "@/components/packages/lesson-price-fields";
import { LessonRow } from "@/components/students/student-lesson-log";
import { Modal } from "@/components/ui/modal";
import {
  ApiError,
  getPackageLessons,
  listLessonPackages,
  type LessonPackageRow,
  type PackageLessonLog,
} from "@/lib/api";
import { formatMoney, formatNumber } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * Every package a student has had, newest first, each one folded. Opening one lists its lessons —
 * numbered, with day, time and status — the same rows as the profile's lesson log
 * (GET /packages/{id}/lessons). Opened from the Due page so whoever is chasing a payment can answer
 * "which lessons was #3 for?" without leaving the page.
 */
export function PackageHistoryModal({
  studentId,
  studentName,
  open,
  onClose,
}: {
  studentId: string;
  studentName: string;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("packages.history");
  const tActions = useTranslations("packages.actions");

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("title", { name: studentName })}
      description={t("subtitle")}
      size="lg"
      closeLabel={tActions("cancel")}
    >
      {open && <PackageHistoryList studentId={studentId} />}
    </Modal>
  );
}

function PackageHistoryList({ studentId }: { studentId: string }) {
  const t = useTranslations("packages.history");
  const [packages, setPackages] = useState<LessonPackageRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void listLessonPackages({ student_id: studentId })
      .then((res) => {
        if (!live) return;
        setPackages(
          res.packages
            .filter((p) => p.status !== "CANCELLED")
            .sort((a, b) => b.sequence_no - a.sequence_no),
        );
      })
      .catch((err) => live && setError(err instanceof ApiError ? err.message : String(err)));
    return () => {
      live = false;
    };
  }, [studentId]);

  if (error) return <p className="text-destructive text-sm">{error}</p>;
  if (packages === null) return <Loading />;
  if (packages.length === 0) {
    return <p className="text-muted-foreground py-8 text-center text-sm">{t("empty")}</p>;
  }

  return (
    <ul className="space-y-2" data-testid="package-history">
      {packages.map((p) => (
        <HistoryItem
          key={p.id}
          row={p}
          open={openId === p.id}
          onToggle={() => setOpenId((id) => (id === p.id ? null : p.id))}
        />
      ))}
    </ul>
  );
}

function HistoryItem({ row, open, onToggle }: { row: LessonPackageRow; open: boolean; onToggle: () => void }) {
  const t = useTranslations("packages");
  const locale = useLocale();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [log, setLog] = useState<PackageLessonLog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = row.status === "ACTIVE";
  const owes = row.outstanding_minor > 0;
  const paid = row.invoice_id !== null && !owes;
  const day = (date: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
  const ended = row.closed_at !== null ? day(row.closed_at.slice(0, 10)) : null;

  // Read once, the first time it is opened; folding and unfolding again keeps what came back.
  useEffect(() => {
    if (!open || log !== null) return;
    let live = true;
    setError(null);
    void getPackageLessons(row.id)
      .then((res) => live && setLog(res))
      .catch((err) => live && setError(err instanceof ApiError ? err.message : String(err)));
    return () => {
      live = false;
    };
  }, [open, log, row.id]);

  return (
    <li
      className={cn("bg-card overflow-hidden rounded-xl border", open && "shadow-sm")}
      data-testid={`package-history-${row.sequence_no}`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="hover:bg-muted/40 flex w-full items-center gap-3 px-3 py-2.5 text-start transition-colors"
      >
        <span className="bg-foreground text-background shrink-0 rounded-md px-2 py-1 text-xs font-extrabold tabular-nums">
          #{formatNumber(row.sequence_no, locale)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-semibold">{row.label}</span>
            {row.subject && (
              <span className="shrink-0 rounded bg-violet-500/10 px-1 py-px text-[10px] font-semibold text-violet-700 dark:text-violet-300">
                {row.subject.course ?? row.subject.teacher_name}
              </span>
            )}
          </span>
          <span className="text-muted-foreground block truncate text-[11px]">
            {day(row.starts_on)}
            {ended !== null && ` → ${ended}`}
            {" · "}
            {blockAmount(row.minutes_sold, row.lesson_minutes, t, locale)}
            {" · "}
            {t("family.lessonsTaken", { count: row.lesson_count, n: formatNumber(row.lesson_count, locale) })}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-bold",
              active
                ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
                : "bg-muted text-muted-foreground",
            )}
          >
            {active ? t("history.open") : t("history.finished")}
          </span>
          <span
            className={cn(
              "text-[10px] font-bold tabular-nums",
              owes ? "text-rose-600 dark:text-rose-400" : paid ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
            )}
          >
            {owes
              ? t("card.amountDue", { amount: formatMoney({ amount: row.outstanding_minor, currency: row.currency }, locale) })
              : paid
                ? t("card.paidBadge")
                : t("card.notBilledYet")}
          </span>
        </span>
        <ChevronDown
          className={cn("text-muted-foreground size-4 shrink-0 transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>

      {open && (
        <div className="border-t">
          {error ? (
            <p className="text-destructive px-3 py-3 text-xs">{error}</p>
          ) : log === null ? (
            <Loading />
          ) : log.lessons.length === 0 && log.unscheduled === 0 ? (
            <p className="text-muted-foreground px-3 py-4 text-center text-xs">{t("history.noLessons")}</p>
          ) : (
            <ol className="divide-y" data-testid="package-history-lessons">
              {log.lessons.map((lesson, i) => (
                <LessonRow key={lesson.id} lesson={lesson} n={i + 1} tz={tz} />
              ))}
              {log.unscheduled > 0 && (
                <li className="text-muted-foreground flex items-center gap-3 px-3 py-3 text-xs sm:px-4">
                  <span className="w-10 shrink-0 text-center font-bold tabular-nums">
                    {log.unscheduled === 1
                      ? log.lessons.length + 1
                      : `${log.lessons.length + 1}–${log.lessons.length + log.unscheduled}`}
                  </span>
                  <CalendarClock className="size-4 shrink-0" aria-hidden />
                  <span>{t("history.unscheduled", { count: log.unscheduled })}</span>
                </li>
              )}
            </ol>
          )}
        </div>
      )}
    </li>
  );
}

function Loading() {
  return (
    <div className="flex items-center justify-center py-6">
      <Loader2 className="text-muted-foreground size-5 animate-spin" aria-hidden />
    </div>
  );
}
