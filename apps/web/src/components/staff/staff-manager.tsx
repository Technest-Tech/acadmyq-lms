"use client";

import {
  Building2,
  Plus,
  UserCheck,
  Users,
  UserX,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ComponentType, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { StaffForm } from "@/components/staff/staff-form";
import { StaffList } from "@/components/staff/staff-list";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ApiError, deactivateStaff, listStaff } from "@/lib/api";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

type ModalState =
  | { kind: "closed" }
  | { kind: "new" }
  | { kind: "delete"; id: string; name: string };

interface Stats {
  total: number;
  active: number;
  inactive: number;
}

// ── Stat card ─────────────────────────────────────────────────────────────────

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
      <div className="min-w-0 flex-1">
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
    </div>
  );
}

// ── StaffManager ──────────────────────────────────────────────────────────────

export function StaffManager() {
  const t = useTranslations("staff");
  const { can } = useAuth();
  const router = useRouter();

  const [modal, setModal] = useState<ModalState>({ kind: "closed" });
  const [refreshToken, setRefreshToken] = useState(0);
  const [stats, setStats] = useState<Stats | null>(null);
  const [alert, setAlert] = useState<{
    variant: "success" | "error";
    message: string;
  } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  function refresh() {
    setRefreshToken((n) => n + 1);
  }

  function showAlert(variant: "success" | "error", message: string) {
    setAlert({ variant, message });
    if (variant === "success") setTimeout(() => setAlert(null), 4500);
  }

  async function confirmDeactivate(id: string) {
    setDeleteBusy(true);
    try {
      await deactivateStaff(id);
      setModal({ kind: "closed" });
      refresh();
      showAlert("success", t("detail.deactivated"));
    } catch (err) {
      setModal({ kind: "closed" });
      showAlert("error", err instanceof ApiError ? err.message : String(err));
    } finally {
      setDeleteBusy(false);
    }
  }

  useEffect(() => {
    void Promise.all([
      listStaff({ pageSize: 1 }),
      listStaff({ pageSize: 1, filter: { status: "inactive" } }),
      listStaff({ pageSize: 1, filter: { status: "active" } }),
    ])
      .then(([all, inactive, active]) => {
        setStats({
          total:    all.total,
          active:   active.total,
          inactive: inactive.total,
        });
      })
      .catch(() => {});
  }, [refreshToken]);

  return (
    <div className="space-y-8">
      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="relative shrink-0">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/60 shadow-lg shadow-primary/30">
              <Building2 className="size-6 text-white" aria-hidden />
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full border-2 border-background bg-emerald-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
            <p className="text-muted-foreground mt-0.5 text-sm">{t("subtitle")}</p>
          </div>
        </div>
        {can("staff.create") && (
          <Button
            type="button"
            size="lg"
            onClick={() => setModal({ kind: "new" })}
            data-testid="new-staff"
            className="gap-2 px-4 shadow-md shadow-primary/25"
          >
            <Plus className="size-4" aria-hidden />
            {t("new")}
          </Button>
        )}
      </div>

      {/* ── Stat cards ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
      </div>

      {/* ── Alert ─────────────────────────────────────────────────────────── */}
      {alert && (
        <AlertBanner
          variant={alert.variant}
          message={alert.message}
          onDismiss={() => setAlert(null)}
        />
      )}

      {/* ── Roster ───────────────────────────────────────────────────────── */}
      <StaffList
        refreshToken={refreshToken}
        onNew={() => setModal({ kind: "new" })}
        onOpen={(id) => router.push(`/staff/${id}`)}
        onDeactivate={(id, name) => setModal({ kind: "delete", id, name })}
      />

      {/* ── Create staff modal ────────────────────────────────────────────── */}
      <Modal
        open={modal.kind === "new"}
        onClose={() => setModal({ kind: "closed" })}
        title={t("new")}
        size="xl"
      >
        <StaffForm
          onCancel={() => setModal({ kind: "closed" })}
          onDone={(id) => {
            setModal({ kind: "closed" });
            router.push(`/staff/${id}`);
          }}
        />
      </Modal>

      {/* ── Deactivate confirmation modal ─────────────────────────────────── */}
      <Modal
        open={modal.kind === "delete"}
        onClose={() => setModal({ kind: "closed" })}
        title={t("detail.deactivateConfirm")}
        size="sm"
      >
        {modal.kind === "delete" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("detail.deactivateConfirmBody")}
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
                data-testid="confirm-deactivate-staff"
                onClick={() => void confirmDeactivate((modal as { id: string }).id)}
              >
                {deleteBusy && (
                  <span className="size-3.5 animate-spin rounded-full border border-current border-t-transparent" />
                )}
                {t("detail.deactivateYes")}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
