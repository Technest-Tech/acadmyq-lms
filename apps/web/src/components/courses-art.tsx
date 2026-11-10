/**
 * The drawing in the modern dashboard's banner for an academy that teaches courses and curricula
 * rather than the Quran (`courses_art`, ticked per client by a Super Admin, 2026-11-10): a stack of
 * books under a graduation cap, a laptop playing a lesson, a certificate with its seal, a pencil, an
 * "ABC" card and a light bulb, in the same navy and gold as `QuranHeroArt` and the same size, so the
 * banner keeps one layout whichever picture it carries. Inline SVG: no asset, sharp on any screen.
 */
/** The drawing's colours: the theme's (`--art-*`, set by the courses palette in centre-look.css), else navy and gold. */
const INK_1 = "var(--art-ink-1, #3D5F96)";
const INK_2 = "var(--art-ink-2, #1B2F55)";
const SCREEN_1 = "var(--art-screen-1, #5B7FB8)";
const SCREEN_2 = "var(--art-screen-2, #24406E)";
const ACCENT_1 = "var(--art-accent-1, #F6D27A)";
const ACCENT_2 = "var(--art-accent-2, #C99A2E)";

/** The small four-pointed stars around the drawing: x, y and size. */
const SPARKLES: readonly (readonly [number, number, number])[] = [
  [150, 40, 5],
  [404, 22, 4],
  [508, 128, 5],
  [250, 18, 3.5],
];

