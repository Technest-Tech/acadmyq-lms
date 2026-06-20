"use client";

import {
  CheckCircle2,
  KeyRound,
  Loader2,
  LogOut,
  MessageCircle,
  QrCode,
  Send,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { AlertBanner } from "@/components/ui/alert";
import { Modal } from "@/components/ui/modal";
import {
  ApiError,
  getAutomationOverview,
  updateAcademyAutomation,
  whatsappConnect,
  whatsappLogout,
  whatsappQr,
  type AutomationOverviewRow,
} from "@/lib/api";
import { formatNumber } from "@/lib/money";
import { cn } from "@/lib/utils";

const isConnected = (status: string | null | undefined): boolean =>
  (status ?? "").toUpperCase() === "CONNECTED";

function StatCard({
  icon: Icon,
  label,
  value,
  gradient,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  gradient: string;
}) {
  return (
    <div className="bg-card relative flex items-center gap-3.5 overflow-hidden rounded-2xl border p-4 shadow-sm ring-1 ring-foreground/[0.04]">
      <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl text-white shadow-sm", gradient)}>
        <Icon className="size-5" aria-hidden />
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-bold leading-none tracking-tight tabular-nums">{value}</p>
        <p className="text-muted-foreground mt-1 truncate text-xs font-medium">{label}</p>
      </div>
    </div>
  );
}

function Switch({
  on,
  disabled,
  onClick,
  label,
}: {
  on: boolean;
  disabled: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
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

export function AutomationOverviewScreen() {
  const t = useTranslations("adminAutomation");
  const locale = useLocale();
  const { can } = useAuth();

  const [rows, setRows] = useState<AutomationOverviewRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // QR connect modal state.
  const [qrAcademy, setQrAcademy] = useState<AutomationOverviewRow | null>(null);
  const [qrData, setQrData] = useState<string | null>(null);
  const [qrState, setQrState] = useState<string>("connecting");
  const [qrError, setQrError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows((await getAutomationOverview()).academies);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("loadError"));
    }
  }, [t]);

  useEffect(() => {
    if (can("automation.manage")) void load();
  }, [load, can]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // Stop polling when the screen unmounts.
  useEffect(() => () => stopPolling(), [stopPolling]);

  if (!can("automation.manage")) {
    return <p className="text-muted-foreground text-sm">{t("noPermission")}</p>;
  }

  async function toggle(
    r: AutomationOverviewRow,
    key: "type1_billing_enabled" | "type2_lessons_enabled",
  ) {
    setError(null);
    setBusy(true);
    try {
      await updateAcademyAutomation(r.academy_id, { [key]: !r[key] });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function startPolling(academyId: string) {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const res = await whatsappQr(academyId);
        setQrState(res.state);
        if (res.qr) setQrData(res.qr);
        if (isConnected(res.state)) {
          stopPolling();
          await load();
          setTimeout(() => closeConnect(), 1500); // brief success flash before closing
        }
      } catch {
        // transient error — keep polling
      }
    }, 3000);
  }

  async function openConnect(r: AutomationOverviewRow) {
    setQrAcademy(r);
    setQrData(null);
    setQrState("connecting");
    setQrError(null);
    try {
      const res = await whatsappConnect(r.academy_id);
      setQrState(res.state || "qr");
      if (res.qr) setQrData(res.qr);
      if (isConnected(res.state)) {
        await load();
        setTimeout(() => closeConnect(), 1500);
      } else {
        startPolling(r.academy_id);
      }
    } catch (err) {
      setQrError(err instanceof ApiError ? err.message : t("qrError"));
    }
  }

  function closeConnect() {
    stopPolling();
    setQrAcademy(null);
    setQrData(null);
    setQrError(null);
  }

  async function logout(r: AutomationOverviewRow) {
    setError(null);
    setBusy(true);
    try {
      await whatsappLogout(r.academy_id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const connected = rows?.filter((r) => isConnected(r.wasender_session_status)).length ?? 0;
  const t1 = rows?.filter((r) => r.type1_billing_enabled).length ?? 0;
  const t2 = rows?.filter((r) => r.type2_lessons_enabled).length ?? 0;
  const sends = rows?.reduce((n, r) => n + r.sent_count, 0) ?? 0;

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="from-primary/[0.10] via-card to-card relative overflow-hidden rounded-2xl border bg-gradient-to-br p-5 shadow-sm ring-1 ring-foreground/[0.04]">
        <div className="flex items-center gap-3.5">
          <div className="bg-primary/12 text-primary flex size-11 items-center justify-center rounded-xl">
            <MessageCircle className="size-5.5" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
            <p className="text-muted-foreground mt-0.5 text-sm">{t("subtitle")}</p>
          </div>
        </div>
      </div>

      {error && <AlertBanner variant="error" message={error} />}

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard icon={KeyRound} label={t("kpi.connected")} value={formatNumber(connected, locale)} gradient="bg-gradient-to-br from-emerald-500 to-teal-600" />
        <StatCard icon={MessageCircle} label={t("kpi.type1")} value={formatNumber(t1, locale)} gradient="bg-gradient-to-br from-blue-500 to-indigo-600" />
        <StatCard icon={MessageCircle} label={t("kpi.type2")} value={formatNumber(t2, locale)} gradient="bg-gradient-to-br from-violet-500 to-purple-600" />
        <StatCard icon={Send} label={t("kpi.sends")} value={formatNumber(sends, locale)} gradient="bg-gradient-to-br from-amber-500 to-orange-600" />
      </div>

      {/* Academy automation table */}
      <div className="bg-card overflow-x-auto rounded-2xl border shadow-sm ring-1 ring-foreground/[0.04]">
        <table className="w-full text-sm" data-testid="automation-table">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2.5 text-start">{t("col.academy")}</th>
              <th className="px-3 py-2.5 text-center">{t("col.whatsapp")}</th>
              <th className="px-3 py-2.5 text-center">{t("col.type1")}</th>
              <th className="px-3 py-2.5 text-center">{t("col.type2")}</th>
              <th className="px-3 py-2.5 text-end">{t("col.sends")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows === null ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i}>
                  <td colSpan={5} className="px-3 py-3">
                    <div className="bg-muted h-5 animate-pulse rounded" aria-hidden />
                  </td>
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-muted-foreground px-3 py-10 text-center">{t("none")}</td>
              </tr>
            ) : (
              rows.map((r) => {
                const conn = isConnected(r.wasender_session_status);
                return (
                  <tr key={r.academy_id} data-academy={r.academy_id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2 font-medium">
                      <Link href="/academies" className="hover:text-primary hover:underline">
                        {r.academy_name}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-center">
                        {conn ? (
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                              <CheckCircle2 className="size-4" aria-hidden />
                              {t("connected")}
                            </span>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void logout(r)}
                              className="text-muted-foreground hover:text-rose-600 inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors disabled:opacity-40"
                            >
                              <LogOut className="size-3.5" aria-hidden />
                              {t("logout")}
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void openConnect(r)}
                            data-testid={`wa-connect-${r.academy_id}`}
                            className="bg-primary/10 text-primary hover:bg-primary/15 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-40"
                          >
                            <QrCode className="size-3.5" aria-hidden />
                            {t("connect")}
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-center">
                        <Switch on={r.type1_billing_enabled} disabled={busy || !r.has_token} onClick={() => void toggle(r, "type1_billing_enabled")} label={`type1 ${r.academy_name}`} />
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-center">
                        <Switch on={r.type2_lessons_enabled} disabled={busy || !r.has_token} onClick={() => void toggle(r, "type2_lessons_enabled")} label={`type2 ${r.academy_name}`} />
                      </div>
                    </td>
                    <td className="px-3 py-2 text-end tabular-nums">
                      <span className="text-emerald-600">{formatNumber(r.sent_count, locale)}</span>
                      {r.failed_count > 0 && (
                        <span className="text-rose-600"> · {formatNumber(r.failed_count, locale)}</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <p className="text-muted-foreground text-xs">{t("tokenHint")}</p>

      {/* QR connect modal */}
      <Modal
        open={qrAcademy !== null}
        onClose={closeConnect}
        title={t("qrTitle")}
        description={qrAcademy?.academy_name}
        size="sm"
      >
        <div className="flex flex-col items-center gap-4 py-2 text-center">
          {qrError ? (
            <AlertBanner variant="error" message={qrError} />
          ) : isConnected(qrState) ? (
            <div className="flex flex-col items-center gap-2 py-6">
              <CheckCircle2 className="size-10 text-emerald-600" aria-hidden />
              <p className="text-sm font-medium">{t("qrConnected")}</p>
            </div>
          ) : qrData ? (
            <>
              <p className="text-muted-foreground text-sm">{t("qrInstructions")}</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrData}
                alt="WhatsApp QR"
                width={256}
                height={256}
                className="rounded-lg border bg-white p-2"
              />
            </>
          ) : (
            <div className="flex flex-col items-center gap-2 py-10">
              <Loader2 className="text-primary size-7 animate-spin" aria-hidden />
              <p className="text-muted-foreground text-sm">{t("qrGenerating")}</p>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
