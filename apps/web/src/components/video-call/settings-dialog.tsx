"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocalParticipant, useMediaDeviceSelect } from "@livekit/components-react";
import {
  Track,
  supportsAudioOutputSelection,
  type LocalAudioTrack,
  type LocalVideoTrack,
} from "livekit-client";
import { useTranslations } from "next-intl";
import { Ban, Loader2, Mic, Sparkles, Upload, Video as VideoIcon, Volume2, Wand2, X } from "lucide-react";
import { applyBackground, backgroundSupported } from "./background-processor";
import { DevicePicker } from "./device-picker";
import { MicMeter } from "./mic-meter";
import {
  micConstraints,
  resolutionConstraints,
  useSettings,
  type CallBackground,
  type VideoResolution,
} from "./use-call-settings";

type Tab = "audio" | "video" | "background";

/**
 * A premium in-call Settings popup (Audio · Video). Every change applies LIVE to the local tracks and
 * is persisted, so "Apply automatically when I join" can re-use it next time. Centered glass card on
 * desktop, near-full-width on mobile; Esc / backdrop close; RTL-correct.
 */
export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations("videoCall");
  const [tab, setTab] = useState<Tab>("audio");
  const { settings, update } = useSettings();
  const { localParticipant } = useLocalParticipant();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const micTrack = localParticipant.getTrackPublication(Track.Source.Microphone)?.track as
    | LocalAudioTrack
    | undefined;
  const camTrack = localParticipant.getTrackPublication(Track.Source.Camera)?.track as
    | LocalVideoTrack
    | undefined;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 text-white">
      <button
        type="button"
        aria-label={t("close")}
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("settings")}
        className="relative flex max-h-[88dvh] w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-slate-800/95 ring-1 ring-white/10 shadow-2xl backdrop-blur"
      >
        <header className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <h2 className="text-base font-semibold">{t("settings")}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="flex size-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/10 hover:text-white"
          >
            <X className="size-5" />
          </button>
        </header>

        {/* Segmented tabs */}
        <div className="flex gap-1 px-5 pt-4">
          <TabButton active={tab === "audio"} onClick={() => setTab("audio")} Icon={Mic} label={t("audio")} />
          <TabButton active={tab === "video"} onClick={() => setTab("video")} Icon={VideoIcon} label={t("video")} />
          <TabButton active={tab === "background"} onClick={() => setTab("background")} Icon={Wand2} label={t("background")} />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {tab === "audio" ? (
            <AudioSection micTrack={micTrack} />
          ) : tab === "video" ? (
            <VideoSection camTrack={camTrack} />
          ) : (
            <BackgroundSection camTrack={camTrack} />
          )}
        </div>

        <footer className="border-t border-white/10 px-5 py-4">
          <label className="flex cursor-pointer items-center justify-between gap-3">
            <span className="text-sm">
              <span className="font-medium">{t("applyAutomatically")}</span>
              <span className="mt-0.5 block text-xs text-slate-400">{t("applyAutomaticallyHint")}</span>
            </span>
            <Switch on={settings.autoApply} onChange={(v) => update({ autoApply: v })} label={t("applyAutomatically")} />
          </label>
        </footer>
      </div>
    </div>
  );
}

