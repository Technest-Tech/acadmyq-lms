"use client";

import { Check, Copy, CreditCard, ExternalLink, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { StatusChip } from "@/components/admin/status-chip";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  ApiError,
  getClientXpay,
  saveClientXpay,
  testClientXpay,
  type XpayKeyInput,
  type XpayMode,
  type XpaySettings,
} from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Payments → XPay for one client. THE place a client's card gateway is provisioned.
 *
 * The keys are ours to hold, not the client's: we paste their merchant credentials here once and
 * the academy never sees them again (the API returns only last-four tails). Turning the channel on
 * is what puts "Pay by card" on that client's public invoices — nothing else has to happen.
 *
 * Both environments live here side by side, because onboarding runs test payments first and only
 * then switches to real money. Keeping both means going live is a radio button rather than a
 * destructive paste-over, and dropping back to test to reproduce a problem costs nothing.
 *
 * The secret fields are REPLACE-ONLY. There is no way to read a stored key back, so leaving a field
 * blank means "keep what's there" — the admin can switch environments or fix a publishable key
 * without re-fetching credentials from the client.
 */

const MODES: XpayMode[] = ["test", "live"];

const EMPTY: XpayKeyInput = {};

export function ClientXpayCard({ clientId }: { clientId: string }) {
  const t = useTranslations("clients.detail.xpay");
  const { can } = useAuth();
  const toast = useToast();

  const [state, setState] = useState<XpaySettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<XpayMode>("test");
  const [draft, setDraft] = useState<Record<XpayMode, XpayKeyInput>>({
    test: EMPTY,
    live: EMPTY,
  });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<XpayMode | null>(null);
  const [copied, setCopied] = useState(false);

  const canManage = can("academy_billing.manage");

  const apply = useCallback((next: XpaySettings) => {
    setState(next);
    setMode(next.mode);
    // Publishable keys are readable, so they round-trip; the secrets have nothing to prefill with.
    setDraft({
      test: { publishable_key: next.modes.test.publishable_key ?? "" },
      live: { publishable_key: next.modes.live.publishable_key ?? "" },
    });
  }, []);

  const load = useCallback(async () => {
    try {
      apply((await getClientXpay(clientId)).xpay);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }, [clientId, apply]);

  useEffect(() => {
    void load();
  }, [load]);

  const edit = (m: XpayMode, field: keyof XpayKeyInput, value: string) =>
    setDraft((d) => ({ ...d, [m]: { ...d[m], [field]: value } }));

  const persist = async (isActive: boolean, activeMode: XpayMode = mode) => {
    setSaving(true);
    try {
      const res = await saveClientXpay(clientId, {
        is_active: isActive,
        mode: activeMode,
        test: draft.test,
        live: draft.live,
      });
      apply(res.xpay);
      toast.success(t("saved"));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const runTest = async (m: XpayMode) => {
    setTesting(m);
    try {
      const res = await testClientXpay(clientId, m);
      if (res.ok) toast.success(res.message);
      else toast.error(res.message);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    } finally {
      setTesting(null);
    }
  };

  const copyWebhookUrl = async () => {
    if (state === null) return;
    try {
      await navigator.clipboard.writeText(state.webhook_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  if (error !== null) {
    return (
      <section className="bg-card rounded-xl p-5 shadow-sm ring-1 ring-foreground/[0.06]">
        <p className="text-destructive text-xs">{error}</p>
      </section>
    );
  }

  if (state === null) {
    return (
      <section className="bg-card rounded-xl p-5 shadow-sm ring-1 ring-foreground/[0.06]">
        <p className="text-muted-foreground text-xs">{t("loading")}</p>
      </section>
    );
  }

  const selected = state.modes[mode];
  const canGoLive = selected.configured || (draft[mode].secret_key ?? "").trim() !== "";

  return (
    <section
      className="bg-card space-y-5 rounded-xl p-5 shadow-sm ring-1 ring-foreground/[0.06]"
      data-testid="client-xpay-card"
    >
      {/* ── Header: what this is, and whether it is on ────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-bold">
            <CreditCard className="text-muted-foreground size-4" aria-hidden />
            {t("title")}
          </h3>
          <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
            <StatusChip
              tone={state.is_active ? "good" : state.configured ? "warn" : "neutral"}
              dot
            >
              {state.is_active
                ? t("statusOn")
                : state.configured
                  ? t("statusOff")
                  : t("statusNotSetUp")}
            </StatusChip>
            {state.is_active && (
              <StatusChip tone={state.mode === "live" ? "accent" : "info"}>
                {state.mode === "live" ? t("usingLive") : t("usingTest")}
              </StatusChip>
            )}
          </p>
          <p className="text-muted-foreground mt-1.5 text-xs">{t("subtitle")}</p>
        </div>
        <a
          href="https://app.xpay.app"
          target="_blank"
          rel="noreferrer"
          className="text-primary inline-flex items-center gap-1 text-xs font-semibold hover:underline"
        >
          {t("openXpay")}
          <ExternalLink className="size-3" aria-hidden />
        </a>
      </div>

      {/* ── Which environment is in force ─────────────────────────────────── */}
      <div>
        <p className="text-muted-foreground mb-1.5 text-[0.7rem] font-semibold uppercase tracking-wide">
          {t("environmentLabel")}
        </p>
        <div className="inline-flex rounded-lg border p-0.5" role="radiogroup">
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              disabled={!canManage}
              onClick={() => setMode(m)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                mode === m
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              data-testid={`xpay-mode-${m}`}
            >
              {m === "test" ? t("testMode") : t("liveMode")}
            </button>
          ))}
        </div>
        <p className="text-muted-foreground mt-1.5 text-xs">
          {mode === "test" ? t("testModeHint") : t("liveModeHint")}
        </p>
      </div>

      {/* ── Both key sets, the selected one first ──────────────────────────── */}
      <div className="space-y-4">
        {MODES.map((m) => (
          <KeySet
            key={m}
            mode={m}
            inForce={m === mode}
            stored={state.modes[m]}
            draft={draft[m]}
            disabled={!canManage}
            testing={testing === m}
            onEdit={(field, value) => edit(m, field, value)}
            onTest={() => void runTest(m)}
          />
        ))}
      </div>

      {/* ── The callback URL the client pastes into their XPay dashboard ──── */}
      <div className="bg-muted/40 rounded-lg p-3">
        <p className="text-muted-foreground text-[0.7rem] font-semibold uppercase tracking-wide">
          {t("webhookUrlLabel")}
        </p>
        <div className="mt-1 flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate font-mono text-xs">{state.webhook_url}</code>
          <button
            type="button"
            onClick={() => void copyWebhookUrl()}
            aria-label={t("copy")}
            className="hover:bg-muted flex size-7 shrink-0 items-center justify-center rounded-md transition-colors"
          >
            {copied ? (
              <Check className="size-3.5 text-emerald-600" aria-hidden />
            ) : (
              <Copy className="text-muted-foreground size-3.5" aria-hidden />
            )}
          </button>
        </div>
        <p className="text-muted-foreground mt-1.5 text-xs">{t("webhookUrlHint")}</p>
      </div>

      {canManage && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {state.is_active ? (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={saving}
                onClick={() => void persist(false)}
                data-testid="xpay-turn-off"
              >
                {t("turnOff")}
              </Button>
              <Button
                size="sm"
                disabled={saving || !canGoLive}
                onClick={() => void persist(true)}
                data-testid="xpay-save"
              >
                {t("saveChanges")}
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              disabled={saving || !canGoLive}
              onClick={() => void persist(true)}
              data-testid="xpay-turn-on"
            >
              {t("turnOn")}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

/** One environment's three key fields, labelled with what the client will actually see in XPay. */
function KeySet({
  mode,
  inForce,
  stored,
  draft,
  disabled,
  testing,
  onEdit,
  onTest,
}: {
  mode: XpayMode;
  inForce: boolean;
  stored: XpaySettings["modes"][XpayMode];
  draft: XpayKeyInput;
  disabled: boolean;
  testing: boolean;
  onEdit: (field: keyof XpayKeyInput, value: string) => void;
  onTest: () => void;
}) {
  const t = useTranslations("clients.detail.xpay");
  const field = "bg-card h-9 w-full rounded-lg border px-3 text-sm font-mono";

  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        inForce ? "border-primary/40 bg-primary/[0.03]" : "border-dashed",
      )}
      data-testid={`xpay-keys-${mode}`}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-2 text-xs font-bold">
          {mode === "test" ? t("testKeysTitle") : t("liveKeysTitle")}
          {inForce && <StatusChip tone="accent">{t("inUse")}</StatusChip>}
          {!stored.configured && <StatusChip tone="neutral">{t("empty")}</StatusChip>}
        </h4>
        {stored.configured && (
          <Button size="sm" variant="outline" disabled={disabled || testing} onClick={onTest}>
            {testing && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            {t("testConnection")}
          </Button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium">
          <span className="text-muted-foreground mb-1 block">{t("publishableKey")}</span>
          <input
            value={draft.publishable_key ?? ""}
            onChange={(e) => onEdit("publishable_key", e.target.value)}
            placeholder={`pk_${mode}_…`}
            disabled={disabled}
            className={field}
            data-testid={`xpay-${mode}-publishable`}
          />
        </label>

        <label className="block text-xs font-medium">
          <span className="text-muted-foreground mb-1 block">{t("secretKey")}</span>
          <input
            value={draft.secret_key ?? ""}
            onChange={(e) => onEdit("secret_key", e.target.value)}
            type="password"
            autoComplete="off"
            placeholder={
              stored.secret_last4 !== null
                ? t("savedEndingIn", { tail: stored.secret_last4 })
                : `sk_${mode}_…`
            }
            disabled={disabled}
            className={field}
            data-testid={`xpay-${mode}-secret`}
          />
        </label>

        <label className="block text-xs font-medium sm:col-span-2">
          <span className="text-muted-foreground mb-1 block">{t("webhookSecret")}</span>
          <input
            value={draft.webhook_secret ?? ""}
            onChange={(e) => onEdit("webhook_secret", e.target.value)}
            type="password"
            autoComplete="off"
            placeholder={
              stored.webhook_last4 !== null
                ? t("savedEndingIn", { tail: stored.webhook_last4 })
                : "whsec_…"
            }
            disabled={disabled}
            className={field}
            data-testid={`xpay-${mode}-webhook-secret`}
          />
        </label>
      </div>

      <p className="text-muted-foreground mt-2 text-xs">{t("replaceHint")}</p>
      {stored.configured && !stored.has_webhook_secret && (
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{t("noWebhookWarning")}</p>
      )}
    </div>
  );
}
