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
  NASKH,
  pick,
  SANS,
  SERIF,
  shade,
  SignatureBlock,
  signatures,
  StarOctagram,
  starPoints,
  useSvgId,
} from "../kit";

/**
 * MODERN — clean type and flat colour, for courses, workshops and adult programmes.
 *
 *  • Safa: a solid brand panel down the leading edge carries the academy; the page is set flush to
 *    the reading side like a well-made report. Mirrors fully in Arabic.
 *  • Manara: centred, with bold geometric wedges in two opposite corners.
 */

/* ─────────────────────────── Safa ─────────────────────────── */

export function SafaCertificate(props: CertificateRenderProps) {
  const { content, recipientName, dateLabel, lang, courseTitle, serialLabel } = props;
  const ar = lang === "ar";
  const copy = CERT_COPY[lang];
  const accent = content.accentColor || "#0F4C81";
  const ink = "#101828";
  const slate = "#667085";
  const sigs = signatures(content, lang);
  const logo = logoOf(props);
  const title = pick(content, "title", lang);
  const name = recipientName || copy.recipient;
  const latticeId = useSvgId("safa-lattice");
  const panel = 318;
  const pad = 84;
  const tile = 56;
  const c = tile / 2;

  // Physical sides: the panel leads the reading direction.
  const lead = ar ? "right" : "left";
  const trail = ar ? "left" : "right";

  const sigValue = { fontSize: 18, fontWeight: 700, color: ink, textAlign: "start" as const };
  const sigCaption = { fontSize: 13, color: slate, textAlign: "start" as const };

  return (
    <div style={{ ...frameBox(lang, SANS), background: "#FFFFFF", color: ink }}>
      {/* ── Brand panel ── */}
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          [lead]: 0,
          width: panel,
          background: `linear-gradient(165deg, ${shade(accent, 0.08)} 0%, ${accent} 45%, ${shade(accent, -0.32)} 100%)`,
          color: "#FFFFFF",
          overflow: "hidden",
        }}
      >
        <svg style={{ position: "absolute", inset: 0 }} width={panel} height={CERT_HEIGHT} aria-hidden>
          <defs>
            <pattern id={latticeId} width={tile} height={tile} patternUnits="userSpaceOnUse">
              <g fill="none" stroke="#FFFFFF" strokeWidth={1} opacity={0.14}>
                <rect x={tile / 4} y={tile / 4} width={tile / 2} height={tile / 2} />
                <rect x={tile / 4} y={tile / 4} width={tile / 2} height={tile / 2} transform={`rotate(45 ${c} ${c})`} />
                <path d={`M0 ${c}h${tile / 4}M${tile * 0.75} ${c}h${tile / 4}M${c} 0v${tile / 4}M${c} ${tile * 0.75}v${tile / 4}`} />
              </g>
            </pattern>
          </defs>
          <rect width={panel} height={CERT_HEIGHT} fill={`url(#${latticeId})`} />
        </svg>
        {/* Gold edge where the panel meets the page. */}
        <div style={{ position: "absolute", top: 0, bottom: 0, [trail]: 0, width: 6, background: "linear-gradient(180deg, #F3D27A, #C9A227 50%, #F3D27A)" }} />

        <div style={{ position: "absolute", top: 72, [lead]: 52, [trail]: 44, textAlign: "start" }}>
          <div style={{ width: 84, height: 84, borderRadius: 20, background: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 10px 24px rgba(0,0,0,0.18)" }}>
            {logo ? <LogoMark src={logo} size={80} frame={{ borderRadius: 16 }} /> : <StarOctagram size={52} stroke={accent} fill={alpha(accent, 0.12)} strokeWidth={2} />}
          </div>
          <div style={{ marginTop: 26, fontSize: ar ? 26 : 24, fontWeight: 700, lineHeight: 1.3, ...clampLines(ar ? 26 : 24, 1.3, 3) }}>
            {pick(content, "academyName", lang)}
          </div>
          <div style={{ marginTop: 16, width: 44, height: 3, borderRadius: 2, background: "#F3D27A" }} />
        </div>

        <div style={{ position: "absolute", bottom: 72, [lead]: 52, [trail]: 44, textAlign: "start" }}>
          <div style={{ fontSize: 12, letterSpacing: ar ? 0 : 2.5, textTransform: ar ? "none" : "uppercase", color: "rgba(255,255,255,0.7)" }}>{copy.date}</div>
          <div style={{ marginTop: 4, fontSize: 20, fontWeight: 700 }}>{dateLabel}</div>
          {serialLabel && (
            <div style={{ marginTop: 14, fontSize: 12, color: "rgba(255,255,255,0.75)", letterSpacing: ar ? 0 : 1 }}>{serialLabel}</div>
          )}
        </div>
      </div>

      {/* ── Page ── */}
      <div style={{ position: "absolute", top: 64, bottom: 196, [lead]: panel + pad, [trail]: pad, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-start", textAlign: "start" }}>
        <div style={{ width: 56, height: 6, borderRadius: 3, background: accent }} />
        <div style={{ marginTop: 22, fontSize: fitText(title, ar ? 52 : 48, ar ? 20 : 24), fontWeight: 700, lineHeight: 1.15, letterSpacing: ar ? 0 : -0.5, color: ink }}>
          {title}
        </div>

        <div style={{ marginTop: 40, fontSize: ar ? 20 : 18, color: slate }}>{pick(content, "presentation", lang)}</div>
        <div style={{ marginTop: 8, fontSize: fitText(name, ar ? 60 : 58, 20), fontWeight: 700, lineHeight: 1.15, color: accent, whiteSpace: "nowrap" }}>
          {name}
        </div>
        <div style={{ marginTop: 18, height: 1, background: "#E4E7EC", width: "100%", maxWidth: 620 }} />

        {courseTitle && (
          <div style={{ marginTop: 20, padding: "7px 16px", borderRadius: 10, background: alpha(accent, 0.08), color: accent, fontSize: ar ? 18 : 16, fontWeight: 700 }}>
            {courseTitle}
          </div>
        )}

        <div style={{ marginTop: courseTitle ? 16 : 22, fontSize: ar ? 18 : 17, color: "#475467", maxWidth: 600, ...clampLines(ar ? 18 : 17, 1.7, 3) }}>
          {pick(content, "body", lang)}
        </div>
      </div>

      <div style={{ position: "absolute", bottom: 84, [lead]: panel + pad, [trail]: pad, display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 36 }}>
          {sigs.map(
            (sig, i) =>
              sig && <SignatureBlock key={i} value={sig.name} caption={sig.title} width={230} rule="1.5px solid #D0D5DD" valueStyle={sigValue} captionStyle={sigCaption} />,
          )}
        </div>

        <svg width={96} height={96} viewBox="0 0 96 96" style={{ display: "block" }} aria-hidden>
          <circle cx={48} cy={48} r={46} fill={alpha(accent, 0.06)} stroke={accent} strokeWidth={2} />
          <circle cx={48} cy={48} r={38} fill="none" stroke={accent} strokeWidth={1} strokeDasharray="3 4" opacity={0.6} />
          <polygon points={starPoints(48, 48, 24, 10)} fill={accent} />
          <circle cx={48} cy={48} r={6} fill="#FFFFFF" />
        </svg>
      </div>
    </div>
  );
}

/* ─────────────────────────── Manara ─────────────────────────── */

export function ManaraCertificate(props: CertificateRenderProps) {
  const { content, recipientName, dateLabel, lang, courseTitle } = props;
  const ar = lang === "ar";
  const copy = CERT_COPY[lang];
  const accent = content.accentColor || "#0D9488";
  const navy = "#0B1F33";
  const gold = "#E0B84C";
  const slate = "#5B6B7C";
  const sigs = signatures(content, lang);
  const logo = logoOf(props);
  const title = pick(content, "title", lang);
  const name = recipientName || copy.recipient;
  const meta = metaLine(props, sigs.length === 1);
  const dotsId = useSvgId("manara-dots");
  const W = CERT_WIDTH;
  const H = CERT_HEIGHT;

  const sigValue = { fontSize: 18, fontWeight: 700, color: navy };
  const sigCaption = { fontSize: 13, color: slate };

  return (
    <div style={{ ...frameBox(lang, SANS), background: "#FFFFFF", color: navy }}>
      <svg style={{ position: "absolute", inset: 0 }} width={W} height={H} aria-hidden>
        <defs>
          <pattern id={dotsId} width={22} height={22} patternUnits="userSpaceOnUse">
            <circle cx={11} cy={11} r={1.2} fill="#DCE3EA" />
          </pattern>
        </defs>
        <rect width={W} height={H} fill={`url(#${dotsId})`} opacity={0.7} />
        <rect x={28} y={28} width={W - 56} height={H - 56} fill="none" stroke="#E3E8EE" strokeWidth={1.5} />

        {/* Top-trailing wedges. */}
        <polygon points={`${W - 300},0 ${W},0 ${W},200`} fill={navy} />
        <polygon points={`${W - 195},0 ${W},0 ${W},130`} fill={accent} />
        <polygon points={`${W - 348},0 ${W - 330},0 ${W},222 ${W},234`} fill={gold} />
        {/* Bottom-leading wedges. */}
        <polygon points={`0,${H - 200} 0,${H} 300,${H}`} fill={navy} />
        <polygon points={`0,${H - 130} 0,${H} 195,${H}`} fill={accent} />
        <polygon points={`0,${H - 234} 0,${H - 222} 330,${H} 348,${H}`} fill={gold} />
      </svg>

      <div style={contentBand(76, 206, 170)}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <LogoMark src={logo} size={54} frame={{ borderRadius: 14, border: "1px solid #E3E8EE", background: "#FFFFFF" }} />
          <div style={{ fontSize: ar ? 20 : 15, fontWeight: 700, letterSpacing: ar ? 0 : 4, textTransform: ar ? "none" : "uppercase", color: navy }}>
            {pick(content, "academyName", lang)}
          </div>
        </div>

        <div style={{ marginTop: 26, fontSize: fitText(title, ar ? 56 : 52, ar ? 20 : 24), fontWeight: 700, lineHeight: 1.12, letterSpacing: ar ? 0 : -0.5, color: navy }}>
          {title}
        </div>

        <div style={{ marginTop: 18, display: "flex", gap: 6 }}>
          <div style={{ width: 48, height: 5, borderRadius: 3, background: accent }} />
          <div style={{ width: 16, height: 5, borderRadius: 3, background: gold }} />
          <div style={{ width: 8, height: 5, borderRadius: 3, background: navy }} />
        </div>

        <div style={{ marginTop: 24, fontSize: ar ? 20 : 18, color: slate }}>{pick(content, "presentation", lang)}</div>
        <div
          style={{
            marginTop: 6,
            fontFamily: ar ? NASKH : SERIF,
            fontStyle: ar ? "normal" : "italic",
            fontSize: fitText(name, ar ? 62 : 60, 22),
            fontWeight: 700,
            lineHeight: 1.2,
            color: accent,
            whiteSpace: "nowrap",
          }}
        >
          {name}
        </div>

        {courseTitle && (
          <div style={{ marginTop: 14, padding: "7px 20px", borderRadius: 999, background: navy, color: "#FFFFFF", fontSize: ar ? 17 : 14, fontWeight: 700, letterSpacing: ar ? 0 : 1.5, textTransform: ar ? "none" : "uppercase" }}>
            {courseTitle}
          </div>
        )}

        <div style={{ marginTop: courseTitle ? 14 : 18, fontSize: ar ? 18 : 16.5, color: slate, maxWidth: 680, ...clampLines(ar ? 18 : 16.5, 1.7, 3) }}>
          {pick(content, "body", lang)}
        </div>
      </div>

      <div style={{ position: "absolute", bottom: 80, left: 236, right: 236, display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        {sigs[1] ? (
          <SignatureBlock value={sigs[1].name} caption={sigs[1].title} width={200} rule={`2px solid ${navy}`} valueStyle={sigValue} captionStyle={sigCaption} />
        ) : (
          <SignatureBlock value={dateLabel} caption={copy.date} width={200} rule={`2px solid ${navy}`} valueStyle={sigValue} captionStyle={sigCaption} />
        )}

        <svg width={92} height={100} viewBox="0 0 92 100" style={{ display: "block" }} aria-hidden>
          <polygon points="46,2 88,26 88,74 46,98 4,74 4,26" fill={navy} />
          <polygon points="46,12 79,31 79,69 46,88 13,69 13,31" fill="none" stroke={gold} strokeWidth={1.5} />
          <polygon points={starPoints(46, 50, 22, 9.5)} fill={accent} />
          <circle cx={46} cy={50} r={5} fill="#FFFFFF" />
        </svg>

        <SignatureBlock value={sigs[0].name} caption={sigs[0].title} width={200} rule={`2px solid ${navy}`} valueStyle={sigValue} captionStyle={sigCaption} />
      </div>

      {meta && (
        <div style={{ position: "absolute", bottom: 46, left: 0, right: 0, textAlign: "center", fontSize: 11, color: "#8A97A6", letterSpacing: ar ? 0 : 1.5 }}>
          {meta}
        </div>
      )}
    </div>
  );
}
