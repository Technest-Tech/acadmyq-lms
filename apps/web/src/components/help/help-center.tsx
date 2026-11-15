"use client";

import { ArrowLeft, BookOpen, LifeBuoy, Search, SearchX } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useContext, useMemo, useState } from "react";
import { AuthContext } from "@/components/auth-provider";
import { useHelpContent, useHelpViewer } from "@/components/help/help-data";
import { useHelp } from "@/components/help/help-provider";
import { stepText, tasksFor, topicsFor } from "@/content/help/resolve";
import { HELP_TOPICS } from "@/content/help/topics";
import type { HelpGroup, HelpTopicDef } from "@/content/help/types";
import { foldForSearch } from "@/lib/search-fold";
import { cn } from "@/lib/utils";

const GROUPS: readonly HelpGroup[] = ["start", "people", "teaching", "money", "setup"];

/**
 * /help — every guide this person can use, on one page.
 *
 * Laid out by QUESTION, not by screen: each card is a page, and under it the things people come to
 * that page to do. Pressing a question opens the same drawer the header's "?" opens, on that
 * question. The search reads the questions and their steps, so "واتساب" finds the task that
 * mentions it even when the page is called something else. A teacher sees a teacher's handful of
 * guides, not the owner's thirty.
 */
export function HelpCenter() {
  const t = useTranslations("help");
  const viewer = useHelpViewer();
  const content = useHelpContent();
  const { openHelp } = useHelp();
  const isTeacher = useContext(AuthContext)?.session?.role === "TEACHER";
  const [query, setQuery] = useState("");

  const topics = useMemo(() => topicsFor(HELP_TOPICS, viewer), [viewer]);
  const needle = foldForSearch(query.trim());

  /** Each topic with the tasks left after the search; a topic whose own name matches keeps them all. */
  const shelves = useMemo(() => {
    const rows = topics
      .map((topic) => {
        const text = content?.[topic.id];
        const all = tasksFor(topic, viewer).filter((task) => text === undefined || text.tasks[task.id] !== undefined);
        if (needle === "" || text === undefined) return { topic, tasks: all };
        if (foldForSearch(`${text.title} ${text.summary}`).includes(needle)) return { topic, tasks: all };
        return {
          topic,
          tasks: all.filter((task) => {
            const taskText = text.tasks[task.id]!;
            return foldForSearch(`${taskText.title} ${taskText.steps.map(stepText).join(" ")}`).includes(needle);
          }),
        };
      })
      .filter((row) => row.tasks.length > 0);
    return GROUPS.map((group) => ({ group, rows: rows.filter((row) => row.topic.group === group) })).filter(
      (shelf) => shelf.rows.length > 0,
    );
  }, [topics, content, viewer, needle]);

  return (
    <div className="space-y-6" data-testid="help-center">
      {/* ── The band ─────────────────────────────────────────────────────── */}
      <header className="bg-card ring-foreground/[0.07] relative overflow-hidden rounded-3xl p-5 shadow-sm ring-1 sm:p-8">
        <span
          aria-hidden
          className="from-primary/[0.10] to-gold/[0.10] pointer-events-none absolute inset-0 bg-gradient-to-br via-transparent"
        />
        <LifeBuoy
          aria-hidden
          className="text-primary pointer-events-none absolute -end-8 -bottom-10 size-48 opacity-[0.06]"
        />
        <div className="relative mx-auto max-w-2xl text-center">
          <span className="bg-primary text-primary-foreground centre-button-primary mx-auto flex size-12 items-center justify-center rounded-2xl shadow-sm">
            <LifeBuoy className="size-6" aria-hidden />
          </span>
          <h1 className="mt-3 text-2xl font-extrabold tracking-tight sm:text-3xl">{t("center.title")}</h1>
          <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed sm:text-base">{t("center.subtitle")}</p>

          <label className="relative mt-5 block">
            <span className="sr-only">{t("center.search")}</span>
            <Search
              className="text-muted-foreground pointer-events-none absolute start-4 top-1/2 size-4.5 -translate-y-1/2"
              aria-hidden
            />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("center.search")}
              className="border-input bg-background focus:border-primary focus:ring-primary/20 h-12 w-full rounded-2xl border ps-11 pe-4 text-sm shadow-sm transition-colors outline-none focus:ring-2"
            />
          </label>
        </div>
      </header>

      {content === null ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" aria-hidden>
          {[0, 1, 2, 3, 4, 5].map((n) => (
            <div key={n} className="bg-muted/60 h-44 animate-pulse rounded-2xl" />
          ))}
        </div>
      ) : shelves.length === 0 ? (
        <div className="border-border/60 bg-muted/20 flex flex-col items-center rounded-2xl border border-dashed p-10 text-center">
          <span className="bg-muted text-muted-foreground mb-3 flex size-12 items-center justify-center rounded-full">
            <SearchX className="size-5" aria-hidden />
          </span>
          <p className="text-sm font-bold">{t("center.noResults")}</p>
          <p className="text-muted-foreground mt-1 text-sm">{t("center.noResultsHint")}</p>
        </div>
      ) : (
        shelves.map((shelf) => (
          <section key={shelf.group} aria-labelledby={`help-group-${shelf.group}`}>
            <h2 id={`help-group-${shelf.group}`} className="text-muted-foreground mb-3 px-1 text-xs font-bold tracking-wide">
              {t(`groups.${shelf.group}`)}
            </h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {shelf.rows.map(({ topic, tasks }) => (
                <TopicCard
                  key={topic.id}
                  topic={topic}
                  title={content[topic.id]?.title ?? topic.id}
                  summary={content[topic.id]?.summary ?? ""}
                  tasks={tasks.map((task) => ({ id: task.id, title: content[topic.id]!.tasks[task.id]!.title }))}
                  onOpen={(taskId) => openHelp(topic.id, taskId)}
                  openLabel={t("openPage")}
                />
              ))}
            </div>
          </section>
        ))
      )}

      {/* The long-form teacher guide predates this page and still reads well start to finish. */}
      {isTeacher && (
        <Link
          href="/docs/teacher-guide"
          className="bg-card ring-foreground/[0.07] hover:ring-primary/40 flex items-center gap-3.5 rounded-2xl p-4 shadow-sm ring-1 transition-shadow"
        >
          <span className="bg-gold/15 text-gold flex size-11 shrink-0 items-center justify-center rounded-xl">
            <BookOpen className="size-5" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold">{t("center.teacherGuide")}</span>
            <span className="text-muted-foreground mt-0.5 block text-xs">{t("center.teacherGuideHint")}</span>
          </span>
          <ArrowLeft className="text-muted-foreground size-4 shrink-0 ltr:rotate-180" aria-hidden />
        </Link>
      )}
    </div>
  );
}

