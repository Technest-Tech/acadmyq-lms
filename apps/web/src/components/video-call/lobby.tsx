"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMediaDeviceSelect, usePreviewTracks } from "@livekit/components-react";
import {
  Track,
  type CreateLocalTracksOptions,
  type LocalAudioTrack,
  type LocalVideoTrack,
} from "livekit-client";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Loader2,
  Mic,
  MicOff,
  ShieldAlert,
  Video,
  VideoOff,
} from "lucide-react";
import { getMe } from "@/lib/api";
import { LOCALE_COOKIE, locales } from "@/i18n/config";
import { BrandBackdrop } from "./brand-backdrop";
import { MicMeter } from "./mic-meter";

/** The device + identity choices the lobby hands to the call on Join. */
export interface LobbySettings {
  name: string;
  micEnabled: boolean;
  camEnabled: boolean;
  audioDeviceId?: string;
  videoDeviceId?: string;
}

type MediaError = "insecure" | "denied" | "notfound" | null;

export function Lobby({
  roomTitle,
  onJoin,
  joining,
  joinError,
}: {
  roomTitle?: string;
  onJoin: (settings: LobbySettings) => void;
  joining: boolean;
  joinError?: string;
}) {
  const t = useTranslations("videoCall");

  const secure = typeof window === "undefined" ? true : window.isSecureContext;

  const [name, setName] = useState("");
  const [nameError, setNameError] = useState(false);
  const [camEnabled, setCamEnabled] = useState(true);
  const [micEnabled, setMicEnabled] = useState(true);
  const [mediaError, setMediaError] = useState<MediaError>(secure ? null : "insecure");
  const [identity, setIdentity] = useState<{ loading: boolean; hostName: string | null }>({
    loading: true,
    hostName: null,
  });

  // Detect a logged-in host (panel session cookie) so we can skip the name field for teachers.
  useEffect(() => {
    let active = true;
    getMe()
      .then((s) => active && setIdentity({ loading: false, hostName: s.user.fullName }))
      .catch(() => active && setIdentity({ loading: false, hostName: null }));
    return () => {
      active = false;
    };
  }, []);

  const isHost = identity.hostName !== null;

  const camSelect = useMediaDeviceSelect({ kind: "videoinput" });
  const micSelect = useMediaDeviceSelect({ kind: "audioinput" });

  const trackOptions = useMemo<CreateLocalTracksOptions>(
    () =>
      secure
        ? {
            audio: micEnabled
              ? micSelect.activeDeviceId
                ? { deviceId: micSelect.activeDeviceId }
                : true
              : false,
            video: camEnabled
              ? camSelect.activeDeviceId
                ? { deviceId: camSelect.activeDeviceId }
                : true
              : false,
          }
        : { audio: false, video: false },
    [secure, micEnabled, camEnabled, micSelect.activeDeviceId, camSelect.activeDeviceId],
  );

  // Must be referentially stable: usePreviewTracks keys its acquire effect on this callback, so a
  // fresh arrow each render would re-run getUserMedia in a tight loop (each new LocalAudioTrack
  // logs "silence detected" on a quiet mic). useCallback pins it.
  const handlePreviewError = useCallback(
    (e: Error) => {
      if (!secure) setMediaError("insecure");
      else if (e.name === "NotFoundError" || /not found|notfound/i.test(e.message)) setMediaError("notfound");
      else setMediaError("denied");
    },
    [secure],
  );

  const tracks = usePreviewTracks(trackOptions, handlePreviewError);

  const videoTrack = tracks?.find((tr) => tr.kind === Track.Kind.Video) as LocalVideoTrack | undefined;
  const audioTrack = tracks?.find((tr) => tr.kind === Track.Kind.Audio) as LocalAudioTrack | undefined;

  // Clear a transient error once tracks come back (e.g. user re-granted permission).
  useEffect(() => {
    if (videoTrack || audioTrack) setMediaError(null);
  }, [videoTrack, audioTrack]);

  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !videoTrack) return;
    videoTrack.attach(el);
    return () => {
      videoTrack.detach(el);
    };
  }, [videoTrack]);

  function handleJoin() {
    if (!isHost && !name.trim()) {
      setNameError(true);
      return;
    }
    onJoin({
      name: isHost ? (identity.hostName ?? "") : name.trim(),
      micEnabled,
      camEnabled,
      audioDeviceId: micSelect.activeDeviceId || undefined,
      videoDeviceId: camSelect.activeDeviceId || undefined,
    });
  }

  const errorConfig = mediaError
    ? {
        insecure: { Icon: ShieldAlert, title: t("insecureTitle"), body: t("insecureBody") },
        denied: { Icon: AlertTriangle, title: t("previewBlockedTitle"), body: t("previewBlockedBody") },
        notfound: { Icon: VideoOff, title: t("noDevicesTitle"), body: t("noDevicesBody") },
      }[mediaError]
    : null;

  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center p-4 text-white">
      <BrandBackdrop />

      <div className="relative grid w-full max-w-4xl gap-5 rounded-3xl bg-white/[0.03] p-4 ring-1 ring-white/10 backdrop-blur-sm sm:p-6 lg:grid-cols-[1.4fr_1fr]">
        {/* Language toggle — guests with no account can pick their language before joining */}
        <div className="absolute end-3 top-3 z-20">
          <LangToggle />
        </div>

        {/* ── Camera preview ── */}
        <div className="relative aspect-video overflow-hidden rounded-2xl bg-slate-900 ring-1 ring-white/10">
          {errorConfig ? (
            <MediaErrorPanel Icon={errorConfig.Icon} title={errorConfig.title} body={errorConfig.body} />
          ) : camEnabled && videoTrack ? (
            <video
              ref={videoRef}
              className="size-full -scale-x-100 object-cover"
              muted
              playsInline
            />
          ) : (
            <div className="flex size-full flex-col items-center justify-center gap-3 text-slate-400">
              <VideoOff className="size-10" />
              <p className="text-sm">{t("cameraDisabled")}</p>
            </div>
          )}

          {/* Bottom overlay: live mic meter + preview controls */}
          {!mediaError && (
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 bg-gradient-to-t from-black/70 to-transparent p-3">
              <div className="flex items-center gap-2">
                {micEnabled ? (
                  <MicMeter track={audioTrack} />
                ) : (
                  <MicOff className="size-4 text-red-400" />
                )}
              </div>
              <div className="flex items-center gap-2">
                <PreviewToggle
                  on={micEnabled}
                  onClick={() => setMicEnabled((v) => !v)}
                  OnIcon={Mic}
                  OffIcon={MicOff}
                  label={micEnabled ? t("muteMic") : t("unmuteMic")}
                />
                <PreviewToggle
                  on={camEnabled}
                  onClick={() => setCamEnabled((v) => !v)}
                  OnIcon={Video}
                  OffIcon={VideoOff}
                  label={camEnabled ? t("turnCameraOff") : t("turnCameraOn")}
                />
              </div>
            </div>
          )}
        </div>

        {/* ── Join panel ── */}
        <div className="flex flex-col">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300/80">
            {roomTitle ?? "AcademIQ"}
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-white">{t("lobbyTitle")}</h1>
          <p className="mt-1 text-sm text-slate-400">{t("lobbySubtitle")}</p>

          {/* Name (guests) or host identity */}
          <div className="mt-5">
            {identity.loading ? (
              <div className="h-[46px] animate-pulse rounded-xl bg-white/5" />
            ) : isHost ? (
              <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm">
                <span className="text-slate-300">{t("you")}: </span>
                <span className="font-semibold text-white">{identity.hostName}</span>
              </div>
            ) : (
              <>
                <label htmlFor="display-name" className="block text-sm font-medium text-slate-300">
                  {t("nameLabel")}
                </label>
                <input
                  id="display-name"
                  type="text"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (nameError) setNameError(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !joining) handleJoin();
                  }}
                  maxLength={80}
                  autoFocus
                  placeholder={t("namePlaceholder")}
                  className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-slate-500 outline-none focus:border-emerald-400/50 focus:ring-2 focus:ring-emerald-400/20"
                />
                {nameError && <p className="mt-1.5 text-sm text-red-400">{t("nameRequired")}</p>}
              </>
            )}
          </div>

          {/* Device pickers */}
          {!mediaError && (
            <div className="mt-4 space-y-2.5">
              <DevicePicker
                label={t("camera")}
                Icon={Video}
                devices={camSelect.devices}
                activeId={camSelect.activeDeviceId}
                onChange={(id) => void camSelect.setActiveMediaDevice(id)}
              />
              <DevicePicker
                label={t("microphone")}
                Icon={Mic}
                devices={micSelect.devices}
                activeId={micSelect.activeDeviceId}
                onChange={(id) => void micSelect.setActiveMediaDevice(id)}
              />
            </div>
          )}

          {joinError && <p className="mt-3 text-sm text-red-400">{joinError}</p>}

          <button
            type="button"
            onClick={handleJoin}
            disabled={joining || identity.loading}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 py-3.5 text-base font-semibold text-white shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400 disabled:opacity-60"
          >
            {joining ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {t("joining")}
              </>
            ) : mediaError ? (
              t("continueWithout")
            ) : (
              t("join")
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Dark-styled ar/en switch for the lobby — writes the NEXT_LOCALE cookie + soft-refreshes. */
function LangToggle() {
  const active = useLocale();
  const t = useTranslations("locale");
  const router = useRouter();

  function switchTo(locale: string) {
    document.cookie = `${LOCALE_COOKIE}=${locale};path=/;max-age=31536000;samesite=lax`;
    router.refresh();
  }

  return (
    <div
      className="flex items-center gap-0.5 rounded-lg bg-black/30 p-0.5 ring-1 ring-white/10 backdrop-blur"
      role="group"
      aria-label="language"
    >
      {locales.map((locale) => (
        <button
          key={locale}
          type="button"
          aria-pressed={locale === active}
          onClick={() => switchTo(locale)}
          className={`rounded-md px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide transition ${
            locale === active ? "bg-white/15 text-white" : "text-slate-400 hover:text-white"
          }`}
        >
          {t(locale)}
        </button>
      ))}
    </div>
  );
}

function PreviewToggle({
  on,
  onClick,
  OnIcon,
  OffIcon,
  label,
}: {
  on: boolean;
  onClick: () => void;
  OnIcon: typeof Mic;
  OffIcon: typeof Mic;
  label: string;
}) {
  const Icon = on ? OnIcon : OffIcon;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      aria-label={label}
      title={label}
      className={`flex size-10 items-center justify-center rounded-full backdrop-blur transition ${
        on ? "bg-white/15 text-white hover:bg-white/25" : "bg-red-500/90 text-white hover:bg-red-500"
      }`}
    >
      <Icon className="size-5" />
    </button>
  );
}

function DevicePicker({
  label,
  Icon,
  devices,
  activeId,
  onChange,
}: {
  label: string;
  Icon: typeof Mic;
  devices: MediaDeviceInfo[];
  activeId: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
      <Icon className="size-4 shrink-0 text-slate-400" />
      <select
        aria-label={label}
        value={activeId}
        onChange={(e) => onChange(e.target.value)}
        disabled={devices.length === 0}
        className="min-w-0 flex-1 bg-transparent text-sm text-slate-200 outline-none [&>option]:bg-slate-800"
      >
        {devices.length === 0 ? (
          <option value="">{label}</option>
        ) : (
          devices.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `${label} ${i + 1}`}
            </option>
          ))
        )}
      </select>
    </div>
  );
}

function MediaErrorPanel({
  Icon,
  title,
  body,
}: {
  Icon: typeof Mic;
  title: string;
  body: string;
}) {
  return (
    <div className="flex size-full flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-amber-400/15 text-amber-300">
        <Icon className="size-6" />
      </span>
      <p className="font-semibold text-white">{title}</p>
      <p className="max-w-xs text-sm text-slate-400">{body}</p>
    </div>
  );
}
