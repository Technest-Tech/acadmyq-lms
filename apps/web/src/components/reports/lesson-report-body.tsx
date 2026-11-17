"use client";

import { useLocale, useTranslations } from "next-intl";
import { displayValue } from "@/components/attendance/structured-report-form";
import type { ReportField } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Keys a report carries that are not answers to a field. */
const RESERVED = new Set(["report_text", "is_free_trial"]);

/** Strip anything script-capable (the editor sanitises on write; this text also travels the API). */
export function sanitizeReportHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\son\w+='[^']*'/gi, "")
    .replace(/\shref="javascript:[^"]*"/gi, "");
}

/** The report's text without its markup — for a preview line and for copying. */
export function reportPlainText(html: string): string {
  return html
    .replace(/<\/(p|div|li|h1|h2|h3|blockquote)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface ReportAnswer {
  field: ReportField;
  value: string;
  /** A score out of a max: 0..1, for the little bar. */
  share: number | null;
}

/** Answered fields in form order. Fields come from the academy's whole list, retired ones included. */
export function reportAnswers(values: Record<string, unknown> | null | undefined, fields: ReportField[]): ReportAnswer[] {
  if (!values) return [];
  return [...fields]
    .sort((a, b) => a.sort_order - b.sort_order)
    .filter((f) => !RESERVED.has(f.key))
    .map((field) => {
      const value = displayValue(field, values[field.key]);
      const raw = Number(values[field.key]);
      const share =
        field.field_type === "NUMBER" && field.max_value && Number.isFinite(raw)
          ? Math.max(0, Math.min(1, raw / field.max_value))
          : null;
      return { field, value, share };
    })
    .filter((a) => a.value !== "");
}

/** The free-text body, or "" when there is nothing in it. */
export function reportText(values: Record<string, unknown> | null | undefined): string {
  const text = values?.report_text;
  return typeof text === "string" && reportPlainText(text) !== "" ? text : "";
}

/** The whole report as plain text, the way a teacher would paste it into a chat. */
export function reportAsText(
  values: Record<string, unknown> | null | undefined,
  fields: ReportField[],
  locale: string,
): string {
  const lines = reportAnswers(values, fields).map(
    (a) => `${(locale === "ar" ? a.field.label_ar : a.field.label_en) || a.field.label_ar}: ${a.value}`,
  );
  const text = reportText(values);
  if (text) lines.push(reportPlainText(text));
  return lines.join("\n");
}

const PROSE = [
  "[&_ul]:ms-5 [&_ul]:list-disc [&_ul]:space-y-0.5",
  "[&_ol]:ms-5 [&_ol]:list-decimal [&_ol]:space-y-0.5",
  "[&_b]:font-bold [&_strong]:font-bold",
  "[&_em]:italic [&_i]:italic",
  "[&_u]:underline",
  "[&_s]:line-through [&_del]:line-through [&_strike]:line-through",
  "[&_h1]:mt-1 [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-bold",
  "[&_h2]:mt-1 [&_h2]:mb-1.5 [&_h2]:text-base [&_h2]:font-semibold",
  "[&_blockquote]:rounded-md [&_blockquote]:border-s-2 [&_blockquote]:border-primary/40 [&_blockquote]:bg-primary/5 [&_blockquote]:py-1 [&_blockquote]:ps-3 [&_blockquote]:text-muted-foreground",
  "[&>*+*]:mt-1.5",
].join(" ");

/**
 * One lesson report, read: the academy's own fields (grouped under their sections, a score with its
 * "out of" and a bar) and then the free text. Either can be empty; both empty says so. The same body
 * opens from the reports log, the dashboard and a salary statement, so a report reads the same
 * wherever a teacher finds it.
 */
export function LessonReportBody({
  values,
  fields,
  className,
}: {
  values: Record<string, unknown> | null | undefined;
  fields: ReportField[];
  className?: string;
}) {
  const t = useTranslations("lessonReports");
  const locale = useLocale();
  const answers = reportAnswers(values, fields);
  const text = reportText(values);

  if (answers.length === 0 && !text) {
    return (
      <p className={cn("text-muted-foreground rounded-xl border border-dashed px-4 py-6 text-center text-sm", className)}>
        {t("empty")}
      </p>
    );
  }

  // Consecutive answers that share a section sit under one heading.
  const groups: { section: string | null; answers: ReportAnswer[] }[] = [];
  for (const a of answers) {
    const section = a.field.section?.trim() || null;
    const last = groups[groups.length - 1];
    if (last && last.section === section) last.answers.push(a);
    else groups.push({ section, answers: [a] });
  }
  const label = (f: ReportField) => (locale === "ar" ? f.label_ar : f.label_en) || f.label_ar;

  return (
    <div className={cn("space-y-3", className)} data-testid="lesson-report-body">
      {groups.map((group, i) => (
        <section key={`${group.section ?? ""}-${i}`} className="bg-muted/25 rounded-xl border p-3">
          {group.section && <h4 className="text-muted-foreground mb-2 text-xs font-bold">{group.section}</h4>}
          <dl className="grid gap-2 sm:grid-cols-2">
            {group.answers.map((a) => (
              <div
                key={a.field.key}
                className={cn(
                  "bg-card min-w-0 rounded-lg border px-3 py-2",
                  // Long answers (a page of notes) take the whole row.
                  (a.field.field_type === "TEXTAREA" || a.value.length > 40) && "sm:col-span-2",
                )}
              >
                <dt className="text-muted-foreground text-[11px] font-semibold">{label(a.field)}</dt>
                <dd className="mt-0.5 text-sm font-medium break-words whitespace-pre-wrap">
                  {a.share !== null ? (
                    <span className="flex items-center gap-2">
                      <span className="shrink-0 tabular-nums" dir="ltr">
                        {a.value}
                      </span>
                      <span className="bg-muted h-1.5 flex-1 overflow-hidden rounded-full" aria-hidden>
                        <span
                          className={cn(
                            "block h-full rounded-full",
                            a.share >= 0.8 ? "bg-emerald-500" : a.share >= 0.5 ? "bg-amber-500" : "bg-rose-500",
                          )}
                          style={{ width: `${Math.round(a.share * 100)}%` }}
                        />
                      </span>
                    </span>
                  ) : (
                    a.value
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      {text && (
        <div
          className={cn("bg-muted/20 rounded-xl border px-4 py-3 text-sm leading-relaxed break-words", PROSE)}
          data-testid="lesson-report-text"
          dangerouslySetInnerHTML={{ __html: sanitizeReportHtml(text) }}
        />
      )}
    </div>
  );
}
