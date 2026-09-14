import { useId, type CSSProperties } from "react";
import type { CertificateContent } from "@/lib/api";

/**
 * The shared toolkit every certificate design is drawn with.
 *
 * A design is a self-contained DOM tree at a FIXED A4-landscape pixel box (1123×794 @ 96dpi) so
 * html2canvas-pro can capture a clean, full-page image. All colours are inline hex/rgb (never the
 * app's oklch CSS vars) so a capture outside the live theme renders identically. Fonts are the one
 * exception: they are named through the root layout's next/font variables, which html2canvas-pro
 * resolves from computed style.
 *
 * SVG ornaments never use <text>: the capture rasterises an <svg> as an isolated image, where web
 * fonts are not available. Every word on a certificate is HTML.
 */

export const CERT_WIDTH = 1123;
export const CERT_HEIGHT = 794;

export type CertLang = "en" | "ar";

export interface CertificateRenderProps {
  content: CertificateContent;
  recipientName: string;
  dateLabel: string;
  lang: CertLang;
  /** The programme / course / portion the certificate is for (e.g. "Juz' Amma"). */
  courseTitle?: string;
  /** Printed verbatim, e.g. "No. 2026-014" or the LMS "Serial: C-7KLM-…". */
  serialLabel?: string;
  /** The academy logo as a data URI — a remote URL would taint the capture canvas. */
  logoDataUrl?: string | null;
}

/* ── Type ─────────────────────────────────────────────────────────────────── */

export const SERIF =
  "var(--font-cert-serif, 'Playfair Display'), 'Playfair Display', Georgia, 'Times New Roman', serif";
export const SCRIPT =
  "var(--font-cert-script, 'Great Vibes'), 'Great Vibes', 'Snell Roundhand', 'Brush Script MT', cursive";
export const NASKH =
  "var(--font-display, 'Amiri'), 'Amiri', 'Traditional Arabic', Georgia, serif";
export const SANS =
  "var(--font-sans, 'Tajawal'), 'Tajawal', 'Segoe UI', system-ui, sans-serif";

/** The only words a design owns — everything else is the academy's wording. */
export const CERT_COPY = {
  en: { date: "Date", recipient: "Recipient Name", issued: "Issued", number: "No." },
  ar: { date: "التاريخ", recipient: "اسم الطالب", issued: "صدرت في", number: "رقم" },
} as const;

type TextBase =
  | "academyName"
  | "title"
  | "presentation"
  | "body"
  | "signatoryName"
  | "signatoryTitle"
  | "signatory2Name"
  | "signatory2Title";

/** Field value for the active language (e.g. base "title" → titleEn / titleAr). */
export function pick(content: CertificateContent, base: TextBase, lang: CertLang): string {
  const key = `${base}${lang === "ar" ? "Ar" : "En"}` as keyof CertificateContent;
  const value = content[key];
  return typeof value === "string" ? value : "";
}

export interface Signature {
  name: string;
  title: string;
}

/** The first signature always prints (a blank line to sign on); the second only when filled. */
export function signatures(content: CertificateContent, lang: CertLang): [Signature, Signature?] {
  const first = { name: pick(content, "signatoryName", lang), title: pick(content, "signatoryTitle", lang) };
  const second = { name: pick(content, "signatory2Name", lang), title: pick(content, "signatory2Title", lang) };
  return second.name.trim() || second.title.trim() ? [first, second] : [first];
}

/**
 * The small print line. With two signatures the footer has no room left for a date column, so the
 * date joins the serial here instead.
 */
export function metaLine(props: CertificateRenderProps, dateInFooter: boolean): string {
  const copy = CERT_COPY[props.lang];
  return [dateInFooter ? null : `${copy.issued} ${props.dateLabel}`, props.serialLabel?.trim() || null]
    .filter(Boolean)
    .join("   ·   ");
}

export function logoOf(props: CertificateRenderProps): string | null {
  return props.content.showLogo === false ? null : (props.logoDataUrl ?? null);
}

/**
 * Shrink a one-line display string that would otherwise wrap. Deterministic on purpose: the preview
 * and the downloaded file must be the same picture, so this never measures the DOM.
 */
export function fitText(text: string, base: number, comfortable: number, floor = 0.52): number {
  const len = [...text].length;
  if (len <= comfortable) return base;
  return Math.max(Math.round(base * floor), Math.round((base * comfortable) / len));
}

/** Clamp a paragraph to `lines` without relying on -webkit-line-clamp (not captured reliably). */
export function clampLines(fontSize: number, lineHeight: number, lines: number): CSSProperties {
  return { lineHeight, maxHeight: Math.ceil(fontSize * lineHeight * lines), overflow: "hidden" };
}

