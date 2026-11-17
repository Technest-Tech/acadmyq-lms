"use client";

import { ArrowLeftRight, Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Modal } from "@/components/ui/modal";
import { ApiError, changeGuardianCurrency, type GuardianChild } from "@/lib/api";
import { CURRENCIES } from "@/lib/countries";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

const CURRENCY_OPTIONS = CURRENCIES.map((c) => ({ value: c.code, label: c.code, sublabel: c.name }));

const inputClass =
  "border-input bg-background focus:border-primary focus:ring-primary/15 w-full rounded-lg border px-3 py-2 text-sm tabular-nums outline-none transition-colors focus:ring-3 disabled:opacity-50";

/** Major-unit text → minor units (2-decimal currencies, like money.ts). */
function toMinor(major: string): number {
  const n = Number.parseFloat(major.replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** What a child's price is the price OF, by their billing basis. */
function unitKey(basis: string | null): "hour" | "lesson" | "month" | "free" {
  if (basis === "FREE") return "free";
  if (basis === "PER_SESSION") return "lesson";
  if (basis === "PER_MONTH") return "month";
  return "hour"; // PER_HOUR and PER_PACKAGE both price the hour
}

/**
 * Move a family to another currency in one step (Ahmed 2026-11-17): pick the currency, type each
 * child's new price in it, save. The family's currency, every child's subscription, and a package
 * child's UNPAID packages and their bills all move together; what was paid stays as it was, and a
 * paid running package renews in the new currency. Children with no subscription are listed but
 * have nothing to price.
 */
export function ChangeCurrencyModal({
  guardianId,
  currentCurrency,
  childList,
  onClose,
  onDone,
}: {
  guardianId: string;
  currentCurrency: string;
  /** The family's children — only those with a subscription get a price field. */
  childList: GuardianChild[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const t = useTranslations("guardians.currencyChange");
  const locale = useLocale();
  const [currency, setCurrency] = useState("");
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const priced = useMemo(
    () => childList.filter((c) => c.deleted_at === null && c.subscription_id !== null && c.price_basis !== null),
    [childList],
  );
  const moving = currency !== "" && currency !== currentCurrency.trim();
  // Every paying child needs a price in the new currency; a free one has nothing to type.
  const missing = priced.some((c) => unitKey(c.price_basis) !== "free" && toMinor(prices[c.id] ?? "") <= 0);

  async function save() {
    if (!moving || missing) {
      setError(t("required"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await changeGuardianCurrency(guardianId, {
        currency,
        children: priced.map((c) => ({
          student_id: c.id,
          price_minor: unitKey(c.price_basis) === "free" ? 0 : toMinor(prices[c.id] ?? ""),
        })),
      });
      const packages = res.children.reduce((n, c) => n + c.packages.length, 0);
      onDone(t("saved", { currency, packages }));
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
      description={t("subtitle", { currency: currentCurrency.trim() })}
      size="lg"
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy || !moving || missing}
            onClick={() => void save()}
            data-testid="currency-change-save"
            className="gap-1.5"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <ArrowLeftRight className="size-3.5" aria-hidden />}
            {moving ? t("save", { currency }) : t("pick")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4" data-testid="currency-change">
        {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}

        <div className="space-y-1.5">
          <span className="text-sm font-medium">{t("newCurrency")}</span>
          <Combobox
            options={CURRENCY_OPTIONS.filter((o) => o.value !== currentCurrency.trim())}
            value={currency}
            onChange={setCurrency}
            placeholder={t("pick")}
            searchPlaceholder={t("search")}
            data-testid="currency-change-currency"
          />
        </div>

        {moving && (
          <>
            {priced.length > 0 ? (
              <div className="space-y-2">
                <p className="text-sm font-medium">{t("pricesTitle", { currency })}</p>
                <ul className="divide-y rounded-xl border">
                  {priced.map((c) => {
                    const unit = unitKey(c.price_basis);
                    return (
                      <li
                        key={c.id}
                        className="grid grid-cols-1 items-center gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_12rem]"
                        data-testid={`currency-change-child-${c.id}`}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{c.full_name}</p>
                          <p className="text-muted-foreground text-xs">
                            {t("now")}{" "}
                            {c.price_minor != null && c.price_currency
                              ? formatMoney({ amount: c.price_minor, currency: c.price_currency.trim() }, locale)
                              : "—"}{" "}
                            · {t(`unit.${unit}`)}
                            {c.price_basis === "PER_PACKAGE" && <span> · {t("packageStudent")}</span>}
                          </p>
                        </div>
                        {unit === "free" ? (
                          <span className="text-muted-foreground text-xs">{t("free")}</span>
                        ) : (
                          <div className="relative">
                            <input
                              type="number"
                              inputMode="decimal"
                              min={0}
                              step={0.01}
                              value={prices[c.id] ?? ""}
                              onChange={(e) => setPrices((prev) => ({ ...prev, [c.id]: e.target.value }))}
                              aria-label={`${c.full_name} · ${t(`unit.${unit}`)}`}
                              placeholder="0.00"
                              disabled={busy}
                              className={cn(inputClass, "pe-14")}
                              data-testid={`currency-change-price-${c.id}`}
                            />
                            <span className="text-muted-foreground pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-xs font-semibold">
                              {currency}
                            </span>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : (
              <p className="text-muted-foreground rounded-xl border border-dashed px-3 py-2.5 text-xs">{t("noChildren")}</p>
            )}

            <div className="space-y-1 rounded-xl border border-sky-300/60 bg-sky-500/[0.06] px-3 py-2.5 text-xs dark:border-sky-800/50">
              <p className="font-semibold">{t("whatMoves")}</p>
              <p className="text-muted-foreground">{t("whatMovesPackages")}</p>
              <p className="text-muted-foreground">{t("whatMovesMonthly")}</p>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