function AudioSection({ micTrack }: { micTrack: LocalAudioTrack | undefined }) {
  const t = useTranslations("videoCall");
  const { settings, update } = useSettings();
  const mic = useMediaDeviceSelect({ kind: "audioinput" });
  const speaker = useMediaDeviceSelect({ kind: "audiooutput" });
  const canSelectOutput = supportsAudioOutputSelection();

  async function restartMic(
    patch: Partial<Pick<typeof settings, "noiseSuppression" | "voiceIsolation" | "echoCancellation">>,
  ) {
    const next = { ...settings, ...patch };
    update(patch);
    await micTrack?.restartTrack(micConstraints(next)).catch(() => {});
  }

  return (
    <div className="space-y-5">
      <Field label={t("microphone")}>
        <DevicePicker
          label={t("microphone")}
          Icon={Mic}
          devices={mic.devices}
          activeId={mic.activeDeviceId}
          onChange={(id) => {
            void mic.setActiveMediaDevice(id);
            update({ audioDeviceId: id });
          }}
        />
        <div className="mt-2 flex items-center gap-2 px-1">
          <MicMeter track={micTrack} />
          <span className="text-xs text-slate-400">{t("micLevel")}</span>
        </div>
      </Field>

      {canSelectOutput && (
        <Field label={t("speaker")}>
          <DevicePicker
            label={t("speaker")}
            Icon={Volume2}
            devices={speaker.devices}
            activeId={speaker.activeDeviceId}
            onChange={(id) => {
              void speaker.setActiveMediaDevice(id);
              update({ audioOutputId: id });
            }}
          />
          <button
            type="button"
            onClick={() => void testSpeaker(speaker.activeDeviceId)}
            className="mt-2 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-white/20"
          >
            {t("testSpeaker")}
          </button>
        </Field>
      )}

      <ToggleRow
        label={t("voiceIsolation")}
        hint={t("voiceIsolationHint")}
        on={settings.voiceIsolation}
        onChange={(v) => void restartMic({ voiceIsolation: v })}
      />
      <ToggleRow
        label={t("noiseSuppression")}
        on={settings.noiseSuppression}
        onChange={(v) => void restartMic({ noiseSuppression: v })}
      />
      <ToggleRow
        label={t("echoCancellation")}
        on={settings.echoCancellation}
        onChange={(v) => void restartMic({ echoCancellation: v })}
      />
    </div>
  );
}

