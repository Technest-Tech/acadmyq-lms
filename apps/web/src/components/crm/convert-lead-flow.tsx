"use client";

import { Link2, UserCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { StudentForm } from "@/components/students/student-form";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import {
  ApiError,
  convertLead,
  listStudents,
  type LeadRow,
  type StudentRow,
} from "@/lib/api";

/**
 * The SUBSCRIBED stage: the lead becomes a student, which is the only reason the stage exists.
 *
 * It asks for the student's details FIRST — the normal student form, pre-filled with the name and
 * number the CRM already holds — and only links the lead once that record is created. The student
 * is enrolled (REGULAR), not a trial: they already had their trial in the pipeline, and this is
 * the moment they subscribe. That is what makes them appear on the Students page.
 *
 * The escape hatch underneath covers the person who was already added by someone else: pick the
 * existing student and link them, rather than creating a duplicate. Both paths end the same way —
 * a lead pointing at a real student — because the server accepts no other route to this stage.
 */
export function ConvertLeadFlow({
  lead,
  onCancel,
  onDone,
}: {
  lead: LeadRow;
  onCancel: () => void;
  /** `created` true when a new student record was made; false when an existing one was linked. */
  onDone: (created: boolean) => void;
}) {
  const t = useTranslations("crm");
  const { can } = useAuth();
  const canLinkExisting = can("student.read");

  const [error, setError] = useState<string | null>(null);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [existingId, setExistingId] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);

  useEffect(() => {
    if (!canLinkExisting) return;
    void listStudents({ pageSize: 100, filter: { status: "active" } })
      .then((r) => setStudents(r.rows))
      .catch(() => {});
  }, [canLinkExisting]);

  async function link(studentId: string, created: boolean) {
    try {
      await convertLead(lead.id, studentId);
      onDone(created);
    } catch (err) {
      // The student exists now but the linkage failed — say so, so nobody creates them twice.
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  async function linkExisting() {
    if (!existingId) return;
    setLinkBusy(true);
    setError(null);
    try {
      await link(existingId, false);
    } finally {
      setLinkBusy(false);
    }
  }

  return (
    <div className="space-y-4" data-testid="crm-convert-flow">
      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}

      <StudentForm
        intent="enrolled"
        initialFullName={lead.full_name}
        initialPhone={lead.whatsapp_phone}
        onCreated={(studentId) => void link(studentId, true)}
        onCancel={onCancel}
      />

      {/* Already on the Students page? Point the lead at them instead of making a second row. */}
      {canLinkExisting && (
        <div className="space-y-2.5 rounded-xl border border-dashed px-3.5 py-3">
          <p className="text-muted-foreground text-xs">{t("convert.linkExistingHint")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Combobox
              className="min-w-48 flex-1"
              options={students.map((s) => ({ value: s.id, label: s.full_name }))}
              value={existingId}
              onChange={setExistingId}
              placeholder={t("convert.selectStudent")}
              searchPlaceholder={t("convert.searchStudent")}
              data-testid="crm-link-student"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void linkExisting()}
              disabled={linkBusy || !existingId}
              className="shrink-0 gap-1.5"
              data-testid="crm-link-existing"
            >
              {linkBusy ? (
                <span className="size-3.5 animate-spin rounded-full border border-current border-t-transparent" />
              ) : (
                <Link2 className="size-3.5" aria-hidden />
              )}
              {t("convert.linkExisting")}
            </Button>
          </div>
        </div>
      )}

      <p className="text-muted-foreground flex items-start gap-2 text-[11px]">
        <UserCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {t("convert.footnote")}
      </p>
    </div>
  );
}
