/**
 * A centre's group defaults (docs/centre-profile/02-COHERENCE-AUDIT §3) — the API client for
 * /api/group-defaults. A module of its own: every call sits behind the `centre` switch (402 for
 * anyone else). The money halves come back only to whoever may set them.
 */
import { apiFetch } from "@/lib/api";
import type { GroupBillingMode, GroupMode, GroupTeacherPayMode } from "@/lib/groups-api";

export interface GroupDefaults {
  lesson_minutes: number | null;
  mode: GroupMode | null;
  billing_mode?: GroupBillingMode | null;
  month_lessons?: number | null;
  teacher_pay_mode?: GroupTeacherPayMode;
  teacher_pay_minor?: number | null;
  teacher_share_bp?: number | null;
}

export function getGroupDefaults(): Promise<{ defaults: GroupDefaults }> {
  return apiFetch("/api/group-defaults");
}

export function updateGroupDefaults(patch: Partial<GroupDefaults>): Promise<{ defaults: GroupDefaults }> {
  return apiFetch("/api/group-defaults", { method: "PATCH", body: JSON.stringify(patch) });
}
