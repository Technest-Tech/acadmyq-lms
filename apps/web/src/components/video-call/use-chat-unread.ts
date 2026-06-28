"use client";

import { useEffect, useState } from "react";

/** The slice of a chat message the unread counter cares about (decoupled from livekit types). */
export interface UnreadCountable {
  from?: { isLocal?: boolean };
}

/**
 * Pure unread count: how many messages past `seenCount` were sent by someone OTHER than us.
 * Own messages never count as unread (you can only send while the panel is open anyway, but
 * excluding them keeps the function correct in isolation and trivially testable).
 */
export function countUnread(messages: UnreadCountable[], seenCount: number): number {
  let n = 0;
  for (let i = Math.max(0, seenCount); i < messages.length; i++) {
    if (!messages[i]?.from?.isLocal) n++;
  }
  return n;
}

/**
 * Tracks the unread badge for the chat toggle. While the panel is open every message is marked
 * seen as it lands (so the badge stays at 0); once closed, anything new from a remote participant
 * accrues. Reopening resets the seen watermark to the latest message → badge clears.
 */
export function useChatUnread(messages: UnreadCountable[], open: boolean): number {
  const [seenCount, setSeenCount] = useState(messages.length);

  useEffect(() => {
    if (open) setSeenCount(messages.length);
  }, [open, messages.length]);

  return open ? 0 : countUnread(messages, seenCount);
}
