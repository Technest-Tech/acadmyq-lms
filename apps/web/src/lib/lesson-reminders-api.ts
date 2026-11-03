/**
 * Lesson reminders in WhatsApp groups — the API client for /api/lesson-reminders.
 *
 * Kept out of `api.ts` like `groups-api.ts`: a module of its own behind its own feature switch
 * (`whatsapp.group_reminders`, off until a Super Admin turns it on for the client).
 */
import { apiFetch } from "@/lib/api";

export type ReminderPersonKind = "student" | "teacher";
export type ReminderStage = "LESSON_REMINDER" | "LESSON_STARTING";
export type ReminderStatus = "PENDING" | "SENDING" | "QUEUED" | "SENT" | "DELIVERED" | "FAILED" | "EXPIRED" | "SKIPPED";

export interface LessonReminderSettings {
  /** 0 = no reminder ahead of the lesson. */
  lead_minutes: number;
  at_start: boolean;
  language: "ar" | "en";
}

export interface LessonRemindersOverview {
  settings: LessonReminderSettings;
  lead_choices: number[];
  /** The academy's clock: times on this screen read in it. */
  timezone: string;
  whatsapp: { state: string; phone: string | null };
  /** null when the gateway does not report its queue. */
  capacity: { sent_today: number; daily_cap: number; expected_next_day: number } | null;
  assigned: {
    students: { assigned: number; total: number };
    teachers: { assigned: number; total: number };
  };
  last_day: { sent: number; waiting: number; failed: number; missed: number };
}

/** A group the connected number is a member of, as the picker offers it. */
export interface ReminderGroupOption {
  jid: string;
  name: string;
  size: number;
  /** False when only admins may post there and the number is not one: the API refuses it. */
  can_send: boolean;
  assigned_students: number;
  assigned_teachers: number;
}

export interface AssignedReminderGroup {
  id: string;
  jid: string;
  name: string;
  last_status: ReminderStatus | null;
  last_error: string | null;
  last_at: string | null;
}

export interface ReminderPerson {
  id: string;
  name: string;
  group: AssignedReminderGroup | null;
}

export interface ReminderLogRow {
  id: string;
  event_type: ReminderStage;
  status: ReminderStatus;
  error: string | null;
  group_name: string;
  lesson: { kind?: "LESSON" | "TRIAL" | "CLASS"; student?: string | null; teacher?: string | null; class?: string | null; starts_at?: string };
  due_at: string | null;
  sent_at: string | null;
  delivered_at: string | null;
}

export function getLessonReminders(): Promise<LessonRemindersOverview> {
  return apiFetch("/api/lesson-reminders");
}

export function updateLessonReminderSettings(settings: LessonReminderSettings): Promise<{ settings: LessonReminderSettings }> {
  return apiFetch("/api/lesson-reminders/settings", { method: "PUT", body: JSON.stringify(settings) });
}

/** `refresh` skips the server's short cache — the number was just added to a group. */
export function listReminderGroups(refresh = false): Promise<{ groups: ReminderGroupOption[] }> {
  return apiFetch(`/api/lesson-reminders/groups${refresh ? "?refresh=1" : ""}`);
}

export function listReminderAssignments(params: {
  kind: ReminderPersonKind;
  page: number;
  search?: string;
  assigned?: "yes" | "no";
}): Promise<{ rows: ReminderPerson[]; total: number; page: number; pageSize: number }> {
  const query = new URLSearchParams({ kind: params.kind, page: String(params.page) });
  if (params.search) query.set("search", params.search);
  if (params.assigned) query.set("filter[assigned]", params.assigned);
  return apiFetch(`/api/lesson-reminders/assignments?${query.toString()}`);
}

export function getReminderPerson(kind: ReminderPersonKind, id: string): Promise<{ person: ReminderPerson }> {
  return apiFetch(`/api/lesson-reminders/assignments/${kind}/${id}`);
}

/** A null `jid` takes the group away. */
export function assignReminderGroup(kind: ReminderPersonKind, id: string, jid: string | null): Promise<{ person: ReminderPerson }> {
  return apiFetch(`/api/lesson-reminders/assignments/${kind}/${id}`, { method: "PUT", body: JSON.stringify({ jid }) });
}

export function testReminderGroup(groupId: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/lesson-reminders/groups/${groupId}/test`, { method: "POST" });
}

export function listReminderLog(problems: boolean): Promise<{ rows: ReminderLogRow[] }> {
  return apiFetch(`/api/lesson-reminders/log${problems ? "?problems=1" : ""}`);
}
