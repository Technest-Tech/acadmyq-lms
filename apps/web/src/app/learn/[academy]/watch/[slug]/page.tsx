"use client";

import { CheckCircle2, ChevronLeft, Circle } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  learnPlayer,
  learnSaveProgress,
  LearnApiError,
  type LearnLesson,
  type LearnProgress,
} from "@/lib/learn-api";
import { cn } from "@/lib/utils";
import { LessonContent } from "../../lesson-content";
import { useLearn } from "../../learn-provider";

type PlayerData = Awaited<ReturnType<typeof learnPlayer>>;

export default function WatchPage() {
  const t = useTranslations("learn");
  const { academy, requireAuth, openRedeem } = useLearn();
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  const [data, setData] = useState<PlayerData | null>(null);
  const [progress, setProgress] = useState<Record<string, LearnProgress>>({});
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "auth" | "locked" | "error">("loading");

  const load = useCallback(() => {
    setState("loading");
    learnPlayer(academy, slug)
      .then((d) => {
        setData(d);
        setProgress(d.progress ?? {});
        const flat = d.sections.flatMap((s) => s.lessons);
        const firstIncomplete = flat.find((l) => d.progress?.[l.id]?.status !== "COMPLETED");
        setCurrentId((firstIncomplete ?? flat[0])?.id ?? null);
        setState("ready");
      })
      .catch((e) => {
        if (e instanceof LearnApiError && e.status === 401) setState("auth");
        else if (e instanceof LearnApiError && e.status === 403) setState("locked");
        else setState("error");
      });
  }, [academy, slug]);

  useEffect(() => {
    load();
  }, [load]);

  const lessons = useMemo(() => data?.sections.flatMap((s) => s.lessons) ?? [], [data]);
  const current: LearnLesson | undefined = useMemo(
    () => lessons.find((l) => l.id === currentId),
    [lessons, currentId],
  );
  const completedCount = useMemo(
    () => lessons.filter((l) => progress[l.id]?.status === "COMPLETED").length,
    [lessons, progress],
  );

  async function markComplete() {
    if (!current) return;
    try {
      await learnSaveProgress(academy, current.id, { completed: true });
      setProgress((p) => ({ ...p, [current.id]: { status: "COMPLETED", position_seconds: 0, completed_at: null } }));
      const idx = lessons.findIndex((l) => l.id === current.id);
      const next = idx >= 0 ? lessons[idx + 1] : undefined;
      if (next) setCurrentId(next.id);
    } catch {
      /* keep the UI responsive; a failed save just leaves it un-ticked */
    }
  }

  if (state === "loading") return <p className="text-muted-foreground py-16 text-center text-sm">…</p>;

  if (state === "auth") {
    return (
      <Prompt message={t("player.signInNeeded")} action={t("auth.signIn")} onClick={() => requireAuth(load)} />
    );
  }
  if (state === "locked") {
    return <Prompt message={t("player.notEnrolled")} action={t("course.enroll")} onClick={openRedeem} academy={academy} slug={slug} />;
  }
  if (state === "error" || !data) {
    return <p className="text-muted-foreground py-16 text-center text-sm">{t("errors.generic")}</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Link
          href={`/learn/${academy}/c/${slug}`}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ChevronLeft className="size-4" /> {data.course.title}
        </Link>
        <span className="text-muted-foreground text-xs tabular-nums">
          {t("player.progress", { done: completedCount, total: lessons.length })}
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <div className="space-y-4">
          {current ? (
            <>
              <h1 className="text-lg font-semibold">{current.title}</h1>
              <LessonContent lesson={current} academy={academy} />
              <div className="flex justify-end">
                <Button
                  variant={progress[current.id]?.status === "COMPLETED" ? "outline" : "default"}
                  onClick={markComplete}
                >
                  <CheckCircle2 />
                  {progress[current.id]?.status === "COMPLETED" ? t("player.completed") : t("player.markComplete")}
                </Button>
              </div>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">{t("player.empty")}</p>
          )}
        </div>

        <aside className="space-y-4">
          {data.sections.map((section) => (
            <div key={section.id}>
              <p className="text-muted-foreground mb-1 text-xs font-medium uppercase">{section.title}</p>
              <ul className="space-y-0.5">
                {section.lessons.map((lesson) => {
                  const done = progress[lesson.id]?.status === "COMPLETED";
                  return (
                    <li key={lesson.id}>
                      <button
                        type="button"
                        onClick={() => setCurrentId(lesson.id)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-sm transition-colors",
                          lesson.id === currentId ? "bg-muted font-medium" : "hover:bg-muted/50",
                        )}
                      >
                        {done ? (
                          <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                        ) : (
                          <Circle className="size-4 shrink-0 opacity-30" />
                        )}
                        <span className="truncate">{lesson.title}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}

function Prompt({
  message,
  action,
  onClick,
  academy,
  slug,
}: {
  message: string;
  action: string;
  onClick: () => void;
  academy?: string;
  slug?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-4 py-20 text-center">
      <p className="text-muted-foreground text-sm">{message}</p>
      <Button onClick={onClick}>{action}</Button>
      {academy && slug && (
        <Link href={`/learn/${academy}/c/${slug}`} className="text-muted-foreground text-xs hover:underline">
          ←
        </Link>
      )}
    </div>
  );
}
