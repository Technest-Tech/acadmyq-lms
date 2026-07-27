"use client";

import {
  BookOpen,
  Building2,
  ChevronRight,
  GraduationCap,
  HardDrive,
  Layers,
  RefreshCw,
  Ticket,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { AlertBanner } from "@/components/ui/alert";
import {
  getLmsActivity,
  getLmsUsage,
  type LmsActivityRow,
  type LmsUsageRow,
  type LmsUsageTotals,
} from "@/lib/api";
import { formatNumber } from "@/lib/money";
import { cn } from "@/lib/utils";
import { capPct, capTone, fmtBytes } from "./lms-format";
import { LmsStatusBadge } from "./lms-status";

/** The LMS audit actions we have a label for; anything else falls back to the raw action string. */
const KNOWN_ACTIONS = new Set([
  "course.create",
  "course.update",
  "course.set_status",
  "course.delete",
  "lesson.create",
  "lesson.update",
  "lesson.delete",
  "learner.set_status",
  "enrollment.set_status",
  "access_code.batch",
  "access_code.update",
  "access_code.delete",
  "quiz.create",
  "lms.limits_set",
  "lms.subdomain_set",
  "lms.course_moderated",
  "lms.learner_moderated",
]);

/** Colour by severity so the platform-side interventions read fast against routine client edits. */
function actionTone(action: string): string {
  if (action.startsWith("lms.")) return "text-amber-600"; // a Super Admin acted on the client
  if (action === "course.set_status") return "text-indigo-600";
  if (action.endsWith(".delete") || action === "learner.set_status") return "text-rose-600";
  if (action.endsWith(".create") || action === "access_code.batch") return "text-emerald-600";
  return "text-muted-foreground";
}

export function AdminLmsScreen() {
  const t = useTranslations("adminLms");
  const locale = useLocale();
  const { can } = useAuth();
  const router = useRouter();

  const [usage, setUsage] = useState<{ academies: LmsUsageRow[]; totals: LmsUsageTotals } | null>(null);
  const [feed, setFeed] = useState<LmsActivityRow[] | null>(null);
  const [error, setError] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [u, a] = await Promise.all([getLmsUsage(), getLmsActivity(60)]);
      setUsage(u);
      setFeed(a.rows);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    if (!can("platform.manage")) return;
    void loadData();
  }, [can, loadData]);

  if (!can("platform.manage")) {
    return <p className="text-muted-foreground text-sm">{t("noPermission")}</p>;
  }

  const totals = usage?.totals;
  const fmtTime = (s: string) => new Date(s).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" });

  return (
    <div className="w-full space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-br from-teal-500 to-emerald-600 flex size-11 items-center justify-center rounded-xl text-white">
            <GraduationCap className="size-5.5" aria-hidden />
          </div>
          <div>
            <h1 className="text-xl font-bold">{t("title")}</h1>
            <p className="text-muted-foreground max-w-2xl text-sm">{t("subtitle")}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void loadData()}
          className="text-muted-foreground hover:text-foreground rounded-lg border p-2 transition-colors"
          aria-label={t("refresh")}
        >
          <RefreshCw className="size-3.5" aria-hidden />
        </button>
      </div>

      {error && <AlertBanner variant="error" message={t("loadError")} />}

      {/* Platform totals */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat icon={Building2} label={t("totals.clients")} value={totals ? formatNumber(totals.academies, locale) : null} />
        <Stat
          icon={BookOpen}
          label={t("totals.publishedCourses")}
          value={totals ? `${formatNumber(totals.published_courses, locale)} / ${formatNumber(totals.courses, locale)}` : null}
          tone="text-emerald-600"
        />
        <Stat icon={Layers} label={t("totals.lessons")} value={totals ? formatNumber(totals.lessons, locale) : null} />
        <Stat icon={Users} label={t("totals.learners")} value={totals ? formatNumber(totals.learners, locale) : null} />
        <Stat icon={Ticket} label={t("totals.redeemed")} value={totals ? formatNumber(totals.redeemed_codes, locale) : null} />
        <Stat icon={HardDrive} label={t("totals.storage")} value={totals ? fmtBytes(totals.storage_bytes) : null} />
      </div>

      {/* Client roster */}
      <section className="bg-card rounded-2xl border shadow-sm ring-1 ring-foreground/[0.04]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">{t("clients.title")}</h2>
            <p className="text-muted-foreground text-xs">{t("clients.subtitle")}</p>
          </div>
          {/* Subscriptions are a CLIENT fact (R4, one writer): this page monitors and controls the
              course platform itself — starting/pausing the LMS module stays on /admin/clients. */}
          <Link
            href="/admin/clients"
            className="text-primary inline-flex items-center gap-1 text-xs font-semibold hover:underline"
          >
            {t("clients.manageOnClients")}
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-muted-foreground text-xs">
                <th className="px-4 py-2.5 text-start font-medium">{t("clients.colClient")}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t("clients.colStatus")}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t("clients.colSite")}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t("clients.colCourses")}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t("clients.colLearners")}</th>
                <th className="px-4 py-2.5 text-end font-medium">{t("clients.colEnrollments")}</th>
                <th className="px-4 py-2.5 text-end font-medium">{t("clients.colStorage")}</th>
                <th className="w-8 px-2 py-2.5" aria-hidden />
              </tr>
            </thead>
            <tbody className="divide-y">
              {usage === null ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={8} className="px-4 py-3">
                      <div className="bg-muted h-5 animate-pulse rounded" aria-hidden />
                    </td>
                  </tr>
                ))
              ) : usage.academies.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-muted-foreground px-4 py-10 text-center">{t("clients.empty")}</td>
                </tr>
              ) : (
                usage.academies.map((a) => (
                  <tr
                    key={a.academy_id}
                    onClick={() => router.push(`/admin/lms/${a.academy_id}`)}
                    className="hover:bg-muted/40 cursor-pointer transition-colors"
                    data-testid={`lms-academy-row-${a.academy_id}`}
                  >
                    <td className="px-4 py-2.5 font-medium">
                      <Link
                        href={`/admin/lms/${a.academy_id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="hover:underline"
                      >
                        {a.academy_name}
                      </Link>
                      <p className="text-muted-foreground text-[11px]">{a.lms_plan_name ?? a.plan_name ?? t("clients.noPlan")}</p>
                    </td>
                    <td className="px-4 py-2.5"><LmsStatusBadge status={a.lms_status} /></td>
                    <td className="px-4 py-2.5">
                      {a.subdomain === null ? (
                        <span className="text-muted-foreground text-xs">{t("clients.noSite")}</span>
                      ) : (
                        <span className="text-muted-foreground font-mono text-xs">{a.subdomain}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <CapCell
                        used={a.courses_published}
                        cap={a.max_courses}
                        label={t("clients.publishedOf", {
                          used: formatNumber(a.courses_published, locale),
                          total: formatNumber(a.courses_total, locale),
                        })}
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      <CapCell
                        used={a.learners}
                        cap={a.max_learners}
                        label={
                          a.max_learners === null
                            ? formatNumber(a.learners, locale)
                            : `${formatNumber(a.learners, locale)} / ${formatNumber(a.max_learners, locale)}`
                        }
                      />
                    </td>
                    <td className="px-4 py-2.5 text-end tabular-nums">{formatNumber(a.active_enrollments, locale)}</td>
                    <td className="px-4 py-2.5 text-end tabular-nums">
                      {fmtBytes(a.storage_bytes)}
                      {a.max_storage_gb !== null && (
                        <span className="text-muted-foreground"> / {a.max_storage_gb} GB</span>
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-end">
                      <ChevronRight className="text-muted-foreground size-4 rtl:rotate-180" aria-hidden />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Activity feed */}
      <section className="bg-card rounded-2xl border shadow-sm ring-1 ring-foreground/[0.04]">
        <div className="border-b px-5 py-4">
          <h2 className="text-sm font-semibold">{t("activity.title")}</h2>
          <p className="text-muted-foreground text-xs">{t("activity.subtitle")}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-muted-foreground text-xs">
                <th className="px-4 py-2.5 text-start font-medium">{t("activity.colClient")}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t("activity.colAction")}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t("activity.colActor")}</th>
                <th className="px-4 py-2.5 text-end font-medium">{t("activity.colTime")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {feed === null ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={4} className="px-4 py-3">
                      <div className="bg-muted h-5 animate-pulse rounded" aria-hidden />
                    </td>
                  </tr>
                ))
              ) : feed.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-muted-foreground px-4 py-10 text-center">{t("activity.empty")}</td>
                </tr>
              ) : (
                feed.map((r) => {
                  const byPlatform = r.action.startsWith("lms.");
                  return (
                    <tr key={r.id} className={cn("hover:bg-muted/30 transition-colors", byPlatform && "bg-amber-50/50")}>
                      <td className="px-4 py-2.5 font-medium">{r.academy_name ?? "—"}</td>
                      <td className="px-4 py-2.5">
                        <span className="inline-flex items-center gap-1.5">
                          <span className={cn("text-xs font-medium", actionTone(r.action))}>
                            {KNOWN_ACTIONS.has(r.action) ? t(`action.${r.action.replace(/\./g, "_")}`) : r.action}
                          </span>
                          {byPlatform && (
                            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-600/20">
                              {t("activity.platformBadge")}
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="text-muted-foreground px-4 py-2.5 text-xs">{r.actor_name ?? t("activity.system")}</td>
                      <td className="px-4 py-2.5 text-end text-xs tabular-nums">{fmtTime(r.created_at)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Stat({ icon: Icon, label, value, tone }: { icon: LucideIcon; label: string; value: string | null; tone?: string }) {
  return (
    <div className="bg-card rounded-xl border p-3.5 shadow-sm ring-1 ring-foreground/[0.04]">
      <div className="text-muted-foreground mb-1.5 flex items-center gap-1.5 text-[11px] font-medium">
        <Icon className="size-3.5" aria-hidden />
        <span className="truncate">{label}</span>
      </div>
      {value === null ? (
        <div className="bg-muted h-6 w-12 animate-pulse rounded" aria-hidden />
      ) : (
        <p className={cn("text-2xl font-bold tabular-nums", tone)}>{value}</p>
      )}
    </div>
  );
}

/** A "used vs cap" cell — the bar is muted when the plan sets no cap (unlimited). */
function CapCell({ used, cap, label }: { used: number; cap: number | null; label: string }) {
  const pct = capPct(used, cap);
  return (
    <div className="min-w-[6.5rem]">
      <p className="mb-1 text-xs font-medium tabular-nums">{label}</p>
      <div className="bg-muted h-1.5 overflow-hidden rounded-full">
        <div
          className={cn("h-full rounded-full", capTone(used, cap))}
          style={{ width: `${pct ?? (used > 0 ? 100 : 0)}%` }}
        />
      </div>
    </div>
  );
}
