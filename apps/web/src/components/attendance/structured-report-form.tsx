"use client";

import { useLocale, useTranslations } from "next-intl";
import type { ReportField } from "@/lib/api";
import { cn } from "@/lib/utils";

const inputClass =
  "border-input bg-background focus:border-primary focus:ring-primary/15 w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none transition-colors focus:ring-3 disabled:opacity-60";

/** Scores up to this "out of" are picked from a row of numbers; bigger ones are typed. */
const MAX_PICKER = 10;

export type ReportValues = Record<string, unknown>;

/** A field's value as a parent reads it: a score shows its "out of". Empty → "". */
export function displayValue(field: ReportField, value: unknown): string {
  if (value === null || value === undefined || String(value).trim() === "") return "";
  const text = String(value).trim();
  return field.field_type === "NUMBER" && field.max_value ? `${text} / ${field.max_value}` : text;
}

/** Consecutive fields that share a section, in form order. */
function groupBySection(fields: ReportField[]): { section: string | null; fields: ReportField[] }[] {
  const groups: { section: string | null; fields: ReportField[] }[] = [];
  for (const field of fields) {
    const section = field.section?.trim() || null;
    const last = groups[groups.length - 1];
    if (last && last.section === section) last.fields.push(field);
    else groups.push({ section, fields: [field] });
  }
  return groups;
}

/**
 * The academy's own lesson report (the `lesson_report` capability): its report fields, under their
 * sections, in place of the free-text box. Scores "out of" a max are a tap on a number, so a
 * teacher fills a report on a phone without typing digits.
 */
export function StructuredReportForm({
  fields,
  values,
  onChange,
  disabled = false,
  readOnly = false,
}: {
  fields: ReportField[];
  values: ReportValues;
  onChange: (values: ReportValues) => void;
  disabled?: boolean;
  readOnly?: boolean;
}) {
  const t = useTranslations("attendance");
  const locale = useLocale();
  const label = (f: ReportField) => (locale === "ar" ? f.label_ar : f.label_en) || f.label_ar;
  const set = (key: string, value: unknown) => onChange({ ...values, [key]: value });

  if (readOnly) {
    const filled = fields.filter((f) => displayValue(f, values[f.key]) !== "");
    if (filled.length === 0) {
      return (
        <div data-testid="report-readonly" className="rounded-xl border border-input bg-muted/20 px-4 py-3 text-sm">
          <p className="text-muted-foreground">{t("notFilled")}</p>
        </div>
      );
    }
    return (
      <div data-testid="report-readonly" className="space-y-3 rounded-xl border border-input bg-muted/20 px-4 py-3 text-sm">
        {groupBySection(filled).map((group, i) => (
          <div key={`${group.section ?? ""}-${i}`}>
            {group.section && <p className="mb-1 text-xs font-semibold text-muted-foreground">{group.section}</p>}
            <dl className="space-y-1">
              {group.fields.map((f) => (
                <div key={f.key} className="flex flex-wrap gap-x-2">
                  <dt className="font-medium">{label(f)}:</dt>
                  <dd className="min-w-0 whitespace-pre-wrap break-words">{displayValue(f, values[f.key])}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="structured-report">
      {groupBySection(fields).map((group, i) => (
        <fieldset key={`${group.section ?? ""}-${i}`} className="space-y-3 rounded-xl border p-3.5">
          {group.section && <legend className="px-1 text-sm font-semibold">{group.section}</legend>}
          {group.fields.map((f) => {
            const id = `report-field-${f.key}`;
            const value = values[f.key];
            const text = value === null || value === undefined ? "" : String(value);
            return (
              <div key={f.key} className="space-y-1.5">
                <label htmlFor={id} className="block text-xs font-medium">
                  {label(f)}
                  {f.is_required && <span className="text-destructive ms-0.5">*</span>}
                  {f.field_type === "NUMBER" && f.max_value ? (
                    <span className="text-muted-foreground ms-1 font-normal">/ {f.max_value}</span>
                  ) : null}
                </label>
                {f.field_type === "NUMBER" && f.max_value && f.max_value <= MAX_PICKER ? (
                  <div id={id} role="radiogroup" aria-label={label(f)} className="flex flex-wrap gap-1.5">
                    {Array.from({ length: f.max_value + 1 }, (_, n) => {
                      const selected = text !== "" && Number(text) === n;
                      return (
                        <button
                          key={n}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          disabled={disabled}
                          data-testid={`score-${f.key}-${n}`}
                          // Tapping the chosen score again clears it.
                          onClick={() => set(f.key, selected ? null : n)}
                          className={cn(
                            "size-9 rounded-lg border text-sm font-semibold tabular-nums transition-colors disabled:opacity-50",
                            selected
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-input bg-background hover:border-primary/50",
                          )}
                        >
                          {n}
                        </button>
                      );
                    })}
                  </div>
                ) : f.field_type === "NUMBER" ? (
                  <input
                    id={id}
                    type="number"
                    inputMode="decimal"
                    min={f.max_value ? 0 : undefined}
                    max={f.max_value ?? undefined}
                    value={text}
                    disabled={disabled}
                    onChange={(e) => set(f.key, e.target.value === "" ? null : Number(e.target.value))}
                    className={cn(inputClass, "max-w-32 tabular-nums")}
                  />
                ) : (f.field_type === "SELECT" || f.field_type === "RATING") && f.options?.length ? (
                  <div id={id} role="radiogroup" aria-label={label(f)} className="flex flex-wrap gap-1.5">
                    {f.options.map((option) => {
                      const selected = text === option;
                      return (
                        <button
                          key={option}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          disabled={disabled}
                          onClick={() => set(f.key, selected ? null : option)}
                          className={cn(
                            "rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50",
                            selected
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-input bg-background hover:border-primary/50",
                          )}
                        >
                          {option}
                        </button>
                      );
                    })}
                  </div>
                ) : f.field_type === "TEXTAREA" ? (
                  <textarea
                    id={id}
                    dir="auto"
                    rows={3}
                    value={text}
                    disabled={disabled}
                    onChange={(e) => set(f.key, e.target.value)}
                    className={cn(inputClass, "resize-y")}
                  />
                ) : (
                  <input
                    id={id}
                    dir="auto"
                    value={text}
                    disabled={disabled}
                    onChange={(e) => set(f.key, e.target.value)}
                    className={inputClass}
                  />
                )}
              </div>
            );
          })}
        </fieldset>
      ))}
    </div>
  );
}
