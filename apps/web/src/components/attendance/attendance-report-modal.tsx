"use client";

import { useTranslations } from "next-intl";
import { Modal } from "@/components/ui/modal";
import { AttendanceReport } from "./attendance-report";

/**
 * The attendance/report surface as a popup form (Sprint 6). Launched from the weekly calendar's
 * session actions and the pending-attendance list, so an outcome can be recorded without leaving
 * the current screen. A direct `/sessions/[id]` page hosts the same component for deep links.
 */
export function AttendanceReportModal({
  sessionId,
  studentName,
  open,
  onClose,
  onChange,
}: {
  sessionId: string;
  studentName?: string | null;
  open: boolean;
  onClose: () => void;
  onChange?: () => void;
}) {
  const t = useTranslations("attendance");

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("title")}
      description={studentName ?? undefined}
      size="lg"
    >
      <AttendanceReport sessionId={sessionId} onChange={onChange} />
    </Modal>
  );
}
