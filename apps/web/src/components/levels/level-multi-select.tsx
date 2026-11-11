"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { type Level, listLevels } from "@/lib/levels-api";
import { useLevelWord } from "@/lib/levels";
import { cn } from "@/lib/utils";

/**
 * Several of the academy's levels at once, as chips — the levels a teacher takes (EnglishSpirit,
 * 2026-11-11). A level switched off in Settings is offered no more, but one already on the record
 * stays on it, shown, so saving never drops it behind the office's back.
 */
export function LevelMultiSelect({
  value,
  onChange,
  current = [],
  disabled = false,
  testId = "level-multi",
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  /** The levels already on the record, so a switched-off one still has a name to show. */
  current?: { id: string; name: string }[];
  disabled?: boolean;
  testId?: string;
}) {
  const t = useTranslations("levels");
  const word = useLevelWord();
  const [levels, setLevels] = useState<Level[] | null>(null);

  useEffect(() => {
    let live = true;
    void listLevels()
      .then((res) => live && setLevels(res.levels))
      .catch(() => live && setLevels([]));
    return () => {
      live = false;
    };
  }, []);

  if (levels === null) {
    return <p className="text-muted-foreground text-xs">{t("select.loading")}</p>;
  }

  const offered: { id: string; name: string }[] = levels.filter((l) => l.is_active || value.includes(l.id));
  for (const l of current) {
    if (value.includes(l.id) && !offered.some((o) => o.id === l.id)) offered.push(l);
  }

  if (offered.length === 0) {
    return (
      <Link href="/settings" className="text-primary inline-block text-xs underline-offset-2 hover:underline">
        {t("addLink", { word })}
      </Link>
    );
  }

  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("teacher.label", { word })} data-testid={testId}>
      {offered.map((l) => {
        const on = value.includes(l.id);
        return (
          <button
            key={l.id}
            type="button"
            onClick={() => toggle(l.id)}
            disabled={disabled}
            aria-pressed={on}
            data-testid={`${testId}-${l.id}`}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
              "disabled:cursor-not-allowed disabled:opacity-60",
              on
                ? "border-primary bg-primary/10 text-primary"
                : "border-input text-muted-foreground hover:bg-muted/40",
            )}
          >
            {on && <Check className="size-3" aria-hidden />}
            {l.name}
          </button>
        );
      })}
    </div>
  );
}

/** A teacher's levels as small read-only chips (the roster row, the profile hero). */
export function LevelChips({ levels, className }: { levels: { id: string; name: string }[]; className?: string }) {
  if (levels.length === 0) return null;
  return (
    <span className={cn("inline-flex flex-wrap gap-1", className)} data-testid="teacher-levels">
      {levels.map((l) => (
        <span
          key={l.id}
          className="bg-primary/8 text-primary rounded-full px-2 py-0.5 text-[11px] font-semibold"
        >
          {l.name}
        </span>
      ))}
    </span>
  );
}
