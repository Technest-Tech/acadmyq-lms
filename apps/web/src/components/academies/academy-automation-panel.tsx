"use client";

import { KeyRound, MessageCircle, Plug, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  ApiError,
  clearWasenderToken,
  getAcademyAutomation,
  getAutomationLog,
  setWasenderToken,
  testWasender,
  updateAcademyAutomation,
  type AcademyAutomation,
  type AutomationLogRow,
} from "@/lib/api";

const cardClass =
  "bg-card rounded-2xl border p-5 shadow-sm ring-1 ring-foreground/[0.04]";

const LOG_STATUS_STYLE: Record<string, string> = {
  SENT: "text-emerald-600",
  SKIPPED: "text-amber-600",
  FAILED: "text-rose-600",
  QUEUED: "text-muted-foreground",
};

/**
 * Per-academy WhatsApp automation panel (Super Admin). Configures the Wasender token (write-only —
 * the token is never shown, only a masked tail) and the two automation toggles, plus a connection
 * test and the recent send log. Gated by `automation.manage`.
 */
export function AcademyAutomationPanel({ academyId }: { academyId: string }) {
  const t = useTranslations("academyAutomation");
  const { can } = useAuth();
  const toast = useToast();

  const [a, setA] = useState<AcademyAutomation | null>(null);
  const [log, setLog] = useState<AutomationLogRow[]>([]);
  const [tokenInput, setTokenInput] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [auto, logRes] = await Promise.all([
      getAcademyAutomation(academyId),
      getAutomationLog(academyId),
    ]);
    setA(auto.automation);
    setLog(logRes.log);
  }, [academyId]);

  useEffect(() => {
    if (can("automation.manage")) void load();
  }, [load, can]);

  if (!can("automation.manage")) return null;

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      await load();
      toast.success(ok);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function runTest() {
    setBusy(true);
    try {
      const res = await testWasender(academyId);
      if (res.ok) {
        toast.success(t("testOk", { status: res.status ?? "" }));
      } else {
        toast.error(t("testFail"));
      }
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (a === null) {
    return (
      <section className={cardClass} data-testid="academy-automation-panel">
        <div className="bg-muted h-40 animate-pulse rounded-xl" aria-hidden />
      </section>
    );
  }

  return (
    <section className={cardClass} data-testid="academy-automation-panel">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <MessageCircle className="text-muted-foreground size-4" aria-hidden />
        {t("title")}
      </h2>
      <p className="text-muted-foreground mb-4 text-xs">{t("subtitle")}</p>

      {/* Token */}
      <div className="mb-4 rounded-xl border p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm font-medium">
            <KeyRound className="text-muted-foreground size-4" aria-hidden />
            {t("token")}
          </span>
          {a.has_token ? (
            <span className="font-mono text-xs text-emerald-600" dir="ltr">
              ••••{a.token_tail}
            </span>
          ) : (
            <span className="text-muted-foreground text-xs">{t("noToken")}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder={t("tokenPlaceholder")}
            className="border-input bg-background w-full rounded-md border px-3 py-1.5 text-sm"
            dir="ltr"
            aria-label={t("token")}
            data-testid="wasender-token-input"
          />
          <Button
            type="button"
            size="sm"
            disabled={busy || tokenInput.length < 8}
            onClick={() =>
              void run(async () => {
                await setWasenderToken(academyId, tokenInput);
                setTokenInput("");
              }, t("tokenSaved"))
            }
            data-testid="save-token"
          >
            {a.has_token ? t("replace") : t("save")}
          </Button>
          {a.has_token && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void run(() => clearWasenderToken(academyId), t("tokenCleared"))
              }
              aria-label={t("clear")}
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          )}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={busy || !a.has_token}
            onClick={() => void runTest()}
            data-testid="test-connection"
          >
            <Plug className="size-3" aria-hidden />
            {t("test")}
          </Button>
          {a.wasender_session_status && (
            <span className="text-muted-foreground text-xs" dir="ltr">
              {a.wasender_session_status}
            </span>
          )}
        </div>
      </div>

      {/* Toggles */}
      <div className="space-y-2">
        <ToggleRow
          label={t("type1")}
          hint={t("type1Hint")}
          on={a.type1_billing_enabled}
          disabled={busy || !a.has_token}
          disabledHint={t("needToken")}
          onToggle={(v) =>
            void run(
              () =>
                updateAcademyAutomation(academyId, {
                  type1_billing_enabled: v,
                }),
              t("saved"),
            )
          }
          testid="toggle-type1"
        />
        <ToggleRow
          label={t("type2")}
          hint={t("type2Hint")}
          on={a.type2_lessons_enabled}
          disabled={busy || !a.has_token}
          disabledHint={t("needToken")}
          onToggle={(v) =>
            void run(
              () =>
                updateAcademyAutomation(academyId, {
                  type2_lessons_enabled: v,
                }),
              t("saved"),
            )
          }
          testid="toggle-type2"
        />
      </div>

      {/* Send log */}
      {log.length > 0 && (
        <div className="mt-4 border-t pt-3">
          <h3 className="text-muted-foreground mb-2 text-xs font-semibold uppercase tracking-wide">
            {t("log")}
          </h3>
          <ul className="space-y-1">
            {log.slice(0, 8).map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-2 text-xs"
              >
                <span className="text-muted-foreground truncate">
                  {r.recipient_kind} · {r.transport}
                </span>
                <span className={LOG_STATUS_STYLE[r.status] ?? ""}>
                  {r.status}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function ToggleRow({
  label,
  hint,
  on,
  disabled,
  disabledHint,
  onToggle,
  testid,
}: {
  label: string;
  hint: string;
  on: boolean;
  disabled: boolean;
  disabledHint: string;
  onToggle: (v: boolean) => void;
  testid: string;
}) {
  return (
    <div className="bg-muted/30 flex items-center justify-between gap-3 rounded-lg px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-muted-foreground text-xs">
          {disabled && !on ? disabledHint : hint}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={disabled}
        onClick={() => onToggle(!on)}
        data-testid={testid}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
          on ? "bg-primary" : "bg-muted-foreground/30"
        }`}
      >
        <span
          className={`inline-block size-5 rounded-full bg-white shadow transition-transform ${
            on ? "translate-x-5 rtl:-translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}
