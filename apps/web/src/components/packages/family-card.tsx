"use client";

import type { ReactNode } from "react";
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
 * The family card both packages pages share (Ahmed 2026-11-23: Due as cards, then Open "the same").
 * Full width, one under the other, so a short card never leaves a hole beside it; the family's colour
 * down the side and a tinted one-line header (parent, children, a figure, the family's buttons), so
 * one card never runs into the next. The rows are the page's own.
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
  /** Buttons for the whole family; under the header's text on a phone. */
  tools?: ReactNode;
  /** A line under the header, e.g. a link that failed. */
  notice?: ReactNode;
  /** The page's rows, as `<li>`s. */
  children: ReactNode;
}) {
  const t = useTranslations("packages");
  const names = family.children.join("، ");

  return (
    <article className="bg-card relative min-w-0 overflow-hidden rounded-xl border shadow-sm" data-testid={testId}>
      {/* The family's colour down the side, the same as its avatar. */}
      <span className={cn("absolute inset-y-0 start-0 w-1", avatarTone(family.name))} aria-hidden />

      <header className="bg-muted/50 flex flex-wrap items-center gap-x-3 gap-y-2 border-b py-2 ps-4 pe-3">
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white",
            avatarTone(family.name),
          )}
          aria-hidden
        >
          {initials(family.name)}
        </span>
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <h3
            className="max-w-full shrink-0 truncate text-sm font-bold sm:max-w-[60%]"
            data-testid={nameTestId}
            title={family.phone ? `${family.name} · ${family.phone}` : family.name}
          >
            {family.name}
          </h3>
          <p className="text-muted-foreground hidden min-w-0 truncate text-xs sm:block" title={names}>
            {t("family.children", { count: family.children.length, names })}
          </p>
        </div>
        {aside}
        {tools && <div className="flex w-full shrink-0 items-stretch gap-1.5 sm:w-auto">{tools}</div>}
      </header>
      {notice}

      <ul className="divide-border/60 divide-y">{children}</ul>
    </article>
  );
}

/** A row inside a {@link FamilyCard}: the same padding and hover on both pages. */
export const FAMILY_ROW = "hover:bg-muted/25 py-2.5 ps-4 pe-3 transition-colors";
