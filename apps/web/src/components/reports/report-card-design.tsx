import type { CSSProperties } from "react";
import {
  Balloon,
  Cloud,
  Confetti,
  JOY,
  Lantern,
  Medal,
  MushafBurst,
  Seedling,
  Skyline,
  SpotMark,
  Star,
} from "@/components/reports/report-card-art";
import type { ReportCardContent } from "@/lib/api";

/**
 * "Al-Bushra" — the shareable session/trial report card.
 *
 * A guardian never opens the panel. The only thing they ever see of an academy's software is what
 * lands in their WhatsApp, so this one image carries the entire brand. It is built the same way the
 * certificates are (`certificate-designs.tsx`): a self-contained DOM tree at a FIXED pixel width
 * with inline hex colours only — never the app's oklch CSS vars — so `html2canvas-pro` captures it
 * identically in light mode, dark mode, or off-screen.
 *
 * Height is deliberately NOT fixed. A trial with two lines and a monthly lesson with six sections
 * are the same document at different lengths, and a fixed box would either clip one or strand the
 * other in whitespace. The capture reads `scrollHeight`.
 *
 * Ornament, not emoji. The source reports these replace lean on emoji to carry structure, which is
 * exactly the job a design should be doing — so the chrome here is inline SVG geometry (the
 * eight-point khatam, the octagram, tapered rules) in the same Islamic-geometric language as the
 * rest of the client-facing surfaces. Emoji the academy types into its OWN wording still render;
 * that is their voice, not our scaffolding.
 *
 * TWO STYLES, ONE SKELETON. `content.cardStyle` gates an ILLUSTRATION LAYER (`report-card-art.tsx`)
 * on top of the identical structure — a lantern-lit header, spot marks beside the headings, a medal
 * over the ratings, a balloon by the note to the child, a dome-and-minaret skyline in the footer.
 * "joyful" is the default because the reader who has to WANT to see this card is a seven-year-old;
 * "classic" drops the artwork for the academies whose students are adults. Nothing else moves, so
 * there is one design to maintain rather than two.
 */

export const REPORT_CARD_WIDTH = 1080;

export type CardLang = "ar" | "en";

/** One filled report field rendered as a titled block. */
export interface ReportCardSection {
  label: string;
  value: string;
}

/** One RATING field, rendered as stars rather than a number. */
export interface ReportCardRating {
  label: string;
  value: number;
  max: number;
}

export interface ReportCardProps {
  lang: CardLang;
  content: ReportCardContent;
  /** The academy's brand display name — already resolved, already placeholder-free. */
  academyName: string;
  /** The logo as a data URI. A remote URL would taint the canvas, so the caller inlines it first;
   *  null falls back to a woven octagram monogram, which is never uglier than a broken image. */
  logoDataUrl: string | null;
  studentName: string;
  teacherName: string;
  dateLabel: string;
  durationLabel: string;
  /** "12" for a numbered lesson, or the localized word for a trial. */
  lessonLabel: string;
  attendanceLabel: string;
  sections: ReportCardSection[];
  ratings: ReportCardRating[];
  /** Sanitised free-text report HTML, shown when the academy keeps no structured fields. */
  bodyHtml: string | null;
  /** Section headings, passed in already translated by the caller. */
  labels: {
    student: string;
    date: string;
    lesson: string;
    duration: string;
    attendance: string;
    teacher: string;
    journey: string;
    ratings: string;
    message: string;
    dua: string;
  };
}

/* ── Palette ─────────────────────────────────────────────────────────────── */

const INK = "#16261F";
const INK_SOFT = "#4A5B53";
const CREAM = "#FBF8F1";
const PAPER = "#FFFFFF";
const LINE = "#E8E1D1";
const GOLD = "#C9A227";
const GOLD_SOFT = "#E7D08A";

const SANS = "var(--font-sans, 'Tajawal'), 'Tajawal', 'Segoe UI', sans-serif";
const DISPLAY = "var(--font-display, 'Amiri'), 'Amiri', Georgia, 'Times New Roman', serif";

/** Darken a hex colour toward black by `amount` (0–1) — used to build the header's depth. */
function shade(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m?.[1]) return hex;
  const n = parseInt(m[1], 16);
  const mix = (c: number) => Math.max(0, Math.round(c * (1 - amount)));
  return `#${[mix((n >> 16) & 255), mix((n >> 8) & 255), mix(n & 255)]
    .map((c) => c.toString(16).padStart(2, "0"))
    .join("")}`;
}

/* ── Ornaments ───────────────────────────────────────────────────────────── */

