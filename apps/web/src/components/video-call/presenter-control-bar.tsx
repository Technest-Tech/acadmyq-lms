"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

// useLayoutEffect avoids a first-paint flash while measuring, but warns during SSR; the call UI is
// client-only, yet fall back to useEffect on the server to stay quiet.
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;
import { useRoomContext, useTrackToggle } from "@livekit/components-react";
import { Track } from "livekit-client";
import {
  Loader2,
  MessageSquare,
  Mic,
  MicOff,
  MonitorUp,
  MoreHorizontal,
  Pencil,
  PhoneOff,
  Presentation,
  Square,
  Users,
  Video,
  VideoOff,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useChatPanel } from "./chat-context";
import { useRecording } from "./recording-context";
import { useWhiteboard } from "./whiteboard-context";
import { useIsDesktop } from "./use-is-desktop";

/** Fixed geometry the overflow math relies on (matches the Tailwind classes below). */
const BTN = 40; // size-10
const GAP = 6; // gap-1.5
const PAD = 12; // px-1.5 both sides
const STEP = BTN + GAP;

type Variant = "neutral" | "on" | "off" | "leave";

interface Control {
  key: string;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  variant: Variant;
  badge?: number;
  badgeTone?: "count" | "unread";
  pending?: boolean;
  /** Custom glyph (record uses a red dot / filled square instead of a plain icon). */
  glyph?: React.ReactNode;
}

function variantClass(v: Variant): string {
  switch (v) {
    case "on":
      return "bg-emerald-500/90 text-white hover:bg-emerald-500";
    case "off":
      return "bg-red-500/90 text-white hover:bg-red-500";
    case "leave":
      return "bg-red-600 text-white hover:bg-red-700";
    default:
      return "bg-white/10 text-white hover:bg-white/20";
  }
}

/**
 * The floating presenter dock — a modern, Zoom-style control bar for the desktop teacher while screen
 * sharing. It's a single non-wrapping pill: core controls stay pinned (mic · camera · share … leave)
 * and any that don't fit the current window width collapse into a clean "More (⋯)" popover, measured
 * live via a ResizeObserver. So the bar never wraps or overlaps itself as the floating window shrinks
 * from the wide board size down to the compact panel — it just adapts. Desktop presenter mode only.
 */
