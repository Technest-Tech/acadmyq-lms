"use client";

import {
  Bot,
  CalendarRange,
  Lock,
  Scale,
  Settings2,
  Trash2,
  TrendingDown,
  TrendingUp,
  Undo2,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { AdjustmentComposer } from "@/components/adjustments/adjustment-composer";
import { AutoDeductSettingsModal } from "@/components/adjustments/auto-deduct-settings-modal";
import {
  AdjustmentReason,
  SourceBadge,
  TypeBadge,
} from "@/components/adjustments/source-badge";
import { useAuth } from "@/components/auth-provider";
import { AlertBanner } from "@/components/ui/alert";
import { PageHero } from "@/components/ui/page-hero";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import {
  ApiError,
  deleteTeacherAdjustment,
  getAdjustmentSummary,
  getQualitySettings,
  listTeacherAdjustments,
  listTeachers,
  waiveAutoDeduction,
  type AdjustmentSummary,
  type AdjustmentType,
  type QualitySettings,
  type TeacherAdjustmentRow,
  type TeacherRow,
} from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const YEARS = Array.from({ length: 4 }, (_, i) => new Date().getFullYear() - i);

/**
 * The Discounts & Awards page — every reward and deduction in the academy, per teacher.
 *
 * The same rows the payroll statements show, addressed the other way round: payroll asks "what is
 * in this month's statement", this asks "what happened to this teacher". It is also the only place
 * the automatic deduction policy is visible, which is the point — a rule that docks people without
 * anyone clicking must live next to its own consequences, not buried in a settings page.
 */
export function AdjustmentsManager() {
  const t = useTranslations("adjustments");
  const locale = useLocale();
  const { can } = useAuth();

  const canAdjust = can("payout.adjust");
  const canManagePolicy = can("teacher_quality.manage");

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [refreshToken, setRefreshToken] = useState(0);
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [summary, setSummary] = useState<AdjustmentSummary | null>(null);
  const [settings, setSettings] = useState<QualitySettings | null>(null);
  const [composer, setComposer] = useState<AdjustmentType | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [alert, setAlert] = useState<{ variant: "success" | "error"; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => setRefreshToken((n) => n + 1), []);

  useEffect(() => {
    listTeachers({ pageSize: 200, sort: "name" })
      .then((res) => setTeachers(res.rows.filter((row) => row.is_active)))
      .catch(() => setTeachers([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setSummary(null);
    getAdjustmentSummary(year, month)
      .then((res) => {
        if (!cancelled) setSummary(res);
      })
      .catch(() => {
        if (!cancelled) setSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, [year, month, refreshToken]);

  useEffect(() => {
    getQualitySettings()
      .then((res) => setSettings(res.settings))
      .catch(() => setSettings(null));
  }, [refreshToken]);

  function showAlert(variant: "success" | "error", message: string) {
    setAlert({ variant, message });
    window.setTimeout(() => setAlert(null), 4000);
  }

  async function remove(row: TeacherAdjustmentRow) {
    if (!window.confirm(t("confirmDelete"))) return;
    setBusy(true);
    try {
      await deleteTeacherAdjustment(row.id);
      refresh();
      showAlert("success", t("alerts.deleted"));
    } catch (err) {
      showAlert("error", err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function waive(row: TeacherAdjustmentRow) {
    const reason = window.prompt(t("waivePrompt"));
    if (reason === null || reason.trim() === "") return;
    setBusy(true);
    try {
      await waiveAutoDeduction(row.id, reason.trim());
      refresh();
      showAlert("success", t("alerts.waived"));
    } catch (err) {
      showAlert("error", err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const columns: ColumnDef<TeacherAdjustmentRow>[] = [
    {
      key: "teacher",
      header: t("table.teacher"),
      sortKey: "teacher",
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{row.teacher_name}</p>
          <p className="text-muted-foreground text-xs tabular-nums">
            {String(row.period_month).padStart(2, "0")}/{row.period_year}
          </p>
        </div>
      ),
    },
    {
      key: "type",
      header: t("table.type"),
      render: (row) => <TypeBadge type={row.type} />,
    },
    {
      key: "reason",
      header: t("table.reason"),
      render: (row) => (
        <div className="min-w-0 space-y-1">
          <AdjustmentReason
            source={row.source}
            reason={row.reason}
            sessionLocal={row.session_local}
          />
          <div className="flex flex-wrap items-center gap-1.5">
            <SourceBadge source={row.source} />
            {row.finalized && (
              <span className="text-muted-foreground inline-flex items-center gap-1 text-[11px]">
                <Lock className="size-2.5" aria-hidden />
                {t("table.finalized")}
              </span>
            )}
          </div>
        </div>
      ),
    },
    {
      key: "amount",
      header: t("table.amount"),
      sortKey: "amount",
      render: (row) => (
        <span
          className={cn(
            "text-sm font-semibold tabular-nums",
            row.type === "REWARD"
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-red-600 dark:text-red-400",
          )}
        >
          {row.type === "REWARD" ? "+" : "−"}
          {formatMoney({ amount: row.amount_minor, currency: row.currency }, locale)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHero
        latticeId="adjustments-hero-lattice"
        icon={Scale}
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <>
            <Button
              size="lg"
              onClick={() => setSettingsOpen(true)}
              data-testid="adjustments-settings"
              className="gap-2 border-white/25 bg-white/15 text-white backdrop-blur-sm hover:bg-white/25"
            >
              <Settings2 className="size-4" aria-hidden />
              {t("autoPolicy")}
            </Button>
            {canAdjust && (
              <>
                <Button
                  size="lg"
                  onClick={() => setComposer("DEDUCTION")}
                  data-testid="adjustments-new-deduction"
                  className="gap-2 border-white/25 bg-white/15 text-white backdrop-blur-sm hover:bg-white/25"
                >
                  <TrendingDown className="size-4" aria-hidden />
                  {t("addDeduction")}
                </Button>
                <Button
                  size="lg"
                  onClick={() => setComposer("REWARD")}
                  data-testid="adjustments-new-reward"
                  className="gap-2 border-transparent bg-white px-4 text-emerald-800 shadow-md hover:bg-white/90"
                >
                  <TrendingUp className="size-4" aria-hidden />
                  {t("addReward")}
                </Button>
              </>
            )}
          </>
        }
      />

      {alert && (
        <AlertBanner variant={alert.variant} message={alert.message} onDismiss={() => setAlert(null)} />
      )}

      {/* The automatic policy, stated where its consequences are listed. */}
      <AutoPolicyStrip
        settings={settings}
        autoCount={summary?.auto_count ?? 0}
        onOpen={() => setSettingsOpen(true)}
      />

      {/* Period + totals. The month/year pair decides everything below it, so it sits on the
          same rail surface as a table's own controls rather than floating loose. */}
      <div className="bg-muted/35 flex flex-wrap items-center gap-2 rounded-xl border p-2">
        <CalendarRange
          className="text-muted-foreground/70 ms-1 size-3.5 shrink-0"
          aria-hidden
        />
        <select
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
          className="border-input bg-background focus:border-primary focus:ring-primary/15 rounded-xl border px-3 py-1.5 text-sm outline-none focus:ring-3"
          aria-label={t("composer.month")}
        >
          {MONTHS.map((m) => (
            <option key={m} value={m}>
              {String(m).padStart(2, "0")}
            </option>
          ))}
        </select>
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="border-input bg-background focus:border-primary focus:ring-primary/15 rounded-xl border px-3 py-1.5 text-sm outline-none focus:ring-3"
          aria-label={t("composer.year")}
        >
          {YEARS.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      <AdjustmentStats summary={summary} locale={locale} />

      <DataTable<TeacherAdjustmentRow>
        testId="adjustments-table"
        refreshToken={refreshToken}
        fetcher={(q) =>
          listTeacherAdjustments({
            ...q,
            filter: { ...q.filter, period: `${year}-${month}` },
          })
        }
        getRowId={(row) => row.id}
        searchable
        defaultSort="-created_at"
        filters={[
          {
            key: "type",
            label: t("table.type"),
            options: [
              { value: "REWARD", label: t("type.REWARD") },
              { value: "DEDUCTION", label: t("type.DEDUCTION") },
            ],
          },
          {
            key: "source",
            label: t("table.source"),
            options: [
              { value: "MANUAL", label: t("source.MANUAL") },
              { value: "QUALITY", label: t("source.QUALITY") },
              { value: "AUTO_UNREPORTED", label: t("source.AUTO_UNREPORTED") },
            ],
          },
        ]}
        emptyMessage={t("table.empty")}
        columns={columns}
        rowActions={
          canAdjust
            ? (row) => {
                // A finalized statement is money already paid — nothing here can move it.
                if (row.finalized) return null;
                // An automatic row can't be deleted: the sweep would write it back within the
                // hour. Waiving posts a matching award instead, so both calls stay on record.
                if (row.source === "AUTO_UNREPORTED") {
                  return (
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void waive(row)}
                      data-testid="adjustment-waive"
                    >
                      <Undo2 className="size-3" aria-hidden />
                      {t("waive")}
                    </Button>
                  );
                }
                // A quality row belongs to its report — withdraw the report to undo it.
                if (row.source === "QUALITY") return null;
                return (
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void remove(row)}
                    aria-label={t("delete")}
                    data-testid="adjustment-delete"
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </Button>
                );
              }
            : undefined
        }
      />

      <AdjustmentComposer
        open={composer !== null}
        teachers={teachers}
        presetType={composer ?? "REWARD"}
        onClose={() => setComposer(null)}
        onCreated={(type) => {
          refresh();
          showAlert("success", type === "REWARD" ? t("alerts.rewarded") : t("alerts.deducted"));
        }}
      />

      <AutoDeductSettingsModal
        open={settingsOpen}
        canManage={canManagePolicy}
        onClose={() => setSettingsOpen(false)}
        onSaved={() => {
          refresh();
          showAlert("success", t("alerts.settingsSaved"));
        }}
      />
    </div>
  );
}

// ── The automatic policy strip ────────────────────────────────────────────────

function AutoPolicyStrip({
  settings,
  autoCount,
  onOpen,
}: {
  settings: QualitySettings | null;
  autoCount: number;
  onOpen: () => void;
}) {
  const t = useTranslations("adjustments");

  if (settings === null) return null;

  const on = settings.auto_deduct_enabled;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex w-full items-center gap-3 rounded-2xl border p-3.5 text-start transition-colors",
        on
          ? "border-orange-200 bg-orange-50/60 hover:bg-orange-50 dark:border-orange-900/50 dark:bg-orange-950/20"
          : "hover:bg-muted/40 border-dashed",
      )}
      data-testid="auto-policy-strip"
    >
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-xl",
          on
            ? "bg-orange-100 text-orange-600 dark:bg-orange-950/50 dark:text-orange-400"
            : "bg-muted text-muted-foreground",
        )}
      >
        <Bot className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">
          {on ? t("policy.onTitle", { hours: settings.auto_deduct_grace_hours }) : t("policy.offTitle")}
        </span>
        <span className="text-muted-foreground block text-xs leading-snug">
          {on ? t("policy.onHint") : t("policy.offHint")}
        </span>
      </span>
      {on && autoCount > 0 && (
        <span className="shrink-0 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-orange-700 dark:bg-orange-950/50 dark:text-orange-300">
          {t("policy.thisMonth", { count: autoCount })}
        </span>
      )}
    </button>
  );
}

// ── Stat tiles ────────────────────────────────────────────────────────────────

function AdjustmentStats({
  summary,
  locale,
}: {
  summary: AdjustmentSummary | null;
  locale: string;
}) {
  const t = useTranslations("adjustments");

  if (summary === null) {
    return (
      <div className="grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-card h-[92px] animate-pulse rounded-2xl border shadow-sm" aria-hidden />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <MoneyTile
        tone="reward"
        icon={TrendingUp}
        label={t("stats.rewards")}
        count={summary.reward_count}
        rows={summary.totals.map((row) => ({
          currency: row.currency,
          amount_minor: row.rewards_minor,
        }))}
        locale={locale}
      />
      <MoneyTile
        tone="deduction"
        icon={TrendingDown}
        label={t("stats.deductions")}
        count={summary.deduction_count}
        rows={summary.totals.map((row) => ({
          currency: row.currency,
          amount_minor: row.deductions_minor,
        }))}
        locale={locale}
      />
      <div className="bg-card rounded-2xl border p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <Bot className="size-4 text-orange-600 dark:text-orange-400" aria-hidden />
          <p className="text-muted-foreground text-xs">{t("stats.auto")}</p>
        </div>
        <p className="mt-1 text-lg font-bold tabular-nums">{summary.auto_count}</p>
        <p className="text-muted-foreground/70 text-[11px]">{t("stats.autoHint")}</p>
      </div>
    </div>
  );
}

function MoneyTile({
  tone,
  icon: Icon,
  label,
  count,
  rows,
  locale,
}: {
  tone: "reward" | "deduction";
  icon: typeof TrendingUp;
  label: string;
  count: number;
  rows: { currency: string; amount_minor: number }[];
  locale: string;
}) {
  const t = useTranslations("adjustments");
  const colour =
    tone === "reward"
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-red-600 dark:text-red-400";
  const nonZero = rows.filter((row) => row.amount_minor > 0);

  return (
    <div className="bg-card rounded-2xl border p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <Icon className={cn("size-4", colour)} aria-hidden />
        <p className="text-muted-foreground text-xs">{label}</p>
      </div>
      {nonZero.length === 0 ? (
        <p className="mt-1 text-lg font-bold tabular-nums">—</p>
      ) : (
        <div className="mt-1 space-y-0.5">
          {/* Per-currency, never summed: the academy may pay teachers in more than one and the
              system does no FX, so one merged figure would be invented. */}
          {nonZero.map((row) => (
            <p key={row.currency} className={cn("text-lg leading-tight font-bold tabular-nums", colour)}>
              {tone === "reward" ? "+" : "−"}
              {formatMoney({ amount: row.amount_minor, currency: row.currency }, locale)}
            </p>
          ))}
        </div>
      )}
      <p className="text-muted-foreground/70 text-[11px]">{t("stats.entries", { count })}</p>
    </div>
  );
}
