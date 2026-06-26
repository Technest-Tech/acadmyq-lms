"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { createVideoRoom, updateVideoRoom, type VideoRoom } from "@/lib/api";

/**
 * Create / edit a video room. When `room` is null it creates; otherwise it edits. Owner-only
 * (room.create / room.manage are enforced server-side); the academy owns the room (V-CTL-1).
 */
export function RoomModal({
  open,
  room,
  onClose,
  onSaved,
}: {
  open: boolean;
  room: VideoRoom | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const t = useTranslations("videoClassroom");
  const [name, setName] = useState("");
  const [recordDefault, setRecordDefault] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = room !== null;

  useEffect(() => {
    if (open) {
      setName(room?.name ?? "");
      setRecordDefault(room?.record_default ?? false);
      setError(null);
    }
  }, [open, room]);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      if (isEdit) {
        await updateVideoRoom(room.id, {
          name: trimmed,
          record_default: recordDefault,
        });
        onSaved(t("saved"));
      } else {
        await createVideoRoom({ name: trimmed, record_default: recordDefault });
        onSaved(t("created"));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t(isEdit ? "editModalTitle" : "createModalTitle")}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={saving || name.trim() === ""}
          >
            {t(isEdit ? "save" : "create")}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="space-y-1.5">
          <label htmlFor="room-name" className="text-sm font-medium">
            {t("nameLabel")}
          </label>
          <input
            id="room-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("namePlaceholder")}
            autoFocus
            className="border-input bg-background focus:border-primary focus:ring-primary/15 w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:ring-3"
          />
        </div>

        <label className="flex items-center gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={recordDefault}
            onChange={(e) => setRecordDefault(e.target.checked)}
            className="border-input size-4 rounded"
          />
          {t("recordDefault")}
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
    </Modal>
  );
}
