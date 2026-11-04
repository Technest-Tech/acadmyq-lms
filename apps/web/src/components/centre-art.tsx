/**
 * The drawing in a learning centre's dashboard banner (`centre-look.css`): the laptop, cap and books.
 * Inline SVG, so it needs no asset, stays sharp on any screen and costs a Quran academy nothing.
 */
export function CentreHeroArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 520 250" fill="none" className={className} aria-hidden focusable="false">
      <defs>
        <linearGradient id="cha-lid" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#3B2E86" />
          <stop offset="1" stopColor="#1F1658" />
        </linearGradient>
        <linearGradient id="cha-screen" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#A78BFA" />
          <stop offset="1" stopColor="#6D3FE0" />
        </linearGradient>
        <linearGradient id="cha-base" x1="0" y1="0" x2="1" y2="0">
          <stop stopColor="#F4F2FC" />
          <stop offset="1" stopColor="#C9C3E8" />
        </linearGradient>
        <linearGradient id="cha-cap" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#4B37B5" />
          <stop offset="1" stopColor="#1B1358" />
        </linearGradient>
        <linearGradient id="cha-book-a" x1="0" y1="0" x2="1" y2="0">
          <stop stopColor="#7C4DEB" />
          <stop offset="1" stopColor="#4326A8" />
        </linearGradient>
        <linearGradient id="cha-book-b" x1="0" y1="0" x2="1" y2="0">
          <stop stopColor="#8DB2FF" />
          <stop offset="1" stopColor="#4C74E6" />
        </linearGradient>
        <linearGradient id="cha-pot" x1="0" y1="0" x2="1" y2="0">
          <stop stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#D6D1EE" />
        </linearGradient>
        <linearGradient id="cha-leaf" x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#7BD8A6" />
          <stop offset="1" stopColor="#2F9E6E" />
        </linearGradient>
        <radialGradient id="cha-glow" cx="0.5" cy="0.5" r="0.5">
          <stop stopColor="#FFFFFF" stopOpacity="0.55" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
      </defs>

      <ellipse className="centre-art-glow" cx="250" cy="120" rx="230" ry="120" fill="url(#cha-glow)" />
      <ellipse cx="262" cy="228" rx="214" ry="13" fill="#4A2FB0" opacity="0.16" />

      {/* The plant */}
      <g>
        <path d="M78 150c-20-14-30-36-27-62 22 8 37 30 39 58z" fill="url(#cha-leaf)" />
        <path d="M84 148c-4-28 6-58 28-78 10 28 2 58-18 80z" fill="url(#cha-leaf)" />
        <path d="M92 152c10-22 30-36 56-38-6 24-28 40-54 42z" fill="url(#cha-leaf)" opacity="0.9" />
        <path d="M76 154c-18-4-34-16-42-36 22-2 40 12 48 32z" fill="url(#cha-leaf)" opacity="0.85" />
        <path d="M54 150h66l-8 68a10 10 0 0 1-10 9H72a10 10 0 0 1-10-9z" fill="url(#cha-pot)" />
        <path d="M50 146a4 4 0 0 1 4-4h66a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4H54a4 4 0 0 1-4-4z" fill="#FFFFFF" />
      </g>

      {/* The laptop */}
      <g>
        <path d="M172 60a14 14 0 0 1 14-13l190-8a14 14 0 0 1 15 13l9 148-235 6z" fill="url(#cha-lid)" />
        <path d="M184 66a8 8 0 0 1 8-8l176-7a8 8 0 0 1 8 8l8 132-208 5z" fill="url(#cha-screen)" />
        <path d="M184 66a8 8 0 0 1 8-8l176-7a8 8 0 0 1 3 .6L180 190z" fill="#FFFFFF" opacity="0.1" />
        <path d="M258 96c0-5 5-8 9-5l44 28c4 3 4 8 0 11l-44 27c-4 3-9 0-9-5z" fill="#FFFFFF" opacity="0.92" />
        <path d="M150 206l268-7 26 22a6 6 0 0 1-4 10l-306 8a6 6 0 0 1-5-10z" fill="url(#cha-base)" />
        <path d="M250 214l76-2 6 7a2 2 0 0 1-2 3l-84 2a2 2 0 0 1-1-3z" fill="#B5AEDB" />
      </g>

      {/* The graduation cap, resting on the lid */}
      <g>
        <path d="M340 60c0-3 2-5 5-5h62c3 0 5 2 5 5v22c-18 14-59 14-72 0z" fill="#17104A" />
        <path d="M374 4l74 34a3 3 0 0 1 0 5l-72 30a5 5 0 0 1-4 0l-72-32a3 3 0 0 1 0-5l70-32a5 5 0 0 1 4 0z" fill="url(#cha-cap)" />
        <path d="M376 38l54 12v32" stroke="#F2B23E" strokeWidth="3" strokeLinecap="round" />
        <path d="M424 82h12l3 26a3 3 0 0 1-3 3h-12a3 3 0 0 1-3-3z" fill="#F2B23E" />
        <circle cx="376" cy="38" r="4" fill="#F2B23E" />
      </g>

      {/* The books */}
      <g>
        <rect x="402" y="202" width="96" height="24" rx="5" fill="url(#cha-book-a)" />
        <rect x="412" y="207" width="86" height="14" fill="#F3F0FC" />
        <rect x="412" y="178" width="84" height="24" rx="5" fill="url(#cha-book-b)" />
        <rect x="420" y="183" width="76" height="14" fill="#FFFFFF" />
        <rect x="402" y="155" width="90" height="23" rx="5" fill="url(#cha-book-a)" />
        <rect x="412" y="160" width="80" height="13" fill="#F3F0FC" />
      </g>
    </svg>
  );
}
