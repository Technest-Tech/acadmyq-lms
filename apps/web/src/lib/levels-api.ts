/**
 * Levels / grades (docs/centre-profile, Phase 2.1) — the API client for /api/levels and a
 * student's promotion. A module of its own, like `groups-api.ts`: every call here sits behind the
 * `centre` switch (402 for a Quran academy), so nothing in `api.ts` grows a level.
 */
import { apiFetch } from "@/lib/api";

export interface Level {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  /** How many live students stand at this level — what stops a delete. */
  students_count: number;
  groups_count: number;
}

export interface LevelHistoryItem {
  id: string;
  from_level_id: string | null;
  from_level_name: string | null;
  to_level_id: string | null;
  to_level_name: string | null;
  from_group_id: string | null;
  from_group_name: string | null;
  to_group_id: string | null;
  to_group_name: string | null;
  /** The day the promotion took effect (YYYY-MM-DD). */
  effective_on: string;
  note: string | null;
  changed_by_name: string | null;
  created_at: string;
}

export interface PromoteInput {
  to_level_id: string;
  /** A group of the new level to join on the day; the group of the old level is left on the day. */
  to_group_id?: string | null;
  /** YYYY-MM-DD; the server defaults to today in the academy's calendar. */
  effective_on?: string | null;
  note?: string | null;
  allow_over_capacity?: boolean;
}

export interface Promotion {
  history_id: string;
  from_level_id: string | null;
  to_level_id: string;
  to_level_name: string | null;
  from_group_id: string | null;
  to_group_id: string | null;
  effective_on: string;
}

export function listLevels(): Promise<{ levels: Level[] }> {
  return apiFetch("/api/levels");
}

export function createLevel(input: { name: string; sort_order?: number }): Promise<{ levelId: string }> {
  return apiFetch("/api/levels", { method: "POST", body: JSON.stringify(input) });
}

export function updateLevel(
  id: string,
  patch: { name?: string; sort_order?: number; is_active?: boolean },
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/levels/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function deleteLevel(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/levels/${id}`, { method: "DELETE" });
}

export function promoteStudent(
  studentId: string,
  input: PromoteInput,
): Promise<{ ok: boolean; promotion: Promotion; history: LevelHistoryItem[] }> {
  return apiFetch(`/api/students/${studentId}/promote`, { method: "POST", body: JSON.stringify(input) });
}

export function getLevelHistory(
  studentId: string,
): Promise<{ level_id: string | null; level_name: string | null; history: LevelHistoryItem[] }> {
  return apiFetch(`/api/students/${studentId}/level-history`);
}
