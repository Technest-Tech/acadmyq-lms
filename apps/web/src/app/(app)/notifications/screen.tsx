"use client";

import { academyTimeZone } from "@/lib/academy-clock";
import {
  Ban,
  BellRing,
  CalendarCheck,
  CalendarClock,
  Check,
  CheckCheck,
  ChevronDown,
  CircleCheckBig,
  ClipboardX,
  Gift,
  GraduationCap,
  Hourglass,
  Inbox,
  Layers,
  RefreshCw,
  ScrollText,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CancellationBillingModal,
  type CancellationBillingValues,
} from "@/components/attendance/cancellation-billing-modal";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { AlertBanner } from "@/components/ui/alert";
import { PageHero } from "@/components/ui/page-hero";
import {
  ApiError,
  approveCancellation,
  type CancellationRequestRow,
  type CancellationStatus,
  getNotificationsSummary,
  listCancellationRequests,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  markNotificationsRead,
  markNotificationTypesRead,
  type NotificationRow,
  type NotificationType,
  rejectCancellation,
} from "@/lib/api";
import { useCapability } from "@/lib/capabilities";
import { formatMoney, formatNumber } from "@/lib/money";
import { formatHours, formatRelativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";

/**
 * /notifications — the owner's inbox, split by what each item asks of them (Ahmed, 11-22: "lots of
 * unimportant notifications, the page isn't divided well, the alerts could show better").
 *
 * Three sections instead of five equal tabs:
 * - **Needs your decision**: cancellation / free-lesson requests to approve, money not collected,
 *   lessons taken with no package. Loud colours; the page opens here when anything is waiting.
 * - **To follow up**: overdue lesson reports (one row per TEACHER, not per lesson), packages running
 *   low, packages finished.
 * - **Log**: what happened, to read only: lessons attended, group lessons cancelled, requests decided.
 *
 * An alert already read folds away under "already seen", so the list shows what is new.
 */

type Section = "action" | "follow" | "log";
type LogView = "attended" | "cancelled" | "decided";
type Tone = "rose" | "amber" | "sky" | "emerald" | "slate";

// What each alert asks of the owner. A type the page does not know is left out, never shown under
// another type's words.
const ACTION_TYPES = new Set<NotificationType>(["PACKAGE_UNPAID", "SUBSCRIPTION_UNPAID", "NO_ACTIVE_PACKAGE", "LESSON_OUTSIDE_SUBSCRIPTION"]);
const FOLLOW_TYPES = new Set<NotificationType>(["REPORT_OVERDUE", "PACKAGE_LOW", "PACKAGE_COMPLETED", "SUBSCRIPTION_FINISHED"]);
const MONEY_TYPES = new Set<NotificationType>(["PACKAGE_UNPAID", "SUBSCRIPTION_UNPAID"]);
const LOW_TYPES = new Set<NotificationType>(["PACKAGE_LOW"]);

const TONE: Record<Tone, { stripe: string; chip: string; dot: string; card: string; count: string }> = {
  rose: {
    stripe: "border-s-rose-500",
    chip: "bg-rose-100 text-rose-700 ring-rose-200/70 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/20",
    dot: "bg-rose-500",
    card: "border-rose-300 bg-rose-50 ring-2 ring-rose-200 dark:border-rose-500/40 dark:bg-rose-500/10 dark:ring-rose-500/20",
    count: "bg-rose-600 text-white",
  },
  amber: {
    stripe: "border-s-amber-500",
    chip: "bg-amber-100 text-amber-700 ring-amber-200/70 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/20",
    dot: "bg-amber-500",
    card: "border-amber-300 bg-amber-50 ring-2 ring-amber-200 dark:border-amber-500/40 dark:bg-amber-500/10 dark:ring-amber-500/20",
    count: "bg-amber-500 text-white",
  },
  sky: {
    stripe: "border-s-sky-500",
    chip: "bg-sky-100 text-sky-700 ring-sky-200/70 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-500/20",
    dot: "bg-sky-500",
    card: "border-sky-300 bg-sky-50 ring-2 ring-sky-200 dark:border-sky-500/40 dark:bg-sky-500/10 dark:ring-sky-500/20",
    count: "bg-sky-600 text-white",
  },
  emerald: {
    stripe: "border-s-emerald-500",
    chip: "bg-emerald-100 text-emerald-700 ring-emerald-200/70 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/20",
    dot: "bg-emerald-500",
    card: "border-emerald-300 bg-emerald-50 ring-2 ring-emerald-200 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:ring-emerald-500/20",
    count: "bg-emerald-600 text-white",
  },
  slate: {
    stripe: "border-s-slate-400",
    chip: "bg-slate-100 text-slate-700 ring-slate-200/70 dark:bg-slate-500/15 dark:text-slate-300 dark:ring-slate-500/20",
    dot: "bg-slate-400",
    card: "border-slate-300 bg-slate-50 ring-2 ring-slate-200 dark:border-slate-500/40 dark:bg-slate-500/10 dark:ring-slate-500/20",
    count: "bg-slate-600 text-white",
  },
};

const STATUS_CHIP: Record<CancellationStatus, string> = {
  PENDING: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  APPROVED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  REJECTED: "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300",
};

/** Where each subscription alert is chased from. */
const SUBSCRIPTION_ALERT_VIEW: Record<string, string> = {
  SUBSCRIPTION_FINISHED: "finished",
  SUBSCRIPTION_UNPAID: "due",
  LESSON_OUTSIDE_SUBSCRIPTION: "outside",
};

export function NotificationsScreen() {
  const t = useTranslations("notifications");
  const locale = useLocale();
  const { can } = useAuth();
  // A centre's money alerts are its subscriptions' (docs/centre-profile/01): read from their own
  // category, and the package ones give way to them.
  const centre = useCapability("centre");
  // Overdue LESSON reports exist only for an academy that asks its teachers for one; a centre with
  // progress reports off and the structured report never opted into has none
  // (FlagOverdueReportsJob::wantsLessonReports).
  const hasStructuredReport = useCapability("lesson_report");
  const hasProgressReports = useCapability("student_reports");
  const hasLessonReports = hasStructuredReport || hasProgressReports || !centre;

  const [section, setSection] = useState<Section | null>(null);
  const [requests, setRequests] = useState<CancellationRequestRow[]>([]);
  const [alerts, setAlerts] = useState<NotificationRow[]>([]);
  const [attended, setAttended] = useState<NotificationRow[]>([]);
  const [cancelledGroupLessons, setCancelledGroupLessons] = useState<NotificationRow[]>([]);
  const [attendedUnread, setAttendedUnread] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fmt = useCallback(
    (iso: string) =>
      new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: academyTimeZone(),
      }).format(new Date(iso)),
    [locale],
  );

  const load = useCallback(async () => {
    setError(null);
    try {
      const [{ requests: reqs }, { notifications: feed }, { notifications: log }, { notifications: cancelled }, summary, subs] = await Promise.all([
        listCancellationRequests(),
        listNotifications(),
        listNotifications("ATTENDED"),
        listNotifications("CLASSES"),
        getNotificationsSummary(),
        centre ? listNotifications("SUBSCRIPTIONS") : Promise.resolve({ notifications: [] as NotificationRow[] }),
      ]);
      setRequests(reqs);
      setAlerts([...feed, ...subs.notifications]);
      setAttended(log);
      setCancelledGroupLessons(cancelled);
      setAttendedUnread(summary.attended ?? 0);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [centre]);

  useEffect(() => {
    void load();
  }, [load]);

  // The alerts this academy reads here: a centre's money is its subscriptions', anyone else's its
  // packages'; no report alerts where no report is asked for.
  const visible = useMemo(
    () =>
      alerts.filter((n) => {
        if (n.category === "PACKAGES" && centre) return false;
        if (n.category === "SUBSCRIPTIONS" && !centre) return false;
        if (n.type === "REPORT_OVERDUE" && !hasLessonReports) return false;
        return ACTION_TYPES.has(n.type) || FOLLOW_TYPES.has(n.type);
      }),
    [alerts, centre, hasLessonReports],
  );
  const actionAlerts = visible.filter((n) => ACTION_TYPES.has(n.type));
  const followAlerts = visible.filter((n) => FOLLOW_TYPES.has(n.type));
  const pending = requests.filter((r) => r.status === "PENDING");
  const decided = requests.filter((r) => r.status !== "PENDING");

  const counts: Record<Section, number> = {
    action: pending.length + actionAlerts.filter((n) => n.read_at === null).length,
    follow: followAlerts.filter((n) => n.read_at === null).length,
    log: attendedUnread,
  };
  // Opens on whatever is waiting: a decision first, then a follow-up, else the decisions (calm).
  const current: Section = section ?? (counts.action > 0 ? "action" : counts.follow > 0 ? "follow" : "action");

  if (!can("notification.read")) {
    return <p className="text-muted-foreground text-sm">{t("noPermission")}</p>;
  }

  const SECTIONS: { key: Section; Icon: LucideIcon; tone: Tone }[] = [
    { key: "action", Icon: BellRing, tone: "rose" },
    { key: "follow", Icon: Hourglass, tone: "amber" },
    { key: "log", Icon: ScrollText, tone: "slate" },
  ];

  return (
    <div className="w-full space-y-5">
      <PageHero
        latticeId="notifications-hero-lattice"
        icon={BellRing}
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <Button
            type="button"
            size="lg"
            onClick={() => void load()}
            className="gap-2 border-white/25 bg-white/15 text-white backdrop-blur-sm hover:bg-white/25"
            data-testid="refresh"
          >
            <RefreshCw className="size-4" aria-hidden />
            {t("actions.refresh")}
          </Button>
        }
      />

      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}

      {/* ── The three sections, as coloured cards with what is waiting in each ── */}
      <div role="tablist" className="grid grid-cols-3 gap-2 sm:gap-3">
        {SECTIONS.map(({ key, Icon, tone }) => {
          const active = current === key;
          const count = counts[key];
          return (
            <button
              key={key}
              role="tab"
              type="button"
              aria-selected={active}
              data-testid={`tab-${key}`}
              onClick={() => setSection(key)}
              className={cn(
                "bg-card flex min-w-0 flex-col items-start gap-2 rounded-2xl border p-3 text-start shadow-sm transition-all sm:flex-row sm:items-center sm:gap-3 sm:p-4",
                active ? TONE[tone].card : "hover:bg-muted/50",
              )}
            >
              <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl ring-1 sm:size-11", TONE[tone].chip)}>
                <Icon className="size-4 sm:size-5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-bold sm:text-base">{t(`sections.${key}`)}</span>
                  {count > 0 && (
                    <span
                      className={cn(
                        "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold tabular-nums",
                        key === "log" ? "bg-muted text-muted-foreground" : TONE[tone].count,
                      )}
                      data-testid={`count-${key}`}
                    >
                      {formatNumber(count, locale)}
                    </span>
                  )}
                </span>
                <span className="text-muted-foreground mt-0.5 hidden text-xs sm:block">{t(`sections.${key}Hint`)}</span>
              </span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <p className="text-muted-foreground text-sm">{t("loading")}</p>
      ) : current === "action" ? (
        <ActionSection pending={pending} alerts={actionAlerts} fmt={fmt} onChanged={load} onError={setError} />
      ) : current === "follow" ? (
        <FollowSection alerts={followAlerts} fmt={fmt} onChanged={load} onError={setError} />
      ) : (
        <LogSection
          attended={attended}
          cancelledGroupLessons={cancelledGroupLessons}
          decided={decided}
          fmt={fmt}
          onChanged={load}
          onError={setError}
        />
      )}
    </div>
  );
}

// ── Shared pieces ─────────────────────────────────────────────────────────────

function useMarkers(onChanged: () => Promise<void>, onError: (msg: string) => void) {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return {
    busy,
    markOne: (id: string) => run(() => markNotificationRead(id)),
    markMany: (ids: string[]) => run(() => markNotificationsRead(ids)),
    // A section's "mark all read" goes by type, so alerts past the loaded 200 are cleared too.
    markTypes: (types: Set<NotificationType>) => run(() => markNotificationTypesRead([...types])),
  };
}

/** A sub-heading inside a section: a coloured dot, the title, how many. */
function GroupHeading({ tone, title, count, end }: { tone: Tone; title: string; count?: number; end?: ReactNode }) {
  const locale = useLocale();
  return (
    <div className="flex items-center justify-between gap-3 px-1">
      <h3 className="flex items-center gap-2 text-sm font-bold">
        <span className={cn("size-2 rounded-full", TONE[tone].dot)} aria-hidden />
        {title}
        {count !== undefined && <span className="text-muted-foreground font-semibold tabular-nums">({formatNumber(count, locale)})</span>}
      </h3>
      {end}
    </div>
  );
}

/** One alert: a coloured edge for how pressing it is, what happened, when, and the one thing to do. */
function AlertRow({
  tone,
  Icon,
  title,
  body,
  when,
  href,
  linkLabel,
  unread,
  onRead,
  testId,
}: {
  tone: Tone;
  Icon: LucideIcon;
  title: string;
  body?: string;
  when: string;
  href?: string;
  linkLabel?: string;
  unread: boolean;
  onRead?: () => void;
  testId?: string;
}) {
  const t = useTranslations("notifications");
  return (
    <li
      data-testid={testId}
      data-unread={unread}
      className={cn("bg-card flex items-start gap-3 rounded-xl border border-s-4 p-3.5 shadow-sm", TONE[tone].stripe, !unread && "opacity-75")}
    >
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg ring-1", TONE[tone].chip)}>
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug font-semibold">{title}</p>
        {body && <p className="text-muted-foreground mt-0.5 text-sm leading-snug">{body}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="text-muted-foreground text-xs">{when}</span>
          {href && linkLabel && (
            <Link
              href={href}
              className="bg-primary/10 text-primary hover:bg-primary/15 inline-flex h-7 items-center rounded-lg px-2.5 text-xs font-semibold transition-colors"
            >
              {linkLabel}
            </Link>
          )}
        </div>
      </div>
      {unread && onRead && (
        <Button type="button" variant="ghost" size="icon-xs" onClick={onRead} aria-label={t("actions.markRead")} title={t("actions.markRead")} className="shrink-0">
          <Check className="size-3.5" />
        </Button>
      )}
    </li>
  );
}

/** Read alerts, folded away so the section shows what is new. */
function SeenFold({ count, children }: { count: number; children: ReactNode }) {
  const t = useTranslations("notifications");
  const [open, setOpen] = useState(false);
  if (count === 0) return null;
  return (
    <div className="space-y-2" data-testid="seen-fold">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 px-1 text-xs font-semibold transition-colors"
      >
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} aria-hidden />
        {t("groups.seen", { count })}
      </button>
      {open && <ul className="space-y-2">{children}</ul>}
    </div>
  );
}

function CalmState({ message }: { message: string }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-emerald-300 bg-emerald-50/60 py-14 text-center dark:border-emerald-500/30 dark:bg-emerald-500/5"
      data-testid="empty-state"
    >
      <CircleCheckBig className="size-9 text-emerald-600 dark:text-emerald-400" aria-hidden />
      <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">{message}</p>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-muted-foreground flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed py-14 text-center" data-testid="empty-state">
      <Inbox className="size-8 opacity-40" aria-hidden />
      <p className="text-sm">{message}</p>
    </div>
  );
}

