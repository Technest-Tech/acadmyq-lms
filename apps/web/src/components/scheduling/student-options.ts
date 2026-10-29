import type { StudentRow } from "@/lib/api";

/**
 * A student as a picker option (add timetable, quick lesson): the name, then the teacher and the
 * student's own number — else the parent's — so two students of the same name are told apart, and
 * typing a few digits finds the right one. The number is isolated left-to-right inside the Arabic
 * line, so its "+" stays in front.
 */
export function studentOption(s: Pick<StudentRow, "id" | "full_name" | "teacher_name" | "whatsapp_phone" | "guardian_phone">) {
  const phone = s.whatsapp_phone || s.guardian_phone;
  const sublabel = [s.teacher_name, phone ? `⁦${phone}⁩` : null].filter(Boolean).join(" · ");
  return { value: s.id, label: s.full_name, sublabel: sublabel || undefined };
}
