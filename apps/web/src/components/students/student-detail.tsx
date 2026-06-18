"use client";

import {
  Banknote,
  BookOpen,
  CalendarDays,
  CalendarPlus,
  Check,
  GraduationCap,
  Hash,
  MapPin,
  Phone,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserCircle2,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { ScheduleSection } from "@/components/scheduling/schedule-editor";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Modal } from "@/components/ui/modal";
import {
  ApiError,
  deactivateStudent,
  deleteStudent,
  getStudent,
  getStudentSchedule,
  getTeacherHistory,
  listTeachers,
  reactivateStudent,
  reassignTeacher,
  setSubscription,
  type StudentDetail as StudentDetailData,
  type TeacherAssignmentHistoryItem,
  type TeacherRow,
  updateStudent,
} from "@/lib/api";
import { COUNTRIES, CURRENCIES } from "@/lib/countries";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

// The manually-settable active states. Terminal states (GRADUATED/WITHDRAWN) are not editable
// here — they are recorded by deactivation; the soft-delete drives the active/inactive pill.
const STUDENT_STATUSES = ["REGULAR", "TRIAL", "TRIAL_BOOKED"] as const;

const CURRENCY_OPTIONS = CURRENCIES.map((c) => ({
  value: c.code,
  label: c.code,
  sublabel: c.name,
}));

function countryLabel(code: string | null): string | null {
  if (!code) return null;
  const found = COUNTRIES.find((c) => c.code === code);
  return found ? `${found.flag} ${found.name}` : code;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function nameHue(name: string) {
  return name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
}

export function Avatar({
  name,
  size = "md",
}: {
  name: string;
  size?: "sm" | "md" | "lg";
}) {
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();
  const sizeClass = {
    sm: "size-7 text-[10px]",
    md: "size-9 text-xs",
    lg: "size-14 text-base rounded-2xl",
  }[size];
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-bold text-white shadow-sm",
        sizeClass,
      )}
      style={{ backgroundColor: `hsl(${nameHue(name)} 52% 44%)` }}
      aria-hidden
    >
      {initials}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

const inputBase =
  "border-input bg-background placeholder:text-muted-foreground focus:border-primary focus:ring-primary/15 w-full rounded-xl border text-sm outline-none transition-colors focus:ring-3 disabled:cursor-not-allowed disabled:opacity-50";

function toMinor(major: string): number {
  return Math.round(parseFloat(major || "0") * 100);
}

// ── Component ─────────────────────────────────────────────────────────────────

