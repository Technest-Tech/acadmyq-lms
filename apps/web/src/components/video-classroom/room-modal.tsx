"use client";

import { Eye, Hand, KeyRound, Lock, ShieldCheck, SlidersHorizontal, Video } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import {
  createVideoRoom,
  updateVideoRoom,
  type RoomAccessSettings,
  type VideoRoom,
} from "@/lib/api";

const MIN_PASSWORD_LEN = 4;

/** Which side(s) of the room a password protects (08-ROOM-ACCESS §14). */
type PasswordMode = "none" | "teacher" | "student" | "both";
const PASSWORD_MODES: readonly PasswordMode[] = ["none", "teacher", "student", "both"];

/** A native checkbox styled as an accessible on/off switch (label association preserved). */
function Switch({
  checked,
  onChange,
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  "aria-label"?: string;
}) {
  return (
    <span className="relative inline-flex h-5 w-9 shrink-0 items-center">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        aria-label={ariaLabel}
        className="peer absolute inset-0 z-10 m-0 cursor-pointer opacity-0"
      />
      <span className="bg-input peer-checked:bg-primary peer-focus-visible:ring-primary/30 block h-5 w-9 rounded-full transition-colors peer-focus-visible:ring-2" />
      <span className="pointer-events-none absolute start-0.5 size-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4 rtl:peer-checked:-translate-x-4" />
    </span>
  );
}

/** A bordered settings row: icon + title + helper text, with a trailing switch. */
function ToggleRow({
  icon: Icon,
  title,
  help,
  checked,
  onChange,
}: {
  icon: typeof Lock;
  title: string;
  help?: string;
  checked: boolean;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-3 transition-colors",
        checked ? "border-primary/30 bg-primary/5" : "border-border bg-background",
      )}
    >
      <label className="flex cursor-pointer items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2.5">
          <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden />
          <span className="text-sm font-medium">{title}</span>
        </span>
        <Switch checked={checked} onChange={onChange} />
      </label>
      {help && <p className="text-muted-foreground mt-1.5 ms-[26px] text-xs">{help}</p>}
    </div>
  );
}

/** A titled form section with a leading icon. */
function Section({ icon: Icon, title, children }: { icon: typeof Lock; title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="bg-muted text-muted-foreground grid size-6 place-items-center rounded-md">
          <Icon className="size-3.5" aria-hidden />
        </span>
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      {children}
    </section>
  );
}