/** Points of an eight-pointed star (octagram / Rub el Hizb), centred at (cx,cy). */
function starPoints(cx: number, cy: number, outer: number, inner: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 16; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI / 8) * i - Math.PI / 2;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(" ");
}

function Octagram({
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
    </svg>
  );
}

/** A tapered rule · star · tapered rule divider. */
function Divider({ color, width = 220 }: { color: string; width?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16 }}>
      <div style={{ height: 2, width, background: `linear-gradient(90deg, rgba(0,0,0,0), ${color})` }} />
      <Octagram size={22} stroke={color} fill={color} strokeWidth={1} />
      <div style={{ height: 2, width, background: `linear-gradient(270deg, rgba(0,0,0,0), ${color})` }} />
    </div>
  );
}

/** A five-point star, filled or hollow — the rating unit a parent reads at a glance. */
function RatingStar({ filled }: { filled: boolean }) {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 15 : 6.4;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    pts.push(`${(16 + r * Math.cos(a)).toFixed(2)},${(16 + r * Math.sin(a)).toFixed(2)}`);
  }
  return (
    <svg width={32} height={32} viewBox="0 0 32 32" style={{ display: "block" }} aria-hidden>
      <polygon
        points={pts.join(" ")}
        fill={filled ? GOLD : "none"}
        stroke={filled ? GOLD : GOLD}
        strokeWidth={1.6}
        strokeLinejoin="round"
        opacity={filled ? 1 : 0.28}
      />
    </svg>
  );
}

/** The khatam lattice, tiled as a faint watermark behind the header and footer bands. */
function LatticeWatermark({ id, color, opacity }: { id: string; color: string; opacity: number }) {
  const tile = 88;
  const c = tile / 2;
  return (
    <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} aria-hidden>
      <defs>
        <pattern id={id} width={tile} height={tile} patternUnits="userSpaceOnUse">
          <polygon points={starPoints(c, c, c * 0.82, c * 0.34)} fill="none" stroke={color} strokeWidth={1.2} />
          <rect
            x={c * 0.55}
            y={c * 0.55}
            width={c * 0.9}
            height={c * 0.9}
            fill="none"
            stroke={color}
            strokeWidth={0.9}
            transform={`rotate(45 ${c} ${c})`}
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} opacity={opacity} />
    </svg>
  );
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

/** Resolve the academy's saved wording for the active language. */
function pick(content: ReportCardContent, base: "headline" | "intro" | "championMessage" | "dua" | "tagline", lang: CardLang): string {
  return (content[`${base}${lang === "ar" ? "Ar" : "En"}` as keyof ReportCardContent] as string) ?? "";
}

/**
 * Substitute the three placeholders an academy may use anywhere in its saved wording. Kept here so
 * the design and the template editor's live preview can never disagree about what `{student}`
 * means.
 */
export function fillPlaceholders(
  text: string,
  vars: { academy: string; student: string; teacher: string },
): string {
  return text
    .replace(/\{academy\}/g, vars.academy)
    .replace(/\{student\}/g, vars.student)
    .replace(/\{teacher\}/g, vars.teacher);
}

/* ── The card ────────────────────────────────────────────────────────────── */