export function StudentDetail({
  studentId,
  onBack,
  onSaved,
  onDeactivated,
}: {
  studentId: string;
  onBack: () => void;
  onSaved?: () => void;
  onDeactivated?: () => void;
}) {
  const t = useTranslations("students");
  const locale = useLocale();
  const { can } = useAuth();

  const [data, setData] = useState<StudentDetailData | null>(null);
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [history, setHistory] = useState<TeacherAssignmentHistoryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [detail, hist] = await Promise.all([
      getStudent(studentId),
      getTeacherHistory(studentId),
    ]);
    setData(detail);
    setHistory(hist.history);
  }, [studentId]);

  useEffect(() => {
    void refresh();
    void listTeachers({ pageSize: 50, filter: { status: "active" } })
      .then((r) => setTeachers(r.rows))
      .catch(() => setTeachers([]));
  }, [refresh]);

  if (data === null) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16">
        <div className="border-primary size-7 animate-spin rounded-full border-2 border-t-transparent" />
        <p className="text-muted-foreground text-xs">{t("detail.loading")}</p>
      </div>
    );
  }

  const canEdit = can("student.update");
  const isActive = (data.student.deleted_at as string | null) == null;

  return (
    <div className="space-y-6" data-testid="student-detail">

      {/* ── Profile hero ────────────────────────────────────────────── */}
      <div className="flex items-start gap-4 rounded-2xl border bg-gradient-to-br from-muted/60 to-muted/10 p-5">
        <Avatar name={data.student.full_name} size="lg" />
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-bold leading-tight">{data.student.full_name}</h3>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {isActive ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                <span className="size-1.5 rounded-full bg-emerald-500" />
                {t("filter.active")}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500 dark:bg-slate-800/40 dark:text-slate-400">
                <span className="size-1.5 rounded-full bg-slate-400" />
                {t("filter.inactive")}
              </span>
            )}
            {data.student.is_self_guardian && (
              <span className="inline-flex items-center gap-1 rounded-md bg-background px-2 py-0.5 text-xs font-medium ring-1 ring-border">
                {t("form.selfGuardian")}
              </span>
            )}
            {data.subscription && (
              <span className="inline-flex items-center gap-1 rounded-md bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
                <BookOpen className="size-3" />
                {data.subscription.plan_label}
              </span>
            )}
          </div>
          {data.guardian && (
            <div className="mt-2.5 flex items-center gap-1.5">
              <UserCircle2 className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                {data.guardian.full_name}
              </span>
            </div>
          )}
          {data.currentTeacher && (
            <div className="mt-1 flex items-center gap-1.5">
              <GraduationCap className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                {data.currentTeacher.teacher_name}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Alerts ──────────────────────────────────────────────────── */}
      {error && (
        <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />
      )}
      {notice && (
        <AlertBanner variant="success" message={notice} onDismiss={() => setNotice(null)} />
      )}

      {/* ── Profile section ──────────────────────────────────────────── */}
      <ProfileSection
        data={data}
        canEdit={canEdit}
        onSaved={() => {
          setNotice(t("form.saved"));
          onSaved?.();
          void refresh();
        }}
        onError={setError}
      />

      {/* ── Subscription section ─────────────────────────────────────── */}
      <SubscriptionSection
        data={data}
        teachers={teachers}
        canEdit={canEdit}
        locale={locale}
        studentId={studentId}
        onChanged={(msg) => {
          setNotice(msg);
          void refresh();
        }}
        onError={setError}
      />

      {/* ── Teacher section ──────────────────────────────────────────── */}
      <TeacherSection
        data={data}
        history={history}
        teachers={teachers}
        canEdit={canEdit}
        studentId={studentId}
        onChanged={() => void refresh()}
        onError={setError}
      />

      {/* ── Schedule section ─────────────────────────────────────────── */}
      {can("schedule.read") && (
        <div className="space-y-4">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60">
            {t("detail.schedule")}
          </p>
          <ScheduleSection
            studentId={studentId}
            canManage={can("schedule.manage")}
            onError={setError}
          />
        </div>
      )}

      {/* ── Danger zone ──────────────────────────────────────────────── */}
      {canEdit && isActive && (
        <DangerZone
          studentId={studentId}
          onDeactivated={() => {
            onDeactivated?.();
            onBack();
          }}
          onError={setError}
        />
      )}

      {/* ── Reactivate (deactivated students) ────────────────────────── */}
      {canEdit && !isActive && (
        <ReactivatePanel
          studentId={studentId}
          onReactivated={() => {
            onSaved?.();
            void refresh();
          }}
          onError={setError}
        />
      )}
    </div>
  );
}

// ── ReactivatePanel ─────────────────────────────────────────────────────────────

function ReactivatePanel({
  studentId,
  onReactivated,
  onError,
}: {
  studentId: string;
  onReactivated: () => void;
  onError: (msg: string) => void;
}) {
  const t = useTranslations("students");
  const [busy, setBusy] = useState(false);

  return (
    <section className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
            {t("detail.reactivate")}
          </p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {t("detail.reactivateHint")}
          </p>
        </div>
        <Button
          type="button"
          size="xs"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await reactivateStudent(studentId);
              onReactivated();
            } catch (err) {
              onError(err instanceof ApiError ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          }}
          data-testid="reactivate-student"
          className="bg-emerald-600 text-white hover:bg-emerald-700 border-transparent"
        >
          {t("detail.reactivate")}
        </Button>
      </div>
    </section>
  );
}

// ── ProfileSection ────────────────────────────────────────────────────────────