/**
 * Create / edit a video room. When `room` is null it creates; otherwise it edits. Owner-only
 * (room.create / room.manage are enforced server-side); the academy owns the room (V-CTL-1).
 *
 * Reduced (08-ROOM-ACCESS §14) to the essentials: name, an optional 4-way password (None / Teacher /
 * Student / Both → host_password / guest_password), the guest waiting list, and whether recording is
 * allowed (recording itself is on-demand — a host starts it from the call). The room.monitor-gated
 * supervisor subsection is preserved. Links are auto-generated short links — no slug field. Every
 * password is OPTIONAL (blank = none); settings the form omits keep their server defaults on edit.
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
  const { can } = useAuth();
  const canMonitor = can("room.monitor");

  const [name, setName] = useState("");
  const [passwordMode, setPasswordMode] = useState<PasswordMode>("none");
  const [teacherPassword, setTeacherPassword] = useState("");
  const [studentPassword, setStudentPassword] = useState("");
  const [waitingRoom, setWaitingRoom] = useState(false);
  const [recordingEnabled, setRecordingEnabled] = useState(true);
  // Supervisor mode (08-ROOM-ACCESS §5) — only editable by room.monitor holders.
  const [monitorEnabled, setMonitorEnabled] = useState(false);
  const [monitorDisclose, setMonitorDisclose] = useState(true);
  // Ghost waiting room (08-ROOM-ACCESS §13): make the observer knock for the host's consent first.
  const [ghostWaitingRoom, setGhostWaitingRoom] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = room !== null;

  useEffect(() => {
    if (!open) return;
    setName(room?.name ?? "");
    const c = room?.config;
    const hp = c?.host_password ?? "";
    const gp = c?.guest_password ?? "";
    setTeacherPassword(hp);
    setStudentPassword(gp);
    setPasswordMode(hp && gp ? "both" : hp ? "teacher" : gp ? "student" : "none");
    setWaitingRoom(c?.waiting_room ?? false);
    setRecordingEnabled(c?.recording_enabled ?? true);
    setMonitorEnabled(c?.monitor_enabled ?? false);
    setMonitorDisclose(c?.monitor_disclose ?? true);
    setGhostWaitingRoom(c?.ghost_waiting_room ?? false);
    setError(null);
  }, [open, room]);

  const teacherOn = passwordMode === "teacher" || passwordMode === "both";
  const studentOn = passwordMode === "student" || passwordMode === "both";

  function buildSettings(): Partial<RoomAccessSettings> {
    const tp = teacherPassword.trim();
    const sp = studentPassword.trim();
    const s: Partial<RoomAccessSettings> = {
      // null clears the password on edit (e.g. switching a side off); blank also means "no password".
      host_password: teacherOn && tp !== "" ? tp : null,
      guest_password: studentOn && sp !== "" ? sp : null,
      waiting_room: waitingRoom,
      recording_enabled: recordingEnabled,
    };
    // Only a room.monitor holder edits supervisor settings (avoids a plain manager clobbering them).
    if (canMonitor) {
      s.monitor_enabled = monitorEnabled;
      s.monitor_disclose = monitorDisclose;
      s.ghost_waiting_room = ghostWaitingRoom;
    }
    return s;
  }

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;

    const tp = teacherPassword.trim();
    const sp = studentPassword.trim();
    if (
      (teacherOn && tp !== "" && tp.length < MIN_PASSWORD_LEN) ||
      (studentOn && sp !== "" && sp.length < MIN_PASSWORD_LEN)
    ) {
      setError(t("passwordTooShort"));
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const settings = buildSettings();
      if (isEdit) {
        await updateVideoRoom(room.id, { name: trimmed, settings });
        onSaved(t("saved"));
      } else {
        await createVideoRoom({ name: trimmed, settings });
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
      size="lg"
      title={t(isEdit ? "editModalTitle" : "createModalTitle")}
      description={t("subtitle")}
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
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {/* Room details */}
        <Section icon={Video} title={t("sectionDetails")}>
          <div className="space-y-1.5">
            <label htmlFor="room-name" className="text-sm font-medium">
              {t("nameLabel")}
            </label>
            <div className="relative">
              <Video className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2" aria-hidden />
              <input
                id="room-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("namePlaceholder")}
                autoFocus
                className={cn(inputClass, "ps-9")}
              />
            </div>
            <p className="text-muted-foreground text-xs">{t("nameHelp")}</p>
          </div>
        </Section>

        <div className="border-t" />

        {/* Access & security — None / Teacher only / Student only / Both */}
        <Section icon={ShieldCheck} title={t("sectionAccess")}>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              {t("passwordModeLabel")}{" "}
              <span className="text-muted-foreground font-normal">({t("optional")})</span>
            </label>
            <div
              role="group"
              aria-label={t("passwordModeLabel")}
              className="bg-muted/60 grid grid-cols-2 gap-1 rounded-xl p-1 sm:grid-cols-4"
            >
              {PASSWORD_MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPasswordMode(m)}
                  aria-pressed={passwordMode === m}
                  data-testid={`pw-mode-${m}`}
                  className={cn(
                    "rounded-lg px-2.5 py-1.5 text-sm font-medium transition-all",
                    passwordMode === m
                      ? "bg-background text-foreground shadow-sm ring-1 ring-border"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t(`passwordMode.${m}`)}
                </button>
              ))}
            </div>

            {(teacherOn || studentOn) && (
              <div className="grid gap-3 pt-2 sm:grid-cols-2">
                {teacherOn && (
                  <div className="space-y-1.5">
                    <label htmlFor="room-teacher-password" className="flex items-center gap-1.5 text-sm font-medium">
                      <KeyRound className="text-muted-foreground size-3.5" aria-hidden />
                      {t("teacherPasswordLabel")}
                    </label>
                    <input
                      id="room-teacher-password"
                      type="text"
                      autoComplete="off"
                      value={teacherPassword}
                      onChange={(e) => setTeacherPassword(e.target.value)}
                      placeholder={t("teacherPasswordPlaceholder")}
                      className={inputClass}
                    />
                  </div>
                )}
                {studentOn && (
                  <div className="space-y-1.5">
                    <label htmlFor="room-student-password" className="flex items-center gap-1.5 text-sm font-medium">
                      <Lock className="text-muted-foreground size-3.5" aria-hidden />
                      {t("studentPasswordLabel")}
                    </label>
                    <input
                      id="room-student-password"
                      type="text"
                      autoComplete="off"
                      value={studentPassword}
                      onChange={(e) => setStudentPassword(e.target.value)}
                      placeholder={t("studentPasswordPlaceholder")}
                      className={inputClass}
                    />
                  </div>
                )}
              </div>
            )}
            <p className="text-muted-foreground text-xs">{t("passwordModeHelp")}</p>
          </div>
        </Section>

        <div className="border-t" />

        {/* Options — guest waiting list + allow recording */}
        <Section icon={SlidersHorizontal} title={t("sectionOptions")}>
          <div className="grid gap-3 sm:grid-cols-2">
            <ToggleRow
              icon={KeyRound}
              title={t("waitingRoom")}
              help={t("waitingRoomHelp")}
              checked={waitingRoom}
              onChange={(e) => setWaitingRoom(e.target.checked)}
            />
            <ToggleRow
              icon={Video}
              title={t("recordingEnabled")}
              help={t("recordingEnabledHelp")}
              checked={recordingEnabled}
              onChange={(e) => setRecordingEnabled(e.target.checked)}
            />
          </div>
        </Section>

        {/* Supervisor mode — management-only (room.monitor) */}
        {canMonitor && (
          <>
            <div className="border-t" />
            <Section icon={Eye} title={t("monitorTitle")}>
              <ToggleRow
                icon={Eye}
                title={t("monitorEnabledLabel")}
                help={t("monitorRoleHint")}
                checked={monitorEnabled}
                onChange={(e) => setMonitorEnabled(e.target.checked)}
              />
              {monitorEnabled && (
                <ToggleRow
                  icon={ShieldCheck}
                  title={t("monitorDiscloseLabel")}
                  checked={monitorDisclose}
                  onChange={(e) => setMonitorDisclose(e.target.checked)}
                />
              )}
              {monitorEnabled && !monitorDisclose && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                  {t("monitorCovertWarning")}
                </p>
              )}
              {monitorEnabled && (
                <ToggleRow
                  icon={Hand}
                  title={t("ghostWaitingRoom")}
                  help={t("ghostWaitingRoomHelp")}
                  checked={ghostWaitingRoom}
                  onChange={(e) => setGhostWaitingRoom(e.target.checked)}
                />
              )}
            </Section>
          </>
        )}

        {error && (
          <p className="border-destructive/30 bg-destructive/5 text-destructive rounded-lg border px-3 py-2 text-sm">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
