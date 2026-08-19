"use client";

import {
  ArrowLeft,
  BookOpen,
  CalendarDays,
  GraduationCap,
  Settings2,
  UserCheck,
  UserCircle2,
  Users,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { KhatamLattice } from "@/components/ornaments";
import { StudentTimetable } from "@/components/scheduling/student-timetable";
import { EnrollmentWizard } from "@/components/students/enrollment-wizard";
import { FactCard } from "@/components/ui/profile-card";
import { ScheduleTrialModal } from "@/components/students/schedule-trial-modal";
import {
  DangerZone,
  ProfileSection,
  ReactivatePanel,
  SubscriptionSection,
  TeacherSection,
} from "@/components/students/student-detail";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { HeroBadge, PageHero } from "@/components/ui/page-hero";
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

/**
 * A student's file. The page answers, in order: who is this (hero), the four things anyone asks
 * about them (fact strip), what needs doing next (trial banner), and then one tab per subject —
 * each of which is a GRID OF CARDS, not a stack of form sections under grey captions.
 *
 * The fact strip is the part that earns its place: teacher, rate, parent and tenure used to be a
 * click deep in three different tabs, so the commonest question about a student ("who teaches
 * Yusuf and what do we charge?") cost two navigations to answer.
 */
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
    if (canEdit) {
      list.push({ key: "settings", label: t("profile.tabSettings"), icon: Settings2 });
    }
    return list;
  }, [t, can, canEdit]);

  if (notFound) {
    return (
      <div className="space-y-5">
        <BackLink t={t} />
        <div className="bg-card text-muted-foreground rounded-2xl border p-10 text-center text-sm">
          {t("profile.notFound")}
        </div>
      </div>
    );
  }

  if (data === null) return <StudentProfileSkeleton />;

  const sub = data.subscription;
  const createdAt = data.student.created_at as string | undefined;
  const status = data.student.status;

  // Students created via the quick form land here as TRIAL — surface the next steps (schedule a
  // trial session, or activate them with pricing) right at the top of their profile.
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

  const memberSince = createdAt
    ? new Date(createdAt).toLocaleDateString(locale, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  return (
    <div className="space-y-5" data-testid="student-profile-page">
      <BackLink t={t} />

      <PageHero
        latticeId="student-hero-lattice"
        avatarName={data.student.full_name}
        title={data.student.full_name}
        badges={
          <>
            <HeroBadge>
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  isActive ? "animate-pulse bg-emerald-300" : "bg-white/50",
                )}
              />
              {isActive ? t("filter.active") : t("filter.inactive")}
            </HeroBadge>
            {status && status !== "REGULAR" && (
              <HeroBadge tone="gold">{t(`studentStatus.${status}`)}</HeroBadge>
            )}
            {data.student.is_self_guardian && (
              <HeroBadge>{t("form.selfGuardian")}</HeroBadge>
            )}
            {sub && (
              <HeroBadge>
                <BookOpen className="size-3" aria-hidden />
                {sub.plan_label}
              </HeroBadge>
            )}
          </>
        }
      />

      {/* ── Fact strip ───────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FactCard
          icon={GraduationCap}
          label={t("teacher.current")}
          tone="emerald"
          muted={!data.currentTeacher}
          value={data.currentTeacher?.teacher_name ?? t("teacher.none")}
          sub={
            data.currentTeacher?.started_at
              ? t("teacher.since", {
                  date: data.currentTeacher.started_at.slice(0, 10),
                })
              : undefined
          }
        />
        <FactCard
          icon={BookOpen}
          label={t("colRate")}
          tone="violet"
          muted={!sub}
          value={
            sub
              ? formatMoney(
                  { amount: sub.price_minor, currency: sub.currency },
                  locale,
                )
              : t("list.noSubscription")
          }
          sub={sub ? t(`basis.${sub.price_basis}`) : undefined}
        />
        <FactCard
          icon={Users}
          label={t("colGuardian")}
          tone="gold"
          muted={!data.guardian}
          value={data.guardian?.full_name ?? t("form.none")}
          sub={data.guardian?.whatsapp_phone ?? undefined}
        />
        <FactCard
          icon={CalendarDays}
          label={t("profile.memberSince")}
          tone="slate"
          muted={!memberSince}
          value={memberSince ?? t("none")}
        />
      </div>

      {/* ── Trial setup call-to-action ──────────────────────────────── */}
      {needsSetup && (
        <div className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-500/[0.1] to-transparent p-4 sm:flex-row sm:items-center sm:justify-between dark:border-amber-800/40">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 ring-1 ring-amber-500/25">
              <Zap className="size-4 text-amber-600 dark:text-amber-400" aria-hidden />
            </div>
            <div className="min-w-0">
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

      {/* ── Tab rail ────────────────────────────────────────────────── */}
      <div className="bg-card scroll-ornate flex gap-1 overflow-x-auto rounded-2xl border p-1.5 shadow-sm">
        {tabs.map((tabItem) => {
          const Icon = tabItem.icon;
          const active = tab === tabItem.key;
          return (
            <button
              key={tabItem.key}
              type="button"
              onClick={() => setTab(tabItem.key)}
              aria-current={active ? "page" : undefined}
              data-testid={`profile-tab-${tabItem.key}`}
              className={cn(
                "relative flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all",
                active
                  ? "bg-primary/10 text-primary ring-primary/20 ring-1"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              {/* The gold thread marks the open tab — the frame's own way of saying "here". */}
              {active && (
                <span
                  className="via-gold absolute inset-x-3 top-0 h-px bg-gradient-to-r from-transparent to-transparent"
                  aria-hidden
                />
              )}
              <Icon className="size-4" aria-hidden />
              {tabItem.label}
            </button>
          );
        })}
      </div>

      {/* ── Tab body ────────────────────────────────────────────────── */}
      {tab === "profile" && (
        <ProfileSection
          data={data}
          canEdit={canEdit && isActive}
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
          canEdit={canEdit && isActive}
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
          canEdit={canEdit && isActive}
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

      {tab === "settings" && canEdit && (
        // A deactivated student had no route back from this page before — the reactivate panel
        // existed but was never rendered anywhere. Now the tab shows whichever applies.
        isActive ? (
          <DangerZone
            studentId={studentId}
            onDeactivated={() => router.push("/students")}
            onError={setError}
          />
        ) : (
          <ReactivatePanel
            studentId={studentId}
            onReactivated={() => {
              setNotice(t("form.saved"));
              void refresh();
            }}
            onError={setError}
          />
        )
      )}

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

// ── Skeleton ──────────────────────────────────────────────────────────────────

/**
 * Shown while the profile loads — and exported so the route's `loading.tsx` can show the SAME
 * shape the instant a row is clicked. A spinner in the middle of an empty page tells the user
 * "wait"; a skeleton tells them what is arriving and keeps the layout from jumping when it does.
 */
export function StudentProfileSkeleton() {
  return (
    <div className="space-y-5" data-testid="student-profile-skeleton">
      <div className="bg-muted h-5 w-24 animate-pulse rounded" />
      <div
        className="relative h-[8.5rem] overflow-hidden rounded-2xl shadow-lg"
        style={{
          background:
            "linear-gradient(135deg, oklch(0.30 0.065 163) 0%, oklch(0.38 0.105 168) 48%, oklch(0.32 0.085 196) 100%)",
        }}
      >
        <KhatamLattice
          id="student-skeleton-lattice"
          size={64}
          className="pointer-events-none absolute inset-0 h-full w-full text-white opacity-[0.16]"
        />
        <div className="relative flex items-center gap-4 p-6">
          <div className="size-16 shrink-0 animate-pulse rounded-2xl bg-white/20" />
          <div className="space-y-2">
            <div className="h-6 w-52 animate-pulse rounded bg-white/25" />
            <div className="h-4 w-36 animate-pulse rounded bg-white/15" />
          </div>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="bg-card flex items-start gap-3 rounded-xl border p-3.5 shadow-sm"
          >
            <div className="bg-muted size-9 shrink-0 animate-pulse rounded-xl" />
            <div className="flex-1 space-y-2 py-0.5">
              <div className="bg-muted h-2.5 w-16 animate-pulse rounded" />
              <div className="bg-muted h-3.5 w-24 animate-pulse rounded" />
            </div>
          </div>
        ))}
      </div>
      <div className="bg-card h-13 animate-pulse rounded-2xl border shadow-sm" />
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="bg-card rounded-2xl border shadow-sm">
            <div className="bg-muted/40 h-16 rounded-t-2xl border-b" />
            <div className="space-y-3 p-5">
              <div className="bg-muted h-9 animate-pulse rounded-xl" />
              <div className="bg-muted h-9 animate-pulse rounded-xl" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function BackLink({ t }: { t: ReturnType<typeof useTranslations> }) {
  return (
    <Link
      href="/students"
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm font-medium transition-colors"
    >
      <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
      {t("profile.back")}
    </Link>
  );
}
