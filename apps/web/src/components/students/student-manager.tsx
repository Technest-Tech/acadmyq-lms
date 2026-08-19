"use client";

import {
  GraduationCap,
  Plus,
  Sparkles,
  UserCheck,
  Users,
  UserX,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";
import { useAuth } from "@/components/auth-provider";
import { EnrollmentWizard } from "@/components/students/enrollment-wizard";
import { StudentForm } from "@/components/students/student-form";
import { StudentsList } from "@/components/students/students-list";
import { TeacherStudentSessions } from "@/components/students/teacher-student-sessions";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { HeroPill, PageHero } from "@/components/ui/page-hero";
import { SegmentTile } from "@/components/ui/segment-tile";
import { deactivateStudent, listStudents } from "@/lib/api";

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

/**
 * The roll, cut four ways. Each tile is a SAVED VIEW, not a decoration: the number it shows and
 * the rows the table lists below it come from the same server filter, so a count can never
 * disagree with the list it claims to summarise.
 *
 * `trials` is `trial_any` rather than a `student_status` value because a trial is two stages —
 * booked and not yet booked — and an academy thinks of them as one pile.
 */
type SegmentKey = "total" | "active" | "trials" | "inactive";

const SEGMENT_FILTERS: Record<SegmentKey, Record<string, string>> = {
  total: {},
  active: { status: "active" },
  trials: { trial_any: "1" },
  inactive: { status: "inactive" },
};

// ── Component ──────────────────────────────────────────────────────────────────

export function StudentManager() {
  const t = useTranslations("students");
  const router = useRouter();
  const { can, session } = useAuth();
  const isTeacher = session?.role === "TEACHER";

  /**
   * Opening a profile is a real navigation — the segment has to be fetched before anything
   * renders. Left bare it looked like a dead click, so: mark the row pending (spinner + highlight)
   * for as long as React is transitioning, and warm the route on hover so most clicks land on an
   * already-loaded page. The route's own `loading.tsx` takes over the moment the swap happens.
   */
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startNavigation] = useTransition();
  const prefetched = useRef<Set<string>>(new Set());

  const prefetchStudent = (id: string) => {
    if (isTeacher || prefetched.current.has(id)) return;
    prefetched.current.add(id);
    router.prefetch(`/students/${id}`);
  };

  const openStudent = (id: string, name: string) => {
    if (isTeacher) {
      setModal({ kind: "teacher-sessions", id, name });
      return;
    }
    setPendingId(id);
    startNavigation(() => router.push(`/students/${id}`));
  };

  const [modal, setModal] = useState<ModalState>({ kind: "closed" });
  const [refreshToken, setRefreshToken] = useState(0);
  const [stats, setStats] = useState<Stats | null>(null);
  const [alert, setAlert] = useState<{
    variant: "success" | "error";
    message: string;
  } | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [segment, setSegment] = useState<SegmentKey>("total");
  // Bumped on every tile click — the table applies a preset only when this changes, so the
  // selects the user touches by hand are never overwritten by a re-render.
  const [presetToken, setPresetToken] = useState(0);

  /** Clicking the active tile returns to the whole roll — a toggle, not a one-way trip. */
  function selectSegment(key: SegmentKey) {
    setSegment((prev) => (prev === key ? "total" : key));
    setPresetToken((n) => n + 1);
  }

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

  const pct = (value: number | null) =>
    stats && stats.total > 0 && value !== null
      ? Math.round((value / stats.total) * 100)
      : null;

  return (
    <div className="space-y-5">

      <PageHero
        latticeId="students-hero-lattice"
        icon={GraduationCap}
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <>
            {stats && (
              <HeroPill>
                <Users className="size-3.5" aria-hidden />
                {t("hero.onRoll", { count: stats.total })}
              </HeroPill>
            )}
            {can("student.create") && (
              <Button
                type="button"
                size="lg"
                onClick={() => setModal({ kind: "new" })}
                data-testid="new-student"
                className="gap-2 border-transparent bg-white px-4 text-emerald-800 shadow-md hover:bg-white/90"
              >
                <Plus className="size-4" aria-hidden />
                {t("new")}
              </Button>
            )}
          </>
        }
      />

      {/* ── Segment tiles ───────────────────────────────────────────────────
          Not a scoreboard — a filter. Each tile narrows the table below it, so the number and the
          rows can never tell two different stories. */}
      <div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SegmentTile
            testKey="total"
            icon={Users}
            label={t("stats.total")}
            hint={t("stats.totalSub")}
            value={stats?.total ?? null}
            share={null}
            tone="emerald"
            selected={segment === "total"}
            onSelect={() => selectSegment("total")}
          />
          <SegmentTile
            testKey="active"
            icon={UserCheck}
            label={t("stats.active")}
            hint={t("stats.activeSub")}
            value={stats?.active ?? null}
            share={pct(stats?.active ?? null)}
            tone="teal"
            selected={segment === "active"}
            onSelect={() => selectSegment("active")}
          />
          <SegmentTile
            testKey="trials"
            icon={Sparkles}
            label={t("stats.trials")}
            hint={t("stats.trialsSub")}
            value={stats?.trials ?? null}
            share={pct(stats?.trials ?? null)}
            tone="gold"
            selected={segment === "trials"}
            onSelect={() => selectSegment("trials")}
          />
          <SegmentTile
            testKey="inactive"
            icon={UserX}
            label={t("stats.inactive")}
            hint={t("stats.inactiveSub")}
            value={stats?.inactive ?? null}
            share={pct(stats?.inactive ?? null)}
            tone="slate"
            selected={segment === "inactive"}
            onSelect={() => selectSegment("inactive")}
          />
        </div>
        <p className="text-muted-foreground/80 mt-2 text-[11px]">
          {t("stats.filterHint")}
        </p>
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
        filterPreset={{ values: SEGMENT_FILTERS[segment], token: presetToken }}
        pendingRowId={pendingId}
        onPrefetch={prefetchStudent}
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
