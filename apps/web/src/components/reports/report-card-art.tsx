/**
 * The report card's illustration kit — the part a seven-year-old looks for.
 *
 * Everything here is inline SVG built from primitives (no external assets, no fonts, no filters), for
 * the same reason the ornaments are: `html2canvas-pro` serialises the node to an image, so anything
 * that reaches outside the tree comes out blank in the download.
 *
 * DELIBERATELY NON-FIGURATIVE. No faces, no people, no animals. These cards go home from Qur'an
 * academies whose families' views on depicting living beings vary, and a card that half the parents
 * feel they cannot put on the fridge has failed at the only job it has. So the vocabulary is objects
 * and places a child already loves — a lantern, a balloon, a medal, a growing seedling, domes and
 * stars — which carries the delight without ever putting the academy in an awkward position.
 *
 * Every piece takes its colours as props so the card's accent can run through the artwork instead of
 * fighting it.
 */

/** The playful secondary palette. Warm and bright, but few enough to stay coordinated. */
export const JOY = {
  gold: "#E9B949",
  goldDeep: "#C9A227",
  coral: "#EF8A6B",
  sky: "#6BB8E8",
  mint: "#6BCFA1",
  grape: "#A78BFA",
  cream: "#FFF7E4",
} as const;

/* ── Small parts ─────────────────────────────────────────────────────────── */

/** A five-point star. The kit's atom — used loose, in clusters, and inside the medal. */
export function Star({
  size,
  fill,
  opacity = 1,
  rotate = 0,
}: {
  size: number;
  fill: string;
  opacity?: number;
  rotate?: number;
}) {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 16 : 6.6;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    pts.push(`${(16 + r * Math.cos(a)).toFixed(2)},${(16 + r * Math.sin(a)).toFixed(2)}`);
  }
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" style={{ display: "block", opacity }} aria-hidden>
      <polygon points={pts.join(" ")} fill={fill} transform={`rotate(${rotate} 16 16)`} />
    </svg>
  );
}

/** A four-point sparkle — the "twinkle" that makes a flat shape feel alive. */
export function Sparkle({ size, fill, opacity = 1 }: { size: number; fill: string; opacity?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: "block", opacity }} aria-hidden>
      <path d="M12 0 C13.2 8.4 15.6 10.8 24 12 C15.6 13.2 13.2 15.6 12 24 C10.8 15.6 8.4 13.2 0 12 C8.4 10.8 10.8 8.4 12 0 Z" fill={fill} />
    </svg>
  );
}

/** A soft rounded cloud, built from overlapping circles on a bar. */
export function Cloud({ width, fill, opacity = 1 }: { width: number; fill: string; opacity?: number }) {
  return (
    <svg width={width} height={width * 0.6} viewBox="0 0 100 60" style={{ display: "block", opacity }} aria-hidden>
      <g fill={fill}>
        <circle cx={28} cy={34} r={18} />
        <circle cx={52} cy={26} r={22} />
        <circle cx={74} cy={36} r={16} />
        <rect x={20} y={38} width={62} height={16} rx={8} />
      </g>
    </svg>
  );
}

/* ── Set pieces ──────────────────────────────────────────────────────────── */

/**
 * A fanoos — the lantern Egyptian children grow up with. Glass panels lit from within, a domed cap
 * and a little finial, hung from a ring.
 */