export function CoursesHeroArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 520 250" fill="none" className={className} aria-hidden focusable="false" data-testid="courses-hero-art">
      <defs>
        <linearGradient id="cra-navy" x1="0" y1="0" x2="1" y2="1">
          <stop style={{ stopColor: INK_1 }} />
          <stop offset="1" style={{ stopColor: INK_2 }} />
        </linearGradient>
        <linearGradient id="cra-screen" x1="0" y1="0" x2="1" y2="1">
          <stop style={{ stopColor: SCREEN_1 }} />
          <stop offset="1" style={{ stopColor: SCREEN_2 }} />
        </linearGradient>
        <linearGradient id="cra-base" x1="0" y1="0" x2="1" y2="0">
          <stop stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#CBD6E6" />
        </linearGradient>
        <linearGradient id="cra-gold" x1="0" y1="0" x2="1" y2="1">
          <stop style={{ stopColor: ACCENT_1 }} />
          <stop offset="1" style={{ stopColor: ACCENT_2 }} />
        </linearGradient>
        <linearGradient id="cra-paper" x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#FFFCF3" />
          <stop offset="1" stopColor="#F3E7C8" />
        </linearGradient>
        <radialGradient id="cra-light" cx="0.5" cy="0.45" r="0.55">
          <stop stopColor="#FFF4CC" />
          <stop offset="1" stopColor="#F6C85A" />
        </radialGradient>
        <radialGradient id="cra-glow" cx="0.5" cy="0.5" r="0.5">
          <stop stopColor="#FFFFFF" stopOpacity="0.6" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
      </defs>

      <ellipse className="centre-art-glow" cx="270" cy="125" rx="240" ry="120" fill="url(#cra-glow)" />
      <ellipse cx="272" cy="230" rx="226" ry="12" opacity="0.16" style={{ fill: SCREEN_2 }} />

      {/* The laptop, playing a lesson: the video with its play button, the progress bar, the lesson list */}
      <g>
        <rect x="186" y="62" width="196" height="128" rx="10" fill="url(#cra-navy)" />
        <rect x="196" y="72" width="176" height="108" rx="5" fill="url(#cra-screen)" />
        <rect x="204" y="80" width="104" height="66" rx="4" opacity="0.55" style={{ fill: INK_2 }} />
        <circle cx="256" cy="113" r="17" fill="url(#cra-gold)" />
        <path d="M250 104 L266 113 L250 122 Z" style={{ fill: INK_2 }} />
        <rect x="204" y="154" width="104" height="5" rx="2.5" fill="#FFFFFF" opacity="0.25" />
        <rect x="204" y="154" width="62" height="5" rx="2.5" fill="url(#cra-gold)" />
        {[0, 1, 2, 3].map((i) => (
          <g key={i}>
            <rect x="316" y={82 + i * 18} width="9" height="9" rx="2" style={{ fill: i < 2 ? ACCENT_1 : "#FFFFFF" }} opacity={i < 2 ? 1 : 0.35} />
            <rect x="330" y={84 + i * 18} width={i % 2 === 0 ? 34 : 26} height="5" rx="2.5" fill="#FFFFFF" opacity="0.45" />
          </g>
        ))}
        <rect x="316" y="160" width="48" height="12" rx="6" fill="url(#cra-gold)" opacity="0.9" />
        <path d="M168 190 H400 L388 210 H180 Z" fill="url(#cra-base)" stroke="#CBD6E6" />
        <rect x="262" y="192" width="44" height="5" rx="2.5" fill="#B8C5DA" />
      </g>

      {/* The books, stacked, with the graduation cap on top */}
      <g>
        <rect x="34" y="200" width="122" height="26" rx="4" fill="url(#cra-navy)" />
        <rect x="34" y="200" width="122" height="5" rx="2" style={{ fill: SCREEN_1 }} />
        <rect x="146" y="203" width="6" height="20" rx="2" fill="url(#cra-paper)" />
        <rect x="44" y="176" width="108" height="24" rx="4" fill="url(#cra-gold)" />
        <rect x="142" y="179" width="6" height="18" rx="2" fill="url(#cra-paper)" />
        <rect x="58" y="186" width="44" height="4" rx="2" fill="#7E5020" opacity="0.45" />
        <rect x="38" y="154" width="112" height="22" rx="4" fill="#FFFFFF" stroke="#CBD6E6" />
        <rect x="40" y="156" width="10" height="18" rx="2" fill="url(#cra-screen)" />
        <rect x="60" y="163" width="52" height="4" rx="2" fill="#B8C5DA" />
        <path d="M94 104 L150 126 L94 148 L38 126 Z" fill="url(#cra-navy)" />
        <path d="M66 137 V152 C66 160 122 160 122 152 V137 L94 148 Z" style={{ fill: SCREEN_2 }} />
        <path d="M94 126 L138 136 V158" stroke="url(#cra-gold)" strokeWidth="2.5" strokeLinecap="round" fill="none" />
        <circle cx="94" cy="126" r="4" fill="url(#cra-gold)" />
        <path d="M134 158 L138 172 L142 158 Z" fill="url(#cra-gold)" />
      </g>

      {/* The certificate, with its gold seal and ribbons */}
      <g>
        <rect x="408" y="148" width="92" height="66" rx="5" fill="url(#cra-paper)" strokeWidth="2" style={{ stroke: ACCENT_1 }} />
        <rect x="414" y="154" width="80" height="54" rx="3" stroke="#E9CF8E" strokeWidth="1.2" fill="none" />
        <rect x="428" y="162" width="52" height="5" rx="2.5" opacity="0.7" style={{ fill: INK_1 }} />
        <rect x="422" y="174" width="44" height="3.5" rx="1.75" opacity="0.7" style={{ fill: ACCENT_2 }} />
        <rect x="422" y="182" width="36" height="3.5" rx="1.75" opacity="0.7" style={{ fill: ACCENT_2 }} />
        <path d="M472 196 L466 222 L474 216 L480 224 L484 198 Z" style={{ fill: INK_1 }} />
        <circle cx="477" cy="194" r="11" fill="url(#cra-gold)" />
        <circle cx="477" cy="194" r="6" fill="#FFF4CC" />
      </g>

      {/* The pencil, leaning on the certificate */}
      <g transform="rotate(-38 420 120)">
        <rect x="398" y="114" width="58" height="12" rx="2" fill="url(#cra-gold)" />
        <rect x="390" y="114" width="10" height="12" rx="2" style={{ fill: INK_1 }} />
        <path d="M456 114 L472 120 L456 126 Z" fill="#F3E7C8" />
        <path d="M466 118 L472 120 L466 122 Z" style={{ fill: INK_2 }} />
      </g>

      {/* The "ABC" card */}
      <g transform="rotate(-8 466 56)">
        <rect x="438" y="34" width="58" height="42" rx="6" fill="#FFFFFF" stroke="#CBD6E6" />
        <text x="467" y="63" textAnchor="middle" fontFamily="Georgia, 'Times New Roman', serif" fontSize="20" fontWeight="700" style={{ fill: SCREEN_2 }}>
          ABC
        </text>
      </g>

      {/* The light bulb, an idea over the books */}
      <g>
        <path d="M94 0 V16" strokeWidth="2" style={{ stroke: ACCENT_2 }} />
        <rect x="87" y="14" width="14" height="6" rx="2" style={{ fill: ACCENT_2 }} />
        <rect x="85" y="20" width="18" height="8" rx="2" fill="url(#cra-gold)" />
        <path d="M86 28 H102 L104 42 A20 20 0 1 1 84 42 Z" fill="url(#cra-light)" strokeWidth="2.5" strokeLinejoin="round" style={{ stroke: ACCENT_2 }} />
        <path d="M89 40 V48 L94 56 L99 48 V40" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" style={{ stroke: ACCENT_2 }} />
      </g>

      {SPARKLES.map(([x, y, r]) => (
        <path
          key={`${x}-${y}`}
          d={`M${x} ${y - r} L${x + r * 0.3} ${y - r * 0.3} L${x + r} ${y} L${x + r * 0.3} ${y + r * 0.3} L${x} ${y + r} L${x - r * 0.3} ${y + r * 0.3} L${x - r} ${y} L${x - r * 0.3} ${y - r * 0.3} Z`} style={{ fill: ACCENT_2 }}
         
        />
      ))}
    </svg>
  );
}
