"use client";

import {
  Bug,
  CircleCheck,
  CircleX,
  FileText,
  Hourglass,
  Lock,
  MessageCircleQuestion,
  Paperclip,
  PencilLine,
  RotateCcw,
  Undo2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRef, useState, type ReactNode } from "react";
import { StatusChip, type ChipTone } from "@/components/admin/status-chip";
import { formatLocalDateTime, formatRelativeTime } from "@/lib/time";
import {
  SUPPORT_FILE_ACCEPT,
  SUPPORT_MAX_FILE_BYTES,
  SUPPORT_MAX_FILES,
  type SupportFile,
  type SupportKind,
  type SupportMessage,
  type SupportRequestDetail,
  type SupportStatus,
} from "@/lib/support-api";
import { cn } from "@/lib/utils";

/** Who is looking: the academy reads its own wording ("waiting for your reply"), the team its own. */
export type SupportAudience = "academy" | "admin";

export const STATUS_TONE: Record<SupportStatus, ChipTone> = {
  NEW: "info",
  IN_PROGRESS: "accent",
  WAITING: "warn",
  DONE: "good",
  REJECTED: "crit",
  CANCELLED: "neutral",
};

export const KIND_ICON: Record<SupportKind, LucideIcon> = {
  PROBLEM: Bug,
  CHANGE: PencilLine,
};

const EVENT_ICON: Record<string, LucideIcon> = {
  NEW: RotateCcw,
  IN_PROGRESS: CircleCheck,
  WAITING: MessageCircleQuestion,
  DONE: CircleCheck,
  REJECTED: CircleX,
  CANCELLED: Undo2,
  reopened: RotateCcw,
  answered: Hourglass,
};

export const textareaClass =
  "border-input bg-background w-full rounded-lg border px-3 py-2 text-sm leading-relaxed outline-none transition-shadow placeholder:text-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60";

function ns(audience: SupportAudience): "support" | "adminSupport" {
  return audience === "academy" ? "support" : "adminSupport";
}

export function SupportStatusChip({ status, audience }: { status: SupportStatus; audience: SupportAudience }) {
  const t = useTranslations(ns(audience));
  return (
    <StatusChip tone={STATUS_TONE[status]} dot>
      {t(`status.${status}`)}
    </StatusChip>
  );
}

export function SupportKindChip({ kind }: { kind: SupportKind }) {
  const t = useTranslations("support");
  return (
    <StatusChip tone="neutral" icon={KIND_ICON[kind]}>
      {t(`kind.${kind}`)}
    </StatusChip>
  );
}

export function UrgentChip() {
  const t = useTranslations("support");
  return <StatusChip tone="crit">{t("urgent")}</StatusChip>;
}

/**
 * The line a status change prints in the conversation. An academy's answer to a question and its
 * word on a solved request are not "accepted" or "back to review" — they get their own lines.
 */
export function eventKey(m: Pick<SupportMessage, "side" | "statusFrom" | "statusTo">): string | null {
  if (m.statusTo === null) return null;
  if (m.side === "ACADEMY" && m.statusFrom === "DONE") return "reopened";
  if (m.side === "ACADEMY" && m.statusFrom === "WAITING") return "answered";
  return m.statusTo;
}

/** Screenshots as thumbnails, anything else (a PDF) as a named chip. Each opens in a new tab. */
export function SupportFiles({ files, className }: { files: SupportFile[]; className?: string }) {
  if (files.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {files.map((file) =>
        file.type.startsWith("image/") ? (
          <a
            key={file.url}
            href={file.url}
            target="_blank"
            rel="noreferrer"
            title={file.name}
            className="bg-muted block size-20 overflow-hidden rounded-lg ring-1 ring-foreground/10 transition hover:ring-foreground/30"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived signed url, not a static asset */}
            <img src={file.url} alt={file.name} className="size-full object-cover" loading="lazy" />
          </a>
        ) : (
          <a
            key={file.url}
            href={file.url}
            target="_blank"
            rel="noreferrer"
            className="bg-muted/60 hover:bg-muted inline-flex max-w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs ring-1 ring-foreground/10"
          >
            <FileText className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{file.name}</span>
          </a>
        ),
      )}
    </div>
  );
}

/** What a reply box holds: its words and the files picked for it, checked against the server's limits. */
export function useComposer() {
  const t = useTranslations("support.composer");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);

  const addFiles = (picked: FileList | File[] | null) => {
    if (!picked) return;
    const list = Array.from(picked);
    const tooBig = list.find((f) => f.size > SUPPORT_MAX_FILE_BYTES);
    if (tooBig) {
      setError(t("tooBig", { name: tooBig.name }));
      return;
    }
    if (files.length + list.length > SUPPORT_MAX_FILES) {
      setError(t("tooMany", { n: SUPPORT_MAX_FILES }));
      return;
    }
    setError(null);
    setFiles((prev) => [...prev, ...list]);
  };

  const removeFile = (index: number) => setFiles((prev) => prev.filter((_, i) => i !== index));
  const reset = () => {
    setText("");
    setFiles([]);
    setError(null);
  };

  return { text, setText, files, addFiles, removeFile, error, setError, reset };
}

export type Composer = ReturnType<typeof useComposer>;

