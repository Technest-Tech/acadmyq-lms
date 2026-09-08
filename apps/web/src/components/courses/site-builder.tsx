"use client";

import {
  Check,
  ChevronRight,
  ExternalLink,
  Eye,
  EyeOff,
  Monitor,
  RotateCw,
  Smartphone,
  Tablet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { lmsColor } from "@/components/courses/lms-ui";
import {
  PREVIEW_CHANNEL,
  type PreviewPush,
  type PreviewReady,
} from "@/components/learn/preview-bridge";
import type { LearnSiteContent } from "@/lib/learn-api";
import { cn } from "@/lib/utils";

/**
 * The chrome of the site builder (`/lms/site`) — the parts that make it a builder rather than a
 * form: the section rail on the left and the live device preview on the right.
 *
 * The editor itself stays in the screen; everything here is about NAVIGATING and SEEING it.
 */

// ── controls ──────────────────────────────────────────────────────────────────

/** A real switch, not a checkbox: this toggles something a visitor either sees or doesn't. */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
  size = "md",
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  /** Accessible name — the rail rows are icon-only, so the switch has to carry it. */
  label: string;
  disabled?: boolean;
  size?: "sm" | "md";
}) {
  const small = size === "sm";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={cn(
        "focus-visible:ring-ring/50 relative shrink-0 rounded-full transition-colors outline-none focus-visible:ring-2",
        small ? "h-5 w-9" : "h-6 w-11",
        checked ? "bg-primary" : "bg-muted-foreground/30",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
      )}
    >
      <span
        className={cn(
          "absolute top-1/2 -translate-y-1/2 rounded-full bg-white shadow-sm transition-[inset-inline-start]",
          small ? "size-3.5" : "size-4.5",
          checked
            ? small
              ? "start-[1.125rem]"
              : "start-[1.625rem]"
            : "start-[0.1875rem]",
        )}
      />
    </button>
  );
}

export interface SegmentItem<T extends string> {
  value: T;
  label: string;
  Icon?: LucideIcon;
}

/** A compact icon/label pill group — the device switch and the preview's page picker. */
export function Segmented<T extends string>({
  items,
  value,
  onChange,
  iconOnly = false,
  className,
}: {
  items: SegmentItem<T>[];
  value: T;
  onChange: (value: T) => void;
  iconOnly?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("bg-muted/70 flex items-center gap-0.5 rounded-lg p-0.5", className)}>
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange(item.value)}
            aria-pressed={active}
            title={iconOnly ? item.label : undefined}
            aria-label={iconOnly ? item.label : undefined}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all",
              active
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.Icon && <item.Icon className="size-3.5" aria-hidden />}
            {!iconOnly && item.label}
          </button>
        );
      })}
    </div>
  );
}

// ── the section rail ──────────────────────────────────────────────────────────

/**
 * One row of the section index. The whole row opens the section; the switch on the end turns it off
 * without opening anything, which is the single most common thing a client does here.
 */
