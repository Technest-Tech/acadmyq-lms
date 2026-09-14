import {
  alpha,
  CERT_COPY,
  CERT_HEIGHT,
  CERT_WIDTH,
  type CertificateRenderProps,
  clampLines,
  contentBand,
  fitText,
  frameBox,
  LogoMark,
  logoOf,
  metaLine,
  pick,
  SANS,
  shade,
  SignatureBlock,
  signatures,
  starPoints,
} from "../kit";

/**
 * CHILDREN — the two a seven-year-old wants on the fridge.
 *
 *  • Bustan: warm cream, confetti, a ribbon banner and a rosette.
 *  • Nujoom: a night sky of stars over a skyline of domes, with a crescent moon.
 *
 * Same rule as the report card's illustration kit: the art is NON-FIGURATIVE — objects, shapes and
 * places, never faces, people or animals — and every ornament's position is a FIXED table, never
 * `Math.random()`, so the preview and the downloaded file are the same picture.
 */

type Bit = { x: number; y: number; s: number; r: number; k: "dot" | "star" | "tri" | "bar" | "ring"; c: number };

/** Confetti, clustered in the margins so it never sits on a word. `c` indexes the palette. */
const CONFETTI: Bit[] = [
  { x: 70, y: 150, s: 14, r: 20, k: "star", c: 1 },
  { x: 38, y: 250, s: 9, r: 0, k: "dot", c: 2 },
  { x: 84, y: 340, s: 16, r: 35, k: "tri", c: 3 },
  { x: 36, y: 430, s: 18, r: 60, k: "bar", c: 0 },
  { x: 76, y: 520, s: 12, r: 0, k: "ring", c: 4 },
  { x: 40, y: 610, s: 13, r: -15, k: "star", c: 2 },
  { x: 92, y: 700, s: 8, r: 0, k: "dot", c: 1 },
  { x: 1053, y: 130, s: 12, r: 0, k: "ring", c: 3 },
  { x: 1086, y: 220, s: 15, r: 10, k: "star", c: 0 },
  { x: 1040, y: 320, s: 9, r: 0, k: "dot", c: 4 },
  { x: 1090, y: 410, s: 18, r: -30, k: "bar", c: 1 },
  { x: 1046, y: 500, s: 15, r: 15, k: "tri", c: 2 },
  { x: 1088, y: 600, s: 12, r: 0, k: "star", c: 3 },
  { x: 1034, y: 690, s: 10, r: 0, k: "dot", c: 0 },
  { x: 180, y: 36, s: 10, r: 0, k: "dot", c: 3 },
  { x: 290, y: 30, s: 14, r: 40, k: "bar", c: 2 },
  { x: 410, y: 38, s: 12, r: 0, k: "star", c: 4 },
  { x: 720, y: 32, s: 12, r: 0, k: "ring", c: 1 },
  { x: 840, y: 38, s: 14, r: -20, k: "tri", c: 0 },
  { x: 950, y: 30, s: 9, r: 0, k: "dot", c: 2 },
  { x: 200, y: 762, s: 13, r: 25, k: "tri", c: 1 },
  { x: 330, y: 768, s: 9, r: 0, k: "dot", c: 4 },
  { x: 480, y: 760, s: 16, r: -35, k: "bar", c: 3 },
  { x: 650, y: 766, s: 12, r: 0, k: "star", c: 0 },
  { x: 790, y: 758, s: 10, r: 0, k: "ring", c: 2 },
  { x: 930, y: 766, s: 13, r: 30, k: "tri", c: 4 },
];

function ConfettiBit({ bit, color }: { bit: Bit; color: string }) {
  const { x, y, s, r } = bit;
  const t = `rotate(${r} ${x} ${y})`;
  switch (bit.k) {
    case "dot":
      return <circle cx={x} cy={y} r={s / 2} fill={color} />;
    case "ring":
      return <circle cx={x} cy={y} r={s / 2} fill="none" stroke={color} strokeWidth={3} />;
    case "star":
      return <polygon points={starPoints(x, y, s, s * 0.45, 5)} fill={color} transform={t} />;
    case "tri":
      return <polygon points={`${x},${y - s / 1.6} ${x + s / 1.6},${y + s / 2.2} ${x - s / 1.6},${y + s / 2.2}`} fill={color} transform={t} />;
    default:
      return <rect x={x - s / 2} y={y - 3} width={s} height={6} rx={3} fill={color} transform={t} />;
  }
}

