"use client";

import {
  CheckCircle2,
  Loader2,
  LogOut,
  MessageSquare,
  Phone,
  QrCode,
  RefreshCw,
  Send,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { AlertBanner } from "@/components/ui/alert";
import {
  ApiError,
  getAutomationLog,
  updateAcademyAutomation,
  whatsappCheckNumber,
  whatsappConnect,
  whatsappLogout,
  whatsappQr,
  whatsappSendTest,
  whatsappStatus,
  type AutomationLogRow,
  type AutomationOverviewRow,
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

  const stopQrPoll = useCallback(() => {
    if (qrPoll.current) {
      clearInterval(qrPoll.current);
      qrPoll.current = null;
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
    void loadLog();
    const iv = setInterval(() => void refreshStatus(), 5000);
    return () => {
      clearInterval(iv);
      stopQrPoll();
    };
  }, [refreshStatus, loadLog, stopQrPoll]);

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
