"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { fieldClass } from "@/components/groups/group-format";
import { type Level, listLevels } from "@/lib/levels-api";
import { cn } from "@/lib/utils";
import { useLevelWord } from "@/lib/levels";

/**
 * The academy's levels as a dropdown (docs/centre-profile, Phase 2.1) — the one picker the student
 * form, the group form and the promotion share. Switched-off levels are hidden unless the value in
 * hand IS one (an old student keeps their level pickable). `withAddLink` points at Settings when
 * the list is still empty — a new centre has nothing to pick from until it writes its levels.
 */
export function LevelSelect({
  value,
  onChange,
  levels,
  withAddLink = false,
  noneLabel,
  className,
  testId = "level-select",
}: {
  value: string;
  onChange: (id: string) => void;
  /** Pass the list when the caller already has it; otherwise it is fetched once. */
  levels?: Level[];
  withAddLink?: boolean;
  /** The empty option's wording; the default says "no level". */
  noneLabel?: string;
  className?: string;
  testId?: string;
}) {
  const t = useTranslations("levels");
  const word = useLevelWord();
  const [loaded, setLoaded] = useState<Level[] | null>(levels ?? null);

  useEffect(() => {
    if (levels) {
      setLoaded(levels);
      return;
    }
    let live = true;
    void listLevels()
      .then((res) => live && setLoaded(res.levels))
      .catch(() => live && setLoaded([]));
    return () => {
      live = false;
    };
  }, [levels]);

  const options = (loaded ?? []).filter((l) => l.is_active || l.id === value);

  return (
    <div className="space-y-1">
      <select
        className={cn(fieldClass, className)}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={t("select.label", { word })}
        disabled={loaded === null}
        data-testid={testId}
      >
        <option value="">{loaded === null ? t("select.loading") : (noneLabel ?? t("select.none", { word }))}</option>
        {options.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
      {withAddLink && loaded !== null && loaded.length === 0 && (
        <Link href="/settings" className="text-primary inline-block text-xs underline-offset-2 hover:underline">
          {t("addLink", { word })}
        </Link>
      )}
    </div>
  );
}