export function ReportCard(props: ReportCardProps) {
  const {
    lang,
    content,
    academyName,
    logoDataUrl,
    studentName,
    teacherName,
    dateLabel,
    durationLabel,
    lessonLabel,
    attendanceLabel,
    sections,
    ratings,
    bodyHtml,
    labels,
  } = props;

  const accent = content.accentColor || "#0E7C5A";
  const isAr = lang === "ar";
  // Default to the illustrated card: an academy that never opened the setting teaches children.
  const joyful = content.cardStyle !== "classic";
  const vars = { academy: academyName, student: studentName, teacher: teacherName };
  const say = (base: Parameters<typeof pick>[1]) => fillPlaceholders(pick(content, base, lang), vars);

  const headline = say("headline");
  const intro = say("intro");
  const championMessage = say("championMessage");
  const dua = say("dua");
  const tagline = say("tagline");

  // Weighted, not equal: a spelled-out Arabic date needs roughly half again the room of a lesson
  // number, and an even four-way split makes it wrap to three lines and stretch the whole strip.
  // The lesson column carries a two-word HEADING ("Lesson this month" / "الحلقة في الباقة") over a
  // one-character value, so it is sized for its label rather than for its number.
  const facts: Array<{ label: string; value: string; weight: number }> = [
    { label: labels.student, value: studentName || "—", weight: 1.05 },
    { label: labels.date, value: dateLabel, weight: 1.3 },
    { label: labels.lesson, value: lessonLabel, weight: 1 },
    { label: labels.duration, value: durationLabel, weight: 0.85 },
  ];

  const frame: CSSProperties = {
    width: REPORT_CARD_WIDTH,
    boxSizing: "border-box",
    direction: isAr ? "rtl" : "ltr",
    textAlign: isAr ? "right" : "left",
    fontFamily: SANS,
    background: CREAM,
    color: INK,
    overflow: "hidden",
  };

  return (
    <div style={frame}>
      {/* ── Header band ───────────────────────────────────────────────── */}
      <div
        style={{
          position: "relative",
          padding: "34px 64px 72px",
          textAlign: "center",
          background: `radial-gradient(130% 150% at 50% 0%, ${accent} 0%, ${shade(accent, 0.42)} 62%, ${shade(accent, 0.62)} 100%)`,
          color: "#FFFFFF",
        }}
      >
        <LatticeWatermark id="rc-header-lattice" color={GOLD_SOFT} opacity={0.1} />
        {joyful && (
          <>
            <Confetti
              width={REPORT_CARD_WIDTH}
              height={250}
              colors={[JOY.gold, JOY.coral, JOY.sky, JOY.mint, JOY.grape]}
              opacity={0.5}
            />
            {/* Clouds low in the band, so the header reads as sky rather than as a slab. */}
            <div style={{ position: "absolute", bottom: 74, left: 40 }}>
              <Cloud width={112} fill="#FFFFFF" opacity={0.1} />
            </div>
            <div style={{ position: "absolute", bottom: 100, right: 56 }}>
              <Cloud width={80} fill="#FFFFFF" opacity={0.08} />
            </div>
          </>
        )}

        {/* Gold keyline, inset from the bleed — the frame a certificate would wear. */}
        <div style={{ position: "absolute", inset: 14, border: `1px solid ${GOLD}`, opacity: 0.45, borderRadius: 4 }} />
        <div style={{ position: "absolute", top: 22, left: 24 }}><Octagram size={30} stroke={GOLD_SOFT} strokeWidth={1.4} opacity={0.55} /></div>
        <div style={{ position: "absolute", top: 22, right: 24 }}><Octagram size={30} stroke={GOLD_SOFT} strokeWidth={1.4} opacity={0.55} /></div>

        <div style={{ position: "relative" }}>
          {/* Two fanoos hung either side of the identity mark — the first thing a child finds. */}
          {joyful && (
            <>
              <div style={{ position: "absolute", top: -8, left: 180 }}>
                <Lantern height={96} />
              </div>
              <div style={{ position: "absolute", top: -8, right: 180 }}>
                <Lantern height={96} />
              </div>
            </>
          )}

          {/* Identity: the academy's own mark, or a woven monogram when it has none. */}
          <div
            style={{
              width: 92,
              height: 92,
              margin: "0 auto",
              borderRadius: "50%",
              background: PAPER,
              border: `3px solid ${GOLD}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
            }}
          >
            {logoDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoDataUrl} alt="" style={{ width: 80, height: 80, objectFit: "contain" }} />
            ) : (
              <Octagram size={62} stroke={accent} strokeWidth={2.4} />
            )}
          </div>

          <div
            style={{
              marginTop: 14,
              fontSize: 22,
              fontWeight: 700,
              color: GOLD_SOFT,
              letterSpacing: isAr ? 0 : 4,
              textTransform: isAr ? "none" : "uppercase",
            }}
          >
            {academyName}
          </div>

          <div style={{ marginTop: 12, marginBottom: 12 }}>
            <Divider color={GOLD} width={150} />
          </div>

          <div style={{ fontFamily: DISPLAY, fontSize: 42, fontWeight: 700, lineHeight: 1.25, color: "#FFFFFF" }}>
            {headline}
          </div>

          {intro && (
            <div
              style={{
                margin: "12px auto 0",
                maxWidth: 760,
                fontSize: 18,
                lineHeight: 1.7,
                color: "rgba(255,255,255,0.82)",
              }}
            >
              {intro}
            </div>
          )}

          {/* The hero object: an open mushaf with light coming off the page. It closes the header
              rather than straddling its seam — the facts strip lifts 52px into that seam, and an
              illustration there buries the date. */}
          {joyful && (
            <div style={{ marginTop: 12, display: "flex", justifyContent: "center" }}>
              <MushafBurst width={168} cover={shade(accent, 0.3)} />
            </div>
          )}
        </div>
      </div>

      {/* ── Facts strip — lifted over the header seam ─────────────────── */}
      <div style={{ padding: "0 56px", marginTop: -44, position: "relative" }}>
        <div
          style={{
            background: PAPER,
            border: `1px solid ${LINE}`,
            borderRadius: 24,
            boxShadow: "0 18px 40px rgba(22,38,31,0.12)",
            padding: "22px 20px",
            display: "flex",
            alignItems: "stretch",
          }}
        >
          {facts.map((f, i) => (
            <div
              key={f.label}
              style={{
                flex: f.weight,
                minWidth: 0,
                textAlign: "center",
                padding: "0 10px",
                borderInlineEnd: i < facts.length - 1 ? `1px solid ${LINE}` : "none",
              }}
            >
              <div style={{ fontSize: 15, color: INK_SOFT, letterSpacing: isAr ? 0 : 1 }}>{f.label}</div>
              <div style={{ marginTop: 8, fontSize: 23, fontWeight: 700, color: INK, lineHeight: 1.35 }}>{f.value}</div>
            </div>
          ))}
        </div>

        {/* Attendance verdict — the one fact a parent looks for first, so it gets its own pill. */}
        <div style={{ textAlign: "center", marginTop: 18 }}>
          <span
            style={{
              display: "inline-block",
              padding: "9px 30px",
              borderRadius: 999,
              background: `${accent}14`,
              border: `1.5px solid ${accent}59`,
              color: accent,
              fontSize: 19,
              fontWeight: 700,
            }}
          >
            {labels.attendance} · {attendanceLabel}
          </span>
        </div>
      </div>

      {/* ── The lesson itself ─────────────────────────────────────────── */}
      {(sections.length > 0 || bodyHtml) && (
        <div style={{ padding: "38px 56px 0" }}>
          <SectionHeading title={labels.journey} accent={accent} isAr={isAr} joyful={joyful} spot={0} />

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {sections.map((s) => (
              <div
                key={s.label}
                style={{
                  background: PAPER,
                  border: `1px solid ${LINE}`,
                  borderRadius: 18,
                  borderInlineStart: `5px solid ${accent}`,
                  padding: "22px 26px",
                }}
              >
                <div style={{ fontSize: 19, fontWeight: 700, color: accent, marginBottom: 8 }}>{s.label}</div>
                <div style={{ fontSize: 24, lineHeight: 1.7, color: INK, whiteSpace: "pre-wrap" }}>{s.value}</div>
              </div>
            ))}

            {/* Free-text mode: what teachers actually type today, given the same frame. */}
            {bodyHtml && (
              <div
                style={{
                  background: PAPER,
                  border: `1px solid ${LINE}`,
                  borderRadius: 18,
                  borderInlineStart: `5px solid ${accent}`,
                  padding: "22px 26px",
                  fontSize: 24,
                  lineHeight: 1.75,
                  color: INK,
                }}
                dangerouslySetInnerHTML={{ __html: bodyHtml }}
              />
            )}
          </div>
        </div>
      )}

      {/* ── Ratings ───────────────────────────────────────────────────── */}
      {ratings.length > 0 && (
        <div style={{ padding: "34px 56px 0" }}>
          <SectionHeading title={labels.ratings} accent={accent} isAr={isAr} joyful={joyful} spot={2} />
          <div
            style={{
              position: "relative",
              background: PAPER,
              border: `1px solid ${LINE}`,
              borderRadius: 18,
              padding: joyful ? "62px 26px 10px" : "10px 26px",
            }}
          >
            {/* Centred on the panel's top edge, half in and half out: the medal reads as awarded
                TO the ratings. Pinned to a corner instead, it landed on the first row's stars. */}
            {joyful && (
              <div style={{ position: "absolute", top: -30, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
                <Medal size={82} />
              </div>
            )}
            {ratings.map((r, i) => (
              <div
                key={r.label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 20,
                  padding: "17px 0",
                  borderBottom: i < ratings.length - 1 ? `1px solid ${LINE}` : "none",
                }}
              >
                <div style={{ fontSize: 22, fontWeight: 500, color: INK }}>{r.label}</div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  {Array.from({ length: r.max }, (_, n) => (
                    <RatingStar key={n} filled={n < r.value} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── The academy's voice: a word to the child, then the du'a ────── */}
      {championMessage && (
        <div style={{ padding: "34px 56px 0" }}>
          <SectionHeading title={labels.message} accent={accent} isAr={isAr} joyful={joyful} spot={3} />
          <div
            style={{
              position: "relative",
              background: `${accent}12`,
              border: `1px solid ${accent}33`,
              borderInlineStart: `5px solid ${GOLD}`,
              borderRadius: 18,
              padding: "26px 30px",
              fontSize: 24,
              lineHeight: 1.85,
              color: INK,
              paddingInlineEnd: joyful ? 120 : 30,
            }}
          >
            {championMessage}
            {/* "Look how far you've come" — the balloon rises out of the panel's far corner. */}
            {joyful && (
              <div style={{ position: "absolute", insetInlineEnd: 18, bottom: 14 }}>
                <Balloon height={104} />
              </div>
            )}
          </div>
        </div>
      )}

      {dua && (
        <div style={{ padding: "26px 56px 0" }}>
          <div
            style={{
              position: "relative",
              border: `2px solid ${GOLD}`,
              borderRadius: 18,
              background: "#FFFDF6",
              padding: "34px 40px 30px",
              textAlign: "center",
            }}
          >
            {/* The star sits ON the border, the way a seal breaks a frame. */}
            <div
              style={{
                position: "absolute",
                top: -17,
                left: "50%",
                transform: "translateX(-50%)",
                background: "#FFFDF6",
                padding: "0 12px",
              }}
            >
              <Octagram size={32} stroke={GOLD} fill={GOLD} strokeWidth={1} />
            </div>
            <div style={{ fontSize: 15, letterSpacing: isAr ? 0 : 2, color: GOLD, fontWeight: 700, textTransform: isAr ? "none" : "uppercase" }}>
              {labels.dua}
            </div>
            <div style={{ marginTop: 12, fontFamily: DISPLAY, fontSize: 30, lineHeight: 1.95, color: INK }}>{dua}</div>
          </div>
        </div>
      )}

      {/* ── Footer band ───────────────────────────────────────────────── */}
      <div
        style={{
          marginTop: 40,
          position: "relative",
          padding: joyful ? "34px 64px 62px" : "34px 64px 38px",
          textAlign: "center",
          background: `linear-gradient(180deg, ${shade(accent, 0.42)} 0%, ${shade(accent, 0.66)} 100%)`,
          color: "#FFFFFF",
        }}
      >
        <LatticeWatermark id="rc-footer-lattice" color={GOLD_SOFT} opacity={0.09} />
        {joyful && (
          <>
            {/* A night sky over domes and minarets: the card closes on somewhere, not on a colour. */}
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0 }}>
              <Skyline width={REPORT_CARD_WIDTH} height={96} fill="#000000" opacity={0.3} />
            </div>
            <div style={{ position: "absolute", top: 22, left: 74 }}><Star size={20} fill={GOLD_SOFT} opacity={0.7} /></div>
            <div style={{ position: "absolute", top: 58, left: 132 }}><Star size={13} fill={GOLD_SOFT} opacity={0.5} /></div>
            <div style={{ position: "absolute", top: 30, right: 88 }}><Star size={17} fill={GOLD_SOFT} opacity={0.65} /></div>
            <div style={{ position: "absolute", top: 70, right: 156 }}><Star size={12} fill={GOLD_SOFT} opacity={0.45} /></div>
          </>
        )}
        <div style={{ position: "relative" }}>
          <Divider color={GOLD} width={150} />
          <div style={{ marginTop: 16, fontSize: 27, fontWeight: 700, color: "#FFFFFF" }}>{academyName}</div>
          {tagline && (
            <div style={{ marginTop: 8, display: "flex", alignItems: "center", justifyContent: "center", gap: 12 }}>
              {joyful && <Seedling size={30} />}
              <span style={{ fontSize: 20, color: GOLD_SOFT, lineHeight: 1.7 }}>{tagline}</span>
            </div>
          )}
          {teacherName && (
            <div style={{ marginTop: 16, fontSize: 17, color: "rgba(255,255,255,0.62)" }}>
              {labels.teacher} · {teacherName}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** A section heading: a mark, the title, then a rule running to the far edge. */
function SectionHeading({
  title,
  accent,
  isAr,
  joyful,
  spot = 0,
}: {
  title: string;
  accent: string;
  isAr: boolean;
  joyful: boolean;
  spot?: number;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
      {joyful ? <SpotMark index={spot} accent={accent} /> : <Octagram size={24} stroke={accent} fill={accent} strokeWidth={1} />}
      <div style={{ fontSize: 25, fontWeight: 700, color: INK, letterSpacing: isAr ? 0 : 0.5, whiteSpace: "nowrap" }}>
        {title}
      </div>
      <div style={{ flex: 1, height: 1.5, background: `linear-gradient(${isAr ? 270 : 90}deg, ${accent}66, rgba(0,0,0,0))` }} />
    </div>
  );
}
