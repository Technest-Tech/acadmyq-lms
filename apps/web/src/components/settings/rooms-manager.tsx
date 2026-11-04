"use client";

import { ArrowDown, ArrowUp, Check, DoorOpen, Eye, EyeOff, Pencil, Plus, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { SectionCard } from "@/components/settings/section-card";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { createRoom, deleteRoom, listRooms, type Room, updateRoom } from "@/lib/rooms-api";
import { cn } from "@/lib/utils";

const inputBase =
  "border-input bg-background placeholder:text-muted-foreground focus:border-primary focus:ring-primary/15 w-full rounded-xl border text-sm outline-none transition-colors focus:ring-3 disabled:opacity-50";

/** A typed seat count → a whole number ≥ 1, "" → null; anything else → undefined (refuse). */
function seats(value: string): number | null | undefined {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : undefined;
}

/**
 * Settings → the centre's rooms (docs/centre-profile/02-COHERENCE-AUDIT §3): add one with its seats,
 * rename, move up or down, switch off, delete. The order here is the order the group form and the
 * timetable's room filter show. A room groups sit in cannot be deleted (the server says so, 422) —
 * it is switched off and keeps its name on those groups.
 */
export function RoomsManager() {
  const t = useTranslations("rooms");
  const [items, setItems] = useState<Room[] | null>(null);
  const [newName, setNewName] = useState("");
  const [newSeats, setNewSeats] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editSeats, setEditSeats] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await listRooms();
      setItems(res.rooms);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await refresh();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      return false;
    }
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    const capacity = seats(newSeats);
    if (capacity === undefined) {
      setError(t("errors.capacity"));
      return;
    }
    setBusy(true);
    const ok = await run(() => createRoom(capacity === null ? { name } : { name, capacity }));
    if (ok) {
      setNewName("");
      setNewSeats("");
    }
    setBusy(false);
  }

  async function saveEdit(room: Room) {
    const name = editName.trim();
    if (!name) return;
    const capacity = seats(editSeats);
    if (capacity === undefined) {
      setError(t("errors.capacity"));
      return;
    }
    const patch: { name?: string; capacity?: number | null } = {};
    if (name !== room.name) patch.name = name;
    if (capacity !== room.capacity) patch.capacity = capacity;
    if (Object.keys(patch).length === 0) {
      setEditingId(null);
      return;
    }
    if (await run(() => updateRoom(room.id, patch))) setEditingId(null);
  }

  /** Swap positions with the neighbour: two writes, the list re-reads in its new order. */
  async function move(index: number, direction: -1 | 1) {
    if (!items) return;
    const a = items[index];
    const b = items[index + direction];
    if (!a || !b) return;
    // Positions are whatever the list holds; equal ones (a back-fill) are split by the index.
    const posA = a.position === b.position ? index : a.position;
    const posB = a.position === b.position ? index + direction : b.position;
    await run(async () => {
      await updateRoom(a.id, { position: posB });
      await updateRoom(b.id, { position: posA });
    });
  }

  return (
    <SectionCard
      icon={DoorOpen}
      title={t("cardTitle")}
      description={t("hint")}
      iconClassName="bg-gradient-to-br from-teal-500 to-emerald-500 shadow-teal-500/25"
      testId="rooms-manager"
    >
      <div className="space-y-4">
        {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}

        <form onSubmit={add} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
          <input
            aria-label={t("namePlaceholder")}
            className={cn(inputBase, "min-w-0 flex-1 px-3.5 py-2.5")}
            placeholder={t("namePlaceholder")}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            data-testid="new-room-name"
          />
          <input
            aria-label={t("capacity")}
            className={cn(inputBase, "w-28 px-3.5 py-2.5")}
            type="number"
            inputMode="numeric"
            min={1}
            placeholder={t("capacity")}
            value={newSeats}
            onChange={(e) => setNewSeats(e.target.value)}
            data-testid="new-room-capacity"
          />
          <Button type="submit" size="sm" disabled={busy || newName.trim() === ""} className="shrink-0 gap-1.5" data-testid="add-room">
            <Plus className="size-3.5" />
            {t("add")}
          </Button>
        </form>

        {items === null ? (
          <div className="flex items-center justify-center py-8">
            <div className="border-primary size-6 animate-spin rounded-full border-2 border-t-transparent" />
          </div>
        ) : items.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">{t("empty")}</p>
        ) : (
          <ol className="divide-y overflow-hidden rounded-xl border" data-testid="rooms-list">
            {items.map((room, index) => (
              <li
                key={room.id}
                className={cn("flex items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-4", !room.is_active && "bg-muted/20")}
                data-room={room.id}
              >
                <span className="text-muted-foreground w-5 shrink-0 text-center text-xs tabular-nums">{index + 1}</span>

                {editingId === room.id ? (
                  <>
                    <input
                      aria-label={t("rename")}
                      className={cn(inputBase, "min-w-0 flex-1 px-3 py-1.5")}
                      value={editName}
                      autoFocus
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void saveEdit(room);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      data-testid="edit-room-name"
                    />
                    <input
                      aria-label={t("capacity")}
                      className={cn(inputBase, "w-20 px-3 py-1.5")}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      value={editSeats}
                      onChange={(e) => setEditSeats(e.target.value)}
                      data-testid="edit-room-capacity"
                    />
                    <Button type="button" size="xs" className="shrink-0 gap-1" onClick={() => void saveEdit(room)} data-testid="save-room">
                      <Check className="size-3.5" />
                    </Button>
                    <Button type="button" variant="ghost" size="xs" className="shrink-0" onClick={() => setEditingId(null)}>
                      <X className="size-3.5" />
                    </Button>
                  </>
                ) : confirmDeleteId === room.id ? (
                  <>
                    <span className="text-destructive flex-1 text-sm">{t("confirmDelete")}</span>
                    <Button type="button" variant="ghost" size="xs" className="shrink-0" onClick={() => setConfirmDeleteId(null)}>
                      {t("cancel")}
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="xs"
                      className="shrink-0"
                      onClick={() => void run(() => deleteRoom(room.id)).then((ok) => ok && setConfirmDeleteId(null))}
                      data-testid="confirm-delete-room"
                    >
                      {t("delete")}
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="min-w-0 flex-1">
                      <span className={cn("block truncate text-sm font-medium", !room.is_active && "text-muted-foreground line-through")}>
                        {room.name}
                      </span>
                      {(room.capacity != null || room.groups_count > 0) && (
                        <span className="text-muted-foreground block text-[11px] tabular-nums">
                          {[
                            room.capacity != null ? t("seats", { count: room.capacity }) : null,
                            room.groups_count > 0 ? t("inUse", { groups: room.groups_count }) : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      )}
                    </div>
                    {!room.is_active && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800/40 dark:text-slate-400">
                        {t("inactive")}
                      </span>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="text-muted-foreground shrink-0"
                      aria-label={t("moveUp")}
                      disabled={index === 0}
                      onClick={() => void move(index, -1)}
                      data-testid={`room-up-${room.id}`}
                    >
                      <ArrowUp className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="text-muted-foreground shrink-0"
                      aria-label={t("moveDown")}
                      disabled={index === items.length - 1}
                      onClick={() => void move(index, 1)}
                      data-testid={`room-down-${room.id}`}
                    >
                      <ArrowDown className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="text-muted-foreground shrink-0"
                      aria-label={room.is_active ? t("deactivate") : t("activate")}
                      onClick={() => void run(() => updateRoom(room.id, { is_active: !room.is_active }))}
                    >
                      {room.is_active ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="text-muted-foreground shrink-0"
                      aria-label={t("rename")}
                      onClick={() => {
                        setEditingId(room.id);
                        setEditName(room.name);
                        setEditSeats(room.capacity != null ? String(room.capacity) : "");
                      }}
                      data-testid={`room-edit-${room.id}`}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="text-muted-foreground hover:text-destructive shrink-0"
                      aria-label={t("delete")}
                      onClick={() => setConfirmDeleteId(room.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </SectionCard>
  );
}
