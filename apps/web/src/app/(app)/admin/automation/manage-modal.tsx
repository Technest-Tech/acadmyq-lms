"use client";

import {
  CheckCircle2,
  Copy,
  Key,
  Link2,
  Loader2,
  LogOut,
  MessageSquare,
  Phone,
  Plus,
  QrCode,
  RefreshCw,
  Send,
  Trash2,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { AlertBanner } from "@/components/ui/alert";
import {
  ApiError,
  createApiKey,
  createConnectLink,
  getApiKeys,
  getAutomationLog,
  revokeApiKey,
  updateAcademyAutomation,
  whatsappCheckNumber,
  whatsappConnect,
  whatsappLogout,
  whatsappQr,
  whatsappSendTest,
  whatsappStatus,
  type AutomationLogRow,
  type AutomationOverviewRow,
  type WhatsAppApiKey,
  type WhatsAppStatus,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const norm = (s: string | null | undefined): string => (s ?? "").toLowerCase();
export const isConnectedState = (s: string | null | undefined): boolean => norm(s) === "connected";

const PILL: Record<string, string> = {
  connected: "bg-emerald-100 text-emerald-700 ring-emerald-600/20",
  qr: "bg-amber-100 text-amber-700 ring-amber-600/20",
  connecting: "bg-amber-100 text-amber-700 ring-amber-600/20",
  disconnected: "bg-slate-100 text-slate-600 ring-slate-500/20",
  logged_out: "bg-rose-100 text-rose-700 ring-rose-600/20",
  none: "bg-muted text-muted-foreground ring-foreground/10",
};

export function StatusPill({ state }: { state: string | null | undefined }) {
  const t = useTranslations("adminAutomation");
  const key = norm(state) || "none";
  const cls = PILL[key] ?? PILL.none;
  const labelKey = (["connected", "qr", "connecting", "disconnected", "logged_out"] as const).includes(
    key as never,
  )
    ? `status.${key}`
    : "status.none";
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1", cls)}>
      <span className={cn("size-1.5 rounded-full", key === "connected" ? "bg-emerald-500" : key === "logged_out" ? "bg-rose-500" : key === "qr" || key === "connecting" ? "bg-amber-500" : "bg-slate-400")} />
      {t(labelKey)}
    </span>
  );
}

function Fact({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="bg-muted/40 rounded-lg p-2.5">
      <p className="text-muted-foreground flex items-center gap-1 text-[11px] font-medium">
        <Icon className="size-3" aria-hidden />
        {label}
      </p>
      <p className="mt-0.5 truncate text-sm font-semibold tabular-nums" dir="ltr">{value}</p>
    </div>
  );
}

function Switch({ on, disabled, onClick }: { on: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-40",
        on ? "bg-primary" : "bg-muted-foreground/30",
      )}
    >
      <span className={cn("inline-block size-4 rounded-full bg-white shadow transition-transform", on ? "translate-x-4 rtl:-translate-x-4" : "translate-x-0.5")} />
    </button>
  );
}

