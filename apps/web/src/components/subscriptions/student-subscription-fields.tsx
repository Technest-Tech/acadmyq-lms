"use client";

import { useState } from "react";
import { NEW_SUBJECT, SubjectPicker, SubscriptionTermsFields, useSubscriptionTerms, type SubjectOption } from "@/components/subscriptions/subscription-terms";
import type { TeacherRow } from "@/lib/api";
import { subscriptionSubjectKey, type SellTerms } from "@/lib/subscriptions-api";

/** A teacher link as the new-student form and the wizard hold it: a teacher and what they teach. */
export interface SubjectLink {
  teacher_id: string;
  course: string | null;
}

export interface StudentSubscriptionDraft {
  subjectKey: string;
  setSubjectKey: (key: string) => void;
  newTeacherId: string;
  setNewTeacherId: (id: string) => void;
  newCourse: string;
  setNewCourse: (course: string) => void;
  terms: ReturnType<typeof useSubscriptionTerms>;
  /** The subject chosen (an existing link, or the new one typed), or null while none is. */
  subject: { teacherId: string; course: string | null; isNew: boolean } | null;
  valid: boolean;
  /** What POST /students (`subscription:`) and the wizard's sale carry. */
  toPayload: () => SellTerms;
}

/**
 * The private subscription a new student starts on (docs/centre-profile/01 "API contract":
 * `POST /students` takes `subscription: SellInput-without-student_id`). The subject is one of the
 * teacher links typed above in the same form — choosing it there IS choosing the subject — or a new
 * subject with its own teacher and name. The block's terms are the same fields the sell form uses.
 */
export function useStudentSubscriptionDraft(links: SubjectLink[]): StudentSubscriptionDraft {
  const [subjectKey, setSubjectKeyRaw] = useState("");
  const [newTeacherId, setNewTeacherId] = useState("");
  const [newCourse, setNewCourse] = useState("");
  const terms = useSubscriptionTerms();

  const linked = links.filter((l) => l.teacher_id);
  // The first link typed is the subject until another is chosen; a link removed takes its choice with it.
  const effectiveKey =
    subjectKey === NEW_SUBJECT || linked.some((l) => subscriptionSubjectKey(l.teacher_id, l.course) === subjectKey)
      ? subjectKey
      : linked[0]
        ? subscriptionSubjectKey(linked[0].teacher_id, linked[0].course)
        : NEW_SUBJECT;

  const chosen = linked.find((l) => subscriptionSubjectKey(l.teacher_id, l.course) === effectiveKey) ?? null;
  const subject =
    effectiveKey === NEW_SUBJECT
      ? newTeacherId !== "" && newCourse.trim() !== ""
        ? { teacherId: newTeacherId, course: newCourse.trim(), isNew: !linked.some((l) => l.teacher_id === newTeacherId) }
        : null
      : chosen
        ? { teacherId: chosen.teacher_id, course: chosen.course, isNew: false }
        : null;

  return {
    subjectKey: effectiveKey,
    setSubjectKey: setSubjectKeyRaw,
    newTeacherId,
    setNewTeacherId,
    newCourse,
    setNewCourse,
    terms,
    subject,
    valid: subject !== null && terms.valid,
    toPayload: () => ({
      teacher_id: subject?.teacherId ?? null,
      course: subject?.course ?? null,
      ...(subject?.isNew ? { new_subject: true } : {}),
      ...terms.toTerms(),
    }),
  };
}

export function StudentSubscriptionFields({
  draft,
  links,
  teachers,
  currency,
  idPrefix,
}: {
  draft: StudentSubscriptionDraft;
  links: SubjectLink[];
  teachers: TeacherRow[];
  currency: string;
  idPrefix: string;
}) {
  const nameOf = (id: string) => teachers.find((tc) => tc.id === id)?.full_name ?? id;
  const subjects: SubjectOption[] = links
    .filter((l) => l.teacher_id)
    .map((l) => ({ key: subscriptionSubjectKey(l.teacher_id, l.course), teacherId: l.teacher_id, course: l.course, label: [l.course, nameOf(l.teacher_id)].filter(Boolean).join(" · ") }));

  return (
    <div className="space-y-3" data-testid={`${idPrefix}-subscription`}>
      <SubjectPicker
        subjects={subjects}
        value={draft.subjectKey}
        onChange={draft.setSubjectKey}
        teachers={teachers}
        newTeacherId={draft.newTeacherId}
        onNewTeacherId={draft.setNewTeacherId}
        newCourse={draft.newCourse}
        onNewCourse={draft.setNewCourse}
        idPrefix={idPrefix}
      />
      <SubscriptionTermsFields terms={draft.terms} currency={currency} idPrefix={idPrefix} />
    </div>
  );
}
