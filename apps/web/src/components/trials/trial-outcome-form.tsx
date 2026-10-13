"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ApiError, updateTrial, type TrialRow } from "@/lib/api";
import { cn } from "@/lib/utils";

type Outcome = "COMPLETED" | "NO_SHOW";

const OUTCOMES: Outcome[] = ["COMPLETED", "NO_SHOW"];

/**
 * Notes on a trial, with its outcome alongside. The one-tap buttons on the board cover the plain
 * decision; this is where the "how it went" goes. Picking an outcome is optional — a note on a
 * trial that has not happened yet ("asked for a female teacher") must not decide it — and pressing
 * the picked outcome again clears the pick.
 */
export function TrialOutcomeForm({
  trial,
  onSaved,
  onCancel,
}: {
  trial: TrialRow;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("trials");
  const initial: Outcome | null =
    trial.status === "COMPLETED" || trial.status === "NO_SHOW" ? trial.status : null;
  const [status, setStatus] = useState<Outcome | null>(initial);
  const [notes, setNotes] = useState(trial.outcome_notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await updateTrial(trial.id, {
        outcome_notes: notes.trim() || null,
        ...(status !== null && status !== trial.status ? { status } : {}),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}

      <div className="grid grid-cols-2 gap-2">
        {OUTCOMES.map((o) => (
          <button
            key={o}
            type="button"
            aria-pressed={status === o}
            // Un-picking only applies to a trial with no decision yet; clearing a recorded one is
            // the card's "Change decision".
            onClick={() => setStatus((prev) => (prev === o && initial === null ? null : o))}
            className={cn(
              "rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors",
              status === o
                ? "border-primary/40 bg-primary/8 text-primary"
                : "border-input bg-background text-muted-foreground hover:bg-muted/40",
            )}
          >
            {t(`status.${o}`)}
          </button>
        ))}
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">{t("outcome.notes")}</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder={t("outcome.notesPlaceholder")}
          className="border-input bg-background focus:border-primary focus:ring-primary/15 w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition-colors focus:ring-3"
        />
      </div>

      <div className="flex items-center justify-end gap-2 border-t pt-4">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          {t("back")}
        </Button>
        <Button type="button" size="sm" onClick={() => void save()} disabled={busy} className="gap-1.5">
          {busy && (
            <span className="size-3.5 animate-spin rounded-full border border-current border-t-transparent" />
          )}
          {t("outcome.save")}
        </Button>
      </div>
    </div>
  );
}
