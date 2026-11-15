"use client";

import { ArrowLeft, ChevronDown, Compass, LifeBuoy, Lightbulb, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useHelpContent, useHelpVideos, useHelpViewer } from "@/components/help/help-data";
import { HelpVideoCard } from "@/components/help/help-video";
import { stepParts, taskSlot, tasksFor } from "@/content/help/resolve";
import { HELP_TOPICS } from "@/content/help/topics";
import type { HelpTaskText } from "@/content/help/types";
import type { HelpVideo } from "@/lib/help-api";
import { cn } from "@/lib/utils";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * The help for one page: what the page is for, a one-minute video, then the page's tasks as
 * questions ("How do I add a student?") that open into numbered steps.
 *
 * A side sheet from `sm` up — the page stays visible beside it, so a person can read a step and see
 * the button it names — and a bottom sheet on a phone, like every other dialog in the app. Only the
 * tasks the signed-in person can actually do are listed: a teacher never reads the office's steps.
 */
export function HelpDrawer({
  open,
  topicId,
  taskId,
  onPage,
  onClose,
}: {
  open: boolean;
  /** `null` = the page being looked at has no help written yet. */
  topicId: string | null;
  /** A task to open on, when the help was asked for one. */
  taskId: string | null;
  /** Is this the help of the page already on screen? (Otherwise it offers to take the person there.) */
  onPage: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("help");
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const viewer = useHelpViewer();
  const content = useHelpContent(open);
  const { videos } = useHelpVideos(open);

  const topic = topicId === null ? null : (HELP_TOPICS.find((item) => item.id === topicId) ?? null);
  const tasks = topic === null ? [] : tasksFor(topic, viewer);
  const text = topic === null ? null : (content?.[topic.id] ?? null);

  // Which question is open. The one that was asked for; else the first, so the sheet never opens
  // on a wall of closed rows.
  const [expanded, setExpanded] = useState<string | null>(null);
  const firstTaskId = tasks[0]?.id ?? null;
  useEffect(() => {
    if (open) setExpanded(taskId ?? firstTaskId);
  }, [open, topicId, taskId, firstTaskId]);

  // The latest onClose, read by the key handler: callers pass a fresh arrow each render, and an
  // effect that depended on it would re-run — and re-focus the close button — on every one.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const node = panelRef.current;
    node?.focus();

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || node === null) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === node)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      previous?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  const Icon = topic?.icon ?? LifeBuoy;

  return createPortal(
    <div className="contents" data-testid="help-drawer">
      <div
        className="animate-in fade-in fixed inset-0 z-50 bg-black/35 duration-150"
        aria-hidden
        onClick={onClose}
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          "bg-card ring-foreground/[0.08] fixed z-50 flex flex-col shadow-2xl ring-1 outline-none",
          "animate-in fade-in-0 duration-200",
          // A phone: a sheet docked to the thumb's edge, the page still peeking above it.
          "slide-in-from-bottom-8 inset-x-0 bottom-0 max-h-[88dvh] rounded-t-3xl",
          // From `sm`: a column down the end side, full height.
          "sm:slide-in-from-bottom-0 sm:slide-in-from-end-10 sm:inset-x-auto sm:inset-y-0 sm:end-0 sm:max-h-none sm:w-[27rem] sm:rounded-none sm:rounded-s-3xl",
        )}
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header className="border-border/70 relative shrink-0 overflow-hidden border-b px-4 pt-4 pb-4 sm:px-5 sm:pt-5">
          <span
            aria-hidden
            className="from-primary/[0.09] via-primary/[0.03] pointer-events-none absolute inset-0 bg-gradient-to-b to-transparent"
          />
          <div className="relative flex items-start gap-3">
            <span className="bg-primary text-primary-foreground centre-button-primary flex size-11 shrink-0 items-center justify-center rounded-2xl shadow-sm">
              <Icon className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-primary text-[11px] font-bold tracking-wide">{t("eyebrow")}</p>
              <h2 id={titleId} className="mt-0.5 text-lg leading-tight font-extrabold">
                {topic === null ? t("noTopic.title") : (text?.title ?? "…")}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("close")}
              className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring/60 -me-1 shrink-0 rounded-xl p-2 transition-colors outline-none focus-visible:ring-2"
            >
              <X className="size-4.5" aria-hidden />
            </button>
          </div>
        </header>

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <div className="scroll-ornate min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
          {topic === null ? (
            <div className="flex flex-col items-center px-2 py-8 text-center">
              <span className="bg-muted text-muted-foreground mb-4 flex size-14 items-center justify-center rounded-full">
                <Compass className="size-6" aria-hidden />
              </span>
              <p className="text-muted-foreground text-sm leading-relaxed">{t("noTopic.body")}</p>
            </div>
          ) : text === null ? (
            <DrawerSkeleton />
          ) : (
            <div className="space-y-6">
              <p className="text-foreground/85 text-sm leading-7">{text.summary}</p>

              <HelpVideoCard
                video={videos.get(topic.id)}
                label={t("video.tour")}
                hint={t("video.minute")}
                soon={{ title: t("video.soonTitle"), body: t("video.soonBody") }}
              />

              <section>
                <SectionTitle>{t("howTo")}</SectionTitle>
                <div className="space-y-2">
                  {tasks.map((task) => {
                    const taskText = text.tasks[task.id];
                    if (taskText === undefined) return null;
                    return (
                      <TaskRow
                        key={task.id}
                        text={taskText}
                        open={expanded === task.id}
                        onToggle={() => setExpanded((current) => (current === task.id ? null : task.id))}
                        video={videos.get(taskSlot(topic.id, task.id))}
                        videoLabel={t("video.task")}
                        stepsLabel={t("steps", { count: taskText.steps.length })}
                      />
                    );
                  })}
                </div>
              </section>

              {text.tips !== undefined && text.tips.length > 0 && (
                <section className="bg-gold/[0.09] ring-gold/30 rounded-2xl p-4 ring-1">
                  <h3 className="mb-2 flex items-center gap-2 text-sm font-bold">
                    <Lightbulb className="text-gold size-4" aria-hidden />
                    {t("tips")}
                  </h3>
                  <ul className="text-foreground/85 space-y-1.5 text-[13px] leading-6">
                    {text.tips.map((tip) => (
                      <li key={tip} className="flex gap-2">
                        <span className="bg-gold mt-[0.6rem] size-1 shrink-0 rounded-full" aria-hidden />
                        <span>
                          <StepText step={tip} />
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <footer className="bg-muted/30 border-border/70 flex shrink-0 items-center justify-between gap-2 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
          <Link
            href="/help"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 rounded-lg py-1.5 text-sm font-semibold transition-colors"
          >
            <LifeBuoy className="size-4" aria-hidden />
            {t("allGuides")}
          </Link>
          {topic !== null && !onPage && (
            <Link
              href={topic.href}
              className="bg-primary text-primary-foreground centre-button-primary inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-bold"
            >
              {t("openPage")}
              <ArrowLeft className="size-4 ltr:rotate-180" aria-hidden />
            </Link>
          )}
        </footer>
      </aside>
    </div>,
    document.body,
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-muted-foreground mb-2.5 text-xs font-bold tracking-wide">{children}</h3>;
}

/** One question and, when open, its steps. */
function TaskRow({
  text,
  open,
  onToggle,
  video,
  videoLabel,
  stepsLabel,
}: {
  text: HelpTaskText;
  open: boolean;
  onToggle: () => void;
  video: HelpVideo | undefined;
  videoLabel: string;
  stepsLabel: string;
}) {
  const panelId = useId();
  const rowRef = useRef<HTMLDivElement>(null);
  // The question that was asked for may sit below the fold of a phone's sheet.
  useEffect(() => {
    if (open) rowRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [open]);

  return (
    <div
      ref={rowRef}
      data-open={open}
      className={cn(
        "rounded-2xl ring-1 transition-colors",
        open ? "bg-primary/[0.04] ring-primary/25" : "ring-border/70 hover:bg-muted/50",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="focus-visible:ring-ring/60 flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-start outline-none focus-visible:ring-2"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm leading-snug font-bold">{text.title}</span>
          {!open && <span className="text-muted-foreground mt-0.5 block text-xs">{stepsLabel}</span>}
        </span>
        <ChevronDown
          className={cn("text-muted-foreground size-4 shrink-0 transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>

      {open && (
        <div id={panelId} className="space-y-3 px-3.5 pb-4">
          <HelpVideoCard video={video} label={videoLabel} compact />
          <ol className="space-y-2.5">
            {text.steps.map((step, index) => (
              <li key={step} className="flex gap-3">
                <span className="bg-primary/10 text-primary mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums">
                  {index + 1}
                </span>
                <span className="text-foreground/90 min-w-0 flex-1 text-[13px] leading-6">
                  <StepText step={step} />
                </span>
              </li>
            ))}
          </ol>
          {text.note !== undefined && (
            <p className="bg-card text-muted-foreground ring-border/70 rounded-xl px-3 py-2 text-xs leading-relaxed ring-1">
              <StepText step={text.note} />
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** A step's words, with every on-screen name ("[[Save]]") drawn as the chip the eye will look for. */
export function StepText({ step }: { step: string }) {
  return (
    <>
      {stepParts(step).map((part, index) =>
        typeof part === "string" ? (
          part
        ) : (
          <span
            key={index}
            className="bg-card text-foreground ring-border mx-0.5 inline-block rounded-md px-1.5 py-px text-[0.92em] font-bold whitespace-nowrap ring-1"
          >
            {part.label}
          </span>
        ),
      )}
    </>
  );
}

function DrawerSkeleton() {
  return (
    <div className="animate-pulse space-y-4" aria-hidden>
      <div className="bg-muted h-3 w-11/12 rounded-full" />
      <div className="bg-muted h-3 w-8/12 rounded-full" />
      <div className="bg-muted aspect-video rounded-2xl" />
      <div className="bg-muted h-12 rounded-2xl" />
      <div className="bg-muted h-12 rounded-2xl" />
      <div className="bg-muted h-12 rounded-2xl" />
    </div>
  );
}
