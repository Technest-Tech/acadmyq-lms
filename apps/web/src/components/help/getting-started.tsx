"use client";

import { ArrowLeft, Check, CircleHelp, Rocket, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useContext, useEffect, useState } from "react";
import { AuthContext } from "@/components/auth-provider";
import { useHelp } from "@/components/help/help-provider";
import { getOnboarding, type Onboarding, type OnboardingStep } from "@/lib/help-api";
import { cn } from "@/lib/utils";

/**
 * "Start here" — a new academy's first five steps, at the top of its dashboard.
 *
 * Each step ticks itself off from what the academy has really done (the server looks; nobody marks
 * anything by hand), names the page to do it on, and offers the help for exactly that task. The card
 * is for whoever sets the academy up: a teacher never sees it, an academy that has been working for
 * months never sees it, and it leaves by itself once every step is done. Closing it early is
 * remembered on this device.
 */

interface StepDef {
  step: OnboardingStep;
  href: string;
  /** Who can do this step: without the permission the row is left out. */
  permission: string;
  /** The help that explains it: topic id and task id (src/content/help/topics.ts). */
  help: readonly [topic: string, task: string];
}

/** A one-to-one academy: teacher, student, their weekly timetable, the first lesson, the first bill. */
export const ACADEMY_STEPS: readonly StepDef[] = [
  { step: "teacher", href: "/teachers", permission: "teacher.create", help: ["teachers", "add"] },
  { step: "student", href: "/students", permission: "student.create", help: ["students", "add"] },
  { step: "schedule", href: "/calendar", permission: "schedule.manage", help: ["calendar", "timetable"] },
  { step: "attendance", href: "/attendance", permission: "session.mark_attendance", help: ["attendance", "mark"] },
  { step: "money", href: "/invoices", permission: "invoice.read", help: ["invoices", "pay"] },
];

/** A learning centre: its day is groups, and its money is receipts. */
export const CENTRE_STEPS: readonly StepDef[] = [
  { step: "teacher", href: "/teachers", permission: "teacher.create", help: ["teachers", "add"] },
  { step: "group", href: "/groups", permission: "group.manage", help: ["groups", "create"] },
  { step: "student", href: "/students", permission: "student.create", help: ["students", "add"] },
  { step: "attendance", href: "/attendance", permission: "session.mark_attendance", help: ["attendance", "mark"] },
  { step: "money", href: "/accounting", permission: "invoice.mark_paid", help: ["accounting", "collect"] },
];

const dismissedKey = (academyId: string) => `academiq:onboarding:dismissed:${academyId}`;

export function GettingStarted() {
  const t = useTranslations("help.start");
  const auth = useContext(AuthContext);
  const { openHelp } = useHelp();
  const session = auth?.session ?? null;
  const academyId = session?.academyId ?? null;
  // Whoever can add people is setting the academy up; nobody else is asked to.
  const setsUp = (auth?.can("student.create") ?? false) || (auth?.can("teacher.create") ?? false);

  const [state, setState] = useState<Onboarding | null>(null);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if (academyId === null || !setsUp) return;
    try {
      if (localStorage.getItem(dismissedKey(academyId)) === "1") return;
    } catch {
      // No storage: show the card; closing it lasts for this visit only.
    }
    setDismissed(false);
    let live = true;
    getOnboarding()
      .then((result) => {
        if (live) setState(result);
      })
      .catch(() => {
        // The dashboard below is what matters; without an answer there is simply no card.
      });
    return () => {
      live = false;
    };
  }, [academyId, setsUp]);

  if (session === null || academyId === null || dismissed || state === null || !state.show) return null;

  const centre = session.academy?.profile === "CENTRE";
  const steps = (centre ? CENTRE_STEPS : ACADEMY_STEPS).filter((item) => auth?.can(item.permission) ?? false);
  const doneCount = steps.filter((item) => state.done[item.step] === true).length;
  if (steps.length === 0 || doneCount === steps.length) return null;

  const next = steps.find((item) => state.done[item.step] !== true);
  const percent = Math.round((doneCount / steps.length) * 100);

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(dismissedKey(academyId), "1");
    } catch {
      // ignore
    }
  };

  return (
    <section
      data-testid="getting-started"
      aria-label={t("title")}
      className="bg-card ring-foreground/[0.07] relative mb-5 overflow-hidden rounded-2xl shadow-sm ring-1"
    >
      <span
        aria-hidden
        className="from-primary/[0.07] to-gold/[0.07] pointer-events-none absolute inset-0 bg-gradient-to-br via-transparent"
      />
      <div className="relative p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="bg-primary text-primary-foreground centre-button-primary flex size-11 shrink-0 items-center justify-center rounded-2xl shadow-sm">
            <Rocket className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base leading-tight font-extrabold sm:text-lg">{t("title")}</h2>
            <p className="text-muted-foreground mt-0.5 text-sm">{t("subtitle")}</p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label={t("dismiss")}
            title={t("dismiss")}
            className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring/60 -me-1 -mt-1 shrink-0 rounded-xl p-2 transition-colors outline-none focus-visible:ring-2"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={steps.length}
            aria-valuenow={doneCount}
            aria-label={t("progress", { done: doneCount, total: steps.length })}
            className="bg-muted h-2 min-w-0 flex-1 overflow-hidden rounded-full"
          >
            <div
              className="bg-primary centre-button-primary h-full rounded-full transition-[width] duration-500"
              style={{ width: `${Math.max(percent, 4)}%` }}
            />
          </div>
          <span className="text-muted-foreground shrink-0 text-xs font-bold tabular-nums">
            {t("progress", { done: doneCount, total: steps.length })}
          </span>
        </div>

        <ol className="mt-4 grid grid-cols-1 gap-2 lg:grid-cols-5">
          {steps.map((item, index) => {
            const done = state.done[item.step] === true;
            const current = item === next;
            return (
              <li
                key={item.step}
                data-step={item.step}
                data-done={done}
                className={cn(
                  "flex items-center gap-3 rounded-xl p-3 ring-1 lg:flex-col lg:items-start lg:gap-2.5",
                  done && "bg-muted/40 ring-border/50",
                  current && "bg-card ring-primary/40 shadow-sm",
                  !done && !current && "ring-border/70",
                )}
              >
                <span
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums",
                    done
                      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                      : current
                        ? "bg-primary text-primary-foreground centre-button-primary"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {done ? <Check className="size-4" aria-hidden /> : index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cn("text-sm leading-snug font-bold", done && "text-muted-foreground line-through decoration-1")}>
                    {t(`steps.${item.step}.title`)}
                  </p>
                  {!done && (
                    <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                      {t(`steps.${item.step}.body`)}
                    </p>
                  )}
                </div>
                {!done && (
                  <div className="flex shrink-0 items-center gap-1 lg:w-full lg:justify-between">
                    <Link
                      href={item.href}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold transition-colors",
                        current
                          ? "bg-primary text-primary-foreground centre-button-primary"
                          : "text-primary hover:bg-primary/10",
                      )}
                    >
                      {t("go")}
                      <ArrowLeft className="size-3.5 ltr:rotate-180" aria-hidden />
                    </Link>
                    <button
                      type="button"
                      onClick={() => openHelp(item.help[0], item.help[1])}
                      aria-label={t("how", { step: t(`steps.${item.step}.title`) })}
                      title={t("howShort")}
                      className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring/60 inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors outline-none focus-visible:ring-2"
                    >
                      <CircleHelp className="size-3.5" aria-hidden />
                      <span className="hidden sm:inline">{t("howShort")}</span>
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
