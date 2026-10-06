"use client";

import { BookOpen, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useMemo } from "react";
import { Combobox } from "@/components/ui/combobox";
import type { StudentTeacherInput, TeacherRow } from "@/lib/api";
import { cn } from "@/lib/utils";

/** One row of the editor. `course` is free text; blank means "no course named". */
export interface TeacherLinkDraft {
  teacher_id: string;
  course: string;
}

/** The rows a save should send: chosen teachers only, blank courses as null. */
export function toTeacherInputs(rows: TeacherLinkDraft[]): StudentTeacherInput[] {
  return rows
    .filter((r) => r.teacher_id)
    .map((r) => ({ teacher_id: r.teacher_id, course: r.course.trim() || null }));
}

/** "A, B and C" in the reader's language — for teacher names on one line. */
export function formatNameList(names: (string | null | undefined)[], locale: string): string {
  const clean = names.filter((n): n is string => Boolean(n));
  try {
    return new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(clean);
  } catch {
    return clean.join(", ");
  }
}

const inputBase =
  "border-input bg-background placeholder:text-muted-foreground focus:border-primary focus:ring-primary/15 w-full rounded-xl border text-sm outline-none transition-colors focus:ring-3 disabled:cursor-not-allowed disabled:opacity-50";

/**
 * The student's teachers as an editable list — a teacher and the course they teach per row.
 * A student may study Qur'an with one teacher and Arabic with another, so this is a list, not a
 * picker. Each teacher can be chosen once (the API refuses the same pair twice). Picking a teacher
 * pre-fills the course from their specialization when the row has none yet.
 */
export function TeacherLinksField({
  value,
  onChange,
  teachers,
  disabled,
}: {
  value: TeacherLinkDraft[];
  onChange: (rows: TeacherLinkDraft[]) => void;
  teachers: TeacherRow[];
  disabled?: boolean;
}) {
  const t = useTranslations("students");
  const listId = useId();

  // Course suggestions: what the academy's teachers specialise in, plus courses already typed.
  const suggestions = useMemo(() => {
    const set = new Set<string>();
    for (const tch of teachers) if (tch.specialization?.trim()) set.add(tch.specialization.trim());
    for (const row of value) if (row.course.trim()) set.add(row.course.trim());
    return [...set];
  }, [teachers, value]);

  function update(i: number, patch: Partial<TeacherLinkDraft>) {
    onChange(value.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  function pickTeacher(i: number, teacherId: string) {
    const row = value[i];
    const specialization = teachers.find((tch) => tch.id === teacherId)?.specialization?.trim();
    update(i, {
      teacher_id: teacherId,
      course: row?.course.trim() ? row.course : (specialization ?? ""),
    });
  }

  return (
    <div className="space-y-2.5" data-testid="teacher-links">
      <datalist id={listId}>
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>

      {value.map((row, i) => {
        // A teacher already on another row is not offered again.
        const taken = new Set(value.filter((_, idx) => idx !== i).map((r) => r.teacher_id));
        const options = teachers
          .filter((tch) => !taken.has(tch.id))
          .map((tch) => ({
            value: tch.id,
            label: tch.full_name,
            sublabel: tch.specialization ?? undefined,
          }));
        return (
          <div
            key={i}
            data-teacher-row={i}
            className="grid grid-cols-1 items-end gap-2.5 rounded-xl border bg-muted/20 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
          >
            <div className="space-y-1">
              <span className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">
                {t("form.teacher")}
              </span>
              <Combobox
                options={options}
                value={row.teacher_id}
                onChange={(v) => pickTeacher(i, v)}
                placeholder={t("teacher.pickTeacher")}
                searchPlaceholder={t("teacher.searchTeacher")}
                disabled={disabled}
                data-testid={`teacher-link-select-${i}`}
              />
            </div>
            <div className="space-y-1">
              <span className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">
                {t("teacher.course")}
              </span>
              <div className="relative">
                <BookOpen className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-3.5 -translate-y-1/2" />
                <input
                  list={listId}
                  aria-label={t("teacher.course")}
                  className={cn(inputBase, "py-2 ps-9 pe-3")}
                  placeholder={t("teacher.coursePlaceholder")}
                  value={row.course}
                  maxLength={120}
                  disabled={disabled}
                  onChange={(e) => update(i, { course: e.target.value })}
                  data-testid={`teacher-link-course-${i}`}
                />
              </div>
            </div>
            <button
              type="button"
              aria-label={t("teacher.removeTeacher")}
              disabled={disabled}
              onClick={() => onChange(value.filter((_, idx) => idx !== i))}
              className="flex size-10 items-center justify-center justify-self-end rounded-xl border text-muted-foreground transition-colors hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
              data-testid={`teacher-link-remove-${i}`}
            >
              <Trash2 className="size-4" aria-hidden />
            </button>
          </div>
        );
      })}

      <button
        type="button"
        disabled={disabled || value.length >= teachers.length}
        onClick={() => onChange([...value, { teacher_id: "", course: "" }])}
        className="group flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border py-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary disabled:pointer-events-none disabled:opacity-50"
        data-testid="add-teacher-link"
      >
        <span className="flex size-6 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:bg-primary/15 group-hover:text-primary">
          <Plus className="size-4" />
        </span>
        {value.length === 0 ? t("teacher.addTeacher") : t("teacher.addAnother")}
      </button>
    </div>
  );
}
