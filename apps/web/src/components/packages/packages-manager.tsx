"use client";

import {
  AlertTriangle,
  CircleDollarSign,
  Layers,
  PackageCheck,
  Plus,
  Timer,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { useCapability } from "@/lib/capabilities";
import { FamilyDueGroup, groupDueByFamily } from "@/components/packages/family-due-group";
import {
  isPackagePaid,
  PackageCard,
} from "@/components/packages/package-card";
import { usePackageActions } from "@/components/packages/use-package-actions";
import { isPackageBillPaid, PaidPackageCard, paidAmount } from "@/components/packages/paid-package-card";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { HeroPill, PageHero } from "@/components/ui/page-hero";
import {
  getLessonPackageSummary,
  listLessonPackages,
  type LessonPackageRow,
  type LessonPackageSummary,
} from "@/lib/api";
import { formatMoney, formatNumber } from "@/lib/money";
import { cn } from "@/lib/utils";

/** The three pages of the packages screen, each its own sidebar item. */
export type PackagesView = "due" | "open" | "finished";

/**
 * The two halves of Finished packages. A package moves from "unpaid" to "paid" the moment its
 * bill is settled and stays there, green — it never drops off the page.
 */
type FinishedTab = "unpaid" | "paid";

/** A timestamp as the calendar day it fell on here — what a from/to date input compares against. */
function localDay(iso: string, timezone: string): string {
  // en-CA formats as YYYY-MM-DD, the same shape <input type="date"> produces.
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(
    new Date(iso),
  );
}

/**
 * The Packages screen, split in three pages:
 *
 *   • Due — every block with money still owed on it, open or finished, oldest debt first. The
 *     page the academy opens every day: payment is up front, so a block that opened this morning
 *     and is not yet paid belongs here, not on a "finished" list weeks later.
 *   • Open packages — blocks being consumed right now. A block opened while the student still
 *     owes on an earlier one wears its own colour and says so, because that debt is otherwise on
 *     a different page.
 *   • Finished packages — blocks that ran out or were closed. Each one that still needs following
 *     up (unpaid, unbilled, overdraft, or still being taught with nothing open) carries a
 *     reminder button and how many reminders the family has had, and when the last one went.
 *
 * Both pages read the same list; it is split on the client because the open-package form needs
 * the finished history either way (to offer carrying hours over).
 */
export function PackagesManager({ view = "open" }: { view?: PackagesView }) {
  const t = useTranslations("packages");
  const locale = useLocale();
  const { can } = useAuth();
  // A centre calls these subscriptions; a Quran academy keeps packages.
  const centre = useCapability("centre");
  const canManage = can("package.manage");
  const canSendInvoice = can("invoice.send_link");
  const timezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
    [],
  );

  const [rows, setRows] = useState<LessonPackageRow[] | null>(null);
  const [summary, setSummary] = useState<LessonPackageSummary | null>(null);
  const [tab, setTab] = useState<FinishedTab>("unpaid");
  // Inclusive day range. On "Not paid" it is the day the package finished; on "Paid", the day the
  // bill was paid — the question an accountant asks of each tab.
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [query, setQuery] = useState("");
  const [alert, setAlert] = useState<{
    variant: "success" | "error";
    message: string;
  } | null>(null);

  const refresh = useCallback(() => {
    void listLessonPackages()
      .then((r) => setRows(r.packages))
      .catch(() => setRows([]));
    void getLessonPackageSummary()
      .then(setSummary)
      .catch(() => {});
  }, []);

  useEffect(refresh, [refresh]);

  /**
   * Students with a closed package behind them — the only ones for whom "carry over unused hours"
   * can do anything. The form hides the option for everyone else rather than offering a checkbox
   * with nothing to move.
   */
  const studentsWithHistory = useMemo(
    () =>
      new Set(
        (rows ?? [])
          .filter((r) => r.status !== "ACTIVE")
          .map((r) => r.student_id),
      ),
    [rows],
  );

  function showAlert(variant: "success" | "error", message: string) {
    setAlert({ variant, message });
    if (variant === "success") setTimeout(() => setAlert(null), 4500);
  }

  const { actionProps, openNew, openDetail, modals } = usePackageActions({
    onChanged: refresh,
    onAlert: showAlert,
    studentsWithHistory,
    onReminded: (rowId, result) =>
      setRows((prev) =>
        (prev ?? []).map((r) =>
          r.id === rowId
            ? { ...r, reminders_sent: result.reminders_sent, last_reminded_at: result.last_reminded_at }
            : r,
        ),
      ),
  });

  /**
   * `/packages?open=<studentId>` opens the form with that student already chosen.
   *
   * Kept for links from elsewhere (notifications, older bookmarks). The profile now opens the same
   * form in place, through {@link usePackageActions}, so there is still exactly one form.
   */
  // Optional-chained because useSearchParams() genuinely returns null when the component renders
  // outside a Next router — which is every unit test of this screen. No link, no deep link.
  const params = useSearchParams();
  const deepLinkStudent = params?.get("open") ?? null;
  useEffect(() => {
    if (deepLinkStudent) openNew(deepLinkStudent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkStudent]);

  /** Due's Paid tab: packages whose bill is settled, so the admin can see what came in and how. */
  const duePaid = view === "due" && tab === "paid";
  const dueCount = useMemo(() => (rows ?? []).filter((r) => r.due).length, [rows]);
  const billPaidCount = useMemo(() => (rows ?? []).filter(isPackageBillPaid).length, [rows]);

  /** This page's packages, before search and filter. */
  const pageRows = useMemo(
    () =>
      (rows ?? []).filter((r) =>
        view === "due"
          ? tab === "paid"
            ? isPackageBillPaid(r)
            : r.due
          : view === "open"
            ? r.status === "ACTIVE"
            : r.status !== "ACTIVE",
      ),
    [rows, view, tab],
  );
  const paidCount = view === "due" ? billPaidCount : pageRows.filter(isPackagePaid).length;
  const unpaidCount = view === "due" ? dueCount : pageRows.length - paidCount;
  const previousUnpaidCount = pageRows.filter(
    (r) => r.previous_unpaid !== null,
  ).length;

  /** The date a finished row is filtered and sorted on, for the tab it sits in. */
  const finishedDate = useCallback(
    (r: LessonPackageRow) =>
      (tab === "paid" ? r.paid_at : null) ?? r.closed_at ?? r.created_at,
    [tab],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matched = pageRows.filter((r) => {
      // A family is looked up by the parent's name as often as by a child's.
      if (
        needle !== "" &&
        !r.student_name.toLowerCase().includes(needle) &&
        !(r.guardian_name ?? "").toLowerCase().includes(needle)
      ) {
        return false;
      }
      if (view !== "finished" && !duePaid) return true;
      if (view === "finished" && isPackagePaid(r) !== (tab === "paid")) return false;
      const day = localDay(finishedDate(r), timezone);
      return (from === "" || day >= from) && (to === "" || day <= to);
    });

    if (view === "finished" || duePaid) {
      // Most recent first: the latest to finish, or the latest to be paid.
      return [...matched].sort((a, b) =>
        finishedDate(b).localeCompare(finishedDate(a)),
      );
    }

    if (view === "due") {
      // The oldest debt first — it has waited longest.
      return [...matched].sort((a, b) => a.created_at.localeCompare(b.created_at));
    }

    // On Open, what needs a hand first: a block opened over an unpaid one, then a block about to
    // run out. Otherwise the server's newest-first order.
    const rank = (r: LessonPackageRow) =>
      r.previous_unpaid !== null ? 0 : r.minutes_remaining <= 60 ? 1 : 2;
    return matched
      .map((row, i) => ({ row, i }))
      .sort((a, b) => rank(a.row) - rank(b.row) || a.i - b.i)
      .map(({ row }) => row);
  }, [pageRows, query, view, tab, duePaid, from, to, timezone, finishedDate]);

  /** What the Paid tab's packages brought in, per currency — never summed across them. */
  const collected = useMemo(() => {
    if (!duePaid) return [];
    const by = new Map<string, number>();
    for (const r of visible) {
      by.set(r.currency, (by.get(r.currency) ?? 0) + paidAmount(r));
    }
    return [...by.entries()].map(([currency, amount_minor]) => ({ currency, amount_minor }));
  }, [duePaid, visible]);

  return (
    <div className="space-y-5">
      <PageHero
        latticeId="packages-hero-lattice"
        icon={view === "due" ? CircleDollarSign : view === "open" ? Layers : PackageCheck}
        title={centre ? t(`centre.${view}.title`) : t(`pages.${view}.title`)}
        subtitle={centre ? t(`centre.${view}.subtitle`) : t(`pages.${view}.subtitle`)}
        actions={
          <>
            {view === "open" && rows !== null && (
              <HeroPill>
                <Timer className="size-3.5" aria-hidden />
                {t("hero.active", { count: pageRows.length })}
              </HeroPill>
            )}
            {view === "open" && previousUnpaidCount > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-fuchsia-300/60 bg-fuchsia-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm">
                <AlertTriangle className="size-3.5" aria-hidden />
                {t("hero.previousUnpaid", { count: previousUnpaidCount })}
              </span>
            )}
            {view === "finished" && rows !== null && (
              <span className="border-gold/50 bg-gold text-gold-foreground inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold shadow-sm">
                <AlertTriangle className="size-3.5" aria-hidden />
                {t("hero.followUp", { count: unpaidCount })}
              </span>
            )}
            {/* What is owed across the Due page, per currency and never summed across them. */}
            {view === "due" && rows !== null && (
              <span
                className="inline-flex items-center gap-1.5 rounded-full border border-rose-300/60 bg-rose-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm"
                data-testid="due-count"
              >
                <AlertTriangle className="size-3.5" aria-hidden />
                {t("hero.due", { count: dueCount })}
              </span>
            )}
            {view === "due" &&
              !duePaid &&
              (summary?.dueAmounts ?? []).map((a) => (
                <HeroPill key={a.currency}>
                  <CircleDollarSign className="size-3.5" aria-hidden />
                  {t("hero.outstanding", {
                    amount: formatMoney(
                      { amount: a.amount_minor, currency: a.currency },
                      locale,
                    ),
                  })}
                </HeroPill>
              ))}
            {collected.map((c) => (
              <HeroPill key={`collected-${c.currency}`}>
                <CircleDollarSign className="size-3.5" aria-hidden />
                {t("hero.collected", {
                  amount: formatMoney({ amount: c.amount_minor, currency: c.currency }, locale),
                })}
              </HeroPill>
            ))}
            {/* What finished packages still owe — the one number the old stat tiles carried that
                this page still needs, per currency and never summed across them. */}
            {view === "finished" &&
              (summary?.financials ?? [])
                .filter((f) => f.completed_outstanding_minor > 0)
                .map((f) => (
                  <HeroPill key={f.currency}>
                    <CircleDollarSign className="size-3.5" aria-hidden />
                    {t("hero.outstanding", {
                      amount: formatMoney(
                        { amount: f.completed_outstanding_minor, currency: f.currency },
                        locale,
                      ),
                    })}
                  </HeroPill>
                ))}
            {canManage && view === "open" && (
              <Button
                size="lg"
                variant="outline"
                onClick={() => openNew()}
                data-testid="open-package"
                className="gap-2 border-white/25 bg-white/15 text-white backdrop-blur-sm hover:bg-white/25 hover:text-white"
              >
                <Plus className="size-4" aria-hidden />
                {t("actions.open")}
              </Button>
            )}
          </>
        }
      />

      {alert && (
        <AlertBanner
          variant={alert.variant}
          message={alert.message}
          onDismiss={() => setAlert(null)}
        />
      )}

      {/* ── The record ────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchPlaceholder")}
            className="border-input bg-background focus:border-primary focus:ring-primary/15 w-full max-w-xs rounded-xl border px-3 py-2 text-sm outline-none transition-colors focus:ring-3"
          />
          {(view === "finished" || view === "due") && (
            <div className="bg-muted/50 flex gap-1 rounded-xl p-1">
              {(["unpaid", "paid"] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  aria-pressed={tab === key}
                  data-testid={`finished-tab-${key}`}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                    tab === key
                      ? key === "paid"
                        ? "bg-emerald-600 text-white shadow-sm"
                        : "bg-rose-600 text-white shadow-sm"
                      : "text-muted-foreground hover:bg-background",
                  )}
                >
                  {t(view === "due" ? `dueTab.${key}` : `finishedTab.${key}`, {
                    count: formatNumber(
                      key === "paid" ? paidCount : unpaidCount,
                      locale,
                    ),
                  })}
                </button>
              ))}
            </div>
          )}
        </div>

        {(view === "finished" || duePaid) && (
          <div className="flex flex-wrap items-end gap-2" data-testid="finished-dates">
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground block font-medium">
                {t(tab === "paid" ? "dates.paidFrom" : "dates.finishedFrom")}
              </span>
              <input
                type="date"
                value={from}
                max={to || undefined}
                onChange={(e) => setFrom(e.target.value)}
                data-testid="finished-from"
                className="border-input bg-background focus:border-primary rounded-xl border px-3 py-1.5 text-sm outline-none"
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground block font-medium">
                {t("dates.to")}
              </span>
              <input
                type="date"
                value={to}
                min={from || undefined}
                onChange={(e) => setTo(e.target.value)}
                data-testid="finished-to"
                className="border-input bg-background focus:border-primary rounded-xl border px-3 py-1.5 text-sm outline-none"
              />
            </label>
            {(from !== "" || to !== "") && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFrom("");
                  setTo("");
                }}
              >
                {t("dates.clear")}
              </Button>
            )}
          </div>
        )}

        {rows === null && (
          <p className="text-muted-foreground text-sm">{t("loading")}</p>
        )}

        {rows !== null && visible.length === 0 && (
          <p className="text-muted-foreground rounded-2xl border border-dashed p-8 text-center text-sm">
            {duePaid
              ? from !== "" || to !== ""
                ? t("emptyRange")
                : t("emptyPaid")
              : view === "due"
              ? t("emptyDue")
              : view === "open"
                ? t("emptyOpen")
                : from !== "" || to !== ""
                  ? t("emptyRange")
                  : tab === "unpaid"
                    ? t("emptyUnpaid")
                    : t("emptyPaid")}
          </p>
        )}

        {/* Due and Open: the family is who pays — one compact card per parent, each child's package a
            line in it (Open's line carries the whole subscription). Masonry columns, not a grid: a
            one-child card stays short instead of stretching to the height of a three-child card. */}
        {duePaid ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {visible.map((row) => (
              <PaidPackageCard
                key={row.id}
                row={row}
                timezone={timezone}
                onOpenDetail={() => openDetail(row)}
              />
            ))}
          </div>
        ) : view === "due" || view === "open" ? (
          <div className="columns-1 gap-3 md:columns-2 xl:columns-3">
            {groupDueByFamily(visible).map((family) => (
              <FamilyDueGroup
                key={family.key}
                view={view}
                family={family}
                timezone={timezone}
                canSendInvoice={canSendInvoice}
                actionProps={actionProps}
                onMessageOpened={() => showAlert("success", t("alerts.paymentReady"))}
              />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {visible.map((row) => (
              <PackageCard key={row.id} timezone={timezone} {...actionProps(row)} />
            ))}
          </div>
        )}
      </div>

      {modals}
    </div>
  );
}
