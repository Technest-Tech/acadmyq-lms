import {
  alpha,
  CERT_COPY,
  CERT_HEIGHT,
  CERT_WIDTH,
  type CertificateRenderProps,
  clampLines,
  contentBand,
  DiamondRule,
  fitText,
  frameBox,
  LogoMark,
  logoOf,
  metaLine,
  NASKH,
  pick,
  SANS,
  SCRIPT,
  SERIF,
  shade,
  SignatureBlock,
  signatures,
  StarOctagram,
  starPoints,
  useSvgId,
} from "../kit";

/**
 * CLASSIC — the register of a university diploma.
 *
 *  • Diwan: ivory stock inside a guilloché border (the interlaced waves banknotes use), a gold
 *    ribbon seal, and the recipient's name in a formal script.
 *  • Layl: charcoal and gold leaf with art-deco corners. The one to frame on a wall.
 *
 * The script face only has Latin glyphs, so an Arabic certificate sets the name in naskh instead.
 */

/* ─────────────────────────── Diwan ─────────────────────────── */

/** A sine-like wave along a centre line, as one path: a Q for the first lobe, then T-reflections. */
function wavePath(x: number, y: number, length: number, horizontal: boolean, amp: number): string {
  const half = 14;
  const steps = Math.floor(length / half);
  if (horizontal) {
    let d = `M${x} ${y} Q${x + half / 2} ${y - amp} ${x + half} ${y}`;
    for (let i = 2; i <= steps; i++) d += ` T${x + half * i} ${y}`;
    return d;
  }
  let d = `M${x} ${y} Q${x - amp} ${y + half / 2} ${x} ${y + half}`;
  for (let i = 2; i <= steps; i++) d += ` T${x} ${y + half * i}`;
  return d;
}

