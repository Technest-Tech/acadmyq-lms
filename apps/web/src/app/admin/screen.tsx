"use client";

import {
  Building2,
  GraduationCap,
  History,
  LayoutDashboard,
  RefreshCw,
  UserCheck,
  UserCog,
} from "lucide-react";
import Link from "next/link";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useState,
  type ComponentType,
} from "react";
import { useAuth } from "@/components/auth-provider";
import { AlertBanner } from "@/components/ui/alert";
import { getAdminDashboard, type AdminDashboard } from "@/lib/api";
import { formatNumber } from "@/lib/money";
import { cn } from "@/lib/utils";

// ── KPI card ──────────────────────────────────────────────────────────────────

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  gradient,
  loading,
  locale,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: number | null;
  sub?: string;
  gradient: string;
  loading: boolean;
  locale: string;
}) {
  return (
    <div className="bg-card relative flex flex-col gap-3 overflow-hidden rounded-2xl border p-5 shadow-sm ring-1 ring-foreground/[0.04]">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-sm font-medium">
          {label}
        </span>
        <div
          className={cn(
            "flex size-9 items-center justify-center rounded-xl text-white shadow-sm",
            gradient,
          )}
        >
          <Icon className="size-4.5" aria-hidden />
        </div>
      </div>
      {loading ? (
        <div className="bg-muted h-8 w-16 animate-pulse rounded-md" aria-hidden />
      ) : (
        <p className="text-3xl font-bold tracking-tight tabular-nums">
          {value === null ? "—" : formatNumber(value, locale)}
        </p>
      )}
      {sub && <p className="text-muted-foreground text-xs">{sub}</p>}
    </div>
  );
}

// ── Status breakdown row ─────────────────────────────────────────────────────

