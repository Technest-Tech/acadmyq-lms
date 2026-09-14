"use client";

import { CheckSquare, GraduationCap, Hash, Loader2, Search, Square, User, Users, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Field, FieldGroup, inputClass, Segmented, textareaClass } from "./editor-fields";
import { serialAt } from "./export";
import { listStudents, type StudentRow } from "@/lib/api";
import { cn } from "@/lib/utils";

export type IssueMode = "single" | "bulk";

/** Most names a single batch will render — one capture per page, so this bounds a slow download. */
export const BULK_LIMIT = 100;

export interface RecipientState {
  mode: IssueMode;
  name: string;
  courseTitle: string;
  date: string;
  serial: string;
  /** Bulk: chosen students, in the order they were ticked. */
  students: { id: string; name: string }[];
  /** Bulk: free-typed names, one per line — people who are not in the student list. */
  extraNames: string;
}

/**
 * Everyone a bulk run will print, capped at {@link BULK_LIMIT}. Ticked students are distinct people
 * even when two share a name, so each keeps a certificate; a typed name already on the list — ticked
 * or typed — is printed once.
 */
export function bulkNames(state: RecipientState): string[] {
  const names = state.students.map((s) => s.name.trim()).filter(Boolean);
  const seen = new Set(names);
  for (const raw of state.extraNames.split("\n")) {
    const name = raw.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names.slice(0, BULK_LIMIT);
}

function uniqueStudents(rows: StudentRow[]): StudentRow[] {
  const seen = new Set<string>();
  return rows.filter((s) => {
    if (s.deleted_at || seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });
}

/** Server-side student search, debounced; `enabled` false never calls the API. */
function useStudentSearch(query: string, enabled: boolean, pageSize: number) {
  const [rows, setRows] = useState<StudentRow[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setLoading(true);
    const timer = window.setTimeout(() => {
      listStudents({ search: query.trim() || undefined, pageSize })
        // The list joins subscriptions and teacher assignments, so one student can come back on
        // several rows — collapse them, or ticking a row would toggle the same person twice.
        .then((r) => alive && setRows(uniqueStudents(r.rows)))
        .catch(() => alive && setRows([]))
        .finally(() => alive && setLoading(false));
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [query, enabled, pageSize]);

  return { rows, loading };
}

export function RecipientPanel({
  state,
  onChange,
  canSearchStudents,
}: {
  state: RecipientState;
  onChange: (patch: Partial<RecipientState>) => void;
  canSearchStudents: boolean;
}) {
  const t = useTranslations("certificates");
  const names = bulkNames(state);
  const firstSerial = serialAt(state.serial, 0);
  const lastSerial = serialAt(state.serial, Math.max(0, names.length - 1));

  return (
    <div className="space-y-5">
      <Segmented
        className="flex w-full"
        testId="issue-mode"
        value={state.mode}
        onChange={(mode) => onChange({ mode })}
        options={[
          { value: "single", label: t("modeSingle"), icon: User },
          { value: "bulk", label: t("modeBulk"), icon: Users },
        ]}
      />

      {state.mode === "single" ? (
        <FieldGroup icon={User} title={t("recipientHeading")}>
          <StudentNameInput
            value={state.name}
            onChange={(name) => onChange({ name })}
            canSearch={canSearchStudents}
          />
        </FieldGroup>
      ) : (
        <FieldGroup
          icon={Users}
          title={t("bulkHeading")}
          action={
            <span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums" data-testid="bulk-count">
              {t("bulkCount", { count: names.length })}
            </span>
          }
        >
          {canSearchStudents ? (
            <StudentChecklist selected={state.students} onChange={(students) => onChange({ students })} />
          ) : (
            <p className="bg-muted/50 text-muted-foreground rounded-lg px-3 py-2 text-xs">{t("bulkNoStudentAccess")}</p>
          )}

          <Field id="cert-extra-names" label={t("extraNames")} hint={t("extraNamesHint", { limit: BULK_LIMIT })} optional optionalLabel={t("optional")}>
            <textarea
              id="cert-extra-names"
              rows={3}
              value={state.extraNames}
              placeholder={t("extraNamesPlaceholder")}
              onChange={(e) => onChange({ extraNames: e.target.value })}
              className={textareaClass}
            />
          </Field>
        </FieldGroup>
      )}

      <FieldGroup icon={GraduationCap} title={t("detailsHeading")}>
        <Field id="cert-course" label={t("courseTitle")} hint={t("courseTitleHint")} optional optionalLabel={t("optional")}>
          <input
            id="cert-course"
            value={state.courseTitle}
            maxLength={120}
            placeholder={t("courseTitlePlaceholder")}
            onChange={(e) => onChange({ courseTitle: e.target.value })}
            className={inputClass}
          />
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field id="cert-date" label={t("date")}>
            <input
              id="cert-date"
              type="date"
              value={state.date}
              onChange={(e) => onChange({ date: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field id="cert-serial" label={state.mode === "bulk" ? t("serialStart") : t("serial")} optional optionalLabel={t("optional")}>
            <div className="relative">
              <Hash className="text-muted-foreground pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2" aria-hidden />
              <input
                id="cert-serial"
                dir="ltr"
                value={state.serial}
                maxLength={40}
                placeholder="2026-001"
                onChange={(e) => onChange({ serial: e.target.value })}
                className={cn(inputClass, "ps-8 text-start")}
              />
            </div>
          </Field>
        </div>
        {state.mode === "bulk" && firstSerial && names.length > 1 && (
          <p className="text-muted-foreground text-[11px]" dir="auto">
            {t("serialRange", { first: firstSerial, last: lastSerial })}
          </p>
        )}
      </FieldGroup>
    </div>
  );
}

/** A free-text name with the academy's students offered as suggestions. */
function StudentNameInput({
  value,
  onChange,
  canSearch,
}: {
  value: string;
  onChange: (name: string) => void;
  canSearch: boolean;
}) {
  const t = useTranslations("certificates");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const listId = useId();
  const blurTimer = useRef<number | undefined>(undefined);
  const { rows, loading } = useStudentSearch(value, canSearch && open, 8);
  const suggestions = (rows ?? []).filter((s) => s.full_name !== value);
  const showList = open && canSearch && (loading || suggestions.length > 0);

  const choose = (name: string) => {
    onChange(name);
    setOpen(false);
  };

  return (
    <Field id="cert-recipient" label={t("recipientName")} hint={canSearch ? t("recipientHint") : undefined}>
      <div className="relative">
        <User className="text-muted-foreground pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2" aria-hidden />
        <input
          id="cert-recipient"
          value={value}
          autoComplete="off"
          placeholder={t("recipientPlaceholder")}
          role={canSearch ? "combobox" : undefined}
          aria-expanded={canSearch ? showList : undefined}
          aria-controls={canSearch ? listId : undefined}
          aria-autocomplete={canSearch ? "list" : undefined}
          onFocus={() => {
            window.clearTimeout(blurTimer.current);
            setOpen(true);
          }}
          onBlur={() => {
            blurTimer.current = window.setTimeout(() => setOpen(false), 120);
          }}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setHighlight(0);
          }}
          onKeyDown={(e) => {
            if (!showList) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlight((h) => Math.max(h - 1, 0));
            } else if (e.key === "Enter" && suggestions[highlight]) {
              e.preventDefault();
              choose(suggestions[highlight].full_name);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          className={cn(inputClass, "ps-8")}
        />
        {showList && (
          <ul
            id={listId}
            role="listbox"
            className="bg-popover absolute inset-x-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-xl border p-1 shadow-xl"
          >
            {loading && suggestions.length === 0 ? (
              <li className="text-muted-foreground flex items-center gap-2 px-2.5 py-2 text-xs">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                {t("searching")}
              </li>
            ) : (
              suggestions.map((s, i) => (
                <li
                  key={s.id}
                  role="option"
                  aria-selected={i === highlight}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(s.full_name);
                  }}
                  onMouseEnter={() => setHighlight(i)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm",
                    i === highlight ? "bg-muted" : "",
                  )}
                >
                  <Initials name={s.full_name} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{s.full_name}</span>
                    {s.teacher_name && <span className="text-muted-foreground block truncate text-[11px]">{s.teacher_name}</span>}
                  </span>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </Field>
  );
}

/** Tick students for a batch. The search runs on the server, so a large academy stays fast. */
function StudentChecklist({
  selected,
  onChange,
}: {
  selected: { id: string; name: string }[];
  onChange: (students: { id: string; name: string }[]) => void;
}) {
  const t = useTranslations("certificates");
  const [query, setQuery] = useState("");
  const { rows, loading } = useStudentSearch(query, true, BULK_LIMIT);
  const selectedIds = useMemo(() => new Set(selected.map((s) => s.id)), [selected]);
  const shown = rows ?? [];
  const allShownSelected = shown.length > 0 && shown.every((s) => selectedIds.has(s.id));

  const toggle = (s: StudentRow) =>
    onChange(
      selectedIds.has(s.id)
        ? selected.filter((x) => x.id !== s.id)
        : [...selected, { id: s.id, name: s.full_name }].slice(0, BULK_LIMIT),
    );

  const toggleAllShown = () =>
    onChange(
      allShownSelected
        ? selected.filter((x) => !shown.some((s) => s.id === x.id))
        : [...selected, ...shown.filter((s) => !selectedIds.has(s.id)).map((s) => ({ id: s.id, name: s.full_name }))].slice(0, BULK_LIMIT),
    );

  return (
    <div className="overflow-hidden rounded-xl border" data-testid="student-checklist">
      <div className="bg-muted/30 flex items-center gap-2 border-b p-2">
        <div className="relative flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchStudents")}
            aria-label={t("searchStudents")}
            className={cn(inputClass, "h-8 ps-8")}
          />
        </div>
        <button
          type="button"
          onClick={toggleAllShown}
          disabled={shown.length === 0}
          className="text-primary hover:bg-primary/10 h-8 shrink-0 rounded-lg px-2.5 text-xs font-semibold transition-colors disabled:opacity-40"
        >
          {allShownSelected ? t("clearShown") : t("selectShown")}
        </button>
      </div>

      <ul className="max-h-60 overflow-y-auto p-1">
        {rows === null || (loading && shown.length === 0) ? (
          <li className="text-muted-foreground flex items-center justify-center gap-2 py-6 text-xs">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            {t("searching")}
          </li>
        ) : shown.length === 0 ? (
          <li className="text-muted-foreground py-6 text-center text-xs">{t("noStudents")}</li>
        ) : (
          shown.map((s) => {
            const checked = selectedIds.has(s.id);
            return (
              <li key={s.id}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  onClick={() => toggle(s)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-start text-sm transition-colors",
                    checked ? "bg-primary/[0.06]" : "hover:bg-muted/70",
                  )}
                >
                  {checked ? (
                    <CheckSquare className="text-primary size-4 shrink-0" aria-hidden />
                  ) : (
                    <Square className="text-muted-foreground/60 size-4 shrink-0" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{s.full_name}</span>
                    {s.teacher_name && <span className="text-muted-foreground block truncate text-[11px]">{s.teacher_name}</span>}
                  </span>
                </button>
              </li>
            );
          })
        )}
      </ul>

      {selected.length > 0 && (
        <div className="bg-muted/20 flex flex-wrap gap-1.5 border-t p-2">
          {selected.map((s) => (
            <span key={s.id} className="bg-background inline-flex max-w-full items-center gap-1 rounded-full border py-0.5 ps-2.5 pe-1 text-xs">
              <span className="truncate">{s.name}</span>
              <button
                type="button"
                aria-label={t("removeRecipient", { name: s.name })}
                onClick={() => onChange(selected.filter((x) => x.id !== s.id))}
                className="text-muted-foreground hover:bg-muted hover:text-foreground rounded-full p-0.5"
              >
                <X className="size-3" aria-hidden />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Initials({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => [...w][0] ?? "")
    .join("");
  return (
    <span className="bg-primary/10 text-primary flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold">
      {initials}
    </span>
  );
}
