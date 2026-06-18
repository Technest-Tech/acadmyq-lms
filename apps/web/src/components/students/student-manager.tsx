"use client";

import {
  ArrowUpRight,
  GraduationCap,
  Plus,
  Sparkles,
  UserCheck,
  Users,
  UserX,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, type ComponentType } from "react";
import { useAuth } from "@/components/auth-provider";
import { EnrollmentWizard } from "@/components/students/enrollment-wizard";
import { StudentForm } from "@/components/students/student-form";
import { StudentsList } from "@/components/students/students-list";
import { TeacherStudentSessions } from "@/components/students/teacher-student-sessions";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { deactivateStudent, listStudents } from "@/lib/api";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────────

type ModalState =
  | { kind: "closed" }
  | { kind: "new" }
  | { kind: "teacher-sessions"; id: string; name: string }
  | { kind: "enroll"; id: string; name: string; teacherId?: string }
  | { kind: "cancel-trial"; id: string; name: string };

interface Stats {
  total: number;
  active: number;
  trials: number;
  inactive: number;
}

// ── Component ──────────────────────────────────────────────────────────────────

export function StudentManager() {
  const t = useTranslations("students");
  const router = useRouter();
  const { can, session } = useAuth();
  const isTeacher = session?.role === "TEACHER";

  const openStudent = (id: string, name: string) => {
    if (isTeacher) {
      setModal({ kind: "teacher-sessions", id, name });
    } else {
      router.push(`/students/${id}`);
    }
  };

  const [modal, setModal] = useState<ModalState>({ kind: "closed" });
  const [refreshToken, setRefreshToken] = useState(0);
  const [stats, setStats] = useState<Stats | null>(null);
  const [alert, setAlert] = useState<{
    variant: "success" | "error";
    message: string;
  } | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);

  function refresh() {
    setRefreshToken((n) => n + 1);
  }

  function showAlert(variant: "success" | "error", message: string) {
    setAlert({ variant, message });
    if (variant === "success") {
      const timer = setTimeout(() => setAlert(null), 4500);
      return () => clearTimeout(timer);
    }
  }

  useEffect(() => {
    void Promise.all([
      listStudents({ pageSize: 1 }),
      listStudents({ pageSize: 1, filter: { status: "active" } }),
      listStudents({ pageSize: 1, filter: { trial_any: "1" } }),
      listStudents({ pageSize: 1, filter: { status: "inactive" } }),
    ])
      .then(([all, active, trials, inactive]) =>
        setStats({
          total: all.total,
          active: active.total,
          trials: trials.total,
          inactive: inactive.total,
        }),
      )
      .catch(() => {});
  }, [refreshToken]);

  async function confirmCancelTrial(id: string) {
    setCancelBusy(true);
    try {
      await deactivateStudent(id);
      setModal({ kind: "closed" });
      refresh();
      showAlert("success", "Trial cancelled — student deactivated.");
    } catch {
      showAlert("error", "Failed to cancel trial. Please try again.");
    } finally {
      setCancelBusy(false);
    }
  }

  return (
    <div className="space-y-8">

      {/* ── Page header ───────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="relative shrink-0">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/60 shadow-lg shadow-primary/30">
              <GraduationCap className="size-6 text-white" aria-hidden />
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full border-2 border-background bg-emerald-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
            <p className="text-muted-foreground mt-0.5 text-sm">
              {t("subtitle")}
            </p>
          </div>
        </div>
        {can("student.create") && (
          <Button
            type="button"
            size="lg"
            onClick={() => setModal({ kind: "new" })}
            data-testid="new-student"
            className="gap-2 px-4 shadow-md shadow-primary/25"
          >
            <Plus className="size-4" aria-hidden />
            {t("new")}
          </Button>
        )}
      </div>

      {/* ── Stat cards ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          icon={Users}
          label={t("stats.total")}
          value={stats?.total ?? null}
          colorClass="text-primary"
          bgClass="bg-primary/10"
          ringClass="ring-primary/20"
          gradientFrom="from-primary/8"
        />
        <StatCard
          icon={UserCheck}
          label={t("stats.active")}
          value={stats?.active ?? null}
          colorClass="text-emerald-600 dark:text-emerald-400"
          bgClass="bg-emerald-500/10"
          ringClass="ring-emerald-500/20"
          gradientFrom="from-emerald-500/8"
        />
        <StatCard
          icon={Sparkles}
          label={t("stats.trials")}
          value={stats?.trials ?? null}
          colorClass="text-amber-600 dark:text-amber-400"
          bgClass="bg-amber-500/10"
          ringClass="ring-amber-500/20"
          gradientFrom="from-amber-500/8"
        />
        <StatCard
          icon={UserX}
          label={t("stats.inactive")}
          value={stats?.inactive ?? null}
          colorClass="text-slate-500 dark:text-slate-400"
          bgClass="bg-slate-400/10"
          ringClass="ring-slate-400/20"
          gradientFrom="from-slate-400/8"
        />
      </div>

      {/* ── Alert ──────────────────────────────────────────────────────────── */}
      {alert && (
        <AlertBanner
          variant={alert.variant}
          message={alert.message}
          onDismiss={() => setAlert(null)}
        />
      )}

      {/* ── Content ────────────────────────────────────────────────────────── */}
      <StudentsList
        refreshToken={refreshToken}
        onNew={() => setModal({ kind: "new" })}
        onOpen={(id, name) => openStudent(id, name)}
        onConfirmEnroll={(id, name, teacherId) =>
          setModal({ kind: "enroll", id, name, teacherId })
        }
        onCancelTrial={(id, name) => setModal({ kind: "cancel-trial", id, name })}
      />

      {/* ── Teacher: student sessions modal ────────────────────────────────── */}
      <Modal
        open={modal.kind === "teacher-sessions"}
        onClose={() => setModal({ kind: "closed" })}
        title={modal.kind === "teacher-sessions" ? modal.name : ""}
        size="md"
      >
        {modal.kind === "teacher-sessions" && (
          <TeacherStudentSessions
            studentId={modal.id}
            studentName={modal.name}
          />
        )}
      </Modal>

      {/* ── Create student modal ────────────────────────────────────────────── */}
      <Modal
        open={modal.kind === "new"}
        onClose={() => setModal({ kind: "closed" })}
        title={t("new")}
        description={t("newModal.description")}
        size="md"
      >
        <StudentForm
          onCancel={() => setModal({ kind: "closed" })}
          onCreated={() => {
            setModal({ kind: "closed" });
            refresh();
            showAlert("success", t("form.saved"));
          }}
        />
      </Modal>

      {/* ── Enrollment wizard modal ─────────────────────────────────────────── */}
      <Modal
        open={modal.kind === "enroll"}
        onClose={() => setModal({ kind: "closed" })}
        title={
          modal.kind === "enroll"
            ? t("enroll.titleNamed", { name: modal.name })
            : t("enroll.title")
        }
        description={t("enroll.description")}
        size="md"
      >
        {modal.kind === "enroll" && (
          <EnrollmentWizard
            studentId={modal.id}
            currentTeacherId={modal.teacherId}
            onCancel={() => setModal({ kind: "closed" })}
            onCompleted={() => {
              setModal({ kind: "closed" });
              refresh();
              showAlert("success", t("enroll.confirmed"));
            }}
          />
        )}
      </Modal>

      {/* ── Cancel trial confirmation modal ────────────────────────────────── */}
      <Modal
        open={modal.kind === "cancel-trial"}
        onClose={() => setModal({ kind: "closed" })}
        title={t("trialFlow.cancelTitle")}
        size="sm"
      >
        {modal.kind === "cancel-trial" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t.rich("trialFlow.cancelBody", {
                name: modal.name,
                b: (chunks) => (
                  <span className="font-semibold text-foreground">{chunks}</span>
                ),
              })}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setModal({ kind: "closed" })}
                disabled={cancelBusy}
              >
                {t("actions.keepStudent")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={cancelBusy}
                onClick={() => void confirmCancelTrial(modal.id)}
                className="gap-1.5"
              >
                {cancelBusy && (
                  <span className="size-3.5 animate-spin rounded-full border border-current border-t-transparent" />
                )}
                {t("trialFlow.cancelConfirm")}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ── Stat card ──────────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  colorClass,
  bgClass,
  ringClass,
  gradientFrom,
  onClick,
  badge,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: number | null;
  colorClass: string;
  bgClass: string;
  ringClass: string;
  gradientFrom: string;
  onClick?: () => void;
  badge?: number;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-xl border bg-card px-4 py-3 shadow-sm",
        "bg-gradient-to-r to-transparent",
        gradientFrom,
        onClick && "cursor-pointer hover:shadow-md transition-shadow",
      )}
    >
      <div
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-xl ring-1",
          bgClass,
          ringClass,
        )}
      >
        <Icon className={cn("size-4", colorClass)} aria-hidden />
      </div>
      <div className="min-w-0">
        {value === null ? (
          <div className="h-5 w-10 animate-pulse rounded bg-muted" />
        ) : (
          <div className="flex items-center gap-1.5">
            <div className="text-xl font-bold tabular-nums tracking-tight leading-tight">
              {value.toLocaleString()}
            </div>
            {badge != null && badge > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-bold text-white">
                {badge > 99 ? "99+" : badge}
              </span>
            )}
          </div>
        )}
        <div className="text-muted-foreground truncate text-[11px] font-medium uppercase tracking-wide">
          {label}
        </div>
      </div>
      <ArrowUpRight
        className={cn(
          "ms-auto size-3.5 shrink-0 transition-opacity",
          onClick ? "text-foreground/20 hover:text-foreground/40" : "text-foreground/[0.1]",
        )}
        aria-hidden
      />
    </div>
  );
}