/** Mix a #rrggbb colour toward white (amount > 0) or black (amount < 0). */
export function shade(hex: string, amount: number): string {
  const digits = /^#?([0-9a-f]{6})$/i.exec(hex.trim())?.[1];
  if (!digits) return hex;
  const n = parseInt(digits, 16);
  const target = amount >= 0 ? 255 : 0;
  const t = Math.min(1, Math.abs(amount));
  const channel = (shift: number) => {
    const c = (n >> shift) & 255;
    return Math.round(c + (target - c) * t)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

/** `#rrggbb` + alpha → `rgba()`; html2canvas does not read 8-digit hex everywhere. */
export function alpha(hex: string, a: number): string {
  const digits = /^#?([0-9a-f]{6})$/i.exec(hex.trim())?.[1];
  if (!digits) return hex;
  const n = parseInt(digits, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** A unique, url()-safe id for an SVG <pattern>/<linearGradient> — several copies of one design
 *  render on the page at once (gallery thumbnail, preview, capture node), and ids must not collide. */
export function useSvgId(prefix: string): string {
  return `${prefix}-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

export function frameBox(lang: CertLang, fontFamily: string): CSSProperties {
  return {
    position: "relative",
    width: CERT_WIDTH,
    height: CERT_HEIGHT,
    overflow: "hidden",
    boxSizing: "border-box",
    direction: lang === "ar" ? "rtl" : "ltr",
    fontFamily,
  };
}

/** A centred column occupying a fixed band of the page — content never slides under the footer. */
export function contentBand(top: number, bottom: number, side: number): CSSProperties {
  return {
    position: "absolute",
    top,
    bottom,
    left: side,
    right: side,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
  };
}

/* ── Geometry ─────────────────────────────────────────────────────────────── */

/** Points of an n-pointed star centred at (cx,cy). n=8 is the octagram / Rub el Hizb. */
export function starPoints(cx: number, cy: number, outer: number, inner: number, n = 8): string {
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI / n) * i - Math.PI / 2;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(" ");
}

/** A standalone octagram star (corners, seals, watermarks). */
export function StarOctagram({
  size,
  stroke,
  fill = "none",
  strokeWidth = 2,
  opacity = 1,
}: {
  size: number;
  stroke: string;
  fill?: string;
  strokeWidth?: number;
  opacity?: number;
}) {
  const c = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ opacity, display: "block" }} aria-hidden>
      <polygon
        points={starPoints(c, c, c - strokeWidth, (c - strokeWidth) * 0.42)}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
      <polygon
        points={starPoints(c, c, (c - strokeWidth) * 0.62, (c - strokeWidth) * 0.26)}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth * 0.7}
        strokeLinejoin="round"
        opacity={0.7}
      />
    </svg>
  );
}

/** A short arabesque divider: a centred star flanked by tapered rules. */
export function Divider({ color, width = 150 }: { color: string; width?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, width: "100%" }}>
      <div style={{ height: 2, width, background: `linear-gradient(90deg, transparent, ${color})` }} />
      <StarOctagram size={26} stroke={color} fill={color} strokeWidth={1} />
      <div style={{ height: 2, width, background: `linear-gradient(270deg, transparent, ${color})` }} />
    </div>
  );
}

/** A hairline with a small diamond at its centre — the classic diploma rule. */
export function DiamondRule({ color, width = 110, thickness = 1 }: { color: string; width?: number; thickness?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
      <div style={{ height: thickness, width, background: color }} />
      <div style={{ width: 8, height: 8, background: color, transform: "rotate(45deg)" }} />
      <div style={{ height: thickness, width, background: color }} />
    </div>
  );
}

/** The academy logo, or nothing. `frame` styles the plate it sits on. */
export function LogoMark({ src, size, frame }: { src: string | null; size: number; frame?: CSSProperties }) {
  if (!src) return null;
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        flexShrink: 0,
        ...frame,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- a data URI inside a capture tree */}
      <img src={src} alt="" style={{ width: "82%", height: "82%", objectFit: "contain" }} />
    </div>
  );
}

/** One signature (or date) column: the value on a rule, its caption beneath. A long name shrinks
 *  to fit its column before it is ever cut short. */
export function SignatureBlock({
  value,
  caption,
  width = 210,
  rule,
  valueStyle,
  captionStyle,
}: {
  value: string;
  caption: string;
  width?: number;
  rule: string;
  valueStyle: CSSProperties;
  captionStyle: CSSProperties;
}) {
  const base = typeof valueStyle.fontSize === "number" ? valueStyle.fontSize : 18;
  const fontSize = fitText(value, base, Math.floor(width / (base * 0.5)), 0.62);
  return (
    <div style={{ width, textAlign: "center" }}>
      <div
        style={{
          minHeight: 30,
          paddingBottom: 6,
          borderBottom: rule,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          ...valueStyle,
          fontSize,
        }}
      >
        {value || " "}
      </div>
      <div style={{ marginTop: 7, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", ...captionStyle }}>
        {caption || " "}
      </div>
    </div>
  );
}
