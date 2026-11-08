/**
 * The drawing in the platform Super Admin's overview banner: a screen with the platform's numbers
 * rising on it, the client cards it serves on one side and the money coming in on the other, in the
 * modern look's navy and gold. The same frame as `QuranHeroArt` and `CentreHeroArt`, so the three
 * banners share one layout. Inline SVG, so it needs no asset and stays sharp on any screen.
 */
/** The small four-pointed stars around the drawing: x, y and size. */
const SPARKLES: readonly (readonly [number, number, number])[] = [
  [158, 36, 5],
  [446, 92, 4],
  [508, 150, 4.5],
  [236, 20, 3.5],
];

/** The rising bars on the screen: x and height, on a floor at y = 178. */
const BARS: readonly (readonly [number, number])[] = [
  [196, 34],
  [222, 52],
  [248, 70],
  [274, 92],
];

/** The client cards stacked on the left: x, y, width and the avatar's fill. */
const CARDS: readonly (readonly [number, number, number, string])[] = [
  [40, 68, 112, "url(#pha-navy)"],
  [26, 120, 126, "url(#pha-gold)"],
  [46, 174, 106, "#5B7FB8"],
];

export function PlatformHeroArt({ className }: { className?: string }) {
  const ring = 2 * Math.PI * 28;
  return (
    <svg viewBox="0 0 520 250" fill="none" className={className} aria-hidden focusable="false" data-testid="platform-hero-art">
      <defs>
        <linearGradient id="pha-navy" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#5B7FB8" />
          <stop offset="1" stopColor="#24406E" />
        </linearGradient>
        <linearGradient id="pha-frame" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#2F4F82" />
          <stop offset="1" stopColor="#1B2F55" />
        </linearGradient>
        <linearGradient id="pha-screen" x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#E6ECF5" />
        </linearGradient>
        <linearGradient id="pha-wall" x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#DDE5F0" />
        </linearGradient>
        <linearGradient id="pha-gold" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#F6D27A" />
          <stop offset="1" stopColor="#C99A2E" />
        </linearGradient>
        <linearGradient id="pha-gold-side" x1="0" y1="0" x2="1" y2="0">
          <stop stopColor="#D9AA3F" />
          <stop offset="1" stopColor="#A57C1F" />
        </linearGradient>
        <radialGradient id="pha-glow" cx="0.5" cy="0.5" r="0.5">
          <stop stopColor="#FFFFFF" stopOpacity="0.6" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
      </defs>

      <ellipse className="centre-art-glow" cx="270" cy="125" rx="240" ry="120" fill="url(#pha-glow)" />
      <ellipse cx="272" cy="232" rx="226" ry="12" fill="#24406E" opacity="0.16" />

      {/* The screen: a window bar, the bars and their gold line, a ring and two lines of text */}
      <g>
        <path d="M286 202 H318 L326 224 H278 Z" fill="url(#pha-wall)" stroke="#CBD6E6" />
        <rect x="256" y="221" width="92" height="9" rx="4.5" fill="url(#pha-frame)" />
        <rect x="168" y="34" width="268" height="170" rx="14" fill="url(#pha-frame)" />
        <rect x="180" y="46" width="244" height="146" rx="8" fill="url(#pha-screen)" />
        <path d="M188 46 H416 a8 8 0 0 1 8 8 V64 H180 V54 a8 8 0 0 1 8 -8 Z" fill="#E3EAF4" />
        <circle cx="193" cy="55" r="3" fill="#E9B949" />
        <circle cx="203" cy="55" r="3" fill="#9DB4D6" />
        <circle cx="213" cy="55" r="3" fill="#5B7FB8" />

        <path d="M190 178.5 H302" stroke="#CBD6E6" strokeWidth="1.5" strokeLinecap="round" />
        {BARS.map(([x, h]) => (
          <rect key={x} x={x} y={178 - h} width="18" height={h} rx="4" fill="url(#pha-navy)" />
        ))}
        <path
          d={BARS.map(([x, h], i) => `${i === 0 ? "M" : "L"}${x + 9} ${178 - h - 12}`).join(" ")}
          stroke="url(#pha-gold)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {BARS.map(([x, h]) => (
          <circle key={x} cx={x + 9} cy={178 - h - 12} r="4" fill="#FFFFFF" stroke="#C99A2E" strokeWidth="2" />
        ))}

        <circle cx="370" cy="110" r="28" stroke="#DDE5F0" strokeWidth="12" />
        <circle
          cx="370"
          cy="110"
          r="28"
          stroke="url(#pha-navy)"
          strokeWidth="12"
          strokeDasharray={`${ring * 0.58} ${ring}`}
          transform="rotate(-90 370 110)"
        />
        <circle
          cx="370"
          cy="110"
          r="28"
          stroke="#E9B949"
          strokeWidth="12"
          strokeDasharray={`${ring * 0.24} ${ring}`}
          strokeDashoffset={-ring * 0.6}
          transform="rotate(-90 370 110)"
        />
        <rect x="336" y="156" width="68" height="6" rx="3" fill="#C9D5E6" />
        <rect x="336" y="168" width="46" height="6" rx="3" fill="#DDE5F0" />
      </g>

      {/* The clients: three cards, one just signed */}
      <g>
        {CARDS.map(([x, y, w, avatar]) => (
          <g key={y}>
            <rect x={x} y={y} width={w} height="42" rx="11" fill="url(#pha-wall)" stroke="#CBD6E6" />
            <circle cx={x + 21} cy={y + 21} r="11" fill={avatar} />
            <rect x={x + 39} y={y + 13} width={w - 54} height="6" rx="3" fill="#24406E" opacity="0.75" />
            <rect x={x + 39} y={y + 25} width={(w - 54) * 0.6} height="5" rx="2.5" fill="#9DB4D6" />
          </g>
        ))}
        <circle cx="150" cy="122" r="10" fill="url(#pha-gold)" />
        <path d="M145.5 122 L148.8 125.3 L154.8 118.8" stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </g>

      {/* The money coming in: a stack of gold coins under a rising arrow */}
      <g>
        {[0, 1, 2, 3].map((i) => {
          const top = 212 - i * 12;
          return (
            <g key={i}>
              <path d={`M448 ${top} V${top + 10} a26 7 0 0 0 52 0 V${top}`} fill="url(#pha-gold-side)" />
              <ellipse cx="474" cy={top} rx="26" ry="7" fill="url(#pha-gold)" stroke="#C99A2E" />
            </g>
          );
        })}
        <circle cx="474" cy="132" r="18" fill="url(#pha-wall)" stroke="#CBD6E6" />
        <path d="M474 141 V123 M466 130 L474 122 L482 130" stroke="#24406E" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </g>

      {/* A khatam star and a few small stars */}
      <g transform="translate(484 46) scale(0.9)">
        <rect x="-9" y="-9" width="18" height="18" rx="1.5" fill="url(#pha-gold)" />
        <rect x="-9" y="-9" width="18" height="18" rx="1.5" fill="url(#pha-gold)" transform="rotate(45)" />
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
