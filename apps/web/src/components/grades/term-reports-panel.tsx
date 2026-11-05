"use client";

import { ChevronLeft, FileText, MessageSquareText, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { formatPercent } from "@/components/grades/grade-sheet";
import { TermReportView } from "@/components/grades/term-report-view";
import { apiErrorMessage } from "@/components/groups/group-form";
import { PersonAvatar, SectionCard, SoftBadge, rateTone, type PastelTone } from "@/components/groups/group-look";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useModernLook } from "@/lib/capabilities";
import { listTermReports, percentTone, publishAllTermReports, type TermReportList } from "@/lib/grades-api";
import { cn } from "@/lib/utils";

const TONE: Record<ReturnType<typeof percentTone>, string> = {
  low: "text-rose-600 dark:text-rose-400",
  high: "text-emerald-600 dark:text-emerald-400",
  mid: "text-foreground",
  none: "text-muted-foreground",
};

const TONE_BADGE: Record<ReturnType<typeof percentTone>, PastelTone> = { low: "rose", high: "emerald", mid: "amber", none: "slate" };

/**
 * The group's term reports (docs/centre-profile, Phase 2 §5): one row per student with their
 * attendance rate, weighted total and whether the parent can already read it; a row opens the
 * report itself. "Publish all" is the office's one tap at the end of a term.
 */
export function TermReportsPanel({ groupId }: { groupId: string }) {
  const t = useTranslations("grades");
  const look = useModernLook();
  const [data, setData] = useState<TermReportList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await listTermReports(groupId));
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, t("loadFailed")));
    }
  }, [groupId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function publishAll() {
    setBusy(true);
    setError(null);
    try {
      const res = await publishAllTermReports(groupId);
      setData(res);
      setNotice(res.published > 0 ? t("reports.publishedAll", { count: res.published }) : t("reports.nothingToPublish"));
    } catch (err) {
      setError(apiErrorMessage(err, t("saveFailed")));
    } finally {
      setBusy(false);
    }
  }

  if (open) {
    return <TermReportView groupId={groupId} studentId={open} onBack={() => setOpen(null)} onChanged={() => void load()} />;
  }

  if (!data) {
    return error ? <AlertBanner variant="error" message={error} /> : <p className="text-muted-foreground py-10 text-center text-sm">{t("loading")}</p>;
  }

  const unpublished = data.reports.filter((r) => r.published_at === null).length;

  if (look) {
    return (
      <div className="space-y-4" data-testid="term-reports">
        {notice && <AlertBanner variant="success" message={notice} onDismiss={() => setNotice(null)} />}
        {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}
        <SectionCard
          icon={FileText}
          tone="indigo"
          title={t("tabs.reports")}
          count={data.reports.length}
          action={
            data.can_publish && data.reports.length > 0 ? (
              <Button type="button" onClick={() => void publishAll()} disabled={busy || unpublished === 0} data-testid="reports-publish-all">
                <Send className="size-4" />
                {t("reports.publishAll")}
                {unpublished > 0 && <span className="ms-1 rounded-full bg-white/20 px-1.5 text-xs tabular-nums">{unpublished}</span>}
              </Button>
            ) : undefined
          }
          flush
        >
          {data.reports.length === 0 ? (
            <p className="text-muted-foreground p-8 text-center text-sm">{t("reports.empty")}</p>
          ) : (
            <ul className="divide-y">
              {data.reports.map((r) => (
                <li key={r.student_id}>
                  <button
                    type="button"
                    onClick={() => setOpen(r.student_id)}
                    className="hover:bg-muted/40 flex w-full flex-col gap-3 px-4 py-3 text-start transition-colors sm:flex-row sm:items-center sm:justify-between sm:px-5"
                    data-testid={`report-row-${r.student_id}`}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <PersonAvatar name={r.full_name} />
                      <span className="truncate font-bold">{r.full_name}</span>
                      {r.left && <span className="text-muted-foreground text-xs">({t("reports.left")})</span>}
                      {r.has_comment && <MessageSquareText className="text-muted-foreground size-3.5 shrink-0" aria-label={t("reports.hasComment")} />}
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <SoftBadge tone={rateTone(r.attendance.rate === null ? null : r.attendance.rate / 100)} className="tabular-nums">
                        {t("reports.attendance")} <span dir="ltr">{r.attendance.rate === null ? "—" : `${r.attendance.rate}%`}</span>
                      </SoftBadge>
                      <SoftBadge tone={TONE_BADGE[percentTone(r.total.weighted_percent)]} className="tabular-nums">
                        {t("reports.total")} <span dir="ltr">{formatPercent(r.total.weighted_percent)}</span>
                      </SoftBadge>
                      {r.overall_grade && <SoftBadge tone="violet">{r.overall_grade}</SoftBadge>}
                      <SoftBadge tone={r.published_at ? "emerald" : "slate"}>
                        <span data-testid={`report-state-${r.student_id}`}>{r.published_at ? t("reports.published") : t("reports.draft")}</span>
                      </SoftBadge>
                      <ChevronLeft className="text-muted-foreground size-4 ltr:rotate-180" aria-hidden />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="term-reports">
      {data.can_publish && data.reports.length > 0 && (
        <div className="flex justify-end">
          <Button type="button" onClick={() => void publishAll()} disabled={busy || unpublished === 0} data-testid="reports-publish-all">
            <Send className="size-4" />
            {t("reports.publishAll")}
            {unpublished > 0 && <span className="ms-1 rounded-full bg-white/20 px-1.5 text-xs tabular-nums">{unpublished}</span>}
          </Button>
        </div>
      )}

      {notice && <AlertBanner variant="success" message={notice} onDismiss={() => setNotice(null)} />}
      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}

      {data.reports.length === 0 ? (
        <p className="text-muted-foreground rounded-xl border border-dashed p-6 text-center text-sm">{t("reports.empty")}</p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {data.reports.map((r) => (
            <li key={r.student_id}>
              <button
                type="button"
                onClick={() => setOpen(r.student_id)}
                className="hover:bg-muted/40 flex w-full flex-col gap-2 p-3 text-start sm:flex-row sm:items-center sm:justify-between"
                data-testid={`report-row-${r.student_id}`}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <p className="truncate font-medium">{r.full_name}</p>
                  {r.left && <span className="text-muted-foreground text-xs">({t("reports.left")})</span>}
                  {r.has_comment && <MessageSquareText className="text-muted-foreground size-3.5" aria-label={t("reports.hasComment")} />}
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <span className="text-muted-foreground">
                    {t("reports.attendance")}{" "}
                    <span className="text-foreground font-semibold tabular-nums">{r.attendance.rate === null ? "—" : `${r.attendance.rate}%`}</span>
                  </span>
                  <span className="text-muted-foreground">
                    {t("reports.total")} <span className={cn("font-semibold tabular-nums", TONE[percentTone(r.total.weighted_percent)])}>{formatPercent(r.total.weighted_percent)}</span>
                  </span>
                  {r.overall_grade && <span className="font-semibold">{r.overall_grade}</span>}
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-medium",
                      r.published_at
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
                        : "bg-muted text-muted-foreground",
                    )}
                    data-testid={`report-state-${r.student_id}`}
                  >
                    {r.published_at ? t("reports.published") : t("reports.draft")}
                  </span>
                  <ChevronLeft className="text-muted-foreground size-4 ltr:rotate-180" aria-hidden />
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