function VideoSection({ camTrack }: { camTrack: LocalVideoTrack | undefined }) {
  const t = useTranslations("videoCall");
  const { settings, update } = useSettings();
  const cam = useMediaDeviceSelect({ kind: "videoinput" });
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !camTrack) return;
    camTrack.attach(el);
    return () => {
      camTrack.detach(el);
    };
  }, [camTrack]);

  const resolutions: { id: VideoResolution; label: string }[] = [
    { id: "auto", label: t("resolutionAuto") },
    { id: "h720", label: "720p" },
    { id: "h360", label: "360p" },
  ];

  async function changeResolution(resolution: VideoResolution) {
    update({ resolution });
    await camTrack
      ?.restartTrack({ deviceId: settings.videoDeviceId || undefined, ...resolutionConstraints(resolution) })
      .catch(() => {});
    // The restart drops any processor — re-apply the active background onto the fresh track.
    await applyBackground(camTrack, settings.background).catch(() => {});
  }

  return (
    <div className="space-y-5">
      <div className="relative aspect-video overflow-hidden rounded-2xl bg-slate-900 ring-1 ring-white/10">
        {camTrack ? (
          <video
            ref={videoRef}
            className={`size-full object-cover ${settings.mirror ? "-scale-x-100" : ""}`}
            muted
            playsInline
          />
        ) : (
          <div className="flex size-full items-center justify-center text-sm text-slate-400">
            {t("cameraDisabled")}
          </div>
        )}
      </div>

      <Field label={t("camera")}>
        <DevicePicker
          label={t("camera")}
          Icon={VideoIcon}
          devices={cam.devices}
          activeId={cam.activeDeviceId}
          onChange={(id) => {
            update({ videoDeviceId: id });
            void (async () => {
              await cam.setActiveMediaDevice(id);
              await applyBackground(camTrack, settings.background).catch(() => {});
            })();
          }}
        />
      </Field>

      <Field label={t("resolution")}>
        <div className="flex gap-2">
          {resolutions.map((r) => (
            <button
              key={r.id}
              type="button"
              aria-pressed={settings.resolution === r.id}
              onClick={() => void changeResolution(r.id)}
              className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium transition ${
                settings.resolution === r.id
                  ? "bg-emerald-500/90 text-white"
                  : "bg-white/5 text-slate-300 hover:bg-white/10"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </Field>

      <ToggleRow label={t("mirrorVideo")} on={settings.mirror} onChange={(v) => update({ mirror: v })} />
    </div>
  );
}

function BackgroundSection({ camTrack }: { camTrack: LocalVideoTrack | undefined }) {
  const t = useTranslations("videoCall");
  const { settings, update } = useSettings();
  const supported = backgroundSupported();
  const [pending, setPending] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !camTrack) return;
    camTrack.attach(el);
    return () => {
      camTrack.detach(el);
    };
  }, [camTrack]);

  // A couple of bundled virtual backgrounds, generated as gradients (no binary assets to ship).
  const presets = useMemo<string[]>(
    () =>
      typeof document === "undefined"
        ? []
        : [
            gradientPreset("#0f766e", "#022c22"),
            gradientPreset("#1e3a8a", "#020617"),
            gradientPreset("#7c2d12", "#1c1917"),
          ],
    [],
  );

  async function choose(bg: CallBackground, key: string) {
    if (pending) return;
    setPending(key);
    update({ background: bg });
    await applyBackground(camTrack, bg).catch(() => {});
    setPending(null);
  }

  function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Downscale + re-encode before storing: a full-res photo's base64 data URL is multiple MB, which
    // silently overflows the ~5MB localStorage quota → the WHOLE settings object fails to persist →
    // "apply automatically" can't restore the background on the next join (looked like it "forgot" the
    // image). A virtual background needs no more than ~1280px, which keeps the data URL well under quota.
    void downscaleToDataUrl(file).then((src) => choose({ type: "image", src }, "upload"));
  }

  if (!supported) {
    return <p className="text-sm text-slate-400">{t("backgroundUnsupported")}</p>;
  }

  const bg = settings.background;
  return (
    <div className="space-y-4">
      <div className="relative aspect-video overflow-hidden rounded-2xl bg-slate-900 ring-1 ring-white/10">
        {camTrack ? (
          <video
            ref={videoRef}
            className={`size-full object-cover ${settings.mirror ? "-scale-x-100" : ""}`}
            muted
            playsInline
          />
        ) : (
          <div className="flex size-full items-center justify-center text-sm text-slate-400">
            {t("cameraDisabled")}
          </div>
        )}
        {pending && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <Loader2 className="size-6 animate-spin text-white" />
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        <BgTile label={t("backgroundNone")} active={bg.type === "none"} onClick={() => void choose({ type: "none" }, "none")}>
          <Ban className="size-5" />
        </BgTile>
        <BgTile
          label={t("backgroundBlur")}
          active={bg.type === "blur" && bg.strength === "light"}
          onClick={() => void choose({ type: "blur", strength: "light" }, "blur-light")}
        >
          <Sparkles className="size-5" />
        </BgTile>
        <BgTile
          label={t("backgroundBlurStrong")}
          active={bg.type === "blur" && bg.strength === "strong"}
          onClick={() => void choose({ type: "blur", strength: "strong" }, "blur-strong")}
        >
          <Sparkles className="size-5 fill-current" />
        </BgTile>
        {presets.map((src, i) => (
          <BgTile
            key={i}
            label={`${t("background")} ${i + 1}`}
            active={bg.type === "image" && bg.src === src}
            onClick={() => void choose({ type: "image", src }, `preset-${i}`)}
            image={src}
          />
        ))}
        <label className="flex aspect-video cursor-pointer flex-col items-center justify-center gap-1 rounded-xl text-xs text-slate-300 ring-1 ring-white/10 transition hover:ring-white/30">
          <input type="file" accept="image/*" className="hidden" onChange={onUpload} />
          <Upload className="size-5" />
          {t("backgroundUpload")}
        </label>
      </div>
    </div>
  );
}

