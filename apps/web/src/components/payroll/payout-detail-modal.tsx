"use client";

import {
  CalendarDays,
  CheckCircle2,
  FileText,
  Gift,
  Loader2,
  MinusCircle,
  Receipt,
  Send,
  Trash2,
  TrendingDown,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import {
  AdjustmentReason,
  SourceBadge,
} from "@/components/adjustments/source-badge";
import { useAuth } from "@/components/auth-provider";
import { AdjustmentFormModal } from "@/components/payroll/adjustment-form-modal";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  type AdjustmentType,
  ApiError,
  apiFetch,
  getSession,
  type PayoutAdjustment,
  type PayoutDetail,
  type PayoutDetailResponse,
  type PayoutLineItem,
  type PayoutReportStatus,
  type ReportField,
  removePayoutAdjustment,
  type SessionReportData,
} from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

// ── Status badge ───────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<PayoutDetail["status"], string> = {
  OPEN: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  FINALIZED:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
};

function StatusBadge({ status }: { status: PayoutDetail["status"] }) {
  const t = useTranslations("payroll");
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[status]}`}
    >
      {t(`status.${status}`)}
    </span>
  );
}

export interface PayoutDetailModalProps {
  payoutId: string | null;
  onClose: () => void;
  /** Called after an adjustment is added/removed so the parent list + summary refresh. */
  onMutated?: () => void;
}

/**
 * Premium payout statement (Sprint 8+). Shows a full ledger breakdown — per-session gross,
 * rewards, deductions, net — plus the session line items and the rewards/deductions ledger with
 * reasons and details. Owners with payout.adjust can add or remove rewards/deductions while the
 * statement is OPEN; a FINALIZED statement is read-only.
 */
export function PayoutDetailModal({
  payoutId,
  onClose,
  onMutated,
}: PayoutDetailModalProps) {
  const t = useTranslations("payroll");
  const locale = useLocale();
  const { can } = useAuth();

  const [payout, setPayout] = useState<PayoutDetail | null>(null);
  const [lineItems, setLineItems] = useState<PayoutLineItem[]>([]);
  const [adjustments, setAdjustments] = useState<PayoutAdjustment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const [adjOpen, setAdjOpen] = useState(false);
  const [adjType, setAdjType] = useState<AdjustmentType>("REWARD");
  const [reportSessionId, setReportSessionId] = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<PayoutDetailResponse>(`/api/payouts/${id}`);
      setPayout(res.payout);
      setLineItems(res.lineItems ?? []);
      setAdjustments(res.adjustments ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (payoutId) {
      setPayout(null);
      setLineItems([]);
      setAdjustments([]);
      void load(payoutId);
    }
  }, [payoutId, load]);

  async function handleRemove(adjustmentId: string) {
    if (!payoutId) return;
    setRemovingId(adjustmentId);
    setError(null);
    try {
      await removePayoutAdjustment(payoutId, adjustmentId);
      await load(payoutId);
      onMutated?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setRemovingId(null);
    }
  }

  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  const fmt = (minor: number) =>
    formatMoney({ amount: minor, currency: payout?.currency ?? "" }, locale);

  const title = payout
    ? `${t("detailTitle")} · ${String(payout.period_month).padStart(2, "0")}/${payout.period_year}`
    : t("detailTitle");

  const isOpen = payout?.status === "OPEN";
  const canAdjust = isOpen && can("payout.adjust");

  function openAdjustment(type: AdjustmentType) {
    setAdjType(type);
    setAdjOpen(true);
  }

  return (
    <>
      <Modal
        open={payoutId !== null}
        onClose={onClose}
        title={title}
        description={payout?.teacher_name ?? undefined}
        size="lg"
      >
        {loading && (
          <div className="space-y-4" aria-label={t("loading")} aria-busy>
            <div className="bg-muted h-28 animate-pulse rounded-2xl" />
            <div className="bg-muted h-4 w-1/3 animate-pulse rounded" />
            <div className="bg-muted h-40 animate-pulse rounded-xl" />
          </div>
        )}

        {error && !loading && (
          <AlertBanner
            variant="error"
            message={error}
            onDismiss={() => setError(null)}
          />
        )}

        {payout && !loading && (
          <div className="space-y-6">
            {/* Premium hero — gradient net-pay card */}
            <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/[0.08] via-card to-card p-5 shadow-sm ring-1 ring-foreground/[0.04]">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="bg-primary/10 text-primary mb-2 inline-flex size-9 items-center justify-center rounded-xl">
                    <Receipt className="size-4.5" aria-hidden />
                  </div>
                  <p className="text-muted-foreground text-xs font-medium">
                    {t("colTeacher")}
                  </p>
                  <p className="truncate text-lg font-bold">
                    {payout.teacher_name ?? "—"}
                  </p>
                  {payout.finalized_at && (
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {t("finalizedAt")}: {dateFmt.format(new Date(payout.finalized_at))}
                    </p>
                  )}
                </div>
                <div className="text-end">
                  <StatusBadge status={payout.status} />
                  <p className="text-muted-foreground mt-2 text-xs font-medium">
                    {t("netPay")}
                  </p>
                  <p
                    className={cn(
                      "text-3xl font-extrabold tracking-tight tabular-nums",
                      payout.total_minor < 0 && "text-red-600 dark:text-red-400",
                    )}
                  >
                    {fmt(payout.total_minor)}
                  </p>
                </div>
              </div>
            </div>

            {/* Ledger breakdown */}
            <div className="grid gap-2.5 sm:grid-cols-3">
              <BreakdownTile
                icon={CalendarDays}
                tone="neutral"
                label={t("breakdownSessions")}
                value={fmt(payout.sessions_minor)}
                sub={t("sessionCount", { count: lineItems.length })}
              />
              <BreakdownTile
                icon={Gift}
                tone="emerald"
                label={t("breakdownRewards")}
                value={`+ ${fmt(payout.rewards_minor)}`}
                muted={payout.rewards_minor === 0}
              />
              <BreakdownTile
                icon={TrendingDown}
                tone="amber"
                label={t("breakdownDeductions")}
                value={`− ${fmt(payout.deductions_minor)}`}
                muted={payout.deductions_minor === 0}
              />
            </div>

            {/* Session line items */}
            <Section title={t("lineItems")}>
              <div className="overflow-hidden rounded-xl border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/30 border-b">
                      <Th>{t("liDate")}</Th>
                      <Th>{t("liStudent")}</Th>
                      <Th>{t("liReport")}</Th>
                      <Th className="text-end">{t("liAmount")}</Th>
                      <Th className="text-end" />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {lineItems.length === 0 && (
                      <tr>
                        <td
                          colSpan={5}
                          className="text-muted-foreground px-4 py-6 text-center text-sm"
                        >
                          {t("empty")}
                        </td>
                      </tr>
                    )}
                    {lineItems.map((li) => (
                      <tr key={li.id} className="hover:bg-muted/20 transition-colors">
                        <td className="text-muted-foreground px-4 py-2.5 tabular-nums">
                          {li.session_date
                            ? dateFmt.format(new Date(li.session_date))
                            : "—"}
                        </td>
                        <td className="px-4 py-2.5">{li.student_name ?? "—"}</td>
                        <td className="px-4 py-2.5">
                          <ReportStatusBadge status={li.report_status} />
                        </td>
                        <td className="px-4 py-2.5 text-end tabular-nums">
                          {formatMoney(
                            { amount: li.amount_minor, currency: li.currency },
                            locale,
                          )}
                        </td>
                        <td className="px-2 py-2.5 text-end">
                          {li.session_id && (
                            <Button
                              type="button"
                              size="xs"
                              variant="outline"
                              onClick={() => setReportSessionId(li.session_id)}
                            >
                              <FileText className="size-3" aria-hidden />
                              {t("liViewReport")}
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>

            {/* Rewards & deductions ledger */}
            <Section
              title={t("adjustmentsTitle")}
              action={
                canAdjust ? (
                  <div className="flex gap-1.5">
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      onClick={() => openAdjustment("REWARD")}
                      className="text-emerald-700 dark:text-emerald-400"
                    >
                      <Gift className="size-3" aria-hidden />
                      {t("addReward")}
                    </Button>
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      onClick={() => openAdjustment("DEDUCTION")}
                      className="text-amber-700 dark:text-amber-400"
                    >
                      <MinusCircle className="size-3" aria-hidden />
                      {t("addDeduction")}
                    </Button>
                  </div>
                ) : undefined
              }
            >
              {adjustments.length === 0 ? (
                <div className="text-muted-foreground rounded-xl border border-dashed px-4 py-6 text-center text-sm">
                  {t("adjustmentsEmpty")}
                </div>
              ) : (
                <ul className="space-y-2">
                  {adjustments.map((adj) => (
                    <AdjustmentRow
                      key={adj.id}
                      adj={adj}
                      locale={locale}
                      dateLabel={dateFmt.format(new Date(adj.created_at))}
                      // Only hand-typed rows can be removed here. A QUALITY row is owned by its
                      // report (withdraw the report to undo it) and an AUTO_UNREPORTED one would
                      // be rewritten by the next hourly sweep — the Discounts & Awards page waives
                      // that one with a compensating award instead.
                      canRemove={canAdjust && adj.source === "MANUAL"}
                      removing={removingId === adj.id}
                      onRemove={() => void handleRemove(adj.id)}
                    />
                  ))}
                </ul>
              )}
            </Section>

            {/* Net total footer */}
            <div className="bg-muted/40 flex items-center justify-between rounded-xl border px-4 py-3">
              <span className="text-sm font-semibold uppercase tracking-wide">
                {t("netPay")}
              </span>
              <span
                className={cn(
                  "text-lg font-bold tabular-nums",
                  payout.total_minor < 0 && "text-red-600 dark:text-red-400",
                )}
              >
                {fmt(payout.total_minor)}
              </span>
            </div>

            {payout.notes && (
              <div className="rounded-xl border p-3">
                <p className="text-muted-foreground text-xs font-medium">
                  {t("notesLabel")}
                </p>
                <p className="mt-0.5 text-sm">{payout.notes}</p>
              </div>
            )}
          </div>
        )}
      </Modal>

      <AdjustmentFormModal
        open={adjOpen}
        payoutId={payoutId}
        currency={payout?.currency ?? ""}
        defaultType={adjType}
        onClose={() => setAdjOpen(false)}
        onSuccess={() => {
          setAdjOpen(false);
          if (payoutId) void load(payoutId);
          onMutated?.();
        }}
      />

      <LessonReportModal
        sessionId={reportSessionId}
        onClose={() => setReportSessionId(null)}
      />
    </>
  );
}

// ── Report status badge ──────────────────────────────────────────────────────

const REPORT_STATUS_META: Record<
  PayoutReportStatus,
  { icon: typeof FileText; className: string }
> = {
  SENT: {
    icon: Send,
    className:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  },
  FILLED: {
    icon: CheckCircle2,
    className:
      "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  },
  MISSING: {
    icon: FileText,
    className: "bg-muted text-muted-foreground",
  },
};

function ReportStatusBadge({ status }: { status: PayoutReportStatus }) {
  const t = useTranslations("payroll");
  const meta = REPORT_STATUS_META[status];
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        meta.className,
      )}
    >
      <Icon className="size-3" aria-hidden />
      {t(`reportStatus.${status}`)}
    </span>
  );
}

// ── Lesson report viewer ─────────────────────────────────────────────────────

/** Read-only view of a session's filled report, opened from a payout line item. */
function LessonReportModal({
  sessionId,
  onClose,
}: {
  sessionId: string | null;
  onClose: () => void;
}) {
  const t = useTranslations("payroll");
  const locale = useLocale();
  const [report, setReport] = useState<SessionReportData | null>(null);
  const [fields, setFields] = useState<ReportField[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    setLoading(true);
    setReport(null);
    void getSession(sessionId)
      .then((res) => {
        setReport(res.report);
        setFields(res.reportFields);
      })
      .finally(() => setLoading(false));
  }, [sessionId]);

  const values = report?.values ?? {};

  return (
    <Modal
      open={sessionId !== null}
      onClose={onClose}
      title={t("lessonReport")}
      size="md"
    >
      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="text-primary size-6 animate-spin" aria-hidden />
        </div>
      ) : report === null ? (
        <p className="text-muted-foreground py-6 text-center text-sm">
          {t("noReport")}
        </p>
      ) : (
        <dl className="space-y-3">
          {fields.map((f) => {
            const v = values[f.key];
            return (
              <div key={f.id} className="bg-muted/20 rounded-xl border p-3">
                <dt className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
                  {locale === "ar" ? f.label_ar : f.label_en}
                </dt>
                <dd className="mt-0.5 whitespace-pre-wrap text-sm">
                  {v === null || v === undefined || v === ""
                    ? "—"
                    : String(v)}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
    </Modal>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function Th({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={cn(
        "text-muted-foreground px-4 py-2.5 text-start text-xs font-semibold uppercase tracking-wide",
        className,
      )}
    >
      {children}
    </th>
  );
}

function BreakdownTile({
  icon: Icon,
  tone,
  label,
  value,
  sub,
  muted,
}: {
  icon: typeof Gift;
  tone: "neutral" | "emerald" | "amber";
  label: string;
  value: string;
  sub?: string;
  muted?: boolean;
}) {
  const tones: Record<typeof tone, string> = {
    neutral: "text-foreground/70",
    emerald: "text-emerald-600 dark:text-emerald-400",
    amber: "text-amber-600 dark:text-amber-400",
  };
  return (
    <div className="bg-card rounded-xl border p-3 shadow-sm ring-1 ring-foreground/[0.03]">
      <div className="mb-1 flex items-center gap-1.5">
        <Icon className={cn("size-3.5", muted ? "text-muted-foreground" : tones[tone])} aria-hidden />
        <span className="text-muted-foreground text-xs font-medium">{label}</span>
      </div>
      <p
        className={cn(
          "text-base font-bold tabular-nums",
          muted ? "text-muted-foreground" : tone !== "neutral" && tones[tone],
        )}
      >
        {value}
      </p>
      {sub && <p className="text-muted-foreground mt-0.5 text-xs">{sub}</p>}
    </div>
  );
}

function AdjustmentRow({
  adj,
  locale,
  dateLabel,
  canRemove,
  removing,
  onRemove,
}: {
  adj: PayoutAdjustment;
  locale: string;
  dateLabel: string;
  canRemove: boolean;
  removing: boolean;
  onRemove: () => void;
}) {
  const t = useTranslations("payroll");
  const isReward = adj.type === "REWARD";
  return (
    <li className="bg-card flex items-start gap-3 rounded-xl border p-3 shadow-sm ring-1 ring-foreground/[0.03]">
      <div
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg",
          isReward
            ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400"
            : "bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400",
        )}
      >
        {isReward ? (
          <Gift className="size-4.5" aria-hidden />
        ) : (
          <MinusCircle className="size-4.5" aria-hidden />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">
            {/* A derived row's stored reason is the audit trail's English; the reader gets it in
                their own language, rebuilt from the source. A hand-typed reason IS the reason, so
                it shows exactly as written. */}
            <AdjustmentReason source={adj.source} reason={adj.reason} sessionLocal={null} />
          </span>
          <span
            className={cn(
              "rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              isReward
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                : "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
            )}
          >
            {isReward ? t("typeReward") : t("typeDeduction")}
          </span>
          {/* The teacher reads this statement: a machine's deduction and a manager's must never
              look like the same act. */}
          {adj.source !== "MANUAL" && <SourceBadge source={adj.source} />}
        </div>
        {adj.details && (
          <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
            {adj.details}
          </p>
        )}
        <p className="text-muted-foreground mt-1 text-[11px]">{dateLabel}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span
          className={cn(
            "text-sm font-bold tabular-nums",
            isReward
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-amber-600 dark:text-amber-400",
          )}
        >
          {isReward ? "+" : "−"}
          {formatMoney({ amount: adj.amount_minor, currency: adj.currency }, locale)}
        </span>
        {canRemove && (
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            disabled={removing}
            onClick={onRemove}
            aria-label={t("removeAdjustment")}
            className="text-muted-foreground hover:text-destructive"
          >
            {removing ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Trash2 className="size-3.5" aria-hidden />
            )}
          </Button>
        )}
      </div>
    </li>
  );
}