export function ManageModal({
  academy,
  onClose,
  onChanged,
}: {
  academy: AutomationOverviewRow;
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useTranslations("adminAutomation");
  const locale = useLocale();
  const id = academy.academy_id;

  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [log, setLog] = useState<AutomationLogRow[] | null>(null);
  const [type1, setType1] = useState(academy.type1_billing_enabled);
  const [type2, setType2] = useState(academy.type2_lessons_enabled);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Connect / QR
  const [qr, setQr] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const qrPoll = useRef<ReturnType<typeof setInterval> | null>(null);

  // Test send
  const [to, setTo] = useState("");
  const [text, setText] = useState("");
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; transport: string; error: string | null; deeplink: string } | null>(null);
  const [checkBusy, setCheckBusy] = useState(false);
  const [checkResult, setCheckResult] = useState<"yes" | "no" | "nosession" | null>(null);

  // API access
  const [keys, setKeys] = useState<WhatsAppApiKey[] | null>(null);
  const [newKeyName, setNewKeyName] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [connectLink, setConnectLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const connected = isConnectedState(status?.state);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await whatsappStatus(id));
    } catch {
      /* keep last status */
    }
  }, [id]);

  const loadLog = useCallback(async () => {
    try {
      setLog((await getAutomationLog(id)).log);
    } catch {
      setLog([]);
    }
  }, [id]);

  const loadKeys = useCallback(async () => {
    try {
      setKeys((await getApiKeys(id)).keys);
    } catch {
      setKeys([]);
    }
  }, [id]);

  const stopQrPoll = useCallback(() => {
    if (qrPoll.current) {
      clearInterval(qrPoll.current);
      qrPoll.current = null;
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
    void loadLog();
    void loadKeys();
    const iv = setInterval(() => void refreshStatus(), 5000);
    return () => {
      clearInterval(iv);
      stopQrPoll();
    };
  }, [refreshStatus, loadLog, loadKeys, stopQrPoll]);

  function startQrPoll() {
    stopQrPoll();
    qrPoll.current = setInterval(async () => {
      try {
        const res = await whatsappQr(id);
        if (res.qr) setQr(res.qr);
        if (isConnectedState(res.state)) {
          stopQrPoll();
          setConnecting(false);
          setQr(null);
          await refreshStatus();
          onChanged();
        }
      } catch {
        /* keep polling */
      }
    }, 3000);
  }

  async function connect() {
    setError(null);
    setConnecting(true);
    setQr(null);
    try {
      const res = await whatsappConnect(id);
      if (res.qr) setQr(res.qr);
      if (isConnectedState(res.state)) {
        setConnecting(false);
        await refreshStatus();
        onChanged();
      } else {
        startQrPoll();
      }
    } catch (err) {
      setConnecting(false);
      setError(err instanceof ApiError ? err.message : t("qrError"));
    }
  }

  async function logout() {
    setBusy(true);
    setError(null);
    try {
      await whatsappLogout(id);
      stopQrPoll();
      setConnecting(false);
      setQr(null);
      await refreshStatus();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(which: 1 | 2) {
    setBusy(true);
    setError(null);
    const next = which === 1 ? !type1 : !type2;
    try {
      await updateAcademyAutomation(id, which === 1 ? { type1_billing_enabled: next } : { type2_lessons_enabled: next });
      if (which === 1) setType1(next);
      else setType2(next);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function check() {
    if (!to.trim()) return;
    setCheckBusy(true);
    setCheckResult(null);
    try {
      const res = await whatsappCheckNumber(id, to.trim());
      setCheckResult(res.exists === null ? "nosession" : res.exists ? "yes" : "no");
    } catch {
      setCheckResult("nosession");
    } finally {
      setCheckBusy(false);
    }
  }

  async function sendTest() {
    if (!to.trim() || !text.trim()) return;
    setTestBusy(true);
    setTestResult(null);
    try {
      const res = await whatsappSendTest(id, to.trim(), text.trim());
      setTestResult(res);
      await loadLog();
    } catch (err) {
      setTestResult({ ok: false, transport: "ERROR", error: err instanceof ApiError ? err.message : String(err), deeplink: "" });
    } finally {
      setTestBusy(false);
    }
  }

  async function generateKey() {
    if (!newKeyName.trim()) return;
    setKeyBusy(true);
    setError(null);
    try {
      const res = await createApiKey(id, newKeyName.trim());
      setRevealedKey(res.key);
      setNewKeyName("");
      await loadKeys();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setKeyBusy(false);
    }
  }

  async function revoke(keyId: string) {
    setError(null);
    try {
      await revokeApiKey(id, keyId);
      await loadKeys();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  async function generateLink() {
    setLinkBusy(true);
    setError(null);
    try {
      const res = await createConnectLink(id);
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      setConnectLink({ url: origin + res.path, expiresAt: res.expires_at });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setLinkBusy(false);
    }
  }

  async function copy(value: string, tag: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(tag);
      setTimeout(() => setCopied((c) => (c === tag ? null : c)), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  const fmtTime = (s: string | null | undefined) =>
    s ? new Date(s).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" }) : "—";

  return (
    <Modal open onClose={onClose} title={t("manage.title")} description={academy.academy_name} size="lg">
      <div className="space-y-5">
        {error && <AlertBanner variant="error" message={error} />}

        {/* Connection */}
        <section className="rounded-xl border p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">{t("manage.connection")}</h3>
            <div className="flex items-center gap-2">
              <StatusPill state={status?.state ?? academy.wasender_session_status} />
              <button type="button" onClick={() => void refreshStatus()} className="text-muted-foreground hover:text-foreground rounded-md p-1 transition-colors" aria-label={t("manage.refresh")}>
                <RefreshCw className="size-3.5" aria-hidden />
              </button>
            </div>
          </div>

          {connecting && !connected ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              {qr ? (
                <>
                  <p className="text-muted-foreground text-xs">{t("manage.qrInstructions")}</p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qr} alt="WhatsApp QR" width={220} height={220} className="rounded-lg border bg-white p-2" />
                </>
              ) : (
                <div className="flex flex-col items-center gap-2 py-6">
                  <Loader2 className="text-primary size-6 animate-spin" aria-hidden />
                  <p className="text-muted-foreground text-sm">{t("manage.qrGenerating")}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Fact icon={Phone} label={t("manage.phone")} value={status?.phoneJid ? status.phoneJid.split("@")[0]?.split(":")[0] ?? "—" : "—"} />
              <Fact icon={CheckCircle2} label={t("manage.lastConnected")} value={fmtTime(status?.lastConnectedAt)} />
              <Fact icon={MessageSquare} label={t("manage.queueDepth")} value={String(status?.queueDepth ?? 0)} />
              <Fact icon={RefreshCw} label={t("manage.reconnects")} value={String(status?.reconnectAttempts ?? 0)} />
            </div>
          )}

          <div className="mt-3 flex justify-end gap-2">
            {connected ? (
              <button type="button" disabled={busy} onClick={() => void logout()} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-rose-50 hover:text-rose-700 disabled:opacity-40">
                <LogOut className="size-3.5" aria-hidden />
                {t("manage.logout")}
              </button>
            ) : (
              <button type="button" disabled={connecting} onClick={() => void connect()} className="bg-primary text-primary-foreground inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-90 disabled:opacity-40">
                <QrCode className="size-3.5" aria-hidden />
                {t("manage.connect")}
              </button>
            )}
          </div>
        </section>

        {/* Automation toggles */}
        <section className="rounded-xl border p-4">
          <h3 className="mb-3 text-sm font-semibold">{t("manage.automation")}</h3>
          <div className="space-y-3">
            {([
              { which: 1 as const, on: type1, title: t("manage.billing"), desc: t("manage.billingDesc") },
              { which: 2 as const, on: type2, title: t("manage.reminders"), desc: t("manage.remindersDesc") },
            ]).map((r) => (
              <div key={r.which} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{r.title}</p>
                  <p className="text-muted-foreground text-xs">{r.desc}</p>
                </div>
                <Switch on={r.on} disabled={busy || (!connected && !academy.has_token)} onClick={() => void toggle(r.which)} />
              </div>
            ))}
          </div>
        </section>

        {/* Send test */}
        <section className="rounded-xl border p-4">
          <h3 className="mb-3 text-sm font-semibold">{t("manage.sendTest")}</h3>
          <div className="space-y-3">
            <div>
              <label className="text-muted-foreground mb-1 block text-xs font-medium">{t("manage.toLabel")}</label>
              <input
                value={to}
                onChange={(e) => { setTo(e.target.value); setCheckResult(null); }}
                placeholder={t("manage.toPlaceholder")}
                dir="ltr"
                className="bg-background w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div>
              <label className="text-muted-foreground mb-1 block text-xs font-medium">{t("manage.messageLabel")}</label>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={t("manage.messagePlaceholder")}
                rows={3}
                className="bg-background w-full resize-none rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" disabled={checkBusy || !to.trim()} onClick={() => void check()} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-40">
                {checkBusy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Phone className="size-3.5" aria-hidden />}
                {checkBusy ? t("manage.checking") : t("manage.check")}
              </button>
              <button type="button" disabled={testBusy || !to.trim() || !text.trim()} onClick={() => void sendTest()} className="bg-primary text-primary-foreground inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-90 disabled:opacity-40">
                {testBusy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Send className="size-3.5" aria-hidden />}
                {testBusy ? t("manage.sending") : t("manage.send")}
              </button>
              {checkResult === "yes" && <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 className="size-3.5" />{t("manage.onWhatsapp")}</span>}
              {checkResult === "no" && <span className="inline-flex items-center gap-1 text-xs text-rose-600"><XCircle className="size-3.5" />{t("manage.notOnWhatsapp")}</span>}
              {checkResult === "nosession" && <span className="text-muted-foreground text-xs">{t("manage.cantCheck")}</span>}
            </div>
            {testResult && (
              <div className={cn("rounded-lg px-3 py-2 text-xs", testResult.ok ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800")}>
                {testResult.ok ? (
                  t("manage.sentVia", { transport: testResult.transport })
                ) : testResult.transport === "DEEPLINK" ? (
                  <span>
                    {t("manage.notConnected")}{" "}
                    {testResult.deeplink && (
                      <a href={testResult.deeplink} target="_blank" rel="noreferrer" className="font-medium underline">{t("manage.openDeeplink")}</a>
                    )}
                  </span>
                ) : (
                  t("manage.sendFailed", { error: testResult.error ?? "error" })
                )}
              </div>
            )}
          </div>
        </section>

        {/* API access — external API keys + public connect link */}
        <section className="rounded-xl border p-4">
          <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
            <Key className="size-3.5" aria-hidden />
            {t("manage.apiAccess.title")}
          </h3>
          <p className="text-muted-foreground mb-3 text-xs">{t("manage.apiAccess.desc")}</p>

          {/* Public connect link */}
          <div className="bg-muted/40 mb-4 rounded-lg p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-xs font-medium">
                <Link2 className="size-3.5" aria-hidden />
                {t("manage.apiAccess.connectLink")}
              </p>
              <button
                type="button"
                disabled={linkBusy}
                onClick={() => void generateLink()}
                className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-40"
              >
                {linkBusy ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <RefreshCw className="size-3" aria-hidden />}
                {connectLink ? t("manage.apiAccess.regenerate") : t("manage.apiAccess.generate")}
              </button>
            </div>
            <p className="text-muted-foreground mt-1 text-[11px]">{t("manage.apiAccess.connectLinkHint")}</p>
            {connectLink && (
              <div className="mt-2 space-y-1">
                <div className="flex items-center gap-2">
                  <input readOnly value={connectLink.url} dir="ltr" className="bg-background w-full rounded-md border px-2 py-1 font-mono text-[11px]" />
                  <button type="button" onClick={() => void copy(connectLink.url, "link")} className="text-muted-foreground hover:text-foreground rounded-md border p-1.5" aria-label={t("manage.apiAccess.copy")}>
                    <Copy className="size-3.5" aria-hidden />
                  </button>
                </div>
                <p className="text-muted-foreground text-[11px]">
                  {copied === "link" ? t("manage.apiAccess.copied") : t("manage.apiAccess.expiresAt", { time: fmtTime(connectLink.expiresAt) })}
                </p>
              </div>
            )}
          </div>

          {/* Freshly-minted key (shown once) */}
          {revealedKey && (
            <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
              <p className="text-xs font-medium text-amber-800">{t("manage.apiAccess.newKeyWarning")}</p>
              <div className="mt-2 flex items-center gap-2">
                <input readOnly value={revealedKey} dir="ltr" className="w-full rounded-md border bg-white px-2 py-1 font-mono text-[11px]" />
                <button type="button" onClick={() => void copy(revealedKey, "key")} className="rounded-md border bg-white p-1.5 text-slate-600 hover:text-slate-900" aria-label={t("manage.apiAccess.copy")}>
                  <Copy className="size-3.5" aria-hidden />
                </button>
                <button type="button" onClick={() => setRevealedKey(null)} className="rounded-md border bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:text-slate-900">
                  {t("manage.apiAccess.done")}
                </button>
              </div>
              {copied === "key" && <p className="mt-1 text-[11px] text-amber-800">{t("manage.apiAccess.copied")}</p>}
            </div>
          )}

          {/* Create key */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder={t("manage.apiAccess.keyNamePlaceholder")}
              className="bg-background min-w-0 flex-1 rounded-lg border px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            />
            <button
              type="button"
              disabled={keyBusy || !newKeyName.trim()}
              onClick={() => void generateKey()}
              className="bg-primary text-primary-foreground inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {keyBusy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Plus className="size-3.5" aria-hidden />}
              {t("manage.apiAccess.createKey")}
            </button>
          </div>

          {/* Key list */}
          {keys === null ? (
            <div className="bg-muted h-12 animate-pulse rounded" aria-hidden />
          ) : keys.length === 0 ? (
            <p className="text-muted-foreground py-2 text-center text-xs">{t("manage.apiAccess.noKeys")}</p>
          ) : (
            <ul className="divide-y">
              {keys.map((k) => (
                <li key={k.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {k.name}
                      {k.revoked_at && <span className="ml-2 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium text-rose-700">{t("manage.apiAccess.revoked")}</span>}
                    </p>
                    <p className="text-muted-foreground font-mono text-[11px]" dir="ltr">
                      {k.key_prefix}… · {t("manage.apiAccess.lastUsed", { time: fmtTime(k.last_used_at) })}
                    </p>
                  </div>
                  {!k.revoked_at && (
                    <button type="button" onClick={() => void revoke(k.id)} className="text-muted-foreground hover:text-rose-600 rounded-md p-1.5 transition-colors" aria-label={t("manage.apiAccess.revoke")}>
                      <Trash2 className="size-3.5" aria-hidden />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Recent activity */}
        <section className="rounded-xl border p-4">
          <h3 className="mb-3 text-sm font-semibold">{t("manage.recentActivity")}</h3>
          {log === null ? (
            <div className="bg-muted h-16 animate-pulse rounded" aria-hidden />
          ) : log.length === 0 ? (
            <p className="text-muted-foreground py-4 text-center text-sm">{t("manage.noActivity")}</p>
          ) : (
            <div className="max-h-56 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="text-start">
                    <th className="py-1 text-start font-medium">{t("manage.logType")}</th>
                    <th className="py-1 text-start font-medium">{t("manage.logRecipient")}</th>
                    <th className="py-1 text-start font-medium">{t("manage.logStatus")}</th>
                    <th className="py-1 text-end font-medium">{t("manage.logTime")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {log.map((r) => (
                    <tr key={r.id}>
                      <td className="py-1.5">{r.automation_type}</td>
                      <td className="py-1.5" dir="ltr">{r.recipient_phone ?? "—"}</td>
                      <td className="py-1.5">
                        <span className={cn(r.status === "SENT" ? "text-emerald-600" : r.status === "FAILED" ? "text-rose-600" : "text-muted-foreground")}>{r.status}</span>
                      </td>
                      <td className="py-1.5 text-end tabular-nums">{fmtTime(r.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}
