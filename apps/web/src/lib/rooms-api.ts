/**
 * Rooms (docs/centre-profile/02-COHERENCE-AUDIT §3) — the API client for /api/rooms. A module of
 * its own, like `levels-api.ts`: every call here sits behind the `centre` switch (402 for a Quran
 * academy), so nothing in `api.ts` grows a room.
 */
import { apiFetch } from "@/lib/api";

export interface Room {
  id: string;
  name: string;
  /** Seats the room holds; null = not said. */
  capacity: number | null;
  position: number;
  is_active: boolean;
  /** How many groups sit in this room — what stops a delete. */
  groups_count: number;
}

export function listRooms(): Promise<{ rooms: Room[] }> {
  return apiFetch("/api/rooms");
}

export function createRoom(input: { name: string; capacity?: number | null; position?: number }): Promise<{ roomId: string }> {
  return apiFetch("/api/rooms", { method: "POST", body: JSON.stringify(input) });
}

export function updateRoom(
  id: string,
  patch: { name?: string; capacity?: number | null; position?: number; is_active?: boolean },
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/rooms/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function deleteRoom(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/rooms/${id}`, { method: "DELETE" });
}