export function ProfileSection({
  data,
  canEdit,
  onSaved,
  onError,
}: {
  data: StudentDetailData;
  canEdit: boolean;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const t = useTranslations("students");
  const [name, setName] = useState(data.student.full_name);
  const [status, setStatus] = useState((data.student.status as string) ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      // Only forward a status the API accepts as an editable active state; a deactivated
      // student carries a terminal status (GRADUATED/WITHDRAWN) that must not be re-sent.
      const patch: { full_name: string; status?: string } = { full_name: name };
      if ((STUDENT_STATUSES as readonly string[]).includes(status)) {
        patch.status = status;
      }
      await updateStudent(data.student.id, patch);
      onSaved();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-4" data-testid="student-profile">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60">
        {t("detail.profile")}
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("form.fullName")}>
          <input
            aria-label={t("form.fullName")}
            className={cn(inputBase, "px-3.5 py-2.5")}
            value={name}
            disabled={!canEdit}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>

        <Field label={t("form.status")}>
          <select
            aria-label={t("form.status")}
            className={cn(inputBase, "px-3.5 py-2.5", !canEdit && "appearance-none")}
            value={STUDENT_STATUSES.includes(status as never) ? status : ""}
            disabled={!canEdit}
            onChange={(e) => setStatus(e.target.value)}
          >
            {!STUDENT_STATUSES.includes(status as never) && (
              <option value="">{status || t("none")}</option>
            )}
            {STUDENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`studentStatus.${s}`)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {canEdit && (
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            disabled={saving}
            onClick={() => void save()}
            data-testid="save-student"
            className="gap-1.5"
          >
            {saving ? (
              <>
                <span className="size-3.5 animate-spin rounded-full border border-current border-t-transparent" />
                {t("form.saving")}
              </>
            ) : (
              <>
                <Check className="size-3.5" />
                {t("form.save")}
              </>
            )}
          </Button>
        </div>
      )}

      {/* ── Guardian details ──────────────────────────────────────────── */}
      <GuardianDetails data={data} />
    </section>
  );
}

// ── GuardianDetails ───────────────────────────────────────────────────────────

function GuardianRow_({
  icon: Icon,
  label,
  value,
  dir,
}: {
  icon: typeof Phone;
  label: string;
  value: string;
  dir?: "ltr";
}) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-background ring-1 ring-border/60">
        <Icon className="size-3.5 text-muted-foreground" aria-hidden />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
          {label}
        </p>
        <p className="truncate text-sm font-medium" dir={dir}>
          {value}
        </p>
      </div>
    </div>
  );
}

