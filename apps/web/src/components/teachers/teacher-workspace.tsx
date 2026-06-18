"use client";

import {
  ArrowLeft,
  BadgeCheck,
  CalendarDays,
  FileText,
  User,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ComponentType, useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { TeacherCalendar } from "@/components/teachers/teacher-calendar";
import { TeacherDetail } from "@/components/teachers/teacher-detail";
import { TeacherReports } from "@/components/teachers/teacher-reports";
import { TeacherSalary } from "@/components/teachers/teacher-salary";
import { getTeacher, type TeacherRow } from "@/lib/api";
import { cn } from "@/lib/utils";

type Tab = "profile" | "calendar" | "salary" | "reports";

function nameHue(name: string) {
  return name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
}

function Avatar({ name }: { name: string }) {
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();
  return (
    <div
      className="flex size-12 shrink-0 items-center justify-center rounded-2xl text-base font-bold text-white shadow-sm"
      style={{ backgroundColor: `hsl(${nameHue(name)} 52% 44%)` }}
      aria-hidden
    >
      {initials}
    </div>
  );
}

/** The dedicated teacher workspace: a page header + tabbed Profile / Calendar / Salary / Reports. */
export function TeacherWorkspace({ teacherId }: { teacherId: string }) {
  const t = useTranslations("teachers");
  const router = useRouter();
  const { can } = useAuth();

  const [teacher, setTeacher] = useState<TeacherRow | null>(null);
  const [tab, setTab] = useState<Tab>("profile");

  const loadHeader = useCallback(async () => {
    const res = await getTeacher(teacherId);
    setTeacher(res.teacher);
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

  const isActive = teacher ? teacher.deleted_at == null : true;

  return (
    <div className="space-y-6">
      {/* ── Back link ──────────────────────────────────────────────────────── */}
      <Link
        href="/teachers"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" />
        {t("backToList")}
      </Link>

      {/* ── Page header ────────────────────────────────────────────────────── */}
      <div className="flex items-start gap-4">
        {teacher ? (
          <>
            <Avatar name={teacher.full_name} />
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-bold leading-tight tracking-tight">
                {teacher.full_name}
              </h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {isActive ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                    <span className="size-1.5 rounded-full bg-emerald-500" />
                    {t("stat.active")}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500 dark:bg-slate-800/40 dark:text-slate-400">
                    <span className="size-1.5 rounded-full bg-slate-400" />
                    {t("stat.inactive")}
                  </span>
                )}
                {teacher.specialization && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
                    <BadgeCheck className="size-3" />
                    {teacher.specialization}
                  </span>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-4">
            <div className="size-12 animate-pulse rounded-2xl bg-muted" />
            <div className="h-6 w-40 animate-pulse rounded bg-muted" />
          </div>
        )}
      </div>

      {/* ── Tab bar ────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 overflow-x-auto rounded-xl border bg-muted/30 p-1">
        {tabs
          .filter((tb) => tb.show)
          .map(({ key, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              data-testid={`teacher-tab-${key}`}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all",
                tab === key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
              {t(`tabs.${key}`)}
            </button>
          ))}
      </div>

      {/* ── Tab content ────────────────────────────────────────────────────── */}
      {tab === "profile" && (
        <div className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
          <TeacherDetail
            teacherId={teacherId}
            showHero={false}
            onBack={() => router.push("/teachers")}
            onSaved={() => void loadHeader()}
            onDeactivated={() => router.push("/teachers")}
          />
        </div>
      )}

      {tab === "calendar" && teacher && (
        <TeacherCalendar
          teacherId={teacherId}
          availability={teacher.availability ?? []}
          timeZone={teacher.timezone ?? undefined}
        />
      )}

      {tab === "salary" && (
        <div className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
          <TeacherSalary teacherId={teacherId} />
        </div>
      )}

      {tab === "reports" && (
        <TeacherReports teacherId={teacherId} />
      )}
    </div>
  );
}
