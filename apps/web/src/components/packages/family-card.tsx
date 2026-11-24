"use client";

import { Children, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { LessonPackageRow } from "@/lib/api";
import { avatarTone, initials } from "@/lib/avatar";
import { cn } from "@/lib/utils";

/** One family on a packages page: a parent and their children's packages listed there. */
export interface DueFamily {
  /** The guardian's id — or the student's, for a row that carries no family. */
  key: string;
  /** Null for a row that carries no family — it can have no family link. */
  guardianId: string | null;
  name: string;
  phone: string | null;
  /** The children listed, in the order their packages first appear. */
  children: string[];
  rows: LessonPackageRow[];
}

/**
 * Gathers packages under their family, keeping the order they came in — each page sorts what needs a
 * hand first (Due: the oldest debt), so a family sits where its most pressing package would.
 */
export function groupDueByFamily(rows: LessonPackageRow[]): DueFamily[] {
  const families = new Map<string, DueFamily>();
  for (const row of rows) {
    const key = row.guardian_id ?? `student:${row.student_id}`;
    let family = families.get(key);
    if (family === undefined) {
      family = {
        key,
        guardianId: row.guardian_id ?? null,
        name: row.guardian_name ?? row.student_name,
        phone: row.guardian_phone ?? null,
        children: [],
        rows: [],
      };
      families.set(key, family);
    }
    family.rows.push(row);
    if (!family.children.includes(row.student_name)) family.children.push(row.student_name);
  }
  return [...families.values()];
}

/** What the family owes, per currency — money is never summed across currencies. */
export function owed(rows: LessonPackageRow[]): { currency: string; amount_minor: number }[] {
  const by = new Map<string, number>();
  for (const r of rows) {
    if (r.outstanding_minor > 0) by.set(r.currency, (by.get(r.currency) ?? 0) + r.outstanding_minor);
  }
  return [...by.entries()].map(([currency, amount_minor]) => ({ currency, amount_minor }));
}

/**
 * The family tile both packages pages share. Ahmed, 2026-11-23/24: the first cards were "too big, a
 * bigger family leaves holes, I can't tell them apart"; full-width cards then "take the whole page —
 * I have a lot of students". So: a small tile (about 300px), as many side by side as fit
 * ({@link FamilyColumns}), the family's colour down its side, a slim header (avatar, parent, a
 * figure), the page's own short rows, and the family's buttons in a slim footer only when it has any.
 */
export function FamilyCard({
  family,
  testId,
  nameTestId,
  aside,
  tools,
  notice,
  children,
}: {
  family: DueFamily;
  testId: string;
  nameTestId: string;
  /** The header's figure, at its end — e.g. what the family owes. */
  aside?: ReactNode;
  /** Buttons for the whole family, in a slim footer. */
  tools?: ReactNode;
  /** A line under the header, e.g. a link that failed. */
  notice?: ReactNode;
  /** The page's rows, as `<li>`s. */
  children: ReactNode;
}) {
  const t = useTranslations("packages");
  const names = family.children.join("، ");
  const who = [family.name, family.phone, t("family.children", { count: family.children.length, names })].filter(Boolean).join(" · ");

  return (
    <article className="bg-card relative min-w-0 overflow-hidden rounded-xl border shadow-sm" data-testid={testId}>
      {/* The family's colour down the side, the same as its avatar. */}
      <span className={cn("absolute inset-y-0 start-0 w-1", avatarTone(family.name))} aria-hidden />

      <header className="bg-muted/50 flex items-center gap-2 border-b py-1.5 ps-3.5 pe-2.5">
        <span
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white",
            avatarTone(family.name),
          )}
          aria-hidden
        >
          {initials(family.name)}
        </span>
        <h3 className="min-w-0 flex-1 truncate text-[13px] font-bold" data-testid={nameTestId} title={who}>
          {family.name}
        </h3>
        {aside}
      </header>
      {notice}

      <ul className="divide-border/60 divide-y">{children}</ul>

      {tools && <footer className="bg-muted/25 flex items-stretch gap-1.5 border-t py-1.5 ps-3.5 pe-2.5">{tools}</footer>}
    </article>
  );
}

/** A row inside a {@link FamilyCard}: the same padding and hover on both pages. */
export const FAMILY_ROW = "hover:bg-muted/25 space-y-1 py-2 ps-3.5 pe-2.5 transition-colors";

const TILE_MIN_PX = 300;
const TILE_GAP_PX = 12;
const MAX_COLUMNS = 4;

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * Family tiles side by side, as many columns as the page has room for, with no holes: each column
 * stacks its tiles tightly. Tiles are dealt in page order, each to the column that is shortest so
 * far (by `weights`, roughly a tile's height), so reading across a row still follows the page's
 * order — Due's oldest debt first — and a big family does not leave a gap beside a small one.
 */
export function FamilyColumns({
  weights,
  testId,
  children,
}: {
  /** One per child, in the same order: about how tall each tile is (e.g. its rows + header). */
  weights: number[];
  testId: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(1);

  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (el === null || typeof ResizeObserver === "undefined") return;
    const measure = () =>
      setColumns(Math.max(1, Math.min(MAX_COLUMNS, Math.floor((el.clientWidth + TILE_GAP_PX) / (TILE_MIN_PX + TILE_GAP_PX)))));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const items = Children.toArray(children);
  const stacks: ReactNode[][] = Array.from({ length: columns }, () => []);
  const heights = new Array<number>(columns).fill(0);
  items.forEach((item, i) => {
    let shortest = 0;
    for (let c = 1; c < columns; c++) if (heights[c]! < heights[shortest]!) shortest = c;
    stacks[shortest]!.push(item);
    heights[shortest]! += weights[i] ?? 1;
  });

  return (
    <div ref={ref} className="flex items-start gap-3" data-testid={testId}>
      {stacks.map((stack, c) => (
        <div key={c} className="flex min-w-0 flex-1 flex-col gap-3">
          {stack}
        </div>
      ))}
    </div>
  );
}

/** About how tall a family tile is, in rows: a header and a footer count as part of one. */
export function familyWeight(family: DueFamily, extra = 0): number {
  return 0.5 + family.rows.length + extra;
}
