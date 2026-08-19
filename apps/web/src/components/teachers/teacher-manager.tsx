"use client";

import {
  Banknote,
  GraduationCap,
  Plus,
  UserCheck,
  Users,
  UserX,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";
import { useAuth } from "@/components/auth-provider";
import { TeacherForm } from "@/components/teachers/teacher-form";
import { TeachersList } from "@/components/teachers/teachers-list";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { HeroPill, PageHero } from "@/components/ui/page-hero";
import { SegmentTile } from "@/components/ui/segment-tile";
import { ApiError, deleteTeacher, listTeachers } from "@/lib/api";
import { formatMoney } from "@/lib/money";

// ── Types ──────────────────────────────────────────────────────────────────────

type ModalState =
  | { kind: "closed" }
  | { kind: "new" }
  | { kind: "delete"; id: string; name: string };

/**
 * The roster, cut three ways. Each tile is a saved view: the count and the rows below it come
 * from the same server filter, so they can never disagree.
 */
type SegmentKey = "total" | "active" | "inactive";

const SEGMENT_FILTERS: Record<SegmentKey, Record<string, string>> = {
  total: {},
  active: { status: "active" },
  inactive: { status: "inactive" },
};

interface Stats {
  total: number;
  active: number;
  inactive: number;
  avgRateMinor: number | null;
  currency: string;
}

// ── Component ──────────────────────────────────────────────────────────────────

/** The teachers container: roster, stats & modal flows, inside the authenticated shell. */
export function TeacherManager() {
  const t = useTranslations("teachers");
  const locale = useLocale();
  const { can } = useAuth();
  const router = useRouter();

  const [modal, setModal] = useState<ModalState>({ kind: "closed" });
  const [refreshToken, setRefreshToken] = useState(0);
  const [stats, setStats] = useState<Stats | null>(null);
  const [alert, setAlert] = useState<{
    variant: "success" | "error";
    message: string;
  } | null>(null);

  function refresh() {
    setRefreshToken((n) => n + 1);
  }

  const [deleteBusy, setDeleteBusy] = useState(false);
  const [segment, setSegment] = useState<SegmentKey>("total");
  const [presetToken, setPresetToken] = useState(0);

  /** Clicking the active tile returns to the whole roster — a toggle, not a one-way trip. */
  function selectSegment(key: SegmentKey) {
    setSegment((prev) => (prev === key ? "total" : key));
    setPresetToken((n) => n + 1);
  }

  /**
   * Opening a workspace is a real navigation. Left bare it read as a dead click, so the row is
   * marked pending while React transitions, and the route is warmed on hover so most clicks land
   * on a page that has already loaded.
   */
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startNavigation] = useTransition();
  const prefetched = useRef<Set<string>>(new Set());

  function prefetchTeacher(id: string) {
    if (prefetched.current.has(id)) return;
    prefetched.current.add(id);
    router.prefetch(`/teachers/${id}`);
  }

  function openTeacher(id: string) {
    setPendingId(id);
    startNavigation(() => router.push(`/teachers/${id}`));
  }

  function showAlert(variant: "success" | "error", message: string) {
    setAlert({ variant, message });
    if (variant === "success") {
      setTimeout(() => setAlert(null), 4500);
    }
  }

  async function confirmDelete(id: string) {
    setDeleteBusy(true);
    try {
      await deleteTeacher(id);
      setModal({ kind: "closed" });
      refresh();
      showAlert("success", t("detail.deleted"));
    } catch (err) {
      setModal({ kind: "closed" });
      showAlert(
        "error",
        err instanceof ApiError
          ? t("detail.deleteFailed")
          : String(err),
      );
    } finally {
      setDeleteBusy(false);
    }
  }

  useEffect(() => {
    void Promise.all([
      listTeachers({ pageSize: 1 }),
      listTeachers({ pageSize: 1, filter: { status: "inactive" } }),
      listTeachers({ pageSize: 100, filter: { status: "active" } }),
    ])
      .then(([all, inactive, active]) => {
        const rows = active.rows;
        const avg =
          rows.length > 0
            ? Math.round(
                rows.reduce((sum, r) => sum + r.session_rate_minor, 0) /
                  rows.length,
              )
            : null;
        setStats({
          total: all.total,
          active: active.total,
          inactive: inactive.total,
          avgRateMinor: avg,
          currency: rows[0]?.currency ?? "EGP",
        });
      })
      .catch(() => {});
  }, [refreshToken]);

  const pct = (value: number | null) =>
    stats && stats.total > 0 && value !== null
      ? Math.round((value / stats.total) * 100)
      : null;

  return (
    <div className="space-y-5">
      <PageHero
        latticeId="teachers-hero-lattice"
        icon={GraduationCap}
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <>
            {/* Average pay belongs beside the roster, not in a tile that filters nothing —
                it is a fact about the roster, not a slice of it. */}
            {stats?.avgRateMinor != null && (
              <HeroPill>
                <Banknote className="size-3.5" aria-hidden />
                {t("stat.avgRate")}{" "}
                {formatMoney(
                  { amount: stats.avgRateMinor, currency: stats.currency },
                  locale,
                )}
              </HeroPill>
            )}
            {can("teacher.create") && (
              <Button
                type="button"
                size="lg"
                onClick={() => setModal({ kind: "new" })}
                data-testid="new-teacher"
                className="gap-2 border-transparent bg-white px-4 text-emerald-800 shadow-md hover:bg-white/90"
              >
                <Plus className="size-4" aria-hidden />
                {t("new")}
              </Button>
            )}
          </>
        }
      />

      {/* ── Segment tiles ───────────────────────────────────────────────── */}
      <div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SegmentTile
            testKey="total"
            icon={Users}
            label={t("stat.total")}
            hint={t("stat.totalSub")}
            value={stats?.total ?? null}
            share={null}
            tone="emerald"
            selected={segment === "total"}
            onSelect={() => selectSegment("total")}
          />
          <SegmentTile
            testKey="active"
            icon={UserCheck}
            label={t("stat.active")}
            hint={t("stat.activeSub")}
            value={stats?.active ?? null}
            share={pct(stats?.active ?? null)}
            tone="teal"
            selected={segment === "active"}
            onSelect={() => selectSegment("active")}
          />
          <SegmentTile
            testKey="inactive"
            icon={UserX}
            label={t("stat.inactive")}
            hint={t("stat.inactiveSub")}
            value={stats?.inactive ?? null}
            share={pct(stats?.inactive ?? null)}
            tone="slate"
            selected={segment === "inactive"}
            onSelect={() => selectSegment("inactive")}
          />
        </div>
        <p className="text-muted-foreground/80 mt-2 text-[11px]">
          {t("stat.filterHint")}
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

      {/* ── Roster ─────────────────────────────────────────────────────────── */}
      <TeachersList
        refreshToken={refreshToken}
        filterPreset={{ values: SEGMENT_FILTERS[segment], token: presetToken }}
        pendingRowId={pendingId}
        onPrefetch={prefetchTeacher}
        onNew={() => setModal({ kind: "new" })}
        onOpen={(id) => openTeacher(id)}
        onDelete={(id, name) => setModal({ kind: "delete", id, name })}
      />

      {/* ── Create teacher modal ────────────────────────────────────────────── */}
      <Modal
        open={modal.kind === "new"}
        onClose={() => setModal({ kind: "closed" })}
        title={t("new")}
        size="md"
      >
        <TeacherForm
          onCancel={() => setModal({ kind: "closed" })}
          onCreated={(id) => {
            setModal({ kind: "closed" });
            router.push(`/teachers/${id}`);
          }}
        />
      </Modal>

      {/* ── Delete (permanent) confirmation modal ───────────────────────────── */}
      <Modal
        open={modal.kind === "delete"}
        onClose={() => setModal({ kind: "closed" })}
        title={t("detail.delete")}
        size="sm"
      >
        {modal.kind === "delete" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("detail.deleteConfirmBody")}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={deleteBusy}
                onClick={() => setModal({ kind: "closed" })}
              >
                {t("detail.deactivateCancel")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={deleteBusy}
                className="gap-1.5"
                data-testid="confirm-delete-teacher"
                onClick={() => void confirmDelete(modal.id)}
              >
                {deleteBusy && (
                  <span className="size-3.5 animate-spin rounded-full border border-current border-t-transparent" />
                )}
                {t("detail.deleteYes")}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
