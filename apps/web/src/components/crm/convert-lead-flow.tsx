"use client";

import { CheckCircle2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { StudentForm } from "@/components/students/student-form";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ApiError, convertLead, updateLead, type LeadRow } from "@/lib/api";

/**
 * Convert a won lead into a real student in one motion: the normal student form, pre-filled
 * with the lead's name and phone; on create the lead is linked (converted_student_id) and
 * moved to WON. The escape hatch underneath — "mark WON without adding a student" — covers
 * the person who was already added elsewhere; the lead just gets its WON stamp.
 */
export function ConvertLeadFlow({
  lead,
  onCancel,
  onDone,
}: {
  lead: LeadRow;
  onCancel: () => void;
  /** `converted` true when a student was created+linked; false for the mark-WON-only path. */
  onDone: (converted: boolean) => void;
}) {
  const t = useTranslations("crm");
  const [error, setError] = useState<string | null>(null);
  const [wonBusy, setWonBusy] = useState(false);

  async function handleCreated(studentId: string) {
    try {
      await convertLead(lead.id, studentId);
      onDone(true);
    } catch (err) {
      // The student exists now but the linkage failed — surface it; a retry from the board
      // would re-run only the link step via "mark WON" or another convert.
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  async function markWonOnly() {
    setWonBusy(true);
    setError(null);
    try {
      await updateLead(lead.id, { status: "WON" });
      onDone(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setWonBusy(false);
    }
  }

  return (
    <div className="space-y-4" data-testid="crm-convert-flow">
      {error && (
        <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />
      )}

      <StudentForm
        initialFullName={lead.full_name}
        initialPhone={lead.whatsapp_phone}
        onCreated={(studentId) => void handleCreated(studentId)}
        onCancel={onCancel}
      />

      {/* Already added as a student some other way? Just stamp the win. */}
      <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed px-3.5 py-2.5">
        <p className="text-muted-foreground text-xs">{t("convert.markWonHint")}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void markWonOnly()}
          disabled={wonBusy}
          className="shrink-0 gap-1.5"
          data-testid="crm-mark-won-only"
        >
          {wonBusy ? (
            <span className="size-3.5 animate-spin rounded-full border border-current border-t-transparent" />
          ) : (
            <CheckCircle2 className="size-3.5" aria-hidden />
          )}
          {t("convert.markWonOnly")}
        </Button>
      </div>
    </div>
  );
}
