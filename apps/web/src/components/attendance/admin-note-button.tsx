"use client";

import { Loader2, NotebookPen } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * The office's own note on a lesson whose attendance is recorded (lingo, 2026-11-09) — a private
 * lesson or a group sheet. Never shown to the teacher or the family: the API sends `admin_note`
 * only to the office, so a caller renders this only when that key is present.
 */
export function AdminNoteButton({
  note,
  onSave,
  testId = "admin-note",
  size = "xs",
}: {
  note: string | null;
  onSave: (note: string | null) => Promise<void>;
  testId?: string;
  size?: "xs" | "sm";
}) {
  const t = useTranslations("attendance.adminNote");
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const has = (note ?? "").trim() !== "";

  async function save(value: string | null) {
    setBusy(true);
    setError(null);
    try {
      await onSave(value === null || value.trim() === "" ? null : value.trim());
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("failed"));
    } finally {
      setBusy(false);
    }
  }

  // The rows it sits on open their lesson on any click — and a modal's clicks bubble through the
  // React tree to them even from its portal (lingo, 2026-11-10: typing a note opened the lesson).
  // Nothing inside this control may reach the row.
  return (
    <span className="contents" onClick={(e) => e.stopPropagation()} data-testid={`${testId}-scope`}>
      <Button
        type="button"
        size={size}
        variant="outline"
        className={cn("max-w-56 gap-1.5", has && "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300")}
        title={has ? (note ?? "") : t("add")}
        onClick={(e) => {
          e.stopPropagation();
          setText(note ?? "");
          setError(null);
          setOpen(true);
        }}
        data-testid={testId}
      >
        <NotebookPen className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{has ? note : t("add")}</span>
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t("title")}
        description={t("hint")}
        size="sm"
        footer={
          <>
            {has && (
              <Button type="button" variant="ghost" onClick={() => void save(null)} disabled={busy} data-testid={`${testId}-clear`}>
                {t("clear")}
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button type="button" onClick={() => void save(text)} disabled={busy || text.trim() === (note ?? "").trim()} data-testid={`${testId}-save`}>
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t("save")}
            </Button>
          </>
        }
      >
        <textarea
          className="border-input bg-background focus-visible:ring-ring min-h-28 w-full rounded-lg border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
          value={text}
          maxLength={2000}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("placeholder")}
          autoFocus
          data-testid={`${testId}-text`}
        />
        {error && <AlertBanner variant="error" message={error} />}
      </Modal>
    </span>
  );
}
