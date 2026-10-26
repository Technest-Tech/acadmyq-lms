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
import { ClosePackageModal } from "@/components/packages/close-package-modal";
import { EditPackageForm } from "@/components/packages/edit-package-form";
import { FamilyDueGroup, groupDueByFamily } from "@/components/packages/family-due-group";
import { MarkPaidModal } from "@/components/invoices/mark-paid-modal";
import { OpenPackageForm } from "@/components/packages/open-package-form";
import {
  isPackagePaid,
  PackageCard,
} from "@/components/packages/package-card";
import { PackageDetail } from "@/components/packages/package-detail";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { HeroPill, PageHero } from "@/components/ui/page-hero";
import {
  ApiError,
  billPackageOverdraft,
  closeLessonPackage,
  getLessonPackageSummary,
  listLessonPackages,
  remindLessonPackage,
  sendInvoicePaymentLink,
  syncLessonPackage,
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
  const canMarkPaid = can("invoice.mark_paid");
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
  const [modal, setModal] = useState<
    | { kind: "closed" }
    | { kind: "open"; studentId?: string }
    | { kind: "detail"; row: LessonPackageRow }
    | { kind: "edit"; row: LessonPackageRow }
    | { kind: "close"; row: LessonPackageRow }
    | { kind: "toMonthly"; row: LessonPackageRow }
    | { kind: "markPaid"; row: LessonPackageRow }
  >({ kind: "closed" });
  const [busy, setBusy] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [remindingId, setRemindingId] = useState<string | null>(null);
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
   * `/packages?open=<studentId>` opens the form with that student already chosen.
   *
   * It is how the student's profile links here. The profile shows the balance and links to the
   * action; the action itself only ever exists on this screen, so there is still exactly one form
   * and one place a package is entered — the link just saves the owner from finding the student
   * again in a picker they arrived from.
   */
  // Optional-chained because useSearchParams() genuinely returns null when the component renders
  // outside a Next router — which is every unit test of this screen. No link, no deep link.
  const params = useSearchParams();
  const deepLinkStudent = params?.get("open") ?? null;
  useEffect(() => {
    if (deepLinkStudent) setModal({ kind: "open", studentId: deepLinkStudent });
  }, [deepLinkStudent]);

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

  /** This page's packages, before search and filter. */
  const pageRows = useMemo(
    () =>
      (rows ?? []).filter((r) =>
        view === "due"
          ? r.due
          : view === "open"
            ? r.status === "ACTIVE"
            : r.status !== "ACTIVE",
      ),
    [rows, view],
  );
  const paidCount = pageRows.filter(isPackagePaid).length;
  const unpaidCount = pageRows.length - paidCount;
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
      if (view !== "finished") return true;
      if (isPackagePaid(r) !== (tab === "paid")) return false;
      const day = localDay(finishedDate(r), timezone);
      return (from === "" || day >= from) && (to === "" || day <= to);
    });

    if (view === "finished") {
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
  }, [pageRows, query, view, tab, from, to, timezone, finishedDate]);

  /**
   * A student whose block ran out, moved back to the monthly clock. The same close endpoint as
   * closing early with "return to monthly" ticked — on a package that already closed itself it
   * changes nothing about the package and only flips the billing mode.
   */
  async function confirmReturnToMonthly(row: LessonPackageRow) {
    setBusy(true);
    try {
      await closeLessonPackage(row.id, undefined, true);
      setModal({ kind: "closed" });
      refresh();
      showAlert(
        "success",
        t("alerts.returnedToMonthly", { name: row.student_name }),
      );
    } catch {
      showAlert("error", t("alerts.returnFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function billOverdraft(row: LessonPackageRow) {
    try {
      await billPackageOverdraft(row.id);
      refresh();
      showAlert("success", t("alerts.overdraftBilled"));
    } catch {
      showAlert("error", t("alerts.overdraftFailed"));
    }
  }

  async function syncLessons(row: LessonPackageRow) {
    setSyncingId(row.id);
    try {
      const result = await syncLessonPackage(row.id);
      refresh();
      showAlert(
        "success",
        result.skipped_locked > 0
          ? t("alerts.syncedWithLocked", {
              imported: result.imported,
              locked: result.skipped_locked,
            })
          : t("alerts.synced", { count: result.imported }),
      );
    } catch {
      showAlert("error", t("alerts.syncFailed"));
    } finally {
      setSyncingId(null);
    }
  }

  async function sendPayment(row: LessonPackageRow) {
    if (row.invoice_id === null) return;
    setSendingId(row.id);
    try {
      const result = await sendInvoicePaymentLink(row.invoice_id);
      if (!result.sent && result.phone) {
        const digits = result.phone.replace(/\D+/g, "");
        window.open(
          `https://wa.me/${digits}?text=${encodeURIComponent(result.message)}`,
          "_blank",
          "noopener,noreferrer",
        );
      }
      showAlert(
        "success",
        result.sent ? t("alerts.paymentSent") : t("alerts.paymentReady"),
      );
    } catch {
      showAlert("error", t("alerts.paymentFailed"));
    } finally {
      setSendingId(null);
    }
  }

  /**
   * Remind the payer — pay what is due, or renew a block that ran out (the server picks which).
   * It opens WhatsApp the ordinary way, with the message written, and the staff member sends it —
   * never through the gateway. Counted on the package either way, so the next person on the case
   * can see the family has already been chased, how often, and when.
   */
  async function remind(row: LessonPackageRow) {
    setRemindingId(row.id);
    // Opened on the click itself: a tab opened after the request returns is a popup the browser
    // is entitled to block. It is pointed at WhatsApp once the message is ready.
    const tab = window.open("", "_blank");
    try {
      const result = await remindLessonPackage(row.id, locale);
      if (tab !== null) {
        tab.opener = null;
        tab.location.href = result.deeplink;
      } else {
        window.open(result.deeplink, "_blank", "noopener,noreferrer");
      }
      setRows((prev) =>
        (prev ?? []).map((r) =>
          r.id === row.id
            ? {
                ...r,
                reminders_sent: result.reminders_sent,
                last_reminded_at: result.last_reminded_at,
              }
            : r,
        ),
      );
      showAlert("success", t("alerts.reminderReady"));
    } catch (err) {
      tab?.close();
      showAlert(
        "error",
        err instanceof ApiError && err.message
          ? err.message
          : t("alerts.reminderFailed"),
      );
    } finally {
      setRemindingId(null);
    }
  }

  const renderCard = (row: LessonPackageRow) => (
    <PackageCard
      key={row.id}
      row={row}
      timezone={timezone}
      canManage={canManage}
      canSendInvoice={canSendInvoice}
      canMarkPaid={canMarkPaid}
      syncing={syncingId === row.id}
      sendingPayment={sendingId === row.id}
      reminding={remindingId === row.id}
      onRemind={() => void remind(row)}
      onOpenDetail={() => setModal({ kind: "detail", row })}
      onEdit={() => setModal({ kind: "edit", row })}
      onClose={() => setModal({ kind: "close", row })}
      onBillOverdraft={() => void billOverdraft(row)}
      onSyncLessons={() => void syncLessons(row)}
      onSendPayment={() => void sendPayment(row)}
      onMarkPaid={() => setModal({ kind: "markPaid", row })}
      onRenew={() => setModal({ kind: "open", studentId: row.student_id })}
      onReturnToMonthly={() => setModal({ kind: "toMonthly", row })}
    />
  );

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
                {t("hero.due", { count: pageRows.length })}
              </span>
            )}
            {view === "due" &&
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
                onClick={() => setModal({ kind: "open" })}
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
          {view === "finished" && (
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
                  {t(`finishedTab.${key}`, {
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

        {view === "finished" && (
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
            {view === "due"
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

        {/* Due: the family is who pays, so a parent's children sit under one card with the total. */}
        {view === "due" ? (
          <div className="space-y-3">
            {groupDueByFamily(visible).map((family) => (
              <FamilyDueGroup
                key={family.key}
                family={family}
                canSendInvoice={canSendInvoice}
                onMessageOpened={() => showAlert("success", t("alerts.paymentReady"))}
              >
                {family.rows.map(renderCard)}
              </FamilyDueGroup>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {visible.map(renderCard)}
          </div>
        )}
      </div>

      {/* ── Open ─────────────────────────────────────────────────────── */}
      <Modal
        open={modal.kind === "open"}
        onClose={() => setModal({ kind: "closed" })}
        title={t("form.title")}
        description={t("form.description")}
        size="md"
      >
        {modal.kind === "open" && (
          <OpenPackageForm
            initialStudentId={modal.studentId}
            studentsWithHistory={studentsWithHistory}
            onCancel={() => setModal({ kind: "closed" })}
            onSaved={(message) => {
              setModal({ kind: "closed" });
              refresh();
              showAlert("success", message);
            }}
          />
        )}
      </Modal>

      {/* ── Correct the terms ────────────────────────────────────────── */}
      <Modal
        open={modal.kind === "edit"}
        onClose={() => setModal({ kind: "closed" })}
        title={t("edit.title")}
        description={t("edit.description")}
        size="md"
      >
        {modal.kind === "edit" && (
          <EditPackageForm
            row={modal.row}
            onCancel={() => setModal({ kind: "closed" })}
            onSaved={(message) => {
              setModal({ kind: "closed" });
              refresh();
              showAlert("success", message);
            }}
          />
        )}
      </Modal>

      {/* ── The ledger ───────────────────────────────────────────────── */}
      <Modal
        open={modal.kind === "detail"}
        onClose={() => setModal({ kind: "closed" })}
        title={modal.kind === "detail" ? modal.row.student_name : ""}
        description={modal.kind === "detail" ? modal.row.label : undefined}
        size="lg"
      >
        {modal.kind === "detail" && (
          <PackageDetail
            row={modal.row}
            timezone={timezone}
            canManage={canManage}
            onChanged={refresh}
          />
        )}
      </Modal>

      {/* ── Close early ──────────────────────────────────────────────── */}
      <ClosePackageModal
        row={modal.kind === "close" ? modal.row : null}
        onClose={() => setModal({ kind: "closed" })}
        onDone={(message) => {
          setModal({ kind: "closed" });
          refresh();
          showAlert("success", message);
        }}
        onError={(message) => showAlert("error", message)}
      />

      {/* ── Out of hours → back to monthly ───────────────────────────── */}
      <Modal
        open={modal.kind === "toMonthly"}
        onClose={() => setModal({ kind: "closed" })}
        title={t("toMonthly.title")}
        size="sm"
      >
        {modal.kind === "toMonthly" && (
          <div className="space-y-4">
            <p className="text-muted-foreground text-sm">
              {t("toMonthly.body", { name: modal.row.student_name })}
            </p>
            <div className="flex items-center justify-end gap-2 border-t pt-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setModal({ kind: "closed" })}
                disabled={busy}
              >
                {t("actions.cancel")}
              </Button>
              <Button
                size="sm"
                onClick={() => void confirmReturnToMonthly(modal.row)}
                disabled={busy}
                data-testid="confirm-to-monthly"
              >
                {t("toMonthly.confirm")}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {modal.kind === "markPaid" && modal.row.invoice_id !== null && (
        <MarkPaidModal
          open
          invoiceId={modal.row.invoice_id}
          totalMinor={modal.row.invoice_total_minor}
          currency={modal.row.currency}
          onClose={() => setModal({ kind: "closed" })}
          onSuccess={() => {
            setModal({ kind: "closed" });
            refresh();
            showAlert("success", t("alerts.markedPaid"));
          }}
        />
      )}
    </div>
  );
}
