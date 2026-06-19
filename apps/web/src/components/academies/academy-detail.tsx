"use client";

import {
  ArrowLeft,
  CalendarClock,
  ClipboardCheck,
  Clock,
  Coins,
  GraduationCap,
  LogIn,
  Package,
  PauseCircle,
  PlayCircle,
  ReceiptText,
  Settings2,
  ShieldCheck,
  Tag,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AcademyAutomationPanel } from "@/components/academies/academy-automation-panel";
import { AcademyOwnerSection } from "@/components/academies/academy-owner-section";
import { AcademyPlanManager } from "@/components/academies/academy-plan-manager";
import { AcademySubscriptionPanel } from "@/components/academies/academy-subscription-panel";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import {
  ApiError,
  enterAcademy,
  getAcademy,
  reactivateAcademy,
  suspendAcademy,
  updateAcademy,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const inputClass =
  "border-input bg-background w-full rounded-lg border px-3 py-2.5 text-sm transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none";

const cardClass =
  "bg-card rounded-2xl border p-5 shadow-sm ring-1 ring-foreground/[0.04]";

const STATUS_STYLE: Record<string, string> = {
  ACTIVE:
    "bg-emerald-100 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/40 dark:text-emerald-300",
  TRIAL:
    "bg-amber-100 text-amber-700 ring-amber-600/20 dark:bg-amber-950/40 dark:text-amber-300",
  SUSPENDED:
    "bg-rose-100 text-rose-700 ring-rose-600/20 dark:bg-rose-950/40 dark:text-rose-300",
};

const AVATAR_GRADIENTS = [
  "from-blue-500 to-indigo-600",
  "from-emerald-500 to-teal-600",
  "from-violet-500 to-purple-600",
  "from-amber-500 to-orange-600",
  "from-rose-500 to-pink-600",
  "from-cyan-500 to-sky-600",
];

function avatarGradient(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length]!;
}

type Academy = Record<string, unknown>;

function Card({
  title,
  icon: Icon,
  children,
  className,
}: {
  title: string;
  icon: LucideIcon;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn(cardClass, className)}>
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
        <Icon className="text-muted-foreground size-4" aria-hidden />
        {title}
      </h2>
      {children}
    </section>
  );
}

function MetaItem({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-lg">
        <Icon className="size-4" aria-hidden />
      </div>
      <div className="min-w-0">
        <p className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
          {label}
        </p>
        <p className="truncate text-sm font-semibold">{value}</p>
      </div>
    </div>
  );
}

/**
 * Academy detail (Super Admin control center): a premium overview + edit surface. Hero with
 * status/plan badges and the impersonate/suspend actions; cards for configuration, plan &
 * add-ons, the owner, quick links and report fields. Currency changes surface the server's
 * warning (existing money is untouched — AC-3.11). Branding fields are editable but reserved
 * (R-BRA-1).
 */