export function Lantern({
  height,
  frame = JOY.gold,
  glass = JOY.cream,
  glow = "#FFD98A",
}: {
  height: number;
  frame?: string;
  glass?: string;
  glow?: string;
}) {
  return (
    <svg width={height * 0.52} height={height} viewBox="0 0 52 100" style={{ display: "block" }} aria-hidden>
      {/* hanger */}
      <path d="M26 2 a6 6 0 0 1 0 12" fill="none" stroke={frame} strokeWidth={3} strokeLinecap="round" />
      <path d="M26 13 L26 20" stroke={frame} strokeWidth={3} strokeLinecap="round" />
      {/* cap */}
      <path d="M10 30 L26 18 L42 30 Z" fill={frame} />
      <rect x={8} y={29} width={36} height={5} rx={2.5} fill={frame} />
      {/* body: the lit glass */}
      <path d="M12 35 L40 35 L37 76 L15 76 Z" fill={glass} />
      <path d="M12 35 L40 35 L38.6 54 L13.4 54 Z" fill={glow} opacity={0.75} />
      {/* frame ribs */}
      <path d="M12 35 L40 35 L37 76 L15 76 Z" fill="none" stroke={frame} strokeWidth={3} strokeLinejoin="round" />
      <path d="M26 35 L26 76 M18.6 35 L16.6 76 M33.4 35 L35.4 76" stroke={frame} strokeWidth={1.6} opacity={0.75} />
      {/* base + finial */}
      <rect x={11} y={75} width={30} height={6} rx={3} fill={frame} />
      <path d="M26 81 L26 90" stroke={frame} strokeWidth={3} strokeLinecap="round" />
      <circle cx={26} cy={94} r={4.5} fill={frame} />
    </svg>
  );
}

/**
 * An open mushaf with light rising off the page — the card's hero object. The rays are drawn as
 * tapered wedges rather than lines so they read as glow at a glance.
 */
export function MushafBurst({
  width,
  page = "#FFFDF5",
  cover,
  ray = "#F5D67F",
  ink = "#D9CBA6",
}: {
  width: number;
  page?: string;
  cover: string;
  ray?: string;
  ink?: string;
}) {
  const rays = [-58, -36, -14, 8, 30, 52];
  return (
    <svg width={width} height={width * 0.72} viewBox="0 0 200 144" style={{ display: "block" }} aria-hidden>
      {/* light */}
      <g opacity={0.6}>
        {rays.map((deg) => (
          <path key={deg} d="M100 62 L96 6 L104 6 Z" fill={ray} transform={`rotate(${deg} 100 62)`} opacity={0.75} />
        ))}
      </g>
      <circle cx={100} cy={62} r={20} fill={ray} opacity={0.35} />

      {/* pages */}
      <path d="M100 66 C84 54 60 52 26 56 L26 118 C60 114 84 116 100 128 Z" fill={page} />
      <path d="M100 66 C116 54 140 52 174 56 L174 118 C140 114 116 116 100 128 Z" fill={page} />
      {/* text lines */}
      <g stroke={ink} strokeWidth={3} strokeLinecap="round" opacity={0.85}>
        <path d="M40 72 L86 74 M40 84 L86 86 M40 96 L74 98" />
        <path d="M114 74 L160 72 M114 86 L160 84 M126 98 L160 96" />
      </g>
      {/* covers + spine */}
      <path d="M100 66 C84 54 60 52 26 56 L26 118 C60 114 84 116 100 128 Z" fill="none" stroke={cover} strokeWidth={5} strokeLinejoin="round" />
      <path d="M100 66 C116 54 140 52 174 56 L174 118 C140 114 116 116 100 128 Z" fill="none" stroke={cover} strokeWidth={5} strokeLinejoin="round" />
      <path d="M100 66 L100 128" stroke={cover} strokeWidth={5} strokeLinecap="round" />
    </svg>
  );
}

/**
 * An award rosette — the object that says "you did it" without a word of text.
 *
 * The ribbon hangs BELOW the disc, notched, and is wide enough to read at a glance. An earlier
 * version hung two narrow tails above it, which at card size looked like a pair of horns.
 */
