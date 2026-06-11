"use client";

import {
  ArrowUpRight,
  Plus,
  UserCheck,
  UserCog,
  Users,
  UserX,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState, type ComponentType } from "react";
import { useAuth } from "@/components/auth-provider";
import { GuardianDetail } from "@/components/guardians/guardian-detail";
import { GuardianForm } from "@/components/guardians/guardian-form";
import { GuardiansList } from "@/components/guardians/guardians-list";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { listGuardians } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Stats {
  total: number;
  active: number;
  inactive: number;
}

type ModalState =
  | { kind: "closed" }
  | { kind: "new" }
  | { kind: "detail"; id: string; name: string };

export function GuardianManager() {
  const t = useTranslations("guardians");
  const { can } = useAuth();
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

  function showAlert(variant: "success" | "error", message: string) {
    setAlert({ variant, message });
    if (variant === "success") {
      const timer = setTimeout(() => setAlert(null), 4500);
      return () => clearTimeout(timer);
    }
  }

  useEffect(() => {
    void Promise.all([
      listGuardians({ pageSize: 1 }),
      listGuardians({ pageSize: 1, filter: { status: "active" } }),
      listGuardians({ pageSize: 1, filter: { status: "inactive" } }),
    ])
      .then(([all, active, inactive]) =>
        setStats({
          total: all.total,
          active: active.total,
          inactive: inactive.total,
        }),
      )
      .catch(() => {});
  }, [refreshToken]);

  const detailId = modal.kind === "detail" ? modal.id : null;
  const detailName = modal.kind === "detail" ? modal.name : "";

  return (
    <div className="space-y-8">

      {/* ── Page header ──────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="relative shrink-0">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/60 shadow-lg shadow-primary/30">
              <UserCog className="size-6 text-white" aria-hidden />
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full border-2 border-background bg-emerald-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
            <p className="text-muted-foreground mt-0.5 text-sm">
              Billing contacts, family groups &amp; linked students
            </p>
          </div>
        </div>
        {can("guardian.create") && (
          <Button
            type="button"
            size="lg"
            onClick={() => setModal({ kind: "new" })}
            data-testid="new-guardian"
            className="gap-2 px-4 shadow-md shadow-primary/25"
          >
            <Plus className="size-4" aria-hidden />
            {t("new")}
          </Button>
        )}
      </div>

      {/* ── Stat cards ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          icon={Users}
          label={t("title")}
          value={stats?.total ?? null}
          colorClass="text-primary"
          bgClass="bg-primary/10"
          ringClass="ring-primary/20"
          gradientFrom="from-primary/8"
        />
        <StatCard
          icon={UserCheck}
          label={t("filter.active")}
          value={stats?.active ?? null}
          colorClass="text-emerald-600 dark:text-emerald-400"
          bgClass="bg-emerald-500/10"
          ringClass="ring-emerald-500/20"
          gradientFrom="from-emerald-500/8"
        />
        <StatCard
          icon={UserX}
          label={t("filter.inactive")}
          value={stats?.inactive ?? null}
          colorClass="text-slate-500 dark:text-slate-400"
          bgClass="bg-slate-400/10"
          ringClass="ring-slate-400/20"
          gradientFrom="from-slate-400/8"
        />
      </div>

      {/* ── Alert ────────────────────────────────────────────────────── */}
      {alert && (
        <AlertBanner
          variant={alert.variant}
          message={alert.message}
          onDismiss={() => setAlert(null)}
        />
      )}

      {/* ── Guardian list ─────────────────────────────────────────────── */}
      <GuardiansList
        refreshToken={refreshToken}
        onNew={() => setModal({ kind: "new" })}
        onOpen={(id, name) => setModal({ kind: "detail", id, name })}
      />

      {/* ── Create modal ──────────────────────────────────────────────── */}
      <Modal
        open={modal.kind === "new"}
        onClose={() => setModal({ kind: "closed" })}
        title={t("new")}
        description="Add a billing contact who sponsors one or more students"
        size="md"
      >
        <GuardianForm
          onCancel={() => setModal({ kind: "closed" })}
          onCreated={() => {
            setModal({ kind: "closed" });
            refresh();
            showAlert("success", t("form.saved"));
          }}
        />
      </Modal>

      {/* ── Detail modal ──────────────────────────────────────────────── */}
      <Modal
        open={modal.kind === "detail"}
        onClose={() => setModal({ kind: "closed" })}
        title={detailName}
        size="lg"
      >
        {detailId && (
          <GuardianDetail
            guardianId={detailId}
            onBack={() => setModal({ kind: "closed" })}
            onSaved={() => {
              refresh();
              showAlert("success", t("form.saved"));
            }}
            onDeactivated={() => {
              setModal({ kind: "closed" });
              refresh();
              showAlert("success", t("filter.inactive"));
            }}
          />
        )}
      </Modal>
    </div>
  );
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
  value: number | null;
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
      <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl ring-1", bgClass, ringClass)}>
        <Icon className={cn("size-4", colorClass)} aria-hidden />
      </div>
      <div className="min-w-0">
        {value === null ? (
          <div className="h-5 w-10 animate-pulse rounded bg-muted" />
        ) : (
          <div className="text-xl font-bold tabular-nums tracking-tight leading-tight">
            {value.toLocaleString()}
          </div>
        )}
        <div className="text-muted-foreground truncate text-[11px] font-medium uppercase tracking-wide">
          {label}
        </div>
      </div>
      <ArrowUpRight className="ms-auto size-3.5 shrink-0 text-foreground/[0.1]" aria-hidden />
    </div>
  );
}
