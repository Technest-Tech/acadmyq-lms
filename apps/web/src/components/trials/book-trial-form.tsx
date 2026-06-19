"use client";

import { CalendarClock, Mail, User, UserPlus, Users } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Combobox, DialCodePicker, type ComboboxOption } from "@/components/ui/combobox";
import {
  ApiError,
  createTrial,
  listStudents,
  type StudentRow,
  type TrialAvailabilityTeacher,
} from "@/lib/api";
import { COUNTRIES } from "@/lib/countries";
import { formatHm12 } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { TrialSlot } from "@/components/trials/trial-finder";

const inputBase =
  "border-input bg-background placeholder:text-muted-foreground focus:border-primary focus:ring-primary/15 w-full rounded-xl border text-sm outline-none transition-colors focus:ring-3 disabled:opacity-50";

const dialOptions: ComboboxOption[] = COUNTRIES.map((c) => ({
  value: c.code,
  label: c.name,
  sublabel: c.dialCode,
  pre: c.flag,
}));

type Mode = "existing" | "lead";

/**
 * Books a trial for the teacher + slot chosen in the finder. Two paths: pick an existing student,
 * or capture a brand-new lead (name + WhatsApp required, email optional). The slot is sent as a
 * local wall-clock + timezone so the API converts it to UTC consistently.
 */
export function BookTrialForm({
  teacher,
  slot,
  onBooked,
  onCancel,
}: {
  teacher: TrialAvailabilityTeacher;
  slot: TrialSlot;
  onBooked: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("trials");
  const locale = useLocale();
  const [mode, setMode] = useState<Mode>("existing");
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [studentId, setStudentId] = useState("");

  const [leadName, setLeadName] = useState("");
  const [dialCountry, setDialCountry] = useState("SA");
  const [localNumber, setLocalNumber] = useState("");
  const [leadEmail, setLeadEmail] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listStudents({ pageSize: 100, filter: { status: "active" } })
      .then((r) => setStudents(r.rows))
      .catch(() => {});
  }, []);

  function buildPhone(): string | null {
    if (!localNumber) return null;
    const dial = COUNTRIES.find((c) => c.code === dialCountry);
    return dial ? dial.dialCode + localNumber : localNumber;
  }

  async function book() {
    setError(null);
    if (mode === "existing" && !studentId) {
      setError(t("book.studentRequired"));
      return;
    }
    if (mode === "lead" && (!leadName.trim() || !localNumber)) {
      setError(t("book.leadRequired"));
      return;
    }
    setBusy(true);
    try {
      await createTrial({
        teacher_id: teacher.id,
        student_id: mode === "existing" ? studentId : undefined,
        lead_name: mode === "lead" ? leadName.trim() : undefined,
        lead_whatsapp: mode === "lead" ? buildPhone() : undefined,
        lead_email: mode === "lead" ? leadEmail.trim() || undefined : undefined,
        local_datetime: `${slot.date} ${slot.time}`,
        timezone: slot.timezone,
        duration_minutes: slot.duration,
      });
      onBooked();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5" data-testid="book-trial-form">
      {error && (
        <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />
      )}

      {/* Slot summary */}
      <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
        <CalendarClock className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <div className="text-sm">
          <p className="font-semibold">{teacher.full_name}</p>
          <p className="text-muted-foreground">
            {t("book.slotSummary", {
              date: slot.date,
              time: formatHm12(slot.time, locale),
              duration: slot.duration,
            })}
            {slot.timezone ? ` · ${slot.timezone.replace(/_/g, " ")}` : ""}
          </p>
          {teacher.has_conflict && (
            <p className="mt-1 text-xs font-medium text-amber-600 dark:text-amber-400">
              {t("book.conflictWarning")}
            </p>
          )}
        </div>
      </div>

      {/* Mode toggle */}
      <div className="grid grid-cols-2 gap-2">
        <ModeButton
          active={mode === "existing"}
          icon={Users}
          label={t("book.existing")}
          onClick={() => setMode("existing")}
        />
        <ModeButton
          active={mode === "lead"}
          icon={UserPlus}
          label={t("book.newLead")}
          onClick={() => setMode("lead")}
        />
      </div>

      {mode === "existing" ? (
        <div className="space-y-1.5">
          <label className="text-sm font-medium">
            {t("book.student")}
            <span className="text-destructive ms-0.5">*</span>
          </label>
          <Combobox
            options={students.map((s) => ({ value: s.id, label: s.full_name }))}
            value={studentId}
            onChange={setStudentId}
            placeholder={t("book.selectStudent")}
            searchPlaceholder={t("book.searchStudent")}
            data-testid="book-student"
          />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              {t("book.leadName")}
              <span className="text-destructive ms-0.5">*</span>
            </label>
            <div className="relative">
              <User className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                className={cn(inputBase, "py-2.5 ps-10 pe-3.5")}
                placeholder={t("book.leadNamePlaceholder")}
                value={leadName}
                onChange={(e) => setLeadName(e.target.value)}
                data-testid="book-lead-name"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              {t("book.whatsapp")}
              <span className="text-destructive ms-0.5">*</span>
            </label>
            <div
              dir="ltr"
              className="border-input flex h-10 overflow-hidden rounded-xl border transition-all focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20"
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
                placeholder="512345678"
                value={localNumber}
                onChange={(e) => setLocalNumber(e.target.value.replace(/[^\d]/g, ""))}
                className="flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground"
                data-testid="book-lead-phone"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t("book.email")}</label>
            <div className="relative">
              <Mail className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="email"
                className={cn(inputBase, "py-2.5 ps-10 pe-3.5")}
                placeholder={t("book.emailPlaceholder")}
                value={leadEmail}
                onChange={(e) => setLeadEmail(e.target.value)}
                data-testid="book-lead-email"
              />
            </div>
          </div>
        </div>
      )}

      <div className="mt-2 flex items-center justify-between gap-2 border-t pt-4">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          {t("back")}
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => void book()}
          disabled={busy}
          className="gap-1.5"
          data-testid="book-submit"
        >
          {busy ? (
            <span className="size-3.5 animate-spin rounded-full border border-current border-t-transparent" />
          ) : (
            <CalendarClock className="size-3.5" aria-hidden />
          )}
          {t("book.confirm")}
        </Button>
      </div>
    </div>
  );
}

function ModeButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof Users;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors",
        active
          ? "border-primary/40 bg-primary/8 text-primary"
          : "border-input bg-background text-muted-foreground hover:bg-muted/40",
      )}
    >
      <Icon className="size-4" aria-hidden />
      {label}
    </button>
  );
}
