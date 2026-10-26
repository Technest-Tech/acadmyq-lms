"use client";

import { ExternalLink, Link2, Lock, MessageCircle, Power, RefreshCw, Smartphone } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { CopyLinkButton, waLink } from "@/components/accounting/accounting-ui";
import { useAuth } from "@/components/auth-provider";
import { apiErrorMessage } from "@/components/groups/group-form";
import { Button } from "@/components/ui/button";
import { ProfileCard } from "@/components/ui/profile-card";
import { cn } from "@/lib/utils";
import {
  getPortalLink,
  issuePortalLink,
  type PortalLink,
  revokePortalLink,
  sendPortalLink,
} from "@/lib/portal-api";

type Pending = "send" | "create" | "rotate" | "revoke" | null;

/**
 * The family's private page (`/p/{token}`) on the family profile: send it on WhatsApp, copy it,
 * open it, replace it (the old link dies) or switch it off. Reading the link is `guardian.read`;
 * everything that makes, changes or sends it is `guardian.update`.
 */
export function ParentPortalCard({ guardianId, active }: { guardianId: string; active: boolean }) {
  const t = useTranslations("parentPortal");
  const locale = useLocale();
  const { can } = useAuth();
  const canEdit = can("guardian.update");

  const [link, setLink] = useState<PortalLink | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [confirming, setConfirming] = useState<"rotate" | "revoke" | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let live = true;
    getPortalLink(guardianId)
      .then((res) => live && setLink(res))
      .catch(() => live && setLink({ url: null, issued_at: null }));
    return () => {
      live = false;
    };
  }, [guardianId]);

  async function run(kind: Exclude<Pending, null>) {
    setPending(kind);
    setConfirming(null);
    setNotice(null);
    try {
      if (kind === "send") {
        const res = await sendPortalLink(guardianId);
        setLink((prev) => ({ url: res.url, issued_at: prev?.issued_at ?? new Date().toISOString() }));
        if (res.sent) setNotice({ ok: true, text: t("sent", { phone: res.phone }) });
        else if (res.phone) window.open(waLink(res.phone, res.message), "_blank", "noopener,noreferrer");
        else setNotice({ ok: false, text: t("noPhone") });
      } else if (kind === "revoke") {
        setLink(await revokePortalLink(guardianId));
        setNotice({ ok: true, text: t("revoked") });
      } else {
        setLink(await issuePortalLink(guardianId, kind === "rotate"));
        if (kind === "rotate") setNotice({ ok: true, text: t("rotated") });
      }
    } catch (err) {
      setNotice({ ok: false, text: apiErrorMessage(err, t("failed")) });
    } finally {
      setPending(null);
    }
  }

  const issued = link?.issued_at
    ? new Date(link.issued_at).toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" })
    : null;

  return (
    <ProfileCard icon={Smartphone} title={t("title")} description={t("description")} tone="emerald" testId="parent-portal-card">
      {notice && (
        <p
          role="status"
          data-testid="parent-portal-notice"
          className={cn("mb-3 text-sm font-medium", notice.ok ? "text-emerald-700 dark:text-emerald-400" : "text-destructive")}
        >
          {notice.text}
        </p>
      )}
      {link === null ? (
        <div className="bg-muted h-9 animate-pulse rounded-lg" />
      ) : !active ? (
        <p className="text-muted-foreground text-sm">{t("inactive")}</p>
      ) : link.url === null ? (
        <div className="space-y-3">
          <p className="text-muted-foreground text-sm">{t("empty")}</p>
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => void run("send")} disabled={pending !== null} className="gap-1.5" data-testid="parent-portal-send">
                <MessageCircle className="size-4" aria-hidden />
                {t("send")}
              </Button>
              <Button type="button" variant="outline" onClick={() => void run("create")} disabled={pending !== null} className="gap-1.5" data-testid="parent-portal-create">
                <Link2 className="size-4" aria-hidden />
                {t("create")}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="bg-muted/50 flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2">
            <Lock className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
            <bdi dir="ltr" className="min-w-0 truncate font-mono text-xs" data-testid="parent-portal-url">
              {link.url}
            </bdi>
          </div>

          <div className="flex flex-wrap gap-2">
            {canEdit && (
              <Button type="button" onClick={() => void run("send")} disabled={pending !== null} className="gap-1.5" data-testid="parent-portal-send">
                <MessageCircle className="size-4" aria-hidden />
                {t("send")}
              </Button>
            )}
            <CopyLinkButton value={link.url} label={t("copy")} copiedLabel={t("copied")} />
            <Button type="button" variant="outline" className="gap-1.5" onClick={() => window.open(link.url ?? "", "_blank", "noopener,noreferrer")}>
              <ExternalLink className="size-4" aria-hidden />
              {t("open")}
            </Button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t pt-3">
            <p className="text-muted-foreground text-xs">
              {issued ? `${t("issuedAt", { date: issued })} · ` : ""}
              {t("private")}
            </p>
            {canEdit &&
              (confirming ? (
                <div className="flex flex-wrap items-center gap-2" data-testid="parent-portal-confirm">
                  <span className="text-xs font-medium">{t(confirming === "rotate" ? "rotateConfirm" : "revokeConfirm")}</span>
                  <Button type="button" size="sm" variant={confirming === "revoke" ? "destructive" : "default"} disabled={pending !== null} onClick={() => void run(confirming)}>
                    {t("confirm")}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                    {t("cancel")}
                  </Button>
                </div>
              ) : (
                <div className="flex gap-1">
                  <Button type="button" size="sm" variant="ghost" className="gap-1" onClick={() => setConfirming("rotate")} data-testid="parent-portal-rotate">
                    <RefreshCw className="size-3.5" aria-hidden />
                    {t("rotate")}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" className="text-destructive gap-1" onClick={() => setConfirming("revoke")} data-testid="parent-portal-revoke">
                    <Power className="size-3.5" aria-hidden />
                    {t("revoke")}
                  </Button>
                </div>
              ))}
          </div>
        </div>
      )}
    </ProfileCard>
  );
}
