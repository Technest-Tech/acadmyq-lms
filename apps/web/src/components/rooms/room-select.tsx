"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { fieldClass } from "@/components/groups/group-format";
import { type Room, listRooms } from "@/lib/rooms-api";
import { cn } from "@/lib/utils";

/**
 * The centre's rooms as a dropdown (docs/centre-profile/02-COHERENCE-AUDIT §3) — what the group form
 * and the timetable's "set the room" share. Switched-off rooms are hidden unless the value in hand IS
 * one (a group keeps its room pickable). `withAddLink` points at Settings, where the list is kept.
 */
export function RoomSelect({
  value,
  onChange,
  rooms,
  withAddLink = false,
  className,
  testId = "room-select",
}: {
  value: string;
  onChange: (id: string) => void;
  /** Pass the list when the caller already has it; otherwise it is fetched once. */
  rooms?: Room[];
  withAddLink?: boolean;
  className?: string;
  testId?: string;
}) {
  const t = useTranslations("rooms");
  const [loaded, setLoaded] = useState<Room[] | null>(rooms ?? null);

  useEffect(() => {
    if (rooms) {
      setLoaded(rooms);
      return;
    }
    let live = true;
    void listRooms()
      .then((res) => live && setLoaded(res.rooms))
      .catch(() => live && setLoaded([]));
    return () => {
      live = false;
    };
  }, [rooms]);

  const options = (loaded ?? []).filter((r) => r.is_active || r.id === value);

  return (
    <div className="space-y-1">
      <select
        className={cn(fieldClass, className)}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={t("select.label")}
        disabled={loaded === null}
        data-testid={testId}
      >
        <option value="">{loaded === null ? t("select.loading") : t("select.none")}</option>
        {options.map((r) => (
          <option key={r.id} value={r.id}>
            {r.capacity != null ? t("select.withCapacity", { name: r.name, capacity: r.capacity }) : r.name}
          </option>
        ))}
      </select>
      {withAddLink && loaded !== null && (
        <Link href="/settings" className="text-primary inline-block text-xs underline-offset-2 hover:underline" data-testid={`${testId}-add`}>
          {t("addLink")}
        </Link>
      )}
    </div>
  );
}
