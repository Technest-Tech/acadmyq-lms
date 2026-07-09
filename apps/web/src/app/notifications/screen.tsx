"use client";

import {
  Ban,
  BellRing,
  CalendarClock,
  Check,
  CheckCheck,
  ClipboardX,
  Gift,
  GraduationCap,
  Inbox,
  RefreshCw,
  X,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState, type ComponentType } from "react";
import {
  CancellationBillingModal,
  type CancellationBillingValues,
} from "@/components/attendance/cancellation-billing-modal";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { AlertBanner } from "@/components/ui/alert";
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
  type NotificationRow,
  rejectCancellation,
} from "@/lib/api";
import { cn } from "@/lib/utils";

type TabKey = "classes" | "reports";

const STATUS_CHIP: Record<CancellationStatus, string> = {
  PENDING:
    "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  APPROVED:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  REJECTED:
    "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300",
};

export function NotificationsScreen() {
  const t = useTranslations("notifications");
  const locale = useLocale();
  const { can } = useAuth();

  const [tab, setTab] = useState<TabKey>("classes");
  const [requests, setRequests] = useState<CancellationRequestRow[]>([]);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [counts, setCounts] = useState({ classes: 0, reports: 0 });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fmt = useCallback(
    (iso: string) =>
      new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(iso)),
    [locale],
  );

  const load = useCallback(async () => {
    setError(null);
    try {
      const [{ requests: reqs }, { notifications: notifs }, summary] =
        await Promise.all([
          listCancellationRequests(),
          listNotifications(),
          getNotificationsSummary(),
        ]);
      setRequests(reqs);
      setNotifications(notifs);
      setCounts({
        classes: summary.classes,
        reports: summary.reports,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!can("notification.read")) {
    return (
      <p className="text-muted-foreground text-sm">{t("noPermission")}</p>
    );
  }

  const TABS: { key: TabKey; icon: ComponentType<{ className?: string }>; count: number }[] = [
    { key: "classes", icon: Ban, count: counts.classes },
    { key: "reports", icon: ClipboardX, count: counts.reports },
  ];

  return (
    <div className="w-full space-y-6">
      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="bg-primary/10 ring-primary/15 flex size-10 shrink-0 items-center justify-center rounded-xl ring-1">
            <BellRing className="text-primary size-5" aria-hidden />
          </div>
          <div>
            <h1 className="text-xl font-semibold leading-tight">{t("title")}</h1>
            <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void load()}
          className="gap-1.5"
          data-testid="refresh"
        >
          <RefreshCw className="size-3.5" />
          {t("actions.refresh")}
        </Button>
      </div>

      {error && (
        <AlertBanner
          variant="error"
          message={error}
          onDismiss={() => setError(null)}
        />
      )}

      {/* ── Tabs ─────────────────────────────────────────────────────── */}
      <div
        role="tablist"
        className="bg-muted/40 flex gap-1 rounded-2xl border p-1.5"
      >
        {TABS.map(({ key, icon: Icon, count }) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={tab === key}
            data-testid={`tab-${key}`}
            onClick={() => setTab(key)}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors",
              tab === key
                ? "bg-card shadow-sm ring-1 ring-black/5"
                : "hover:bg-card/50 text-muted-foreground",
            )}
          >
            <Icon className="size-4" />
            <span>{t(`tabs.${key}`)}</span>
            {count > 0 && (
              <span className="bg-primary text-primary-foreground ms-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums">
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-muted-foreground text-sm">{t("loading")}</p>
      ) : tab === "classes" ? (
        <ClassesTab
          requests={requests}
          fmt={fmt}
          onChanged={load}
          onError={setError}
        />
      ) : (
        <ReportsTab
          notifications={notifications}
          fmt={fmt}
          onChanged={load}
          onError={setError}
        />
      )}
    </div>
  );
}

// ── Classes (cancellation approvals) ──────────────────────────────────────────

function ClassesTab({
  requests,
  fmt,
  onChanged,
  onError,
}: {
  requests: CancellationRequestRow[];
  fmt: (iso: string) => string;
  onChanged: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const t = useTranslations("notifications");

  if (requests.length === 0) {
    return <EmptyState message={t("empty.classes")} />;
  }

  return (
    <ul className="space-y-3" data-testid="classes-list">
      {requests.map((r) => (
        <RequestCard
          key={r.id}
          request={r}
          fmt={fmt}
          onChanged={onChanged}
          onError={onError}
        />
      ))}
    </ul>
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

  const pending = r.status === "PENDING";

  return (
    <li
      className="bg-card space-y-3 rounded-2xl border p-4"
      data-testid="request-card"
      data-status={r.status}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {isFree ? (
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-teal-100 ring-1 ring-teal-200/60 dark:bg-teal-950/40">
              <Gift
                className="size-5 text-teal-600 dark:text-teal-400"
                aria-hidden
              />
            </div>
          ) : (
            <div className="bg-destructive/10 ring-destructive/15 flex size-10 shrink-0 items-center justify-center rounded-xl ring-1">
              <Ban className="text-destructive/80 size-5" aria-hidden />
            </div>
          )}
          <div className="min-w-0">
            <p className="font-semibold leading-tight">
              {isFree
                ? t("freeType", {
                    teacher: r.teacher_name ?? "—",
                    student: r.student_name ?? "—",
                  })
                : t(`cancelType.${r.cancel_type}`, {
                    student: r.student_name ?? "—",
                  })}
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
            </div>
          </div>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2.5 py-0.5 text-[0.7rem] font-semibold",
            STATUS_CHIP[r.status],
          )}
        >
          {t(`status.${r.status}`)}
        </span>
      </div>

      {r.reason && (
        <p className="text-muted-foreground bg-muted/40 rounded-xl px-3 py-2 text-sm">
          <span className="font-medium">{t("reasonLabel")}: </span>
          {r.reason}
        </p>
      )}

      {!pending && r.decision_note && (
        <p className="text-muted-foreground text-xs">
          {t("decisionNote", {
            who: r.decided_by_name ?? "—",
            note: r.decision_note,
          })}
        </p>
      )}

      {isOwner && pending && (
        <div className="space-y-2 border-t pt-3">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("notePlaceholder")}
            aria-label={t("notePlaceholder")}
            className="border-input bg-background focus:border-primary focus:ring-primary/15 w-full rounded-xl border px-3.5 py-2 text-sm outline-none transition-colors focus:ring-3"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => setBillingOpen(true)}
              data-testid="approve"
              className="gap-1.5"
            >
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
              className="border-destructive/30 text-destructive hover:bg-destructive/10 gap-1.5"
            >
              <X className="size-3.5" />
              {t("actions.reject")}
            </Button>
          </div>
        </div>
      )}

      {!isOwner && pending && (
        <p className="text-muted-foreground border-t pt-3 text-xs">
          {t("teacherPendingHint")}
        </p>
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

// ── Reports (overdue-report alerts) ───────────────────────────────────────────

function ReportsTab({
  notifications,
  fmt,
  onChanged,
  onError,
}: {
  notifications: NotificationRow[];
  fmt: (iso: string) => string;
  onChanged: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const t = useTranslations("notifications");
  const [busy, setBusy] = useState(false);
  const hasUnread = notifications.some((n) => n.read_at === null);

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
      await markAllNotificationsRead();
      await onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (notifications.length === 0) {
    return <EmptyState message={t("empty.reports")} />;
  }

  return (
    <div className="space-y-3">
      {hasUnread && (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void markAll()}
            data-testid="mark-all-read"
            className="gap-1.5"
          >
            <CheckCheck className="size-3.5" />
            {t("actions.markAllRead")}
          </Button>
        </div>
      )}
      <ul className="space-y-3" data-testid="reports-list">
        {notifications.map((n) => {
          const unread = n.read_at === null;
          return (
            <li
              key={n.id}
              data-testid="report-card"
              data-unread={unread}
              className={cn(
                "bg-card flex items-start justify-between gap-3 rounded-2xl border p-4",
                unread && "border-primary/30 bg-primary/[0.03]",
              )}
            >
              <div className="flex items-start gap-3">
                <div className="bg-amber-100 ring-amber-200/60 dark:bg-amber-950/40 flex size-10 shrink-0 items-center justify-center rounded-xl ring-1">
                  <ClipboardX
                    className="size-5 text-amber-700 dark:text-amber-400"
                    aria-hidden
                  />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold leading-tight">
                    {t(
                      n.type === "REPORT_OVERDUE"
                        ? "report.overdueTitle"
                        : "report.reminderTitle",
                      { teacher: n.data.teacher_name ?? "—" },
                    )}
                  </p>
                  <p className="text-muted-foreground mt-1 text-sm">
                    {t("report.body", {
                      student: n.data.student_name ?? "—",
                      when: n.data.scheduled_at_utc
                        ? fmt(n.data.scheduled_at_utc)
                        : "—",
                    })}
                  </p>
                </div>
              </div>
              {unread && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void markRead(n.id)}
                  data-testid="mark-read"
                  className="shrink-0 gap-1.5"
                >
                  <Check className="size-3.5" />
                  {t("actions.markRead")}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div
      className="text-muted-foreground flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed py-16 text-center"
      data-testid="empty-state"
    >
      <Inbox className="size-8 opacity-40" aria-hidden />
      <p className="text-sm">{message}</p>
    </div>
  );
}
