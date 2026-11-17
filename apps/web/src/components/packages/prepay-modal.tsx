"use client";

import { CalendarCheck, Loader2, Minus, Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { academyToday } from "@/lib/academy-clock";
import { ApiError, prepayPackages, type LessonPackageRow } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

const MAX_BLOCKS = 12;

const inputClass =
  "border-input bg-background focus:border-primary focus:ring-primary/15 w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:ring-3 disabled:opacity-50";

/** What one more block of this package will cost, in the currency it will be billed in. */
function nextBlock(row: LessonPackageRow): { price: number; currency: string } {
  return {
    price: row.next_terms?.price_minor ?? row.price_minor,
    currency: (row.next_terms?.currency ?? row.currency).trim(),
  };
}

interface Draft {
  on: boolean;
  blocks: number;
  includeCurrent: boolean;
}

/**
 * Pay packages ahead (Ahmed 2026-11-17: "two months in advance, for one student or more, so the
 * system doesn't bring them to Due until the paid period is over"). One line per child — how many
 * coming packages, and whether the running one's unpaid bill is paid with them — and ONE payment for
 * all of it. Each renewal then opens already paid; when the paid ones run out, Due picks the
 * family up again.
 */
export function PrepayModal({
  rows,
  onClose,
  onDone,
}: {
  /** Each child's running package (one per child). */
  rows: LessonPackageRow[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const t = useTranslations("packages.prepay");
  const tInv = useTranslations("invoices");
  const locale = useLocale();
  const eligible = useMemo(() => rows.filter((r) => r.status === "ACTIVE" && r.bill_timing === "ON_START"), [rows]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(eligible.map((r) => [r.id, { on: true, blocks: 2, includeCurrent: r.outstanding_minor > 0 }])),
  );
  const [method, setMethod] = useState<"CASH" | "BANK_TRANSFER" | "OTHER">("CASH");
  const [reference, setReference] = useState("");
  const [paidOn, setPaidOn] = useState(() => academyToday());
  const [proof, setProof] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = eligible.filter((r) => drafts[r.id]?.on);
  const money = (amount: number, currency: string) => formatMoney({ amount, currency }, locale);

  // What comes in now, per currency — never summed across currencies.
  const totals = useMemo(() => {
    const out = new Map<string, number>();
    for (const r of chosen) {
      const d = drafts[r.id]!;
      const { price, currency } = nextBlock(r);
      out.set(currency, (out.get(currency) ?? 0) + d.blocks * price);
      if (d.includeCurrent && r.outstanding_minor > 0) {
        out.set(r.currency.trim(), (out.get(r.currency.trim()) ?? 0) + r.outstanding_minor);
      }
    }
    return [...out.entries()];
  }, [chosen, drafts]);

  function patch(id: string, next: Partial<Draft>) {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id]!, ...next } }));
  }

  async function save() {
    if (chosen.length === 0) {
      setError(t("pickOne"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await prepayPackages({
        students: chosen.map((r) => ({
          student_id: r.student_id,
          blocks: drafts[r.id]!.blocks,
          include_current: drafts[r.id]!.includeCurrent && r.outstanding_minor > 0,
        })),
        payment_method: method,
        payment_reference: reference.trim() || undefined,
        paid_on: paidOn,
        proof,
      });
      onDone(
        t("saved", {
          blocks: res.prepayments.reduce((n, p) => n + p.blocks, 0),
          amount: res.totals.map((x) => money(x.amount_minor, x.currency)).join(" + "),
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      title={t("title")}
      description={t("subtitle")}
      size="lg"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold tabular-nums" data-testid="prepay-total">
            {totals.length > 0 ? `${t("total")}: ${totals.map(([c, a]) => money(a, c)).join(" + ")}` : null}
          </span>
          <span className="flex gap-2">
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy || chosen.length === 0}
              onClick={() => void save()}
              data-testid="prepay-save"
              className="gap-1.5"
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <CalendarCheck className="size-3.5" aria-hidden />}
              {t("save")}
            </Button>
          </span>
        </div>
      }
    >
      <div className="space-y-4" data-testid="prepay-modal">
        {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}

        {eligible.length === 0 ? (
          <p className="text-muted-foreground rounded-xl border border-dashed px-3 py-2.5 text-sm">{t("none")}</p>
        ) : (
          <ul className="divide-y rounded-xl border">
            {eligible.map((r) => {
              const d = drafts[r.id]!;
              const { price, currency } = nextBlock(r);
              return (
                <li key={r.id} className={cn("space-y-2.5 px-3.5 py-3", !d.on && "opacity-60")} data-testid={`prepay-row-${r.student_id}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="flex min-w-0 items-center gap-2">
                      {eligible.length > 1 && (
                        <input
                          type="checkbox"
                          checked={d.on}
                          onChange={(e) => patch(r.id, { on: e.target.checked })}
                          className="accent-primary"
                          data-testid={`prepay-on-${r.student_id}`}
                        />
                      )}
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{r.student_name}</span>
                        <span className="text-muted-foreground block text-xs">
                          {t("perBlock", { price: money(price, currency) })}
                          {(r.prepaid_blocks_left ?? 0) > 0 && <> · {t("alreadyAhead", { count: r.prepaid_blocks_left ?? 0 })}</>}
                        </span>
                      </span>
                    </label>
                    {/* How many coming packages: a stepper, 1 to 12. */}
                    <div className="flex items-center gap-1.5" aria-label={t("blocks")}>
                      <span className="text-muted-foreground text-xs">{t("blocks")}</span>
                      <button
                        type="button"
                        disabled={!d.on || d.blocks <= 1}
                        onClick={() => patch(r.id, { blocks: d.blocks - 1 })}
                        className="hover:bg-muted flex size-7 items-center justify-center rounded-lg border disabled:opacity-40"
                        aria-label={t("fewer")}
                      >
                        <Minus className="size-3.5" aria-hidden />
                      </button>
                      <span className="w-6 text-center text-sm font-bold tabular-nums" data-testid={`prepay-blocks-${r.student_id}`}>
                        {d.blocks}
                      </span>
                      <button
                        type="button"
                        disabled={!d.on || d.blocks >= MAX_BLOCKS}
                        onClick={() => patch(r.id, { blocks: d.blocks + 1 })}
                        className="hover:bg-muted flex size-7 items-center justify-center rounded-lg border disabled:opacity-40"
                        aria-label={t("more")}
                        data-testid={`prepay-more-${r.student_id}`}
                      >
                        <Plus className="size-3.5" aria-hidden />
                      </button>
                    </div>
                  </div>
                  {r.outstanding_minor > 0 && (
                    <label className="bg-amber-500/[0.07] flex cursor-pointer items-start gap-2 rounded-lg px-2.5 py-2 text-xs">
                      <input
                        type="checkbox"
                        checked={d.includeCurrent}
                        disabled={!d.on}
                        onChange={(e) => patch(r.id, { includeCurrent: e.target.checked })}
                        className="accent-primary mt-0.5"
                        data-testid={`prepay-current-${r.student_id}`}
                      />
                      <span>{t("includeCurrent", { n: r.sequence_no, amount: money(r.outstanding_minor, r.currency.trim()) })}</span>
                    </label>
                  )}
                  <p className="text-muted-foreground text-[11px]">
                    {t("coverage", { blocks: d.blocks, amount: money(d.blocks * price, currency) })}
                  </p>
                </li>
              );
            })}
          </ul>
        )}

        {/* One payment for everything above. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="block text-sm font-medium">{tInv("paymentMethod")}</span>
            <select value={method} onChange={(e) => setMethod(e.target.value as typeof method)} className={inputClass} data-testid="prepay-method">
              <option value="CASH">{tInv("methodCash")}</option>
              <option value="BANK_TRANSFER">{tInv("methodBankTransfer")}</option>
              <option value="OTHER">{tInv("methodOther")}</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="block text-sm font-medium">{t("paidOn")}</span>
            <input type="date" value={paidOn} max={academyToday()} onChange={(e) => setPaidOn(e.target.value)} className={inputClass} data-testid="prepay-paid-on" />
          </label>
          <label className="space-y-1">
            <span className="block text-sm font-medium">
              {tInv("paymentReference")} <span className="text-muted-foreground text-xs font-normal">({tInv("optional")})</span>
            </span>
            <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={255} className={inputClass} placeholder={tInv("paymentReferencePlaceholder")} />
          </label>
          <label className="space-y-1">
            <span className="block text-sm font-medium">
              {tInv("paymentProof")} <span className="text-muted-foreground text-xs font-normal">({tInv("optional")})</span>
            </span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => setProof(e.target.files?.[0] ?? null)}
              className="text-muted-foreground block w-full text-xs file:me-2 file:rounded-md file:border file:bg-transparent file:px-2 file:py-1"
            />
          </label>
        </div>

        <p className="text-muted-foreground rounded-xl border border-sky-300/60 bg-sky-500/[0.06] px-3 py-2.5 text-xs dark:border-sky-800/50">
          {t("how")}
        </p>
      </div>
    </Modal>
  );
}
