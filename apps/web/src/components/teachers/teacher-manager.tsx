"use client";

import {
  ArrowUpRight,
  GraduationCap,
  Plus,
  TrendingUp,
  UserCheck,
  Users,
  UserX,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { type ComponentType, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { TeacherForm } from "@/components/teachers/teacher-form";
import { TeachersList } from "@/components/teachers/teachers-list";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ApiError, deleteTeacher, listTeachers } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────────

type ModalState =
  | { kind: "closed" }
  | { kind: "new" }
  | { kind: "delete"; id: string; name: string };

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
        {can("teacher.create") && (
          <Button
            type="button"
            size="lg"
            onClick={() => setModal({ kind: "new" })}
            data-testid="new-teacher"
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
          label={t("stat.total")}
          value={stats ? stats.total.toLocaleString() : null}
          colorClass="text-primary"
          bgClass="bg-primary/10"
          ringClass="ring-primary/20"
          gradientFrom="from-primary/8"
        />
        <StatCard
          icon={UserCheck}
          label={t("stat.active")}
          value={stats ? stats.active.toLocaleString() : null}
          colorClass="text-emerald-600 dark:text-emerald-400"
          bgClass="bg-emerald-500/10"
          ringClass="ring-emerald-500/20"
          gradientFrom="from-emerald-500/8"
        />
        <StatCard
          icon={UserX}
          label={t("stat.inactive")}
          value={stats ? stats.inactive.toLocaleString() : null}
          colorClass="text-slate-500 dark:text-slate-400"
          bgClass="bg-slate-400/10"
          ringClass="ring-slate-400/20"
          gradientFrom="from-slate-400/8"
        />
        <StatCard
          icon={TrendingUp}
          label={t("stat.avgRate")}
          value={
            stats
              ? stats.avgRateMinor != null
                ? formatMoney(
                    { amount: stats.avgRateMinor, currency: stats.currency },
                    locale,
                  )
                : "—"
              : null
          }
          colorClass="text-violet-600 dark:text-violet-400"
          bgClass="bg-violet-500/10"
          ringClass="ring-violet-500/20"
          gradientFrom="from-violet-500/8"
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

      {/* ── Roster ─────────────────────────────────────────────────────────── */}
      <TeachersList
        refreshToken={refreshToken}
        onNew={() => setModal({ kind: "new" })}
        onOpen={(id) => router.push(`/teachers/${id}`)}
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

// ── Stat card ──────────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  colorClass,
  bgClass,
  ringClass,
  gradientFrom,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string | null;
  colorClass: string;
  bgClass: string;
  ringClass: string;
  gradientFrom: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border bg-card px-4 py-3 shadow-sm",
        "bg-gradient-to-r to-transparent",
        gradientFrom,
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
          <div className="h-5 w-12 animate-pulse rounded bg-muted" />
        ) : (
          <div className="text-xl font-bold leading-tight tracking-tight tabular-nums">
            {value}
          </div>
        )}
        <div className="text-muted-foreground truncate text-[11px] font-medium uppercase tracking-wide">
          {label}
        </div>
      </div>
      <ArrowUpRight
        className="ms-auto size-3.5 shrink-0 text-foreground/[0.1]"
        aria-hidden
      />
    </div>
  );
}
