"use client";

import { ArrowUpRight, Layers } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { PromoteModal } from "@/components/levels/promote-modal";
import { Button } from "@/components/ui/button";
import { ProfileCard } from "@/components/ui/profile-card";
import { getLevelHistory, type LevelHistoryItem } from "@/lib/levels-api";
import { cn } from "@/lib/utils";

/**
 * The student page's level card (docs/centre-profile, Phase 2.1): where they stand, the "ترقية"
 * button, and the trail of every promotion — from which level and group to which, from when. A
 * centre's only; the page renders it behind `useCapability("centre")`, so a Quran academy's profile
 * never fetches it.
 */
export function LevelCard({
  studentId,
  studentName,
  onChanged,
}: {
  studentId: string;
  studentName: string;
  /** Called after a promotion so the page re-reads the student (their level badge up top). */
  onChanged?: () => void;
}) {
  const t = useTranslations("levels");
  const { can } = useAuth();
  const canPromote = can("student.update") && can("group.manage");
  const [levelId, setLevelId] = useState<string | null>(null);
  const [levelName, setLevelName] = useState<string | null>(null);
  const [history, setHistory] = useState<LevelHistoryItem[] | null>(null);
  const [promoting, setPromoting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await getLevelHistory(studentId);
      setLevelId(res.level_id);
      setLevelName(res.level_name);
      setHistory(res.history);
    } catch {
      setHistory([]);
    }
  }, [studentId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ProfileCard
      icon={Layers}
      title={t("history.title")}
      description={t("history.hint")}
      tone="violet"
      testId="level-card"
      action={
        canPromote ? (
          <Button type="button" size="sm" className="gap-1.5" onClick={() => setPromoting(true)} data-testid="promote-open">
            <ArrowUpRight className="size-3.5" />
            {t("promote.button")}
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-muted-foreground text-sm">{t("promote.current")}</span>
          <span
            className="inline-flex items-center gap-1.5 rounded-full bg-sky-100 px-2.5 py-0.5 text-sm font-semibold text-sky-700 dark:bg-sky-950/40 dark:text-sky-300"
            data-testid="level-current"
          >
            <Layers className="size-3.5" aria-hidden />
            {levelName ?? t("promote.noCurrent")}
          </span>
        </div>

        {notice && <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">{notice}</p>}

        {history === null ? null : history.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("history.empty")}</p>
        ) : (
          <ol className="relative space-y-4" data-testid="level-history">
            <span className="via-border absolute inset-y-1 start-[5px] w-px bg-gradient-to-b from-transparent to-transparent" aria-hidden />
            {history.map((h, index) => (
              <li key={h.id} className="relative flex items-start gap-3 ps-6">
                <span
                  className={cn("ring-card absolute start-0 top-1.5 size-2.5 rounded-full ring-4", index === 0 ? "bg-sky-500" : "bg-muted-foreground/40")}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-sm">
                    <span className="text-muted-foreground">{h.from_level_name ?? t("history.none")}</span>
                    <ArrowUpRight className="text-muted-foreground size-3.5 rtl:-scale-x-100" aria-hidden />
                    <span className="font-semibold">{h.to_level_name ?? t("history.none")}</span>
                  </div>
                  {(h.from_group_name || h.to_group_name) && (
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {t("history.group", { from: h.from_group_name ?? t("history.none"), to: h.to_group_name ?? t("history.none") })}
                    </p>
                  )}
                  {h.note && <p className="mt-0.5 text-xs">{h.note}</p>}
                  <p className="text-muted-foreground mt-0.5 text-xs tabular-nums">
                    {h.effective_on}
                    {h.changed_by_name ? ` · ${t("history.by", { name: h.changed_by_name })}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      <PromoteModal
        open={promoting}
        onClose={() => setPromoting(false)}
        studentId={studentId}
        studentName={studentName}
        currentLevelId={levelId}
        currentLevelName={levelName}
        onPromoted={({ promotion, history: fresh }) => {
          setLevelId(promotion.to_level_id);
          setLevelName(promotion.to_level_name);
          setHistory(fresh);
          setNotice(t("promote.done", { name: studentName, level: promotion.to_level_name ?? "" }));
          onChanged?.();
        }}
      />
    </ProfileCard>
  );
}
