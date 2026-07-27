import type { CSSProperties } from "react";
import type { CertificateContent } from "@/lib/api";

/**
 * The two premium certificate designs, rendered as self-contained DOM at a fixed A4-landscape
 * pixel box (1123×794 @ 96dpi) so html2canvas-pro can capture a clean, full-page image. All
 * colours are inline hex/rgb (never the app's oklch CSS vars) and fonts fall back to system
 * stacks, so a capture outside the live theme still renders identically.
 *
 *  • Template 1 — "Al-Noor": a deep emerald field framed in gold foil with Rub-el-Hizb
 *    star ornaments and a wax-seal medallion. Opulent, formal.
 *  • Template 2 — "Al-Andalus": an ivory field bordered by an interlaced Islamic
 *    geometric band, with a faint octagram watermark. Modern, airy, minimal.
 */

export const CERT_WIDTH = 1123;
export const CERT_HEIGHT = 794;

export type CertLang = "en" | "ar";

export interface CertificateRenderProps {
  content: CertificateContent;
  recipientName: string;
  dateLabel: string;
  lang: CertLang;
  courseTitle?: string;
  serialLabel?: string;
}

const SERIF = "'Georgia', 'Times New Roman', serif";
const ARABIC = "'Tajawal', 'Segoe UI', sans-serif";

/** Field value for the active language (e.g. base "title" → titleEn / titleAr). */
function pick(
  content: CertificateContent,
  base: "academyName" | "title" | "presentation" | "body" | "signatoryName" | "signatoryTitle",
  lang: CertLang,
): string {
  const key = `${base}${lang === "ar" ? "Ar" : "En"}` as keyof CertificateContent;
  return (content[key] as string) ?? "";
}

/** Points of an 8-pointed star (octagram / Rub el Hizb), centred at (cx,cy). */
function starPoints(cx: number, cy: number, outer: number, inner: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 16; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI / 8) * i - Math.PI / 2;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(" ");
}

/** A standalone octagram star (used for corners, seals and watermarks). */
function StarOctagram({
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
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ opacity }} aria-hidden>
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

/** A short arabesque divider: a centred star flanked by tapered gold rules. */
function Divider({ color }: { color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, width: "100%" }}>
      <div style={{ height: 2, width: 150, background: `linear-gradient(90deg, transparent, ${color})` }} />
      <StarOctagram size={26} stroke={color} fill={color} strokeWidth={1} />
      <div style={{ height: 2, width: 150, background: `linear-gradient(270deg, transparent, ${color})` }} />
    </div>
  );
}

function frameBox(lang: CertLang): CSSProperties {
  return {
    position: "relative",
    width: CERT_WIDTH,
    height: CERT_HEIGHT,
    overflow: "hidden",
    boxSizing: "border-box",
    direction: lang === "ar" ? "rtl" : "ltr",
    fontFamily: lang === "ar" ? ARABIC : SERIF,
  };
}

/* ─────────────────────────── Template 1 — Al-Noor ─────────────────────────── */

