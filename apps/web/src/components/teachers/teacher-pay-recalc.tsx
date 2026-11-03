"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  ApiError,
  carryPayoutReprice,
  getPayRecalc,
  repricePayout,
  type PayRecalcStatement,
} from "@/lib/api";
import { formatMoney } from "@/lib/money";

/**
 * Applies the teacher's saved pay to statements already written: lessons keep the rate they were
 * marked at, so a rate entered afterwards reaches them only through here. A statement is re-priced in
 * place, sealed or not; one paid from the treasury stays and its difference lands on the open one.
 */
export function TeacherPayRecalc({
  teacherId,
  refreshKey,
  dirty,
  onApplied,
}: {
  teacherId: string;
  /** Bumped after a save, when the differences have moved. */
  refreshKey: number;
  /** The form holds unsaved changes: the figures below would not reflect them. */
  dirty: boolean;
  onApplied?: () => void;
}) {
  const t = useTranslations("teachers.pay.recalc");
  const locale = useLocale();
  const { can } = useAuth();
  const allowed = can("payout.adjust");

  const [statements, setStatements] = useState<PayRecalcStatement[] | null>(null);
  const [confirming, setConfirming] = useState<PayRecalcStatement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatements((await getPayRecalc(teacherId)).statements);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }, [teacherId]);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load, refreshKey]);

  if (!allowed || statements === null || statements.length === 0) {
    return error ? <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} /> : null;
  }

  const money = (amount: number, currency: string) => formatMoney({ amount, currency }, locale);
  const signed = (amount: number, currency: string) =>
    `${amount > 0 ? "+" : "−"}${money(Math.abs(amount), currency)}`;
  const monthName = (s: PayRecalcStatement) =>
    new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(
      new Date(Date.UTC(s.period_year, s.period_month - 1, 1)),
    );

  async function apply(statement: PayRecalcStatement) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = statement.carries
        ? await carryPayoutReprice(statement.id)
        : await repricePayout(statement.id);
      setNotice(
        t(statement.carries ? "doneCarried" : "done", {
          month: monthName(statement),
          delta: signed(res.delta_minor, statement.currency),
        }),
      );
      setConfirming(null);
      onApplied?.();
      await load();
    } catch (err) {
      setConfirming(null);
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 border-t pt-4" data-testid="pay-recalc">
      <div>
        <h4 className="text-sm font-medium">{t("title")}</h4>
        <p className="text-muted-foreground text-xs">{t(dirty ? "saveFirst" : "hint")}</p>
      </div>

      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}
      {notice && <AlertBanner variant="success" message={notice} onDismiss={() => setNotice(null)} />}

      <ul className="divide-border/70 divide-y overflow-hidden rounded-lg border bg-background">
        {statements.map((s) => (
          <li
            key={s.id}
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-3 py-2"
            data-testid={`recalc-${s.period_year}-${s.period_month}`}
          >
            <div className="min-w-0">
              <div className="text-sm font-medium">{monthName(s)}</div>
              <div className="text-muted-foreground text-[11px]">
                {t(s.finalized ? "sealed" : "open")} · {money(s.total_minor, s.currency)}
              </div>
            </div>
            {s.currency_changed ? (
              <span className="text-muted-foreground text-xs">{t("currencyChanged")}</span>
            ) : s.delta_minor === 0 ? (
              <span className="text-muted-foreground text-xs">{t("upToDate")}</span>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold tabular-nums" dir="ltr">
                  {signed(s.delta_minor, s.currency)}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={dirty || busy}
                  onClick={() => setConfirming(s)}
                  data-testid={`recalc-open-${s.period_year}-${s.period_month}`}
                  className="gap-1.5"
                >
                  <RefreshCw className="size-3.5" aria-hidden />
                  {t("action")}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>

      <Modal
        open={confirming !== null}
        onClose={() => !busy && setConfirming(null)}
        title={confirming ? t("confirmTitle", { month: monthName(confirming) }) : ""}
        size="sm"
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => setConfirming(null)}
            >
              {t("cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => confirming && void apply(confirming)}
              data-testid="recalc-confirm"
              className="gap-1.5"
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="size-3.5" aria-hidden />
              )}
              {t("action")}
            </Button>
          </>
        }
      >
        {confirming && (
          <p className="text-sm">
            {t(confirming.carries ? "confirmCarried" : "confirmOpen", {
              delta: signed(confirming.delta_minor, confirming.currency),
            })}
          </p>
        )}
      </Modal>
    </div>
  );
}
