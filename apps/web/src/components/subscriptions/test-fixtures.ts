import type { StudentPick, SubscriptionRow, SubscriptionSummary } from "@/lib/subscriptions-api";

/** A centre's subscription row as GET /subscriptions returns it — the contract's shape, every field. */
export function subRow(over: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    id: "sub1",
    sequence_no: 1,
    student: { id: "s1", full_name: "Adam", guardian_id: "gd1", guardian_name: "Umm Adam", is_self_guardian: false },
    teacher: { id: "t1", full_name: "Mr Ali" },
    course: "English",
    label: "8 × English",
    lessons_sold: 8,
    lessons_used: 3,
    lessons_left: 5,
    lesson_minutes: 40,
    lesson_price_minor: 9000,
    price_minor: 72000,
    currency: "EGP",
    starts_on: "2026-10-01",
    status: "OPEN",
    finished_at: null,
    closed_at: null,
    closed_reason: null,
    closed_by_name: null,
    invoice_id: "i1",
    invoice_line_id: "l1",
    invoice_paid_minor: 72000,
    outstanding_minor: 0,
    settlement: null,
    settlement_minor: null,
    next_lesson_at: "2026-11-06T15:00:00Z",
    upcoming_lesson_count: 2,
    outside_count: 0,
    renewal_held: false,
    deletable: false,
    opened_by_name: "Nour",
    created_at: "2026-10-01T09:00:00Z",
    ...over,
  };
}

export function subSummary(over: Partial<SubscriptionSummary> = {}): SubscriptionSummary {
  return { open: 4, finished_unrenewed: 2, outside_students: 1, due_count: 3, outstanding: [{ currency: "EGP", minor: 150000 }], ending: 1, ...over };
}

export function studentPick(over: Partial<StudentPick> = {}): StudentPick {
  return {
    id: "s1",
    full_name: "Adam",
    guardian_name: "Umm Adam",
    status: "REGULAR",
    subjects: [
      { teacher_id: "t1", teacher_name: "Mr Ali", course: "English", open_subscription_id: null },
      { teacher_id: "t2", teacher_name: "Ms Sama", course: "Maths", open_subscription_id: "sub9" },
    ],
    has_timetable_for: ["t1"],
    ...over,
  };
}
