"use client";

import {
  Check,
  ChevronDown,
  Circle,
  Copy,
  Download,
  ExternalLink,
  Eye,
  Film,
  KeyRound,
  LayoutGrid,
  Loader2,
  Lock,
  Pencil,
  Play,
  Plus,
  Radio,
  ScrollText,
  Search,
  Table as TableIcon,
  Trash2,
  Users,
  Video,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { RecordingPlayer } from "@/components/video-classroom/recording-player";
import { RoomModal } from "@/components/video-classroom/room-modal";
import { AlertBanner } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  deleteRecording,
  deleteVideoRoom,
  getRecordingUrl,
  listVideoRecordings,
  listVideoRooms,
  roomShareUrl,
  type RoomRecording,
  type VideoRoom,
} from "@/lib/api";

// ── Formatters ──────────────────────────────────────────────────────────────────

/** Human-readable byte size (MB/GB), or "—" when unknown. */
function formatBytes(bytes: number | null, locale: string): string {
  if (bytes == null || bytes <= 0) return "—";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(mb / 1024)} GB`;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: mb < 10 ? 1 : 0 }).format(mb)} MB`;
}

/** Compact clock for a recording's runtime (`h:mm:ss` / `m:ss`), or null when unknown. */
function formatClock(seconds: number | null): string | null {
  if (seconds == null || seconds <= 0) return null;
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, "0");
  return h > 0
    ? `${h}:${mm}:${String(sec).padStart(2, "0")}`
    : `${mm}:${String(sec).padStart(2, "0")}`;
}

// ── Badges & chips ────────────────────────────────────────────────────────────

function RoomStatusBadge({ status }: { status: VideoRoom["status"] }) {
  const t = useTranslations("videoClassroom");
  const active = status === "ACTIVE";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        active
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
          : "bg-muted text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          active ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground/50",
        )}
        aria-hidden
      />
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
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {t(`status.${status}`)}
    </span>
  );
}

/** Small chips summarising a room's access settings (password / waiting list / recording). */
function SettingChips({ room, hasRecording }: { room: VideoRoom; hasRecording: boolean }) {
  const t = useTranslations("videoClassroom");
  const c = room.config;
  const hasPassword = !!(c?.host_password || c?.guest_password);
  const chips: Array<{ key: string; icon: typeof Lock; label: string }> = [];
  if (hasPassword) chips.push({ key: "pw", icon: Lock, label: t("chipPassword") });
  if (c?.waiting_room) chips.push({ key: "wait", icon: Users, label: t("chipWaiting") });
  if (hasRecording || c?.recording_enabled)
    chips.push({ key: "rec", icon: Radio, label: t("chipRecording") });
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium"
        >
          <chip.icon className="size-3" aria-hidden />
          {chip.label}
        </span>
      ))}
    </div>
  );
}

// ── Screen ─────────────────────────────────────────────────────────────────────

type RoomView = "cards" | "table";
type PageTab = "rooms" | "recordings";
type SortKey = "name" | "status" | "created";
type SortState = { key: SortKey; dir: "asc" | "desc" } | null;
type LinkKind = "guest" | "host" | "monitor";

/** Visual + behavioural metadata for the three shareable room links (guest / host / monitor). */
const LINK_TONES: Record<LinkKind, { icon: typeof Users; badge: string }> = {
  guest: { icon: Users, badge: "bg-primary/10 text-primary" },
  host: {
    icon: KeyRound,
    badge: "bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300",
  },
  monitor: {
    icon: Eye,
    badge: "bg-slate-200 text-slate-700 dark:bg-slate-800/70 dark:text-slate-300",
  },
};

