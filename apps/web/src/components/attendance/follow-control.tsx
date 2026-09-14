"use client";

import { Eye, Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ApiError, followSession } from "@/lib/api";
import { cn } from "@/lib/utils";

/** What a row knows about who is following it — the API's fields, or a fresh click's result. */
export interface FollowInfo {
  followed_at: string;
  followed_by_name: string | null;
}

/**
 * The "Following" control on a pending lesson: a button until a supervisor presses it, then a
 * chip naming who is on it and since when. The click is what the Supervision page measures and
 * what keeps the WhatsApp not-marked reminder quiet, so it is deliberately one press, no undo.
 *
 * The parent owns the per-row state (`followed`) so a click updates the row without a reload,
 * exactly as recording an outcome does.
 */
export function FollowControl({
  sessionId,
  followed,
  canFollow,
  onFollowed,
  onError,
  className,
}: {
  sessionId: string;
  followed: FollowInfo | null;
  canFollow: boolean;
  onFollowed: (info: FollowInfo) => void;
  onError: (message: string) => void;
  className?: string;
}) {
  const t = useTranslations("attendance.follow");
  const locale = useLocale();
  const [busy, setBusy] = useState(false);

  if (followed) {
    const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(
      new Date(followed.followed_at),
    );
    return (
      <span
        data-testid="row-following"
        title={t("hint")}
        className={cn(
          "inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-800 dark:bg-sky-950/40 dark:text-sky-300",
          className,
        )}
      >
        <Eye className="size-2.5" aria-hidden />
        {t("done")}
        <span className="font-normal opacity-80">
          {" · "}
          {t("by", { name: followed.followed_by_name ?? "—", time })}
        </span>
      </span>
    );
  }

  if (!canFollow) return null;

  async function follow() {
    setBusy(true);
    try {
      const res = await followSession(sessionId);
      onFollowed({
        followed_at: res.follow.followed_at ?? new Date().toISOString(),
        followed_by_name: res.follow.followed_by_name,
      });
    } catch (e) {
      onError(e instanceof ApiError ? e.message : t("error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      size="xs"
      variant="outline"
      disabled={busy}
      title={t("hint")}
      data-testid="row-follow"
      className={cn("gap-1.5 border-sky-300 text-sky-800 hover:bg-sky-50 dark:border-sky-800 dark:text-sky-300 dark:hover:bg-sky-950/40", className)}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        void follow();
      }}
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Eye className="size-3.5" aria-hidden />}
      {t("action")}
    </Button>
  );
}
