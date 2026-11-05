/**
 * The drawing in a Quran academy's dashboard banner in the modern look (`modern_look`): an open
 * mushaf on its rehal, a mosque with its dome and two minarets, a hanging lantern, the crescent and a
 * khatam star, in the academy's navy and gold. The centre's banner has its laptop and cap
 * (`CentreHeroArt`); this is the same size, so the two banners share one layout. Inline SVG, so it
 * needs no asset and stays sharp on any screen.
 */
/** The small four-pointed stars around the drawing: x, y and size. */
const SPARKLES: readonly (readonly [number, number, number])[] = [
  [160, 70, 5],
  [420, 26, 4],
  [500, 150, 5],
  [228, 30, 3.5],
];

export function QuranHeroArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 520 250" fill="none" className={className} aria-hidden focusable="false" data-testid="quran-hero-art">
      <defs>
        <linearGradient id="qha-dome" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#5B7FB8" />
          <stop offset="1" stopColor="#24406E" />
        </linearGradient>
        <linearGradient id="qha-wall" x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#DDE5F0" />
        </linearGradient>
        <linearGradient id="qha-gold" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#F6D27A" />
          <stop offset="1" stopColor="#C99A2E" />
        </linearGradient>
        <linearGradient id="qha-wood" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#C8913F" />
          <stop offset="1" stopColor="#7E5020" />
        </linearGradient>
        <linearGradient id="qha-cover" x1="0" y1="0" x2="1" y2="0">
          <stop stopColor="#2F4F82" />
          <stop offset="1" stopColor="#1B2F55" />
        </linearGradient>
        <radialGradient id="qha-light" cx="0.5" cy="0.5" r="0.5">
          <stop stopColor="#FFF4CC" />
          <stop offset="1" stopColor="#F6C85A" />
        </radialGradient>
        <radialGradient id="qha-glow" cx="0.5" cy="0.5" r="0.5">
          <stop stopColor="#FFFFFF" stopOpacity="0.6" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
      </defs>

      <ellipse className="centre-art-glow" cx="270" cy="125" rx="240" ry="120" fill="url(#qha-glow)" />
      <ellipse cx="272" cy="230" rx="226" ry="12" fill="#24406E" opacity="0.16" />

      {/* The mosque: two minarets, the drum and its dome, the gate and two windows */}
      <g>
        {[180, 404].map((x) => (
          <g key={x}>
            <rect x={x} y="74" width="16" height="152" rx="3" fill="url(#qha-wall)" stroke="#CBD6E6" />
            <rect x={x - 4} y="112" width="24" height="7" rx="2" fill="url(#qha-gold)" />
            <rect x={x - 4} y="160" width="24" height="6" rx="2" fill="url(#qha-gold)" opacity="0.85" />
            <path d={`M${x - 2} 76 L${x + 8} 46 L${x + 18} 76 Z`} fill="url(#qha-dome)" />
            <path d={`M${x + 8} 46 V32`} stroke="#C99A2E" strokeWidth="2.5" strokeLinecap="round" />
            <circle cx={x + 8} cy="30" r="3" fill="#E9B949" />
          </g>
        ))}
        <rect x="204" y="132" width="192" height="94" rx="6" fill="url(#qha-wall)" stroke="#CBD6E6" />
        <rect x="204" y="132" width="192" height="7" rx="3" fill="url(#qha-gold)" />
        <rect x="244" y="112" width="112" height="22" rx="4" fill="url(#qha-wall)" stroke="#CBD6E6" />
        <path d="M238 116 C234 86 264 62 300 44 C336 62 366 86 362 116 Z" fill="url(#qha-dome)" />
        <path d="M262 74 C276 62 288 54 300 49" stroke="#FFFFFF" strokeOpacity="0.35" strokeWidth="5" strokeLinecap="round" />
        <path d="M300 44 V28" stroke="#C99A2E" strokeWidth="3" strokeLinecap="round" />
        <path d="M305 8 a10 10 0 1 0 0 18 a8 8 0 1 1 0 -18 z" fill="url(#qha-gold)" />
        <path d="M281 226 V188 a19 19 0 0 1 38 0 V226 Z" fill="url(#qha-cover)" />
        <path d="M300 172 V226" stroke="#F6D27A" strokeOpacity="0.5" strokeWidth="1.5" />
        {[226, 358].map((x) => (
          <path key={x} d={`M${x} 204 V184 a8 8 0 0 1 16 0 V204 Z`} fill="#3D5F96" opacity="0.85" />
        ))}
      </g>

      {/* The mushaf, open on its rehal */}
      <g>
        <path d="M58 228 L132 162 L144 170 L72 232 Z" fill="url(#qha-wood)" />
        <path d="M152 228 L78 162 L66 170 L138 232 Z" fill="url(#qha-wood)" />
        <path d="M40 160 Q76 142 105 162 Q134 142 170 160 L170 202 Q134 186 105 204 Q76 186 40 202 Z" fill="url(#qha-cover)" />
        <path d="M46 158 Q78 144 105 160 L105 196 Q78 182 46 194 Z" fill="#FFF9EA" />
        <path d="M105 160 Q132 144 164 158 L164 194 Q132 182 105 196 Z" fill="#FFF3D6" />
        <path d="M105 160 V196" stroke="#D9B46A" strokeWidth="1.5" />
        {[0, 1, 2, 3].map((i) => (
          <g key={i} stroke="#C9A85E" strokeWidth="1.6" strokeLinecap="round" opacity="0.8">
            <path d={`M56 ${166 + i * 7} Q76 ${159 + i * 7} 97 ${167 + i * 7}`} />
            <path d={`M113 ${167 + i * 7} Q134 ${159 + i * 7} 154 ${166 + i * 7}`} />
          </g>
        ))}
      </g>

      {/* The lantern, hanging over the mushaf */}
      <g>
        <path d="M100 0 V30" stroke="#C99A2E" strokeWidth="2" />
        <path d="M86 44 L100 28 L114 44 Z" fill="url(#qha-gold)" />
        <path d="M83 46 H117 L123 70 L117 96 H83 L77 70 Z" fill="url(#qha-light)" stroke="#C99A2E" strokeWidth="2.5" />
        <path d="M100 46 V96 M80 70 H120" stroke="#C99A2E" strokeWidth="1.5" opacity="0.7" />
        <path d="M87 96 H113 L100 110 Z" fill="url(#qha-gold)" />
      </g>

      {/* The crescent, a khatam star and a few small stars */}
      <path d="M482 28 a34 34 0 1 0 0 64 a27 27 0 1 1 0 -64 z" fill="url(#qha-gold)" />
      <g transform="translate(494 60) scale(0.8)">
        <rect x="-9" y="-9" width="18" height="18" rx="1.5" fill="url(#qha-gold)" />
        <rect x="-9" y="-9" width="18" height="18" rx="1.5" fill="url(#qha-gold)" transform="rotate(45)" />
        <circle r="4" fill="#FFF4CC" />
      </g>
      {SPARKLES.map(([x, y, r]) => (
        <path
          key={`${x}-${y}`}
          d={`M${x} ${y - r} L${x + r * 0.3} ${y - r * 0.3} L${x + r} ${y} L${x + r * 0.3} ${y + r * 0.3} L${x} ${y + r} L${x - r * 0.3} ${y + r * 0.3} L${x - r} ${y} L${x - r * 0.3} ${y - r * 0.3} Z`}
          fill="#E9B949"
        />
      ))}
    </svg>
  );
}
