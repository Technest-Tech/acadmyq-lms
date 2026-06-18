"use client";

import {
  ArrowLeft,
  BookOpen,
  CalendarDays,
  GraduationCap,
  Settings2,
  UserCheck,
  UserCircle2,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { StudentTimetable } from "@/components/scheduling/student-timetable";
import { EnrollmentWizard } from "@/components/students/enrollment-wizard";
import { ScheduleTrialModal } from "@/components/students/schedule-trial-modal";
import {
  Avatar,
  DangerZone,
  ProfileSection,
  SubscriptionSection,
  TeacherSection,
} from "@/components/students/student-detail";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  getStudent,
  getTeacherHistory,
  listTeachers,
  type StudentDetail as StudentDetailData,
  type TeacherAssignmentHistoryItem,
  type TeacherRow,
} from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

type TabKey = "profile" | "subscription" | "teacher" | "schedule" | "settings";

// ── Component ─────────────────────────────────────────────────────────────────

export function StudentProfile({ studentId }: { studentId: string }) {
  const t = useTranslations("students");
  const locale = useLocale();
  const router = useRouter();
  const { can } = useAuth();

  const [data, setData] = useState<StudentDetailData | null>(null);
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [history, setHistory] = useState<TeacherAssignmentHistoryItem[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState<TabKey>("profile");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [action, setAction] = useState<"none" | "trial" | "enroll">("none");

  const refresh = useCallback(async () => {
    try {
      const [detail, hist] = await Promise.all([
        getStudent(studentId),
        getTeacherHistory(studentId),
      ]);
      setData(detail);
      setHistory(hist.history);
    } catch {
      setNotFound(true);
    }
  }, [studentId]);

  useEffect(() => {
    void refresh();
    void listTeachers({ pageSize: 50, filter: { status: "active" } })
      .then((r) => setTeachers(r.rows))
      .catch(() => setTeachers([]));
  }, [refresh]);

  const canEdit = can("student.update");
  const isActive = data ? (data.student.deleted_at as string | null) == null : true;

  const tabs = useMemo(() => {
    const list: { key: TabKey; label: string; icon: typeof UserCircle2 }[] = [
      { key: "profile", label: t("profile.tabProfile"), icon: UserCircle2 },
      { key: "subscription", label: t("profile.tabSubscription"), icon: BookOpen },
      { key: "teacher", label: t("profile.tabTeacher"), icon: GraduationCap },
    ];
    if (can("schedule.read")) {
      list.push({ key: "schedule", label: t("profile.tabSchedule"), icon: CalendarDays });
    }
    if (canEdit && isActive) {
      list.push({ key: "settings", label: t("profile.tabSettings"), icon: Settings2 });
    }
    return list;
  }, [t, can, canEdit, isActive]);

  if (notFound) {
    return (
      <div className="space-y-6">
        <BackLink t={t} />
        <div className="rounded-2xl border bg-card p-10 text-center text-sm text-muted-foreground">
          {t("profile.notFound")}
        </div>
      </div>
    );
  }

  if (data === null) {
    return (
      <div className="space-y-6">
        <BackLink t={t} />
        <div className="flex flex-col items-center justify-center gap-3 py-24">
          <div className="border-primary size-7 animate-spin rounded-full border-2 border-t-transparent" />
          <p className="text-muted-foreground text-xs">{t("detail.loading")}</p>
        </div>
      </div>
    );
  }

  const sub = data.subscription;
  const createdAt = data.student.created_at as string | undefined;

  // Students created via the quick form land here as TRIAL — surface the next steps (schedule a
  // trial session, or activate them with pricing) right at the top of their profile.
  const status = data.student.status;
  const needsSetup =
    canEdit && isActive && (status === "TRIAL" || status === "TRIAL_BOOKED");

  // Progressive setup steps for a trial student:
  //  • "schedule" (TRIAL)                     → book a trial session, or activate right away
  //  • "booked"   (TRIAL_BOOKED, not recorded) → trial is on the calendar; activate once it's done
  //  • "done"     (TRIAL_BOOKED, recorded)     → next step: activate with pricing to start billing
  const trialStep: "schedule" | "booked" | "done" =
    status === "TRIAL" ? "schedule" : data.trialResolved ? "done" : "booked";
  const bannerTitle =
    trialStep === "done" ? t("profile.trialDoneTitle") : t("profile.trialBannerTitle");
  const bannerHint =
    trialStep === "schedule"
      ? t("profile.trialBannerHint")
      : trialStep === "booked"
        ? t("profile.trialBookedHint")
        : t("profile.trialDoneHint");

  return (
    <div className="space-y-6" data-testid="student-profile-page">
      <BackLink t={t} />

      {/* ── Hero header ─────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-3xl border bg-card shadow-sm">
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-br from-primary/15 via-primary/5 to-transparent" />
        <div className="relative flex flex-col gap-5 p-6 sm:flex-row sm:items-start">
          <div className="shrink-0">
            <Avatar name={data.student.full_name} size="lg" />
          </div>

          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold leading-tight tracking-tight">
              {data.student.full_name}
            </h1>

            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
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
              {sub && (
                <span className="inline-flex items-center gap-1 rounded-md bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
                  <BookOpen className="size-3" />
                  {sub.plan_label}
                </span>
              )}
            </div>

            {/* Meta grid */}
            <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">
              <MetaRow icon={UserCircle2} label={t("colGuardian")}>
                {data.guardian?.full_name ?? t("none")}
              </MetaRow>
              <MetaRow icon={GraduationCap} label={t("teacher.current")}>
                {data.currentTeacher?.teacher_name ?? t("teacher.none")}
              </MetaRow>
              {sub && (
                <MetaRow icon={BookOpen} label={t("subscription.price")}>
                  <span className="tabular-nums">
                    {formatMoney(
                      { amount: sub.price_minor, currency: sub.currency },
                      locale,
                    )}
                  </span>{" "}
                  <span className="text-muted-foreground">
                    · {t(`basis.${sub.price_basis}`)}
                  </span>
                </MetaRow>
              )}
              {createdAt && (
                <MetaRow icon={CalendarDays} label={t("profile.memberSince")}>
                  {new Date(createdAt).toLocaleDateString(locale, {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </MetaRow>
              )}
            </div>
          </div>
        </div>

        {/* ── Tab bar ───────────────────────────────────────────────── */}
        <div className="flex gap-1 overflow-x-auto border-t bg-muted/20 px-3 py-2">
          {tabs.map((tabItem) => {
            const Icon = tabItem.icon;
            const active = tab === tabItem.key;
            return (
              <button
                key={tabItem.key}
                type="button"
                onClick={() => setTab(tabItem.key)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition-all",
                  active
                    ? "bg-background text-foreground shadow-sm ring-1 ring-border"
                    : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
                )}
              >
                <Icon className="size-4" aria-hidden />
                {tabItem.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Trial setup call-to-action ──────────────────────────────── */}
      {needsSetup && (
        <div className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800/40 dark:bg-amber-950/20 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 ring-1 ring-amber-500/25">
              <Zap className="size-4 text-amber-600 dark:text-amber-400" aria-hidden />
            </div>
            <div>
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                {bannerTitle}
              </p>
              <p className="mt-0.5 text-xs text-amber-700/80 dark:text-amber-400/70">
                {bannerHint}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            {/* Only offer "schedule trial" when no trial is booked yet (status TRIAL). Once a
                trial is scheduled (TRIAL_BOOKED) the action disappears everywhere. */}
            {status === "TRIAL" && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setAction("trial")}
                data-testid="profile-schedule-trial"
                className="gap-1.5 border-amber-300 text-amber-700 hover:bg-amber-100 dark:border-amber-700/50 dark:text-amber-300 dark:hover:bg-amber-950/40"
              >
                <Zap className="size-3.5" />
                {t("actions.scheduleTrial")}
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              onClick={() => setAction("enroll")}
              data-testid="profile-activate"
              className="gap-1.5 border-transparent bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:ring-emerald-500/40"
            >
              <UserCheck className="size-3.5" />
              {t("profile.activate")}
            </Button>
          </div>
        </div>
      )}

      {/* ── Alerts ──────────────────────────────────────────────────── */}
      {error && (
        <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />
      )}
      {notice && (
        <AlertBanner
          variant="success"
          message={notice}
          onDismiss={() => setNotice(null)}
        />
      )}

      {/* ── Tab body ────────────────────────────────────────────────── */}
      <div
        className={
          tab === "schedule" ? "" : "rounded-2xl border bg-card p-6 shadow-sm"
        }
      >
        {tab === "profile" && (
          <ProfileSection
            data={data}
            canEdit={canEdit}
            onSaved={() => {
              setNotice(t("form.saved"));
              void refresh();
            }}
            onError={setError}
          />
        )}

        {tab === "subscription" && (
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
            onGoToSchedule={
              can("schedule.read") ? () => setTab("schedule") : undefined
            }
          />
        )}

        {tab === "teacher" && (
          <TeacherSection
            data={data}
            history={history}
            teachers={teachers}
            canEdit={canEdit}
            studentId={studentId}
            onChanged={() => void refresh()}
            onError={setError}
          />
        )}

        {tab === "schedule" && can("schedule.read") && (
          <StudentTimetable
            studentId={studentId}
            studentName={data.student.full_name}
            studentStatus={status}
            canManage={can("schedule.manage")}
            onError={setError}
          />
        )}

        {tab === "settings" && canEdit && isActive && (
          <div className="space-y-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                {t("profile.settingsTitle")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("profile.settingsSubtitle")}
              </p>
            </div>
            <DangerZone
              studentId={studentId}
              onDeactivated={() => router.push("/students")}
              onError={setError}
            />
          </div>
        )}
      </div>

      {/* ── Schedule trial ──────────────────────────────────────────── */}
      {action === "trial" && (
        <ScheduleTrialModal
          open
          studentId={studentId}
          studentName={data.student.full_name}
          defaultTeacherId={data.currentTeacher?.teacher_id}
          onClose={() => setAction("none")}
          onScheduled={() => {
            setAction("none");
            setNotice(t("trialFlow.scheduled"));
            void refresh();
          }}
        />
      )}

      {/* ── Activate / enroll ───────────────────────────────────────── */}
      <Modal
        open={action === "enroll"}
        onClose={() => setAction("none")}
        title={t("enroll.titleNamed", { name: data.student.full_name })}
        description={t("enroll.description")}
        size="md"
      >
        {action === "enroll" && (
          <EnrollmentWizard
            studentId={studentId}
            currentTeacherId={data.currentTeacher?.teacher_id}
            onCancel={() => setAction("none")}
            onCompleted={() => {
              setAction("none");
              setNotice(t("enroll.confirmed"));
              void refresh();
            }}
          />
        )}
      </Modal>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function BackLink({ t }: { t: ReturnType<typeof useTranslations> }) {
  return (
    <Link
      href="/students"
      className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
      {t("profile.back")}
    </Link>
  );
}

function MetaRow({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof UserCircle2;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/60 ring-1 ring-border/60">
        <Icon className="size-4 text-muted-foreground" aria-hidden />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
          {label}
        </p>
        <p className="truncate text-sm font-medium">{children}</p>
      </div>
    </div>
  );
}