/** The files picked for a post, before it is sent — each removable. */
export function PickedFiles({ composer }: { composer: Composer }) {
  const t = useTranslations("support.composer");
  if (composer.files.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {composer.files.map((file, i) => (
        <li
          key={`${file.name}-${i}`}
          className="bg-muted/70 inline-flex max-w-full items-center gap-1 rounded-md py-1 ps-2 pe-1 text-xs"
        >
          <Paperclip className="size-3 shrink-0" aria-hidden />
          <span className="max-w-48 truncate">{file.name}</span>
          <button
            type="button"
            onClick={() => composer.removeFile(i)}
            className="text-muted-foreground hover:text-foreground rounded p-0.5"
            aria-label={t("remove", { name: file.name })}
          >
            <X className="size-3" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The paperclip button: opens the file picker, hands what was picked to the composer. */
export function AttachButton({ composer, disabled }: { composer: Composer; disabled?: boolean }) {
  const t = useTranslations("support.composer");
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        accept={SUPPORT_FILE_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        data-testid="support-file-input"
        onChange={(e) => {
          composer.addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => input.current?.click()}
        className="text-muted-foreground hover:text-foreground hover:bg-muted inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
      >
        <Paperclip className="size-3.5" aria-hidden />
        {t("attach")}
      </button>
    </>
  );
}

/**
 * One request's conversation: the original post, then every reply and status change in order.
 * The viewer's own side sits at the end, the other side at the start, like any chat. Status changes
 * are a quiet centred line; an internal note (team only) is amber with a lock.
 */
export function SupportThread({
  detail,
  audience,
  composer,
}: {
  detail: SupportRequestDetail;
  audience: SupportAudience;
  /** The reply box (or the "closed" note) under the conversation. */
  composer?: ReactNode;
}) {
  const t = useTranslations("support");
  const ta = useTranslations(ns(audience));
  const locale = useLocale();
  const { request, messages } = detail;
  const mine = audience === "academy" ? "ACADEMY" : "ADMIN";

  const nameFor = (side: SupportMessage["side"], author: string | null) =>
    side === "ADMIN" ? (audience === "admin" && author ? author : t("team")) : (author ?? t("you"));

  const originSide = request.source;
  const originName =
    originSide === "ADMIN" ? nameFor("ADMIN", request.createdBy) : (request.createdBy ?? t("you"));

  return (
    <div className="space-y-4" data-testid="support-thread">
      <Bubble
        own={originSide === mine}
        name={originName}
        when={request.createdAt}
        locale={locale}
        team={originSide === "ADMIN"}
      >
        {request.body.trim() !== "" ? (
          <p className="whitespace-pre-wrap break-words">{request.body}</p>
        ) : (
          <p className="text-muted-foreground italic">{t("noDetails")}</p>
        )}
        <SupportFiles files={request.attachments} className="mt-2" />
      </Bubble>

      {messages.map((m) => {
        const event = eventKey(m);
        const EventIcon = event ? (EVENT_ICON[event] ?? CircleCheck) : null;
        const hasContent = m.body.trim() !== "" || m.attachments.length > 0;
        return (
          <div key={m.id} className="space-y-2">
            {hasContent && (
              <Bubble
                own={m.side === mine}
                name={nameFor(m.side, m.author)}
                when={m.createdAt}
                locale={locale}
                internal={m.internal}
                internalLabel={audience === "admin" ? ta("internalTag") : undefined}
                team={m.side === "ADMIN"}
              >
                {m.body.trim() !== "" && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                <SupportFiles files={m.attachments} className={m.body.trim() !== "" ? "mt-2" : undefined} />
              </Bubble>
            )}
            {event && EventIcon && (
              <p
                className="text-muted-foreground flex items-center justify-center gap-1.5 text-center text-xs"
                data-testid="support-event"
              >
                <EventIcon className={cn("size-3.5", m.statusTo && toneText(m.statusTo))} aria-hidden />
                <span>{ta(`event.${event}`)}</span>
                {audience === "admin" && m.author && <span className="opacity-70">· {m.author}</span>}
                <span className="opacity-70" title={formatLocalDateTime(m.createdAt, locale)}>
                  · {formatRelativeTime(m.createdAt, locale)}
                </span>
              </p>
            )}
          </div>
        );
      })}

      {composer}
    </div>
  );
}

function toneText(status: SupportStatus): string {
  switch (STATUS_TONE[status]) {
    case "good":
      return "text-emerald-600 dark:text-emerald-400";
    case "crit":
      return "text-rose-600 dark:text-rose-400";
    case "warn":
      return "text-amber-600 dark:text-amber-400";
    case "info":
      return "text-blue-600 dark:text-blue-400";
    case "accent":
      return "text-primary";
    default:
      return "";
  }
}

function Bubble({
  own,
  name,
  when,
  locale,
  internal = false,
  internalLabel,
  team = false,
  children,
}: {
  own: boolean;
  name: string;
  when: string;
  locale: string;
  internal?: boolean;
  internalLabel?: string;
  team?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex", own ? "justify-end" : "justify-start")} data-testid={internal ? "support-internal" : undefined}>
      <div className="w-full max-w-[min(36rem,92%)]">
        <div
          className={cn(
            "text-muted-foreground mb-1 flex items-center gap-1.5 text-[11px]",
            own ? "justify-end" : "justify-start",
          )}
        >
          <span className={cn("font-semibold", team && !internal && "text-primary")}>{name}</span>
          {internal && internalLabel && (
            <span className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1 py-px font-semibold text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
              <Lock className="size-2.5" aria-hidden />
              {internalLabel}
            </span>
          )}
          <span title={formatLocalDateTime(when, locale)}>· {formatRelativeTime(when, locale)}</span>
        </div>
        <div
          className={cn(
            "rounded-2xl px-4 py-3 text-sm",
            internal
              ? "bg-amber-50 ring-1 ring-amber-200 dark:bg-amber-950/30 dark:ring-amber-900/60"
              : own
                ? "bg-primary/[0.07] ring-1 ring-primary/15"
                : "bg-card ring-1 ring-foreground/[0.08]",
            own ? "rounded-se-md" : "rounded-ss-md",
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
