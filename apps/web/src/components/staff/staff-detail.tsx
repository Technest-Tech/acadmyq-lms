"use client";

import {
  ArrowLeft,
  Banknote,
  CalendarDays,
  FileText,
  Pencil,
  Phone,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { StaffForm } from "@/components/staff/staff-form";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  ApiError,
  deactivateStaff,
  getStaff,
  reactivateStaff,
  type StaffRow,
} from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

// ── Avatar ───────────────────────────────────────────────────────────────────

function nameHue(name: string) {
  return name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
}

function StaffAvatar({ name, size = "lg" }: { name: string; size?: "md" | "lg" }) {
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-2xl font-bold text-white shadow-lg",
        size === "lg" ? "size-16 text-xl" : "size-10 text-sm",
      )}
      style={{
        backgroundColor: `hsl(${nameHue(name)} 48% 42%)`,
        boxShadow: `0 8px 24px -4px hsl(${nameHue(name)} 48% 42% / 0.35)`,
      }}
    >
      {initials}
    </div>
  );
}

// ── Info row ─────────────────────────────────────────────────────────────────

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 py-3">
      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
        <Icon className="size-4 text-muted-foreground" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
          {label}
        </div>
        <div className="mt-0.5 text-sm font-medium">{value}</div>
      </div>
    </div>
  );
}

// ── StaffDetail ───────────────────────────────────────────────────────────────