/** The words, the colour and the one action for a package or subscription alert. */
function useAlertText() {
  const t = useTranslations("notifications");
  const ts = useTranslations("subscriptions.alerts");
  const locale = useLocale();
  return (n: NotificationRow): { title: string; body: string; href: string; linkLabel: string; Icon: LucideIcon } => {
    const student = n.data.student_name ?? "—";
    const amount =
      n.data.outstanding_minor !== undefined ? formatMoney({ amount: n.data.outstanding_minor, currency: n.data.currency ?? "EGP" }, locale) : "—";
    if (n.category === "SUBSCRIPTIONS") {
      return {
        title: ts(`${n.type}.title`, { student }),
        body: ts(`${n.type}.body`, { label: n.data.label ?? "—", sold: n.data.lessons_sold ?? 0, count: n.data.outside_count ?? 0, amount }),
        href: `/subscriptions?view=${SUBSCRIPTION_ALERT_VIEW[n.type] ?? "open"}`,
        linkLabel: n.type === "SUBSCRIPTION_UNPAID" ? t("package.collect") : ts("open"),
        Icon: n.type === "SUBSCRIPTION_UNPAID" ? Wallet : Layers,
      };
    }
    return {
      title: t(n.type === "PACKAGE_LOW" && n.data.lesson_minutes ? "package.PACKAGE_LOW.titleLessons" : `package.${n.type}.title`, { student }),
      body: t(`package.${n.type}.body`, {
        label: n.data.label ?? "—",
        left: n.data.lesson_minutes
          ? t("package.lessonsLeft", { count: Math.floor((n.data.minutes_left ?? 0) / n.data.lesson_minutes) })
          : formatHours(n.data.minutes_left ?? 0, locale),
        over: formatHours(n.data.minutes_overdrawn ?? 0, locale),
        amount,
      }),
      // Running low and out of a package are about who is studying (Open packages); money and a
      // finished package's bill are on Due.
      href: n.type === "PACKAGE_LOW" || n.type === "NO_ACTIVE_PACKAGE" ? "/packages" : "/packages/due",
      linkLabel:
        n.type === "PACKAGE_UNPAID"
          ? t("package.collect")
          : n.type === "NO_ACTIVE_PACKAGE"
            ? t("package.openPackage")
            : n.type === "PACKAGE_COMPLETED"
              ? t("package.renew")
              : t("package.open"),
      Icon: n.type === "PACKAGE_UNPAID" ? Wallet : Layers,
    };
  };
}

