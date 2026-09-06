"use client";

import {
  AlertTriangle,
  CircleDollarSign,
  Hourglass,
  Layers,
  Plus,
  Timer,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { OpenPackageForm } from "@/components/packages/open-package-form";
import { PackageCard } from "@/components/packages/package-card";
import { PackageDetail } from "@/components/packages/package-detail";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { HeroPill, PageHero } from "@/components/ui/page-hero";
import { SegmentTile } from "@/components/ui/segment-tile";
import {
  billPackageOverdraft,
  closeLessonPackage,
  getLessonPackageSummary,
  listLessonPackages,
  sendInvoicePaymentLink,
  syncLessonPackage,
  type LessonPackageRow,
  type LessonPackageSummary,
} from "@/lib/api";
import { formatHours } from "@/lib/time";

/**
 * Which cut of the record you are looking at.
 *
 * "Attention" is the one that matters: it is the same set the sidebar badge counts, so the
 * number on the nav item and the rows you land on can never disagree. It is filtered on the
 * client because it spans three different server conditions (running low, finished and unpaid,
 * overdraft still stranded) that no single query parameter expresses — and the list is capped at
 * 500 rows, which is one academy's entire package history.
 */
type SegmentKey = "attention" | "active" | "completed" | "all";

/**
 * The Packages screen: every block of hours the academy has sold, how much of each is left, and
 * what is still owed on it.
 *
 * The screen leads with work rather than with totals. An owner opens this page for one of three
 * reasons — someone is about to run out, someone finished and hasn't paid, or someone's last
 * lesson ran past the end of their block — so those are the three counters, and each one filters
 * the list beneath it.
 */
export function PackagesManager() {
  const t = useTranslations("packages");
  const locale = useLocale();
  const { can } = useAuth();
  const canManage = can("package.manage");
  const canSendInvoice = can("invoice.send_link");
  const timezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
    [],
  );

  const [rows, setRows] = useState<LessonPackageRow[] | null>(null);
  const [summary, setSummary] = useState<LessonPackageSummary | null>(null);
  const [segment, setSegment] = useState<SegmentKey>("attention");
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState<
    | { kind: "closed" }
    | { kind: "open" }
    | { kind: "detail"; row: LessonPackageRow }
    | { kind: "close"; row: LessonPackageRow }
  >({ kind: "closed" });
  const [busy, setBusy] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [closeReason, setCloseReason] = useState("");
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

  function showAlert(variant: "success" | "error", message: string) {
    setAlert({ variant, message });
    if (variant === "success") setTimeout(() => setAlert(null), 4500);
  }

  /** Pressing the active tile returns to the whole record — a toggle, not a one-way trip. */
  function selectSegment(key: SegmentKey) {
    setSegment((prev) => (prev === key ? "all" : key));
  }

  const needsAttention = useCallback(
    (row: LessonPackageRow) =>
      (row.status === "ACTIVE" && row.minutes_remaining <= 60) ||
      (row.status === "COMPLETED" && row.outstanding_minor > 0) ||
      (row.status === "COMPLETED" &&
        row.invoice_id === null &&
        row.minutes_consumed > 0) ||
      (row.minutes_overdrawn > 0 && !row.overdraft_billed),
    [],
  );

  const visible = useMemo(() => {
    const all = rows ?? [];
    const needle = query.trim().toLowerCase();
    const matched =
      needle === ""
        ? all
        : all.filter((r) => r.student_name.toLowerCase().includes(needle));

    switch (segment) {
      case "attention":
        return matched.filter(needsAttention);
      case "active":
        return matched.filter((r) => r.status === "ACTIVE");
      case "completed":
        return matched.filter((r) => r.status === "COMPLETED");
      default:
        return matched;
    }
  }, [rows, query, segment, needsAttention]);

  async function confirmClose(row: LessonPackageRow) {
    setBusy(true);
    try {
      await closeLessonPackage(row.id, closeReason.trim() || undefined);
      setModal({ kind: "closed" });
      setCloseReason("");
      refresh();
      showAlert("success", t("alerts.closed"));
    } catch {
      showAlert("error", t("alerts.closeFailed"));
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

  return (
    <div className="space-y-5">
      <PageHero
        latticeId="packages-hero-lattice"
        icon={Layers}
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <>
            {summary !== null && summary.total > 0 && (
              <span className="border-gold/50 bg-gold text-gold-foreground inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold shadow-sm">
                <AlertTriangle className="size-3.5" aria-hidden />
                {t("hero.attention", { count: summary.total })}
              </span>
            )}
            {summary !== null && (
              <HeroPill>
                <Timer className="size-3.5" aria-hidden />
                {t("hero.active", { count: summary.active })}
              </HeroPill>
            )}
            {canManage && (
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

      {/* ── The three reasons to be here ──────────────────────────────── */}
      <div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SegmentTile
            testKey="attention"
            icon={AlertTriangle}
            label={t("stats.attention")}
            hint={t("stats.attentionSub")}
            value={summary?.total ?? null}
            share={null}
            tone="gold"
            selected={segment === "attention"}
            onSelect={() => selectSegment("attention")}
          />
          <SegmentTile
            testKey="low"
            icon={Hourglass}
            label={t("stats.low")}
            hint={t("stats.lowSub")}
            value={summary?.lowBalance ?? null}
            share={null}
            tone="violet"
            selected={false}
            onSelect={() => selectSegment("attention")}
          />
          <SegmentTile
            testKey="unpaid"
            icon={CircleDollarSign}
            label={t("stats.unpaid")}
            hint={t("stats.unpaidSub")}
            value={summary?.unpaid ?? null}
            share={null}
            tone="slate"
            selected={false}
            onSelect={() => selectSegment("attention")}
          />
          <SegmentTile
            testKey="active"
            icon={Timer}
            label={t("stats.active")}
            hint={t("stats.activeSub")}
            value={summary?.active ?? null}
            share={null}
            tone="emerald"
            selected={segment === "active"}
            onSelect={() => selectSegment("active")}
          />
        </div>
        <p className="text-muted-foreground/80 mt-2 text-[11px]">
          {t("stats.filterHint")}
        </p>
      </div>

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
          <div className="flex gap-1.5">
            {(["attention", "active", "completed", "all"] as const).map(
              (key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSegment(key)}
                  className={
                    segment === key
                      ? "bg-primary/10 text-primary rounded-lg px-2.5 py-1 text-xs font-semibold"
                      : "text-muted-foreground hover:bg-muted/50 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors"
                  }
                >
                  {t(`segments.${key}`)}
                </button>
              ),
            )}
          </div>
        </div>

        {rows === null && (
          <p className="text-muted-foreground text-sm">{t("loading")}</p>
        )}

        {rows !== null && visible.length === 0 && (
          <p className="text-muted-foreground rounded-2xl border border-dashed p-8 text-center text-sm">
            {segment === "attention" ? t("emptyAttention") : t("empty")}
          </p>
        )}

        <div className="grid items-stretch gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {visible.map((row) => (
            <PackageCard
              key={row.id}
              row={row}
              timezone={timezone}
              canManage={canManage}
              canSendInvoice={canSendInvoice}
              syncing={syncingId === row.id}
              sendingPayment={sendingId === row.id}
              onOpenDetail={() => setModal({ kind: "detail", row })}
              onClose={() => {
                setCloseReason("");
                setModal({ kind: "close", row });
              }}
              onBillOverdraft={() => void billOverdraft(row)}
              onSyncLessons={() => void syncLessons(row)}
              onSendPayment={() => void sendPayment(row)}
            />
          ))}
        </div>
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
          <PackageDetail row={modal.row} timezone={timezone} />
        )}
      </Modal>

      {/* ── Close early ──────────────────────────────────────────────── */}
      <Modal
        open={modal.kind === "close"}
        onClose={() => setModal({ kind: "closed" })}
        title={t("close.title")}
        description={t("close.description")}
        size="sm"
      >
        {modal.kind === "close" && (
          <div className="space-y-4">
            <p className="text-muted-foreground text-sm">
              {t("close.remaining", {
                left: formatHours(modal.row.minutes_remaining, locale),
              })}
            </p>
            {modal.row.bill_timing === "ON_COMPLETION" && (
              <p className="rounded-xl bg-amber-500/10 px-3 py-2.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                {t("close.proRataNote")}
              </p>
            )}
            <div className="space-y-1.5">
              <label htmlFor="pkg-close-reason" className="text-sm font-medium">
                {t("close.reason")}
              </label>
              <input
                id="pkg-close-reason"
                value={closeReason}
                onChange={(e) => setCloseReason(e.target.value)}
                placeholder={t("close.reasonPlaceholder")}
                className="border-input bg-background focus:border-primary focus:ring-primary/15 w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition-colors focus:ring-3"
              />
            </div>
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
                onClick={() => void confirmClose(modal.row)}
                disabled={busy}
              >
                {t("close.confirm")}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