export function SectionRow({
  Icon,
  color,
  title,
  description,
  count,
  done,
  show,
  onShowChange,
  showLabel,
  onOpen,
  disabled,
}: {
  Icon: LucideIcon;
  color: string;
  title: string;
  description: string;
  /** Items in a repeatable section, shown as a chip. */
  count?: number;
  /** The client has put something of their own in here. */
  done: boolean;
  /** Undefined for a section that is always part of the site (brand, SEO, legal). */
  show?: boolean;
  onShowChange?: (value: boolean) => void;
  showLabel: string;
  onOpen: () => void;
  disabled?: boolean;
}) {
  const c = lmsColor(color);
  const hidden = show === false;

  return (
    <div
      className={cn(
        "group hover:bg-muted/50 flex items-center gap-3 rounded-xl px-2.5 py-2 transition-colors",
        hidden && "opacity-55",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 text-start outline-none"
      >
        <span
          className={cn(
            "relative flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm",
            c.chip,
          )}
        >
          <Icon className="size-4" aria-hidden />
          {done && (
            <span className="bg-emerald-500 absolute -end-1 -bottom-1 flex size-4 items-center justify-center rounded-full text-white ring-2 ring-card">
              <Check className="size-2.5" strokeWidth={3} aria-hidden />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold tracking-tight">{title}</span>
            {typeof count === "number" && count > 0 && (
              <span
                className={cn("rounded-full px-1.5 py-px text-[10px] font-bold", c.soft)}
              >
                {count}
              </span>
            )}
          </span>
          <span className="text-muted-foreground mt-0.5 block truncate text-xs">
            {description}
          </span>
        </span>
      </button>

      {show !== undefined && onShowChange && (
        <Switch
          size="sm"
          checked={show}
          onChange={onShowChange}
          label={showLabel}
          disabled={disabled}
        />
      )}

      <button
        type="button"
        onClick={onOpen}
        aria-label={title}
        className="text-muted-foreground/50 group-hover:text-foreground shrink-0 transition-colors"
      >
        <ChevronRight className="size-4 rtl:rotate-180" aria-hidden />
      </button>
    </div>
  );
}

/** How much of the site the client has made their own — the first thing the rail shows. */
export function CompletionBar({
  done,
  total,
  label,
  hint,
}: {
  done: number;
  total: number;
  label: string;
  hint: string;
}) {
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div className="border-b px-5 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold tracking-tight">{label}</span>
        <span className="text-muted-foreground text-xs font-bold tabular-nums">{percent}%</span>
      </div>
      <div className="bg-muted mt-2 h-1.5 overflow-hidden rounded-full">
        <div
          className="from-primary h-full rounded-full bg-gradient-to-r to-emerald-400 transition-[width] duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-muted-foreground mt-2 text-xs leading-relaxed">{hint}</p>
    </div>
  );
}

// ── the live preview ──────────────────────────────────────────────────────────

export type PreviewDevice = "desktop" | "tablet" | "mobile";

/** Widths the site is actually designed against — the same breakpoints its layout switches on. */
const DEVICE_WIDTH: Record<PreviewDevice, number> = {
  desktop: 1280,
  tablet: 834,
  mobile: 390,
};

export const DEVICE_ICON: Record<PreviewDevice, LucideIcon> = {
  desktop: Monitor,
  tablet: Tablet,
  mobile: Smartphone,
};

export interface PreviewFocus {
  /** The element id in the site (`site-hero`, …). */
  anchor: string;
  /** Bumped every time the client opens a section, so the same anchor can be re-focused. */
  token: number;
}

/**
 * The client's real site, live, at a real device width.
 *
 * The iframe is laid out at the device's own width and scaled to fit the pane, rather than squeezed
 * — a 1280px layout squeezed into a 600px pane is a picture of a site nobody will ever see. The
 * draft is pushed in over postMessage (components/learn/preview-bridge.tsx); the frame is loaded
 * exactly once per page, so typing never reloads it and never loses scroll position.
 */
export function PreviewPane({
  src,
  content,
  device,
  focus,
  label,
  loadingLabel,
  reloadLabel,
}: {
  /** `null` while the client has no site address yet — the caller shows a placeholder instead. */
  src: string | null;
  content: LearnSiteContent;
  device: PreviewDevice;
  focus: PreviewFocus | null;
  label: string;
  loadingLabel: string;
  reloadLabel: string;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ width: 0, height: 0 });
  const [ready, setReady] = useState(0);
  const [nonce, setNonce] = useState(0);
  const [loading, setLoading] = useState(true);

  // A page switch or a manual reload starts a fresh document; the old page must stop looking live.
  useEffect(() => setLoading(true), [src, nonce]);

  // Track the pane so the scale follows a collapsing sidebar or a resized window.
  useEffect(() => {
    const node = stageRef.current;
    if (node === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setStage({ width: rect.width, height: rect.height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // The frame announces itself once it is listening; anything posted before that is lost.
  useEffect(() => {
    function receive(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      const message = event.data as PreviewReady | undefined;
      if (message?.channel !== PREVIEW_CHANNEL || message.kind !== "ready") return;
      if (event.source !== frameRef.current?.contentWindow) return;
      setLoading(false);
      setReady((n) => n + 1);
    }
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);

  const push = useCallback(
    (anchor?: string) => {
      const frame = frameRef.current?.contentWindow;
      if (frame === null || frame === undefined) return;
      const message: PreviewPush = {
        channel: PREVIEW_CHANNEL,
        kind: "content",
        content,
        focus: anchor ?? null,
      };
      frame.postMessage(message, window.location.origin);
    },
    [content],
  );

  // Every edit, coalesced — one message per animation-frame-ish window rather than per keystroke.
  useEffect(() => {
    if (ready === 0) return;
    const timer = window.setTimeout(() => push(), 120);
    return () => window.clearTimeout(timer);
  }, [push, ready]);

  // Opening a section scrolls the preview to it. Separate from the content push so a keystroke
  // never yanks the page around while the client is typing.
  useEffect(() => {
    if (ready === 0 || focus === null) return;
    push(focus.anchor);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the token IS the trigger
  }, [focus?.token, ready]);

  // Until the pane has been measured — and in any environment without a ResizeObserver — the frame
  // simply fills the pane. Losing the device widths is a far better failure than losing the preview.
  const measured = stage.width > 0;
  const width = DEVICE_WIDTH[device];
  const scale = measured ? Math.min(1, stage.width / width) : 1;
  const height = measured ? stage.height / scale : 0;

  return (
    <div ref={stageRef} className="bg-muted/40 relative flex-1 overflow-hidden">
      {loading && (
        <div className="text-muted-foreground absolute inset-0 z-10 flex items-center justify-center gap-2 text-xs">
          <RotateCw className="size-3.5 animate-spin" aria-hidden />
          {loadingLabel}
        </div>
      )}
      {src !== null && (
        <div className="absolute inset-0 flex justify-center">
          <iframe
            key={`${src}#${nonce}`}
            ref={frameRef}
            src={src}
            title={label}
            onLoad={() => setLoading(false)}
            style={{
              width: measured ? width : "100%",
              height: measured && height > 0 ? height : "100%",
              transform: measured ? `scale(${scale})` : undefined,
              transformOrigin: "top center",
            }}
            className={cn(
              "bg-white shrink-0 border-0",
              device !== "desktop" && "rounded-[1.75rem] shadow-2xl ring-1 ring-black/10",
            )}
          />
        </div>
      )}

      {/* A reload for the half of the site the draft can't change: the course catalogue, the
          learner's own state, anything the API renders on the server. */}
      {src !== null && (
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            setNonce((n) => n + 1);
          }}
          aria-label={reloadLabel}
          title={reloadLabel}
          className="bg-card/90 text-muted-foreground hover:text-foreground absolute end-3 bottom-3 z-10 rounded-full p-2 shadow-md ring-1 ring-black/5 backdrop-blur transition-colors"
        >
          <RotateCw className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}

/** The preview's toolbar: which page, which device, and a way out to the real thing. */
export function PreviewToolbar({
  pages,
  page,
  onPageChange,
  device,
  onDeviceChange,
  deviceLabels,
  url,
  openLabel,
  liveLabel,
}: {
  pages: SegmentItem<string>[];
  page: string;
  onPageChange: (value: string) => void;
  device: PreviewDevice;
  onDeviceChange: (value: PreviewDevice) => void;
  deviceLabels: Record<PreviewDevice, string>;
  url: string | null;
  openLabel: string;
  liveLabel: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
      <span className="text-muted-foreground me-1 hidden items-center gap-1.5 text-[11px] font-bold tracking-wide uppercase xl:flex">
        <span className="relative flex size-1.5">
          <span className="bg-emerald-500 absolute inline-flex size-full animate-ping rounded-full opacity-70" />
          <span className="bg-emerald-500 relative inline-flex size-1.5 rounded-full" />
        </span>
        {liveLabel}
      </span>

      <Segmented items={pages} value={page} onChange={onPageChange} className="min-w-0" />

      <div className="ms-auto flex items-center gap-2">
        <Segmented
          iconOnly
          items={(["desktop", "tablet", "mobile"] as const).map((value) => ({
            value,
            label: deviceLabels[value],
            Icon: DEVICE_ICON[value],
          }))}
          value={device}
          onChange={onDeviceChange}
        />
        {url !== null && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            title={openLabel}
            aria-label={openLabel}
            className="text-muted-foreground hover:bg-muted hover:text-foreground rounded-lg p-1.5 transition-colors"
          >
            <ExternalLink className="size-4" aria-hidden />
          </a>
        )}
      </div>
    </div>
  );
}

/** The "shown / hidden" state of the section being edited, as a banner above its fields. */
export function VisibilityBanner({
  show,
  onChange,
  shownLabel,
  hiddenLabel,
  switchLabel,
}: {
  show: boolean;
  onChange: (value: boolean) => void;
  shownLabel: string;
  hiddenLabel: string;
  switchLabel: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-xs font-medium transition-colors",
        show
          ? "border-emerald-500/25 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"
          : "border-input bg-muted/40 text-muted-foreground",
      )}
    >
      {show ? <Eye className="size-4" aria-hidden /> : <EyeOff className="size-4" aria-hidden />}
      <span className="flex-1">{show ? shownLabel : hiddenLabel}</span>
      <Switch size="sm" checked={show} onChange={onChange} label={switchLabel} />
    </div>
  );
}
