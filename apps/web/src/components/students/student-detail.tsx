"use client";

import {
  Banknote,
  BookOpen,
  CalendarDays,
  CalendarPlus,
  Check,
  GraduationCap,
  Hash,
  History,
  MapPin,
  Phone,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Undo2,
  UserCircle2,
  UserRoundCog,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { ScheduleSection } from "@/components/scheduling/schedule-editor";
import {
  DetailRow,
  ProfileCard,
} from "@/components/ui/profile-card";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { StudentPackagePanel } from "@/components/packages/student-package-panel";
import { Combobox } from "@/components/ui/combobox";
import { Modal } from "@/components/ui/modal";
import {
  ApiError,
  deactivateStudent,
  deleteStudent,
  getRepricePreview,
  getStudent,
  getStudentSchedule,
  getTeacherHistory,
  listTeachers,
  reactivateStudent,
  reassignTeacher,
  type RepricePreview,
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
  // Editing a student and pricing one are now separate rights: a supervisor manages the student
  // and never sees, let alone changes, what they pay.
  const canPrice = can("student.set_price");
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
        canEdit={canPrice}
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

/**
 * The way back for a deactivated student. It existed before but was never rendered on the profile
 * page, so a student deactivated by mistake could only be restored from the database — now it is
 * what the Settings tab shows once the record is inactive.
 */
export function ReactivatePanel({
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
    <ProfileCard
      icon={Undo2}
      title={t("detail.reactivate")}
      description={t("profile.settingsSubtitle")}
      tone="emerald"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted-foreground min-w-0 text-xs">
          {t("detail.reactivateHint")}
        </p>
        <Button
          type="button"
          size="sm"
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
          className="shrink-0 gap-1.5 border-transparent bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:ring-emerald-500/40"
        >
          {busy ? (
            <span className="size-3.5 animate-spin rounded-full border border-current border-t-transparent" />
          ) : (
            <Undo2 className="size-3.5" />
          )}
          {t("detail.reactivate")}
        </Button>
      </div>
    </ProfileCard>
  );
}

// ── ProfileSection ────────────────────────────────────────────────────────────

/**
 * The student's own record, and the adult behind it — two subjects, so two cards side by side on
 * a wide screen. Previously one column with the guardian hanging off the bottom of the form under
 * a divider, where it read like an afterthought rather than the billing anchor it is.
 */
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

  const dirty =
    name !== data.student.full_name ||
    status !== ((data.student.status as string) ?? "");

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
    <div className="grid gap-4 lg:grid-cols-2" data-testid="student-profile">
      <ProfileCard
        icon={UserCircle2}
        title={t("profile.identityTitle")}
        description={t("profile.identityDesc")}
        tone="emerald"
      >
        <div className="space-y-4">
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

          {canEdit && (
            <div className="flex items-center justify-end gap-3 border-t pt-4">
              {/* Saying "nothing to save" beats a button that looks live and does nothing. */}
              {!dirty && !saving && (
                <span className="text-muted-foreground/70 text-xs">
                  {t("profile.noChanges")}
                </span>
              )}
              <Button
                type="button"
                size="sm"
                disabled={saving || !dirty}
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
        </div>
      </ProfileCard>

      <GuardianCard data={data} />
    </div>
  );
}

// ── GuardianCard ──────────────────────────────────────────────────────────────

function GuardianCard({ data }: { data: StudentDetailData }) {
  const t = useTranslations("students");
  const guardian = data.guardian;
  const isSelf = data.student.is_self_guardian;
  const country = countryLabel(guardian?.country ?? null);

  return (
    <ProfileCard
      icon={ShieldCheck}
      title={t("form.guardianDetails")}
      description={t("profile.guardianDesc")}
      tone="violet"
      action={
        isSelf ? (
          <span className="bg-primary/10 text-primary ring-primary/15 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1">
            <ShieldCheck className="size-3" aria-hidden />
            {t("form.selfGuardian")}
          </span>
        ) : undefined
      }
    >
      {guardian ? (
        <div className="space-y-4">
          {isSelf && (
            <p className="text-muted-foreground bg-muted/40 rounded-xl px-3 py-2 text-xs">
              {t("form.selfGuardianBadge")}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <DetailRow
              icon={UserCircle2}
              label={t("form.guardian")}
              value={guardian.full_name}
            />
            {guardian.whatsapp_phone && (
              <DetailRow
                icon={Phone}
                label={t("form.phone")}
                value={guardian.whatsapp_phone}
                dir="ltr"
              />
            )}
            {country && (
              <DetailRow icon={MapPin} label={t("form.country")} value={country} />
            )}
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground bg-muted/10 rounded-xl border border-dashed px-4 py-8 text-center text-sm">
          {t("form.noGuardian")}
        </p>
      )}
    </ProfileCard>
  );
}

// ── SubscriptionSection ───────────────────────────────────────────────────────

/**
 * What the academy bills this student. The package's figures now live in a card with the edit
 * form behind a modal, rather than an inline panel that pushed the whole page down the moment
 * anyone touched "Edit" — the numbers you are changing FROM stay on screen while you change them.
 */
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
  // A package student's rate is still quoted per hour — it is what pre-fills their next block —
  // so both modes render the hourly figures. Only the CLOCK differs.
  const isHourly =
    sub?.price_basis === "PER_HOUR" || sub?.price_basis === "PER_PACKAGE";
  const isPackaged = sub?.price_basis === "PER_PACKAGE";

  const [showSet, setShowSet] = useState(false);
  const [saving, setSaving] = useState(false);
  /**
   * WHICH billing clock this student is on. The two are mutually exclusive by design: a package
   * student never also collects a monthly invoice line, because two clocks on one student is a
   * double bill (docs/lesson-packages).
   */
  const [basis, setBasis] = useState<"PER_HOUR" | "PER_PACKAGE">("PER_HOUR");

  const [sessions, setSessions] = useState("");
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("");
  const [startDate, setStartDate] = useState("");

  // Correcting a mistyped rate must also fix the bills it already produced; a real rate change
  // must not. Only the person editing knows which this is, so they choose — and the preview tells
  // them exactly what is at stake before they do.
  const [repriceOpen, setRepriceOpen] = useState(false);
  const [preview, setPreview] = useState<RepricePreview | null>(null);

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
      setBasis(sub.price_basis === "PER_PACKAGE" ? "PER_PACKAGE" : "PER_HOUR");
    }
    setRepriceOpen(false);
    setPreview(null);
    void getRepricePreview(studentId)
      .then(setPreview)
      .catch(() => {});
    setShowSet(true);
  }

  async function save() {
    setSaving(true);
    try {
      const packaged = basis === "PER_PACKAGE";
      const res = await setSubscription(studentId, {
        // The rate is always hourly now; derive a display label from the clock and the quota.
        plan_label: packaged
          ? t("subscription.modePackage")
          : sessions
            ? `${sessions} hrs/month`
            : "Hourly",
        // A monthly quota means nothing once the boundary is "N hours bought" rather than a month.
        sessions_per_month: packaged || !sessions ? null : Number(sessions),
        price_minor: toMinor(price),
        currency: currency || undefined,
        price_basis: basis,
        start_date: startDate,
        // Repricing walks the OPEN monthly invoices, of which a package student has none — the
        // toggle is hidden in that mode, and this keeps it off even if state lingered.
        reprice_open: packaged ? false : repriceOpen,
      });
      setShowSet(false);
      onChanged(
        res.repriced.sessions > 0
          ? t("subscription.savedRepriced", {
              sessions: res.repriced.sessions,
              invoices: res.repriced.invoices,
            })
          : t("subscription.saved"),
      );
    } catch (err) {
      onError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4" data-testid="student-subscription">
      {/* A package with no timetable bills nothing — the one blocking condition, stated first. */}
      {hasSchedule === false && (
        <div className="flex flex-col gap-3 rounded-2xl border border-amber-300/60 bg-gradient-to-br from-amber-500/[0.08] to-transparent p-4 sm:flex-row sm:items-center dark:border-amber-700/40">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
              <CalendarPlus className="size-4" aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                {t("subscription.noScheduleTitle")}
              </p>
              <p className="mt-0.5 text-xs text-amber-700/80 dark:text-amber-400/70">
                {t("subscription.noScheduleHint")}
              </p>
            </div>
          </div>
          {onGoToSchedule && (
            <Button
              type="button"
              size="sm"
              onClick={onGoToSchedule}
              className="shrink-0 gap-1.5 border-transparent bg-amber-500 text-white hover:bg-amber-600 focus-visible:ring-amber-500/40"
            >
              <CalendarPlus className="size-3.5" />
              {t("subscription.addTimetable")}
            </Button>
          )}
        </div>
      )}

      {/* The live hour balance, for a student on package billing. It sits above the terms card
          because when a parent rings up, "how many hours are left" is the question — the agreed
          rate is what you check second. */}
      {isPackaged && <StudentPackagePanel studentId={studentId} />}

      {sub ? (
        <ProfileCard
          icon={BookOpen}
          title={sub.plan_label}
          description={t(`basis.${sub.price_basis}`)}
          tone="violet"
          testId="subscription-card"
          bodyClassName="p-0"
          action={
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
                {t("subscription.active")}
              </span>
              {canEdit && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={openForm}
                  data-testid="toggle-set-subscription"
                  className="gap-1.5"
                >
                  <BookOpen className="size-3.5" />
                  {t("subscription.edit")}
                </Button>
              )}
            </div>
          }
        >
          {/* The three numbers that decide the invoice, given equal weight and one baseline. */}
          <div className="grid grid-cols-1 divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0 rtl:sm:divide-x-reverse">
            <Figure
              label={isHourly ? t("subscription.priceHourly") : t("subscription.price")}
            >
              <span data-testid="subscription-price">
                {/* Blanked by the API for a role that may not see rates — the card still shows
                    the plan, the quota and the start date, which are not money. */}
                {sub.price_minor != null && sub.currency
                  ? formatMoney({ amount: sub.price_minor, currency: sub.currency }, locale)
                  : "—"}
              </span>
              {isHourly && (
                <span className="text-muted-foreground ms-0.5 text-xs font-medium">
                  {t("subscription.perHourShort")}
                </span>
              )}
            </Figure>
            <Figure
              label={
                isHourly
                  ? t("subscription.hoursPerMonth")
                  : t("subscription.sessionsPerMonth")
              }
            >
              {sub.sessions_per_month ?? <span className="text-muted-foreground/40">—</span>}
            </Figure>
            <Figure label={t("subscription.startDate")}>{sub.start_date}</Figure>
          </div>
        </ProfileCard>
      ) : (
        <ProfileCard
          icon={BookOpen}
          title={t("subscription.title")}
          description={t("profile.subscriptionDesc")}
          tone="violet"
        >
          <div className="rounded-xl border border-dashed bg-muted/10 p-8 text-center">
            <p className="text-sm font-medium">{t("subscription.none")}</p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {t("subscription.noneHint")}
            </p>
            {canEdit && (
              <Button
                type="button"
                size="sm"
                onClick={openForm}
                data-testid="toggle-set-subscription"
                className="mt-4 gap-1.5"
              >
                <BookOpen className="size-3.5" />
                {t("subscription.set")}
              </Button>
            )}
          </div>
        </ProfileCard>
      )}

      {/* ── Edit package ─────────────────────────────────────────────────
          A modal, not an inline panel: the figures being replaced stay readable behind it. */}
      <Modal
        open={showSet && canEdit}
        onClose={() => !saving && setShowSet(false)}
        title={sub ? t("subscription.replaceTitle") : t("subscription.setTitle")}
        size="md"
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={saving}
              onClick={() => setShowSet(false)}
            >
              {t("cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={saving}
              onClick={() => void save()}
              data-testid="save-subscription"
              className="gap-1.5"
            >
              {saving ? (
                <span className="size-3.5 animate-spin rounded-full border border-current border-t-transparent" />
              ) : (
                <Check className="size-3.5" />
              )}
              {t("subscription.set")}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {/* Which clock. Stated first because it changes what every field below MEANS: in package
              mode the price is a default rate for the next block rather than a monthly figure, and
              the monthly quota stops existing. */}
          <div className="space-y-1.5">
            <span className="text-sm font-medium">{t("subscription.mode")}</span>
            <div className="grid grid-cols-2 gap-2">
              {(["PER_HOUR", "PER_PACKAGE"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  data-testid={`billing-mode-${option}`}
                  onClick={() => setBasis(option)}
                  className={cn(
                    "rounded-xl border px-3 py-2.5 text-start text-sm font-medium transition-colors",
                    basis === option
                      ? "border-primary/40 bg-primary/8 text-primary"
                      : "border-input bg-background text-muted-foreground hover:bg-muted/40",
                  )}
                >
                  <span className="block">
                    {t(option === "PER_HOUR" ? "subscription.modeMonthly" : "subscription.modePackage")}
                  </span>
                  <span className="text-muted-foreground/80 mt-0.5 block text-[11px] font-normal">
                    {t(
                      option === "PER_HOUR"
                        ? "subscription.modeMonthlyHint"
                        : "subscription.modePackageHint",
                    )}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("subscription.priceHourly")}>
              <div className="relative">
                <Banknote className="text-muted-foreground pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2" />
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

            {/* A monthly quota is meaningless once the boundary is "N hours bought", so it is
                absent rather than disabled — a greyed-out field still invites a question. */}
            {basis === "PER_HOUR" && (
              <Field label={t("subscription.hoursPerMonth")}>
                <div className="relative">
                  <Hash className="text-muted-foreground pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2" />
                  <input
                    type="number"
                    aria-label={t("subscription.hoursPerMonth")}
                    className={cn(inputBase, "py-2.5 ps-10 pe-3.5")}
                    value={sessions}
                    onChange={(e) => setSessions(e.target.value)}
                  />
                </div>
              </Field>
            )}

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
                <CalendarDays className="text-muted-foreground pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2" />
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

          {/* Only offered when there is something to correct: sessions already billed onto an
              invoice that is still open. Nothing billed yet → the new rate applies anyway. */}
          {basis === "PER_HOUR" && preview && preview.sessions > 0 && (
            <label
              className="flex cursor-pointer items-start gap-3 rounded-xl border border-amber-300/60 bg-gradient-to-br from-amber-500/[0.08] to-transparent p-3.5 dark:border-amber-700/40"
              data-testid="reprice-open-toggle"
            >
              <input
                type="checkbox"
                className="mt-0.5 size-4 shrink-0 accent-amber-500"
                checked={repriceOpen}
                onChange={(e) => setRepriceOpen(e.target.checked)}
              />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                  {t("subscription.repriceOpenLabel")}
                </p>
                <p className="mt-0.5 text-xs text-amber-700/80 dark:text-amber-400/70">
                  {t("subscription.repriceOpenHint", {
                    sessions: preview.sessions,
                    invoices: preview.invoices,
                  })}
                </p>
              </div>
            </label>
          )}
        </div>
      </Modal>
    </div>
  );
}

/** One number in a card's figure strip. */
function Figure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-5 py-4">
      <p className="text-muted-foreground/80 text-[10px] font-bold uppercase tracking-wider">
        {label}
      </p>
      <p className="mt-1 text-lg font-bold leading-none tabular-nums">{children}</p>
    </div>
  );
}

// ── TeacherSection ────────────────────────────────────────────────────────────

/**
 * Who teaches this student, who to move them to, and who has taught them before — three cards,
 * because a reassignment is a decision you make while looking at the current assignment and the
 * history, not after scrolling past them.
 */
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
    <div className="space-y-4" data-testid="student-teacher">
      <div className="grid gap-4 lg:grid-cols-2">
        <ProfileCard
          icon={GraduationCap}
          title={t("teacher.current")}
          description={t("profile.teacherDesc")}
          tone="emerald"
        >
          <div className="flex items-center gap-4">
            {currentName ? (
              <Avatar name={currentName} size="lg" />
            ) : (
              <div className="bg-muted ring-border flex size-14 shrink-0 items-center justify-center rounded-2xl ring-1">
                <GraduationCap className="text-muted-foreground size-6" aria-hidden />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  "truncate text-lg font-bold leading-tight",
                  !currentName && "text-muted-foreground text-base font-medium italic",
                )}
                data-testid="current-teacher"
              >
                {currentName ?? t("teacher.none")}
              </p>
              {since && (
                <p className="text-muted-foreground mt-1 inline-flex items-center gap-1.5 text-xs">
                  <CalendarDays className="size-3" aria-hidden />
                  {t("teacher.since", { date: since })}
                </p>
              )}
            </div>
          </div>
        </ProfileCard>

        {canEdit && (
          <ProfileCard
            icon={UserRoundCog}
            title={t("teacher.change")}
            description={t("teacher.changeHint")}
            tone="gold"
          >
            <div className="space-y-3">
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
              <Field label={t("teacher.effectiveDate")}>
                <div className="relative">
                  <CalendarDays className="text-muted-foreground pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2" />
                  <input
                    type="date"
                    aria-label={t("teacher.effectiveDate")}
                    className={cn(inputBase, "py-2.5 ps-10 pe-3.5")}
                    value={effective}
                    onChange={(e) => setEffective(e.target.value)}
                  />
                </div>
              </Field>
              <div className="flex justify-end border-t pt-4">
                <Button
                  type="button"
                  size="sm"
                  disabled={changing || !teacherId}
                  onClick={() => void change()}
                  data-testid="assign-teacher"
                  className="gap-1.5"
                >
                  {changing ? (
                    <span className="size-3.5 animate-spin rounded-full border border-current border-t-transparent" />
                  ) : (
                    <Check className="size-3.5" />
                  )}
                  {t("teacher.assign")}
                </Button>
              </div>
            </div>
          </ProfileCard>
        )}
      </div>

      {/* Assignment history — the close+open trail, kept because a reassignment is never a
          silent overwrite: payroll and session history both hang off these dates. */}
      {history.length > 0 && (
        <ProfileCard
          icon={History}
          title={t("teacher.history")}
          description={t("profile.historyDesc")}
          tone="slate"
        >
          <ol className="relative space-y-4" data-testid="teacher-history">
            {/* The rail the dots sit on — one continuous line reads as a timeline; separate
                dots read as a list. */}
            <span
              className="via-border absolute inset-y-1 start-[5px] w-px bg-gradient-to-b from-transparent to-transparent"
              aria-hidden
            />
            {history.map((h) => {
              const ongoing = h.ended_at == null;
              return (
                <li
                  key={h.id}
                  className="relative flex items-start gap-3 ps-6"
                  data-history={h.teacher_id}
                >
                  <span
                    className={cn(
                      "ring-card absolute start-0 top-1.5 size-2.5 rounded-full ring-4",
                      ongoing ? "bg-emerald-500" : "bg-muted-foreground/40",
                    )}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold">
                        {h.teacher_name}
                      </span>
                      {ongoing && (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                          {t("teacher.current_badge")}
                        </span>
                      )}
                    </div>
                    <p className="text-muted-foreground mt-0.5 text-xs tabular-nums">
                      {h.started_at.slice(0, 10)} →{" "}
                      {h.ended_at ? h.ended_at.slice(0, 10) : t("teacher.ongoing")}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </ProfileCard>
      )}
    </div>
  );
}

// ── DangerZone ────────────────────────────────────────────────────────────────

/**
 * The two irreversible-looking actions, in a card that says so. Both are recoverable soft-deletes
 * underneath, which is exactly why they need to LOOK final — an admin who thinks "deactivate" is
 * harmless clicks it on the wrong student.
 */
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
  const [deactivating, setDeactivating] = useState(false);
  const [deleting, setDeleting] = useState(false);

  return (
    <ProfileCard
      icon={ShieldAlert}
      title={t("profile.settingsTitle")}
      description={t("profile.settingsSubtitle")}
      tone="danger"
      className="border-destructive/25"
    >
      <div className="divide-destructive/15 divide-y">
        <DangerRow
          icon={ShieldAlert}
          title={t("detail.deactivate")}
          hint={t("detail.deactivateHint")}
          action={
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => setConfirmDeactivate(true)}
              data-testid="deactivate-student"
            >
              {t("detail.deactivate")}
            </Button>
          }
        />
        <DangerRow
          icon={Trash2}
          title={t("detail.delete")}
          hint={t("detail.deleteHint")}
          action={
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => setConfirmDelete(true)}
              data-testid="delete-student"
            >
              {t("detail.delete")}
            </Button>
          }
        />
      </div>

      {/* ── Deactivate confirmation ───────────────────────────────────── */}
      <Modal
        open={confirmDeactivate}
        onClose={() => !deactivating && setConfirmDeactivate(false)}
        title={t("detail.confirmTitle")}
        size="sm"
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={deactivating}
              onClick={() => setConfirmDeactivate(false)}
            >
              {t("cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={deactivating}
              data-testid="deactivate-student-confirm"
              onClick={async () => {
                setDeactivating(true);
                try {
                  await deactivateStudent(studentId);
                  onDeactivated();
                } catch (err) {
                  onError(err instanceof ApiError ? err.message : String(err));
                  setConfirmDeactivate(false);
                } finally {
                  setDeactivating(false);
                }
              }}
            >
              {t("detail.confirmYes")}
            </Button>
          </>
        }
      >
        <p className="text-sm">{t("detail.confirmBody")}</p>
      </Modal>

      {/* ── Delete confirmation ───────────────────────────────────────── */}
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
    </ProfileCard>
  );
}

function DangerRow({
  icon: Icon,
  title,
  hint,
  action,
}: {
  icon: typeof Trash2;
  title: string;
  hint: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <Icon className="text-destructive/60 mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="min-w-0">
          <p className="text-destructive text-sm font-semibold">{title}</p>
          <p className="text-muted-foreground mt-0.5 text-xs">{hint}</p>
        </div>
      </div>
      <div className="shrink-0 sm:ms-4">{action}</div>
    </div>
  );
}
