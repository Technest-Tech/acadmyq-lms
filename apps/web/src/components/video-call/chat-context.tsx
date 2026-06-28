"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useChat, useConnectionState } from "@livekit/components-react";
import type { ReceivedChatMessage } from "@livekit/components-react";
import { ConnectionState } from "livekit-client";
import { PRIVATE_ATTR, PRIVATE_TO_ATTR } from "./chat-format";
import { useChatUnread } from "./use-chat-unread";

/** Max characters per message — generous for a classroom, bounded so the data channel stays cheap. */
export const CHAT_MAX_LENGTH = 1000;

/** A direct-message target. Omit / pass null to send to everyone. */
export interface ChatRecipient {
  identity: string;
  name: string;
}

export interface ChatContextValue {
  messages: ReceivedChatMessage[];
  /** Send to everyone, or privately to one recipient (a direct message). */
  send: (message: string, recipient?: ChatRecipient | null) => Promise<unknown>;
  isSending: boolean;
  /** True once the SFU connection is live — gates sending (data channel needs the connection). */
  connected: boolean;
  /** Count of remote messages received while the panel was closed (resets on open). */
  unread: number;
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

/**
 * Owns the room chat for the whole in-call subtree: one `useChat` subscription (it must live inside
 * the RoomContext), the open/closed drawer state, and the unread badge counter. The control bar's
 * chat button and the chat panel both read from here, so wiring stays tiny and there's a single
 * source of truth. Chat is EPHEMERAL — `useChat` rides LiveKit's data channel and isn't persisted.
 */
export function ChatProvider({ children }: { children: ReactNode }) {
  const { chatMessages, send, isSending } = useChat();
  const connected = useConnectionState() === ConnectionState.Connected;
  const [isOpen, setIsOpen] = useState(false);
  const unread = useChatUnread(chatMessages, isOpen);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((v) => !v), []);

  // Trim + length-guard at the boundary so every caller is safe; empty sends are dropped. A recipient
  // routes the message privately via `destinationIdentities` (only they receive it) and stamps the
  // private attributes so their UI can mark it (the SFU hides the destination list from receivers).
  const sendMessage = useCallback(
    (message: string, recipient?: ChatRecipient | null) => {
      const text = message.trim().slice(0, CHAT_MAX_LENGTH);
      if (!text) return Promise.resolve();
      if (recipient) {
        return send(text, {
          destinationIdentities: [recipient.identity],
          attributes: { [PRIVATE_ATTR]: "1", [PRIVATE_TO_ATTR]: recipient.name },
        });
      }
      return send(text);
    },
    [send],
  );

  const value = useMemo<ChatContextValue>(
    () => ({
      messages: chatMessages,
      send: sendMessage,
      isSending,
      connected,
      unread,
      isOpen,
      open,
      close,
      toggle,
    }),
    [chatMessages, sendMessage, isSending, connected, unread, isOpen, open, close, toggle],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

/** Read the in-call chat. Throws if used outside <ChatProvider> (a wiring mistake, not a runtime one). */
export function useChatPanel(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChatPanel must be used within <ChatProvider>");
  return ctx;
}
