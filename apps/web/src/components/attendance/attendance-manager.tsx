"use client";

import { CalendarClock, ClipboardCheck } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState, type ComponentType } from "react";
import { AttendanceReportModal } from "@/components/attendance/attendance-report-modal";
import { StatusBadge } from "@/components/attendance/status-badge";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getPendingAttendance, type PendingSession } from "@/lib/api";

type Selected = { id: string; name: string | null } | null;

/**
 * The attendance page container (Sprint 6): a stats strip + the "awaiting attendance" worklist
 * (past sessions still SCHEDULED), each row opening the attendance/report popup. A Teacher sees
 * only their own sessions (server-enforced, §3.6); the Owner/support sees the whole academy.
 */
export function AttendanceManager() {
  const t = useTranslations("attendance");
  const locale = useLocale();
  const [sessions, setSessions] = useState<PendingSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selected>(null);

  const dateFmt = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await getPendingAttendance();
      setSessions(res.sessions);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pendingCount = sessions?.length ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {t("managerTitle")}
        </h1>
        <p className="text-muted-foreground mt-0.5 text-sm">
          {t("managerSubtitle")}
        </p>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard
          icon={CalendarClock}
          label={t("pendingCount")}
          value={pendingCount}
          color="amber"
        />
        <StatCard
          icon={ClipboardCheck}
          label={t("pendingTitle")}
          value={pendingCount}
          color="primary"
        />
      </div>

      {error && (
        <AlertBanner
          variant="error"
          message={error}
          onDismiss={() => setError(null)}
        />
      )}

      {/* Pending worklist */}
      <section className="bg-card rounded-2xl border p-5 shadow-sm">
        <div className="mb-4">
          <h2 className="text-sm font-semibold">{t("pendingTitle")}</h2>
          <p className="text-muted-foreground text-xs">
            {t("pendingSubtitle")}
          </p>
        </div>

        {sessions === null ? (
          <ul className="space-y-2" data-testid="pending-loading">
            {Array.from({ length: 3 }).map((_, i) => (
              <li
                key={i}
                className="bg-muted h-14 animate-pulse rounded-xl"
                aria-hidden
              />
            ))}
          </ul>
        ) : sessions.length === 0 ? (
          <div
            className="border-border/60 bg-muted/20 flex flex-col items-center rounded-xl border border-dashed p-10 text-center"
            data-testid="pending-empty"
          >
            <ClipboardCheck className="text-muted-foreground mb-2 size-6" />
            <p className="text-sm font-medium">{t("pendingNone")}</p>
          </div>
        ) : (
          <ul className="divide-y" data-testid="pending-list">
            {sessions.map((s) => (
              <li
                key={s.id}
                data-row={s.id}
                className="hover:bg-muted/30 -mx-2 flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2 py-3 transition-colors"
                onClick={() => setSelected({ id: s.id, name: s.student_name })}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {s.student_name}
                  </p>
                  <p className="text-muted-foreground truncate text-xs">
                    {s.teacher_name} ·{" "}
                    {dateFmt.format(new Date(s.scheduled_at_utc))}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StatusBadge status={s.status} />
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelected({ id: s.id, name: s.student_name });
                    }}
                  >
                    {t("record")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Attendance/report popup */}
      <AttendanceReportModal
        sessionId={selected?.id ?? ""}
        studentName={selected?.name}
        open={selected !== null}
        onClose={() => {
          setSelected(null);
          void load(); // a recorded outcome drops the session off the worklist
        }}
      />
    </div>
  );
}

// ── Stat card (mirrors the guardians manager pattern) ───────────────────────────

const COLOR_CLASSES = {
  primary: { bg: "bg-primary/10", icon: "text-primary", value: "text-primary" },
  amber: {
    bg: "bg-amber-100 dark:bg-amber-950/40",
    icon: "text-amber-600 dark:text-amber-400",
    value: "text-amber-700 dark:text-amber-300",
  },
} as const;

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: number;
  color: keyof typeof COLOR_CLASSES;
}) {
  const c = COLOR_CLASSES[color];
  return (
    <div className="bg-card flex items-center gap-4 rounded-2xl border p-5 shadow-sm">
      <div
        className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${c.bg}`}
      >
        <Icon className={`size-5 ${c.icon}`} aria-hidden />
      </div>
      <div>
        <div className={`text-2xl font-bold tabular-nums ${c.value}`}>
          {value.toLocaleString()}
        </div>
        <div className="text-muted-foreground text-xs font-medium">{label}</div>
      </div>
    </div>
  );
}
