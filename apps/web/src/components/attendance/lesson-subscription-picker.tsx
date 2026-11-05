"use client";

import { Layers, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { LessonSubscriptionChoices } from "@/lib/api";
import { moveLessonSubscription } from "@/lib/subscriptions-api";

const OUTSIDE = "__outside__";

/**
 * Which of the student's subscriptions a delivered centre lesson counts on. The engine picks one
 * when the lesson is marked (its subject, else the oldest); the desk can move it to another open
 * block with a free seat, or outside. No money moves — the bill belongs to the block.
 */
export function LessonSubscriptionPicker({
  sessionId,
  choices,
  canMove,
  onMoved,
  onError,
}: {
  sessionId: string;
  choices: LessonSubscriptionChoices;
  canMove: boolean;
  onMoved: () => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const t = useTranslations("attendance.lessonSubscription");
  const [busy, setBusy] = useState(false);
  const value = choices.current ?? OUTSIDE;

  async function move(next: string) {
    if (next === value) return;
    setBusy(true);
    try {
      await moveLessonSubscription(sessionId, next === OUTSIDE ? null : next);
      await onMoved();
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border px-3.5 py-3" data-testid="lesson-subscription">
      <label htmlFor="lesson-subscription-select" className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold">
        <Layers className="size-3.5" aria-hidden />
        {t("title")}
        {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
      </label>
      <select
        id="lesson-subscription-select"
        className="border-input bg-background h-9 w-full rounded-lg border px-2.5 text-sm disabled:opacity-60"
        value={value}
        disabled={!canMove || busy}
        onChange={(e) => void move(e.target.value)}
        data-testid="lesson-subscription-select"
      >
        {choices.options.map((o) => (
          <option key={o.id} value={o.id} disabled={!o.available}>
            {[`#${o.sequence_no}`, o.label, o.teacher_name].filter(Boolean).join(" · ")}
            {" — "}
            {t("used", { used: o.lessons_used, sold: o.lessons_sold })}
            {!o.available ? ` (${t("full")})` : ""}
          </option>
        ))}
        <option value={OUTSIDE}>{t("outside")}</option>
      </select>
      {canMove && <p className="text-muted-foreground mt-1.5 text-[11px]">{t("hint")}</p>}
    </section>
  );
}
