"use client";

import { Banknote, CalendarCheck, Clock, Plus, Search, Users, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import {
  listStudents,
  TEACHER_PAY_TYPES,
  type TeacherInput,
  type TeacherPayType,
  type TeacherRow,
  type TeacherStudent,
  type TeacherStudentRate,
} from "@/lib/api";
import { CURRENCIES } from "@/lib/countries";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

const inputBase =
  "border-input bg-background placeholder:text-muted-foreground focus:border-primary focus:ring-primary/15 w-full rounded-xl border text-sm outline-none transition-colors focus:ring-3 disabled:cursor-not-allowed disabled:opacity-50";

const currencyOptions: ComboboxOption[] = CURRENCIES.map((c) => ({
  value: c.code,
  label: c.code,
  sublabel: c.name,
}));

const PAY_TYPE_ICONS: Record<TeacherPayType, typeof Clock> = {
  HOURLY: Clock,
  PER_STUDENT: Users,
  FIXED: CalendarCheck,
};

/** One student's rate as typed. An empty `rate` means "the teacher's default rate". */
export interface StudentRateDraft {
  student_id: string;
  full_name: string;
  rate: string;
  /** Currently assigned to this teacher — such a row is kept even when its rate is empty. */
  is_current: boolean;
}

/** The pay setup as the form holds it: amounts as typed (major units), not minor. */
export interface PayDraft {
  payType: TeacherPayType;
  /** Hourly rate — for PER_STUDENT, the default for students without their own. */
  rate: string;
  fixedSalary: string;
  currency: string;
  studentRates: StudentRateDraft[];
}

export const EMPTY_PAY_DRAFT: PayDraft = {
  payType: "HOURLY",
  rate: "",
  fixedSalary: "",
  currency: "EGP",
  studentRates: [],
};

function toMinor(major: string): number {
  return Math.round(parseFloat(major || "0") * 100);
}

function toMajor(minor: number): string {
  return (minor / 100).toString();
}

/**
 * The draft for an existing teacher: every current student gets a row (their rate, or empty for
 * the default), plus any rate still on file for a student who is not currently theirs.
 */
export function payDraftFromTeacher(
  teacher: TeacherRow,
  students: TeacherStudent[],
  rates: TeacherStudentRate[],
): PayDraft {
  const rows: StudentRateDraft[] = students.map((s) => ({
    student_id: s.id,
    full_name: s.full_name,
    rate: s.rate_minor == null ? "" : toMajor(s.rate_minor),
    is_current: true,
  }));
  const seen = new Set(rows.map((r) => r.student_id));
  for (const r of rates) {
    if (seen.has(r.student_id)) continue;
    rows.push({
      student_id: r.student_id,
      full_name: r.full_name,
      rate: toMajor(r.rate_minor),
      is_current: false,
    });
  }

  return {
    payType: teacher.pay_type ?? "HOURLY",
    rate: toMajor(teacher.session_rate_minor),
    fixedSalary: teacher.fixed_salary_minor ? toMajor(teacher.fixed_salary_minor) : "",
    currency: teacher.currency,
    studentRates: rows,
  };
}

/**
 * The API fields for a draft. Rates for other pay types are still sent, so switching a teacher
 * from per-student to hourly and back does not throw away the per-student rates.
 */
export function payDraftToInput(
  draft: PayDraft,
): Pick<
  TeacherInput,
  "pay_type" | "session_rate_minor" | "fixed_salary_minor" | "currency" | "student_rates"
> {
  return {
    pay_type: draft.payType,
    session_rate_minor: toMinor(draft.rate),
    fixed_salary_minor: draft.payType === "FIXED" ? toMinor(draft.fixedSalary) : 0,
    currency: draft.currency || undefined,
    student_rates: draft.studentRates
      .filter((r) => r.rate.trim() !== "")
      .map((r) => ({ student_id: r.student_id, rate_minor: toMinor(r.rate) })),
  };
}

/**
 * How a teacher is paid, in one line — for the list, the fact strip and anywhere else that
 * used to print a bare hourly rate.
 */
export function usePaySummary() {
  const t = useTranslations("teachers");
  const locale = useLocale();

  return useCallback(
    (teacher: Pick<TeacherRow, "pay_type" | "session_rate_minor" | "fixed_salary_minor" | "currency">) => {
      const money = (amount: number) => formatMoney({ amount, currency: teacher.currency }, locale);
      switch (teacher.pay_type) {
        case "FIXED":
          return { value: money(teacher.fixed_salary_minor), sub: t("pay.summaryFixed") };
        case "PER_STUDENT":
          return {
            value: t("pay.type.PER_STUDENT"),
            sub: t("pay.summaryPerStudent", { rate: money(teacher.session_rate_minor) }),
          };
        default:
          return { value: money(teacher.session_rate_minor), sub: t("fact.perHour") };
      }
    },
    [t, locale],
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">{label}</label>
      {children}
      {hint && <p className="text-muted-foreground text-[11px]">{hint}</p>}
    </div>
  );
}

function MoneyInput({
  label,
  value,
  onChange,
  disabled,
  required,
  placeholder,
  testId,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  testId?: string;
}) {
  return (
    <div className="relative">
      <Banknote className="text-muted-foreground pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2" />
      <input
        type="number"
        step="0.01"
        min="0"
        inputMode="decimal"
        aria-label={label}
        className={cn(inputBase, "py-2.5 ps-10 pe-3.5 tabular-nums")}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testId}
      />
    </div>
  );
}

