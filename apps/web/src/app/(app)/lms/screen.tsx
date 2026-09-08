"use client";

import {
  ArrowRight,
  Award,
  BookOpen,
  Check,
  Copy,
  ExternalLink,
  Globe,
  GraduationCap,
  HardDrive,
  KeyRound,
  Library,
  LayoutDashboard,
  PlayCircle,
  RefreshCw,
  Ticket,
  TrendingUp,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { CourseStatusBadge } from "@/components/courses/course-status-badge";
import {
  EmptyState,
  InitialsAvatar,
  lmsColor,
  LmsHero,
  Panel,
  SectionTitle,
  Sk,
  StatCard,
} from "@/components/courses/lms-ui";
import { AlertBanner } from "@/components/ui/alert";
import { getLmsDashboard, type LmsDashboard } from "@/lib/api";
import { formatNumber } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * The LMS client's home screen (docs/lms) — what a course-platform client sees instead of the school
 * management dashboard: their catalogue and learner numbers, the public site their subdomain serves,
 * and the latest enrolments.
 */
export function LmsDashboardScreen() {
  const t = useTranslations("lms.dashboard");
  const locale = useLocale();
  const { can } = useAuth();
  const [data, setData] = useState<LmsDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    () =>
      getLmsDashboard()
        .then(setData)
        .catch((e) => setError(e instanceof Error ? e.message : String(e))),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  function refresh() {
    setRefreshing(true);
    // Keep the spinner up briefly even on a fast response — an instant flash reads as "nothing
    // happened" rather than as a refresh.
    void load().finally(() => setTimeout(() => setRefreshing(false), 700));
  }

  if (!can("course.read")) {
    return (
      <EmptyState Icon={GraduationCap} color="slate" title={t("noAccess")} />
    );
  }

  if (error !== null) {
    return <AlertBanner variant="error" message={error} />;
  }

  const loading = data === null;
  const stats = data?.stats;
  const storage = data?.storage;

  // Storage is the one metric with a ceiling — show how close the client is to it.
  const storagePct =
    storage && storage.limit_bytes
      ? Math.round((storage.used_bytes / storage.limit_bytes) * 100)
      : undefined;

  return (
    <div className="space-y-6 pb-4">
      <LmsHero
        Icon={GraduationCap}
        // Once a subdomain exists it becomes the headline (it is the client's brand), and the module
        // name drops to the eyebrow. Before then the module name is the headline — showing it twice
        // would read as a rendering bug.
        eyebrow={
          data?.site.subdomain != null ? (
            <>
              <LayoutDashboard className="size-3.5" />
              <span>{t("title")}</span>
            </>
          ) : undefined
        }
        title={data?.site.subdomain ?? t("title")}
        subtitle={t("subtitle")}
      >
        <SiteActions site={data?.site} loading={loading} onRefresh={refresh} refreshing={refreshing} />
      </LmsHero>

      {!loading && data.site.subdomain === null && (
        <AlertBanner variant="info" message={t("noSubdomain")} />
      )}

      {/* ── Key metrics ── */}
      <section className="space-y-3">
        <SectionTitle
          Icon={TrendingUp}
          color="violet"
          title={t("sections.overview")}
          desc={t("sections.overviewDesc")}
        />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <StatCard
            Icon={BookOpen}
            color="violet"
            label={t("courses")}
            value={stats?.courses ?? null}
            hint={
              stats
                ? t("coursesHint", {
                    published: formatNumber(stats.published_courses, locale),
                    draft: formatNumber(stats.draft_courses, locale),
                  })
                : undefined
            }
            loading={loading}
            href="/lms/courses"
            locale={locale}
          />
          {/* The bookshop (docs/lms/11) — hidden until the client publishes one, so a course-only
              client never sees a permanent zero on their home screen. */}
          {(stats === undefined || stats.products > 0) && (
            <StatCard
              Icon={Library}
              color="amber"
              label={t("books")}
              value={stats?.products ?? null}
              hint={
                stats
                  ? t("booksHint", {
                      published: formatNumber(stats.published_products, locale),
                      owners: formatNumber(stats.product_owners, locale),
                    })
                  : undefined
              }
              loading={loading}
              href="/lms/books"
              locale={locale}
            />
          )}
          <StatCard
            Icon={PlayCircle}
            color="indigo"
            label={t("lessons")}
            value={stats?.lessons ?? null}
            hint={t("lessonsHint")}
            loading={loading}
            href="/lms/courses"
            locale={locale}
          />
          <StatCard
            Icon={Users}
            color="cyan"
            label={t("learners")}
            value={stats?.learners ?? null}
            hint={
              stats
                ? t("learnersHint", { active: formatNumber(stats.active_learners, locale) })
                : undefined
            }
            loading={loading}
            href="/lms/learners"
            locale={locale}
          />
          <StatCard
            Icon={Ticket}
            color="emerald"
            label={t("enrollments")}
            value={stats?.active_enrollments ?? null}
            hint={
              stats
                ? t("enrollmentsHint", { total: formatNumber(stats.enrollments, locale) })
                : undefined
            }
            loading={loading}
            locale={locale}
          />
          <StatCard
            Icon={KeyRound}
            color="amber"
            label={t("codes")}
            value={stats?.active_codes ?? null}
            hint={
              stats
                ? t("codesHint", { redeemed: formatNumber(stats.redeemed_codes, locale) })
                : undefined
            }
            loading={loading}
            href="/lms/codes"
            locale={locale}
          />
          <StatCard
            Icon={Award}
            color="fuchsia"
            label={t("certificates")}
            value={stats?.certificates ?? null}
            loading={loading}
            locale={locale}
          />
        </div>
      </section>

      {/* ── Storage + quick actions ── */}
      <section className="grid gap-4 lg:grid-cols-3">
        <StatCard
          Icon={HardDrive}
          color="slate"
          label={t("storage")}
          value={storage ? formatBytes(storage.used_bytes, locale) : null}
          hint={
            storage
              ? storage.limit_bytes === null
                ? t("storageUncapped")
                : t("storageOf", { limit: formatBytes(storage.limit_bytes, locale) })
              : undefined
          }
          loading={loading}
          locale={locale}
          progress={storagePct}
          progressLabel={storagePct !== undefined ? t("storageUsed", { percent: storagePct }) : undefined}
        />
        <ActionCard
          href="/lms/courses"
          Icon={BookOpen}
          color="violet"
          label={t("actions.coursesTitle")}
          desc={t("actions.coursesDesc")}
        />
        <ActionCard
          href="/lms/codes"
          Icon={KeyRound}
          color="amber"
          label={t("actions.codesTitle")}
          desc={t("actions.codesDesc")}
        />
      </section>

      {/* ── Activity ── */}
      <section className="space-y-3">
        <SectionTitle
          Icon={Users}
          color="cyan"
          title={t("sections.activity")}
          desc={t("sections.activityDesc")}
        />
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel
            Icon={BookOpen}
            color="violet"
            title={t("topCourses")}
            flush
            action={<ViewAll href="/lms/courses" label={t("viewAll")} />}
          >
            {loading ? (
              <ListSkeleton />
            ) : data.top_courses.length === 0 ? (
              <EmptyState
                Icon={BookOpen}
                color="violet"
                title={t("noCourses")}
                description={t("noCoursesHint")}
              />
            ) : (
              <ul className="divide-y">
                {data.top_courses.map((c, i) => (
                  <li key={c.id}>
                    <Link
                      href={`/lms/courses/${c.id}`}
                      className="hover:bg-muted/40 group flex items-center gap-3 px-5 py-3 transition-colors"
                    >
                      <span className="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold tabular-nums">
                        {formatNumber(i + 1, locale)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{c.title}</span>
                        <span className="text-muted-foreground block truncate text-xs">
                          {t("learnerCount", { count: formatNumber(c.learners, locale) })}
                        </span>
                      </span>
                      <CourseStatusBadge status={c.status} />
                      <ArrowRight className="text-muted-foreground/40 group-hover:text-foreground/70 size-4 shrink-0 transition-all rtl:rotate-180" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            Icon={Ticket}
            color="emerald"
            title={t("recentEnrollments")}
            flush
            action={<ViewAll href="/lms/learners" label={t("viewAll")} />}
          >
            {loading ? (
              <ListSkeleton />
            ) : data.recent_enrollments.length === 0 ? (
              <EmptyState
                Icon={Ticket}
                color="emerald"
                title={t("noEnrollments")}
                description={t("noEnrollmentsHint")}
              />
            ) : (
              <ul className="divide-y">
                {data.recent_enrollments.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 px-5 py-3">
                    <InitialsAvatar name={e.learner_name} className="size-8" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{e.learner_name}</p>
                      <p className="text-muted-foreground truncate text-xs">{e.course_title}</p>
                    </div>
                    {e.enrolled_at !== null && (
                      <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                        {new Date(e.enrolled_at).toLocaleDateString(locale, {
                          day: "numeric",
                          month: "short",
                        })}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </section>
    </div>
  );
}

/**
 * The hero's right-hand cluster: the live public-site URL (copyable), a link that opens it, and a
 * refresh control. The site is the client's shopfront, so it earns the most prominent slot.
 */
function SiteActions({
  site,
  loading,
  onRefresh,
  refreshing,
}: {
  site: LmsDashboard["site"] | undefined;
  loading: boolean;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const t = useTranslations("lms.dashboard");
  const [copied, setCopied] = useState(false);

  if (loading) {
    return <Sk className="h-9 w-52 bg-white/20" />;
  }

  const url = site?.url ?? null;
  const external = url?.startsWith("http") ?? false;

  function copy() {
    if (!url) return;
    void navigator.clipboard?.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {url !== null && (
        <span className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/15 py-1 ps-3 pe-1 text-xs font-medium text-white backdrop-blur-sm">
          <Globe className="size-3.5 shrink-0" />
          <span className="max-w-[14rem] truncate">{url.replace(/^https?:\/\//, "")}</span>
          <button
            type="button"
            onClick={copy}
            aria-label={t("copyLink")}
            title={copied ? t("copied") : t("copyLink")}
            className="rounded-full p-1.5 transition-colors hover:bg-white/20"
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          </button>
        </span>
      )}

      {url !== null && (
        <a
          href={url}
          target={external ? "_blank" : undefined}
          rel={external ? "noreferrer" : undefined}
          className="inline-flex items-center gap-2 rounded-lg bg-white px-3.5 py-2 text-sm font-semibold text-violet-700 shadow-sm transition-transform hover:-translate-y-0.5"
        >
          <ExternalLink className="size-4" />
          {t("visitSite")}
        </a>
      )}

      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
        aria-label={t("refresh")}
        title={t("refresh")}
        className="flex size-9 items-center justify-center rounded-lg border border-white/25 bg-white/15 text-white backdrop-blur-sm transition-colors hover:bg-white/25 disabled:opacity-60"
      >
        <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
      </button>
    </div>
  );
}

/** A shortcut tile into one of the workspace's working surfaces. */
function ActionCard({
  href,
  Icon,
  color,
  label,
  desc,
}: {
  href: string;
  Icon: LucideIcon;
  color: string;
  label: string;
  desc: string;
}) {
  const c = lmsColor(color);
  return (
    <Link
      href={href}
      className="group bg-card relative flex items-center gap-3 overflow-hidden rounded-xl p-4 shadow-sm ring-1 ring-foreground/[0.06] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
    >
      <div
        className={cn(
          "pointer-events-none absolute -top-6 -start-6 size-20 rounded-full opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100",
          c.glow,
        )}
      />
      <span
        className={cn(
          "relative flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md transition-transform duration-200 group-hover:scale-110",
          c.chip,
        )}
      >
        <Icon className="size-5" />
      </span>
      <div className="relative min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{label}</p>
        <p className="text-muted-foreground truncate text-xs">{desc}</p>
      </div>
      <ArrowRight className="text-muted-foreground/40 group-hover:text-foreground/70 relative size-4 shrink-0 transition-all group-hover:translate-x-0.5 rtl:rotate-180" />
    </Link>
  );
}

function ViewAll({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="text-primary flex shrink-0 items-center gap-1 text-xs font-medium hover:underline"
    >
      {label} <ArrowRight className="size-3 rtl:rotate-180" />
    </Link>
  );
}

function ListSkeleton() {
  return (
    <ul className="divide-y">
      {Array.from({ length: 4 }, (_, i) => (
        <li key={i} className="flex items-center gap-3 px-5 py-3">
          <Sk className="size-8 rounded-xl" />
          <div className="flex-1 space-y-1.5">
            <Sk className="h-3.5 w-2/5" />
            <Sk className="h-3 w-1/4" />
          </div>
          <Sk className="h-5 w-16 rounded-full" />
        </li>
      ))}
    </ul>
  );
}

/** Compact byte formatting (KB/MB/GB) for the storage tile. */
function formatBytes(bytes: number, locale: string): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }

  return `${value.toLocaleString(locale, { maximumFractionDigits: 1 })} ${units[unit]}`;
}