/* ─────────────────────────── Bustan ─────────────────────────── */

export function BustanCertificate(props: CertificateRenderProps) {
  const { content, recipientName, dateLabel, lang, courseTitle } = props;
  const ar = lang === "ar";
  const copy = CERT_COPY[lang];
  const accent = content.accentColor || "#EF6C4A";
  const palette = [accent, "#F5B301", "#3BA8E8", "#8E6BD8", "#2DBE8C"];
  const cocoa = "#4A3B2C";
  const soft = "#7A6A5A";
  const sigs = signatures(content, lang);
  const logo = logoOf(props);
  const title = pick(content, "title", lang);
  const name = recipientName || copy.recipient;
  const meta = metaLine(props, sigs.length === 1);
  const W = CERT_WIDTH;
  const H = CERT_HEIGHT;

  const sigValue = { fontSize: 18, fontWeight: 700, color: cocoa };
  const sigCaption = { fontSize: 13, color: soft };

  return (
    <div style={{ ...frameBox(lang, SANS), background: "#FFF4E0", color: cocoa }}>
      <svg style={{ position: "absolute", inset: 0 }} width={W} height={H} aria-hidden>
        <rect x={120} y={60} width={W - 240} height={H - 120} rx={40} fill="#FFFFFF" />
        <rect x={120} y={60} width={W - 240} height={H - 120} rx={40} fill="none" stroke="#FFE1B3" strokeWidth={6} />
        <rect x={136} y={76} width={W - 272} height={H - 152} rx={30} fill="none" stroke={accent} strokeWidth={2.5} strokeDasharray="10 9" strokeLinecap="round" />
        {CONFETTI.map((bit, i) => (
          <ConfettiBit key={i} bit={bit} color={palette[bit.c] ?? accent} />
        ))}

        {/* Ribbon banner behind the title. */}
        <g transform={`translate(${W / 2 - 330} 196)`}>
          <polygon points="0,26 92,26 92,92 0,92 28,59" fill={shade(accent, -0.18)} />
          <polygon points="660,26 568,26 568,92 660,92 632,59" fill={shade(accent, -0.18)} />
          <polygon points="64,78 92,94 92,78" fill={shade(accent, -0.45)} />
          <polygon points="596,78 568,94 568,78" fill={shade(accent, -0.45)} />
          <rect x={64} y={10} width={532} height={68} rx={8} fill={accent} />
          <rect x={74} y={18} width={512} height={52} rx={5} fill="none" stroke="#FFFFFF" strokeWidth={1.5} strokeDasharray="5 5" opacity={0.6} />
        </g>

        {/* Three stars over the banner, the middle one tallest. */}
        <polygon points={starPoints(W / 2 - 58, 170, 17, 7.5, 5)} fill="#F5B301" />
        <polygon points={starPoints(W / 2, 160, 26, 11, 5)} fill="#F5B301" stroke="#E09A00" strokeWidth={1.5} />
        <polygon points={starPoints(W / 2 + 58, 170, 17, 7.5, 5)} fill="#F5B301" />
      </svg>

      {/* Academy, on the card's top edge. */}
      <div style={{ position: "absolute", top: 92, left: 0, right: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
        <LogoMark src={logo} size={40} frame={{ borderRadius: 12, background: "#FFFFFF", border: "1px solid #F1E3CC" }} />
        <div style={{ fontSize: ar ? 19 : 16, fontWeight: 700, color: shade(accent, -0.25), letterSpacing: ar ? 0 : 1 }}>
          {pick(content, "academyName", lang)}
        </div>
      </div>

      {/* Title on the banner. */}
      <div style={{ position: "absolute", top: 206, left: W / 2 - 250, width: 500, height: 68, display: "flex", alignItems: "center", justifyContent: "center", color: "#FFFFFF", fontWeight: 700, fontSize: fitText(title, ar ? 36 : 32, ar ? 18 : 22, 0.6), whiteSpace: "nowrap", overflow: "hidden" }}>
        {title}
      </div>

      <div style={contentBand(300, 196, 170)}>
        <div style={{ fontSize: ar ? 22 : 20, color: soft }}>{pick(content, "presentation", lang)}</div>
        <div style={{ marginTop: 4, fontSize: fitText(name, ar ? 64 : 62, 20), fontWeight: 700, lineHeight: 1.2, color: accent, textShadow: "3px 3px 0 #FFE1B3", whiteSpace: "nowrap" }}>
          {name}
        </div>

        {courseTitle && (
          <div style={{ marginTop: 10, padding: "6px 20px", borderRadius: 999, background: "#FFF1CC", color: "#8A5A00", fontSize: ar ? 18 : 16, fontWeight: 700 }}>
            {courseTitle}
          </div>
        )}

        <div style={{ marginTop: courseTitle ? 12 : 16, fontSize: ar ? 19 : 18, color: soft, maxWidth: 660, ...clampLines(ar ? 19 : 18, 1.6, 3) }}>
          {pick(content, "body", lang)}
        </div>
      </div>

      <div style={{ position: "absolute", bottom: 106, left: 196, right: 196, display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        {sigs[1] ? (
          <SignatureBlock value={sigs[1].name} caption={sigs[1].title} width={200} rule="2px dashed #EAD3B0" valueStyle={sigValue} captionStyle={sigCaption} />
        ) : (
          <SignatureBlock value={dateLabel} caption={copy.date} width={200} rule="2px dashed #EAD3B0" valueStyle={sigValue} captionStyle={sigCaption} />
        )}

        {/* Rosette. */}
        <svg width={100} height={118} viewBox="0 0 100 118" style={{ display: "block", marginBottom: -14 }} aria-hidden>
          <polygon points="30,60 18,116 34,106 46,118 50,66" fill="#3BA8E8" />
          <polygon points="70,60 82,116 66,106 54,118 50,66" fill={accent} />
          <polygon points={starPoints(50, 48, 46, 38, 16)} fill="#F5B301" />
          <circle cx={50} cy={48} r={33} fill="#FFFFFF" />
          <circle cx={50} cy={48} r={28} fill="none" stroke="#F5B301" strokeWidth={2} strokeDasharray="4 4" />
          <polygon points={starPoints(50, 48, 20, 8.5, 5)} fill={accent} />
        </svg>

        <SignatureBlock value={sigs[0].name} caption={sigs[0].title} width={200} rule="2px dashed #EAD3B0" valueStyle={sigValue} captionStyle={sigCaption} />
      </div>

      {meta && (
        <div style={{ position: "absolute", bottom: 86, ...(ar ? { left: 160 } : { right: 160 }), fontSize: 11, color: "#A8977F", letterSpacing: ar ? 0 : 1 }}>
          {meta}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── Nujoom ─────────────────────────── */

/** Stars in the sky: [x, y, radius, opacity]. Kept clear of the text column. */
const SKY: [number, number, number, number][] = [
  [60, 210, 1.6, 0.8], [96, 300, 1.1, 0.5], [44, 390, 2, 0.7], [120, 470, 1.2, 0.5], [70, 560, 1.8, 0.8],
  [150, 90, 1.3, 0.6], [230, 60, 2, 0.8], [300, 110, 1.1, 0.5], [390, 50, 1.6, 0.7], [470, 96, 1.2, 0.5],
  [650, 60, 1.4, 0.6], [730, 104, 2, 0.8], [820, 52, 1.2, 0.5], [900, 96, 1.8, 0.7], [980, 60, 1.1, 0.6],
  [1070, 150, 1.6, 0.7], [1030, 250, 1.1, 0.5], [1086, 340, 2, 0.8], [1010, 430, 1.3, 0.5], [1070, 520, 1.7, 0.7],
  [186, 190, 1, 0.45], [950, 190, 1, 0.45], [160, 620, 1.2, 0.5], [980, 610, 1.4, 0.6],
];

/** Four-point sparkles: [x, y, size, gold?]. */
const SPARKLES: [number, number, number, boolean][] = [
  [196, 150, 12, true], [930, 140, 14, false], [84, 460, 10, false], [1044, 390, 12, true],
  [560, 42, 9, false], [120, 640, 9, true], [1010, 660, 10, false],
];

function sparkle(x: number, y: number, s: number): string {
  const k = s * 0.22;
  return `M${x} ${y - s} Q${x + k} ${y - k} ${x + s} ${y} Q${x + k} ${y + k} ${x} ${y + s} Q${x - k} ${y + k} ${x - s} ${y} Q${x - k} ${y - k} ${x} ${y - s} Z`;
}

/** Domes and minarets along the foot of the page, as one silhouette path. */
function skyline(width: number, base: number): string {
  const parts: string[] = [`M0 ${base}`, `V${base - 26}`];
  // [x-start, width, wall height, dome radius | 0 for a minaret]
  const blocks: [number, number, number, number][] = [
    [0, 90, 30, 0], [90, 14, 92, -1], [104, 150, 40, 58], [254, 70, 26, 0], [324, 12, 70, -1],
    [336, 110, 34, 40], [446, 90, 22, 0], [536, 200, 46, 84], [736, 90, 24, 0], [826, 12, 74, -1],
    [838, 120, 34, 44], [958, 14, 96, -1], [972, 151, 30, 0],
  ];
  for (const [x, w, h, dome] of blocks) {
    const top = base - h;
    if (dome === -1) {
      // Minaret: a shaft, a balcony, a pointed cap.
      parts.push(`L${x} ${top}`, `L${x - 3} ${top}`, `L${x - 3} ${top - 5}`, `L${x + w / 2} ${top - 24}`, `L${x + w + 3} ${top - 5}`, `L${x + w + 3} ${top}`, `L${x + w} ${top}`, `L${x + w} ${base - 26}`);
    } else if (dome > 0) {
      const r = Math.min(dome, w / 2);
      const cx = x + w / 2;
      // Dome: up the left quarter, a finial at the apex, down the right quarter.
      parts.push(
        `L${x} ${top}`,
        `L${cx - r} ${top}`,
        `A${r} ${r} 0 0 1 ${cx} ${top - r}`,
        `L${cx - 2} ${top - r}`,
        `L${cx} ${top - r - 16}`,
        `L${cx + 2} ${top - r}`,
        `L${cx} ${top - r}`,
        `A${r} ${r} 0 0 1 ${cx + r} ${top}`,
        `L${x + w} ${top}`,
        `L${x + w} ${base - 26}`,
      );
    } else {
      parts.push(`L${x} ${top}`, `L${x + w} ${top}`, `L${x + w} ${base - 26}`);
    }
  }
  parts.push(`L${width} ${base - 26}`, `V${base}`, "Z");
  return parts.join(" ");
}

export function NujoomCertificate(props: CertificateRenderProps) {
  const { content, recipientName, dateLabel, lang, courseTitle } = props;
  const ar = lang === "ar";
  const copy = CERT_COPY[lang];
  const gold = content.accentColor || "#F4C542";
  const mist = "#C3CDF2";
  const sigs = signatures(content, lang);
  const logo = logoOf(props);
  const title = pick(content, "title", lang);
  const name = recipientName || copy.recipient;
  const meta = metaLine(props, sigs.length === 1);
  const W = CERT_WIDTH;
  const H = CERT_HEIGHT;

  const sigValue = { fontSize: 18, fontWeight: 700, color: "#FFFFFF" };
  const sigCaption = { fontSize: 13, color: mist };

  return (
    <div style={{ ...frameBox(lang, SANS), background: "linear-gradient(165deg, #25388A 0%, #17235E 48%, #0C1336 100%)", color: "#FFFFFF" }}>
      <svg style={{ position: "absolute", inset: 0 }} width={W} height={H} aria-hidden>
        {SKY.map(([x, y, r, o], i) => (
          <circle key={i} cx={x} cy={y} r={r} fill="#FFFFFF" opacity={o} />
        ))}
        {SPARKLES.map(([x, y, s, isGold], i) => (
          <path key={i} d={sparkle(x, y, s)} fill={isGold ? gold : "#FFFFFF"} opacity={isGold ? 1 : 0.85} />
        ))}

        {/* Crescent moon. */}
        <path d="M112 62 A48 48 0 1 0 112 158 A30 48 0 1 1 112 62 Z" fill={gold} />

        <rect x={26} y={26} width={W - 52} height={H - 52} rx={30} fill="none" stroke={gold} strokeWidth={1.5} strokeDasharray="2 9" strokeLinecap="round" opacity={0.7} />

        <path d={skyline(W, H)} fill="#0A102E" />
        <path d={skyline(W, H)} fill="none" stroke={alpha(gold, 0.35)} strokeWidth={1} />
      </svg>

      <div style={contentBand(62, 226, 180)}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <LogoMark src={logo} size={46} frame={{ borderRadius: "50%", background: "#FFFFFF", border: `2px solid ${gold}` }} />
          <div style={{ fontSize: ar ? 19 : 14, fontWeight: 700, color: gold, letterSpacing: ar ? 0 : 3, textTransform: ar ? "none" : "uppercase" }}>
            {pick(content, "academyName", lang)}
          </div>
        </div>

        <div style={{ marginTop: 20, fontSize: fitText(title, ar ? 54 : 48, ar ? 18 : 22), fontWeight: 700, lineHeight: 1.15, color: gold, textShadow: `0 0 22px ${alpha(gold, 0.45)}` }}>
          {title}
        </div>

        <svg width={180} height={20} viewBox="0 0 180 20" style={{ display: "block", marginTop: 12 }} aria-hidden>
          <line x1={0} y1={10} x2={70} y2={10} stroke={alpha(gold, 0.6)} strokeWidth={1.5} strokeLinecap="round" />
          <line x1={110} y1={10} x2={180} y2={10} stroke={alpha(gold, 0.6)} strokeWidth={1.5} strokeLinecap="round" />
          <path d={sparkle(90, 10, 10)} fill={gold} />
        </svg>

        <div style={{ marginTop: 14, fontSize: ar ? 21 : 19, color: mist }}>{pick(content, "presentation", lang)}</div>
        <div style={{ marginTop: 4, fontSize: fitText(name, ar ? 64 : 60, 20), fontWeight: 700, lineHeight: 1.2, color: "#FFFFFF", textShadow: `0 0 26px ${alpha("#9FB4FF", 0.55)}`, whiteSpace: "nowrap" }}>
          {name}
        </div>

        {courseTitle && (
          <div style={{ marginTop: 10, padding: "6px 20px", borderRadius: 999, border: `1.5px solid ${gold}`, background: alpha(gold, 0.12), color: gold, fontSize: ar ? 18 : 16, fontWeight: 700 }}>
            {courseTitle}
          </div>
        )}

        <div style={{ marginTop: courseTitle ? 12 : 16, fontSize: ar ? 18 : 17, color: mist, opacity: 0.9, maxWidth: 660, ...clampLines(ar ? 18 : 17, 1.65, 3) }}>
          {pick(content, "body", lang)}
        </div>
      </div>

      <div style={{ position: "absolute", bottom: 136, left: 206, right: 206, display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        {sigs[1] ? (
          <SignatureBlock value={sigs[1].name} caption={sigs[1].title} width={200} rule={`1.5px solid ${alpha(gold, 0.65)}`} valueStyle={sigValue} captionStyle={sigCaption} />
        ) : (
          <SignatureBlock value={dateLabel} caption={copy.date} width={200} rule={`1.5px solid ${alpha(gold, 0.65)}`} valueStyle={sigValue} captionStyle={sigCaption} />
        )}

        <svg width={96} height={96} viewBox="0 0 96 96" style={{ display: "block" }} aria-hidden>
          <circle cx={48} cy={48} r={46} fill={alpha(gold, 0.12)} />
          <polygon points={starPoints(48, 50, 40, 17, 5)} fill={gold} />
          <polygon points={starPoints(48, 50, 22, 9.5, 5)} fill={shade(gold, 0.55)} />
        </svg>

        <SignatureBlock value={sigs[0].name} caption={sigs[0].title} width={200} rule={`1.5px solid ${alpha(gold, 0.65)}`} valueStyle={sigValue} captionStyle={sigCaption} />
      </div>

      {meta && (
        <div style={{ position: "absolute", bottom: 20, left: 0, right: 0, textAlign: "center", fontSize: 11, color: "#7F8CC4", letterSpacing: ar ? 0 : 1.5 }}>
          {meta}
        </div>
      )}
    </div>
  );
}