/**
 * The teacher's pay: a pay type, then only the amounts that type needs.
 *
 * Per-student rates are listed student by student, current students first. An empty rate is not
 * zero — it means "the default rate", and the input shows that default as its placeholder, so the
 * difference between "not set" and "free" is visible where it is typed.
 */
export function TeacherPayEditor({
  value,
  onChange,
  disabled,
  required,
}: {
  value: PayDraft;
  onChange: (next: PayDraft) => void;
  disabled?: boolean;
  /** Make the amount the pay type needs a required field (the create form). */
  required?: boolean;
}) {
  const t = useTranslations("teachers");
  const locale = useLocale();
  const set = (patch: Partial<PayDraft>) => onChange({ ...value, ...patch });

  const defaultRateLabel = value.rate
    ? formatMoney({ amount: toMinor(value.rate), currency: value.currency }, locale)
    : null;

  function setStudentRate(studentId: string, rate: string) {
    set({
      studentRates: value.studentRates.map((r) =>
        r.student_id === studentId ? { ...r, rate } : r,
      ),
    });
  }

  function removeStudent(studentId: string) {
    set({ studentRates: value.studentRates.filter((r) => r.student_id !== studentId) });
  }

  function addStudent(student: { id: string; full_name: string }) {
    if (value.studentRates.some((r) => r.student_id === student.id)) return;
    set({
      studentRates: [
        ...value.studentRates,
        { student_id: student.id, full_name: student.full_name, rate: "", is_current: false },
      ],
    });
  }

  return (
    <div className="space-y-4" data-testid="teacher-pay-editor">
      {/* ── Pay type ─────────────────────────────────────────────────── */}
      <div className="space-y-1.5">
        <span className="text-sm font-medium">{t("pay.typeLabel")}</span>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup" aria-label={t("pay.typeLabel")}>
          {TEACHER_PAY_TYPES.map((type) => {
            const Icon = PAY_TYPE_ICONS[type];
            const active = value.payType === type;
            return (
              <button
                key={type}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={disabled}
                onClick={() => set({ payType: type })}
                data-testid={`pay-type-${type}`}
                className={cn(
                  "flex items-center gap-2 rounded-xl border px-3 py-2.5 text-start text-sm font-medium transition-colors",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                  active
                    ? "border-primary/40 bg-primary/8 text-primary"
                    : "border-input bg-background text-muted-foreground hover:bg-muted/40",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                {t(`pay.type.${type}`)}
              </button>
            );
          })}
        </div>
        <p className="text-muted-foreground text-xs">{t(`pay.typeHint.${value.payType}`)}</p>
      </div>

      {/* ── Amount + currency ───────────────────────────────────────────
          The amount and its currency are one decision — they sit on one row so nobody changes
          80 → 90 without noticing it is EGP and not USD. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {value.payType === "FIXED" ? (
          <Field label={t("pay.monthlySalary")}>
            <MoneyInput
              label={t("pay.monthlySalary")}
              value={value.fixedSalary}
              onChange={(fixedSalary) => set({ fixedSalary })}
              disabled={disabled}
              required={required}
              testId="pay-fixed-salary"
            />
          </Field>
        ) : (
          <Field label={value.payType === "PER_STUDENT" ? t("pay.defaultRate") : t("form.rate")}>
            <MoneyInput
              label={value.payType === "PER_STUDENT" ? t("pay.defaultRate") : t("form.rate")}
              value={value.rate}
              onChange={(rate) => set({ rate })}
              disabled={disabled}
              required={required && value.payType === "HOURLY"}
              testId="pay-rate"
            />
          </Field>
        )}

        <Field label={t("form.currency")}>
          <Combobox
            options={currencyOptions}
            value={value.currency}
            onChange={(currency) => set({ currency })}
            placeholder={t("form.currency")}
            searchPlaceholder={t("form.searchCurrency")}
            disabled={disabled}
            data-testid="currency-select"
          />
        </Field>
      </div>

      {/* ── Per-student rates ────────────────────────────────────────── */}
      {value.payType === "PER_STUDENT" && (
        <div className="space-y-2 rounded-xl border bg-muted/15 p-3" data-testid="student-rates">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="text-sm font-medium">{t("pay.studentRates")}</span>
            <span className="text-muted-foreground text-[11px]">
              {defaultRateLabel
                ? t("pay.emptyUsesDefault", { rate: defaultRateLabel })
                : t("pay.emptyUsesDefaultNone")}
            </span>
          </div>

          {value.studentRates.length === 0 ? (
            <p className="text-muted-foreground rounded-lg border border-dashed px-3 py-4 text-center text-xs">
              {t("pay.noStudentRates")}
            </p>
          ) : (
            <ul className="divide-border/70 divide-y overflow-hidden rounded-lg border bg-background">
              {value.studentRates.map((r) => (
                <li
                  key={r.student_id}
                  className="flex items-center gap-2 px-3 py-2"
                  data-student-rate={r.student_id}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{r.full_name}</div>
                    {!r.is_current && (
                      <div className="text-muted-foreground text-[11px]">{t("pay.notAssigned")}</div>
                    )}
                  </div>
                  <div className="relative w-28 shrink-0 sm:w-32">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      inputMode="decimal"
                      aria-label={t("pay.rateFor", { name: r.full_name })}
                      className={cn(inputBase, "py-1.5 ps-2.5 pe-9 tabular-nums")}
                      value={r.rate}
                      placeholder={value.rate || "0"}
                      disabled={disabled}
                      onChange={(e) => setStudentRate(r.student_id, e.target.value)}
                    />
                    <span className="text-muted-foreground pointer-events-none absolute end-2.5 top-1/2 -translate-y-1/2 text-[11px]">
                      {t("pay.perHourShort")}
                    </span>
                  </div>
                  {/* A current student is always listed — emptying their rate is how they go back
                      to the default. Only an extra row can be taken off the list. */}
                  {r.is_current ? (
                    <span className="size-7 shrink-0" aria-hidden />
                  ) : (
                    <button
                      type="button"
                      aria-label={t("pay.removeStudent", { name: r.full_name })}
                      disabled={disabled}
                      onClick={() => removeStudent(r.student_id)}
                      className="text-muted-foreground hover:bg-muted hover:text-foreground flex size-7 shrink-0 items-center justify-center rounded-lg disabled:opacity-50"
                    >
                      <X className="size-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {!disabled && (
            <StudentSearch
              excludeIds={value.studentRates.map((r) => r.student_id)}
              onPick={addStudent}
            />
          )}
        </div>
      )}

      <p className="text-muted-foreground text-[11px]">
        {value.payType === "FIXED" ? t("pay.fixedNote") : t("pay.proRateNote")}
      </p>
    </div>
  );
}

/**
 * Find a student to give a rate to. Searches the server rather than a preloaded list: an academy
 * with 500 students would otherwise only ever offer the first page of them.
 */
function StudentSearch({
  excludeIds,
  onPick,
}: {
  excludeIds: string[];
  onPick: (student: { id: string; full_name: string }) => void;
}) {
  const t = useTranslations("teachers");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ id: string; full_name: string }[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void listStudents({ search: q, pageSize: 8 })
        .then((res) => {
          if (!cancelled) setResults(res.rows.map((s) => ({ id: s.id, full_name: s.full_name })));
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const visible = useMemo(
    () => results.filter((s) => !excludeIds.includes(s.id)),
    [results, excludeIds],
  );

  return (
    <div className="relative">
      <Search className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-3.5 -translate-y-1/2" />
      <input
        type="search"
        aria-label={t("pay.addStudent")}
        placeholder={t("pay.addStudent")}
        className={cn(inputBase, "py-2 ps-9 pe-3")}
        value={query}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        data-testid="student-rate-search"
      />
      {open && visible.length > 0 && (
        <ul className="bg-popover absolute inset-x-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-xl border p-1 shadow-lg">
          {visible.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                // mousedown, not click: the input's blur would close the list before a click lands.
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPick(s);
                  setQuery("");
                  setResults([]);
                }}
                className="hover:bg-muted flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start text-sm"
              >
                <Plus className="text-primary size-3.5 shrink-0" aria-hidden />
                <span className="truncate">{s.full_name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
