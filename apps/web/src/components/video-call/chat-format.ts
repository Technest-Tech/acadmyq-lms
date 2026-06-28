/**
 * Pure formatting + grouping helpers for the in-call chat. Kept free of React/LiveKit so they can
 * be unit-tested directly. The shapes are structurally compatible with `ReceivedChatMessage` from
 * @livekit/components-react, so the live `chatMessages` array can be passed straight in.
 */

/** The role a participant joined with — encoded in their LiveKit metadata (set at token mint). */
export type ChatRole = "host" | "guest" | "monitor";

/** A message sender — the subset of LiveKit's `Participant` the chat UI reads. */
export interface ChatSender {
  identity?: string;
  name?: string;
  isLocal?: boolean;
  /** JSON metadata string carried on the token, e.g. `{"role":"host"}`. */
  metadata?: string;
}

/** A single chat message — structurally a subset of `ReceivedChatMessage`. */
export interface ChatMessageLike {
  id: string;
  timestamp: number;
  message: string;
  from?: ChatSender;
  /** Free-form key/value ride-along set at send time and round-tripped to receivers. */
  attributes?: Record<string, string>;
}

/**
 * Attribute keys for private (direct) messages. A DM is sent with `destinationIdentities` so only
 * the target receives it; we ALSO stamp `PRIVATE_ATTR=1` so the receiver's UI can mark it private
 * (the SFU doesn't expose the destination list to the receiver), plus the recipient's display name
 * for the sender's own echo. Namespaced to avoid clashing with any LiveKit-reserved attributes.
 */
export const PRIVATE_ATTR = "aq_private";
export const PRIVATE_TO_ATTR = "aq_to";

/** Was this message a private/direct message (vs. visible to everyone)? */
export function isPrivate(msg: { attributes?: Record<string, string> }): boolean {
  return msg.attributes?.[PRIVATE_ATTR] === "1";
}

/** Read the join role out of a participant's metadata, tolerating missing/garbled JSON. */
export function participantRole(sender?: ChatSender): ChatRole | undefined {
  if (!sender?.metadata) return undefined;
  try {
    const role = (JSON.parse(sender.metadata) as { role?: string }).role;
    if (role === "host" || role === "guest" || role === "monitor") return role;
  } catch {
    // Non-JSON / empty metadata → unknown role; the UI falls back to a plain sender.
  }
  return undefined;
}

/** Short clock time (e.g. "3:07 PM" / "15:07") for a message timestamp, locale-aware. */
export function formatMessageTime(timestamp: number, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(
      new Date(timestamp),
    );
  } catch {
    // Bad locale tag → fall back to the runtime default rather than throwing in render.
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(
      new Date(timestamp),
    );
  }
}

/** A run of consecutive messages from one sender, rendered under a single name + avatar header. */
export interface ChatGroup {
  /** Stable key for React (the first message's id). */
  key: string;
  sender?: ChatSender;
  identity?: string;
  /** Best display name available (name → identity). The UI swaps in "You" for the local user. */
  name?: string;
  isLocal: boolean;
  role?: ChatRole;
  /** A run of private (direct) messages — rendered with a "Private" marker. */
  private: boolean;
  /** For the sender's own private run: the recipient's display name (shown as "Private · to X"). */
  privateTo?: string;
  messages: Array<{ id: string; message: string; timestamp: number }>;
}

const DEFAULT_GAP_MS = 5 * 60 * 1000;

/**
 * Collapse a flat message list into sender runs: consecutive messages from the SAME identity that
 * are within `gapMs` of each other share one bubble cluster (the modern WhatsApp/iMessage look).
 * A different sender, or a gap longer than `gapMs`, starts a fresh group.
 */
export function groupMessages(
  messages: ChatMessageLike[],
  gapMs: number = DEFAULT_GAP_MS,
): ChatGroup[] {
  const groups: ChatGroup[] = [];

  for (const msg of messages) {
    const priv = isPrivate(msg);
    const prev = groups[groups.length - 1];
    const last = prev?.messages[prev.messages.length - 1];
    const sameSender = prev && prev.identity === msg.from?.identity;
    const samePrivacy = prev && prev.private === priv;
    const closeInTime = last !== undefined && msg.timestamp - last.timestamp <= gapMs;

    if (prev && sameSender && samePrivacy && closeInTime) {
      prev.messages.push({ id: msg.id, message: msg.message, timestamp: msg.timestamp });
      continue;
    }

    groups.push({
      key: msg.id,
      sender: msg.from,
      identity: msg.from?.identity,
      name: msg.from?.name || msg.from?.identity,
      isLocal: Boolean(msg.from?.isLocal),
      role: participantRole(msg.from),
      private: priv,
      privateTo: msg.attributes?.[PRIVATE_TO_ATTR],
      messages: [{ id: msg.id, message: msg.message, timestamp: msg.timestamp }],
    });
  }

  return groups;
}
