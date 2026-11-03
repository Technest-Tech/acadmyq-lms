"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { apiErrorMessage } from "@/components/groups/group-form";
import { fieldClass } from "@/components/groups/group-format";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { listTeachers } from "@/lib/api";
import type { GroupLesson } from "@/lib/groups-api";
import { setGroupLessonSubstitute } from "@/lib/holidays-api";
import { fetchRoster } from "@/lib/roster";

/**
 * "مدرس بديل" on one group lesson (group.manage): pick who takes it, or put the group's own teacher
 * back. The pay follows whoever takes it — the API moves the line when the sheet is already saved,
 * and refuses once that month's salary was paid out from the treasury (the error shows here).
 */
export function SubstituteModal({
  lesson,
  open,
  onClose,
  onSaved,
}: {
  lesson: GroupLesson;
  open: boolean;
  onClose: () => void;
  onSaved: (lesson: GroupLesson, message: string) => void;
}) {
  const t = useTranslations("holidays.substitute");
  const [teachers, setTeachers] = useState<{ id: string; name: string }[]>([]);
  const [chosen, setChosen] = useState<string>(lesson.is_substitute ? lesson.teacher_id : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setChosen(lesson.is_substitute ? lesson.teacher_id : "");
    setError(null);
    let live = true;
    void fetchRoster(listTeachers, { filter: { status: "active" } })
      .then((res) => live && setTeachers(res.rows.map((r) => ({ id: r.id, name: r.full_name }))))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [open, lesson.id, lesson.is_substitute, lesson.teacher_id]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await setGroupLessonSubstitute(lesson.id, chosen || null);
      onSaved(res.lesson, t("saved"));
    } catch (err) {
      setError(apiErrorMessage(err, t("failed")));
    } finally {
      setBusy(false);
    }
  }

  const ownLabel = lesson.group_teacher_name ? t("own", { name: lesson.group_teacher_name }) : t("ownPlain");

  return (
    <Modal open={open} onClose={onClose} title={t("title")} description={t("hint")}>
      <div className="space-y-4" data-testid="substitute-modal">
        {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">{t("teacher")}</span>
          <select className={fieldClass} value={chosen} onChange={(e) => setChosen(e.target.value)} data-testid="substitute-teacher">
            <option value="">{ownLabel}</option>
            {teachers.map((te) => (
              <option key={te.id} value={te.id}>
                {te.name}
              </option>
            ))}
          </select>
        </label>
        <p className="text-muted-foreground text-xs">{t("payNote")}</p>
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button type="button" disabled={busy} onClick={() => void save()} data-testid="substitute-save">
            {t("save")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
