"use client";

import { academyTimeZone } from "@/lib/academy-clock";
import { Plus } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { DueStats, PaidStats, PaidTable } from "@/components/packages/due-table";
import { FamilyColumns, familyWeight, groupDueByFamily } from "@/components/packages/family-card";
import { FamilyDueGroup } from "@/components/packages/family-due-group";
import {
  isRanOut,
  isRunningLow,
  matchesOpenFilter,
  OpenFamilyCard,
  OpenStats,
  type OpenFilter,
} from "@/components/packages/open-table";
import { usePackageActions } from "@/components/packages/use-package-actions";
import { isPackageBillPaid, PaidPackageCard, paidAmount } from "@/components/packages/paid-package-card";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  getLessonPackageSummary,
  listLessonPackages,
  type LessonPackageRow,
  type LessonPackageSummary,
} from "@/lib/api";
import { formatNumber } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * The two pages of the packages screen, each its own sidebar item. Finished was dropped (Ahmed
 * 2026-11-22): what a finished block owes is on Due, what was paid is on Due's Paid tab, and a
 * student still taught after their block ran out shows on Open.
 */
export type PackagesView = "due" | "open";

/** Due's two tabs: what is still owed, and what was paid (with the receipt). */
type DueTab = "unpaid" | "paid";

/** The day a paid row is filtered and sorted on: when its bill was paid. */
function paidDate(r: LessonPackageRow): string {
  return r.paid_at ?? r.closed_at ?? r.created_at;
}

/** A timestamp as the calendar day it fell on here — what a from/to date input compares against. */
function localDay(iso: string, timezone: string): string {
  // en-CA formats as YYYY-MM-DD, the same shape <input type="date"> produces.
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(
    new Date(iso),
  );
}

/**
 * The Packages screen, split in two pages:
 *
 *   • Due — every block with money still owed on it, open or finished, oldest debt first. The
 *     page the academy opens every day: payment is up front, so a block that opened this morning
 *     and is not yet paid belongs here. Its Paid tab is the history of what came in.
 *   • Open packages — one plain table for supervisors: who, how much is left, the next lesson,
 *     and whether it is paid. A student still taught after their block ran out (nothing renewed)
 *     is listed here too, leading with Renew. The stat cards above it are its filters.
 *
 * Both pages read the same list; it is split on the client because the open-package form needs
 * the finished history either way (to offer carrying hours over).
 */
