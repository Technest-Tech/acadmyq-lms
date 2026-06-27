/**
 * The AcademIQ lobby backdrop — deep slate with an emerald glow and a faint Islamic girih lattice,
 * the same brand language as the public invoice page. Keeps the call surface unmistakably ours
 * (the "Calm dark + AcademIQ signature" direction) without competing with the camera preview.
 */
export function BrandBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden bg-slate-950" aria-hidden>
      <div className="absolute -top-1/4 left-1/2 size-[120vmin] -translate-x-1/2 rounded-full bg-emerald-500/10 blur-[120px]" />
      <div className="absolute -bottom-1/3 -end-1/4 size-[80vmin] rounded-full bg-teal-500/10 blur-[120px]" />
      <svg className="absolute inset-0 size-full text-white/[0.025]">
        <defs>
          <pattern id="lobby-girih" width="64" height="64" patternUnits="userSpaceOnUse">
            <g fill="none" stroke="currentColor" strokeWidth="1.25">
              <rect x="15" y="15" width="34" height="34" />
              <rect x="15" y="15" width="34" height="34" transform="rotate(45 32 32)" />
              <circle cx="32" cy="32" r="5" />
            </g>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#lobby-girih)" />
      </svg>
    </div>
  );
}