export function AcademyDetail({
  academyId,
  onBack,
}: {
  academyId: string;
  onBack: () => void;
}) {
  const t = useTranslations("academies");
  const locale = useLocale();
  const router = useRouter();
  const { can, refresh: refreshSession } = useAuth();
  const toast = useToast();
  const [academy, setAcademy] = useState<Academy | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmEnter, setConfirmEnter] = useState(false);
  const [entering, setEntering] = useState(false);

  const refresh = useCallback(async () => {
    const res = await getAcademy(academyId);
    setAcademy(res.academy);
  }, [academyId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function set(key: string, value: unknown) {
    setAcademy((a) => (a ? { ...a, [key]: value } : a));
  }

  async function save() {
    if (academy === null) return;
    setSaving(true);
    try {
      // Currency, timezone, invoice grouping and billing day are fixed platform defaults — they
      // are shown read-only in the hero meta strip and are never edited here.
      const res = await updateAcademy(academyId, {
        name: academy.name as string,
        brand_display_name: (academy.brand_display_name as string) || null,
        brand_logo_url: (academy.brand_logo_url as string) || null,
        subdomain: (academy.subdomain as string) || null,
      });
      toast.success(res.warning ?? t("detail.saved"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function toggleSuspend() {
    if (academy === null) return;
    if (academy.status === "SUSPENDED") {
      await reactivateAcademy(academyId);
    } else {
      await suspendAcademy(academyId);
    }
    await refresh();
  }

  // Enter the academy's context, then re-read the session (now scoped to it) and land on the
  // tenant dashboard. The audited "Exit" affordance lives in the app shell once entered.
  async function enter() {
    setEntering(true);
    try {
      await enterAcademy(academyId);
      await refreshSession();
      router.push("/dashboard");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : String(err));
      setEntering(false);
      setConfirmEnter(false);
    }
  }

  if (academy === null) {
    return (
      <div className="w-full space-y-6" data-testid="academy-detail">
        <div className="bg-muted h-32 animate-pulse rounded-2xl" aria-hidden />
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="bg-muted h-80 animate-pulse rounded-2xl lg:col-span-2" aria-hidden />
          <div className="bg-muted h-80 animate-pulse rounded-2xl" aria-hidden />
        </div>
      </div>
    );
  }

  const status = academy.status as string;
  const name = academy.name as string;
  const planLabel =
    (academy.plan_name as string) ?? (academy.plan_code as string) ?? null;
  const typeName = academy.type_name as string | undefined;
  const createdAt = academy.created_at
    ? new Date(academy.created_at as string).toLocaleDateString(
        locale === "ar" ? "ar" : locale,
        { year: "numeric", month: "short", day: "numeric" },
      )
    : "—";
  const isSuspended = status === "SUSPENDED";

  return (
    <div className="w-full space-y-6" data-testid="academy-detail">
      {/* Back */}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onBack}
        className="text-muted-foreground -ms-2"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
        {t("back")}
      </Button>

      {/* Hero */}
      <div className="from-primary/[0.08] via-card to-card relative overflow-hidden rounded-2xl border bg-gradient-to-br p-5 shadow-sm ring-1 ring-foreground/[0.04]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div
              className={cn(
                "flex size-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-xl font-bold text-white shadow-sm",
                avatarGradient(academyId),
              )}
              aria-hidden
            >
              {name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-bold tracking-tight">
                {name}
              </h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <span
                  data-testid="detail-status"
                  data-status={status}
                  className={cn(
                    "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
                    STATUS_STYLE[status] ?? "bg-muted",
                  )}
                >
                  {t(`status.${status}`)}
                </span>
                {planLabel && (
                  <span className="bg-primary/10 text-primary inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold">
                    <Tag className="size-3" aria-hidden />
                    {planLabel}
                  </span>
                )}
                {typeName && (
                  <span className="text-muted-foreground text-xs">
                    {typeName}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {can("academy.enter") && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConfirmEnter(true)}
                data-testid="enter-academy"
              >
                <LogIn className="size-4" aria-hidden />
                {t("detail.enter")}
              </Button>
            )}
            <Button
              type="button"
              variant={isSuspended ? "default" : "destructive"}
              size="sm"
              onClick={() => void toggleSuspend()}
              data-testid="toggle-suspend"
            >
              {isSuspended ? (
                <PlayCircle className="size-4" aria-hidden />
              ) : (
                <PauseCircle className="size-4" aria-hidden />
              )}
              {isSuspended ? t("detail.reactivate") : t("detail.suspend")}
            </Button>
          </div>
        </div>

        {/* Meta strip */}
        <div className="mt-5 grid grid-cols-2 gap-4 border-t pt-4 sm:grid-cols-4">
          <MetaItem
            icon={Coins}
            label={t("colCurrency")}
            value={academy.default_currency as string}
          />
          <MetaItem
            icon={Clock}
            label={t("colTimezone")}
            value={academy.timezone as string}
          />
          <MetaItem
            icon={CalendarClock}
            label={t("colBillingDay")}
            value={String(academy.billing_day ?? "—")}
          />
          <MetaItem icon={Clock} label={t("detail.created")} value={createdAt} />
        </div>

        {isSuspended && academy.suspended_reason ? (
          <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-300">
            {academy.suspended_reason as string}
          </p>
        ) : null}
      </div>

      {/* Two-column body */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main column */}
        <div className="space-y-6 lg:col-span-2">
          <Card title={t("detail.config")} icon={Settings2}>
            <div className="space-y-4">
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">{t("wizard.name")}</span>
                <input
                  aria-label={t("wizard.name")}
                  className={inputClass}
                  value={academy.name as string}
                  onChange={(e) => set("name", e.target.value)}
                />
              </label>

              <div className="border-t pt-4">
                <p className="text-muted-foreground mb-3 text-xs">
                  {t("wizard.advancedHint")}
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium">
                      {t("wizard.brandName")}
                    </span>
                    <input
                      aria-label={t("wizard.brandName")}
                      className={inputClass}
                      value={(academy.brand_display_name as string) ?? ""}
                      onChange={(e) =>
                        set("brand_display_name", e.target.value)
                      }
                    />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium">
                      {t("wizard.subdomain")}
                    </span>
                    <input
                      aria-label={t("wizard.subdomain")}
                      className={inputClass}
                      dir="ltr"
                      value={(academy.subdomain as string) ?? ""}
                      onChange={(e) =>
                        set("subdomain", e.target.value.toLowerCase())
                      }
                    />
                  </label>
                </div>
                <label className="mt-4 block space-y-1.5">
                  <span className="text-sm font-medium">
                    {t("wizard.logoUrl")}
                  </span>
                  <input
                    aria-label={t("wizard.logoUrl")}
                    className={inputClass}
                    dir="ltr"
                    value={(academy.brand_logo_url as string) ?? ""}
                    onChange={(e) => set("brand_logo_url", e.target.value)}
                  />
                </label>
              </div>

              <div className="flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  disabled={saving}
                  onClick={() => void save()}
                  data-testid="save-config"
                >
                  {saving ? t("detail.saving") : t("detail.save")}
                </Button>
              </div>
            </div>
          </Card>

          <AcademySubscriptionPanel
            academyId={academyId}
            onChanged={() => void refresh()}
          />

          <AcademyAutomationPanel academyId={academyId} />
        </div>

        {/* Side column */}
        <div className="space-y-6">
          <div className={cardClass}>
            <AcademyPlanManager
              academyId={academyId}
              currentPlanId={(academy.plan_id as string | null) ?? null}
              onPlanChanged={() => void refresh()}
            />
          </div>

          <div className={cardClass}>
            <AcademyOwnerSection academyId={academyId} />
          </div>

          <Card title={t("detail.quickLinks")} icon={Package}>
            <div className="flex flex-col gap-2">
              <QuickLink
                href="/invoices"
                icon={ReceiptText}
                label={t("detail.goToInvoices")}
                tone="indigo"
              />
              <QuickLink
                href="/students"
                icon={GraduationCap}
                label={t("detail.goToStudents")}
                tone="emerald"
              />
              <QuickLink
                href="/attendance"
                icon={ClipboardCheck}
                label={t("detail.goToAttendance")}
                tone="sky"
              />
            </div>
          </Card>

          {can("academy.enter") && (
            <Card
              title={t("detail.supportSection")}
              icon={ShieldCheck}
            >
              <p className="text-muted-foreground mb-3 text-sm">
                {t("detail.supportHint")}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setConfirmEnter(true)}
              >
                <LogIn className="size-4" aria-hidden />
                {t("detail.enter")}
              </Button>
            </Card>
          )}
        </div>
      </div>

      <Modal
        open={confirmEnter}
        onClose={() => !entering && setConfirmEnter(false)}
        title={t("detail.enterConfirmTitle")}
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={entering}
              onClick={() => setConfirmEnter(false)}
            >
              {t("detail.cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={entering}
              onClick={() => void enter()}
              data-testid="confirm-enter"
            >
              {entering ? t("detail.entering") : t("detail.enterConfirm")}
            </Button>
          </>
        }
      >
        <p className="text-muted-foreground text-sm">
          {t("detail.enterConfirmBody")}
        </p>
      </Modal>
    </div>
  );
}

const TONE_STYLE: Record<string, string> = {
  indigo:
    "border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-950/60",
  emerald:
    "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-950/60",
  sky: "border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300 dark:hover:bg-sky-950/60",
};

function QuickLink({
  href,
  icon: Icon,
  label,
  tone,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  tone: keyof typeof TONE_STYLE;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
        TONE_STYLE[tone],
      )}
    >
      <Icon className="size-4" aria-hidden />
      {label}
    </Link>
  );
}