export function StaffDetail({ id }: { id: string }) {
  const t = useTranslations("staff");
  const locale = useLocale();
  const { can } = useAuth();

  const [member, setMember] = useState<StaffRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [alert, setAlert] = useState<{
    variant: "success" | "error";
    message: string;
  } | null>(null);

  function showAlert(variant: "success" | "error", message: string) {
    setAlert({ variant, message });
    if (variant === "success") setTimeout(() => setAlert(null), 4500);
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await getStaff(id);
      setMember(res.staff);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [id]);

  async function handleDeactivate() {
    if (!member) return;
    setActionBusy(true);
    try {
      await deactivateStaff(member.id);
      setDeactivateOpen(false);
      showAlert("success", t("detail.deactivated"));
      await load();
    } catch (err) {
      showAlert("error", err instanceof ApiError ? err.message : String(err));
    } finally {
      setActionBusy(false);
    }
  }

  async function handleReactivate() {
    if (!member) return;
    setActionBusy(true);
    try {
      await reactivateStaff(member.id);
      showAlert("success", t("detail.reactivated"));
      await load();
    } catch (err) {
      showAlert("error", err instanceof ApiError ? err.message : String(err));
    } finally {
      setActionBusy(false);
    }
  }

  // ── Loading skeleton ───────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 animate-pulse rounded-lg bg-muted" />
        <div className="h-40 animate-pulse rounded-2xl bg-muted" />
        <div className="h-64 animate-pulse rounded-2xl bg-muted" />
      </div>
    );
  }

  if (error || !member) {
    return (
      <div className="space-y-4">
        <AlertBanner variant="error" message={error ?? "Not found."} />
        <Button variant="outline" size="sm" onClick={() => void load()}>
          Retry
        </Button>
      </div>
    );
  }

  const isActive = member.deleted_at == null;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* ── Back link ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <Link
          href="/staff"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          {t("backToList")}
        </Link>
      </div>

      {/* ── Alert ─────────────────────────────────────────────────────────── */}
      {alert && (
        <AlertBanner
          variant={alert.variant}
          message={alert.message}
          onDismiss={() => setAlert(null)}
        />
      )}

      {/* ── Profile card ──────────────────────────────────────────────────── */}
      <div
        className={cn(
          "overflow-hidden rounded-2xl border bg-card shadow-sm",
          !isActive && "opacity-70",
        )}
      >
        {/* ── Header band ─────────────────────────────────────── */}
        <div className="relative h-24 bg-gradient-to-r from-primary/15 via-primary/8 to-transparent">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_var(--tw-gradient-stops))] from-primary/10 via-transparent to-transparent" />
          {/* Status ribbon */}
          {!isActive && (
            <div className="absolute end-4 top-4 flex items-center gap-1.5 rounded-full border border-destructive/20 bg-destructive/10 px-3 py-1 text-xs font-medium text-destructive">
              <span className="size-1.5 rounded-full bg-destructive" />
              Inactive
            </div>
          )}
        </div>

        {/* ── Avatar + name ────────────────────────────────────── */}
        <div className="px-6 pb-6">
          <div className="-mt-8 flex items-end justify-between gap-4">
            <StaffAvatar name={member.full_name} size="lg" />
            {/* Actions */}
            <div className="flex items-center gap-2 pb-1">
              {can("staff.update") && isActive && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setEditOpen(true)}
                  className="gap-1.5"
                  data-testid="edit-staff"
                >
                  <Pencil className="size-3.5" aria-hidden />
                  {t("edit")}
                </Button>
              )}
              {can("staff.deactivate") && isActive && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeactivateOpen(true)}
                  className="gap-1.5 text-destructive hover:text-destructive"
                  data-testid="deactivate-btn"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                  {t("detail.deactivate")}
                </Button>
              )}
              {can("staff.update") && !isActive && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={actionBusy}
                  onClick={() => void handleReactivate()}
                  className="gap-1.5 text-emerald-600 hover:text-emerald-700"
                  data-testid="reactivate-btn"
                >
                  {actionBusy ? (
                    <span className="size-3.5 animate-spin rounded-full border border-current border-t-transparent" />
                  ) : (
                    <RefreshCw className="size-3.5" aria-hidden />
                  )}
                  {t("detail.reactivate")}
                </Button>
              )}
            </div>
          </div>

          <div className="mt-3">
            <h1 className="text-xl font-bold tracking-tight">{member.full_name}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {/* Login badge */}
              {member.user_id ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary ring-1 ring-primary/20">
                  <ShieldCheck className="size-3" aria-hidden />
                  {t("detail.hasLogin")}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                  <ShieldOff className="size-3" aria-hidden />
                  {t("detail.noLogin")}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ── Info grid ────────────────────────────────────────── */}
        <div className="border-t px-6 divide-y">
          {member.phone && (
            <InfoRow
              icon={Phone}
              label={t("detail.phone")}
              value={<span dir="ltr" className="tabular-nums">{member.phone}</span>}
            />
          )}

          <InfoRow
            icon={Banknote}
            label={t("detail.salary")}
            value={
              member.salary_minor > 0
                ? formatMoney({ amount: member.salary_minor, currency: member.currency }, locale)
                : <span className="text-muted-foreground/50">—</span>
            }
          />

          <InfoRow
            icon={CalendarDays}
            label={t("detail.memberSince")}
            value={new Date(member.created_at).toLocaleDateString(locale, {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          />

          {member.notes && (
            <InfoRow
              icon={FileText}
              label={t("detail.notes")}
              value={
                <span className="text-muted-foreground whitespace-pre-wrap leading-relaxed">
                  {member.notes}
                </span>
              }
            />
          )}
        </div>
      </div>

      {/* ── Danger zone ───────────────────────────────────────────────────── */}
      {can("staff.deactivate") && isActive && (
        <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-5">
          <h2 className="text-sm font-semibold text-destructive">
            {t("detail.deactivate")}
          </h2>
          <p className="text-muted-foreground mt-1 text-xs">
            {t("detail.deactivateHint")}
          </p>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="mt-3 gap-1.5"
            onClick={() => setDeactivateOpen(true)}
          >
            <Trash2 className="size-3.5" aria-hidden />
            {t("detail.deactivate")}
          </Button>
        </div>
      )}

      {/* ── Edit modal ────────────────────────────────────────────────────── */}
      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title={t("edit")}
        size="xl"
      >
        <StaffForm
          initial={member}
          onCancel={() => setEditOpen(false)}
          onDone={async () => {
            setEditOpen(false);
            showAlert("success", t("form.saved"));
            await load();
          }}
        />
      </Modal>

      {/* ── Deactivate confirmation modal ─────────────────────────────────── */}
      <Modal
        open={deactivateOpen}
        onClose={() => setDeactivateOpen(false)}
        title={t("detail.deactivateConfirm")}
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t("detail.deactivateConfirmBody")}
          </p>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={actionBusy}
              onClick={() => setDeactivateOpen(false)}
            >
              {t("detail.deactivateCancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={actionBusy}
              className="gap-1.5"
              data-testid="confirm-deactivate"
              onClick={() => void handleDeactivate()}
            >
              {actionBusy && (
                <span className="size-3.5 animate-spin rounded-full border border-current border-t-transparent" />
              )}
              {t("detail.deactivateYes")}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