export function DiwanCertificate(props: CertificateRenderProps) {
  const { content, recipientName, dateLabel, lang, courseTitle } = props;
  const ar = lang === "ar";
  const copy = CERT_COPY[lang];
  const accent = content.accentColor || "#1E3A5F";
  const gold = "#B9912F";
  const ink = "#1C2230";
  const paper = "#FFFDF7";
  const display = ar ? NASKH : SERIF;
  const sigs = signatures(content, lang);
  const logo = logoOf(props);
  const title = pick(content, "title", lang);
  const name = recipientName || copy.recipient;
  const meta = metaLine(props, sigs.length === 1);
  const sealId = useSvgId("diwan-seal");

  const outer = 30;
  const inner = 68;
  const W = CERT_WIDTH;
  const H = CERT_HEIGHT;

  // The four runs of the guilloché band, each a braid of opposite-phase waves around its centre line.
  const mid = (outer + inner) / 2;
  const runs = [
    { x: inner, y: mid, length: W - inner * 2, horizontal: true },
    { x: inner, y: H - mid, length: W - inner * 2, horizontal: true },
    { x: mid, y: inner, length: H - inner * 2, horizontal: false },
    { x: W - mid, y: inner, length: H - inner * 2, horizontal: false },
  ];
  const braid = [
    { amp: 14, phase: 1, color: accent, width: 1.1, opacity: 0.75 },
    { amp: 14, phase: -1, color: accent, width: 1.1, opacity: 0.45 },
    { amp: 8, phase: 1, color: gold, width: 1, opacity: 0.85 },
    { amp: 8, phase: -1, color: gold, width: 1, opacity: 0.85 },
  ];

  const sigValue = { fontSize: 19, color: ink };
  const sigCaption = { fontSize: ar ? 14 : 12, color: accent, letterSpacing: ar ? 0 : 1.5, textTransform: ar ? ("none" as const) : ("uppercase" as const) };

  return (
    <div style={{ ...frameBox(lang, display), background: paper, color: ink }}>
      <svg style={{ position: "absolute", inset: 0 }} width={W} height={H} aria-hidden>
        {runs.map((run, r) =>
          braid.map((b, i) => (
            <path
              key={`${r}-${i}`}
              d={wavePath(run.x, run.y, run.length, run.horizontal, b.amp * b.phase)}
              fill="none"
              stroke={b.color}
              strokeWidth={b.width}
              opacity={b.opacity}
            />
          )),
        )}

        <rect x={outer} y={outer} width={W - outer * 2} height={H - outer * 2} fill="none" stroke={accent} strokeWidth={2.5} />
        <rect x={inner} y={inner} width={W - inner * 2} height={H - inner * 2} fill="none" stroke={accent} strokeWidth={1.5} />
        <rect x={inner + 9} y={inner + 9} width={W - (inner + 9) * 2} height={H - (inner + 9) * 2} fill="none" stroke={gold} strokeWidth={1} />

        {/* Corner rosettes sit on the band's corners. */}
        {([
          [(outer + inner) / 2, (outer + inner) / 2],
          [W - (outer + inner) / 2, (outer + inner) / 2],
          [(outer + inner) / 2, H - (outer + inner) / 2],
          [W - (outer + inner) / 2, H - (outer + inner) / 2],
        ] as const).map(([cx, cy], i) => (
          <g key={i}>
            <circle cx={cx} cy={cy} r={27} fill={paper} stroke={accent} strokeWidth={2} />
            <polygon points={starPoints(cx, cy, 20, 9)} fill={alpha(gold, 0.25)} stroke={gold} strokeWidth={1.2} />
            <circle cx={cx} cy={cy} r={4} fill={accent} />
          </g>
        ))}
      </svg>

      <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)" }}>
        <StarOctagram size={440} stroke={accent} strokeWidth={1.2} opacity={0.04} />
      </div>

      <div style={contentBand(96, 222, 150)}>
        <LogoMark src={logo} size={56} frame={{ marginBottom: 6 }} />
        <div style={{ fontSize: ar ? 20 : 15, letterSpacing: ar ? 0 : 5, color: accent, fontWeight: 700, textTransform: ar ? "none" : "uppercase" }}>
          {pick(content, "academyName", lang)}
        </div>

        <div style={{ marginTop: 12, fontSize: fitText(title, ar ? 54 : 50, ar ? 22 : 26), lineHeight: 1.15, color: accent, fontWeight: 700 }}>
          {title}
        </div>

        <div style={{ marginTop: 12 }}>
          <DiamondRule color={gold} width={120} />
        </div>

        <div style={{ marginTop: 14, fontSize: ar ? 22 : 18, color: "#4A4F5C", fontStyle: ar ? "normal" : "italic" }}>
          {pick(content, "presentation", lang)}
        </div>

        <div
          style={{
            marginTop: ar ? 4 : 0,
            fontFamily: ar ? NASKH : SCRIPT,
            fontSize: ar ? fitText(name, 58, 22) : fitText(name, 76, 22),
            lineHeight: ar ? 1.3 : 1.15,
            fontWeight: ar ? 700 : 400,
            color: ink,
            whiteSpace: "nowrap",
            padding: "0 30px",
            borderBottom: `1px solid ${gold}`,
            minWidth: 480,
          }}
        >
          {name}
        </div>

        {courseTitle && (
          <div style={{ marginTop: 14, fontSize: ar ? 22 : 16, fontWeight: 700, color: accent, letterSpacing: ar ? 0 : 2.5, textTransform: ar ? "none" : "uppercase" }}>
            {courseTitle}
          </div>
        )}

        <div style={{ marginTop: courseTitle ? 8 : 16, fontSize: ar ? 18 : 16, color: "#4A4F5C", maxWidth: 700, ...clampLines(ar ? 18 : 16, 1.65, 3) }}>
          {pick(content, "body", lang)}
        </div>
      </div>

      <div style={{ position: "absolute", bottom: 108, left: 168, right: 168, display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        {sigs[1] ? (
          <SignatureBlock value={sigs[1].name} caption={sigs[1].title} rule={`1px solid ${ink}`} valueStyle={sigValue} captionStyle={sigCaption} />
        ) : (
          <SignatureBlock value={dateLabel} caption={copy.date} rule={`1px solid ${ink}`} valueStyle={{ ...sigValue, fontSize: 18 }} captionStyle={sigCaption} />
        )}

        {/* Gold ribbon seal: two tails under a scalloped foil disc. */}
        <svg width={112} height={124} viewBox="0 0 112 124" style={{ display: "block", marginBottom: -18 }} aria-hidden>
          <defs>
            <linearGradient id={sealId} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#F6E3A1" />
              <stop offset="55%" stopColor="#C9A227" />
              <stop offset="100%" stopColor="#8E6B12" />
            </linearGradient>
          </defs>
          <polygon points="30,62 18,122 36,110 50,124 56,70" fill={accent} />
          <polygon points="82,62 94,122 76,110 62,124 56,70" fill={shade(accent, -0.25)} />
          <polygon points={starPoints(56, 52, 50, 43, 24)} fill={`url(#${sealId})`} />
          <circle cx={56} cy={52} r={36} fill="none" stroke="#8E6B12" strokeWidth={1.5} />
          <circle cx={56} cy={52} r={31} fill="none" stroke="#FFF4CC" strokeWidth={1} strokeDasharray="2 3" />
          <polygon points={starPoints(56, 52, 20, 8.5)} fill="#FFF4CC" stroke="#8E6B12" strokeWidth={1.2} />
        </svg>

        <SignatureBlock value={sigs[0].name} caption={sigs[0].title} rule={`1px solid ${ink}`} valueStyle={sigValue} captionStyle={sigCaption} />
      </div>

      {meta && (
        <div style={{ position: "absolute", bottom: 88, ...(ar ? { left: 96 } : { right: 96 }), fontFamily: SANS, fontSize: 11, color: accent, opacity: 0.7, letterSpacing: ar ? 0 : 1.5 }}>
          {meta}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── Layl ─────────────────────────── */

/** One art-deco corner, drawn for the top-left and mirrored into place. */
function DecoCorner({ x, y, sx, sy, gold }: { x: number; y: number; sx: 1 | -1; sy: 1 | -1; gold: string }) {
  const p = (dx: number, dy: number) => `${x + dx * sx} ${y + dy * sy}`;
  return (
    <g fill="none" stroke={gold} strokeLinecap="square">
      <path d={`M${p(0, 118)} L${p(0, 0)} L${p(118, 0)}`} strokeWidth={2} />
      <path d={`M${p(12, 92)} L${p(12, 12)} L${p(92, 12)}`} strokeWidth={1} opacity={0.8} />
      <path d={`M${p(24, 64)} L${p(24, 24)} L${p(64, 24)}`} strokeWidth={1} opacity={0.6} />
      <path d={`M${p(0, 150)} A150 150 0 0 ${sx * sy === 1 ? 0 : 1} ${p(150, 0)}`} strokeWidth={0.8} opacity={0.35} />
      <polygon points={`${p(0, -7)} ${p(7, 0)} ${p(0, 7)} ${p(-7, 0)}`} fill={gold} stroke="none" />
    </g>
  );
}

export function LaylCertificate(props: CertificateRenderProps) {
  const { content, recipientName, dateLabel, lang, courseTitle } = props;
  const ar = lang === "ar";
  const copy = CERT_COPY[lang];
  const gold = content.accentColor || "#D4AF37";
  const champagne = shade(gold, 0.55);
  const muted = "#A7A195";
  const display = ar ? NASKH : SERIF;
  const sigs = signatures(content, lang);
  const logo = logoOf(props);
  const title = pick(content, "title", lang);
  const name = recipientName || copy.recipient;
  const meta = metaLine(props, sigs.length === 1);
  const W = CERT_WIDTH;
  const H = CERT_HEIGHT;

  const sigValue = { fontSize: 19, color: "#EDE6D6" };
  const sigCaption = { fontFamily: ar ? NASKH : SANS, fontSize: ar ? 14 : 11, color: gold, letterSpacing: ar ? 0 : 2.5, textTransform: ar ? ("none" as const) : ("uppercase" as const) };

  return (
    <div style={{ ...frameBox(lang, display), background: "radial-gradient(90% 95% at 50% 38%, #1D2029 0%, #121419 55%, #0A0B0E 100%)", color: "#EDE6D6" }}>
      <svg style={{ position: "absolute", inset: 0 }} width={W} height={H} aria-hidden>
        <rect x={30} y={30} width={W - 60} height={H - 60} fill="none" stroke={gold} strokeWidth={1.5} opacity={0.9} />
        <rect x={40} y={40} width={W - 80} height={H - 80} fill="none" stroke={gold} strokeWidth={0.7} opacity={0.5} />
        <DecoCorner x={56} y={56} sx={1} sy={1} gold={gold} />
        <DecoCorner x={W - 56} y={56} sx={-1} sy={1} gold={gold} />
        <DecoCorner x={56} y={H - 56} sx={1} sy={-1} gold={gold} />
        <DecoCorner x={W - 56} y={H - 56} sx={-1} sy={-1} gold={gold} />
        {/* A sunburst rising behind the title. */}
        <g stroke={gold} opacity={0.07}>
          {Array.from({ length: 25 }, (_, i) => {
            const a = Math.PI + (Math.PI / 24) * i;
            return <line key={i} x1={W / 2} y1={420} x2={W / 2 + Math.cos(a) * 560} y2={420 + Math.sin(a) * 560} strokeWidth={1} />;
          })}
        </g>
      </svg>

      <div style={contentBand(84, 206, 150)}>
        <LogoMark src={logo} size={60} frame={{ borderRadius: "50%", border: `1px solid ${gold}`, background: "#F8F4EA", marginBottom: 12 }} />
        <div style={{ fontFamily: ar ? NASKH : SANS, fontSize: ar ? 20 : 13, letterSpacing: ar ? 0 : 6, color: champagne, textTransform: ar ? "none" : "uppercase", fontWeight: 500 }}>
          {pick(content, "academyName", lang)}
        </div>

        <div
          style={{
            marginTop: 16,
            fontSize: ar ? fitText(title, 58, 20) : fitText(title, 44, 22),
            lineHeight: 1.15,
            color: gold,
            fontWeight: 700,
            letterSpacing: ar ? 0 : 5,
            textTransform: ar ? "none" : "uppercase",
          }}
        >
          {title}
        </div>

        <div style={{ marginTop: 14 }}>
          <DiamondRule color={gold} width={80} />
        </div>

        <div style={{ marginTop: 16, fontSize: ar ? 21 : 17, color: muted, fontStyle: ar ? "normal" : "italic" }}>
          {pick(content, "presentation", lang)}
        </div>

        <div
          style={{
            fontFamily: ar ? NASKH : SCRIPT,
            fontSize: ar ? fitText(name, 60, 22) : fitText(name, 82, 22),
            lineHeight: ar ? 1.35 : 1.2,
            fontWeight: ar ? 700 : 400,
            color: champagne,
            whiteSpace: "nowrap",
          }}
        >
          {name}
        </div>

        {courseTitle && (
          <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 14, color: gold, fontFamily: ar ? NASKH : SANS, fontSize: ar ? 20 : 13, fontWeight: 700, letterSpacing: ar ? 0 : 3, textTransform: ar ? "none" : "uppercase" }}>
            <div style={{ width: 44, height: 1, background: gold }} />
            {courseTitle}
            <div style={{ width: 44, height: 1, background: gold }} />
          </div>
        )}

        <div style={{ marginTop: courseTitle ? 12 : 14, fontSize: ar ? 18 : 15.5, color: muted, maxWidth: 660, ...clampLines(ar ? 18 : 15.5, 1.7, 3) }}>
          {pick(content, "body", lang)}
        </div>
      </div>

      <div style={{ position: "absolute", bottom: 84, left: 200, right: 200, display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        {sigs[1] ? (
          <SignatureBlock value={sigs[1].name} caption={sigs[1].title} rule={`1px solid ${alpha(gold, 0.8)}`} valueStyle={sigValue} captionStyle={sigCaption} />
        ) : (
          <SignatureBlock value={dateLabel} caption={copy.date} rule={`1px solid ${alpha(gold, 0.8)}`} valueStyle={{ ...sigValue, fontSize: 18 }} captionStyle={sigCaption} />
        )}

        <div style={{ position: "relative", width: 90, height: 90, borderRadius: "50%", background: `radial-gradient(circle at 35% 30%, ${shade(gold, 0.6)}, ${gold} 55%, ${shade(gold, -0.4)})`, boxShadow: "0 6px 18px rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ position: "absolute", inset: 7, borderRadius: "50%", border: `1.5px solid ${alpha("#000000", 0.22)}` }} />
          <div style={{ position: "absolute", inset: 12, borderRadius: "50%", border: `1px dashed ${alpha("#FFFFFF", 0.45)}` }} />
          <div style={{ position: "relative" }}>
            <StarOctagram size={44} stroke={shade(gold, -0.65)} strokeWidth={1.6} />
          </div>
        </div>

        <SignatureBlock value={sigs[0].name} caption={sigs[0].title} rule={`1px solid ${alpha(gold, 0.8)}`} valueStyle={sigValue} captionStyle={sigCaption} />
      </div>

      {meta && (
        <div style={{ position: "absolute", bottom: 52, left: 0, right: 0, textAlign: "center", fontFamily: SANS, fontSize: 10.5, color: "#8C8577", letterSpacing: ar ? 0 : 2 }}>
          {meta}
        </div>
      )}
    </div>
  );
}