export function RoyalCertificate({ content, recipientName, dateLabel, lang }: CertificateRenderProps) {
  const gold = content.accentColor || "#C9A227";
  const goldSoft = "#E7D08A";
  const ink = "#F4EFE2";
  const display = lang === "ar" ? ARABIC : SERIF;

  return (
    <div style={{ ...frameBox(lang), background: "radial-gradient(120% 140% at 50% 0%, #0d4636 0%, #08301f 55%, #05221604 100%), #062417", color: ink }}>
      {/* Outer + inner gold frame */}
      <div style={{ position: "absolute", inset: 26, border: `3px solid ${gold}`, borderRadius: 6 }} />
      <div style={{ position: "absolute", inset: 38, border: `1px solid ${goldSoft}`, opacity: 0.65, borderRadius: 4 }} />

      {/* Corner star ornaments */}
      <div style={{ position: "absolute", top: 18, left: 18 }}><StarOctagram size={64} stroke={gold} strokeWidth={2} /></div>
      <div style={{ position: "absolute", top: 18, right: 18 }}><StarOctagram size={64} stroke={gold} strokeWidth={2} /></div>
      <div style={{ position: "absolute", bottom: 18, left: 18 }}><StarOctagram size={64} stroke={gold} strokeWidth={2} /></div>
      <div style={{ position: "absolute", bottom: 18, right: 18 }}><StarOctagram size={64} stroke={gold} strokeWidth={2} /></div>

      {/* Faint central watermark */}
      <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)" }}>
        <StarOctagram size={420} stroke={goldSoft} strokeWidth={1} opacity={0.06} />
      </div>

      {/* Content */}
      <div style={{ position: "relative", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "70px 110px", textAlign: "center" }}>
        <div style={{ letterSpacing: lang === "ar" ? 0 : 4, fontSize: 18, color: goldSoft, fontFamily: display, textTransform: lang === "ar" ? "none" : "uppercase" }}>
          {pick(content, "academyName", lang)}
        </div>

        <div style={{ marginTop: 14, marginBottom: 10 }}>
          <Divider color={gold} />
        </div>

        <div style={{ fontSize: 50, lineHeight: 1.1, color: gold, fontFamily: display, fontWeight: 700, letterSpacing: lang === "ar" ? 0 : 1 }}>
          {pick(content, "title", lang)}
        </div>

        <div style={{ marginTop: 26, fontSize: 17, color: ink, opacity: 0.82, fontFamily: display }}>
          {pick(content, "presentation", lang)}
        </div>

        <div style={{ marginTop: 14, fontSize: 56, color: "#FFFFFF", fontFamily: display, fontWeight: 700, padding: "0 20px 10px", borderBottom: `2px solid ${gold}`, minWidth: 460 }}>
          {recipientName || (lang === "ar" ? "اسم الطالب" : "Recipient Name")}
        </div>

        <div style={{ marginTop: 28, fontSize: 16, lineHeight: 1.7, color: ink, opacity: 0.78, maxWidth: 720, fontFamily: lang === "ar" ? ARABIC : SERIF }}>
          {pick(content, "body", lang)}
        </div>

        {/* Footer: date · seal · signatory */}
        <div style={{ position: "absolute", bottom: 70, left: 110, right: 110, display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div style={{ textAlign: "center", minWidth: 200 }}>
            <div style={{ fontSize: 18, color: ink, fontFamily: display, paddingBottom: 6, borderBottom: `1px solid ${goldSoft}` }}>{dateLabel}</div>
            <div style={{ fontSize: 13, color: goldSoft, marginTop: 6, letterSpacing: lang === "ar" ? 0 : 2, textTransform: lang === "ar" ? "none" : "uppercase" }}>{lang === "ar" ? "التاريخ" : "Date"}</div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 4 }}>
            <div style={{ position: "relative", width: 92, height: 92, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: `radial-gradient(circle at 35% 30%, ${goldSoft}, ${gold})`, boxShadow: "0 4px 14px rgba(0,0,0,0.35)" }} />
              <StarOctagram size={70} stroke="#5b4410" fill="none" strokeWidth={2} />
            </div>
          </div>

          <div style={{ textAlign: "center", minWidth: 200 }}>
            <div style={{ fontSize: 20, color: "#FFFFFF", fontFamily: display, paddingBottom: 6, borderBottom: `1px solid ${goldSoft}`, minHeight: 28 }}>
              {pick(content, "signatoryName", lang) || " "}
            </div>
            <div style={{ fontSize: 13, color: goldSoft, marginTop: 6, letterSpacing: lang === "ar" ? 0 : 1.5 }}>{pick(content, "signatoryTitle", lang)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── Template 2 — Al-Andalus ───────────────────────── */

export function MosaicCertificate({ content, recipientName, dateLabel, lang, courseTitle, serialLabel }: CertificateRenderProps) {
  const accent = content.accentColor || "#0E7C5A";
  const gold = "#C9A227";
  const ink = "#1c2b25";
  const cream = "#FBF7EC";
  const display = lang === "ar" ? ARABIC : SERIF;

  // A repeating interlaced octagon-and-square band (classic Islamic tessellation).
  const tile = 56;
  const patternId = "mosaicBand";

  return (
    <div style={{ ...frameBox(lang), background: cream, color: ink }}>
      {/* Patterned border bands (top / bottom / sides). The pattern def lives INSIDE this same
          svg so html2canvas-pro serialises it together with the rects that reference it. */}
      <svg style={{ position: "absolute", inset: 0 }} width={CERT_WIDTH} height={CERT_HEIGHT} aria-hidden>
        <defs>
          <pattern id={patternId} width={tile} height={tile} patternUnits="userSpaceOnUse">
            <rect width={tile} height={tile} fill="none" />
            <polygon points={starPoints(tile / 2, tile / 2, tile * 0.46, tile * 0.19)} fill="none" stroke={accent} strokeWidth={1.4} />
            <rect x={tile * 0.28} y={tile * 0.28} width={tile * 0.44} height={tile * 0.44} fill="none" stroke={gold} strokeWidth={1} transform={`rotate(45 ${tile / 2} ${tile / 2})`} />
          </pattern>
        </defs>
        <rect x={0} y={0} width={CERT_WIDTH} height={56} fill={`url(#${patternId})`} opacity={0.9} />
        <rect x={0} y={CERT_HEIGHT - 56} width={CERT_WIDTH} height={56} fill={`url(#${patternId})`} opacity={0.9} />
        <rect x={0} y={0} width={56} height={CERT_HEIGHT} fill={`url(#${patternId})`} opacity={0.9} />
        <rect x={CERT_WIDTH - 56} y={0} width={56} height={CERT_HEIGHT} fill={`url(#${patternId})`} opacity={0.9} />
      </svg>

      {/* Inner keyline frame */}
      <div style={{ position: "absolute", inset: 72, border: `2px solid ${accent}`, borderRadius: 4 }} />
      <div style={{ position: "absolute", inset: 80, border: `1px solid ${gold}`, opacity: 0.6, borderRadius: 3 }} />

      {/* Watermark */}
      <div style={{ position: "absolute", top: "52%", left: "50%", transform: "translate(-50%,-50%)" }}>
        <StarOctagram size={460} stroke={accent} strokeWidth={1.5} opacity={0.05} />
      </div>

      {/* Content */}
      <div style={{ position: "relative", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "110px 130px", textAlign: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <StarOctagram size={30} stroke={gold} fill={gold} strokeWidth={1} />
          <div style={{ fontSize: 18, letterSpacing: lang === "ar" ? 0 : 3, color: accent, fontFamily: display, fontWeight: 700, textTransform: lang === "ar" ? "none" : "uppercase" }}>
            {pick(content, "academyName", lang)}
          </div>
          <StarOctagram size={30} stroke={gold} fill={gold} strokeWidth={1} />
        </div>

        <div style={{ marginTop: 22, fontSize: 46, lineHeight: 1.1, color: ink, fontFamily: display, fontWeight: 700 }}>
          {pick(content, "title", lang)}
        </div>

        <div style={{ marginTop: 18, marginBottom: 22 }}>
          <Divider color={gold} />
        </div>

        <div style={{ fontSize: 16, color: ink, opacity: 0.7, fontFamily: display }}>
          {pick(content, "presentation", lang)}
        </div>

        <div style={{ marginTop: 10, fontSize: 52, color: accent, fontFamily: display, fontWeight: 700 }}>
          {recipientName || (lang === "ar" ? "اسم الطالب" : "Recipient Name")}
        </div>

        {courseTitle && (
          <div style={{ marginTop: 14, padding: "8px 24px", borderRadius: 999, background: `${accent}12`, border: `1px solid ${accent}55`, color: accent, fontSize: 18, fontWeight: 700, fontFamily: display }}>
            {courseTitle}
          </div>
        )}

        <div style={{ marginTop: courseTitle ? 16 : 22, fontSize: 16, lineHeight: 1.7, color: ink, opacity: 0.72, maxWidth: 700, fontFamily: lang === "ar" ? ARABIC : SERIF }}>
          {pick(content, "body", lang)}
        </div>

        {/* Footer */}
        <div style={{ position: "absolute", bottom: 110, left: 150, right: 150, display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div style={{ textAlign: "center", minWidth: 190 }}>
            <div style={{ fontSize: 18, color: ink, fontFamily: display, paddingBottom: 6, borderBottom: `1.5px solid ${accent}` }}>{dateLabel}</div>
            <div style={{ fontSize: 12, color: accent, marginTop: 6, letterSpacing: lang === "ar" ? 0 : 2, textTransform: lang === "ar" ? "none" : "uppercase" }}>{lang === "ar" ? "التاريخ" : "Date"}</div>
          </div>

          <div style={{ position: "relative", width: 84, height: 84, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 2 }}>
            <StarOctagram size={84} stroke={gold} fill="none" strokeWidth={2} />
            <div style={{ position: "absolute", width: 44, height: 44, borderRadius: "50%", border: `2px solid ${accent}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: accent, fontFamily: display, fontWeight: 700 }}>
              {lang === "ar" ? "ختم" : "SEAL"}
            </div>
          </div>

          <div style={{ textAlign: "center", minWidth: 190 }}>
            <div style={{ fontSize: 20, color: ink, fontFamily: display, paddingBottom: 6, borderBottom: `1.5px solid ${accent}`, minHeight: 28 }}>
              {pick(content, "signatoryName", lang) || " "}
            </div>
            <div style={{ fontSize: 12, color: accent, marginTop: 6 }}>{pick(content, "signatoryTitle", lang)}</div>
          </div>
        </div>

        {serialLabel && (
          <div style={{ position: "absolute", bottom: 80, left: 0, right: 0, textAlign: "center", color: accent, opacity: 0.72, fontFamily: display, fontSize: 11, letterSpacing: lang === "ar" ? 0 : 1.5 }}>
            {serialLabel}
          </div>
        )}
      </div>
    </div>
  );
}

/** Render the design matching a template number. */
export function CertificatePreview({
  templateNumber,
  ...props
}: CertificateRenderProps & { templateNumber: 1 | 2 }) {
  return templateNumber === 1 ? <RoyalCertificate {...props} /> : <MosaicCertificate {...props} />;
}
