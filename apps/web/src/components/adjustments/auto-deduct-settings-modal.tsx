"use client";

import { AlertTriangle, Bot, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  ApiError,
  getQualitySettings,
  updateQualitySettings,
  type QualitySettings,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const inputBase =
  "border-input bg-background placeholder:text-muted-foreground focus:border-primary focus:ring-primary/15 w-full rounded-xl border text-sm outline-none transition-colors focus:ring-3 disabled:opacity-50";

const DEFAULTS: QualitySettings = {
  auto_deduct_enabled: false,
  auto_deduct_grace_hours: 6,
  auto_deduct_basis: "FIXED",
  auto_deduct_amount_minor: 0,
  auto_deduct_percent: 0,
};

/**
 * The standing policy for docking a teacher who never marks a lesson.
 *
 * This is the one switch on either page that acts without a human in the loop, so the form says
 * plainly what it will do before it is turned on, and the save button refuses a policy that is
 * enabled but has nothing configured to dock — an "on" toggle that silently does nothing is worse
 * than an off one.
 */
export function AutoDeductSettingsModal({
  open,
  canManage,
  onClose,
  onSaved,
}: {
  open: boolean;
  canManage: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("adjustments");

  const [settings, setSettings] = useState<QualitySettings | null>(null);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSettings(null);
    getQualitySettings()
      .then((res) => {
        setSettings(res.settings);
        setAmount(
          res.settings.auto_deduct_amount_minor > 0
            ? String(res.settings.auto_deduct_amount_minor / 100)
            : "",
        );
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : String(err));
        setSettings(DEFAULTS);
      });
  }, [open]);

  function patch(next: Partial<QualitySettings>) {
    setSettings((prev) => (prev === null ? prev : { ...prev, ...next }));
  }

  const amountMinor = Math.round((Number.parseFloat(amount) || 0) * 100);
  const isFixed = settings?.auto_deduct_basis === "FIXED";

  // An enabled policy with nothing to dock would run every hour and change nothing.
  const configured =
    settings !== null &&
    (!settings.auto_deduct_enabled ||
      (isFixed ? amountMinor > 0 : settings.auto_deduct_percent > 0));

  async function save() {
    if (settings === null || !configured) return;
    setBusy(true);
    setError(null);
    try {
      await updateQualitySettings({
        ...settings,
        auto_deduct_amount_minor: amountMinor,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("settings.title")}
      description={t("settings.description")}
      size="md"
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("cancel")}
          </Button>
          {canManage && (
            <Button
              onClick={() => void save()}
              disabled={settings === null || busy || !configured}
              data-testid="auto-deduct-save"
            >
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t("settings.save")}
            </Button>
          )}
        </div>
      }
    >
      {settings === null ? (
        <div className="flex items-center justify-center py-12">
          <div className="border-primary size-6 animate-spin rounded-full border-2 border-t-transparent" />
        </div>
      ) : (
        <div className="space-y-4">
          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{error}</span>
            </div>
          )}

          {/* The switch */}
          <button
            type="button"
            disabled={!canManage}
            onClick={() => patch({ auto_deduct_enabled: !settings.auto_deduct_enabled })}
            aria-pressed={settings.auto_deduct_enabled}
            data-testid="auto-deduct-toggle"
            className={cn(
              "flex w-full items-center gap-3 rounded-2xl border p-3 text-start transition-all disabled:opacity-60",
              settings.auto_deduct_enabled
                ? "border-orange-500 bg-orange-50 ring-3 ring-orange-500/15 dark:bg-orange-950/20"
                : "hover:border-muted-foreground/30",
            )}
          >
            <Bot
              className={cn(
                "size-5 shrink-0",
                settings.auto_deduct_enabled
                  ? "text-orange-600 dark:text-orange-400"
                  : "text-muted-foreground",
              )}
              aria-hidden
            />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">{t("settings.enable")}</span>
              <span className="text-muted-foreground block text-xs leading-snug">
                {t("settings.enableHint")}
              </span>
            </span>
            <span
              className={cn(
                "relative h-5 w-9 shrink-0 rounded-full transition-colors",
                settings.auto_deduct_enabled ? "bg-orange-500" : "bg-muted-foreground/25",
              )}
              aria-hidden
            >
              <span
                className={cn(
                  "absolute top-0.5 size-4 rounded-full bg-white transition-all",
                  settings.auto_deduct_enabled ? "start-4.5" : "start-0.5",
                )}
              />
            </span>
          </button>

          <fieldset
            disabled={!settings.auto_deduct_enabled || !canManage}
            className="space-y-4 transition-opacity disabled:opacity-50"
          >
            <div className="space-y-1.5">
              <label className="text-muted-foreground text-xs font-medium">
                {t("settings.graceHours")}
              </label>
              <input
                type="number"
                min={1}
                max={168}
                dir="ltr"
                value={settings.auto_deduct_grace_hours}
                onChange={(e) =>
                  patch({ auto_deduct_grace_hours: Number(e.target.value) || 1 })
                }
                className={cn(inputBase, "px-3 py-2 tabular-nums")}
                data-testid="auto-deduct-grace"
              />
              <p className="text-muted-foreground/70 text-xs">{t("settings.graceHint")}</p>
            </div>

            <div className="space-y-1.5">
              <label className="text-muted-foreground text-xs font-medium">
                {t("settings.basis")}
              </label>
              <div className="grid grid-cols-2 gap-2">
                <BasisCard
                  active={isFixed}
                  title={t("settings.basisFixed")}
                  hint={t("settings.basisFixedHint")}
                  onClick={() => patch({ auto_deduct_basis: "FIXED" })}
                />
                <BasisCard
                  active={!isFixed}
                  title={t("settings.basisPercent")}
                  hint={t("settings.basisPercentHint")}
                  onClick={() => patch({ auto_deduct_basis: "PERCENT_SESSION" })}
                />
              </div>
            </div>

            {isFixed ? (
              <div className="space-y-1.5">
                <label className="text-muted-foreground text-xs font-medium">
                  {t("settings.amount")}
                </label>
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  inputMode="decimal"
                  dir="ltr"
                  placeholder="0.00"
                  className={cn(inputBase, "px-3 py-2 text-end tabular-nums")}
                  data-testid="auto-deduct-amount"
                />
                {/* Teachers can be paid in different currencies and the system never converts. */}
                <p className="text-muted-foreground/70 text-xs">{t("settings.amountHint")}</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <label className="text-muted-foreground text-xs font-medium">
                  {t("settings.percent")}
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="0.5"
                  dir="ltr"
                  value={settings.auto_deduct_percent}
                  onChange={(e) =>
                    patch({ auto_deduct_percent: Number(e.target.value) || 0 })
                  }
                  className={cn(inputBase, "px-3 py-2 text-end tabular-nums")}
                  data-testid="auto-deduct-percent"
                />
                <p className="text-muted-foreground/70 text-xs">{t("settings.percentHint")}</p>
              </div>
            )}
          </fieldset>

          {settings.auto_deduct_enabled && (
            <div className="rounded-xl bg-amber-50 px-3 py-2.5 dark:bg-amber-950/20">
              <p className="flex items-start gap-2 text-xs text-amber-800 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>{t("settings.warning")}</span>
              </p>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function BasisCard({
  active,
  title,
  hint,
  onClick,
}: {
  active: boolean;
  title: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-xl border p-2.5 text-start transition-all",
        active
          ? "border-primary bg-primary/5 ring-primary/15 ring-3"
          : "hover:border-muted-foreground/30",
      )}
    >
      <span className="block text-xs font-semibold">{title}</span>
      <span className="text-muted-foreground mt-0.5 block text-[11px] leading-snug">{hint}</span>
    </button>
  );
}
