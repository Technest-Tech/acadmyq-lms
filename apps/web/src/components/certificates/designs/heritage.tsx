import {
  alpha,
  CERT_COPY,
  CERT_HEIGHT,
  CERT_WIDTH,
  type CertificateRenderProps,
  clampLines,
  contentBand,
  DiamondRule,
  Divider,
  fitText,
  frameBox,
  LogoMark,
  logoOf,
  metaLine,
  NASKH,
  pick,
  SERIF,
  shade,
  SignatureBlock,
  signatures,
  StarOctagram,
  starPoints,
  useSvgId,
} from "../kit";

/**
 * HERITAGE — the three designs drawn in Islamic geometry and architecture.
 *
 *  • Al-Noor: a deep emerald field framed in gold foil, Rub-el-Hizb corners, a wax-seal medallion.
 *  • Al-Andalus: an ivory field inside an interlaced star-and-square band. Airy, minimal.
 *  • Mihrab: a parchment manuscript page opened through a pointed arch — the ijazah register,
 *    for memorisation milestones.
 */

/* ─────────────────────────── Al-Noor ─────────────────────────── */

export function NoorCertificate(props: CertificateRenderProps) {
  const { content, recipientName, dateLabel, lang, courseTitle } = props;
  const ar = lang === "ar";
  const copy = CERT_COPY[lang];
  const gold = content.accentColor || "#C9A227";
  const goldSoft = shade(gold, 0.45);
  const ink = "#F4EFE2";
  const display = ar ? NASKH : SERIF;
  const sigs = signatures(content, lang);
  const logo = logoOf(props);
  const title = pick(content, "title", lang);
  const name = recipientName || copy.recipient;
  const meta = metaLine(props, sigs.length === 1);

  const sigValue = { fontSize: 19, color: "#FFFFFF", fontFamily: display };
  const sigCaption = { fontSize: 13, color: goldSoft, letterSpacing: ar ? 0 : 1.5, fontFamily: display };

  return (
    <div
      style={{
        ...frameBox(lang, display),
        background: "radial-gradient(120% 140% at 50% 0%, #0d4636 0%, #08301f 55%, #062417 100%)",
        color: ink,
      }}
    >
      <div style={{ position: "absolute", inset: 26, border: `3px solid ${gold}`, borderRadius: 6 }} />
      <div style={{ position: "absolute", inset: 38, border: `1px solid ${goldSoft}`, opacity: 0.65, borderRadius: 4 }} />

      {[
        { top: 18, left: 18 },
        { top: 18, right: 18 },
        { bottom: 18, left: 18 },
        { bottom: 18, right: 18 },
      ].map((pos, i) => (
        <div key={i} style={{ position: "absolute", ...pos }}>
          <StarOctagram size={64} stroke={gold} strokeWidth={2} />
        </div>
      ))}

      <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)" }}>
        <StarOctagram size={420} stroke={goldSoft} strokeWidth={1} opacity={0.06} />
      </div>

      <div style={contentBand(66, 196, 120)}>
        <LogoMark
          src={logo}
          size={58}
          frame={{ borderRadius: "50%", border: `1.5px solid ${gold}`, background: "rgba(255,255,255,0.92)", marginBottom: 12 }}
        />
        <div style={{ letterSpacing: ar ? 0 : 4, fontSize: ar ? 20 : 17, color: goldSoft, textTransform: ar ? "none" : "uppercase" }}>
          {pick(content, "academyName", lang)}
        </div>

        <div style={{ marginTop: 12, marginBottom: 8 }}>
          <Divider color={gold} />
        </div>

        <div style={{ fontSize: fitText(title, ar ? 54 : 50, ar ? 22 : 26), lineHeight: 1.15, color: gold, fontWeight: 700, letterSpacing: ar ? 0 : 1 }}>
          {title}
        </div>

        <div style={{ marginTop: 22, fontSize: ar ? 21 : 17, color: ink, opacity: 0.82, fontStyle: ar ? "normal" : "italic" }}>
          {pick(content, "presentation", lang)}
        </div>

        <div
          style={{
            marginTop: 12,
            fontSize: fitText(name, ar ? 58 : 54, 22),
            lineHeight: 1.15,
            color: "#FFFFFF",
            fontWeight: 700,
            padding: "0 24px 10px",
            borderBottom: `2px solid ${gold}`,
            minWidth: 460,
            whiteSpace: "nowrap",
          }}
        >
          {name}
        </div>

        {courseTitle && (
          <div style={{ marginTop: 16, padding: "6px 22px", borderRadius: 999, border: `1px solid ${alpha(gold, 0.7)}`, background: alpha(gold, 0.1), color: goldSoft, fontSize: ar ? 19 : 16, fontWeight: 700 }}>
            {courseTitle}
          </div>
        )}

        <div style={{ marginTop: courseTitle ? 14 : 22, fontSize: ar ? 18 : 16, color: ink, opacity: 0.8, maxWidth: 720, ...clampLines(ar ? 18 : 16, 1.7, 3) }}>
          {pick(content, "body", lang)}
        </div>
      </div>

      <div style={{ position: "absolute", bottom: 78, left: 120, right: 120, display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        {sigs[1] ? (
          <SignatureBlock value={sigs[1].name} caption={sigs[1].title} rule={`1px solid ${goldSoft}`} valueStyle={sigValue} captionStyle={sigCaption} />
        ) : (
          <SignatureBlock
            value={dateLabel}
            caption={copy.date}
            rule={`1px solid ${goldSoft}`}
            valueStyle={{ ...sigValue, fontSize: 18, color: ink }}
            captionStyle={{ ...sigCaption, letterSpacing: ar ? 0 : 2, textTransform: ar ? "none" : "uppercase" }}
          />
        )}

        <div style={{ position: "relative", width: 92, height: 92, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 2 }}>
          <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: `radial-gradient(circle at 35% 30%, ${goldSoft}, ${gold})`, boxShadow: "0 4px 14px rgba(0,0,0,0.35)" }} />
          <div style={{ position: "relative" }}>
            <StarOctagram size={70} stroke={shade(gold, -0.6)} strokeWidth={2} />
          </div>
        </div>

        <SignatureBlock value={sigs[0].name} caption={sigs[0].title} rule={`1px solid ${goldSoft}`} valueStyle={sigValue} captionStyle={sigCaption} />
      </div>

      {meta && (
        <div style={{ position: "absolute", bottom: 48, left: 0, right: 0, textAlign: "center", fontSize: 11, color: goldSoft, opacity: 0.75, letterSpacing: ar ? 0 : 1.5 }}>
          {meta}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── Al-Andalus ─────────────────────────── */

export function AndalusCertificate(props: CertificateRenderProps) {
  const { content, recipientName, dateLabel, lang, courseTitle } = props;
  const ar = lang === "ar";
  const copy = CERT_COPY[lang];
  const accent = content.accentColor || "#0E7C5A";
  const gold = "#C9A227";
  const ink = "#1c2b25";
  const cream = "#FBF7EC";
  const display = ar ? NASKH : SERIF;
  const sigs = signatures(content, lang);
  const logo = logoOf(props);
  const title = pick(content, "title", lang);
  const name = recipientName || copy.recipient;
  const meta = metaLine(props, sigs.length === 1);
  const patternId = useSvgId("andalus-band");
  const tile = 56;

  const sigValue = { fontSize: 19, color: ink };
  const sigCaption = { fontSize: 12.5, color: accent };

  return (
    <div style={{ ...frameBox(lang, display), background: cream, color: ink }}>
      {/* The pattern def lives INSIDE the same svg as the rects that use it, so the capture
          serialises them together. */}
      <svg style={{ position: "absolute", inset: 0 }} width={CERT_WIDTH} height={CERT_HEIGHT} aria-hidden>
        <defs>
          <pattern id={patternId} width={tile} height={tile} patternUnits="userSpaceOnUse">
            <polygon points={starPoints(tile / 2, tile / 2, tile * 0.46, tile * 0.19)} fill="none" stroke={accent} strokeWidth={1.4} />
            <rect x={tile * 0.28} y={tile * 0.28} width={tile * 0.44} height={tile * 0.44} fill="none" stroke={gold} strokeWidth={1} transform={`rotate(45 ${tile / 2} ${tile / 2})`} />
          </pattern>
        </defs>
        <rect x={0} y={0} width={CERT_WIDTH} height={56} fill={`url(#${patternId})`} opacity={0.9} />
        <rect x={0} y={CERT_HEIGHT - 56} width={CERT_WIDTH} height={56} fill={`url(#${patternId})`} opacity={0.9} />
        <rect x={0} y={0} width={56} height={CERT_HEIGHT} fill={`url(#${patternId})`} opacity={0.9} />
        <rect x={CERT_WIDTH - 56} y={0} width={56} height={CERT_HEIGHT} fill={`url(#${patternId})`} opacity={0.9} />
      </svg>

      <div style={{ position: "absolute", inset: 72, border: `2px solid ${accent}`, borderRadius: 4 }} />
      <div style={{ position: "absolute", inset: 80, border: `1px solid ${gold}`, opacity: 0.6, borderRadius: 3 }} />

      <div style={{ position: "absolute", top: "52%", left: "50%", transform: "translate(-50%,-50%)" }}>
        <StarOctagram size={460} stroke={accent} strokeWidth={1.5} opacity={0.05} />
      </div>

      <div style={contentBand(100, 214, 140)}>
        <LogoMark src={logo} size={52} frame={{ marginBottom: 8 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <StarOctagram size={26} stroke={gold} fill={gold} strokeWidth={1} />
          <div style={{ fontSize: ar ? 20 : 17, letterSpacing: ar ? 0 : 3, color: accent, fontWeight: 700, textTransform: ar ? "none" : "uppercase" }}>
            {pick(content, "academyName", lang)}
          </div>
          <StarOctagram size={26} stroke={gold} fill={gold} strokeWidth={1} />
        </div>

        <div style={{ marginTop: 18, fontSize: fitText(title, ar ? 50 : 44, ar ? 22 : 26), lineHeight: 1.15, color: ink, fontWeight: 700 }}>
          {title}
        </div>

        <div style={{ marginTop: 14, marginBottom: 16 }}>
          <Divider color={gold} />
        </div>

        <div style={{ fontSize: ar ? 20 : 16, color: ink, opacity: 0.7, fontStyle: ar ? "normal" : "italic" }}>
          {pick(content, "presentation", lang)}
        </div>

        <div style={{ marginTop: 8, fontSize: fitText(name, ar ? 56 : 52, 22), lineHeight: 1.2, color: accent, fontWeight: 700, whiteSpace: "nowrap" }}>
          {name}
        </div>

        {courseTitle && (
          <div style={{ marginTop: 12, padding: "7px 22px", borderRadius: 999, background: alpha(accent, 0.07), border: `1px solid ${alpha(accent, 0.35)}`, color: accent, fontSize: ar ? 19 : 17, fontWeight: 700 }}>
            {courseTitle}
          </div>
        )}

        <div style={{ marginTop: courseTitle ? 12 : 18, fontSize: ar ? 18 : 16, color: ink, opacity: 0.72, maxWidth: 700, ...clampLines(ar ? 18 : 16, 1.65, 3) }}>
          {pick(content, "body", lang)}
        </div>
      </div>

      <div style={{ position: "absolute", bottom: 112, left: 156, right: 156, display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        {sigs[1] ? (
          <SignatureBlock value={sigs[1].name} caption={sigs[1].title} width={200} rule={`1.5px solid ${accent}`} valueStyle={sigValue} captionStyle={sigCaption} />
        ) : (
          <SignatureBlock
            value={dateLabel}
            caption={copy.date}
            width={200}
            rule={`1.5px solid ${accent}`}
            valueStyle={{ ...sigValue, fontSize: 18 }}
            captionStyle={{ ...sigCaption, letterSpacing: ar ? 0 : 2, textTransform: ar ? "none" : "uppercase" }}
          />
        )}

        <div style={{ position: "relative", width: 84, height: 84, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ position: "absolute", inset: 0 }}>
            <StarOctagram size={84} stroke={gold} strokeWidth={2} />
          </div>
          <div style={{ position: "relative", width: 40, height: 40, borderRadius: "50%", border: `2px solid ${accent}`, background: cream, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <StarOctagram size={22} stroke={accent} fill={accent} strokeWidth={1} />
          </div>
        </div>

        <SignatureBlock value={sigs[0].name} caption={sigs[0].title} width={200} rule={`1.5px solid ${accent}`} valueStyle={sigValue} captionStyle={sigCaption} />
      </div>

      {meta && (
        <div style={{ position: "absolute", bottom: 88, left: 0, right: 0, textAlign: "center", color: accent, opacity: 0.72, fontSize: 11, letterSpacing: ar ? 0 : 1.5 }}>
          {meta}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── Mihrab ─────────────────────────── */

/** The pointed arch, inset by `d` — one path drives the frame, its keyline, and the spandrels. */
function archPath(d: number): string {
  const l = 170 + d;
  const r = 953 - d;
  const top = 70 + d * 1.3;
  const spring = 300 + d * 0.2;
  const base = 734 - d;
  const mid = 561.5;
  return [
    `M${l} ${base}`,
    `V${spring}`,
    `C${l} ${spring - 104} ${l + 250} ${top + 62} ${mid} ${top}`,
    `C${r - 250} ${top + 62} ${r} ${spring - 104} ${r} ${spring}`,
    `V${base}`,
    "Z",
  ].join(" ");
}

export function MihrabCertificate(props: CertificateRenderProps) {
  const { content, recipientName, dateLabel, lang, courseTitle } = props;
  const ar = lang === "ar";
  const copy = CERT_COPY[lang];
  const accent = content.accentColor || "#8C2F39";
  const gold = "#B8892B";
  const ink = "#3B2A1E";
  const parchment = "#F7EFDD";
  const display = ar ? NASKH : SERIF;
  const sigs = signatures(content, lang);
  const logo = logoOf(props);
  const title = pick(content, "title", lang);
  const name = recipientName || copy.recipient;
  const meta = metaLine(props, sigs.length === 1);
  const latticeId = useSvgId("mihrab-lattice");
  const tile = 38;
  const c = tile / 2;

  const sigValue = { fontSize: 19, color: ink };
  const sigCaption = { fontSize: ar ? 14 : 12.5, color: accent };

  return (
    <div style={{ ...frameBox(lang, display), background: parchment, color: ink }}>
      <svg style={{ position: "absolute", inset: 0 }} width={CERT_WIDTH} height={CERT_HEIGHT} aria-hidden>
        <defs>
          <pattern id={latticeId} width={tile} height={tile} patternUnits="userSpaceOnUse">
            <rect width={tile} height={tile} fill="#EBDDBD" />
            <g fill="none" stroke={gold} strokeWidth={0.9} opacity={0.7}>
              <rect x={tile / 4} y={tile / 4} width={tile / 2} height={tile / 2} />
              <rect x={tile / 4} y={tile / 4} width={tile / 2} height={tile / 2} transform={`rotate(45 ${c} ${c})`} />
              <path d={`M0 ${c}h${tile / 4}M${tile * 0.75} ${c}h${tile / 4}M${c} 0v${tile / 4}M${c} ${tile * 0.75}v${tile / 4}`} />
            </g>
          </pattern>
        </defs>

        {/* Spandrels: the page minus the arch, filled with the khatam lattice. */}
        <path d={`M34 34 H${CERT_WIDTH - 34} V${CERT_HEIGHT - 34} H34 Z ${archPath(0)}`} fill={`url(#${latticeId})`} fillRule="evenodd" />

        <rect x={34} y={34} width={CERT_WIDTH - 68} height={CERT_HEIGHT - 68} fill="none" stroke={accent} strokeWidth={2.5} />
        <rect x={44} y={44} width={CERT_WIDTH - 88} height={CERT_HEIGHT - 88} fill="none" stroke={gold} strokeWidth={1} />
        <path d={archPath(0)} fill="none" stroke={accent} strokeWidth={3} />
        <path d={archPath(12)} fill="none" stroke={gold} strokeWidth={1.2} />
      </svg>

      {/* The keystone medallion crowns the arch — with the academy's logo when it has one. */}
      <div style={{ position: "absolute", top: 70 - 42, left: 561.5 - 42, width: 84, height: 84, borderRadius: "50%", background: parchment, border: `3px solid ${accent}`, boxShadow: `0 0 0 5px ${parchment}, 0 0 0 6px ${gold}`, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
        {logo ? (
          <LogoMark src={logo} size={70} frame={{ borderRadius: "50%" }} />
        ) : (
          <StarOctagram size={52} stroke={accent} fill={alpha(gold, 0.25)} strokeWidth={1.6} />
        )}
      </div>

      <div style={contentBand(138, 214, 228)}>
        <div style={{ fontSize: ar ? 20 : 15, letterSpacing: ar ? 0 : 4, color: accent, fontWeight: 700, textTransform: ar ? "none" : "uppercase" }}>
          {pick(content, "academyName", lang)}
        </div>

        <div style={{ marginTop: 12 }}>
          <DiamondRule color={gold} width={90} />
        </div>

        <div style={{ marginTop: 14, fontSize: fitText(title, ar ? 48 : 40, ar ? 22 : 26), lineHeight: 1.2, color: accent, fontWeight: 700 }}>
          {title}
        </div>

        <div style={{ marginTop: 16, fontSize: ar ? 22 : 17, color: ink, opacity: 0.8, fontStyle: ar ? "normal" : "italic" }}>
          {pick(content, "presentation", lang)}
        </div>

        <div style={{ marginTop: 6, fontSize: fitText(name, ar ? 56 : 50, 22), lineHeight: 1.25, color: ink, fontWeight: 700, whiteSpace: "nowrap", fontStyle: ar ? "normal" : "italic" }}>
          {name}
        </div>
        <div style={{ marginTop: 4 }}>
          <DiamondRule color={alpha(gold, 0.9)} width={170} />
        </div>

        {courseTitle && (
          <div style={{ marginTop: 12, fontSize: ar ? 22 : 18, fontWeight: 700, color: accent }}>
            {courseTitle}
          </div>
        )}

        <div style={{ marginTop: courseTitle ? 8 : 14, fontSize: ar ? 19 : 15.5, color: ink, opacity: 0.8, maxWidth: 620, ...clampLines(ar ? 19 : 15.5, 1.65, 3) }}>
          {pick(content, "body", lang)}
        </div>
      </div>

      <div style={{ position: "absolute", bottom: 104, left: 222, right: 222, display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        {sigs[1] ? (
          <SignatureBlock value={sigs[1].name} caption={sigs[1].title} width={200} rule={`1px solid ${gold}`} valueStyle={sigValue} captionStyle={sigCaption} />
        ) : (
          <SignatureBlock value={dateLabel} caption={copy.date} width={200} rule={`1px solid ${gold}`} valueStyle={{ ...sigValue, fontSize: 18 }} captionStyle={sigCaption} />
        )}

        {/* Wax seal. */}
        <div style={{ position: "relative", width: 86, height: 86, borderRadius: "50%", background: `radial-gradient(circle at 35% 30%, ${shade(accent, 0.3)}, ${accent} 60%, ${shade(accent, -0.35)})`, boxShadow: "0 3px 10px rgba(59,42,30,0.35)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ position: "absolute", inset: 7, borderRadius: "50%", border: `1.5px dashed ${alpha("#F3D9A4", 0.7)}` }} />
          <div style={{ position: "relative" }}>
            <StarOctagram size={46} stroke="#F3D9A4" strokeWidth={1.6} />
          </div>
        </div>

        <SignatureBlock value={sigs[0].name} caption={sigs[0].title} width={200} rule={`1px solid ${gold}`} valueStyle={sigValue} captionStyle={sigCaption} />
      </div>

      {meta && (
        <div style={{ position: "absolute", bottom: 80, left: 0, right: 0, textAlign: "center", fontSize: 11, color: accent, opacity: 0.75, letterSpacing: ar ? 0 : 1.2 }}>
          {meta}
        </div>
      )}
    </div>
  );
}
