"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParticipants } from "@livekit/components-react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowDown, Check, ChevronDown, Lock, MessageSquare, SendHorizontal, Users, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { CHAT_MAX_LENGTH, useChatPanel, type ChatRecipient } from "./chat-context";
import { formatMessageTime, groupMessages, type ChatGroup } from "./chat-format";

const NEAR_BOTTOM_PX = 80;
const MAX_INPUT_HEIGHT_PX = 128;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "•";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/**
 * The in-call chat drawer. Desktop: an end-side slide-over (~23rem) overlaying the call; mobile: a
 * bottom-sheet (~80dvh) that slides up. Always mounted so open/close animate both ways and the
 * unread badge keeps counting; `inert` + `pointer-events-none` neutralise it while closed. Built on
 * the ChatProvider (one `useChat`), never the stock <Chat/> prefab. RTL-correct via logical props
 * and an `rtl:`-aware slide. Chat is EPHEMERAL (live participants only) — see Phase 2 for persistence.
 */
export function ChatPanel() {
  const t = useTranslations("videoCall");
  const locale = useLocale();
  const { messages, send, isSending, connected, isOpen, close } = useChatPanel();

  const groups = useMemo(() => groupMessages(messages), [messages]);

  // Direct-message targets — every other live participant. A hidden monitor sees everyone here (so
  // it can DM the teacher privately), but never appears in anyone else's list.
  const participants = useParticipants();
  const recipients = useMemo<ChatRecipient[]>(
    () =>
      participants
        .filter((p) => !p.isLocal)
        .map((p) => ({ identity: p.identity, name: p.name || p.identity })),
    [participants],
  );

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [hasNew, setHasNew] = useState(false);
  const [draft, setDraft] = useState("");
  const [sendFailed, setSendFailed] = useState(false);
  // null = everyone (public); otherwise a private direct message to that participant.
  const [recipient, setRecipient] = useState<ChatRecipient | null>(null);

  // If the chosen DM recipient leaves, fall back to Everyone — never send privately into the void.
  useEffect(() => {
    if (recipient && !recipients.some((r) => r.identity === recipient.identity)) setRecipient(null);
  }, [recipient, recipients]);

  function scrollToBottom(behavior: ScrollBehavior = "smooth") {
    const el = listRef.current;
    // `scrollTo` is missing/stubbed in jsdom — guard so tests don't throw on the rAF callback.
    if (el && typeof el.scrollTo === "function") {
      try {
        el.scrollTo({ top: el.scrollHeight, behavior });
      } catch {
        /* non-DOM test env */
      }
    }
    setHasNew(false);
  }

  function onListScroll() {
    const el = listRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = distance < NEAR_BOTTOM_PX;
    setAtBottom(near);
    if (near) setHasNew(false);
  }

  // Stick to the newest message when the reader is already at the bottom (or it's their own send);
  // otherwise surface the "new messages ↓" pill instead of yanking them away from older history.
  const last = messages[messages.length - 1];
  const lastId = last?.id;
  const seenId = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (lastId === seenId.current) return;
    const own = last?.from?.isLocal;
    const first = seenId.current === undefined;
    seenId.current = lastId;
    if (atBottom || own || first) {
      requestAnimationFrame(() => scrollToBottom(first ? "auto" : "smooth"));
    } else {
      setHasNew(true);
    }
  }, [lastId, last, atBottom]);

  // On open: focus the composer, jump to the latest message, clear the new-messages flag.
  useEffect(() => {
    if (!isOpen) return;
    inputRef.current?.focus();
    requestAnimationFrame(() => scrollToBottom("auto"));
  }, [isOpen]);

  // ESC closes the drawer (A11y).
  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, close]);

  function autoGrow() {
    const ta = inputRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, MAX_INPUT_HEIGHT_PX)}px`;
  }

  function submit() {
    const text = draft.trim();
    if (!text || isSending || !connected) return;
    setDraft("");
    setSendFailed(false);
    requestAnimationFrame(() => {
      if (inputRef.current) inputRef.current.style.height = "auto";
      inputRef.current?.focus();
    });
    // Never silently swallow a send failure — restore the draft so the user can retry.
    void send(text, recipient).catch(() => {
      setSendFailed(true);
      setDraft((d) => d || text);
    });
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  // Announce the latest INCOMING message to screen readers (own sends aren't announced).
  const announcement =
    last && !last.from?.isLocal
      ? `${last.from?.name || last.from?.identity || t("chatSomeone")}: ${last.message}`
      : "";

  const remaining = CHAT_MAX_LENGTH - draft.length;
  const canSend = draft.trim().length > 0 && !isSending && connected;

  return (
    <div className={cn("fixed inset-0 z-40 text-white", !isOpen && "pointer-events-none")}>
      {/* Backdrop — fades; tapping it closes (overlays the call, doesn't unmount it). */}
      <button
        type="button"
        aria-label={t("close")}
        tabIndex={isOpen ? 0 : -1}
        onClick={close}
        className={cn(
          "absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity duration-300",
          isOpen ? "opacity-100" : "opacity-0",
        )}
      />

      <aside
        inert={!isOpen}
        data-testid="chat-panel"
        data-open={isOpen}
        aria-label={t("chatTitle")}
        className={cn(
          "absolute flex flex-col bg-slate-900 shadow-2xl ring-1 ring-white/10 transition-transform duration-300 ease-out",
          // Desktop drawer docked to the END (right in LTR, left in RTL) — same proven inset-y-0/end-0
          // pattern as participants-panel. On mobile it becomes a full-width bottom sheet (~80dvh).
          "inset-y-0 end-0 w-full max-w-sm rounded-s-2xl",
          "max-sm:inset-y-auto max-sm:bottom-0 max-sm:max-w-none max-sm:h-[80dvh] max-sm:rounded-s-none max-sm:rounded-t-3xl",
          isOpen
            ? "translate-x-0 translate-y-0"
            : "translate-x-full rtl:-translate-x-full max-sm:translate-x-0 max-sm:translate-y-full",
        )}
      >
        {/* Mobile drag affordance. */}
        <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-white/15 sm:hidden" />

        <header className="flex items-center justify-between border-b border-white/10 px-4 py-3 pt-[calc(env(safe-area-inset-top)+0.5rem)] sm:pt-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <MessageSquare className="size-4 text-emerald-400" />
            {t("chatTitle")}
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label={t("close")}
            className="flex size-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/10 hover:text-white"
          >
            <X className="size-5" />
          </button>
        </header>

        <div className="relative flex-1 overflow-hidden">
          <div
            ref={listRef}
            onScroll={onListScroll}
            className="h-full space-y-4 overflow-y-auto px-3 py-4"
          >
            {groups.length === 0 ? (
              <EmptyState title={t("chatEmptyTitle")} body={t("chatEmptyBody")} />
            ) : (
              groups.map((g) => (
                <MessageGroup
                  key={g.key}
                  group={g}
                  locale={locale}
                  youLabel={t("chatYou")}
                  hostLabel={t("chatHostBadge")}
                  managementLabel={t("chatManagement")}
                  privateLabel={t("chatPrivate")}
                />
              ))
            )}
          </div>

          {/* "New messages ↓" pill — only while scrolled up with unseen arrivals. */}
          {hasNew && (
            <button
              type="button"
              onClick={() => scrollToBottom("smooth")}
              className="absolute inset-x-0 bottom-3 mx-auto flex w-fit items-center gap-1.5 rounded-full bg-emerald-500 px-3.5 py-1.5 text-xs font-semibold text-white shadow-lg ring-1 ring-emerald-300/40 transition hover:bg-emerald-400"
            >
              <ArrowDown className="size-3.5" />
              {t("chatNewMessages")}
            </button>
          )}
        </div>

        {/* Live region for incoming messages (A11y). */}
        <div aria-live="polite" className="sr-only">
          {announcement}
        </div>

        <footer className="border-t border-white/10 p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
          <RecipientSelector
            recipient={recipient}
            recipients={recipients}
            onSelect={setRecipient}
            everyoneLabel={t("chatEveryone")}
            toLabel={t("chatTo")}
          />
          <div
            className={cn(
              "mt-2 flex items-end gap-2 rounded-2xl bg-white/[0.06] p-1.5 ring-1 transition",
              recipient
                ? "ring-amber-400/50 focus-within:ring-amber-400/70"
                : "ring-white/10 focus-within:ring-emerald-500/60",
            )}
          >
            <label htmlFor="chat-composer" className="sr-only">
              {t("chatPlaceholder")}
            </label>
            <textarea
              id="chat-composer"
              ref={inputRef}
              rows={1}
              value={draft}
              disabled={!connected}
              maxLength={CHAT_MAX_LENGTH}
              onChange={(e) => {
                setDraft(e.target.value);
                autoGrow();
              }}
              onKeyDown={onInputKeyDown}
              placeholder={
                !connected ? t("chatConnecting") : recipient ? t("chatPrivatePlaceholder") : t("chatPlaceholder")
              }
              className="max-h-32 flex-1 resize-none bg-transparent px-2.5 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none disabled:opacity-60"
            />
            <button
              type="button"
              onClick={submit}
              disabled={!canSend}
              aria-label={t("send")}
              title={t("send")}
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-xl text-white transition disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-slate-500",
                recipient ? "bg-amber-500 hover:bg-amber-400" : "bg-emerald-500 hover:bg-emerald-400",
              )}
            >
              {recipient ? (
                <Lock className="size-4" />
              ) : (
                <SendHorizontal className="size-4 rtl:-scale-x-100" />
              )}
            </button>
          </div>
          <div className="mt-1 flex items-center justify-between px-2">
            <span className="text-[0.65rem] text-red-400">{sendFailed ? t("chatSendFailed") : ""}</span>
            {remaining <= 100 && (
              <span className={cn("text-[0.65rem]", remaining <= 0 ? "text-red-400" : "text-slate-500")}>
                {remaining}
              </span>
            )}
          </div>
        </footer>
      </aside>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
      <div className="mb-2 flex size-12 items-center justify-center rounded-full bg-white/[0.06] ring-1 ring-white/10">
        <MessageSquare className="size-5 text-slate-400" />
      </div>
      <p className="text-sm font-semibold text-slate-200">{title}</p>
      <p className="text-xs text-slate-500">{body}</p>
    </div>
  );
}

function MessageGroup({
  group,
  locale,
  youLabel,
  hostLabel,
  managementLabel,
  privateLabel,
}: {
  group: ChatGroup;
  locale: string;
  youLabel: string;
  hostLabel: string;
  managementLabel: string;
  privateLabel: string;
}) {
  const { isLocal, role, name, messages, private: priv, privateTo } = group;
  const lastTs = messages[messages.length - 1]!.timestamp;
  const displayName = isLocal ? youLabel : role === "monitor" ? managementLabel : name || youLabel;

  // OWN messages: end-aligned stack — emerald public, amber when it's a private direct message.
  if (isLocal) {
    return (
      <div className="flex flex-col items-end gap-1">
        {messages.map((m, i) => (
          <div
            key={m.id}
            className={cn(
              "max-w-[80%] rounded-2xl px-3.5 py-2 text-sm text-white shadow-sm",
              priv ? "bg-amber-600" : "bg-emerald-500",
              i === messages.length - 1 && "rounded-ee-md",
            )}
          >
            <p className="whitespace-pre-wrap break-words">{m.message}</p>
          </div>
        ))}
        <div className="flex items-center gap-1 px-1">
          {priv && <Lock className="size-2.5 text-amber-300" />}
          <span className="text-[0.65rem] font-medium text-slate-400">
            {priv ? `${privateLabel}${privateTo ? ` · ${privateTo}` : ""}` : youLabel}
          </span>
          <time className="text-[0.65rem] text-slate-500">{formatMessageTime(lastTs, locale)}</time>
        </div>
      </div>
    );
  }

  // OTHER participants: avatar + name (+ host/management/private markers) + start-aligned bubbles.
  return (
    <div className="flex items-start gap-2.5">
      <span
        className={cn(
          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
          role === "monitor" ? "bg-amber-500/20 text-amber-200" : "bg-slate-700 text-slate-200",
        )}
      >
        {initials(displayName)}
      </span>
      <div className="flex min-w-0 flex-col items-start gap-1">
        <div className="flex items-center gap-1.5 px-1">
          <span className="truncate text-xs font-semibold text-slate-200">{displayName}</span>
          {role === "host" && (
            <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[0.6rem] font-bold uppercase tracking-wide text-emerald-300">
              {hostLabel}
            </span>
          )}
          {priv && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[0.6rem] font-bold uppercase tracking-wide text-amber-300">
              <Lock className="size-2.5" />
              {privateLabel}
            </span>
          )}
        </div>
        {messages.map((m, i) => (
          <div
            key={m.id}
            className={cn(
              "max-w-full rounded-2xl px-3.5 py-2 text-sm text-slate-100 shadow-sm",
              priv ? "bg-slate-800 ring-1 ring-amber-400/30" : "bg-slate-800",
              i === messages.length - 1 && "rounded-es-md",
            )}
          >
            <p className="whitespace-pre-wrap break-words">{m.message}</p>
          </div>
        ))}
        <time className="px-1 text-[0.65rem] text-slate-500">{formatMessageTime(lastTs, locale)}</time>
      </div>
    </div>
  );
}

/** Compact "send to" selector above the composer — Everyone (public) or one participant (private DM). */
function RecipientSelector({
  recipient,
  recipients,
  onSelect,
  everyoneLabel,
  toLabel,
}: {
  recipient: ChatRecipient | null;
  recipients: ChatRecipient[];
  onSelect: (r: ChatRecipient | null) => void;
  everyoneLabel: string;
  toLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: Event) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const isPrivate = recipient !== null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="chat-recipient"
        className={cn(
          "flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition",
          isPrivate
            ? "bg-amber-500/15 text-amber-200 ring-amber-400/30 hover:bg-amber-500/25"
            : "bg-white/5 text-slate-300 ring-white/10 hover:bg-white/10",
        )}
      >
        {isPrivate ? <Lock className="size-3 shrink-0" /> : <Users className="size-3 shrink-0" />}
        <span className="truncate">
          {toLabel}: {recipient ? recipient.name : everyoneLabel}
        </span>
        <ChevronDown className="size-3 shrink-0 opacity-70" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute bottom-full mb-2 max-h-56 w-56 max-w-[80vw] overflow-y-auto rounded-xl bg-slate-800 p-1 shadow-xl ring-1 ring-white/10"
        >
          <RecipientOption
            label={everyoneLabel}
            Icon={Users}
            active={recipient === null}
            onClick={() => {
              onSelect(null);
              setOpen(false);
            }}
          />
          {recipients.map((r) => (
            <RecipientOption
              key={r.identity}
              label={r.name}
              Icon={Lock}
              active={recipient?.identity === r.identity}
              onClick={() => {
                onSelect(r);
                setOpen(false);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RecipientOption({
  label,
  Icon,
  active,
  onClick,
}: {
  label: string;
  Icon: typeof Lock;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start text-sm transition",
        active ? "bg-emerald-500/15 text-emerald-200" : "text-slate-200 hover:bg-white/10",
      )}
    >
      <Icon className="size-3.5 shrink-0 opacity-70" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {active && <Check className="size-3.5 shrink-0 text-emerald-300" />}
    </button>
  );
}
