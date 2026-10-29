"use client";

import { CalendarClock, Clock, GraduationCap, Mail, User, UserPlus, Users } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { dayAsDate } from "@/components/trials/trial-time";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Combobox, DialCodePicker, type ComboboxOption } from "@/components/ui/combobox";
import {
  ApiError,
  createTrial,
  listStudents,
  listTrialTeachers,
  type StudentRow,
} from "@/lib/api";
import { fetchRoster } from "@/lib/roster";
import { COUNTRIES } from "@/lib/countries";
import { useAcademyDefaults } from "@/lib/academy-defaults";
import { cn } from "@/lib/utils";

const inputBase =
  "border-input bg-background placeholder:text-muted-foreground focus:border-primary focus:ring-primary/15 w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none transition-colors focus:ring-3 disabled:opacity-50";

const FALLBACK_DURATIONS = [15, 30, 45, 60, 90, 120];

const dialOptions: ComboboxOption[] = COUNTRIES.map((c) => ({
  value: c.code,
  label: c.name,
  sublabel: c.dialCode,
  pre: c.flag,
}));

type Who = "new" | "student";

function Field({
  label,
  icon: Icon,
  required,
  children,
}: {
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1.5 text-sm font-medium">
        {Icon && <Icon className="text-muted-foreground size-3.5" />}
        {label}
        {required && <span className="text-destructive">*</span>}
      </label>
      {children}
    </div>
  );
}

/**
 * "Add a trial" straight from the trials page — for the walk-in, the phone call, the sibling of a
 * current student: anyone who does not need to go through the CRM pipeline first. Either a NEW
 * person (name + WhatsApp, stored on the trial itself — no phantom student is created) or an
 * EXISTING student trying another teacher or subject.
 *
 * The date and time are the academy's wall clock (the timezone comes back with the roster), so a
 * trial typed in as 17:00 is 17:00 at the academy wherever the owner happens to be. A clash comes
 * back as a warning, never a refusal — the person booking knows things the roster does not.
 */
