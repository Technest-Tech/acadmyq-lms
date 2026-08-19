"use client";

import {
  ArrowLeft,
  Banknote,
  Building2,
  CalendarDays,
  FileText,
  Pencil,
  Phone,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Trash2,
  UserCircle2,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { KhatamLattice } from "@/components/ornaments";
import { StaffForm } from "@/components/staff/staff-form";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { HeroBadge, PageHero } from "@/components/ui/page-hero";
import { DetailRow, FactCard, ProfileCard } from "@/components/ui/profile-card";
import {
  ApiError,
  deactivateStaff,
  getStaff,
  reactivateStaff,
  type StaffRow,
} from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

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

  if (loading) return <StaffDetailSkeleton />;

  if (error || !member) {
    return (
      <div className="space-y-4">
        <BackLink label={t("backToList")} />
        <AlertBanner variant="error" message={error ?? t("detail.notFound")} />
        <Button variant="outline" size="sm" onClick={() => void load()}>
          {t("detail.retry")}
        </Button>
      </div>
    );
  }

  const isActive = member.deleted_at == null;
  const memberSince = new Date(member.created_at).toLocaleDateString(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5" data-testid="staff-detail">
      <BackLink label={t("backToList")} />

      {alert && (
        <AlertBanner
          variant={alert.variant}
          message={alert.message}
          onDismiss={() => setAlert(null)}
        />
      )}

      <PageHero
        latticeId="staff-hero-lattice-detail"
        avatarName={member.full_name}
        title={member.full_name}
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
            <HeroBadge tone="gold">
              <Building2 className="size-3" aria-hidden />
              {t.has(`department.${member.department}`)
                ? t(`department.${member.department}`)
                : member.department}
            </HeroBadge>
            <HeroBadge>
              {member.user_id ? (
                <>
                  <ShieldCheck className="size-3" aria-hidden />
                  {t("detail.hasLogin")}
                </>
              ) : (
                <>
                  <ShieldOff className="size-3" aria-hidden />
                  {t("detail.noLogin")}
                </>
              )}
            </HeroBadge>
          </>
        }
        actions={
          <>
            {can("staff.update") && isActive && (
              <Button
                type="button"
                size="lg"
                onClick={() => setEditOpen(true)}
                className="gap-2 border-transparent bg-white px-4 text-emerald-800 shadow-md hover:bg-white/90"
                data-testid="edit-staff"
              >
                <Pencil className="size-4" aria-hidden />
                {t("edit")}
              </Button>
            )}
            {can("staff.update") && !isActive && (
              <Button
                type="button"
                size="lg"
                disabled={actionBusy}
                onClick={() => void handleReactivate()}
                className="gap-2 border-transparent bg-white px-4 text-emerald-800 shadow-md hover:bg-white/90"
                data-testid="reactivate-btn"
              >
                {actionBusy ? (
                  <span className="size-4 animate-spin rounded-full border border-current border-t-transparent" />
                ) : (
                  <RefreshCw className="size-4" aria-hidden />
                )}
                {t("detail.reactivate")}
              </Button>
            )}
          </>
        }
      />

      {/* ── Fact strip ───────────────────────────────────────────────────
          Department, pay, phone and tenure — the four things anyone opening a staff file wants,
          previously a single stacked list of rows below a decorative header band. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FactCard
          icon={Building2}
          label={t("detail.department")}
          tone="emerald"
          value={
            t.has(`department.${member.department}`)
              ? t(`department.${member.department}`)
              : member.department
          }
        />
        <FactCard
          icon={Banknote}
          label={t("detail.salary")}
          tone="violet"
          muted={member.salary_minor <= 0}
          value={
            member.salary_minor > 0
              ? formatMoney(
                  { amount: member.salary_minor, currency: member.currency },
                  locale,
                )
              : t("detail.noSalary")
          }
          sub={member.salary_minor > 0 ? t("detail.perMonth") : undefined}
        />
        <FactCard
          icon={Phone}
          label={t("detail.phone")}
          tone="gold"
          muted={!member.phone}
          value={
            member.phone ? (
              <span dir="ltr" className="tabular-nums">
                {member.phone}
              </span>
            ) : (
              t("detail.noPhone")
            )
          }
        />
        <FactCard
          icon={CalendarDays}
          label={t("detail.memberSince")}
          tone="slate"
          value={memberSince}
        />
      </div>

      {/* ── Record + notes ───────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ProfileCard
          icon={UserCircle2}
          title={t("detail.profile")}
          description={t("detail.profileDesc")}
          tone="emerald"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <DetailRow
              icon={Building2}
              label={t("detail.department")}
              value={
                t.has(`department.${member.department}`)
                  ? t(`department.${member.department}`)
                  : member.department
              }
            />
            <DetailRow
              icon={member.user_id ? ShieldCheck : ShieldOff}
              label={t("detail.loginStatus")}
              value={member.user_id ? t("detail.hasLogin") : t("detail.noLogin")}
            />
            {member.phone && (
              <DetailRow
                icon={Phone}
                label={t("detail.phone")}
                value={member.phone}
                dir="ltr"
              />
            )}
            <DetailRow
              icon={CalendarDays}
              label={t("detail.memberSince")}
              value={memberSince}
            />
          </div>
        </ProfileCard>

        <ProfileCard
          icon={FileText}
          title={t("detail.notes")}
          description={t("detail.notesDesc")}
          tone="slate"
        >
          {member.notes ? (
            <p className="text-muted-foreground whitespace-pre-wrap text-sm leading-relaxed">
              {member.notes}
            </p>
          ) : (
            <p className="text-muted-foreground/60 rounded-xl border border-dashed px-4 py-8 text-center text-sm">
              {t("detail.noNotes")}
            </p>
          )}
        </ProfileCard>
      </div>

      {/* ── Danger zone ───────────────────────────────────────────────────
          One deactivate control, not two. The old page offered it in the header AND again in a
          danger panel — the same irreversible-looking action twice on one screen. */}
      {can("staff.deactivate") && isActive && (
        <ProfileCard
          icon={ShieldAlert}
          title={t("detail.deactivate")}
          description={t("detail.deactivateHint")}
          tone="danger"
          className="border-destructive/25"
        >
          <div className="flex justify-end">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="gap-1.5"
              onClick={() => setDeactivateOpen(true)}
              data-testid="deactivate-btn"
            >
              <Trash2 className="size-3.5" aria-hidden />
              {t("detail.deactivate")}
            </Button>
          </div>
        </ProfileCard>
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
        onClose={() => !actionBusy && setDeactivateOpen(false)}
        title={t("detail.deactivateConfirm")}
        size="sm"
        footer={
          <>
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
          </>
        }
      >
        <p className="text-sm">{t("detail.deactivateConfirmBody")}</p>
      </Modal>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function BackLink({ label }: { label: string }) {
  return (
    <Link
      href="/staff"
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm font-medium transition-colors"
    >
      <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
      {label}
    </Link>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

/**
 * Shown while the file loads — and exported so the route's `loading.tsx` can show the SAME shape
 * the instant a row is clicked, instead of three grey slabs that match nothing that arrives.
 */
export function StaffDetailSkeleton() {
  return (
    <div className="space-y-5" data-testid="staff-detail-skeleton">
      <div className="bg-muted h-5 w-24 animate-pulse rounded" />
      <div
        className="relative h-[8.5rem] overflow-hidden rounded-2xl shadow-lg"
        style={{
          background:
            "linear-gradient(135deg, oklch(0.30 0.065 163) 0%, oklch(0.38 0.105 168) 48%, oklch(0.32 0.085 196) 100%)",
        }}
      >
        <KhatamLattice
          id="staff-skeleton-lattice"
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
