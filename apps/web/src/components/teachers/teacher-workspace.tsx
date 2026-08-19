"use client";

import {
  ArrowLeft,
  BadgeCheck,
  Banknote,
  CalendarDays,
  Clock,
  FileText,
  GraduationCap,
  MessageCircle,
  User,
  Users,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { type ComponentType, useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { KhatamLattice } from "@/components/ornaments";
import { TeacherCalendar } from "@/components/teachers/teacher-calendar";
import { TeacherDetail } from "@/components/teachers/teacher-detail";
import { TeacherReports } from "@/components/teachers/teacher-reports";
import { TeacherSalary } from "@/components/teachers/teacher-salary";
import { HeroBadge, PageHero } from "@/components/ui/page-hero";
import { FactCard } from "@/components/ui/profile-card";
import { getTeacher, type TeacherRow, type TeacherStudent } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

type Tab = "profile" | "calendar" | "salary" | "reports";

/** Total teaching hours a week, from the availability windows. */
function weeklyHours(windows: { start_local: string; end_local: string }[]): number {
  const minutes = windows.reduce((sum, w) => {
    const [sh, sm] = w.start_local.split(":").map(Number);
    const [eh, em] = w.end_local.split(":").map(Number);
    const span = (eh ?? 0) * 60 + (em ?? 0) - ((sh ?? 0) * 60 + (sm ?? 0));
    return sum + Math.max(0, span);
  }, 0);
  return Math.round((minutes / 60) * 10) / 10;
}

/**
 * A teacher's workspace. Same construction as a student's file — hero, fact strip, tab rail, then
 * cards — because they are the two halves of the same question and used to look like two
 * different applications.
 *
 * The fact strip is the addition that matters: rate, specialization, student load and weekly
 * availability were each buried inside the profile FORM, so "what do we pay Kareem and how many
 * students does he carry?" meant reading input fields.
 */
export function TeacherWorkspace({ teacherId }: { teacherId: string }) {
  const t = useTranslations("teachers");
  const locale = useLocale();
  const router = useRouter();
  const { can } = useAuth();

  const [teacher, setTeacher] = useState<TeacherRow | null>(null);
  const [students, setStudents] = useState<TeacherStudent[]>([]);
  const [tab, setTab] = useState<Tab>("profile");

  const loadHeader = useCallback(async () => {
    const res = await getTeacher(teacherId);
    setTeacher(res.teacher);
    setStudents(res.students);
  }, [teacherId]);

  useEffect(() => {
    void loadHeader();
  }, [loadHeader]);

  const tabs: { key: Tab; icon: ComponentType<{ className?: string }>; show: boolean }[] = [
    { key: "profile", icon: User, show: true },
    { key: "calendar", icon: CalendarDays, show: can("schedule.read") },
    { key: "salary", icon: Wallet, show: can("payout.read") },
    {
      key: "reports",
      icon: FileText,
      show: can("teacher_report.manage") || can("session.read"),
    },
  ];

  if (teacher === null) return <TeacherWorkspaceSkeleton />;

  const isActive = teacher.deleted_at == null;
  const hours = weeklyHours(teacher.availability ?? []);

  return (
    <div className="space-y-5" data-testid="teacher-workspace">
      <Link
        href="/teachers"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm font-medium transition-colors"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
        {t("backToList")}
      </Link>

      <PageHero
        latticeId="teacher-hero-lattice"
        avatarName={teacher.full_name}
        title={teacher.full_name}
        badges={
          <>
            <HeroBadge>
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  isActive ? "animate-pulse bg-emerald-300" : "bg-white/50",
                )}
              />
              {isActive ? t("stat.active") : t("stat.inactive")}
            </HeroBadge>
            {teacher.specialization && (
              <HeroBadge tone="gold">
                <BadgeCheck className="size-3" aria-hidden />
                {teacher.specialization}
              </HeroBadge>
            )}
            {teacher.phone && (
              <HeroBadge>
                <MessageCircle className="size-3" aria-hidden />
                <span dir="ltr" className="tabular-nums">
                  {teacher.phone}
                </span>
              </HeroBadge>
            )}
          </>
        }
      />

      {/* ── Fact strip ───────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FactCard
          icon={Banknote}
          label={t("colRate")}
          tone="violet"
          value={formatMoney(
            { amount: teacher.session_rate_minor, currency: teacher.currency },
            locale,
          )}
          sub={t("fact.perHour")}
        />
        <FactCard
          icon={Users}
          label={t("detail.students")}
          tone="emerald"
          muted={students.length === 0}
          value={students.length === 0 ? t("detail.noStudents") : students.length}
          sub={students.length > 0 ? t("fact.currentLoad") : undefined}
        />
        <FactCard
          icon={Clock}
          label={t("detail.availability")}
          tone="gold"
          muted={hours === 0}
          value={hours === 0 ? t("fact.noAvailability") : t("fact.hoursWeek", { hours })}
          sub={
            hours > 0
              ? t("fact.windows", { count: teacher.availability?.length ?? 0 })
              : undefined
          }
        />
        <FactCard
          icon={GraduationCap}
          label={t("colSpecialization")}
          tone="slate"
          muted={!teacher.specialization}
          value={teacher.specialization ?? t("detail.noSpecialization")}
          sub={teacher.timezone ?? undefined}
        />
      </div>

      {/* ── Tab rail ─────────────────────────────────────────────────── */}
      <div className="bg-card scroll-ornate flex gap-1 overflow-x-auto rounded-2xl border p-1.5 shadow-sm">
        {tabs
          .filter((tb) => tb.show)
          .map(({ key, icon: Icon }) => {
            const active = tab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                aria-current={active ? "page" : undefined}
                data-testid={`teacher-tab-${key}`}
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
                {t(`tabs.${key}`)}
              </button>
            );
          })}
      </div>

      {/* ── Tab content ──────────────────────────────────────────────── */}
      {tab === "profile" && (
        <TeacherDetail
          teacherId={teacherId}
          showHero={false}
          onBack={() => router.push("/teachers")}
          onSaved={() => void loadHeader()}
          onDeactivated={() => router.push("/teachers")}
        />
      )}

      {tab === "calendar" && (
        <TeacherCalendar
          teacherId={teacherId}
          availability={teacher.availability ?? []}
          timeZone={teacher.timezone ?? undefined}
        />
      )}

      {tab === "salary" && (
        <div className="bg-card rounded-2xl border p-5 shadow-sm sm:p-6">
          <TeacherSalary teacherId={teacherId} />
        </div>
      )}

      {tab === "reports" && <TeacherReports teacherId={teacherId} />}
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

/**
 * Shown while the workspace loads — and exported so the route's `loading.tsx` shows the SAME
 * shape the instant a teacher row is clicked, instead of the list sitting frozen with no signal.
 */
export function TeacherWorkspaceSkeleton() {
  return (
    <div className="space-y-5" data-testid="teacher-workspace-skeleton">
      <div className="bg-muted h-5 w-24 animate-pulse rounded" />
      <div
        className="relative h-[8.5rem] overflow-hidden rounded-2xl shadow-lg"
        style={{
          background:
            "linear-gradient(135deg, oklch(0.30 0.065 163) 0%, oklch(0.38 0.105 168) 48%, oklch(0.32 0.085 196) 100%)",
        }}
      >
        <KhatamLattice
          id="teacher-skeleton-lattice"
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