export function AddTrialForm({
  defaultDay,
  onBooked,
  onCancel,
}: {
  /** The day the board is looking at — usually what the owner means by "add one". */
  defaultDay: string;
  /** `day` is the academy-local day booked, so the board can jump to it. */
  onBooked: (result: { day: string; warnings: string[] }) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("trials");
  const locale = useLocale();

  const [teachers, setTeachers] = useState<{ id: string; full_name: string }[]>([]);
  const [durations, setDurations] = useState<number[]>(FALLBACK_DURATIONS);
  const [timezone, setTimezone] = useState<string | null>(null);
  const [students, setStudents] = useState<StudentRow[] | null>(null);

  const [who, setWho] = useState<Who>("new");
  const [name, setName] = useState("");
  // The academy's own defaults (Settings → Academy) open the pickers; the form can still change them.
  const defaults = useAcademyDefaults();
  const [dialCountry, setDialCountry] = useState(defaults.dialCountry);
  const [localNumber, setLocalNumber] = useState("");
  const [email, setEmail] = useState("");
  const [studentId, setStudentId] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [date, setDate] = useState(defaultDay);
  const [time, setTime] = useState("17:00");
  const [duration, setDuration] = useState(30);
  const [notes, setNotes] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void listTrialTeachers()
      .then((r) => {
        if (!alive) return;
        setTeachers(r.teachers);
        if (r.durations.length > 0) setDurations(r.durations);
        setTimezone(r.timezone);
        // One teacher on the roster is not a choice — pick them.
        if (r.teachers.length === 1) setTeacherId((prev) => prev || r.teachers[0]!.id);
      })
      .catch((err) => alive && setError(err instanceof ApiError ? err.message : String(err)));
    return () => {
      alive = false;
    };
  }, []);

  // The student list is only worth fetching once someone asks for it.
  useEffect(() => {
    if (who !== "student" || students !== null) return;
    let alive = true;
    void fetchRoster(listStudents)
      .then((r) => alive && setStudents(r.rows))
      .catch(() => alive && setStudents([]));
    return () => {
      alive = false;
    };
  }, [who, students]);

  function phone(): string | null {
    // A local number typed with its trunk zero ("010…") must not become "+20010…".
    const digits = localNumber.replace(/^0+/, "");
    if (!digits) return null;
    const dial = COUNTRIES.find((c) => c.code === dialCountry)?.dialCode ?? "";
    return dial + digits;
  }

  async function submit() {
    if (who === "new" && !name.trim()) return setError(t("add.nameRequired"));
    if (who === "new" && !phone()) return setError(t("add.phoneRequired"));
    if (who === "student" && !studentId) return setError(t("add.studentRequired"));
    if (!teacherId) return setError(t("add.teacherRequired"));
    if (!date || !time) return setError(t("add.slotRequired"));

    setBusy(true);
    setError(null);
    try {
      const res = await createTrial({
        teacher_id: teacherId,
        ...(who === "student"
          ? { student_id: studentId }
          : { lead_name: name.trim(), lead_whatsapp: phone(), lead_email: email.trim() || null }),
        local_datetime: `${date} ${time}`,
        timezone: timezone ?? undefined,
        duration_minutes: duration,
        outcome_notes: notes.trim() || null,
      });
      onBooked({ day: date, warnings: res.warnings.map((w) => w.message) });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const teacherName = teachers.find((tch) => tch.id === teacherId)?.full_name;
  const personName =
    who === "student" ? students?.find((s) => s.id === studentId)?.full_name : name.trim();

  return (
    <div className="space-y-5" data-testid="add-trial-form">
      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}

      {/* Who is it for */}
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("add.who")}>
        {(
          [
            ["new", UserPlus, t("add.newPerson")],
            ["student", Users, t("add.existingStudent")],
          ] as const
        ).map(([key, Icon, label]) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={who === key}
            onClick={() => setWho(key)}
            data-testid={`add-trial-who-${key}`}
            className={cn(
              "flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors",
              who === key
                ? "border-primary bg-primary/10 text-primary ring-primary/20 ring-2"
                : "border-input text-muted-foreground hover:bg-muted/40",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </button>
        ))}
      </div>

      {who === "new" ? (
        <>
          <Field label={t("add.name")} icon={User} required>
            <input
              aria-label={t("add.name")}
              className={inputBase}
              placeholder={t("add.namePlaceholder")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="add-trial-name"
            />
          </Field>
          <Field label={t("add.phone")} required>
            <div
              dir="ltr"
              className="border-input focus-within:border-primary focus-within:ring-primary/20 flex h-10 overflow-hidden rounded-xl border transition-all focus-within:ring-2"
            >
              <DialCodePicker
                options={dialOptions}
                value={dialCountry}
                onChange={setDialCountry}
                searchPlaceholder="Country or code…"
              />
              <input
                dir="ltr"
                type="tel"
                inputMode="numeric"
                aria-label={t("add.phone")}
                placeholder="1012345678"
                value={localNumber}
                onChange={(e) => setLocalNumber(e.target.value.replace(/[^\d]/g, ""))}
                className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent px-3 text-sm outline-none"
                data-testid="add-trial-phone"
              />
            </div>
          </Field>
          <Field label={t("add.email")} icon={Mail}>
            <input
              type="email"
              dir="ltr"
              aria-label={t("add.email")}
              className={inputBase}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
        </>
      ) : (
        <Field label={t("add.student")} icon={Users} required>
          <Combobox
            options={(students ?? []).map((s) => ({
              value: s.id,
              label: s.full_name,
              sublabel: s.whatsapp_phone ?? undefined,
            }))}
            value={studentId}
            onChange={setStudentId}
            placeholder={students === null ? t("add.loading") : t("add.selectStudent")}
            searchPlaceholder={t("add.searchStudent")}
            disabled={students === null}
            data-testid="add-trial-student"
          />
        </Field>
      )}

      <Field label={t("add.teacher")} icon={GraduationCap} required>
        <Combobox
          options={teachers.map((tch) => ({ value: tch.id, label: tch.full_name }))}
          value={teacherId}
          onChange={setTeacherId}
          placeholder={t("add.selectTeacher")}
          searchPlaceholder={t("add.searchTeacher")}
          data-testid="add-trial-teacher"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t("add.date")} icon={CalendarClock} required>
          <input
            type="date"
            aria-label={t("add.date")}
            className={inputBase}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            data-testid="add-trial-date"
          />
        </Field>
        <Field label={t("add.time")} icon={Clock} required>
          <input
            type="time"
            aria-label={t("add.time")}
            className={inputBase}
            value={time}
            onChange={(e) => setTime(e.target.value)}
            data-testid="add-trial-time"
          />
        </Field>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">{t("add.duration")}</label>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {durations.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDuration(d)}
              aria-pressed={duration === d}
              className={cn(
                "rounded-xl border py-2 text-xs font-semibold transition-colors",
                duration === d
                  ? "border-primary bg-primary/10 text-primary ring-primary/20 ring-2"
                  : "border-input text-muted-foreground hover:bg-muted/40",
              )}
            >
              {t("table.minutes", { count: d })}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">{t("add.notes")}</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder={t("add.notesPlaceholder")}
          className={inputBase}
        />
      </div>

      {/* What is about to be written, read back in words. */}
      {teacherId && date && time && (
        <div className="rounded-xl border bg-gradient-to-br from-sky-500/[0.07] to-transparent px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-sky-600/80 dark:text-sky-400/70">
            {t("add.preview")}
          </p>
          <p className="mt-1 text-sm font-semibold">
            {new Intl.DateTimeFormat(locale, {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
              timeZone: "UTC",
            }).format(dayAsDate(date))}
          </p>
          <p className="text-muted-foreground text-xs">
            <span dir="ltr">{time}</span> · {t("table.minutes", { count: duration })}
            {teacherName ? ` · ${teacherName}` : ""}
            {personName ? ` · ${personName}` : ""}
            {timezone ? ` · ${timezone.replace(/_/g, " ")}` : ""}
          </p>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t pt-4">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          {t("add.cancel")}
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => void submit()}
          disabled={busy}
          className="gap-1.5"
          data-testid="add-trial-submit"
        >
          {busy ? (
            <span className="size-3.5 animate-spin rounded-full border border-current border-t-transparent" />
          ) : (
            <CalendarClock className="size-3.5" aria-hidden />
          )}
          {t("add.submit")}
        </Button>
      </div>
    </div>
  );
}
