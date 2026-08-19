/**
 * Islamic geometric ornament for the client-facing surfaces — a client's own sign-in door
 * (docs/lms/02) and the panel chrome behind it.
 *
 * Every piece here is GEOMETRY and ARCHITECTURE — an eight-point *khatam* lattice, a pointed arch,
 * a small rosette — drawn in the two colours the design system already owns (emerald `--primary`,
 * gold `--gold`). Deliberately no religious text or calligraphy: these doors are wearing the
 * CLIENT's name, and a Qur'an academy, a language school and a coding academy all end up behind the
 * same component. Pattern and proportion read as warm and unmistakably Islamic to an Egyptian
 * academy without putting words in any client's mouth.
 *
 * Inline SVG rather than images: it inherits `currentColor`, costs no request, scales on any screen,
 * and stays crisp. All of it is decorative, so every node is `aria-hidden`.
 */

/**
 * The eight-point star lattice (khatam): two squares, one rotated 45°, plus the connectors that
 * carry the motif into the neighbouring tiles — the classic construction, so it tessellates
 * seamlessly at any size. `id` must be unique per instance: two <pattern> defs sharing an id on one
 * page would collide.
 */
export function KhatamLattice({
  id,
  size = 72,
  className,
}: {
  id: string;
  size?: number;
  className?: string;
}) {
  const c = size / 2;
  const inset = size / 4;
  const side = size / 2;

  return (
    <svg className={className} aria-hidden focusable="false">
      <defs>
        <pattern
          id={id}
          width={size}
          height={size}
          patternUnits="userSpaceOnUse"
        >
          <g fill="none" stroke="currentColor" strokeWidth="1">
            <rect x={inset} y={inset} width={side} height={side} />
            <rect
              x={inset}
              y={inset}
              width={side}
              height={side}
              transform={`rotate(45 ${c} ${c})`}
            />
            {/* Connectors to the four neighbouring stars. */}
            <path
              d={`M0 ${c}h${inset}M${size - inset} ${c}h${inset}M${c} 0v${inset}M${c} ${size - inset}v${inset}`}
            />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

/**
 * A pointed arch (mihrab) — the shape that says "this is a doorway" before any word is read. Sits
 * behind the client's logo: an emerald tint inside, a gold hairline for the edge.
 */
export function ArchPanel({ className }: { className?: string }) {
  const arch = "M12 200V104C12 54 46 14 80 6c34 8 68 48 68 98v96Z";

  return (
    <svg
      className={className}
      viewBox="0 0 160 200"
      preserveAspectRatio="none"
      aria-hidden
      focusable="false"
    >
      <defs>
        <linearGradient id="arch-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.14" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={arch} fill="url(#arch-fill)" />
      {/* The edge is GOLD, the niche inside emerald — the pairing the rest of the door uses. `--gold`
          is read straight from the `.client-door` palette, so the component needs no colour prop. */}
      <path
        d={arch}
        fill="none"
        stroke="var(--gold)"
        strokeOpacity="0.75"
        strokeWidth="1.25"
      />
      {/* The inner outline echoes the arch, the way a carved niche does. */}
      <path
        d="M28 200v-92c0-42 28-76 52-83 24 7 52 41 52 83v92"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.14"
        strokeWidth="1"
      />
    </svg>
  );
}

/**
 * The eight-point star itself (octagram), as a filled path: sixteen vertices alternating between an
 * outer and an inner radius. Drawn rather than approximated with two rotated squares, because at
 * 20px the squares' overlap muddies into a blob while a real star still reads as a star.
 */
function octagramPath(cx: number, cy: number, outer: number, inner: number): string {
  const points = Array.from({ length: 16 }, (_, i) => {
    const r = i % 2 === 0 ? outer : inner;
    const angle = (Math.PI / 8) * i - Math.PI / 2;
    return `${(cx + r * Math.cos(angle)).toFixed(2)} ${(cy + r * Math.sin(angle)).toFixed(2)}`;
  });

  return `M${points.join("L")}Z`;
}

/** The bare eight-point star, for use as a bullet or accent (`className` sets its size + colour). */
export function Octagram({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden focusable="false">
      <path d={octagramPath(12, 12, 11, 4.6)} fill="currentColor" />
    </svg>
  );
}

/**
 * A full-width gold rule with the star set into its middle — the manuscript-style opener the panel
 * puts above every page's content, so a screen begins the way the sign-in door ends.
 */
export function OrnateRule({ className }: { className?: string }) {
  return (
    <div
      className={`flex items-center gap-3 ${className ?? ""}`}
      aria-hidden
    >
      <span className="via-gold/45 h-px flex-1 bg-gradient-to-r from-transparent to-transparent" />
      <Octagram className="text-gold/70 size-2.5 shrink-0" />
      <span className="via-gold/45 h-px flex-1 bg-gradient-to-r from-transparent to-transparent" />
    </div>
  );
}

/** A small eight-point star flanked by tapering rules — the full stop under the greeting. */
export function StarDivider({ className }: { className?: string }) {
  return (
    <div
      className={`flex items-center justify-center gap-3 ${className ?? ""}`}
      aria-hidden
    >
      <span className="via-gold h-px w-14 bg-gradient-to-r from-transparent to-transparent" />
      <svg
        viewBox="0 0 24 24"
        className="text-gold size-5"
        aria-hidden
        focusable="false"
      >
        <path d={octagramPath(12, 12, 10.5, 4.4)} fill="currentColor" />
        <circle cx="12" cy="12" r="2" className="fill-white" />
      </svg>
      <span className="via-gold h-px w-14 bg-gradient-to-r from-transparent to-transparent" />
    </div>
  );
}