function TopicCard({
  topic,
  title,
  summary,
  tasks,
  onOpen,
  openLabel,
}: {
  topic: HelpTopicDef;
  title: string;
  summary: string;
  tasks: Array<{ id: string; title: string }>;
  onOpen: (taskId?: string) => void;
  openLabel: string;
}) {
  const Icon = topic.icon;
  return (
    <article
      data-topic={topic.id}
      className="bg-card ring-foreground/[0.07] flex flex-col overflow-hidden rounded-2xl shadow-sm ring-1"
    >
      <button
        type="button"
        onClick={() => onOpen()}
        className="hover:bg-muted/40 focus-visible:ring-ring/60 flex items-start gap-3 p-4 text-start transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset"
      >
        <span className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-xl">
          <Icon className="size-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-base leading-tight font-extrabold">{title}</span>
          <span className="text-muted-foreground mt-1 line-clamp-2 block text-xs leading-relaxed">{summary}</span>
        </span>
      </button>
      <ul className="border-border/60 flex-1 border-t p-2">
        {tasks.map((task) => (
          <li key={task.id}>
            <button
              type="button"
              onClick={() => onOpen(task.id)}
              className={cn(
                "group hover:bg-primary/[0.06] focus-visible:ring-ring/60 flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-start text-[13px] leading-snug font-semibold transition-colors outline-none focus-visible:ring-2",
              )}
            >
              <span className="bg-primary/40 group-hover:bg-primary size-1.5 shrink-0 rounded-full transition-colors" aria-hidden />
              <span className="min-w-0 flex-1">{task.title}</span>
            </button>
          </li>
        ))}
      </ul>
      <Link
        href={topic.href}
        className="text-primary hover:bg-primary/[0.06] border-border/60 flex items-center justify-between gap-2 border-t px-4 py-2.5 text-xs font-bold transition-colors"
      >
        {openLabel}
        <ArrowLeft className="size-3.5 ltr:rotate-180" aria-hidden />
      </Link>
    </article>
  );
}