function BgTile({
  label,
  active,
  onClick,
  image,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  image?: string;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={`relative flex aspect-video items-center justify-center overflow-hidden rounded-xl bg-cover bg-center text-xs transition ${
        active ? "ring-2 ring-emerald-400" : "ring-1 ring-white/10 hover:ring-white/30"
      }`}
      style={image ? { backgroundImage: `url(${image})` } : undefined}
    >
      {!image && (
        <span className="flex flex-col items-center gap-1 text-slate-300">
          {children}
          <span>{label}</span>
        </span>
      )}
    </button>
  );
}

const cachedGradients: Record<string, string> = {};
/** A simple 2-stop diagonal gradient as a data-URI image (deterministic, so a saved src still matches). */
function gradientPreset(from: string, to: string): string {
  const key = `${from}|${to}`;
  if (cachedGradients[key]) return cachedGradients[key];
  const c = document.createElement("canvas");
  c.width = 640;
  c.height = 360;
  const ctx = c.getContext("2d");
  if (!ctx) return "";
  const g = ctx.createLinearGradient(0, 0, 640, 360);
  g.addColorStop(0, from);
  g.addColorStop(1, to);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 640, 360);
  cachedGradients[key] = c.toDataURL("image/png");
  return cachedGradients[key];
}

/**
 * Read an image file, scale its longest edge down to `maxDim`, and re-encode as a JPEG data URL — small
 * enough to persist in localStorage so "apply automatically" can restore it on the next join. Falls back
 * to the original data URL only if the canvas is unavailable.
 */
async function downscaleToDataUrl(file: File, maxDim = 1280, quality = 0.82): Promise<string> {
  const original = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("decode failed"));
    i.src = original;
  });
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return original;
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", quality);
}

/** A short tone through the selected output device, to confirm the speaker choice. */
async function testSpeaker(deviceId: string): Promise<void> {
  try {
    const audio = new Audio(beepDataUri());
    const sinkable = audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
    if (deviceId && sinkable.setSinkId) await sinkable.setSinkId(deviceId);
    await audio.play();
  } catch {
    // autoplay/permission — ignore
  }
}

let cachedBeep: string | null = null;
/** A tiny 0.2s 440Hz sine WAV as a data URI (generated once). */
function beepDataUri(): string {
  if (cachedBeep) return cachedBeep;
  const rate = 8000;
  const len = Math.floor(rate * 0.2);
  const bytes = new Uint8Array(44 + len);
  const view = new DataView(bytes.buffer);
  const wr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  wr(0, "RIFF");
  view.setUint32(4, 36 + len, true);
  wr(8, "WAVE");
  wr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  wr(36, "data");
  view.setUint32(40, len, true);
  for (let i = 0; i < len; i++) {
    const env = Math.min(1, i / 200, (len - i) / 200); // fade in/out to avoid clicks
    view.setUint8(44 + i, 128 + Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 90 * env));
  }
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  cachedBeep = `data:audio/wav;base64,${btoa(bin)}`;
  return cachedBeep;
}

function TabButton({
  active,
  onClick,
  Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  Icon: typeof Mic;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition ${
        active ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/5 hover:text-white"
      }`}
    >
      <Icon className="size-4" />
      {label}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      {children}
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  on,
  onChange,
}: {
  label: string;
  hint?: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3">
      <span className="text-sm">
        <span className="font-medium">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-slate-400">{hint}</span>}
      </span>
      <Switch on={on} onChange={onChange} label={label} />
    </label>
  );
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
        on ? "bg-emerald-500" : "bg-white/15"
      }`}
    >
      <span
        className={`inline-block size-5 transform rounded-full bg-white shadow transition ${
          on ? "translate-x-[22px] rtl:-translate-x-[22px]" : "translate-x-0.5 rtl:-translate-x-0.5"
        }`}
      />
    </button>
  );
}