export function PackagesManager({ view = "open" }: { view?: PackagesView }) {
  const t = useTranslations("packages");
  const locale = useLocale();
  const { can } = useAuth();
  const canManage = can("package.manage");
  const canSendInvoice = can("invoice.send_link");
  const timezone = useMemo(
    () => academyTimeZone(),
    [],
  );

  const [rows, setRows] = useState<LessonPackageRow[] | null>(null);
  const [summary, setSummary] = useState<LessonPackageSummary | null>(null);
  const [tab, setTab] = useState<DueTab>("unpaid");
  const [openFilter, setOpenFilter] = useState<OpenFilter>("all");
  // Inclusive day range over the day the bill was paid — Due's Paid tab only.
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

  const { actionProps, openNew, openDetail, openPrepay, modals } = usePackageActions({
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
  const dueRows = useMemo(() => (rows ?? []).filter((r) => r.due), [rows]);
  const dueCount = dueRows.length;
  const billPaidCount = useMemo(() => (rows ?? []).filter(isPackageBillPaid).length, [rows]);

  /**
   * This page's packages, before search and filter. Open: every running block, plus a student's
   * last block that ran out while they are still being taught with nothing renewed.
   */
  const pageRows = useMemo(
    () =>
      (rows ?? []).filter((r) =>
        view === "due"
          ? tab === "paid"
            ? isPackageBillPaid(r)
            : r.due
          : r.status === "ACTIVE" || isRanOut(r),
      ),
    [rows, view, tab],
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
      if (view === "open") return matchesOpenFilter(r, openFilter);
      if (!duePaid) return true;
      const day = localDay(paidDate(r), timezone);
      return (from === "" || day >= from) && (to === "" || day <= to);
    });

    if (duePaid) {
      // Most recent first: the latest to be paid.
      return [...matched].sort((a, b) => paidDate(b).localeCompare(paidDate(a)));
    }

    if (view === "due") {
      // The oldest debt first — it has waited longest.
      return [...matched].sort((a, b) => a.created_at.localeCompare(b.created_at));
    }

    // On Open, what needs a hand first: a block that ran out with the student still coming, a
    // block opened over an unpaid one, then a block about to run out. Otherwise the server's
    // newest-first order.
    const rank = (r: LessonPackageRow) =>
      isRanOut(r) ? 0 : r.previous_unpaid !== null ? 1 : isRunningLow(r) ? 2 : 3;
    return matched
      .map((row, i) => ({ row, i }))
      .sort((a, b) => rank(a.row) - rank(b.row) || a.i - b.i)
      .map(({ row }) => row);
  }, [pageRows, query, view, duePaid, openFilter, from, to, timezone]);

  /** The page's packages under their families, in the page's order. */
  const dueFamilies = useMemo(() => (view === "due" && !duePaid ? groupDueByFamily(visible) : []), [view, duePaid, visible]);
  const openFamilies = useMemo(() => (view === "open" ? groupDueByFamily(visible) : []), [view, visible]);

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
      {/* No hero on either page (Ahmed 2026-11-22): the stat cards lead, and "Open a package"
          sits by the search. */}

      {alert && (
        <AlertBanner
          variant={alert.variant}
          message={alert.message}
          onDismiss={() => setAlert(null)}
        />
      )}

      {/* Due: the page's figures as coloured cards (Ahmed 2026-11-22) — over every due package on
          the unpaid tab, over what the dates show on the paid one. */}
      {view === "due" && rows !== null &&
        (duePaid ? (
          <PaidStats count={visible.length} collected={collected} />
        ) : (
          <DueStats rows={dueRows} dueAmounts={summary?.dueAmounts} />
        ))}

      {/* Open: four cards that are also the table's filters (all · running low · unpaid · ran out). */}
      {view === "open" && rows !== null && (
        <OpenStats rows={pageRows} filter={openFilter} onFilter={setOpenFilter} />
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
          {canManage && view === "open" && (
            <Button onClick={() => openNew()} data-testid="open-package" className="gap-2">
              <Plus className="size-4" aria-hidden />
              {t("actions.open")}
            </Button>
          )}
          {view === "due" && (
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
                  {t(`dueTab.${key}`, {
                    count: formatNumber(key === "paid" ? billPaidCount : dueCount, locale),
                  })}
                </button>
              ))}
            </div>
          )}
        </div>

        {duePaid && (
          <div className="flex flex-wrap items-end gap-2" data-testid="finished-dates">
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground block font-medium">
                {t("dates.paidFrom")}
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
                : openFilter !== "all"
                  ? t("openStats.emptyFilter")
                  : t("emptyOpen")}
          </p>
        )}

        {/* Due and Open are the same small family tiles (Ahmed 2026-11-24), as many columns as fit
            and no holes — dealt in each page's own order (Due: oldest debt; Open: what needs a
            hand). Due's Paid tab stays a compact table from laptop width up, cards below it. */}
        {duePaid && visible.length > 0 ? (
          <>
            <PaidTable rows={visible} timezone={timezone} onOpenDetail={openDetail} />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:hidden">
              {visible.map((row) => (
                <PaidPackageCard
                  key={row.id}
                  row={row}
                  timezone={timezone}
                  onOpenDetail={() => openDetail(row)}
                />
              ))}
            </div>
          </>
        ) : duePaid ? null : view === "due" && visible.length > 0 ? (
          <FamilyColumns testId="due-cards" weights={dueFamilies.map((f) => familyWeight(f, f.rows.length > 1 ? 0.4 : 0))}>
            {dueFamilies.map((family) => (
              <FamilyDueGroup
                key={family.key}
                family={family}
                timezone={timezone}
                canSendInvoice={canSendInvoice}
                actionProps={actionProps}
                onMessageOpened={() => showAlert("success", t("alerts.paymentReady"))}
                onPrepay={can("package.manage") && can("invoice.mark_paid") ? openPrepay : undefined}
              />
            ))}
          </FamilyColumns>
        ) : view === "open" && visible.length > 0 ? (
          <FamilyColumns testId="open-cards" weights={openFamilies.map((f) => familyWeight(f))}>
            {openFamilies.map((family) => (
              <OpenFamilyCard key={family.key} family={family} timezone={timezone} actionProps={actionProps} />
            ))}
          </FamilyColumns>
        ) : null}
      </div>

      {modals}
    </div>
  );
}
