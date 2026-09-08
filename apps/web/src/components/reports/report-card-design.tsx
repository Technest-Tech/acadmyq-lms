import type { CSSProperties } from "react";
import {
  Balloon,
  Confetti,
  JOY,
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
 * on top of the identical structure — confetti and an open mushaf in the header, spot marks beside
 * the headings, a medal over the ratings, a balloon by the note to the child, a dome-and-minaret
 * skyline in the footer. "joyful" is the default because the reader who has to WANT to see this
 * card is a seven-year-old; "classic" drops the artwork for the academies whose students are
 * adults. Nothing else moves, so there is one design to maintain rather than two.
 *
 * EVERY ORNAMENT IS ABSOLUTELY POSITIONED. Height is the scarce resource on this card — see the
 * header note below — so artwork decorates the bands it sits in without lengthening them. An
 * illustration that costs the reader vertical space is an illustration that pushed the lesson
 * further down a picture somebody has to scroll.
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
  /**
   * Whether the filled fields pair up two-to-a-row.
   *
   * Most report templates are short structured facts — "Memorised: al-Baqarah 1–5", "Homework:
   * page 12" — and stacked full-width each one spends 1080px of width to say ten words while
   * costing the card another ~90px of height. On a document whose only real constraint is height,
   * that is the waste worth removing: six such fields go from six rows to three.
   *
   * Anything carrying actual prose keeps the full measure. A paragraph broken to a 460px column is
   * harder to read than a card that is taller, and readability is the point of the exercise.
   */
  const pairSections = sections.length > 2 && sections.every((s) => s.value.length <= 180);

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
      {/* ── Header band ───────────────────────────────────────────────────
          A letterhead, not a title page.

          This was a centred ceremonial stack — a 92px medallion, the academy name, a rule, a 42px
          display headline, the intro, and a 168px mushaf below it — about 470px of fixed chrome
          before the reader met a single word of the lesson. On a card whose width is fixed and
          whose height is free, that overhead is what made a two-line trial read as an empty poster
          and what pushed a six-section lesson past the browser's canvas ceiling on capture.

          The ceremony now happens ONCE, at the du'a, which is the moment that earns it. The top of
          the page does the job a letterhead does: who is writing, and about what. Everything
          decorative here is absolutely positioned, so the artwork costs the card no height at all. */}
      <div
        style={{
          position: "relative",
          padding: "26px 56px 30px",
          background: `radial-gradient(120% 170% at 50% 0%, ${accent} 0%, ${shade(accent, 0.42)} 70%, ${shade(accent, 0.6)} 100%)`,
          color: "#FFFFFF",
        }}
      >
        <LatticeWatermark id="rc-header-lattice" color={GOLD_SOFT} opacity={0.1} />
        {joyful && (
          <Confetti
            width={REPORT_CARD_WIDTH}
            height={150}
            colors={[JOY.gold, JOY.coral, JOY.sky, JOY.mint, JOY.grape]}
            opacity={0.42}
          />
        )}

        {/* Gold keyline, inset from the bleed — the frame a certificate would wear. */}
        <div style={{ position: "absolute", inset: 10, border: `1px solid ${GOLD}`, opacity: 0.4, borderRadius: 4 }} />

        {/* The hero object, out of the flow. In the corner opposite the mark it still opens the
            card, but it no longer pushes the lesson 120px further down the image. */}
        {joyful && (
          <div style={{ position: "absolute", insetInlineEnd: 42, top: 24 }}>
            <MushafBurst width={124} cover={shade(accent, 0.3)} />
          </div>
        )}

        {/* Identity row: the academy's own mark, or a woven monogram when it has none. */}
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              width: 68,
              height: 68,
              flexShrink: 0,
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
              <img src={logoDataUrl} alt="" style={{ width: 58, height: 58, objectFit: "contain" }} />
            ) : (
              <Octagram size={46} stroke={accent} strokeWidth={2.4} />
            )}
          </div>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 21,
                fontWeight: 700,
                color: GOLD_SOFT,
                letterSpacing: isAr ? 0 : 3,
                textTransform: isAr ? "none" : "uppercase",
                lineHeight: 1.3,
              }}
            >
              {academyName}
            </div>
            {/* The tagline lives here now rather than in the footer, where it was a second, larger
                copy of the same two facts. */}
            {tagline && (
              <div style={{ marginTop: 3, fontSize: 15, lineHeight: 1.5, color: "rgba(255,255,255,0.6)" }}>
                {tagline}
              </div>
            )}
          </div>
        </div>

        {/* The headline keeps the display face and the ceremony of scale; it just no longer needs
            a whole page to itself. maxWidth clears the artwork in the opposite corner. */}
        <div style={{ position: "relative", marginTop: 20, maxWidth: joyful ? 740 : 880 }}>
          <div style={{ fontFamily: DISPLAY, fontSize: 34, fontWeight: 700, lineHeight: 1.3, color: "#FFFFFF" }}>
            {headline}
          </div>
          {intro && (
            <div style={{ marginTop: 8, fontSize: 17, lineHeight: 1.65, color: "rgba(255,255,255,0.8)" }}>
              {intro}
            </div>
          )}
        </div>
      </div>

      {/* ── Facts strip — lifted over the header seam ───────────────────
          Five cells on one row. Attendance used to sit below the strip as its own centred pill,
          which bought a fact everyone already reads first another 62px of page. It keeps the
          colour that made it findable and gives back the row. */}
      <div style={{ padding: "0 56px", marginTop: -22, position: "relative" }}>
        <div
          style={{
            background: PAPER,
            border: `1px solid ${LINE}`,
            borderRadius: 18,
            boxShadow: "0 12px 30px rgba(22,38,31,0.11)",
            padding: "16px 14px",
            display: "flex",
            alignItems: "center",
          }}
        >
          {facts.map((f) => (
            <div
              key={f.label}
              style={{
                flex: f.weight,
                minWidth: 0,
                textAlign: "center",
                padding: "0 10px",
                borderInlineEnd: `1px solid ${LINE}`,
              }}
            >
              <div style={{ fontSize: 14, color: INK_SOFT, letterSpacing: isAr ? 0 : 1 }}>{f.label}</div>
              <div style={{ marginTop: 6, fontSize: 21, fontWeight: 700, color: INK, lineHeight: 1.3 }}>{f.value}</div>
            </div>
          ))}

          <div style={{ flex: 1.15, minWidth: 0, textAlign: "center", padding: "0 10px" }}>
            <div style={{ fontSize: 14, color: INK_SOFT, letterSpacing: isAr ? 0 : 1 }}>{labels.attendance}</div>
            <div
              style={{
                marginTop: 5,
                display: "inline-block",
                padding: "4px 18px",
                borderRadius: 999,
                background: `${accent}14`,
                border: `1.5px solid ${accent}59`,
                color: accent,
                fontSize: 18,
                fontWeight: 700,
              }}
            >
              {attendanceLabel}
            </div>
          </div>
        </div>
      </div>

      {/* ── The lesson itself ─────────────────────────────────────────── */}
      {(sections.length > 0 || bodyHtml) && (
        <div style={{ padding: "30px 56px 0" }}>
          <SectionHeading title={labels.journey} accent={accent} isAr={isAr} joyful={joyful} spot={0} />

          <div
            style={{
              display: "grid",
              gridTemplateColumns: pairSections ? "1fr 1fr" : "1fr",
              gap: 14,
              alignItems: "start",
            }}
          >
            {sections.map((s, i) => (
              <div
                key={s.label}
                style={{
                  // An odd last field spans the row rather than leaving a hole beside it — a gap
                  // at the end of a grid reads as a missing field, not as a finished document.
                  gridColumn:
                    pairSections && i === sections.length - 1 && sections.length % 2 === 1
                      ? "1 / -1"
                      : undefined,
                  background: PAPER,
                  border: `1px solid ${LINE}`,
                  borderRadius: 18,
                  borderInlineStart: `5px solid ${accent}`,
                  padding: pairSections ? "18px 22px" : "20px 26px",
                  height: "100%",
                  boxSizing: "border-box",
                }}
              >
                <div style={{ fontSize: 18, fontWeight: 700, color: accent, marginBottom: 6 }}>{s.label}</div>
                <div style={{ fontSize: 23, lineHeight: 1.65, color: INK, whiteSpace: "pre-wrap" }}>{s.value}</div>
              </div>
            ))}

            {/* Free-text mode: what teachers actually type today, given the same frame. */}
            {bodyHtml && (
              <div
                style={{
                  gridColumn: "1 / -1",
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
        <div style={{ padding: "28px 56px 0" }}>
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
        <div style={{ padding: "28px 56px 0" }}>
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
        <div style={{ padding: "24px 56px 0" }}>
          <div
            style={{
              position: "relative",
              border: `2px solid ${GOLD}`,
              borderRadius: 18,
              background: "#FFFDF6",
              padding: "26px 36px 24px",
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
            <div style={{ marginTop: 10, fontFamily: DISPLAY, fontSize: 28, lineHeight: 1.85, color: INK }}>{dua}</div>
          </div>
        </div>
      )}

      {/* ── Footer band ──────────────────────────────────────────────────
          One line, not a second title page. The academy's name and tagline are already the first
          thing on the card; restating them here at 27px only lengthened an image that was too tall
          already. What IS new below the fold is who taught the lesson, so that is what it says. */}
      <div
        style={{
          marginTop: 34,
          position: "relative",
          padding: joyful ? "22px 56px 44px" : "22px 56px 24px",
          textAlign: "center",
          background: `linear-gradient(180deg, ${shade(accent, 0.42)} 0%, ${shade(accent, 0.66)} 100%)`,
          color: "#FFFFFF",
        }}
      >
        <LatticeWatermark id="rc-footer-lattice" color={GOLD_SOFT} opacity={0.09} />
        {joyful && (
          <>
            {/* A night sky over domes and minarets: the card still closes on somewhere. */}
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0 }}>
              <Skyline width={REPORT_CARD_WIDTH} height={58} fill="#000000" opacity={0.3} />
            </div>
            <div style={{ position: "absolute", top: 16, left: 78 }}><Star size={16} fill={GOLD_SOFT} opacity={0.65} /></div>
            <div style={{ position: "absolute", top: 30, right: 96 }}><Star size={13} fill={GOLD_SOFT} opacity={0.5} /></div>
          </>
        )}
        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          {joyful && <Seedling size={24} />}
          <span style={{ fontSize: 19, fontWeight: 700, color: "#FFFFFF" }}>{academyName}</span>
          {teacherName && (
            <>
              <span style={{ color: GOLD_SOFT, opacity: 0.55 }}>·</span>
              <span style={{ fontSize: 17, color: "rgba(255,255,255,0.66)" }}>
                {labels.teacher} · {teacherName}
              </span>
            </>
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
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
      {joyful ? <SpotMark index={spot} accent={accent} /> : <Octagram size={22} stroke={accent} fill={accent} strokeWidth={1} />}
      <div style={{ fontSize: 22, fontWeight: 700, color: INK, letterSpacing: isAr ? 0 : 0.5, whiteSpace: "nowrap" }}>
        {title}
      </div>
      <div style={{ flex: 1, height: 1.5, background: `linear-gradient(${isAr ? 270 : 90}deg, ${accent}66, rgba(0,0,0,0))` }} />
    </div>
  );
}
