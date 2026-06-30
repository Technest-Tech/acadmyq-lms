"use client";

import { MessageSquare } from "lucide-react";
import { useTranslations } from "next-intl";
import { useChatPanel } from "./chat-context";

/**
 * Control-bar chat toggle with an unread badge. Self-contained (reads the ChatProvider) so wiring it
 * into the control bar is a single line. The badge counts remote messages received while the panel
 * is closed and clears the moment it opens; it's capped at "9+" so it never blows out the pill.
 */
export function ChatButton({ compact = false }: { compact?: boolean }) {
  const t = useTranslations("videoCall");
  const { unread, isOpen, toggle } = useChatPanel();

  return (
    <button
      type="button"
      onClick={toggle}
      data-testid="chat-toggle"
      data-unread={unread}
      aria-pressed={isOpen}
      aria-label={unread > 0 ? t("chatUnreadLabel", { count: unread }) : t("chatTitle")}
      title={t("chatTitle")}
      className={`relative flex ${compact ? "size-10" : "size-12"} items-center justify-center rounded-full transition ${
        isOpen ? "bg-emerald-500/90 text-white hover:bg-emerald-500" : "bg-white/10 text-white hover:bg-white/20"
      }`}
    >
      <MessageSquare className={compact ? "size-[18px]" : "size-5"} />
      {unread > 0 && (
        <span className="absolute -end-0.5 -top-0.5 flex min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[0.65rem] font-bold text-white">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </button>
  );
}
