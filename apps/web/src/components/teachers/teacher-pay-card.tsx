"use client";

import { Check, Wallet } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import {
  type PayDraft,
  payDraftFromTeacher,
  payDraftToInput,
  TeacherPayEditor,
} from "@/components/teachers/teacher-pay-editor";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ProfileCard } from "@/components/ui/profile-card";
import { ApiError, getTeacher, updateTeacher } from "@/lib/api";

/**
 * How this teacher is paid, edited where their statements are read. It lives on the Salary tab
 * (payout.read) rather than the profile, because pay is money: whoever sets it is whoever reads
 * what it adds up to.
 */
export function TeacherPayCard({
  teacherId,
  onSaved,
}: {
  teacherId: string;
  /** After a save — the fixed salary can open or move this month's statement. */
  onSaved?: () => void;
}) {
  const t = useTranslations("teachers");
  const { can } = useAuth();
  const canEdit = can("teacher.update");

  const [draft, setDraft] = useState<PayDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await getTeacher(teacherId);
      setDraft(payDraftFromTeacher(res.teacher, res.students, res.student_rates ?? []));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }, [teacherId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (draft === null) return;
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      await updateTeacher(teacherId, payDraftToInput(draft));
      // Lessons already marked keep the rate they were paid at — say so, and where to change that.
      setNotice(t("pay.saved"));
      onSaved?.();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ProfileCard
      icon={Wallet}
      title={t("pay.title")}
      description={t("pay.description")}
      tone="violet"
      testId="teacher-pay"
    >
      <div className="space-y-4">
        {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}
        {notice && (
          <AlertBanner variant="success" message={notice} onDismiss={() => setNotice(null)} />
        )}

        {draft === null ? (
          <div className="flex items-center justify-center py-8">
            <div className="border-primary size-6 animate-spin rounded-full border-2 border-t-transparent" />
          </div>
        ) : (
          <TeacherPayEditor value={draft} onChange={setDraft} disabled={!canEdit || saving} />
        )}

        {canEdit && draft !== null && (
          <div className="flex justify-end border-t pt-4">
            <Button
              type="button"
              size="sm"
              disabled={saving}
              onClick={() => void save()}
              data-testid="save-teacher-pay"
              className="gap-1.5"
            >
              {saving ? (
                <>
                  <span className="size-3.5 animate-spin rounded-full border border-current border-t-transparent" />
                  {t("form.saving")}
                </>
              ) : (
                <>
                  <Check className="size-3.5" />
                  {t("pay.save")}
                </>
              )}
            </Button>
          </div>
        )}
      </div>
    </ProfileCard>
  );
}