/**
 * Video Classroom management screen. Permission-gated by room.read; owners create/manage rooms
 * (room.create / room.manage) and view recordings (recording.view). Rooms render as polished cards
 * — each exposing the FULL guest / host / supervisor (spy) links — or a filterable/sortable table
 * (toggle). Recordings open in a professional player modal. The live call runs at /r/{token}.
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
  const [playing, setPlaying] = useState<RoomRecording | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [deletingRecId, setDeletingRecId] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // View / filter / sort state (all client-side over the academy's room list).
  const [tab, setTab] = useState<PageTab>("rooms");
  const [view, setView] = useState<RoomView>("cards");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [passwordFilter, setPasswordFilter] = useState("");
  const [recordingFilter, setRecordingFilter] = useState("");
  const [sort, setSort] = useState<SortState>(null);

  const canRead = can("room.read");
  const canViewRecordings = can("recording.view");
  const canManage = can("room.manage");
  const canMonitor = can("room.monitor");

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

  // Room ids that have at least one recording (for the "has recordings" filter + chip).
  const recordingRoomIds = useMemo(
    () => new Set((recordings ?? []).map((r) => r.room_id)),
    [recordings],
  );
  const roomNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rooms ?? []) m.set(r.id, r.name);
    return m;
  }, [rooms]);

  const visibleRooms = useMemo(() => {
    let list = rooms ?? [];
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((r) => r.name.toLowerCase().includes(q));
    if (statusFilter) list = list.filter((r) => r.status === statusFilter);
    if (passwordFilter) {
      list = list.filter((r) => {
        const hasPw = !!(r.config?.host_password || r.config?.guest_password);
        return passwordFilter === "with" ? hasPw : !hasPw;
      });
    }
    if (recordingFilter) {
      list = list.filter((r) => {
        const hasRec = recordingRoomIds.has(r.id);
        return recordingFilter === "with" ? hasRec : !hasRec;
      });
    }
    if (sort) {
      const dir = sort.dir === "asc" ? 1 : -1;
      list = [...list].sort((a, b) => {
        let cmp = 0;
        if (sort.key === "name") cmp = a.name.localeCompare(b.name, locale);
        else if (sort.key === "status") cmp = a.status.localeCompare(b.status);
        else cmp = a.created_at.localeCompare(b.created_at);
        return cmp * dir;
      });
    }
    return list;
  }, [rooms, search, statusFilter, passwordFilter, recordingFilter, sort, recordingRoomIds, locale]);

  const activeCount = useMemo(
    () => (rooms ?? []).filter((r) => r.status === "ACTIVE").length,
    [rooms],
  );

  if (!canRead) {
    return <p className="text-muted-foreground text-sm">{t("noPermission")}</p>;
  }

  async function archive(room: VideoRoom) {
    if (!window.confirm(t("archiveConfirm"))) return;
    await deleteVideoRoom(room.id);
    setFlash(t("archived"));
    refresh();
  }

  function copyTo(url: string, key: string, message: string) {
    navigator.clipboard.writeText(url).then(
      () => {
        setCopiedKey(key);
        setFlash(message);
        setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
      },
      () => setFlash(url), // clipboard blocked → surface the URL so it can be copied manually
    );
  }

  // Every link is the SHORT join_token link now (/r/{kebab-name}-{code}); the slug form is retired.
  const copyLink = (room: VideoRoom) =>
    copyTo(roomShareUrl(room.join_token), `${room.id}:guest`, t("linkCopied"));
  const copyHostLink = (room: VideoRoom) =>
    room.host_token && copyTo(roomShareUrl(room.host_token), `${room.id}:host`, t("hostLinkCopied"));
  const copyMonitorLink = (room: VideoRoom) =>
    room.monitor_token &&
    copyTo(roomShareUrl(room.monitor_token), `${room.id}:monitor`, t("monitorLinkCopied"));

  function joinRoom(room: VideoRoom) {
    window.open(roomShareUrl(room.join_token), "_blank", "noopener,noreferrer");
  }

  function openEdit(room: VideoRoom) {
    setEditing(room);
    setModalOpen(true);
  }

  // Fetch a fresh presigned URL on demand and trigger a download (never store the link).
  async function downloadRecording(rec: RoomRecording) {
    setDownloadingId(rec.id);
    try {
      const { url } = await getRecordingUrl(rec.id);
      const a = document.createElement("a");
      a.href = url;
      a.download = `recording-${rec.id}.mp4`;
      a.rel = "noopener";
      a.click();
    } catch {
      setFlash(t("recordingUnavailable"));
    } finally {
      setDownloadingId(null);
    }
  }

  // Permanently delete a recording (room.manage). Confirm first, then refresh the list.
  async function removeRecording(rec: RoomRecording) {
    if (!window.confirm(t("deleteRecordingConfirm"))) return;
    setDeletingRecId(rec.id);
    try {
      await deleteRecording(rec.id);
      if (playing?.id === rec.id) setPlaying(null);
      setFlash(t("recordingDeleted"));
      refresh();
    } catch {
      setFlash(t("recordingUnavailable"));
    } finally {
      setDeletingRecId(null);
    }
  }

  function toggleSort(key: SortKey) {
    setSort((prev) =>
      prev?.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" },
    );
  }

  const hasRooms = rooms !== null && rooms.length > 0;

  // A single shareable-link row (icon + role + FULL url + copy + open), reused across all roles.
  function LinkRow({ room, kind }: { room: VideoRoom; kind: LinkKind }) {
    const token =
      kind === "guest" ? room.join_token : kind === "host" ? room.host_token : room.monitor_token;
    if (!token) return null;

    const url = roomShareUrl(token);
    const tone = LINK_TONES[kind];
    const Icon = tone.icon;
    const label = t(`${kind}Role`);
    const copyKey = `${room.id}:${kind}`;
    const copied = copiedKey === copyKey;
    const onCopy =
      kind === "guest" ? () => copyLink(room) : kind === "host" ? () => copyHostLink(room) : () => copyMonitorLink(room);
    const copyTestId =
      kind === "guest"
        ? `copy-link-${room.id}`
        : kind === "host"
          ? `copy-host-link-${room.id}`
          : `copy-monitor-link-${room.id}`;

    return (
      <div className="group/link flex items-center gap-2.5 px-2.5 py-2">
        <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", tone.badge)}>
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <span className="text-xs font-semibold">{label}</span>
          <code
            dir="ltr"
            title={url}
            className="text-muted-foreground mt-0.5 block truncate text-[11px] leading-tight"
          >
            {url}
          </code>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={onCopy}
            aria-label={t("copyLink")}
            title={t("copyLink")}
            data-testid={copyTestId}
            className={cn(
              "flex size-7 items-center justify-center rounded-md transition-colors",
              copied
                ? "text-emerald-600"
                : "text-muted-foreground hover:bg-background hover:text-foreground",
            )}
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          </button>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t("openLink")}
            title={t("openLink")}
            className="text-muted-foreground hover:bg-background hover:text-foreground flex size-7 items-center justify-center rounded-md transition-colors"
          >
            <ExternalLink className="size-3.5" />
          </a>
        </div>
      </div>
    );
  }

  // The full set of links a viewer is allowed to see for a room (cards view).
  function RoomLinks({ room }: { room: VideoRoom }) {
    const showHost = canManage && !!room.host_token;
    const showMonitor = canMonitor && !!room.monitor_token;
    return (
      <div className="space-y-1.5">
        <span className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">
          {t("linksLabel")}
        </span>
        <div className="bg-muted/30 divide-border/70 divide-y overflow-hidden rounded-xl border">
          <LinkRow room={room} kind="guest" />
          {showHost && <LinkRow room={room} kind="host" />}
          {showMonitor && <LinkRow room={room} kind="monitor" />}
        </div>
      </div>
    );
  }

  // A compact, copyable guest-link preview used by the table view.
  function LinkPreview({ room }: { room: VideoRoom }) {
    const copied = copiedKey === `${room.id}:guest`;
    return (
      <div className="bg-muted/50 flex items-center gap-1.5 rounded-lg px-2 py-1">
        <code className="text-muted-foreground min-w-0 flex-1 truncate text-xs" dir="ltr">
          {roomShareUrl(room.join_token)}
        </code>
        <button
          type="button"
          onClick={() => copyLink(room)}
          aria-label={t("copyLink")}
          title={t("copyLink")}
          data-testid={`copy-link-${room.id}`}
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-md transition",
            copied
              ? "text-emerald-600"
              : "text-muted-foreground hover:bg-background hover:text-foreground",
          )}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
      </div>
    );
  }

  // Per-room actions. Cards get a prominent Join + edit/archive; the table gets a compact icon row
  // that also carries the host/monitor link copies (those live in <RoomLinks> for cards).
  function RoomActions({ room, compact }: { room: VideoRoom; compact?: boolean }) {
    if (compact) {
      return (
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <Button type="button" size="xs" onClick={() => joinRoom(room)} data-testid={`join-${room.id}`}>
            <Video className="size-3.5" aria-hidden />
          </Button>
          <Link
            href={`/video-classroom/rooms/${room.id}`}
            className={cn(buttonVariants({ variant: "outline", size: "icon-xs" }))}
            aria-label={t("logsAction")}
            title={t("logsAction")}
            data-testid={`logs-${room.id}`}
          >
            <ScrollText className="size-3.5" aria-hidden />
          </Link>
          {canManage && room.host_token && (
            <Button
              type="button"
              variant="outline"
              size="icon-xs"
              onClick={() => copyHostLink(room)}
              aria-label={t("copyHostLink")}
              title={t("copyHostLink")}
              data-testid={`copy-host-link-${room.id}`}
            >
              {copiedKey === `${room.id}:host` ? (
                <Check className="size-3.5 text-emerald-600" />
              ) : (
                <KeyRound className="size-3.5" aria-hidden />
              )}
            </Button>
          )}
          {canMonitor && room.monitor_token && (
            <Button
              type="button"
              variant="outline"
              size="icon-xs"
              onClick={() => copyMonitorLink(room)}
              aria-label={t("copyMonitorLink")}
              title={t("copyMonitorLink")}
              data-testid={`copy-monitor-link-${room.id}`}
            >
              {copiedKey === `${room.id}:monitor` ? (
                <Check className="size-3.5 text-emerald-600" />
              ) : (
                <Eye className="size-3.5" aria-hidden />
              )}
            </Button>
          )}
          {canManage && (
            <>
              <Button type="button" variant="ghost" size="icon-xs" onClick={() => openEdit(room)} aria-label={t("edit")} title={t("edit")}>
                <Pencil className="size-3.5" aria-hidden />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => archive(room)}
                aria-label={t("archive")}
                title={t("archive")}
                data-testid={`archive-${room.id}`}
              >
                <Trash2 className="size-3.5" aria-hidden />
              </Button>
            </>
          )}
        </div>
      );
    }

    return (
      <div className="flex w-full items-center gap-1.5">
        <Button
          type="button"
          size="sm"
          onClick={() => joinRoom(room)}
          data-testid={`join-${room.id}`}
          className="flex-1"
        >
          <Video className="size-4" aria-hidden />
          {t("join")}
        </Button>
        <Link
          href={`/video-classroom/rooms/${room.id}`}
          className={cn(buttonVariants({ variant: "outline", size: "icon-sm" }))}
          aria-label={t("logsAction")}
          title={t("logsAction")}
          data-testid={`logs-${room.id}`}
        >
          <ScrollText className="size-4" aria-hidden />
        </Link>
        {canManage && (
          <>
            <Button type="button" variant="outline" size="icon-sm" onClick={() => openEdit(room)} aria-label={t("edit")} title={t("edit")}>
              <Pencil className="size-4" aria-hidden />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => archive(room)}
              aria-label={t("archive")}
              title={t("archive")}
              data-testid={`archive-${room.id}`}
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          </>
        )}
      </div>
    );
  }

  function SortHeader({ label, sortKey }: { label: string; sortKey: SortKey }) {
    const active = sort?.key === sortKey;
    return (
      <button
        type="button"
        onClick={() => toggleSort(sortKey)}
        className="hover:text-foreground inline-flex items-center gap-1 transition-colors"
        data-testid={`sort-${sortKey}`}
      >
        {label}
        <ChevronDown
          className={cn(
            "size-3 transition-transform",
            active ? "opacity-100" : "opacity-35",
            active && sort?.dir === "asc" && "rotate-180",
          )}
          aria-hidden
        />
      </button>
    );
  }

  const createBtn = can("room.create") && (
    <Button
      type="button"
      size="lg"
      onClick={() => {
        setEditing(null);
        setModalOpen(true);
      }}
      className="shadow-sm shadow-primary/20"
    >
      <Plus className="size-4" aria-hidden />
      {t("createRoom")}
    </Button>
  );

  return (
    <div className="space-y-6">
      {/* Hero header */}
      <div className="from-primary/12 via-card to-card relative overflow-hidden rounded-2xl border bg-gradient-to-br p-5 shadow-sm sm:p-6">
        <div
          className="bg-primary/10 pointer-events-none absolute -end-10 -top-12 size-48 rounded-full blur-3xl"
          aria-hidden
        />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <span className="bg-primary text-primary-foreground shadow-primary/30 grid size-12 shrink-0 place-items-center rounded-2xl shadow-lg">
              <Video className="size-6" aria-hidden />
            </span>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
              <p className="text-muted-foreground mt-0.5 text-sm">{t("subtitle")}</p>
            </div>
          </div>
          {createBtn}
        </div>
        {hasRooms && (
          <div className="relative mt-5 flex flex-wrap gap-2.5">
            <StatPill icon={LayoutGrid} value={rooms.length} label={t("statRooms")} />
            <StatPill icon={Radio} value={activeCount} label={t("statActive")} accent />
            {canViewRecordings && (
              <StatPill icon={Film} value={recordings?.length ?? 0} label={t("statRecordings")} />
            )}
          </div>
        )}
      </div>

      {flash && <AlertBanner variant="success" message={flash} onDismiss={() => setFlash(null)} />}

      {/* Tabs — Rooms / Recordings (recordings tab only when the viewer can see them) */}
      {canViewRecordings && (
        <div
          role="tablist"
          aria-label={t("title")}
          className="bg-muted/40 flex gap-1 rounded-2xl border p-1.5 shadow-sm sm:max-w-md"
        >
          {([
            { key: "rooms", icon: LayoutGrid, label: t("roomsTitle") },
            { key: "recordings", icon: Film, label: t("recordingsTitle") },
          ] as const).map(({ key, icon: Icon, label }) => {
            const selected = tab === key;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setTab(key)}
                data-testid={`video-tab-${key}`}
                className={cn(
                  "flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all",
                  selected
                    ? "bg-card text-foreground shadow-sm ring-1 ring-black/5"
                    : "text-muted-foreground hover:bg-card/50 hover:text-foreground",
                )}
              >
                <Icon className="size-4" aria-hidden />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Rooms */}
      {tab === "rooms" && (
      <section className="space-y-3" role="tabpanel" aria-label={t("roomsTitle")}>

        {/* Toolbar: search + filters + view toggle (only once there are rooms to act on) */}
        {hasRooms && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-48 flex-1">
              <Search className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2" />
              <input
                type="search"
                aria-label={t("searchRooms")}
                placeholder={t("searchRooms")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="room-search"
                className="border-input bg-background focus:border-primary focus:ring-primary/15 h-8 w-full rounded-lg border ps-9 pe-3 text-sm outline-none transition-colors focus:ring-3"
              />
            </div>
            <FilterSelect
              label={t("filterAllStatus")}
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "ACTIVE", label: t("status.ACTIVE") },
                { value: "ARCHIVED", label: t("status.ARCHIVED") },
              ]}
              testId="filter-status"
            />
            <FilterSelect
              label={t("filterAllPasswords")}
              value={passwordFilter}
              onChange={setPasswordFilter}
              options={[
                { value: "with", label: t("filterWithPassword") },
                { value: "without", label: t("filterNoPassword") },
              ]}
              testId="filter-password"
            />
            {canViewRecordings && (
              <FilterSelect
                label={t("filterAllRecordings")}
                value={recordingFilter}
                onChange={setRecordingFilter}
                options={[
                  { value: "with", label: t("filterWithRecordings") },
                  { value: "without", label: t("filterNoRecordings") },
                ]}
                testId="filter-recording"
              />
            )}
            {/* Cards ⇄ Table toggle */}
            <div className="bg-muted/60 ms-auto inline-flex rounded-lg p-0.5" role="group" aria-label={t("viewLabel")}>
              {(["cards", "table"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  aria-pressed={view === v}
                  aria-label={t(v === "cards" ? "viewCards" : "viewTable")}
                  title={t(v === "cards" ? "viewCards" : "viewTable")}
                  data-testid={`view-${v}`}
                  className={cn(
                    "flex size-7 items-center justify-center rounded-md transition-colors",
                    view === v
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {v === "cards" ? <LayoutGrid className="size-4" /> : <TableIcon className="size-4" />}
                </button>
              ))}
            </div>
          </div>
        )}

        {rooms === null ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-card h-64 animate-pulse rounded-2xl border shadow-sm" aria-hidden />
            ))}
          </div>
        ) : rooms.length === 0 ? (
          <EmptyState
            title={t("empty")}
            action={createBtn}
          />
        ) : visibleRooms.length === 0 ? (
          <EmptyState title={t("noResults")} />
        ) : view === "cards" ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="video-rooms">
            {visibleRooms.map((room) => (
              <article
                key={room.id}
                data-testid="video-room-card"
                className="bg-card group relative flex flex-col overflow-hidden rounded-2xl border shadow-sm transition-all hover:border-primary/30 hover:shadow-md"
              >
                <span
                  className={cn(
                    "absolute inset-x-0 top-0 h-1",
                    room.status === "ACTIVE"
                      ? "from-primary to-primary/30 bg-gradient-to-r"
                      : "bg-border",
                  )}
                  aria-hidden
                />
                <div className="flex flex-1 flex-col gap-3.5 p-4 pt-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="bg-primary/10 text-primary grid size-10 shrink-0 place-items-center rounded-xl">
                        <Video className="size-5" aria-hidden />
                      </span>
                      <div className="min-w-0">
                        <h3 className="truncate font-semibold leading-tight">{room.name}</h3>
                        <p className="text-muted-foreground mt-0.5 text-xs">
                          {new Date(room.created_at).toLocaleDateString(locale)}
                        </p>
                      </div>
                    </div>
                    <RoomStatusBadge status={room.status} />
                  </div>
                  <SettingChips room={room} hasRecording={recordingRoomIds.has(room.id)} />
                  <RoomLinks room={room} />
                  <div className="mt-auto flex items-center gap-1.5 border-t pt-3.5">
                    <RoomActions room={room} />
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="bg-card overflow-x-auto rounded-2xl border shadow-sm" data-testid="video-rooms-table">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/30 text-muted-foreground border-b text-xs uppercase tracking-wide">
                  <th className="px-4 py-3 text-start font-semibold"><SortHeader label={t("colName")} sortKey="name" /></th>
                  <th className="px-4 py-3 text-start font-semibold"><SortHeader label={t("colStatus")} sortKey="status" /></th>
                  <th className="px-4 py-3 text-start font-semibold">{t("colSettings")}</th>
                  <th className="px-4 py-3 text-start font-semibold">{t("colLink")}</th>
                  <th className="px-4 py-3 text-start font-semibold"><SortHeader label={t("colCreated")} sortKey="created" /></th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {visibleRooms.map((room) => (
                  <tr key={room.id} data-testid="video-room-row" data-row={room.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <Video className="text-muted-foreground size-4 shrink-0" aria-hidden />
                        <span className="truncate font-medium">{room.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3"><RoomStatusBadge status={room.status} /></td>
                    <td className="px-4 py-3"><SettingChips room={room} hasRecording={recordingRoomIds.has(room.id)} /></td>
                    <td className="px-4 py-3 min-w-[220px]"><LinkPreview room={room} /></td>
                    <td className="text-muted-foreground px-4 py-3 whitespace-nowrap">
                      {new Date(room.created_at).toLocaleDateString(locale)}
                    </td>
                    <td className="px-4 py-3 text-end"><RoomActions room={room} compact /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      )}

      {/* Recordings */}
      {tab === "recordings" && canViewRecordings && (
        <section className="space-y-3" role="tabpanel" aria-label={t("recordingsTitle")}>
          {recordings === null ? (
            <div className="bg-card h-24 animate-pulse rounded-2xl border shadow-sm" />
          ) : recordings.length === 0 ? (
            <EmptyState title={t("recordingsEmpty")} />
          ) : (
            <div
              className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
              data-testid="video-recordings"
            >
              {recordings.map((rec) => {
                const playable = rec.status === "COMPLETED";
                const isDownloading = downloadingId === rec.id;
                const clock = formatClock(rec.duration_s);
                const size = formatBytes(rec.bytes, locale);
                return (
                  <article
                    key={rec.id}
                    data-testid="recording-row"
                    className="bg-card group/rec flex flex-col overflow-hidden rounded-2xl border shadow-sm transition-shadow hover:shadow-md"
                  >
                    {/* Poster — click to play */}
                    <button
                      type="button"
                      onClick={() => playable && setPlaying(rec)}
                      disabled={!playable}
                      aria-label={t("playRecording")}
                      className={cn(
                        "relative block aspect-video w-full overflow-hidden bg-gradient-to-br from-slate-800 to-slate-950",
                        playable && "cursor-pointer",
                      )}
                    >
                      <Film
                        className="absolute inset-0 m-auto size-12 text-white/10"
                        aria-hidden
                      />
                      <span className="absolute start-2 top-2 z-10">
                        <RecordingStatusBadge status={rec.status} />
                      </span>
                      {clock && (
                        <span className="absolute bottom-2 end-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white">
                          {clock}
                        </span>
                      )}
                      {playable && (
                        <span className="absolute inset-0 grid place-items-center">
                          <span className="grid size-14 place-items-center rounded-full bg-white/15 ring-1 ring-white/30 backdrop-blur-sm transition group-hover/rec:scale-105 group-hover/rec:bg-white/25">
                            <Play className="ms-0.5 size-6 fill-white text-white" aria-hidden />
                          </span>
                        </span>
                      )}
                    </button>

                    {/* Body + controls (outside the player) */}
                    <div className="flex flex-1 flex-col gap-3 p-4">
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          {roomNameById.get(rec.room_id) ?? t("metaRoomUnknown")}
                        </p>
                        <p className="text-muted-foreground mt-0.5 truncate text-xs">
                          {new Date(rec.created_at).toLocaleString(locale)}
                          {size !== "—" ? ` · ${size}` : ""}
                        </p>
                      </div>
                      <div className="mt-auto flex items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => setPlaying(rec)}
                          disabled={!playable}
                          data-testid={`play-${rec.id}`}
                          className="flex-1"
                        >
                          <Play className="size-4" aria-hidden />
                          {t("playRecording")}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-sm"
                          onClick={() => downloadRecording(rec)}
                          disabled={!playable || isDownloading}
                          aria-label={t("downloadRecording")}
                          title={t("downloadRecording")}
                          data-testid={`download-${rec.id}`}
                        >
                          {isDownloading ? (
                            <Loader2 className="size-4 animate-spin" aria-hidden />
                          ) : (
                            <Download className="size-4" aria-hidden />
                          )}
                        </Button>
                        {canManage && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => removeRecording(rec)}
                            disabled={deletingRecId === rec.id}
                            aria-label={t("deleteRecording")}
                            title={t("deleteRecording")}
                            data-testid={`delete-rec-${rec.id}`}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            {deletingRecId === rec.id ? (
                              <Loader2 className="size-4 animate-spin" aria-hidden />
                            ) : (
                              <Trash2 className="size-4" aria-hidden />
                            )}
                          </Button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {playing && (
        <RecordingPlayer
          recording={playing}
          roomName={roomNameById.get(playing.room_id)}
          onClose={() => setPlaying(null)}
          onCopied={(m) => setFlash(m)}
          onError={(m) => setFlash(m)}
        />
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

// ── Small shared bits ──────────────────────────────────────────────────────────

function StatPill({
  icon: Icon,
  value,
  label,
  accent,
}: {
  icon: typeof Users;
  value: number;
  label: string;
  accent?: boolean;
}) {
  return (
    <div className="bg-background/70 inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 backdrop-blur">
      <Icon
        className={cn("size-4", accent ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}
        aria-hidden
      />
      <span className="text-sm font-semibold tabular-nums">{value}</span>
      <span className="text-muted-foreground text-xs">{label}</span>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  testId,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  testId: string;
}) {
  const active = value !== "";
  return (
    <div className="relative">
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testId}
        className={cn(
          "h-8 cursor-pointer appearance-none rounded-lg border pe-8 ps-3 text-sm font-medium shadow-sm outline-none transition-all focus:ring-2 focus:ring-primary/20",
          active
            ? "border-primary/40 bg-primary/8 text-primary"
            : "border-input bg-background text-foreground hover:bg-muted/50 focus:border-primary",
        )}
      >
        <option value="">{label}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        className={cn(
          "pointer-events-none absolute end-2.5 top-1/2 size-3.5 -translate-y-1/2",
          active ? "text-primary" : "text-muted-foreground",
        )}
        aria-hidden
      />
    </div>
  );
}

function EmptyState({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="border-border/60 bg-muted/20 flex flex-col items-center rounded-2xl border border-dashed p-12 text-center">
      <div className="bg-muted mb-3 flex size-12 items-center justify-center rounded-full">
        <Circle className="text-muted-foreground size-5" aria-hidden />
      </div>
      <p className="text-sm font-medium">{title}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
