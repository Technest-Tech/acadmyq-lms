"use client";

import { CheckCircle2, Loader2, MessageCircle, QrCode, RefreshCw, Unlink, WifiOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { SectionCard } from "@/components/settings/section-card";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  ApiError,
  type AcademyWhatsApp,
  connectAcademyWhatsApp,
  getAcademyWhatsApp,
  logoutAcademyWhatsApp,
} from "@/lib/api";

/** States in which the gateway is still working towards a connection — keep polling. */
const IN_PROGRESS = new Set(["qr", "connecting"]);
const POLL_MS = 3000;

/**
 * Settings → WhatsApp: the academy links its own number by scanning a QR, instead of waiting on
 * us to send a connect link. "Connect" is safe to press any time — the API returns a live
 * connection untouched and only starts a new pairing when the number is really unlinked.
 */
export function WhatsAppManager() {
  const t = useTranslations("settings.whatsapp");
  const [wa, setWa] = useState<AcademyWhatsApp | null>(null);
  const [busy, setBusy] = useState(false);
  // Set once the user asks to pair, so a reconnecting session keeps being watched until it settles.
  const [pairing, setPairing] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fail = (err: unknown) => setError(err instanceof ApiError ? err.message : String(err));

  const load = useCallback(async () => {
    try {
      setWa(await getAcademyWhatsApp());
    } catch (err) {
      fail(err);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const state = wa?.state ?? null;
  const connected = state === "connected";
  const watching = !connected && (IN_PROGRESS.has(state ?? "") || pairing);

  // The QR rotates every ~20s and the phone links at any moment: poll while a pairing is under way.
  useEffect(() => {
    if (!watching) return;
    const id = setInterval(() => {
      getAcademyWhatsApp()
        .then((next) => {
          setWa(next);
          if (next.state === "connected") setPairing(false);
        })
        .catch(() => {
          /* keep polling */
        });
    }, POLL_MS);
    return () => clearInterval(id);
  }, [watching]);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const next = await connectAcademyWhatsApp();
      setWa(next);
      setPairing(next.state !== "connected");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    setBusy(true);
    setError(null);
    try {
      setWa(await logoutAcademyWhatsApp());
      setPairing(false);
      setConfirmUnlink(false);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard
      icon={MessageCircle}
      title={t("cardTitle")}
      description={t("cardDesc")}
      iconClassName="bg-gradient-to-br from-emerald-500 to-green-600 shadow-emerald-500/25"
      testId="whatsapp-card"
    >
      {error && (
        <div className="mb-4">
          <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      {wa === null ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="text-primary size-6 animate-spin" aria-hidden />
        </div>
      ) : connected ? (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center" data-testid="whatsapp-connected">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600">
              <CheckCircle2 className="size-6" aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold">{t("connected")}</p>
              {wa.phone && (
                <p className="text-muted-foreground mt-0.5 text-sm tabular-nums" dir="ltr">
                  +{wa.phone}
                </p>
              )}
              <p className="text-muted-foreground mt-1 text-xs">{t("connectedHint")}</p>
            </div>
          </div>
          <Button variant="destructive" disabled={busy} onClick={() => setConfirmUnlink(true)}>
            <Unlink className="size-4" aria-hidden />
            {t("unlink")}
          </Button>
        </div>
      ) : watching ? (
        <div className="flex flex-col items-center gap-4 text-center" data-testid="whatsapp-pairing">
          <ol className="text-muted-foreground w-full max-w-sm space-y-1 text-start text-sm">
            <li>{t("step1")}</li>
            <li>{t("step2")}</li>
            <li>{t("step3")}</li>
          </ol>
          {wa.qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={wa.qr}
              alt={t("qrAlt")}
              width={240}
              height={240}
              className="size-60 rounded-lg border bg-white p-2"
            />
          ) : (
            <div className="flex size-60 flex-col items-center justify-center gap-2 rounded-lg border border-dashed">
              <Loader2 className="size-6 animate-spin text-emerald-600" aria-hidden />
              <p className="text-muted-foreground px-4 text-xs">
                {state === "connecting" ? t("linking") : t("generating")}
              </p>
            </div>
          )}
          <p className="text-muted-foreground text-xs">{t("waiting")}</p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 py-4 text-center" data-testid="whatsapp-disconnected">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-600">
            {state === "unknown" ? (
              <WifiOff className="size-6" aria-hidden />
            ) : (
              <QrCode className="size-6" aria-hidden />
            )}
          </div>
          <div className="max-w-sm">
            <p className="text-sm font-semibold">
              {state === "unknown" ? t("unreachableTitle") : t("disconnectedTitle")}
            </p>
            <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
              {state === "unknown" ? t("unreachableBody") : t("disconnectedBody")}
            </p>
          </div>
          {state === "unknown" ? (
            <Button variant="outline" disabled={busy} onClick={() => void load()}>
              <RefreshCw className="size-4" aria-hidden />
              {t("retry")}
            </Button>
          ) : (
            <Button disabled={busy} onClick={() => void connect()} data-testid="whatsapp-connect">
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <QrCode className="size-4" aria-hidden />}
              {t("connect")}
            </Button>
          )}
        </div>
      )}

      <Modal
        open={confirmUnlink}
        onClose={() => setConfirmUnlink(false)}
        title={t("unlinkTitle")}
        description={t("unlinkBody")}
        size="sm"
        footer={
          <>
            <Button variant="outline" disabled={busy} onClick={() => setConfirmUnlink(false)}>
              {t("cancel")}
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => void unlink()} data-testid="whatsapp-unlink-confirm">
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t("unlink")}
            </Button>
          </>
        }
      >
        <p className="text-muted-foreground text-sm">{t("unlinkWarn")}</p>
      </Modal>
    </SectionCard>
  );
}
