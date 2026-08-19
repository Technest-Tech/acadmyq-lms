"use client";

import {
  ArrowLeft,
  Award,
  BookOpen,
  ExternalLink,
  Globe,
  GraduationCap,
  HardDrive,
  Layers,
  Loader2,
  ShieldAlert,
  SlidersHorizontal,
  Ticket,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { StatTile } from "@/components/admin/stat-tile";
import { Th, TR_HEAD } from "@/components/admin/table";
import { useAuth } from "@/components/auth-provider";
import { AlertBanner } from "@/components/ui/alert";
import { useToast, type ToastApi } from "@/components/ui/toast";
import {
  ApiError,
  getLmsAcademy,
  setLmsCourseStatus,
  setLmsLearnerStatus,
  setLmsLimits,
  setLmsSubdomain,
  type LmsAcademyDetail,
  type LmsCourseStatus,
  type LmsLimits,
} from "@/lib/api";
import { formatNumber } from "@/lib/money";
import { cn } from "@/lib/utils";
import { capPct, capTone, daysUntil, fmtBytes } from "../lms-format";
import { CourseStatusBadge, LmsStatusBadge } from "../lms-status";

/** The three caps a Super Admin can override per client, in the order the form shows them. */
const LIMIT_KEYS = ["maxCourses", "maxLearners", "maxStorageGb"] as const;
type LimitKey = (typeof LIMIT_KEYS)[number];

/** Surface the API's own validation message when it has one, else a generic per-action failure. */
function reportError(toast: ToastApi, e: unknown, fallback: string) {
  const message = e instanceof ApiError && e.message ? e.message : fallback;
  toast.error(message);
}

export function AdminLmsAcademyScreen({ academyId }: { academyId: string }) {
  const t = useTranslations("adminLms");
  const locale = useLocale();
  const { can } = useAuth();

  const [detail, setDetail] = useState<LmsAcademyDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      setDetail(await getLmsAcademy(academyId));
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setNotFound(true);
      else setError(true);
    }
  }, [academyId]);

  useEffect(() => {
    if (!can("platform.manage")) return;
    void load();
  }, [can, load]);

  if (!can("platform.manage")) {
    return <p className="text-muted-foreground p-6 text-sm">{t("noPermission")}</p>;
  }

  const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString(locale, { dateStyle: "medium" }) : "—");
  const trialDays = detail ? daysUntil(detail.academy.trial_end) : null;

  return (
    <div className="w-full space-y-5">
      {detail === null && (
        <Link
          href="/admin/lms"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm"
        >
          <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
          {t("detail.back")}
        </Link>
      )}

      {notFound ? (
        <AlertBanner variant="error" message={t("detail.notFound")} />
      ) : detail === null ? (
        <div className="bg-muted h-40 animate-pulse rounded-2xl" aria-hidden />
      ) : (
        <>
          <AdminPageHeader
            backHref="/admin/lms"
            backLabel={t("detail.back")}
            title={detail.academy.name}
            titleExtra={
              <>
                <LmsStatusBadge status={detail.academy.lms_status} />
                {detail.academy.lms_status === "TRIAL" && trialDays !== null && (
                  <span className="text-muted-foreground text-xs">
                    {t("detail.trialDaysLeft", { days: trialDays })}
                  </span>
                )}
              </>
            }
            subtitle={
              <>
                {detail.academy.subdomain ?? t("clients.noSubdomain")} ·{" "}
                {t("detail.createdAt", { date: fmtDate(detail.academy.created_at) })}
              </>
            }
            actions={
              /* Subscription lifecycle (start / trial / pause / end) is the client page's job — R4,
                 one writer per fact. This page owns the course platform itself. */
              <Link
                href={`/admin/clients/${academyId}`}
                className="text-primary text-sm font-semibold whitespace-nowrap hover:underline"
                data-testid="open-client"
              >
                {t("detail.openClient")}
              </Link>
            }
          />

          {error && <AlertBanner variant="error" message={t("loadError")} />}

          {/* Headline statistics */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile
              icon={BookOpen}
              label={t("detail.statCourses")}
              value={
                <span className="text-emerald-600">
                  {`${formatNumber(detail.stats.courses_published, locale)} / ${formatNumber(detail.stats.courses_total, locale)}`}
                </span>
              }
              sub={t("detail.publishedOfTotal")}
            />
            <StatTile icon={Layers} label={t("totals.lessons")} value={formatNumber(detail.stats.lessons, locale)} />
            <StatTile
              icon={Users}
              label={t("totals.learners")}
              value={formatNumber(detail.stats.learners, locale)}
              sub={t("detail.activeLearners", { count: formatNumber(detail.stats.active_learners, locale) })}
            />
            <StatTile
              icon={GraduationCap}
              label={t("detail.statEnrollments")}
              value={formatNumber(detail.stats.active_enrollments, locale)}
              sub={t("detail.ofTotal", { total: formatNumber(detail.stats.enrollments, locale) })}
            />
            <StatTile
              icon={Ticket}
              label={t("detail.statCodes")}
              value={formatNumber(detail.stats.redeemed_codes, locale)}
              sub={t("detail.activeCodes", { count: formatNumber(detail.stats.active_codes, locale) })}
            />
            <StatTile
              icon={HardDrive}
              label={t("totals.storage")}
              value={fmtBytes(detail.stats.storage_bytes)}
              sub={
                detail.academy.lms_limits.maxStorageGb != null
                  ? t("detail.ofCap", { cap: `${detail.academy.lms_limits.maxStorageGb} GB` })
                  : t("detail.uncapped")
              }
            />
          </div>

          {/* Secondary numbers — quieter than the headline tiles but worth surfacing. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MiniStat icon={Award} label={t("detail.statCertificates")} value={formatNumber(detail.stats.certificates, locale)} />
            <MiniStat icon={Layers} label={t("detail.statCompletedLessons")} value={formatNumber(detail.stats.completed_lessons, locale)} />
            <MiniStat icon={BookOpen} label={t("detail.statQuizAttempts")} value={formatNumber(detail.stats.quiz_attempts, locale)} />
            <MiniStat
              icon={ShieldAlert}
              label={t("detail.statMediaFailed")}
              value={formatNumber(detail.stats.media_failed, locale)}
              tone={detail.stats.media_failed > 0 ? "text-rose-600" : undefined}
            />
          </div>

          {/* Controls */}
          <div className="grid gap-4 lg:grid-cols-2">
            <SiteCard detail={detail} academyId={academyId} onSaved={setDetail} />
            <LimitsCard
              key={JSON.stringify(detail.academy.lms_overrides)}
              detail={detail}
              academyId={academyId}
              onSaved={setDetail}
            />
          </div>

          <CoursesCard detail={detail} academyId={academyId} onChanged={load} />
          <LearnersCard detail={detail} academyId={academyId} onChanged={load} />

          {/* Recent enrolments */}
          <section className="bg-card rounded-xl shadow-sm ring-1 ring-foreground/[0.06]">
            <div className="border-b px-5 py-4">
              <h2 className="text-sm font-semibold">{t("detail.recentTitle")}</h2>
            </div>
            {detail.recent_enrollments.length === 0 ? (
              <p className="text-muted-foreground px-5 py-8 text-center text-sm">{t("detail.recentEmpty")}</p>
            ) : (
              <ul className="divide-y">
                {detail.recent_enrollments.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{e.learner_name}</span>
                      <span className="text-muted-foreground"> · {e.course_title}</span>
                    </span>
                    <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{fmtDate(e.enrolled_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

/** The public course-site handle — Super-Admin-write, owner-read (docs/lms). */
function SiteCard({
  detail,
  academyId,
  onSaved,
}: {
  detail: LmsAcademyDetail;
  academyId: string;
  onSaved: (d: LmsAcademyDetail) => void;
}) {
  const t = useTranslations("adminLms");
  const toast = useToast();
  const [value, setValue] = useState(detail.academy.subdomain ?? "");
  const [saving, setSaving] = useState(false);
  const dirty = value.trim() !== (detail.academy.subdomain ?? "");

  const save = async () => {
    setSaving(true);
    try {
      const next = value.trim();
      onSaved(await setLmsSubdomain(academyId, next === "" ? null : next));
      toast.success(t("detail.site.saved"));
    } catch (e) {
      reportError(toast, e, t("detail.site.failed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="bg-card rounded-xl p-5 shadow-sm ring-1 ring-foreground/[0.06]">
      <div className="mb-3 flex items-center gap-2">
        <Globe className="text-muted-foreground size-4" aria-hidden />
        <h2 className="text-sm font-semibold">{t("detail.site.title")}</h2>
      </div>
      <p className="text-muted-foreground mb-3 text-xs">{t("detail.site.hint")}</p>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value.toLowerCase())}
          placeholder={t("detail.site.placeholder")}
          className="bg-background min-w-0 flex-1 rounded-lg border px-3 py-2 font-mono text-sm"
          aria-label={t("detail.site.title")}
          data-testid="lms-subdomain-input"
        />
        {detail.site.root_domain && (
          <span className="text-muted-foreground shrink-0 font-mono text-xs">.{detail.site.root_domain}</span>
        )}
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || saving}
          className="bg-primary text-primary-foreground inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50"
          data-testid="lms-subdomain-save"
        >
          {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          {t("detail.save")}
        </button>
      </div>

      {detail.site.url && (
        <a
          href={detail.site.url}
          target="_blank"
          rel="noreferrer"
          className="text-primary mt-3 inline-flex items-center gap-1 text-xs font-medium hover:underline"
        >
          <ExternalLink className="size-3.5" aria-hidden />
          {detail.site.url}
        </a>
      )}

      {/* A path-shaped URL means subdomain routing is OFF — say so, rather than letting a
          /learn/<handle> link read as a live subdomain (which is what makes it look broken). */}
      {!detail.site.configured && detail.academy.subdomain !== null && (
        <p className="mt-2 rounded-lg bg-amber-50 dark:bg-amber-950/20 px-2.5 py-1.5 text-[11px] text-amber-700 ring-1 ring-amber-600/20">
          {t("detail.site.notConfigured")}
        </p>
      )}
    </section>
  );
}

/**
 * The per-client capacity caps. Blank = inherit the LMS plan's own limit, so clearing every field
 * removes the override entirely rather than capping the client at zero.
 */
function LimitsCard({
  detail,
  academyId,
  onSaved,
}: {
  detail: LmsAcademyDetail;
  academyId: string;
  onSaved: (d: LmsAcademyDetail) => void;
}) {
  const t = useTranslations("adminLms");
  const locale = useLocale();
  const toast = useToast();

  const [form, setForm] = useState<Record<LimitKey, string>>(() => {
    const at = (k: LimitKey) => {
      const v = detail.academy.lms_overrides?.[k];
      return v === null || v === undefined ? "" : String(v);
    };
    return { maxCourses: at("maxCourses"), maxLearners: at("maxLearners"), maxStorageGb: at("maxStorageGb") };
  });
  const [saving, setSaving] = useState(false);

  const submit = async (limits: LmsLimits, message: string) => {
    setSaving(true);
    try {
      onSaved(await setLmsLimits(academyId, limits));
      toast.success(message);
    } catch (e) {
      reportError(toast, e, t("detail.limits.failed"));
    } finally {
      setSaving(false);
    }
  };

  const save = () => {
    const limits: LmsLimits = {};
    for (const k of LIMIT_KEYS) {
      const raw = form[k].trim();
      if (raw !== "") limits[k] = Number(raw);
    }
    return submit(limits, t("detail.limits.saved"));
  };

  const clear = () => {
    setForm({ maxCourses: "", maxLearners: "", maxStorageGb: "" });
    return submit({}, t("detail.limits.cleared"));
  };

  const used: Record<LimitKey, number> = {
    maxCourses: detail.stats.courses_published,
    maxLearners: detail.stats.learners,
    maxStorageGb: Math.round(detail.stats.storage_bytes / 1e9),
  };

  return (
    <section className="bg-card rounded-xl p-5 shadow-sm ring-1 ring-foreground/[0.06]">
      <div className="mb-3 flex items-center gap-2">
        <SlidersHorizontal className="text-muted-foreground size-4" aria-hidden />
        <h2 className="text-sm font-semibold">{t("detail.limits.title")}</h2>
      </div>
      <p className="text-muted-foreground mb-4 text-xs">{t("detail.limits.hint")}</p>

      <div className="space-y-3">
        {LIMIT_KEYS.map((k) => {
          const effective = detail.academy.lms_limits[k] ?? null;
          const pct = capPct(used[k], effective);
          return (
            <div key={k}>
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <label htmlFor={`lms-limit-${k}`} className="text-xs font-medium">
                  {t(`detail.limit.${k}`)}
                </label>
                <span className="text-muted-foreground text-[11px] tabular-nums">
                  {effective === null
                    ? t("detail.uncapped")
                    : t("detail.usedOfCap", {
                        used: formatNumber(used[k], locale),
                        cap: formatNumber(effective, locale),
                      })}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  id={`lms-limit-${k}`}
                  type="number"
                  min={0}
                  value={form[k]}
                  onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
                  placeholder={t("detail.limits.inherit")}
                  className="bg-background w-32 rounded-lg border px-3 py-1.5 text-sm tabular-nums"
                  data-testid={`lms-limit-${k}`}
                />
                <div className="bg-muted h-1.5 flex-1 overflow-hidden rounded-full">
                  <div
                    className={cn("h-full rounded-full", capTone(used[k], effective))}
                    style={{ width: `${pct ?? (used[k] > 0 ? 100 : 0)}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="bg-primary text-primary-foreground inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50"
          data-testid="lms-limits-save"
        >
          {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          {t("detail.save")}
        </button>
        {detail.academy.lms_overrides !== null ? (
          <button
            type="button"
            onClick={() => void clear()}
            disabled={saving}
            className="text-muted-foreground hover:text-foreground rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-50"
            data-testid="lms-limits-clear"
          >
            {t("detail.limits.clear")}
          </button>
        ) : (
          <span className="text-muted-foreground text-[11px]">{t("detail.limits.inheriting")}</span>
        )}
      </div>
    </section>
  );
}

/** Course moderation — publish, unpublish (takedown) or archive one of the client's courses. */
function CoursesCard({
  detail,
  academyId,
  onChanged,
}: {
  detail: LmsAcademyDetail;
  academyId: string;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations("adminLms");
  const locale = useLocale();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const moderate = async (courseId: string, status: LmsCourseStatus) => {
    setBusy(courseId);
    try {
      await setLmsCourseStatus(academyId, courseId, status);
      await onChanged();
      toast.success(t("detail.courses.moderated"));
    } catch (e) {
      reportError(toast, e, t("detail.courses.failed"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="bg-card rounded-xl shadow-sm ring-1 ring-foreground/[0.06]">
      <div className="border-b px-5 py-4">
        <h2 className="text-sm font-semibold">{t("detail.courses.title")}</h2>
        <p className="text-muted-foreground text-xs">{t("detail.courses.hint")}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className={TR_HEAD}>
              <Th>{t("detail.courses.colTitle")}</Th>
              <Th>{t("detail.courses.colStatus")}</Th>
              <Th className="text-end">{t("detail.courses.colLessons")}</Th>
              <Th className="text-end">{t("detail.courses.colLearners")}</Th>
              <Th className="text-end">{t("detail.courses.colActions")}</Th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {detail.courses.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-muted-foreground px-4 py-10 text-center">
                  {t("detail.courses.empty")}
                </td>
              </tr>
            ) : (
              detail.courses.map((c) => (
                <tr key={c.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-2.5">
                    <p className="font-medium">{c.title}</p>
                    <p className="text-muted-foreground font-mono text-[11px]">{c.slug}</p>
                  </td>
                  <td className="px-4 py-2.5"><CourseStatusBadge status={c.status} /></td>
                  <td className="px-4 py-2.5 text-end tabular-nums">{formatNumber(c.lessons, locale)}</td>
                  <td className="px-4 py-2.5 text-end tabular-nums">{formatNumber(c.learners, locale)}</td>
                  <td className="px-4 py-2.5 text-end">
                    <div className="inline-flex items-center gap-1.5">
                      {busy === c.id && <Loader2 className="text-muted-foreground size-3.5 animate-spin" aria-hidden />}
                      {c.status === "PUBLISHED" ? (
                        <button
                          type="button"
                          onClick={() => void moderate(c.id, "DRAFT")}
                          disabled={busy !== null}
                          className="rounded-lg border px-2.5 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                          data-testid={`lms-course-unpublish-${c.id}`}
                        >
                          {t("detail.courses.unpublish")}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void moderate(c.id, "PUBLISHED")}
                          disabled={busy !== null || c.lessons === 0}
                          title={c.lessons === 0 ? t("detail.courses.needsLesson") : undefined}
                          className="rounded-lg border px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                          data-testid={`lms-course-publish-${c.id}`}
                        >
                          {t("detail.courses.publish")}
                        </button>
                      )}
                      {c.status !== "ARCHIVED" && (
                        <button
                          type="button"
                          onClick={() => void moderate(c.id, "ARCHIVED")}
                          disabled={busy !== null}
                          className="text-muted-foreground hover:text-foreground rounded-lg border px-2.5 py-1 text-xs font-semibold disabled:opacity-50"
                          data-testid={`lms-course-archive-${c.id}`}
                        >
                          {t("detail.courses.archive")}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Learner moderation — block a learner out of the client's course site, or restore them. */
function LearnersCard({
  detail,
  academyId,
  onChanged,
}: {
  detail: LmsAcademyDetail;
  academyId: string;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations("adminLms");
  const locale = useLocale();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const fmtDate = (s: string) => new Date(s).toLocaleDateString(locale, { dateStyle: "medium" });

  const moderate = async (learnerId: string, status: "ACTIVE" | "BLOCKED") => {
    setBusy(learnerId);
    try {
      await setLmsLearnerStatus(academyId, learnerId, status);
      await onChanged();
      toast.success(t("detail.learners.moderated"));
    } catch (e) {
      reportError(toast, e, t("detail.learners.failed"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="bg-card rounded-xl shadow-sm ring-1 ring-foreground/[0.06]">
      <div className="border-b px-5 py-4">
        <h2 className="text-sm font-semibold">{t("detail.learners.title")}</h2>
        <p className="text-muted-foreground text-xs">{t("detail.learners.hint")}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className={TR_HEAD}>
              <Th>{t("detail.learners.colName")}</Th>
              <Th>{t("detail.learners.colStatus")}</Th>
              <Th className="text-end">{t("detail.learners.colEnrollments")}</Th>
              <Th className="text-end">{t("detail.learners.colLastLogin")}</Th>
              <Th className="text-end">{t("detail.courses.colActions")}</Th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {detail.learners.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-muted-foreground px-4 py-10 text-center">
                  {t("detail.learners.empty")}
                </td>
              </tr>
            ) : (
              detail.learners.map((l) => (
                <tr key={l.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-2.5">
                    <p className="font-medium">{l.full_name}</p>
                    <p className="text-muted-foreground text-[11px]">{l.email}</p>
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[11px] font-medium ring-1",
                        l.status === "ACTIVE"
                          ? "bg-emerald-100 text-emerald-700 ring-emerald-600/20"
                          : "bg-rose-100 text-rose-700 ring-rose-600/20",
                      )}
                    >
                      {t(`detail.learners.status.${l.status}`)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-end tabular-nums">{formatNumber(l.enrollments, locale)}</td>
                  <td className="text-muted-foreground px-4 py-2.5 text-end text-xs tabular-nums">
                    {l.last_login_at ? fmtDate(l.last_login_at) : t("detail.never")}
                  </td>
                  <td className="px-4 py-2.5 text-end">
                    <div className="inline-flex items-center gap-1.5">
                      {busy === l.id && <Loader2 className="text-muted-foreground size-3.5 animate-spin" aria-hidden />}
                      <button
                        type="button"
                        onClick={() => void moderate(l.id, l.status === "ACTIVE" ? "BLOCKED" : "ACTIVE")}
                        disabled={busy !== null}
                        className={cn(
                          "rounded-lg border px-2.5 py-1 text-xs font-semibold disabled:opacity-50",
                          l.status === "ACTIVE" ? "text-rose-600 hover:bg-rose-50" : "text-emerald-700 hover:bg-emerald-50",
                        )}
                        data-testid={`lms-learner-toggle-${l.id}`}
                      >
                        {l.status === "ACTIVE" ? t("detail.learners.block") : t("detail.learners.unblock")}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MiniStat({ icon: Icon, label, value, tone }: { icon: LucideIcon; label: string; value: string; tone?: string }) {
  return (
    <div className="bg-muted/30 flex items-center gap-3 rounded-xl border p-3">
      <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="text-muted-foreground truncate text-[11px] font-medium">{label}</p>
        <p className={cn("text-sm font-bold tabular-nums", tone)}>{value}</p>
      </div>
    </div>
  );
}
