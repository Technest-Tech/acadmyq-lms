"use client";

import { Copy, Film, Pencil, Plus, Trash2, Video, Video as VideoJoin } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { RoomModal } from "@/components/video-classroom/room-modal";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  deleteVideoRoom,
  listVideoRecordings,
  listVideoRooms,
  roomShareUrl,
  type RoomRecording,
  type VideoRoom,
} from "@/lib/api";

// ── Status badges ────────────────────────────────────────────────────────────

function RoomStatusBadge({ status }: { status: VideoRoom["status"] }) {
  const t = useTranslations("videoClassroom");
  const cls =
    status === "ACTIVE"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
      : "bg-muted text-muted-foreground";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      {t(`status.${status}`)}
    </span>
  );
}

function RecordingStatusBadge({ status }: { status: RoomRecording["status"] }) {
  const t = useTranslations("videoClassroom");
  const cls =
    status === "COMPLETED"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
      : status === "FAILED" || status === "ABORTED"
        ? "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300"
        : "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      {t(`status.${status}`)}
    </span>
  );
}

// ── Screen ─────────────────────────────────────────────────────────────────────

/**
 * Video Classroom management screen (Phase 2). Permission-gated by room.read; owners create/
 * manage rooms (room.create / room.manage) and view recordings (recording.view). The live call
 * runs in the Flutter client, so this surface is rooms + recordings management only.
 */
export function VideoClassroomScreen() {
  const t = useTranslations("videoClassroom");
  const locale = useLocale();
  const { can } = useAuth();

  const [rooms, setRooms] = useState<VideoRoom[] | null>(null);
  const [recordings, setRecordings] = useState<RoomRecording[] | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<VideoRoom | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const canRead = can("room.read");
  const canViewRecordings = can("recording.view");

  const refresh = useCallback(() => {
    if (!canRead) return;
    listVideoRooms()
      .then((r) => setRooms(r.rooms))
      .catch(() => setRooms([]));
    if (canViewRecordings) {
      listVideoRecordings()
        .then((r) => setRecordings(r.recordings))
        .catch(() => setRecordings([]));
    }
  }, [canRead, canViewRecordings]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!canRead) {
    return <p className="text-muted-foreground text-sm">{t("noPermission")}</p>;
  }

  async function archive(room: VideoRoom) {
    if (!window.confirm(t("archiveConfirm"))) return;
    await deleteVideoRoom(room.id);
    setFlash(t("archived"));
    refresh();
  }

  async function copyLink(room: VideoRoom) {
    const url = roomShareUrl(room.join_token);
    try {
      await navigator.clipboard.writeText(url);
      setFlash(t("linkCopied"));
    } catch {
      setFlash(url); // clipboard blocked → surface the URL so it can be copied manually
    }
  }

  function joinRoom(room: VideoRoom) {
    window.open(roomShareUrl(room.join_token), "_blank", "noopener,noreferrer");
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">{t("subtitle")}</p>
        </div>
        {can("room.create") && (
          <Button
            type="button"
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
          >
            <Plus className="size-4" aria-hidden />
            {t("createRoom")}
          </Button>
        )}
      </div>

      {flash && (
        <AlertBanner
          variant="success"
          message={flash}
          onDismiss={() => setFlash(null)}
        />
      )}

      {/* Rooms */}
      <section className="space-y-3">
        <h2 className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
          {t("roomsTitle")}
        </h2>
        {rooms === null ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="bg-card h-28 animate-pulse rounded-2xl border shadow-sm"
                aria-hidden
              />
            ))}
          </div>
        ) : rooms.length === 0 ? (
          <p className="text-muted-foreground bg-card rounded-2xl border p-6 text-sm shadow-sm">
            {t("empty")}
          </p>
        ) : (
          <div
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
            data-testid="video-rooms"
          >
            {rooms.map((room) => (
              <article
                key={room.id}
                data-testid="video-room-card"
                className="bg-card flex flex-col gap-3 rounded-2xl border p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-xl">
                      <Video className="size-5" aria-hidden />
                    </span>
                    <span className="truncate font-medium">{room.name}</span>
                  </div>
                  <RoomStatusBadge status={room.status} />
                </div>
                <p className="text-muted-foreground text-xs">{t("shareHint")}</p>
                <div className="mt-auto flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="xs"
                    onClick={() => joinRoom(room)}
                    data-testid={`join-${room.id}`}
                  >
                    <VideoJoin className="size-3.5" aria-hidden />
                    {t("join")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() => copyLink(room)}
                    data-testid={`copy-link-${room.id}`}
                  >
                    <Copy className="size-3.5" aria-hidden />
                    {t("copyLink")}
                  </Button>
                  {can("room.manage") && (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={() => {
                          setEditing(room);
                          setModalOpen(true);
                        }}
                      >
                        <Pencil className="size-3.5" aria-hidden />
                        {t("edit")}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={() => archive(room)}
                        data-testid={`archive-${room.id}`}
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                        {t("archive")}
                      </Button>
                    </>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* Recordings */}
      {canViewRecordings && (
        <section className="space-y-3">
          <h2 className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
            {t("recordingsTitle")}
          </h2>
          {recordings === null ? (
            <div className="bg-card h-24 animate-pulse rounded-2xl border shadow-sm" />
          ) : recordings.length === 0 ? (
            <p className="text-muted-foreground bg-card rounded-2xl border p-6 text-sm shadow-sm">
              {t("recordingsEmpty")}
            </p>
          ) : (
            <div
              className="bg-card divide-y overflow-hidden rounded-2xl border shadow-sm"
              data-testid="video-recordings"
            >
              {recordings.map((rec) => (
                <div
                  key={rec.id}
                  className="flex items-center justify-between gap-3 p-3.5 text-sm"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Film className="text-muted-foreground size-4 shrink-0" aria-hidden />
                    <span className="truncate">
                      {new Date(rec.created_at).toLocaleString(locale)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    {rec.duration_s != null && (
                      <span className="text-muted-foreground tabular-nums">
                        {Math.round(rec.duration_s / 60)} {t("minutesShort")}
                      </span>
                    )}
                    <RecordingStatusBadge status={rec.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <RoomModal
        open={modalOpen}
        room={editing}
        onClose={() => setModalOpen(false)}
        onSaved={(message) => {
          setModalOpen(false);
          setFlash(message);
          refresh();
        }}
      />
    </div>
  );
}
