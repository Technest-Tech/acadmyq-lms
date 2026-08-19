"use client";

import type { ComponentType, ReactNode } from "react";
import { KhatamLattice, Octagram } from "@/components/ornaments";
import { cn } from "@/lib/utils";

/**
 * The band every management screen opens on: deep emerald into teal under a khatam lattice, lit
 * by gold — the same language as the client's own sign-in door and the dashboard, so a list, a
 * profile and the dashboard read as pages of one book rather than three products.
 *
 * It replaced a bare `<h1>` on grey canvas, repeated screen by screen with slightly different
 * spacing each time. One component means the ornament, the gradient and the proportions are
 * defined once; a new screen cannot drift.
 *
 * Pass `avatarName` for a record's own page (the initials tile) or `icon` for a list.
 */
export function PageHero({
  icon: Icon,
  avatarName,
  title,
  subtitle,
  badges,
  actions,
  latticeId,
}: {
  icon?: ComponentType<{ className?: string }>;
  /** A person's name — renders their initials instead of an icon, with the gold star. */
  avatarName?: string;
  title: string;
  subtitle?: string;
  /** Status pills, rendered under the title. */
  badges?: ReactNode;
  /** End-side controls: a count pill, the primary action. */
  actions?: ReactNode;
  /** Must be unique per rendered hero — two <pattern> defs sharing an id would collide. */
  latticeId: string;
}) {
  return (
    <header
      className="relative overflow-hidden rounded-2xl border border-transparent p-5 text-white shadow-lg sm:p-6"
      style={{
        background:
          "linear-gradient(135deg, oklch(0.30 0.065 163) 0%, oklch(0.38 0.105 168) 48%, oklch(0.32 0.085 196) 100%)",
      }}
    >
      <KhatamLattice
        id={latticeId}
        size={64}
        className="pointer-events-none absolute inset-0 h-full w-full text-white opacity-[0.16]"
      />
      <div className="pointer-events-none absolute -end-12 -top-16 size-56 rounded-full bg-white/15 blur-3xl" />
      <div
        className="pointer-events-none absolute -bottom-24 start-1/4 size-48 rounded-full blur-3xl"
        style={{ background: "oklch(0.835 0.118 85 / 0.30)" }}
      />
      {Icon && (
        <div className="pointer-events-none absolute -end-6 bottom-0 opacity-10">
          <Icon className="size-40" aria-hidden />
        </div>
      )}

      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          {avatarName !== undefined ? (
            <HeroAvatar name={avatarName} />
          ) : (
            Icon && (
              <div className="ring-gold/40 flex size-12 shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 backdrop-blur-sm">
                <Icon className="size-6" aria-hidden />
              </div>
            )
          )}
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold leading-tight tracking-tight drop-shadow-sm">
              {title}
            </h1>
            {subtitle && <p className="mt-0.5 text-sm text-white/85">{subtitle}</p>}
            {badges && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">{badges}</div>
            )}
          </div>
        </div>

        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
    </header>
  );
}

function HeroAvatar({ name }: { name: string }) {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();

  return (
    <div className="relative shrink-0">
      <div className="ring-gold/45 flex size-16 items-center justify-center rounded-2xl bg-white/15 text-xl font-bold ring-1 backdrop-blur-sm">
        {initials}
      </div>
      <Octagram className="text-gold absolute -bottom-1 -end-1 size-4 drop-shadow" />
    </div>
  );
}

/** A pill for the hero: `gold` for the one fact that should stop the eye, plain for the rest. */
export function HeroBadge({
  tone = "plain",
  children,
}: {
  tone?: "plain" | "gold";
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium backdrop-blur-sm",
        tone === "gold"
          ? "border-gold/50 bg-gold text-gold-foreground font-bold"
          : "border-white/25 bg-white/15 text-white",
      )}
    >
      {children}
    </span>
  );
}

/** The larger end-side pill — a count, a live indicator. */
export function HeroPill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/15 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-sm">
      {children}
    </span>
  );
}
