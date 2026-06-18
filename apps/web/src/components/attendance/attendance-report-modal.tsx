"use client";

import { useTranslations } from "next-intl";
import { Modal } from "@/components/ui/modal";
import { AttendanceReport } from "./attendance-report";

export function AttendanceReportModal({
  sessionId,
  studentName,
  open,
  onClose,
  onChange,
  readOnly = false,
}: {
  sessionId: string;
  studentName?: string | null;
  open: boolean;
  onClose: () => void;
  /** Called whenever the session status or report changes; receives the session ID and its new status. */
  onChange?: (sessionId: string, newStatus: string) => void;
  /** Display-only view of an already-recorded session (outcome + report, no actions). */
  readOnly?: boolean;
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
      <AttendanceReport
        sessionId={sessionId}
        readOnly={readOnly}
        onChange={(newStatus) => onChange?.(sessionId, newStatus)}
      />
    </Modal>
  );
}
