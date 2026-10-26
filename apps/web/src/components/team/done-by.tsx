"use client";

import { UserCog } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import type { FilterDef } from "@/components/ui/data-table";
import { listTeamActors, type TeamActor } from "@/lib/api";

/**
 * "Done by" — which of the academy's logins did the thing a list row records (added the student,
 * booked the trial, marked the lesson). Every list that shows it shares the pieces below, so the
 * column and its filter read the same everywhere.
 */

/**
 * The academy's team logins; always empty for a teacher, who sees no "Done by" at all. A failed
 * read leaves it empty too — the column still shows names, only the filter stays hidden.
 */
export function useTeamActors(): TeamActor[] {
  return useTeamActorsState().actors;
}

/**
 * {@link useTeamActors} plus whether the read has settled (succeeded or failed), for a screen that
 * must not render one shape and then jump to another once the team is known.
 */
export function useTeamActorsState(): { actors: TeamActor[]; loaded: boolean } {
  const { session } = useAuth();
  const enabled = !!session && session.role !== "TEACHER";
  const [actors, setActors] = useState<TeamActor[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    listTeamActors()
      .then((r) => {
        if (live) setActors(r.actors);
      })
      .catch(() => {})
      .finally(() => {
        if (live) setLoaded(true);
      });
    return () => {
      live = false;
    };
  }, [enabled]);

  return enabled ? { actors, loaded } : { actors: [], loaded: true };
}

/** A switched-off login is still listed — their past work is theirs — but says so. */
export function actorLabel(actor: TeamActor, offLabel: string): string {
  return actor.is_active ? actor.name : `${actor.name} (${offLabel})`;
}

/**
 * The `added_by` filter for a server-driven list. Offered only once there are at least two people
 * to tell apart: an academy run by its owner alone has nothing to filter.
 */
export function addedByFilter(
  actors: TeamActor[],
  t: (key: "filter" | "off") => string,
): FilterDef[] {
  if (actors.length < 2) return [];
  return [
    {
      key: "added_by",
      label: t("filter"),
      options: actors.map((a) => ({ value: a.id, label: actorLabel(a, t("off")) })),
    },
  ];
}

/** The cell: the person's name, a dash when nobody is on record (imports, old rows, pending). */
export function DoneByCell({
  name,
  teacher,
}: {
  name: string | null | undefined;
  /** The lesson's own teacher did it — tagged so it never reads as a supervisor's work. */
  teacher?: boolean;
}) {
  const t = useTranslations("doneBy");
  if (!name) return <span className="text-muted-foreground/35">—</span>;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-xs" data-testid="done-by">
      <UserCog className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{name}</span>
      {teacher && (
        <span className="bg-muted text-muted-foreground shrink-0 rounded px-1.5 py-px text-[10px] font-medium">
          {t("teacher")}
        </span>
      )}
    </span>
  );
}