// ── Needs your decision ───────────────────────────────────────────────────────

function ActionSection({
  pending,
  alerts,
  fmt,
  onChanged,
  onError,
}: {
  pending: CancellationRequestRow[];
  alerts: NotificationRow[];
  fmt: (iso: string) => string;
  onChanged: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const t = useTranslations("notifications");
  const locale = useLocale();
  const text = useAlertText();
  const { busy, markOne, markTypes } = useMarkers(onChanged, onError);

  const unread = alerts.filter((n) => n.read_at === null);
  const seen = alerts.filter((n) => n.read_at !== null);
  const money = unread.filter((n) => MONEY_TYPES.has(n.type));
  const noPackage = unread.filter((n) => !MONEY_TYPES.has(n.type));

  if (pending.length === 0 && alerts.length === 0) return <CalmState message={t("calm.action")} />;

  const row = (n: NotificationRow) => {
    const x = text(n);
    const isMoney = MONEY_TYPES.has(n.type);
    return (
      <AlertRow
        key={n.id}
        tone={isMoney ? "rose" : "amber"}
        Icon={x.Icon}
        title={x.title}
        body={x.body}
        when={formatRelativeTime(n.created_at, locale)}
        href={x.href}
        linkLabel={x.linkLabel}
        unread={n.read_at === null}
        onRead={() => void markOne(n.id)}
        testId={n.category === "SUBSCRIPTIONS" ? "subscription-alert" : "package-alert"}
      />
    );
  };

  return (
    <div className="space-y-6" data-testid="section-action">
      {pending.length === 0 && unread.length === 0 && <CalmState message={t("calm.action")} />}

      {pending.length > 0 && (
        <section className="space-y-2.5">
          <GroupHeading tone="rose" title={t("groups.requests")} count={pending.length} />
          <ul className="space-y-3" data-testid="classes-list">
            {pending.map((r) => (
              <RequestCard key={r.id} request={r} fmt={fmt} onChanged={onChanged} onError={onError} />
            ))}
          </ul>
        </section>
      )}

      {unread.length > 0 && (
        <div className="flex justify-end">
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void markTypes(ACTION_TYPES)} className="gap-1.5" data-testid="mark-all-read">
            <CheckCheck className="size-3.5" />
            {t("actions.markAllRead")}
          </Button>
        </div>
      )}

      {money.length > 0 && (
        <section className="space-y-2.5">
          <GroupHeading tone="rose" title={t("groups.money")} count={money.length} />
          <ul className="space-y-2" data-testid="money-list">
            {money.map(row)}
          </ul>
        </section>
      )}

      {noPackage.length > 0 && (
        <section className="space-y-2.5">
          <GroupHeading tone="amber" title={t("groups.noPackage")} count={noPackage.length} />
          <ul className="space-y-2" data-testid="no-package-list">
            {noPackage.map(row)}
          </ul>
        </section>
      )}

      <SeenFold count={seen.length}>{seen.map(row)}</SeenFold>
    </div>
  );
}