export function Medal({
  size,
  ribbon = JOY.coral,
  disc = JOY.gold,
  discEdge = JOY.goldDeep,
  star = "#FFFDF5",
}: {
  size: number;
  ribbon?: string;
  disc?: string;
  discEdge?: string;
  star?: string;
}) {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 14 : 5.8;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    pts.push(`${(50 + r * Math.cos(a)).toFixed(2)},${(44 + r * Math.sin(a)).toFixed(2)}`);
  }
  return (
    <svg width={size} height={size * 1.2} viewBox="0 0 100 120" style={{ display: "block" }} aria-hidden>
      {/* Ribbon tails, notched, hanging behind the disc. */}
      <polygon points="34,58 19,116 33,105 45,116 46,58" fill={ribbon} />
      <polygon points="66,58 81,116 67,105 55,116 54,58" fill={ribbon} opacity={0.82} />
      {/* Scalloped rosette behind the disc. */}
      <g fill={discEdge} opacity={0.92}>
        {Array.from({ length: 12 }, (_, i) => {
          const a = (Math.PI / 6) * i;
          return <circle key={i} cx={50 + 27 * Math.cos(a)} cy={44 + 27 * Math.sin(a)} r={8.5} />;
        })}
      </g>
      <circle cx={50} cy={44} r={29} fill={disc} />
      <circle cx={50} cy={44} r={22.5} fill="none" stroke={discEdge} strokeWidth={2.4} opacity={0.7} />
      <polygon points={pts.join(" ")} fill={star} />
    </svg>
  );
}

/** A hot-air balloon — "look how far you've come", drawn as gores and a little basket. */
export function Balloon({
  height,
  a = JOY.coral,
  b = JOY.gold,
  basket = "#B98A4E",
}: {
  height: number;
  a?: string;
  b?: string;
  basket?: string;
}) {
  return (
    <svg width={height * 0.68} height={height} viewBox="0 0 68 100" style={{ display: "block" }} aria-hidden>
      <path d="M34 4 C54 4 64 22 64 38 C64 54 50 66 34 72 C18 66 4 54 4 38 C4 22 14 4 34 4 Z" fill={a} />
      <path d="M34 4 C42 4 46 22 46 38 C46 52 41 64 34 72 C27 64 22 52 22 38 C22 22 26 4 34 4 Z" fill={b} />
      <path d="M34 4 C36.5 12 37 24 37 38 C37 52 36 63 34 72 C32 63 31 52 31 38 C31 24 31.5 12 34 4 Z" fill={a} opacity={0.55} />
      {/* rigging */}
      <path d="M26 70 L29 82 M42 70 L39 82" stroke={basket} strokeWidth={2} strokeLinecap="round" />
      <rect x={26} y={81} width={16} height={13} rx={3} fill={basket} />
      <path d="M26 86 L42 86" stroke="#8E6A3B" strokeWidth={1.6} opacity={0.6} />
    </svg>
  );
}

/** A seedling — the academy's own metaphor, "we plant a love of the Qur'an", made literal. */
export function Seedling({
  size,
  leaf = JOY.mint,
  leafDeep = "#3F9E77",
  soil = "#C89B62",
}: {
  size: number;
  leaf?: string;
  leafDeep?: string;
  soil?: string;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" style={{ display: "block" }} aria-hidden>
      <path d="M32 52 L32 26" stroke={leafDeep} strokeWidth={3.4} strokeLinecap="round" />
      <path d="M32 34 C20 34 13 27 13 18 C24 18 32 25 32 34 Z" fill={leaf} />
      <path d="M32 30 C44 30 51 22 51 13 C40 13 32 21 32 30 Z" fill={leafDeep} />
      <path d="M14 52 C14 48 21 46 32 46 C43 46 50 48 50 52 Z" fill={soil} />
    </svg>
  );
}

