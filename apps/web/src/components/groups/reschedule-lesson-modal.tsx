"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { apiErrorMessage } from "@/components/groups/group-form";
import { fieldClass, localDateTime } from "@/components/groups/group-format";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { rescheduleGroupLesson, type BoardLesson, type SchedulingWarning } from "@/lib/groups-api";

/**
 * Reschedule one pending group lesson — a new day, time and length — straight from the attendance
 * lists (lingo, 2026-11-09: "إعادة جدولة حصة في الجروب"). The weekly time stays; the lesson is
 * stamped moved. A room or teacher clash comes back as a warning, never a block.
 */
export function RescheduleLessonModal({
  lesson,
  onClose,
  onDone,
}: {
  lesson: BoardLesson | null;
  onClose: () => void;
  onDone: (warnings: SchedulingWarning[]) => void;
}) {
  const t = useTranslations("groups");
  return (
    <Modal open={lesson !== null} onClose={onClose} title={t("lessons.rescheduleTitle")} description={lesson?.group.name}>
      {lesson !== null && <RescheduleBody key={lesson.id} lesson={lesson} onClose={onClose} onDone={onDone} />}
    </Modal>
  );
}

function RescheduleBody({ lesson, onClose, onDone }: { lesson: BoardLesson; onClose: () => void; onDone: (warnings: SchedulingWarning[]) => void }) {
  const t = useTranslations("groups");
  const tz = lesson.group.timezone;
  const start = localDateTime(lesson.scheduled_at_utc, tz);
  const [date, setDate] = useState(start.date);
  const [time, setTime] = useState(start.time);
  const [duration, setDuration] = useState(String(lesson.duration_minutes));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const minutes = Number(duration);
  const valid = date !== "" && time !== "" && minutes >= 1 && minutes <= 600;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await rescheduleGroupLesson(lesson.id, { local_datetime: `${date} ${time}`, duration_minutes: minutes, timezone: tz });
      onDone(res.warnings ?? []);
    } catch (err) {
      setError(apiErrorMessage(err, t("lessons.rescheduleFailed")));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4" data-testid="reschedule-lesson">
      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="space-y-1.5">
          <span className="text-sm font-medium">{t("lessons.date")}</span>
          <input className={fieldClass} type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="reschedule-date" />
        </label>
        <label className="space-y-1.5">
          <span className="text-sm font-medium">{t("lessons.time")}</span>
          <input className={fieldClass} type="time" value={time} onChange={(e) => setTime(e.target.value)} data-testid="reschedule-time" />
        </label>
        <label className="space-y-1.5">
          <span className="text-sm font-medium">{t("lessons.duration")}</span>
          <input className={fieldClass} type="number" min={1} max={600} value={duration} onChange={(e) => setDuration(e.target.value)} />
        </label>
      </div>
      <div className="flex justify-end gap-2 border-t pt-4">
        <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
          {t("form.cancel")}
        </Button>
        <Button type="button" disabled={busy || !valid} onClick={() => void submit()} data-testid="reschedule-save">
          {t("lessons.reschedule")}
        </Button>
      </div>
    </div>
  );
}