function StatusBar({
  label,
  value,
  total,
  color,
  locale,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
  locale: string;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold tabular-nums">
          {formatNumber(value, locale)}
        </span>
      </div>
      <div className="bg-muted h-2 overflow-hidden rounded-full">
        <div
          className={cn("h-full rounded-full transition-all", color)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Super-Admin platform dashboard (admin panel — Phase 1). One read powers a bird's-eye view:
 * academy counts by status, total people, plan distribution, and the most recent audit
 * events. Gated by academy.read (server Gate is the real control; this is UX only).
 */
export function AdminDashboardScreen() {
  const t = useTranslations("adminDashboard");
  const locale = useLocale();
  const format = useFormatter();
  const { can } = useAuth();

  const [data, setData] = useState<AdminDashboard | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    setError(false);
    setRefreshing(true);
    getAdminDashboard()
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setRefreshing(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!can("academy.read")) {
    return <p className="text-muted-foreground text-sm">{t("noPermission")}</p>;
  }

  const stats = data?.stats ?? null;
  const loading = stats === null;
  const academies = stats?.academies;
  const total = academies?.total ?? 0;

  return (
    <div className="space-y-6">
      {/* Hero header */}
      <div className="from-primary/[0.10] via-card to-card relative overflow-hidden rounded-2xl border bg-gradient-to-br p-5 shadow-sm ring-1 ring-foreground/[0.04]">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3.5">
            <div className="bg-primary/12 text-primary flex size-11 items-center justify-center rounded-xl">
              <LayoutDashboard className="size-5.5" aria-hidden />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
              <p className="text-muted-foreground mt-0.5 text-sm">
                {t("subtitle")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={load}
            disabled={refreshing}
            className="text-muted-foreground hover:bg-muted hover:text-foreground bg-card flex size-9 items-center justify-center rounded-lg border transition-colors disabled:opacity-50"
            aria-label={t("refresh")}
          >
            <RefreshCw
              className={cn("size-4", refreshing && "animate-spin")}
              aria-hidden
            />
          </button>
        </div>
      </div>

      {error && <AlertBanner variant="error" message={t("loadError")} />}

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          icon={Building2}
          label={t("kpiAcademies")}
          value={academies?.total ?? null}
          sub={
            academies
              ? t("recentSignups", { count: academies.recent })
              : undefined
          }
          gradient="bg-gradient-to-br from-blue-500 to-indigo-600"
          loading={loading}
          locale={locale}
        />
        <KpiCard
          icon={GraduationCap}
          label={t("kpiStudents")}
          value={stats?.people.students ?? null}
          gradient="bg-gradient-to-br from-emerald-500 to-teal-600"
          loading={loading}
          locale={locale}
        />
        <KpiCard
          icon={UserCog}
          label={t("kpiTeachers")}
          value={stats?.people.teachers ?? null}
          gradient="bg-gradient-to-br from-violet-500 to-purple-600"
          loading={loading}
          locale={locale}
        />
        <KpiCard
          icon={UserCheck}
          label={t("kpiGuardians")}
          value={stats?.people.guardians ?? null}
          gradient="bg-gradient-to-br from-amber-500 to-orange-600"
          loading={loading}
          locale={locale}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Status breakdown */}
        <section className="bg-card rounded-2xl border p-5 shadow-sm ring-1 ring-foreground/[0.04]">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold">{t("statusBreakdown")}</h2>
            <Link
              href="/academies"
              className="text-primary text-xs font-medium hover:underline"
            >
              {t("manageAcademies")}
            </Link>
          </div>
          {loading ? (
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-muted h-8 animate-pulse rounded-md"
                  aria-hidden
                />
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              <StatusBar
                label={t("kpiActive")}
                value={academies?.active ?? 0}
                total={total}
                color="bg-emerald-500"
                locale={locale}
              />
              <StatusBar
                label={t("kpiTrial")}
                value={academies?.trial ?? 0}
                total={total}
                color="bg-amber-500"
                locale={locale}
              />
              <StatusBar
                label={t("kpiSuspended")}
                value={academies?.suspended ?? 0}
                total={total}
                color="bg-rose-500"
                locale={locale}
              />
            </div>
          )}
        </section>

        {/* Plan distribution */}
        <section className="bg-card rounded-2xl border p-5 shadow-sm ring-1 ring-foreground/[0.04]">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold">{t("planDistribution")}</h2>
            <Link
              href="/admin/plans"
              className="text-primary text-xs font-medium hover:underline"
            >
              {t("managePlans")}
            </Link>
          </div>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-muted h-9 animate-pulse rounded-md"
                  aria-hidden
                />
              ))}
            </div>
          ) : stats && stats.plan_distribution.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">
              {t("noPlans")}
            </p>
          ) : (
            <div className="space-y-2">
              {stats?.plan_distribution.map((p) => (
                <div
                  key={p.plan_id}
                  className="bg-muted/30 flex items-center justify-between rounded-lg px-3 py-2.5"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="bg-primary/10 text-primary inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold tracking-wide">
                      {p.plan_code}
                    </span>
                    <span className="text-sm font-medium">{p.plan_name}</span>
                  </div>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {t("planAcademies", { count: p.academy_count })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Recent activity */}
      <section className="bg-card rounded-2xl border p-5 shadow-sm ring-1 ring-foreground/[0.04]">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <History className="text-muted-foreground size-4" aria-hidden />
            {t("recentActivity")}
          </h2>
          <Link
            href="/audit"
            className="text-primary text-xs font-medium hover:underline"
          >
            {t("viewAllActivity")}
          </Link>
        </div>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="bg-muted h-12 animate-pulse rounded-lg"
                aria-hidden
              />
            ))}
          </div>
        ) : data && data.recentActivity.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            {t("noActivity")}
          </p>
        ) : (
          <div className="divide-y">
            {data?.recentActivity.map((e) => (
              <div
                key={e.id}
                className="flex items-center justify-between gap-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium" dir="ltr">
                    {e.action}
                  </p>
                  <p className="text-muted-foreground truncate text-xs">
                    {[e.actor_name, e.academy_name].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <time className="text-muted-foreground shrink-0 text-xs tabular-nums">
                  {format.dateTime(new Date(e.created_at), {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
