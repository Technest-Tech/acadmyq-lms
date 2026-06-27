"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  createVideoRoom,
  updateVideoRoom,
  type RoomAccessSettings,
  type VideoRoom,
} from "@/lib/api";

const MIN_PASSWORD_LEN = 4;

/**
 * Create / edit a video room. When `room` is null it creates; otherwise it edits. Owner-only
 * (room.create / room.manage are enforced server-side); the academy owns the room (V-CTL-1).
 *
 * The "Access & settings" section edits the per-room settings stored in config JSONB
 * (docs/video-platform/08-ROOM-ACCESS-AND-MONITORING §4). Only the settings that take effect
 * server-side today are surfaced — host password (S2), waiting room (S4) and monitor (S3) arrive
 * with their phases. Every password is OPTIONAL (blank = none).
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
  // Access settings.
  const [slug, setSlug] = useState("");
  const [guestPassword, setGuestPassword] = useState("");
  const [maxParticipants, setMaxParticipants] = useState("");
  const [recordingEnabled, setRecordingEnabled] = useState(true);
  const [requireHostPresent, setRequireHostPresent] = useState(false);
  const [allowGuestScreenshare, setAllowGuestScreenshare] = useState(true);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = room !== null;

  useEffect(() => {
    if (!open) return;
    setName(room?.name ?? "");
    setRecordDefault(room?.record_default ?? false);
    const c = room?.config;
    setSlug(room?.slug ?? "");
    setGuestPassword(c?.guest_password ?? "");
    setMaxParticipants(c?.max_participants != null ? String(c.max_participants) : "");
    setRecordingEnabled(c?.recording_enabled ?? true);
    setRequireHostPresent(c?.require_host_present ?? false);
    setAllowGuestScreenshare(c?.allow_guest_screenshare ?? true);
    setError(null);
  }, [open, room]);

  function buildSettings(): Partial<RoomAccessSettings> {
    const pw = guestPassword.trim();
    const max = maxParticipants.trim();
    return {
      guest_password: pw === "" ? null : pw,
      max_participants: max === "" ? null : Number(max),
      recording_enabled: recordingEnabled,
      require_host_present: requireHostPresent,
      allow_guest_screenshare: allowGuestScreenshare,
    };
  }

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;

    const pw = guestPassword.trim();
    if (pw !== "" && pw.length < MIN_PASSWORD_LEN) {
      setError(t("passwordTooShort"));
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const settings = buildSettings();
      const slugValue = slug.trim() === "" ? null : slug.trim();
      if (isEdit) {
        await updateVideoRoom(room.id, { name: trimmed, record_default: recordDefault, slug: slugValue, settings });
        onSaved(t("saved"));
      } else {
        await createVideoRoom({ name: trimmed, record_default: recordDefault, slug: slugValue, settings });
        onSaved(t("created"));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "border-input bg-background focus:border-primary focus:ring-primary/15 w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:ring-3";

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
          <Button type="button" onClick={submit} disabled={saving || name.trim() === ""}>
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
            className={inputClass}
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

        {/* ── Access & settings ─────────────────────────────────────────── */}
        <div className="border-border/60 space-y-4 border-t pt-4">
          <p className="text-foreground text-sm font-semibold">{t("settingsTitle")}</p>

          <div className="space-y-1.5">
            <label htmlFor="room-slug" className="text-sm font-medium">
              {t("slugLabel")}{" "}
              <span className="text-muted-foreground font-normal">({t("optional")})</span>
            </label>
            <input
              id="room-slug"
              type="text"
              autoComplete="off"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder={t("slugPlaceholder")}
              className={inputClass}
            />
            <p className="text-muted-foreground text-xs">{t("slugHelp")}</p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="room-guest-password" className="text-sm font-medium">
              {t("guestPasswordLabel")}{" "}
              <span className="text-muted-foreground font-normal">({t("optional")})</span>
            </label>
            <input
              id="room-guest-password"
              type="text"
              autoComplete="off"
              value={guestPassword}
              onChange={(e) => setGuestPassword(e.target.value)}
              placeholder={t("guestPasswordPlaceholder")}
              className={inputClass}
            />
            <p className="text-muted-foreground text-xs">{t("guestPasswordHelp")}</p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="room-max" className="text-sm font-medium">
              {t("maxParticipantsLabel")}{" "}
              <span className="text-muted-foreground font-normal">({t("optional")})</span>
            </label>
            <input
              id="room-max"
              type="number"
              min={2}
              max={500}
              value={maxParticipants}
              onChange={(e) => setMaxParticipants(e.target.value)}
              placeholder={t("maxParticipantsPlaceholder")}
              className={inputClass}
            />
          </div>

          <label className="flex items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={recordingEnabled}
              onChange={(e) => setRecordingEnabled(e.target.checked)}
              className="border-input size-4 rounded"
            />
            {t("recordingEnabled")}
          </label>

          <label className="flex items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={requireHostPresent}
              onChange={(e) => setRequireHostPresent(e.target.checked)}
              className="border-input size-4 rounded"
            />
            {t("requireHostPresent")}
          </label>

          <label className="flex items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={allowGuestScreenshare}
              onChange={(e) => setAllowGuestScreenshare(e.target.checked)}
              className="border-input size-4 rounded"
            />
            {t("allowGuestScreenshare")}
          </label>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
    </Modal>
  );
}
