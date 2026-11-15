"use client";

import {
  Activity,
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  Clock,
  Database,
  GitCommitHorizontal,
  Layers,
  MessageCircle,
  RefreshCw,
  RotateCcw,
  Siren,
  Trash2,
  UsersRound,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { EmptyState } from "@/components/admin/empty-state";
import { AdminPageHeader } from "@/components/admin/page-header";
import { SectionCard } from "@/components/admin/section-card";
import { SectionTabs, type SectionTab } from "@/components/admin/section-tabs";
import { StatTile } from "@/components/admin/stat-tile";
import { StatusChip, type ChipTone } from "@/components/admin/status-chip";
import { Th, TR_HEAD } from "@/components/admin/table";
import { useAuth } from "@/components/auth-provider";
import { clientTabHref, type ClientTab } from "@/components/clients/client-summary";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  ApiError,
  dismissFailedJob,
  getClientAttention,
  getSystemHealth,
  retryFailedJob,
  type AttentionClient,
  type AttentionCode,
  type AttentionItem,
  type ClientAttention,
  type FailedJob,
  type HealthProblem,
  type ScheduledTask,
  type SystemHealth,
} from "@/lib/api";
import { formatMoney, formatNumber } from "@/lib/money";
import { formatLocalDateTime, formatRelativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";

type HealthTab = "attention" | "system";

/** The scheduled tasks we have a plain-language name for; anything new shows its raw name. */
const KNOWN_TASKS = new Set([
  "roll-session-window",
  "close-monthly-invoices",
  "close-monthly-payouts",
  "open-fixed-salary-payouts",
  "bill-group-months",
  "flag-overdue-reports",
  "auto-deduct-unreported",
  "expire-academy-trials",
  "accounts-daily",
  "type1-student-billing",
  "type1-student-billing-retry-1",
  "type1-student-billing-retry-2",
  "type2-lesson-reminders",
  "whatsapp-group-alerts",
  "purge-expired-recordings",
  "verify-custom-domains",
]);

/** Where on the client page each problem gets fixed. */
const FIX_TAB: Record<AttentionCode, ClientTab> = {
  whatsapp_disconnected: "connections",
  whatsapp_failing: "connections",
  lessons_stopped: "tools",
  overdue_lessons: "overview",
  bills_overdue: "subscription",
  trial_ended: "subscription",
  trial_ending: "subscription",
  inactive: "overview",
  never_signed_in: "overview",
};

const TASK_TONE: Record<ScheduledTask["state"], ChipTone> = {
  OK: "good",
  LATE: "warn",
  FAILED: "crit",
  WAITING: "neutral",
};

/**
 * Super Admin → System health. Two questions that used to need an SSH session or a client's
 * complaint:
 *
 *   Needs attention   which clients need stepping in for, and why — worst first
 *   System            is the machine running: the cron, the queue, every scheduled task against
 *                     when it last actually FINISHED, the dead jobs, the WhatsApp gateway
 *
 * The headline strip above the tabs says in one line whether the machine is fine, whichever tab
 * is open. `?tab=` names the open one.
 */
export function SystemHealthScreen() {
  const t = useTranslations("adminHealth");
  const locale = useLocale();
  const { can } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [attention, setAttention] = useState<ClientAttention | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busyJob, setBusyJob] = useState<string | null>(null);

  const allowed = can("platform.manage");

  const load = useCallback(async () => {
    setLoading(true);
    // Two independent reads: one failing must not blank the other.
    const [h, a] = await Promise.allSettled([getSystemHealth(), getClientAttention()]);
    if (h.status === "fulfilled") setHealth(h.value);
    if (a.status === "fulfilled") setAttention(a.value);
    setError(h.status === "rejected" || a.status === "rejected");
    setLoading(false);
  }, []);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  if (!allowed) {
    return <p className="text-muted-foreground text-sm">{t("noPermission")}</p>;
  }

  const tab: HealthTab = searchParams.get("tab") === "system" ? "system" : "attention";
  const setTab = (next: HealthTab) =>
    router.replace(next === "attention" ? pathname : `${pathname}?tab=${next}`, { scroll: false });

  const n = (value: number) => formatNumber(value, locale);
  const ago = (iso: string | null) => (iso === null ? t("never") : formatRelativeTime(iso, locale));

  const taskName = (name: string) => (KNOWN_TASKS.has(name) ? t(`task.${name}`) : name);

  const problemText = (p: HealthProblem): string => {
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(p.params)) {
      params[key] = typeof value === "number" ? n(value) : String(value);
    }
    if (typeof p.params.task === "string") params.task = taskName(p.params.task);
    return t(`problem.${p.code}`, params);
  };

  const actOnJob = async (job: FailedJob, action: "retry" | "dismiss") => {
    setBusyJob(job.id);
    try {
      await (action === "retry" ? retryFailedJob(job.id) : dismissFailedJob(job.id));
      toast.success(t(action === "retry" ? "failed.retried" : "failed.dismissed"));
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError && e.message ? e.message : t("failed.actionError"));
    } finally {
      setBusyJob(null);
    }
  };

  const tabs: SectionTab<HealthTab>[] = [
    {
      key: "attention",
      label: t("tabs.attention"),
      icon: UsersRound,
      badge: attention && attention.counts.clients > 0 ? n(attention.counts.clients) : undefined,
    },
    {
      key: "system",
      label: t("tabs.system"),
      icon: Activity,
      badge: health && health.problems.length > 0 ? n(health.problems.length) : undefined,
    },
  ];

  return (
    <div className="space-y-5" data-testid="system-health">
      <AdminPageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="text-muted-foreground hover:text-foreground rounded-lg border p-2 transition-colors disabled:opacity-50"
            aria-label={t("refresh")}
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} aria-hidden />
          </button>
        }
      />

      {error && <AlertBanner variant="error" message={t("loadError")} />}

      <Headline health={health} problemText={problemText} onOpenSystem={() => setTab("system")} />

      <SectionTabs tabs={tabs} value={tab} onChange={setTab} ariaLabel={t("title")} />

      {tab === "attention" && <AttentionTab data={attention} />}

      {tab === "system" && (
        <div className="space-y-5" role="tabpanel">
          {/* The vital signs */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
            <StatTile
              icon={Clock}
              label={t("vital.scheduler")}
              loading={health === null}
              value={health ? ago(health.scheduler.heartbeat_at) : null}
              sub={t("vital.schedulerSub")}
              subTone={toneOf(health, ["scheduler_stopped", "scheduler_never_ran"])}
              testId="vital-scheduler"
            />
            <StatTile
              icon={CalendarClock}
              label={t("vital.roll")}
              loading={health === null}
              value={health ? ago(health.scheduler.last_roll_at) : null}
              sub={t("vital.rollSub")}
              subTone={toneOf(health, ["roll_stale"])}
            />
            <StatTile
              icon={Layers}
              label={t("vital.queue")}
              loading={health === null}
              value={health ? n(health.queue.pending) : null}
              sub={
                health && health.queue.oldest_pending_age_seconds !== null && health.queue.pending > 0
                  ? t("vital.queueOldest", { minutes: n(Math.floor(health.queue.oldest_pending_age_seconds / 60)) })
                  : t("vital.queueSub")
              }
              subTone={toneOf(health, ["queue_stuck"])}
            />
            <StatTile
              icon={AlertTriangle}
              label={t("vital.failed")}
              loading={health === null}
              value={health ? n(health.queue.failed_total) : null}
              sub={health ? t("vital.failedSub", { count: n(health.queue.failed_24h) }) : undefined}
              subTone={health && health.queue.failed_24h > 0 ? "warn" : "neutral"}
            />
            <StatTile
              icon={MessageCircle}
              label={t("vital.gateway")}
              loading={health === null}
              value={
                health === null
                  ? null
                  : !health.gateway.configured
                    ? "—"
                    : health.gateway.up
                      ? t("vital.gatewayUp")
                      : t("vital.gatewayDown")
              }
              sub={
                health?.gateway.sessions
                  ? t("vital.gatewaySessions", {
                      connected: n(health.gateway.sessions.connected),
                      total: n(health.gateway.sessions.total),
                    })
                  : undefined
              }
              subTone={toneOf(health, ["gateway_down"])}
              href="/admin/automation"
            />
            <StatTile
              icon={GitCommitHorizontal}
              label={t("vital.deploy")}
              loading={health === null}
              value={health ? (health.app.commit ?? "—") : null}
              sub={health?.app.deployed_at ? ago(health.app.deployed_at) : undefined}
            />
          </div>

          {/* Scheduled tasks */}
          <SectionCard
            icon={CalendarClock}
            title={t("tasks.title")}
            description={t("tasks.hint")}
            flush
            testId="health-tasks"
          >
            {health !== null && health.tasks.length === 0 ? (
              <p className="text-muted-foreground px-5 py-8 text-center text-sm">{t("tasks.empty")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className={TR_HEAD}>
                      <Th>{t("tasks.colTask")}</Th>
                      <Th>{t("tasks.colState")}</Th>
                      <Th>{t("tasks.colLastOk")}</Th>
                      <Th>{t("tasks.colNext")}</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {health === null
                      ? Array.from({ length: 5 }).map((_, i) => (
                          <tr key={i}>
                            <td colSpan={4} className="px-4 py-3">
                              <div className="bg-muted h-5 animate-pulse rounded" aria-hidden />
                            </td>
                          </tr>
                        ))
                      : health.tasks.map((task) => (
                          <tr key={task.name} data-testid={`task-${task.name}`}>
                            <td className="px-4 py-2.5">
                              <p className="font-medium">{taskName(task.name)}</p>
                              {task.state === "FAILED" && task.last_error && (
                                <p className="mt-0.5 text-xs break-words text-rose-600 dark:text-rose-400" dir="ltr">
                                  {task.last_error}
                                </p>
                              )}
                            </td>
                            <td className="px-4 py-2.5">
                              <StatusChip tone={TASK_TONE[task.state]} dot>
                                {t(`tasks.state.${task.state}`)}
                              </StatusChip>
                            </td>
                            <td
                              className="text-muted-foreground px-4 py-2.5 text-xs whitespace-nowrap"
                              title={task.last_ok_at ? formatLocalDateTime(task.last_ok_at, locale) : undefined}
                            >
                              {ago(task.last_ok_at)}
                            </td>
                            <td
                              className="text-muted-foreground px-4 py-2.5 text-xs whitespace-nowrap"
                              title={task.next_due_at ? formatLocalDateTime(task.next_due_at, locale) : undefined}
                            >
                              {task.next_due_at ? formatRelativeTime(task.next_due_at, locale) : "—"}
                            </td>
                          </tr>
                        ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          {/* Dead jobs */}
          <SectionCard
            icon={AlertTriangle}
            title={t("failed.title")}
            description={t("failed.hint")}
            flush
            testId="health-failed-jobs"
          >
            {health !== null && health.failed_jobs.length === 0 ? (
              <p className="text-muted-foreground px-5 py-8 text-center text-sm">{t("failed.empty")}</p>
            ) : (
              <ul className="divide-y">
                {(health?.failed_jobs ?? []).map((job) => (
                  <li
                    key={job.id}
                    className="flex flex-wrap items-start justify-between gap-3 px-5 py-3"
                    data-testid={`failed-job-${job.id}`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium" dir="ltr">
                        {job.job ?? job.queue}
                      </p>
                      <p className="text-muted-foreground mt-0.5 text-xs break-words" dir="ltr">
                        {job.error}
                      </p>
                      <p className="text-muted-foreground mt-1 text-[11px]">
                        {formatLocalDateTime(job.failed_at, locale)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyJob !== null}
                        onClick={() => void actOnJob(job, "retry")}
                        data-testid={`retry-${job.id}`}
                      >
                        <RotateCcw className="size-3.5" aria-hidden />
                        {t("failed.retry")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busyJob !== null}
                        onClick={() => void actOnJob(job, "dismiss")}
                        data-testid={`dismiss-${job.id}`}
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                        {t("failed.dismiss")}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          {health && (
            <p className="text-muted-foreground text-xs">
              <Database className="me-1 inline size-3.5 align-[-2px]" aria-hidden />
              {t("checkedAt", { time: formatLocalDateTime(health.checked_at, locale) })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** The tone of a vital sign: the severity of whichever of its problems is present, else quiet. */
function toneOf(health: SystemHealth | null, codes: HealthProblem["code"][]): "crit" | "warn" | "neutral" {
  const hit = health?.problems.find((p) => codes.includes(p.code));
  return hit === undefined ? "neutral" : hit.severity === "CRIT" ? "crit" : "warn";
}

/** One line on the machine, above the tabs: fine, or exactly what is not. */
function Headline({
  health,
  problemText,
  onOpenSystem,
}: {
  health: SystemHealth | null;
  problemText: (p: HealthProblem) => string;
  onOpenSystem: () => void;
}) {
  const t = useTranslations("adminHealth");

  if (health === null) {
    return <div className="bg-muted h-14 animate-pulse rounded-xl" aria-hidden />;
  }

  if (health.status === "OK") {
    return (
      <div
        className="flex items-center gap-3 rounded-xl bg-emerald-50 px-4 py-3 text-emerald-800 ring-1 ring-emerald-600/15 dark:bg-emerald-950/30 dark:text-emerald-200"
        data-testid="health-headline"
        data-status="OK"
      >
        <CheckCircle2 className="size-5 shrink-0" aria-hidden />
        <p className="text-sm font-semibold">{t("headline.ok")}</p>
      </div>
    );
  }

  const crit = health.status === "CRIT";
  return (
    <div
      className={cn(
        "rounded-xl px-4 py-3 ring-1",
        crit
          ? "bg-rose-50 text-rose-800 ring-rose-600/20 dark:bg-rose-950/30 dark:text-rose-200"
          : "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-950/30 dark:text-amber-200",
      )}
      data-testid="health-headline"
      data-status={health.status}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold">
          {crit ? <Siren className="size-5 shrink-0" aria-hidden /> : <CircleAlert className="size-5 shrink-0" aria-hidden />}
          {t(crit ? "headline.crit" : "headline.warn")}
        </p>
        <button type="button" onClick={onOpenSystem} className="text-xs font-semibold underline-offset-2 hover:underline">
          {t("headline.details")}
        </button>
      </div>
      <ul className="mt-2 space-y-1 text-sm">
        {health.problems.map((p, i) => (
          <li key={`${p.code}-${i}`} className="flex items-start gap-2">
            <span
              className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", p.severity === "CRIT" ? "bg-rose-500" : "bg-amber-500")}
              aria-hidden
            />
            {problemText(p)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The clients that need stepping in for — one card each, worst first, every reason a link to its fix. */
function AttentionTab({ data }: { data: ClientAttention | null }) {
  const t = useTranslations("adminHealth");
  const locale = useLocale();
  const n = (value: number) => formatNumber(value, locale);

  if (data === null) {
    return (
      <div className="space-y-3" role="tabpanel" aria-busy>
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-muted h-24 animate-pulse rounded-xl" aria-hidden />
        ))}
      </div>
    );
  }

  if (data.clients.length === 0) {
    return (
      <div role="tabpanel">
        <EmptyState icon={CheckCircle2} message={t("attention.empty")} testId="attention-empty" />
      </div>
    );
  }

  const itemText = (item: AttentionItem): string => {
    const p = item.params;
    const num = (key: string) => n(Number(p[key] ?? 0));
    switch (item.code) {
      case "whatsapp_disconnected":
        return t(p.reminders_live ? "item.whatsapp_disconnected_live" : "item.whatsapp_disconnected");
      case "whatsapp_failing":
        return t("item.whatsapp_failing", { failed: num("failed"), sent: num("sent") });
      case "lessons_stopped":
        return t("item.lessons_stopped", { schedules: num("schedules") });
      case "overdue_lessons":
        return t("item.overdue_lessons", { count: num("count"), days: num("oldest_days") });
      case "bills_overdue": {
        const overdue = (p.overdue ?? {}) as Record<string, number>;
        const amount = Object.entries(overdue)
          .map(([currency, minor]) => formatMoney({ amount: minor, currency }, locale, { trimZeroDecimals: true }))
          .join(" + ");
        return amount === "" ? t("item.bills_overdue_plain") : t("item.bills_overdue", { amount });
      }
      case "trial_ended":
        return t("item.trial_ended", { days: num("days") });
      case "trial_ending":
        return t("item.trial_ending", { days: num("days") });
      case "inactive":
        return t("item.inactive", { days: num("days") });
      case "never_signed_in":
        return t("item.never_signed_in", { days: num("days") });
    }
  };

  return (
    <div className="space-y-4" role="tabpanel">
      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        <StatTile
          icon={Siren}
          label={t("attention.crit")}
          value={n(data.counts.crit)}
          sub={t("attention.critSub")}
          subTone={data.counts.crit > 0 ? "crit" : "neutral"}
        />
        <StatTile
          icon={CircleAlert}
          label={t("attention.warn")}
          value={n(data.counts.warn)}
          sub={t("attention.warnSub")}
          subTone={data.counts.warn > 0 ? "warn" : "neutral"}
        />
      </div>

      <ul className="space-y-3">
        {data.clients.map((client: AttentionClient) => (
          <li
            key={client.id}
            className="admin-surface bg-card rounded-xl p-4 shadow-sm ring-1 ring-foreground/[0.06]"
            data-testid={`attention-${client.id}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link href={`/admin/clients/${client.id}`} className="min-w-0 truncate text-sm font-bold hover:underline">
                {client.name}
              </Link>
              <StatusChip tone={client.severity === "CRIT" ? "crit" : "warn"} dot>
                {t(client.severity === "CRIT" ? "attention.chipCrit" : "attention.chipWarn")}
              </StatusChip>
            </div>
            <ul className="mt-3 space-y-1.5">
              {client.items.map((item) => (
                <li key={item.code} className="flex items-start gap-2 text-sm">
                  <span
                    className={cn(
                      "mt-1.5 size-1.5 shrink-0 rounded-full",
                      item.severity === "CRIT" ? "bg-rose-500" : "bg-amber-500",
                    )}
                    aria-hidden
                  />
                  <Link href={clientTabHref(client.id, FIX_TAB[item.code])} className="hover:underline">
                    {itemText(item)}
                  </Link>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
