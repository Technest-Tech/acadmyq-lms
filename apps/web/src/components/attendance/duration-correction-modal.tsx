"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Loader2,
  Receipt,
  WalletCards,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  ApiError,
  previewSessionDuration,
  type SessionDurationImpact,
  updateSessionDuration,
} from "@/lib/api";
import { formatMoney } from "@/lib/money";

/** Two-step correction: calculate the financial impact, then explicitly apply that exact change. */
export function DurationCorrectionModal({
  sessionId,
  currentDuration,
  onClose,
  onSaved,
}: {
  sessionId: string;
  currentDuration: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("attendance.durationEdit");
  const locale = useLocale();
  const [duration, setDuration] = useState(String(currentDuration));
  const [impact, setImpact] = useState<SessionDurationImpact | null>(null);
  const [busy, setBusy] = useState<"preview" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const minutes = Number(duration);
  const valid = Number.isInteger(minutes) && minutes >= 1 && minutes <= 600;

  async function review() {
    if (!valid) return;
    setBusy("preview");
    setError(null);
    try {
      setImpact(await previewSessionDuration(sessionId, minutes));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function confirm() {
    if (!impact?.can_change || impact.duration_after !== minutes) return;
    setBusy("save");
    setError(null);
    try {
      await updateSessionDuration(sessionId, minutes);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal
      open
      onClose={() => busy === null && onClose()}
      title={t("title")}
      description={t("subtitle")}
      size="md"
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy !== null}
            onClick={onClose}
          >
            {t("cancel")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy !== null || !valid || minutes === currentDuration}
            onClick={() => void review()}
            data-testid="review-duration-change"
          >
            {busy === "preview" && (
              <Loader2 className="size-3.5 animate-spin" />
            )}
            {t("review")}
          </Button>
          {impact && (
            <Button
              type="button"
              size="sm"
              disabled={
                busy !== null ||
                !impact.can_change ||
                impact.duration_after !== minutes ||
                minutes === currentDuration
              }
              onClick={() => void confirm()}
              data-testid="confirm-duration-change"
            >
              {busy === "save" && <Loader2 className="size-3.5 animate-spin" />}
              {t("confirm")}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <AlertBanner
            variant="error"
            message={error}
            onDismiss={() => setError(null)}
          />
        )}

        <div className="rounded-xl border bg-muted/25 p-3.5">
          <label
            className="text-sm font-medium"
            htmlFor="lesson-duration-correction"
          >
            {t("newDuration")}
          </label>
          <div className="relative mt-1.5 max-w-48">
            <Clock3 className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2" />
            <input
              id="lesson-duration-correction"
              type="number"
              min={1}
              max={600}
              step={5}
              value={duration}
              onChange={(event) => {
                setDuration(event.target.value);
                setImpact(null);
              }}
              className="border-input bg-background focus:border-primary focus:ring-primary/15 w-full rounded-xl border py-2 ps-9 pe-12 text-sm outline-none focus:ring-3"
            />
            <span className="text-muted-foreground pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-xs">
              {t("minutes")}
            </span>
          </div>
          {!valid && duration !== "" && (
            <p className="text-destructive mt-1.5 text-xs">{t("invalid")}</p>
          )}
        </div>

        <div className="flex items-start gap-2.5 rounded-xl border border-amber-300/70 bg-amber-50/70 p-3 text-amber-900 dark:border-amber-800/50 dark:bg-amber-950/20 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p className="text-xs leading-relaxed">{t("warning")}</p>
        </div>

        {impact && (
          <div className="space-y-2.5" data-testid="duration-impact">
            <p className="text-sm font-semibold">{t("impactTitle")}</p>

            {impact.invoice && (
              <ImpactRow
                icon={Receipt}
                title={t("invoice")}
                detail={t("moneyChange", {
                  before: formatMoney(
                    {
                      amount: impact.invoice.amount_before,
                      currency: impact.invoice.currency,
                    },
                    locale,
                  ),
                  after: formatMoney(
                    {
                      amount: impact.invoice.amount_after,
                      currency: impact.invoice.currency,
                    },
                    locale,
                  ),
                })}
              />
            )}

            {impact.package && (
              <ImpactRow
                icon={WalletCards}
                title={t("package", { label: impact.package.label })}
                detail={t("packageChange", {
                  consumedBefore: impact.package.consumed_before,
                  consumedAfter: impact.package.consumed_after,
                  remainingBefore: impact.package.remaining_before,
                  remainingAfter: impact.package.remaining_after,
                })}
                extra={
                  impact.package.will_complete
                    ? t("packageCompletes")
                    : undefined
                }
              />
            )}

            {impact.payout && (
              <ImpactRow
                icon={WalletCards}
                title={t("payout")}
                detail={t("moneyChange", {
                  before: formatMoney(
                    {
                      amount: impact.payout.amount_before,
                      currency: impact.payout.currency,
                    },
                    locale,
                  ),
                  after: formatMoney(
                    {
                      amount: impact.payout.amount_after,
                      currency: impact.payout.currency,
                    },
                    locale,
                  ),
                })}
              />
            )}

            {!impact.invoice && !impact.package && !impact.payout && (
              <ImpactRow
                icon={CheckCircle2}
                title={t("durationOnly")}
                detail={t("durationOnlyHint")}
              />
            )}

            {!impact.can_change && (
              <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-xl border p-3 text-xs font-medium">
                {impact.blockers
                  .map((blocker) => t(`blockers.${blocker}`))
                  .join(" ")}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function ImpactRow({
  icon: Icon,
  title,
  detail,
  extra,
}: {
  icon: typeof Receipt;
  title: string;
  detail: string;
  extra?: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border p-3">
      <span className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-lg">
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-muted-foreground mt-0.5 text-xs">{detail}</p>
        {extra && (
          <p className="mt-1 text-xs font-semibold text-amber-600">{extra}</p>
        )}
      </div>
    </div>
  );
}
