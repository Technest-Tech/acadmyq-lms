"use client";

import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { searchMatches } from "@/lib/search-fold";
import { cn } from "@/lib/utils";

/** Past this many groups a picker gets a search box (Lingo runs ~100). */
export const GROUP_SEARCH_FROM = 8;

/**
 * The groups a picker lists, narrowed by what was typed: the group's name or its teacher's,
 * Arabic-forgiving ("احمد" finds "أحمد"). The picker itself stays a plain select (phones show
 * their own list), only shorter — Lingo, 2026-11-15: "they are many and get mixed up".
 */
export function filterGroups<T extends { name: string; teacher_name?: string | null }>(groups: T[], query: string): T[] {
  const q = query.trim();
  if (!q) return groups;
  return groups.filter((g) => searchMatches(g.name, q) || searchMatches(g.teacher_name ?? "", q));
}

/** The search box above a group select; shown only when there are enough groups to need it. */
export function GroupSearchBox({
  count,
  value,
  onChange,
  testId,
  className,
}: {
  count: number;
  value: string;
  onChange: (v: string) => void;
  testId?: string;
  className?: string;
}) {
  const t = useTranslations("groups");
  if (count <= GROUP_SEARCH_FROM && !value) return null;
  return (
    <div className={cn("relative", className)}>
      <Search className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2" aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t("groupSearchPlaceholder")}
        aria-label={t("groupSearchPlaceholder")}
        className="border-input bg-background placeholder:text-muted-foreground focus:border-primary w-full rounded-xl border py-2 ps-9 pe-3 text-sm outline-none"
        data-testid={testId}
      />
    </div>
  );
}
