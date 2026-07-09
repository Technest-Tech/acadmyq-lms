"use client";

import { CheckCircle2, Loader2, MessageCircle, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, waConnectQr, waConnectStart, waConnectStatus } from "@/lib/api";

const isConnected = (s: string | null | undefined): boolean => (s ?? "").toLowerCase() === "connected";

type Phase = "starting" | "scanning" | "connected" | "invalid" | "error";

/**
 * Drives the public pairing flow: POST …/start to open a session + get the first QR, then poll
 * …/status until the phone links. Goes through the shared apiFetch client (token-in-path, no login)
 * so Sanctum's stateful CSRF token is primed — a raw fetch would 419.
 */
export function WhatsAppConnectScreen({ token }: { token: string }) {
  const t = useTranslations("waConnect");
  const [phase, setPhase] = useState<Phase>("starting");
  const [qr, setQr] = useState<string | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPoll = useCallback(() => {
    if (poll.current) {
      clearInterval(poll.current);
      poll.current = null;
    }
  }, []);

  const start = useCallback(async () => {
    setPhase("starting");
    setQr(null);
    try {
      const data = await waConnectStart(token);
      if (isConnected(data.state)) {
        setPhase("connected");
        return;
      }
      if (data.qr) setQr(data.qr);
      setPhase("scanning");
    } catch (err) {
      setPhase(err instanceof ApiError && err.status === 404 ? "invalid" : "error");
    }
  }, [token]);

  useEffect(() => {
    void start();
    return stopPoll;
  }, [start, stopPoll]);

  // While scanning, poll status (and refresh the QR, which rotates) until the phone links.
  useEffect(() => {
    if (phase !== "scanning") return;
    stopPoll();
    poll.current = setInterval(async () => {
      try {
        const [s, q] = await Promise.all([waConnectStatus(token), waConnectQr(token)]);
        if (isConnected(s.state)) {
          setPhase("connected");
          stopPoll();
          return;
        }
        if (q.qr) setQr(q.qr);
      } catch {
        /* keep polling */
      }
    }, 3000);
    return stopPoll;
  }, [phase, token, stopPoll]);

  return (
    <main className="bg-background text-foreground flex min-h-dvh items-center justify-center p-4">
      <div className="bg-card w-full max-w-md rounded-2xl border p-6 shadow-sm ring-1 ring-foreground/[0.04]">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600">
            <MessageCircle className="size-6" aria-hidden />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight">{t("title")}</h1>
            <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
          </div>
        </div>

        {phase === "starting" && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <Loader2 className="size-7 animate-spin text-emerald-600" aria-hidden />
            <p className="text-muted-foreground text-sm">{t("starting")}</p>
          </div>
        )}

        {phase === "scanning" && (
          <div className="flex flex-col items-center gap-4 py-2 text-center">
            <ol className="text-muted-foreground w-full space-y-1 text-start text-sm">
              <li>{t("step1")}</li>
              <li>{t("step2")}</li>
              <li>{t("step3")}</li>
            </ol>
            {qr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qr} alt="WhatsApp QR" width={240} height={240} className="rounded-lg border bg-white p-2" />
            ) : (
              <div className="flex flex-col items-center gap-2 py-8">
                <Loader2 className="size-6 animate-spin text-emerald-600" aria-hidden />
                <p className="text-muted-foreground text-sm">{t("generating")}</p>
              </div>
            )}
            <p className="text-muted-foreground text-xs">{t("waiting")}</p>
          </div>
        )}

        {phase === "connected" && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <CheckCircle2 className="size-10 text-emerald-600" aria-hidden />
            <p className="text-base font-semibold">{t("connectedTitle")}</p>
            <p className="text-muted-foreground text-sm">{t("connectedBody")}</p>
          </div>
        )}

        {phase === "invalid" && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <XCircle className="size-10 text-rose-500" aria-hidden />
            <p className="text-base font-semibold">{t("invalidTitle")}</p>
            <p className="text-muted-foreground text-sm">{t("invalidBody")}</p>
          </div>
        )}

        {phase === "error" && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <XCircle className="size-10 text-amber-500" aria-hidden />
            <p className="text-base font-semibold">{t("errorTitle")}</p>
            <p className="text-muted-foreground text-sm">{t("errorBody")}</p>
            <button
              type="button"
              onClick={() => void start()}
              className="bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90"
            >
              {t("retry")}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
