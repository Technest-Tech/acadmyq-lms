"use client";

import { Banknote, Check, CircleEllipsis, Copy, CreditCard, Landmark, Smartphone, Zap, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import type { AccountState, ReceiptMethod } from "@/lib/accounting-api";
import { useCapability } from "@/lib/capabilities";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * Small pieces shared by the accounting screens (docs/groups/01-ACCOUNTING.md): the payment
 * methods with their icons, the paid / part-paid / unpaid chip, and major↔minor helpers. Money
 * math stays on the server; these only read and display.
 */

export const METHOD_ICON: Record<ReceiptMethod, LucideIcon> = {
  CASH: Banknote,
  INSTAPAY: Zap,
  WALLET: Smartphone,
  BANK_TRANSFER: Landmark,
  CARD: CreditCard,
  OTHER: CircleEllipsis,
};

export function MethodBadge({ method, className }: { method: ReceiptMethod; className?: string }) {
  const t = useTranslations("accounting");
  const Icon = METHOD_ICON[method];
  return (
    <span className={cn("bg-muted text-foreground inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", className)}>
      <Icon className="size-3.5" aria-hidden />
      {t(`method.${method}`)}
    </span>
  );
}

const STATE_TONE: Record<AccountState, string> = {
  PAID: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  PARTIAL: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  UNPAID: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  FREE: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  NO_CHARGE: "border-zinc-400/30 bg-zinc-400/10 text-zinc-500",
};

export function StateChip({ state }: { state: AccountState }) {
  const t = useTranslations("accounting");
  return (
    <span className={cn("inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-semibold", STATE_TONE[state])} data-state={state}>
      {t(`state.${state}`)}
    </span>
  );
}

/** Major-unit text ("450.5") → integer minor units (2-decimal currencies, like money.ts). */
export function toMinor(major: string): number {
  const n = parseFloat(major.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** Minor units → the plain major-unit text an amount field shows ("450", "450.50"). */
export function toMajorText(minor: number): string {
  return minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2);
}

/** "2026-06" → "June 2026" in the viewer's language. */
export function monthLabel(period: string, locale: string): string {
  const [y = 1970, m = 1] = period.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/** "2026-06-17" → "17 Jun 2026". */
export function dayLabel(date: string, locale: string): string {
  const [y = 1970, m = 1, d = 1] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** Today as YYYY-MM-DD on the viewer's clock (the server caps it at the academy's today). */
export function todayLocal(): string {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function Tile({ label, value, tone, hint, testId }: { label: string; value: string; tone?: string; hint?: string; testId?: string }) {
  return (
    <div className="rounded-xl border p-3" data-testid={testId}>
      <p className="text-muted-foreground text-xs">{label}</p>
      {/* Money is never truncated (mobile conventions): it wraps instead. */}
      <p className={cn("mt-1 text-lg font-bold break-words tabular-nums", tone)}>{value}</p>
      {hint && <p className="text-muted-foreground mt-0.5 text-xs">{hint}</p>}
    </div>
  );
}

/** A wa.me deep link (digits-only phone) with the message pre-filled. */
export function waLink(phone: string, message: string): string {
  return `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;
}

/** Copy a link to the clipboard, confirming in place. */
export function CopyLinkButton({ value, label, copiedLabel, icon: Icon = Copy }: { value: string; label: string; copiedLabel: string; icon?: LucideIcon }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — nothing to do */
    }
  }
  return (
    <Button type="button" variant="outline" onClick={() => void copy()} className="gap-1.5">
      {copied ? <Check className="size-4 text-emerald-600" aria-hidden /> : <Icon className="size-4" aria-hidden />}
      {copied ? copiedLabel : label}
    </Button>
  );
}

/**
 * Each payment method's swatch — the validated categorical palette (dataviz reference instance) in
 * its fixed order, stepped separately for dark. Fixed per METHOD, never by rank, so Cash is the same
 * blue on every chart whether or not InstaPay was used that month.
 */
export const METHOD_SWATCH: Record<ReceiptMethod, string> = {
  CASH: "bg-[#2a78d6] dark:bg-[#3987e5]",
  INSTAPAY: "bg-[#eb6834] dark:bg-[#d95926]",
  WALLET: "bg-[#1baf7a] dark:bg-[#199e70]",
  BANK_TRANSFER: "bg-[#eda100] dark:bg-[#c98500]",
  CARD: "bg-[#e87ba4] dark:bg-[#d55181]",
  OTHER: "bg-[#008300] dark:bg-[#008300]",
};

const METHOD_ORDER: ReceiptMethod[] = ["CASH", "INSTAPAY", "WALLET", "BANK_TRANSFER", "CARD", "OTHER"];

/**
 * What came in, split by method: one stacked bar (2px surface gaps between segments) and a legend
 * that carries every figure, so identity never rests on colour alone.
 */
export function MethodBar({ byMethod, currency, locale }: { byMethod: Partial<Record<ReceiptMethod, number>>; currency: string; locale: string }) {
  const t = useTranslations("accounting");
  const entries = METHOD_ORDER.filter((m) => (byMethod[m] ?? 0) > 0).map((m) => [m, byMethod[m] ?? 0] as const);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (entries.length === 0) {
    return <p className="text-muted-foreground text-sm">{t("overview.nothingCollected")}</p>;
  }

  return (
    <div className="space-y-2.5">
      <div className="flex h-3 gap-0.5" role="img" aria-label={t("register.byMethod")}>
        {entries.map(([m, v], i) => (
          <div
            key={m}
            className={cn("h-full min-w-1", METHOD_SWATCH[m], i === 0 && "rounded-s-full", i === entries.length - 1 && "rounded-e-full")}
            style={{ width: `${(v / total) * 100}%` }}
            title={`${t(`method.${m}`)} — ${Math.round((v / total) * 100)}%`}
          />
        ))}
      </div>
      <ul className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
        {entries.map(([m, v]) => {
          const Icon = METHOD_ICON[m];
          return (
            <li key={m} className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className={cn("size-2.5 shrink-0 rounded-sm", METHOD_SWATCH[m])} aria-hidden />
                <Icon className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
                <span className="text-muted-foreground truncate">{t(`method.${m}`)}</span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums">
                {formatMoney({ amount: v, currency }, locale)}
                <span className="text-muted-foreground ms-1.5 text-xs font-normal">{Math.round((v / total) * 100)}%</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** A rate (0–1) as a whole percent, "—" when there is nothing to rate. */
export function pct(rate: number | null | undefined): string {
  return rate === null || rate === undefined ? "—" : `${Math.round(rate * 100)}%`;
}

/** The collection-rate bar: green from 90 %, amber from 60 %, red below. */
export function RateBar({ rate }: { rate: number | null }) {
  const v = rate === null ? 0 : Math.round(rate * 100);
  return (
    <div className="bg-muted h-2 overflow-hidden rounded-full" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v}>
      <div className={cn("h-full rounded-full", v >= 90 ? "bg-emerald-500" : v >= 60 ? "bg-amber-500" : "bg-rose-500")} style={{ width: `${Math.min(100, v)}%` }} />
    </div>
  );
}

/** Client gate for an Accounting page (`invoice.read` + the `accounting` switch); the API enforces both. */
export function AccountingGate({ children }: { children: React.ReactNode }) {
  const t = useTranslations("accounting");
  const { can } = useAuth();
  const accounting = useCapability("accounting");
  if (!can("invoice.read") || !accounting) {
    return <p className="text-muted-foreground text-sm">{t("noAccess")}</p>;
  }
  return <>{children}</>;
}