/** Domes and minarets — a skyline band, used as a silhouette behind the footer. */
export function Skyline({ width, height, fill, opacity = 1 }: { width: number; height: number; fill: string; opacity?: number }) {
  return (
    <svg width={width} height={height} viewBox="0 0 400 60" preserveAspectRatio="none" style={{ display: "block", opacity }} aria-hidden>
      <g fill={fill}>
        {/* minaret left */}
        <rect x={38} y={14} width={9} height={46} />
        <path d="M42.5 2 L49 14 L36 14 Z" />
        {/* dome + hall */}
        <path d="M70 60 L70 40 C70 26 84 18 98 18 C112 18 126 26 126 40 L126 60 Z" />
        <rect x={64} y={44} width={68} height={16} />
        {/* central dome, taller */}
        <path d="M168 60 L168 36 C168 18 186 8 200 8 C214 8 232 18 232 36 L232 60 Z" />
        <path d="M200 0 L203 8 L197 8 Z" />
        <rect x={160} y={42} width={80} height={18} />
        {/* dome right */}
        <path d="M274 60 L274 40 C274 26 288 18 302 18 C316 18 330 26 330 40 L330 60 Z" />
        <rect x={268} y={44} width={68} height={16} />
        {/* minaret right */}
        <rect x={353} y={14} width={9} height={46} />
        <path d="M357.5 2 L364 14 L351 14 Z" />
      </g>
    </svg>
  );
}

/**
 * Scattered confetti across a band. Positions are a FIXED table, never random: a re-render that
 * moved the pieces would make the on-screen preview and the downloaded PNG two different images.
 */
const CONFETTI: Array<{ x: number; y: number; r: number; s: number; k: "star" | "dot" | "bar" }> = [
  { x: 6, y: 18, r: 14, s: 13, k: "star" },
  { x: 14, y: 62, r: -20, s: 7, k: "bar" },
  { x: 23, y: 12, r: 0, s: 7, k: "dot" },
  { x: 31, y: 74, r: 35, s: 11, k: "star" },
  { x: 44, y: 8, r: -12, s: 8, k: "bar" },
  { x: 57, y: 70, r: 0, s: 6, k: "dot" },
  { x: 68, y: 14, r: 22, s: 12, k: "star" },
  { x: 77, y: 58, r: 48, s: 8, k: "bar" },
  { x: 86, y: 22, r: 0, s: 7, k: "dot" },
  { x: 93, y: 66, r: -28, s: 12, k: "star" },
];

export function Confetti({
  width,
  height,
  colors,
  opacity = 1,
}: {
  width: number;
  height: number;
  colors: string[];
  opacity?: number;
}) {
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ position: "absolute", inset: 0, opacity, pointerEvents: "none" }}
      aria-hidden
    >
      {CONFETTI.map((c, i) => {
        const fill = colors[i % colors.length] ?? JOY.gold;
        const cx = (c.x / 100) * width;
        const cy = (c.y / 100) * height;
        if (c.k === "dot") return <circle key={i} cx={cx} cy={cy} r={c.s / 2} fill={fill} />;
        if (c.k === "bar") {
          return (
            <rect
              key={i}
              x={cx - c.s}
              y={cy - c.s / 3}
              width={c.s * 2}
              height={c.s * 0.66}
              rx={c.s / 3}
              fill={fill}
              transform={`rotate(${c.r} ${cx} ${cy})`}
            />
          );
        }
        const pts: string[] = [];
        for (let n = 0; n < 10; n++) {
          const rr = n % 2 === 0 ? c.s : c.s * 0.42;
          const a = (Math.PI / 5) * n - Math.PI / 2;
          pts.push(`${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`);
        }
        return <polygon key={i} points={pts.join(" ")} fill={fill} transform={`rotate(${c.r} ${cx} ${cy})`} />;
      })}
    </svg>
  );
}

/**
 * The little mark that sits beside a section heading. Sections are whatever the academy configured,
 * so there is nothing to map an icon to semantically — instead the kit cycles, which reads as
 * variety rather than as a wrong guess.
 */
export function SpotMark({ index, accent }: { index: number; accent: string }) {
  const cycle = index % 5;
  if (cycle === 0) return <Star size={26} fill={JOY.gold} />;
  if (cycle === 1) return <Seedling size={26} />;
  if (cycle === 2) return <Sparkle size={24} fill={JOY.sky} />;
  if (cycle === 3) return <Star size={26} fill={JOY.coral} rotate={18} />;
  return <Sparkle size={24} fill={accent} />;
}