function GuardianDetails({ data }: { data: StudentDetailData }) {
  const t = useTranslations("students");
  const guardian = data.guardian;
  const isSelf = data.student.is_self_guardian;
  const country = countryLabel(guardian?.country ?? null);

  return (
    <div className="space-y-3 border-t pt-5">
      <div className="flex items-center gap-2">
        <UserCircle2 className="size-4 text-muted-foreground" aria-hidden />
        <p className="text-sm font-semibold">{t("form.guardianDetails")}</p>
        {isSelf && (
          <span className="ms-auto inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary ring-1 ring-primary/15">
            <ShieldCheck className="size-3" aria-hidden />
            {t("form.selfGuardian")}
          </span>
        )}
      </div>

      {guardian ? (
        <div className="rounded-2xl border bg-muted/20 p-4">
          {isSelf && (
            <p className="mb-3 text-xs text-muted-foreground">
              {t("form.selfGuardianBadge")}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <GuardianRow_
              icon={UserCircle2}
              label={t("form.guardian")}
              value={guardian.full_name}
            />
            {guardian.whatsapp_phone && (
              <GuardianRow_
                icon={Phone}
                label={t("form.phone")}
                value={guardian.whatsapp_phone}
                dir="ltr"
              />
            )}
            {country && (
              <GuardianRow_
                icon={MapPin}
                label={t("form.country")}
                value={country}
              />
            )}
          </div>
        </div>
      ) : (
        <p className="rounded-2xl border border-dashed bg-muted/10 px-4 py-6 text-center text-sm text-muted-foreground">
          {t("form.noGuardian")}
        </p>
      )}
    </div>
  );
}

// ── SubscriptionSection ───────────────────────────────────────────────────────

export function SubscriptionSection({
  data,
  canEdit,
  locale,
  studentId,
  onChanged,
  onError,
  onGoToSchedule,
}: {
  data: StudentDetailData;
  teachers: TeacherRow[];
  canEdit: boolean;
  locale: string;
  studentId: string;
  onChanged: (msg: string) => void;
  onError: (msg: string) => void;
  onGoToSchedule?: () => void;
}) {
  const t = useTranslations("students");
  const sub = data.subscription;
  const isHourly = sub?.price_basis === "PER_HOUR";

  const [showSet, setShowSet] = useState(false);

  const [sessions, setSessions] = useState("");
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("");
  const [startDate, setStartDate] = useState("");

  // Whether the student has a weekly timetable (drives the no-timetable indicator).
  const [hasSchedule, setHasSchedule] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getStudentSchedule(studentId)
      .then((r) => {
        if (!cancelled) setHasSchedule(r.slots.length > 0);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [studentId]);

  function openForm() {
    if (sub) {
      setSessions(sub.sessions_per_month != null ? String(sub.sessions_per_month) : "");
      setPrice((sub.price_minor / 100).toString());
      setCurrency(sub.currency);
      setStartDate(sub.start_date);
    }
    setShowSet(true);
  }

  async function save() {
    try {
      await setSubscription(studentId, {
        // The package is always hourly now; derive a display label from the quota.
        plan_label: sessions ? `${sessions} hrs/month` : "Hourly",
        sessions_per_month: sessions ? Number(sessions) : null,
        price_minor: toMinor(price),
        currency: currency || undefined,
        price_basis: "PER_HOUR",
        start_date: startDate,
      });
      setShowSet(false);
      onChanged(t("subscription.saved"));
    } catch (err) {
      onError(err instanceof ApiError ? err.message : String(err));
    }
  }

  return (
    <section className="space-y-4" data-testid="student-subscription">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60">
        {t("subscription.title")}
      </p>

      {/* No-timetable indicator */}
      {hasSchedule === false && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-300/60 bg-gradient-to-br from-amber-500/[0.08] to-transparent p-4 dark:border-amber-700/40">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
            <CalendarPlus className="size-4" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              {t("subscription.noScheduleTitle")}
            </p>
            <p className="mt-0.5 text-xs text-amber-700/80 dark:text-amber-400/70">
              {t("subscription.noScheduleHint")}
            </p>
          </div>
          {onGoToSchedule && (
            <Button
              type="button"
              size="xs"
              onClick={onGoToSchedule}
              className="shrink-0 gap-1.5 border-transparent bg-amber-500 text-white hover:bg-amber-600 focus-visible:ring-amber-500/40"
            >
              <CalendarPlus className="size-3.5" />
              {t("subscription.addTimetable")}
            </Button>
          )}
        </div>
      )}

      {sub ? (
        <div
          className="overflow-hidden rounded-2xl border bg-card shadow-sm"
          data-testid="subscription-card"
        >
          {/* Card header */}
          <div className="flex items-center gap-2.5 border-b bg-gradient-to-r from-violet-500/[0.07] to-transparent px-4 py-3">
            <div className="flex size-9 items-center justify-center rounded-xl bg-violet-500/10 ring-1 ring-violet-500/20">
              <BookOpen className="size-4 text-violet-500" aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{sub.plan_label}</p>
              <p className="text-[11px] text-muted-foreground">{t(`basis.${sub.price_basis}`)}</p>
            </div>
            <span className="ms-auto inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              {t("subscription.active")}
            </span>
          </div>

          {/* Key figures */}
          <div className="grid grid-cols-3 divide-x rtl:divide-x-reverse">
            <div className="px-4 py-3">
              <p className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">
                {isHourly ? t("subscription.priceHourly") : t("subscription.price")}
              </p>
              <p className="mt-0.5 font-bold tabular-nums">
                <span data-testid="subscription-price">
                  {formatMoney({ amount: sub.price_minor, currency: sub.currency }, locale)}
                </span>
                {isHourly && (
                  <span className="ms-0.5 text-xs font-medium text-muted-foreground">
                    {t("subscription.perHourShort")}
                  </span>
                )}
              </p>
            </div>
            {sub.sessions_per_month != null && (
              <div className="px-4 py-3">
                <p className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">
                  {isHourly ? t("subscription.hoursPerMonth") : t("subscription.sessionsPerMonth")}
                </p>
                <p className="mt-0.5 font-bold tabular-nums">{sub.sessions_per_month}</p>
              </div>
            )}
            <div className="px-4 py-3">
              <p className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">
                {t("subscription.startDate")}
              </p>
              <p className="mt-0.5 text-sm font-semibold">{sub.start_date}</p>
            </div>
          </div>

          {/* Actions */}
          {canEdit && (
            <div className="flex flex-wrap items-center gap-1.5 border-t bg-muted/20 px-4 py-3">
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={openForm}
                data-testid="toggle-set-subscription"
                className="gap-1.5"
              >
                <BookOpen className="size-3.5" />
                {t("subscription.edit")}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed bg-muted/10 p-6 text-center">
          <p className="text-sm font-medium">{t("subscription.none")}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("subscription.noneHint")}</p>
          {canEdit && (
            <Button
              type="button"
              size="sm"
              onClick={openForm}
              data-testid="toggle-set-subscription"
              className="mt-3 gap-1.5"
            >
              <BookOpen className="size-3.5" />
              {t("subscription.set")}
            </Button>
          )}
        </div>
      )}

      {showSet && canEdit && (
        <div className="space-y-4 rounded-2xl border bg-muted/20 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60">
            {sub ? t("subscription.replaceTitle") : t("subscription.setTitle")}
          </p>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("subscription.priceHourly")}>
              <div className="relative">
                <Banknote className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="number"
                  step="0.01"
                  aria-label={t("subscription.priceHourly")}
                  className={cn(inputBase, "py-2.5 ps-10 pe-3.5")}
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </div>
            </Field>

            <Field label={t("subscription.hoursPerMonth")}>
              <div className="relative">
                <Hash className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="number"
                  aria-label={t("subscription.hoursPerMonth")}
                  className={cn(inputBase, "py-2.5 ps-10 pe-3.5")}
                  value={sessions}
                  onChange={(e) => setSessions(e.target.value)}
                />
              </div>
            </Field>

            <Field label={t("subscription.currency")}>
              <Combobox
                options={CURRENCY_OPTIONS}
                value={currency}
                onChange={setCurrency}
                placeholder={t("form.currencyPlaceholder")}
                searchPlaceholder={t("form.searchCurrency")}
              />
            </Field>

            <Field label={t("subscription.startDate")}>
              <div className="relative">
                <CalendarDays className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="date"
                  aria-label={t("subscription.startDate")}
                  className={cn(inputBase, "py-2.5 ps-10 pe-3.5")}
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
            </Field>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowSet(false)}
            >
              {t("cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void save()}
              data-testid="save-subscription"
              className="gap-1.5"
            >
              <Check className="size-3.5" />
              {t("subscription.set")}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

// ── TeacherSection ────────────────────────────────────────────────────────────

export function TeacherSection({
  data,
  history,
  teachers,
  canEdit,
  studentId,
  onChanged,
  onError,
}: {
  data: StudentDetailData;
  history: TeacherAssignmentHistoryItem[];
  teachers: TeacherRow[];
  canEdit: boolean;
  studentId: string;
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  const t = useTranslations("students");
  const [teacherId, setTeacherId] = useState("");
  const [effective, setEffective] = useState("");
  const [changing, setChanging] = useState(false);

  async function change() {
    if (!teacherId) return;
    setChanging(true);
    try {
      await reassignTeacher(studentId, {
        teacher_id: teacherId,
        effective_date: effective || undefined,
      });
      setTeacherId("");
      setEffective("");
      onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setChanging(false);
    }
  }

  const currentName = data.currentTeacher?.teacher_name ?? null;
  const since = data.currentTeacher?.started_at?.slice(0, 10) ?? null;

  return (
    <section className="space-y-4" data-testid="student-teacher">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60">
        {t("teacher.title")}
      </p>

      {/* Current teacher hero */}
      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex items-center gap-4 bg-gradient-to-br from-primary/[0.07] to-transparent p-4">
          {currentName ? (
            <Avatar name={currentName} size="md" />
          ) : (
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted ring-1 ring-border">
              <GraduationCap className="size-4 text-muted-foreground" aria-hidden />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("teacher.current")}
            </p>
            <p
              className={cn(
                "truncate text-base font-semibold",
                !currentName && "text-muted-foreground",
              )}
              data-testid="current-teacher"
            >
              {currentName ?? t("teacher.none")}
            </p>
            {since && (
              <p className="mt-0.5 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <CalendarDays className="size-3" aria-hidden />
                {t("teacher.since", { date: since })}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Reassign panel */}
      {canEdit && (
        <div className="space-y-3 rounded-2xl border bg-muted/20 p-4">
          <div>
            <p className="text-sm font-semibold">{t("teacher.change")}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t("teacher.changeHint")}</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-72 flex-1">
              <Field label={t("teacher.change")}>
                <Combobox
                  options={teachers.map((tch) => ({ value: tch.id, label: tch.full_name }))}
                  value={teacherId}
                  onChange={setTeacherId}
                  placeholder={t("form.none")}
                  searchPlaceholder={t("teacher.searchTeacher")}
                  data-testid="change-teacher-select"
                />
              </Field>
            </div>
            <Field label={t("teacher.effectiveDate")}>
              <div className="relative">
                <CalendarDays className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="date"
                  aria-label={t("teacher.effectiveDate")}
                  className={cn(inputBase, "py-2.5 ps-10 pe-3.5")}
                  value={effective}
                  onChange={(e) => setEffective(e.target.value)}
                />
              </div>
            </Field>
            <Button
              type="button"
              size="sm"
              disabled={changing || !teacherId}
              onClick={() => void change()}
              data-testid="assign-teacher"
              className="gap-1.5"
            >
              <Check className="size-3.5" />
              {t("teacher.assign")}
            </Button>
          </div>
        </div>
      )}

      {/* Assignment history — timeline */}
      {history.length > 0 && (
        <div className="space-y-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
            {t("teacher.history")}
          </p>
          <ol className="relative space-y-3 ps-2" data-testid="teacher-history">
            {history.map((h) => {
              const ongoing = h.ended_at == null;
              return (
                <li
                  key={h.id}
                  className="relative flex items-start gap-3 ps-5"
                  data-history={h.teacher_id}
                >
                  {/* dot */}
                  <span
                    className={cn(
                      "absolute start-0 top-1.5 size-2.5 rounded-full ring-2 ring-card",
                      ongoing ? "bg-emerald-500" : "bg-muted-foreground/40",
                    )}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{h.teacher_name}</span>
                      {ongoing && (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                          {t("teacher.current_badge")}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                      {h.started_at.slice(0, 10)} →{" "}
                      {h.ended_at ? h.ended_at.slice(0, 10) : t("teacher.ongoing")}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </section>
  );
}

// ── DangerZone ────────────────────────────────────────────────────────────────

export function DangerZone({
  studentId,
  onDeactivated,
  onError,
}: {
  studentId: string;
  onDeactivated: () => void;
  onError: (msg: string) => void;
}) {
  const t = useTranslations("students");
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  return (
    <section className="rounded-2xl border border-destructive/20 bg-destructive/5 p-4">
      {!confirmDeactivate ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-destructive/60" aria-hidden />
              <div>
                <p className="text-sm font-semibold text-destructive">
                  {t("detail.deactivate")}
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {t("detail.deactivateHint")}
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="destructive"
              size="xs"
              onClick={() => setConfirmDeactivate(true)}
              data-testid="deactivate-student"
            >
              {t("detail.deactivate")}
            </Button>
          </div>

          {/* Delete = remove from the system (recoverable soft-delete; confirmed via popup). */}
          <div className="flex items-center justify-between gap-4 border-t border-destructive/15 pt-4">
            <div className="flex items-start gap-3">
              <Trash2 className="mt-0.5 size-4 shrink-0 text-destructive/60" aria-hidden />
              <div>
                <p className="text-sm font-semibold text-destructive">
                  {t("detail.delete")}
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {t("detail.deleteHint")}
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="destructive"
              size="xs"
              onClick={() => setConfirmDelete(true)}
              data-testid="delete-student"
            >
              {t("detail.delete")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-destructive">{t("detail.confirmTitle")}</p>
          <p className="text-xs text-muted-foreground">
            {t("detail.confirmBody")}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => setConfirmDeactivate(false)}
            >
              {t("cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="xs"
              onClick={async () => {
                try {
                  await deactivateStudent(studentId);
                  onDeactivated();
                } catch (err) {
                  onError(err instanceof ApiError ? err.message : String(err));
                  setConfirmDeactivate(false);
                }
              }}
            >
              {t("detail.confirmYes")}
            </Button>
          </div>
        </div>
      )}

      {/* ── Delete confirmation popup ─────────────────────────────────── */}
      <Modal
        open={confirmDelete}
        onClose={() => !deleting && setConfirmDelete(false)}
        title={t("detail.deleteConfirmTitle")}
        size="sm"
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={deleting}
              onClick={() => setConfirmDelete(false)}
            >
              {t("cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={deleting}
              data-testid="delete-student-confirm"
              onClick={async () => {
                setDeleting(true);
                try {
                  await deleteStudent(studentId);
                  onDeactivated();
                } catch (err) {
                  onError(err instanceof ApiError ? err.message : String(err));
                  setConfirmDelete(false);
                } finally {
                  setDeleting(false);
                }
              }}
            >
              {deleting ? t("detail.deleting") : t("detail.deleteConfirmYes")}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm">{t("detail.deleteConfirmBody")}</p>
          <p className="text-muted-foreground text-xs">
            {t("detail.deleteRecoverableNote")}
          </p>
        </div>
      </Modal>
    </section>
  );
}