export function PresenterControlBar({
  onToggleParticipants,
  participantCount,
}: {
  onToggleParticipants: () => void;
  participantCount: number;
}) {
  const t = useTranslations("videoCall");
  const room = useRoomContext();
  const isDesktop = useIsDesktop();
  const mic = useTrackToggle({ source: Track.Source.Microphone });
  const cam = useTrackToggle({ source: Track.Source.Camera });
  const screen = useTrackToggle({
    source: Track.Source.ScreenShare,
    captureOptions: { audio: true },
  });
  const { open: boardOpen, toggleBoard, canManage, setAllowDraw, setScreenBaking, clearScreenAnnotations } =
    useWhiteboard();
  const { unread, isOpen: chatOpen, toggle: toggleChat } = useChatPanel();
  const rec = useRecording();

  // Annotate lives here (not a child button) so its desktop-toolbar control listener stays mounted for
  // the whole share — the floating toolbar's Clear/Close reach us even while annotate sits in "More".
  const [annotateOn, setAnnotateOn] = useState(false);
  const annotateRef = useRef(annotateOn);
  annotateRef.current = annotateOn;
  useEffect(() => {
    const desktop = typeof window !== "undefined" ? window.academiqDesktop : undefined;
    if (!desktop?.onAnnotateControl) return;
    return desktop.onAnnotateControl((command) => {
      if (command === "clear") {
        clearScreenAnnotations();
      } else if (command === "off" && annotateRef.current) {
        setAnnotateOn(false);
        setAllowDraw(false);
        setScreenBaking(false);
      }
    });
  }, [clearScreenAnnotations, setAllowDraw, setScreenBaking]);

  const toggleAnnotate = useCallback(() => {
    setAnnotateOn((prev) => {
      const next = !prev;
      setAllowDraw(next);
      setScreenBaking(next);
      window.academiqDesktop?.setAnnotateMode?.(next);
      return next;
    });
  }, [setAllowDraw, setScreenBaking]);

  const recActive = rec.isRecording || rec.phase === "stopping";
  const recLabel =
    rec.phase === "starting"
      ? t("recordingStarting")
      : rec.phase === "stopping"
        ? t("recordingStopping")
        : recActive
          ? t("stopRecording")
          : t("startRecording");

  // Pinned-left (always visible), overflow-able middle (drops from the end when tight), pinned-right.
  const front: Control[] = [
    {
      key: "mic",
      icon: mic.enabled ? Mic : MicOff,
      label: mic.enabled ? t("muteMic") : t("unmuteMic"),
      onClick: () => void mic.toggle(),
      variant: mic.enabled ? "neutral" : "off",
      pending: mic.pending,
    },
    {
      key: "cam",
      icon: cam.enabled ? Video : VideoOff,
      label: cam.enabled ? t("turnCameraOff") : t("turnCameraOn"),
      onClick: () => void cam.toggle(),
      variant: cam.enabled ? "neutral" : "off",
      pending: cam.pending,
    },
    {
      key: "share",
      icon: MonitorUp,
      label: screen.enabled ? t("stopShareScreen") : t("shareScreen"),
      onClick: () => void screen.toggle(),
      variant: screen.enabled ? "on" : "neutral",
      pending: screen.pending,
    },
  ];

  const middle: Control[] = [
    ...(isDesktop && canManage
      ? [
          {
            key: "annotate",
            icon: Pencil,
            label: t("annotate"),
            onClick: toggleAnnotate,
            variant: (annotateOn ? "on" : "neutral") as Variant,
          },
        ]
      : []),
    ...(canManage
      ? [
          {
            key: "whiteboard",
            icon: Presentation,
            label: t("whiteboard"),
            onClick: toggleBoard,
            variant: (boardOpen ? "on" : "neutral") as Variant,
          },
        ]
      : []),
    {
      key: "chat",
      icon: MessageSquare,
      label: t("chatTitle"),
      onClick: toggleChat,
      variant: chatOpen ? "on" : "neutral",
      badge: unread || undefined,
      badgeTone: "unread",
    },
    {
      key: "participants",
      icon: Users,
      label: t("participants"),
      onClick: onToggleParticipants,
      variant: "neutral",
      badge: participantCount,
      badgeTone: "count",
    },
    ...(canManage
      ? [
          {
            key: "record",
            icon: Square,
            label: recLabel,
            onClick: () => void rec.toggle(),
            variant: (recActive ? "off" : "neutral") as Variant,
            pending: rec.busy,
            glyph: rec.busy ? (
              <Loader2 className="size-[18px] animate-spin" />
            ) : recActive ? (
              <Square className="size-3.5 fill-current" />
            ) : (
              <span className="size-3.5 rounded-full bg-red-500" />
            ),
          },
        ]
      : []),
  ];

  const back: Control[] = [
    {
      key: "leave",
      icon: PhoneOff,
      label: t("leave"),
      onClick: () => void room.disconnect(),
      variant: "leave",
    },
  ];

  // ── Responsive overflow: how many middle controls fit at the current width. ────────────────────
  const barRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(Number.POSITIVE_INFINITY);
  useIsoLayoutEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      // 0 in jsdom/unlaid-out — treat as "everything fits" so nothing is hidden by a bad measurement.
      setFit(w ? Math.floor((w - PAD + GAP) / STEP) : Number.POSITIVE_INFINITY);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const total = front.length + middle.length + back.length;
  let shownMiddle = middle;
  let overflow: Control[] = [];
  if (fit < total) {
    // Reserve one slot for the More button; never drop the pinned front/back controls.
    const slots = Math.max(0, fit - front.length - back.length - 1);
    shownMiddle = middle.slice(0, slots);
    overflow = middle.slice(slots);
  }

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: Event) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);
  // Nothing to overflow → make sure a stale-open menu can't linger.
  useEffect(() => {
    if (!overflow.length && menuOpen) setMenuOpen(false);
  }, [overflow.length, menuOpen]);

  return (
    <div
      ref={barRef}
      className="mx-auto flex w-full max-w-full flex-nowrap items-center justify-center gap-1.5 overflow-visible rounded-full bg-slate-900/80 px-1.5 py-1.5 shadow-lg shadow-black/30 ring-1 ring-white/10 backdrop-blur-md"
    >
      {front.map((c) => (
        <DockButton key={c.key} control={c} />
      ))}
      {shownMiddle.map((c) => (
        <DockButton key={c.key} control={c} />
      ))}

      {overflow.length > 0 && (
        <div ref={menuRef} className="relative shrink-0">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={t("moreControls")}
            title={t("moreControls")}
            className={cn(
              "relative flex size-10 items-center justify-center rounded-full transition",
              menuOpen ? "bg-white/25 text-white" : "bg-white/10 text-white hover:bg-white/20",
            )}
          >
            <MoreHorizontal className="size-[18px]" />
            {/* Surface a hidden unread badge on the ⋯ so the teacher still notices new chat. */}
            {overflow.some((c) => c.badgeTone === "unread" && c.badge) && (
              <span className="absolute -end-0.5 -top-0.5 size-2.5 rounded-full bg-red-500 ring-2 ring-slate-900" />
            )}
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="absolute bottom-full end-0 mb-2 w-52 overflow-hidden rounded-2xl bg-slate-800/95 p-1.5 shadow-xl ring-1 ring-white/10 backdrop-blur-md"
            >
              {overflow.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  role="menuitem"
                  disabled={c.pending}
                  onClick={() => {
                    c.onClick();
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-start text-sm text-white transition hover:bg-white/10 disabled:opacity-50"
                >
                  <span
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-full",
                      c.variant === "on" ? "bg-emerald-500/90" : "bg-white/10",
                    )}
                  >
                    {c.glyph ?? <c.icon className="size-[18px]" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{c.label}</span>
                  {c.badge ? (
                    <span
                      className={cn(
                        "flex min-w-5 items-center justify-center rounded-full px-1.5 text-[0.65rem] font-bold",
                        c.badgeTone === "unread" ? "bg-red-500 text-white" : "bg-white/15 text-white",
                      )}
                    >
                      {c.badge > 99 ? "99+" : c.badge}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Leave is rendered last so it always pins to the trailing edge. */}
      {back.map((c) => (
        <DockButton key={c.key} control={c} />
      ))}
    </div>
  );
}

/** A single round dock button, with an optional corner badge and a custom glyph (record). */
function DockButton({ control: c }: { control: Control }) {
  return (
    <button
      type="button"
      onClick={c.onClick}
      disabled={c.pending}
      aria-label={c.label}
      title={c.label}
      className={cn(
        "relative flex size-10 shrink-0 items-center justify-center rounded-full transition disabled:opacity-50",
        variantClass(c.variant),
      )}
    >
      {c.glyph ?? <c.icon className="size-[18px]" />}
      {c.badge ? (
        <span
          className={cn(
            "absolute -end-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full px-1 text-[0.6rem] font-bold text-white",
            c.badgeTone === "unread" ? "bg-red-500" : "bg-emerald-500",
          )}
        >
          {c.badge > 9 ? "9+" : c.badge}
        </span>
      ) : null}
    </button>
  );
}