function RequestCard({
  request: r,
  fmt,
  onChanged,
  onError,
}: {
  request: CancellationRequestRow;
  fmt: (iso: string) => string;
  onChanged: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const t = useTranslations("notifications");
  const locale = useLocale();
  const { can } = useAuth();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  // Approving opens the billing decision popup; rejecting is immediate.
  const [billingOpen, setBillingOpen] = useState(false);

  const isFree = r.request_type === "FREE";
  // The approver capability differs by request type (the owner holds both).
  const isOwner = can(isFree ? "session.free_approve" : "session.cancel_approve");

  async function reject() {
    setBusy(true);
    try {
      await rejectCancellation(r.id, note || undefined);
      await onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirmApprove(values: CancellationBillingValues) {
    setBusy(true);
    try {
      await approveCancellation(r.id, {
        note: note || undefined,
        charge_student: values.charge_student,
        pay_teacher: values.pay_teacher,
        teacher_pay_percent: values.pay_teacher ? values.teacher_pay_percent : undefined,
        reason: values.reason || undefined,
      });
      setBillingOpen(false);
      await onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li
      className={cn("bg-card space-y-3 rounded-xl border border-s-4 p-4 shadow-sm", isFree ? "border-s-teal-500" : "border-s-rose-500")}
      data-testid="request-card"
      data-status={r.status}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-xl ring-1",
            isFree ? "bg-teal-100 text-teal-700 ring-teal-200/70 dark:bg-teal-500/15 dark:text-teal-300" : TONE.rose.chip,
          )}
        >
          {isFree ? <Gift className="size-5" aria-hidden /> : <Ban className="size-5" aria-hidden />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="leading-tight font-semibold">
            {isFree
              ? t("freeType", { teacher: r.teacher_name ?? "—", student: r.student_name ?? "—" })
              : t(`cancelType.${r.cancel_type}`, { student: r.student_name ?? "—" })}
          </p>
          <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="inline-flex items-center gap-1.5">
              <CalendarClock className="size-3.5" aria-hidden />
              {fmt(r.scheduled_at_utc)}
            </span>
            {r.teacher_name && (
              <span className="inline-flex items-center gap-1.5">
                <GraduationCap className="size-3.5" aria-hidden />
                {r.teacher_name}
              </span>
            )}
            <span>{t("requestedWhen", { when: formatRelativeTime(r.created_at, locale) })}</span>
          </div>
        </div>
      </div>

      {r.reason && (
        <p className="text-muted-foreground bg-muted/40 rounded-xl px-3 py-2 text-sm">
          <span className="font-medium">{t("reasonLabel")}: </span>
          {r.reason}
        </p>
      )}

      {isOwner ? (
        <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-center">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("notePlaceholder")}
            aria-label={t("notePlaceholder")}
            className="border-input bg-background focus:border-primary focus:ring-primary/15 min-w-0 flex-1 rounded-xl border px-3.5 py-2 text-sm transition-colors outline-none focus:ring-3"
          />
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={busy} onClick={() => setBillingOpen(true)} data-testid="approve" className="flex-1 gap-1.5 sm:flex-none">
              <Check className="size-3.5" />
              {t("actions.approve")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void reject()}
              data-testid="reject"
              className="border-destructive/30 text-destructive hover:bg-destructive/10 flex-1 gap-1.5 sm:flex-none"
            >
              <X className="size-3.5" />
              {t("actions.reject")}
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground border-t pt-3 text-xs">{t("teacherPendingHint")}</p>
      )}

      {/* Approval → billing decision (charge student / pay teacher + reason for the parent). */}
      <CancellationBillingModal
        variant={isFree ? "free" : "cancel"}
        open={billingOpen}
        onClose={() => setBillingOpen(false)}
        cancelType={r.cancel_type ?? "teacher"}
        defaultReason={r.reason ?? ""}
        busy={busy}
        onConfirm={confirmApprove}
      />
    </li>
  );
}

// ── To follow up ──────────────────────────────────────────────────────────────

function FollowSection({
  alerts,
  fmt,
  onChanged,
  onError,
}: {
  alerts: NotificationRow[];
  fmt: (iso: string) => string;
  onChanged: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const t = useTranslations("notifications");
  const locale = useLocale();
  const text = useAlertText();
  const { busy, markOne, markMany, markTypes } = useMarkers(onChanged, onError);

  if (alerts.length === 0) return <CalmState message={t("calm.follow")} />;

  const unread = alerts.filter((n) => n.read_at === null);
  const seen = alerts.filter((n) => n.read_at !== null);
  const reports = unread.filter((n) => n.type === "REPORT_OVERDUE");
  const low = unread.filter((n) => LOW_TYPES.has(n.type));
  const finished = unread.filter((n) => n.type === "PACKAGE_COMPLETED" || n.type === "SUBSCRIPTION_FINISHED");

  // Overdue reports, one group per teacher: "Ali — 5 reports late" rather than five rows.
  const byTeacher = new Map<string, NotificationRow[]>();
  for (const n of reports) {
    const key = n.data.teacher_id ?? n.data.teacher_name ?? "—";
    byTeacher.set(key, [...(byTeacher.get(key) ?? []), n]);
  }
  const teacherGroups = [...byTeacher.values()].sort((a, b) => b.length - a.length);

  const packageRow = (n: NotificationRow) => {
    const x = text(n);
    return (
      <AlertRow
        key={n.id}
        tone={LOW_TYPES.has(n.type) ? "amber" : "sky"}
        Icon={n.type === "PACKAGE_LOW" ? Hourglass : x.Icon}
        title={x.title}
        body={x.body}
        when={formatRelativeTime(n.created_at, locale)}
        href={x.href}
        linkLabel={x.linkLabel}
        unread={n.read_at === null}
        onRead={() => void markOne(n.id)}
        testId={n.category === "SUBSCRIPTIONS" ? "subscription-alert" : "package-alert"}
      />
    );
  };
  const seenRow = (n: NotificationRow) =>
    n.type === "REPORT_OVERDUE" ? (
      <AlertRow
        key={n.id}
        tone="amber"
        Icon={ClipboardX}
        title={t("report.overdueTitle", { teacher: n.data.teacher_name ?? "—" })}
        body={t("report.body", { student: n.data.student_name ?? "—", when: n.data.scheduled_at_utc ? fmt(n.data.scheduled_at_utc) : "—" })}
        when={formatRelativeTime(n.created_at, locale)}
        href={n.session_id ? `/sessions/${n.session_id}` : undefined}
        linkLabel={t("reportsGroup.openLesson")}
        unread={false}
        testId="report-card"
      />
    ) : (
      packageRow(n)
    );

  return (
    <div className="space-y-6" data-testid="section-follow">
      {unread.length === 0 && <CalmState message={t("calm.follow")} />}

      {unread.length > 0 && (
        <div className="flex justify-end">
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void markTypes(FOLLOW_TYPES)} className="gap-1.5" data-testid="mark-all-read">
            <CheckCheck className="size-3.5" />
            {t("actions.markAllRead")}
          </Button>
        </div>
      )}

      {teacherGroups.length > 0 && (
        <section className="space-y-2.5">
          <GroupHeading tone="amber" title={t("groups.reports")} count={reports.length} />
          <ul className="space-y-2" data-testid="reports-list">
            {teacherGroups.map((rows) => (
              <TeacherReports key={rows[0]!.id} rows={rows} fmt={fmt} busy={busy} onRead={(ids) => void markMany(ids)} />
            ))}
          </ul>
        </section>
      )}

      {low.length > 0 && (
        <section className="space-y-2.5">
          <GroupHeading tone="amber" title={t("groups.low")} count={low.length} />
          <ul className="space-y-2" data-testid="packages-list">
            {low.map(packageRow)}
          </ul>
        </section>
      )}

      {finished.length > 0 && (
        <section className="space-y-2.5">
          <GroupHeading tone="sky" title={t("groups.finished")} count={finished.length} />
          <ul className="space-y-2" data-testid="finished-list">
            {finished.map(packageRow)}
          </ul>
        </section>
      )}

      <SeenFold count={seen.length}>{seen.map(seenRow)}</SeenFold>
    </div>
  );
}

/** One teacher's overdue reports: a single row with the count, the lessons behind it on demand. */
function TeacherReports({
  rows,
  fmt,
  busy,
  onRead,
}: {
  rows: NotificationRow[];
  fmt: (iso: string) => string;
  busy: boolean;
  onRead: (ids: string[]) => void;
}) {
  const t = useTranslations("notifications");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const teacher = rows[0]!.data.teacher_name ?? "—";
  const oldest = rows.reduce((min, n) => {
    const at = n.data.scheduled_at_utc ?? n.created_at;
    return at < min ? at : min;
  }, rows[0]!.data.scheduled_at_utc ?? rows[0]!.created_at);

  return (
    <li className={cn("bg-card rounded-xl border border-s-4 shadow-sm", TONE.amber.stripe)} data-testid="report-group">
      <div className="flex items-start gap-3 p-3.5">
        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg ring-1", TONE.amber.chip)}>
          <ClipboardX className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug font-semibold">
            {teacher}
            <span className="ms-2 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
              {t("reportsGroup.count", { count: rows.length })}
            </span>
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="text-muted-foreground text-xs">{t("reportsGroup.oldest", { when: formatRelativeTime(oldest, locale) })}</span>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="text-primary inline-flex items-center gap-1 text-xs font-semibold hover:underline"
              data-testid="report-group-toggle"
            >
              {open ? t("reportsGroup.hide") : t("reportsGroup.show")}
              <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} aria-hidden />
            </button>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={busy}
          onClick={() => onRead(rows.map((n) => n.id))}
          aria-label={t("actions.markRead")}
          title={t("actions.markRead")}
          className="shrink-0"
        >
          <Check className="size-3.5" />
        </Button>
      </div>
      {open && (
        <ul className="divide-y border-t">
          {rows.map((n) => (
            <li key={n.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5 text-sm" data-testid="report-card">
              <span className="min-w-0">
                <span className="font-medium">{n.data.student_name ?? "—"}</span>
                <span className="text-muted-foreground ms-2 text-xs tabular-nums">{n.data.scheduled_at_utc ? fmt(n.data.scheduled_at_utc) : "—"}</span>
              </span>
              {n.session_id && (
                <Link href={`/sessions/${n.session_id}`} className="text-primary text-xs font-semibold hover:underline">
                  {t("reportsGroup.openLesson")}
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

// ── Log ───────────────────────────────────────────────────────────────────────

function LogSection({
  attended,
  cancelledGroupLessons,
  decided,
  fmt,
  onChanged,
  onError,
}: {
  attended: NotificationRow[];
  cancelledGroupLessons: NotificationRow[];
  decided: CancellationRequestRow[];
  fmt: (iso: string) => string;
  onChanged: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const t = useTranslations("notifications");
  const locale = useLocale();
  const views: { key: LogView; Icon: LucideIcon; count: number }[] = [
    { key: "attended", Icon: CalendarCheck, count: attended.length },
    ...(cancelledGroupLessons.length > 0 ? [{ key: "cancelled" as const, Icon: Ban, count: cancelledGroupLessons.length }] : []),
    ...(decided.length > 0 ? [{ key: "decided" as const, Icon: CheckCheck, count: decided.length }] : []),
  ];
  const [view, setView] = useState<LogView>("attended");
  const shown = views.some((v) => v.key === view) ? view : "attended";

  return (
    <div className="space-y-4" data-testid="section-log">
      {views.length > 1 && (
        <div className="flex flex-wrap gap-2" role="tablist">
          {views.map(({ key, Icon, count }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={shown === key}
              onClick={() => setView(key)}
              data-testid={`log-${key}`}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                shown === key ? "border-primary/30 bg-primary/10 text-primary" : "bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" aria-hidden />
              {t(`log.${key}`)}
              <span className="tabular-nums opacity-70">{formatNumber(count, locale)}</span>
            </button>
          ))}
        </div>
      )}

      {shown === "attended" ? (
        <AttendedLog notifications={attended} onChanged={onChanged} onError={onError} />
      ) : shown === "cancelled" ? (
        <ul className="bg-card divide-y rounded-2xl border" data-testid="group-cancelled-list">
          {cancelledGroupLessons.map((n) => (
            <li key={n.id} data-testid="group-cancelled-row" className="flex items-center gap-3 px-4 py-3">
              <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl ring-1", TONE.slate.chip)}>
                <Ban className="size-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-tight font-semibold">
                  {t("groupCancelled.title", { group: n.data.group_name ?? "—", teacher: n.data.teacher_name ?? "—" })}
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs tabular-nums">
                  {n.data.scheduled_at_utc ? fmt(n.data.scheduled_at_utc) : "—"}
                  {n.data.reason ? ` · ${n.data.reason}` : ""}
                  {n.data.marked_by_name ? ` · ${t("groupCancelled.by", { name: n.data.marked_by_name })}` : ""}
                </p>
                {n.data.group_id && (
                  <Link href={`/groups/${n.data.group_id}`} className="text-primary mt-1 inline-block text-xs font-semibold hover:underline">
                    {t("groupCancelled.open")}
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="bg-card divide-y rounded-2xl border" data-testid="decided-list">
          {decided.map((r) => {
            const what =
              r.request_type === "FREE"
                ? t("freeType", { teacher: r.teacher_name ?? "—", student: r.student_name ?? "—" })
                : t(`cancelType.${r.cancel_type}`, { student: r.student_name ?? "—" });
            return (
              <li key={r.id} data-testid="decided-row" data-status={r.status} className="flex items-start gap-3 px-4 py-3">
                <span className={cn("mt-0.5 shrink-0 rounded-full px-2.5 py-0.5 text-[0.7rem] font-semibold", STATUS_CHIP[r.status])}>{t(`status.${r.status}`)}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-snug font-semibold">{what}</p>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {fmt(r.scheduled_at_utc)}
                    {r.decided_by_name ? ` · ${t("decided.by", { name: r.decided_by_name })}` : ""}
                    {r.decision_note ? ` · ${r.decision_note}` : ""}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Every lesson marked attended, newest first, grouped by the day it was taught. A log, not a to-do:
 * no warning colour, its count stays off the sidebar bell, and "mark all read" here clears only it.
 */
function AttendedLog({
  notifications,
  onChanged,
  onError,
}: {
  notifications: NotificationRow[];
  onChanged: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const t = useTranslations("notifications");
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const hasUnread = notifications.some((n) => n.read_at === null);

  const dayFmt = new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en", { weekday: "long", day: "numeric", month: "long", timeZone: academyTimeZone() });
  const timeFmt = new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en", { timeStyle: "short", timeZone: academyTimeZone() });

  const groups: { day: string; rows: NotificationRow[] }[] = [];
  for (const n of notifications) {
    const day = dayFmt.format(new Date(n.data.scheduled_at_utc ?? n.created_at));
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.rows.push(n);
    else groups.push({ day, rows: [n] });
  }

  async function markRead(id: string) {
    try {
      await markNotificationRead(id);
      await onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : String(err));
    }
  }

  async function markAll() {
    setBusy(true);
    try {
      await markAllNotificationsRead("ATTENDED");
      await onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (notifications.length === 0) return <EmptyState message={t("empty.attended")} />;

  return (
    <div className="space-y-4">
      {hasUnread && (
        <div className="flex justify-end">
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void markAll()} data-testid="mark-all-attended-read" className="gap-1.5">
            <CheckCheck className="size-3.5" />
            {t("actions.markAllRead")}
          </Button>
        </div>
      )}
      {groups.map((g) => (
        <section key={g.day} className="space-y-2">
          <h3 className="text-muted-foreground flex items-center gap-2 px-1 text-xs font-semibold">
            {g.day}
            <span className="tabular-nums opacity-70">· {t("attended.dayCount", { count: g.rows.length })}</span>
          </h3>
          <ul className="bg-card divide-y rounded-2xl border" data-testid="attended-list">
            {g.rows.map((n) => {
              const unread = n.read_at === null;
              const byStaff = n.data.marked_by_role !== undefined && n.data.marked_by_role !== "TEACHER";
              const groupSheet = n.type === "GROUP_LESSON_ATTENDED";
              return (
                <li key={n.id} data-testid="attended-row" data-unread={unread} className={cn("flex items-center gap-3 px-4 py-2.5", unread && "bg-primary/[0.03]")}>
                  <span className={cn("size-2 shrink-0 rounded-full", unread ? TONE.emerald.dot : "bg-muted-foreground/30")} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-tight">
                      <span className="font-semibold">
                        {groupSheet
                          ? t("attended.groupTitle", { group: n.data.group_name ?? "—", present: n.data.present ?? 0, expected: n.data.expected ?? 0 })
                          : t("attended.title", { teacher: n.data.teacher_name ?? "—", student: n.data.student_name ?? "—" })}
                      </span>
                    </p>
                    <p className="text-muted-foreground mt-0.5 text-xs tabular-nums">
                      {n.data.scheduled_at_utc ? timeFmt.format(new Date(n.data.scheduled_at_utc)) : "—"}
                      {n.data.duration_minutes ? ` · ${formatHours(n.data.duration_minutes, locale)}` : ""}
                      {byStaff && n.data.marked_by_name ? ` · ${t("attended.markedBy", { name: n.data.marked_by_name })}` : ""}
                    </p>
                  </div>
                  {n.session_id && (
                    <Link href={`/sessions/${n.session_id}`} className="text-primary shrink-0 text-xs font-semibold hover:underline">
                      {t("attended.open")}
                    </Link>
                  )}
                  {groupSheet && n.data.group_id && (
                    <Link href={`/groups/${n.data.group_id}`} className="text-primary shrink-0 text-xs font-semibold hover:underline">
                      {t("attended.openGroup")}
                    </Link>
                  )}
                  {unread && (
                    <Button type="button" variant="ghost" size="icon-xs" onClick={() => void markRead(n.id)} aria-label={t("actions.markRead")} className="shrink-0">
                      <Check className="size-3.5" />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
