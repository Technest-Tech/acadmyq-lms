"use client";

import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  Ellipsis,
  ExternalLink,
  Globe,
  LogIn,
  Mail,
  MessageCircle,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { Field, fieldClass } from "@/components/admin/field";
import { StatusChip, SUBSCRIPTION_TONE } from "@/components/admin/status-chip";
import { useAuth } from "@/components/auth-provider";
import { AlertBanner } from "@/components/ui/alert";
import { ModuleTags } from "@/components/clients/module-chips";
import { Button, buttonVariants } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Modal } from "@/components/ui/modal";
import type { ClientDetail } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/money";
import {
  clientTabHref,
  clockTone,
  decodeOverrides,
  displayHost,
  fmtDate,
  initials,
  nextUpcoming,
  subdomainUrl,
  type ClientTab,
} from "./client-summary";

/**
 * The client page's identity block: logo (or initials), name, lifecycle + type chips, one meta
 * line (owner · address · currency · timezone · since), and the two lifecycle verbs on the end.
 * Enter and Suspend confirm in a dialog rather than an inline strip, so the page underneath
 * never jumps — and the suspend reason gets a real labelled field instead of a bare input.
 */
export function ClientHeader({
  data,
  busy,
  onEnter,
  onSuspend,
  onReactivate,
}: {
  data: ClientDetail;
  busy: boolean;
  onEnter: () => Promise<boolean>;
  onSuspend: (reason: string) => Promise<boolean>;
  onReactivate: () => Promise<boolean>;
}) {
  const t = useTranslations("clients.detail");
  const ts = useTranslations("clients");
  const locale = useLocale();
  const { can } = useAuth();
  const [dialog, setDialog] = useState<
    "enter" | "suspend" | "reactivate" | null
  >(null);
  // Stable on purpose: Modal re-runs its focus trap whenever onClose changes.
  const close = useCallback(() => setDialog(null), []);

  const { client, summary, modules } = data;
  const profile = data.profile ?? "QURAN";
  // A centre always wears the modern look; a Quran academy only once it was switched on for it.
  const management = modules.find((m) => m.module === "MANAGEMENT" && m.status !== "ENDED");
  const modernLook =
    profile === "CENTRE" ||
    (management !== undefined &&
      ["modern_look", "courses_art"].some((k) => decodeOverrides(management.overrides).enabled.includes(k)));
  const phone = summary.owner?.phone ?? null;
  const waLink = phone ? `https://wa.me/${phone.replace(/[^0-9]/g, "")}` : null;
  const suspended = client.status === "SUSPENDED";
  const address = subdomainUrl(client.subdomain);

  // The loudest clock on the client, if it is loud at all (the roster's "needs follow-up").
  const clock = nextUpcoming(modules, data.account);
  const alarm: { tone: "crit" | "warn"; text: string; action: string; tab: ClientTab } | null = (() => {
    if (clock === null) return null;
    const tone = clockTone(clock);
    if (tone === "neutral") return null;
    const name = ts(`modules.${clock.module}`);
    const days = formatNumber(Math.abs(clock.days), locale);
    const text = clock.trial
      ? clock.days < 0
        ? ts("roster.clock.trialEnded", { module: name, days })
        : clock.days === 0
          ? ts("roster.clock.trialToday", { module: name })
          : ts("roster.clock.trialSoon", { module: name, days })
      : clock.days < 0
        ? ts("roster.clock.renewalOverdue", { module: name, days })
        : clock.days === 0
          ? ts("roster.clock.renewalToday", { module: name })
          : ts("roster.clock.renewalSoon", { module: name, days });
    return clock.trial
      ? { tone, text, action: t("header.alertOpenModules"), tab: "subscription" }
      : { tone, text, action: t("header.alertOpenBilling"), tab: "subscription" };
  })();

  return (
    <div className="space-y-4" data-testid="client-header">
      <Link
        href="/admin/clients"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs font-medium"
      >
        <ArrowLeft className="size-3.5 rtl:rotate-180" aria-hidden />
        {t("back")}
      </Link>

      {/* The record card: identity and the lifecycle verbs, on the page's band. The facts asked
          for on a call (currency, timezone, billing day…) live once, on the Overview's Details. */}
      <div
        className="admin-page-header bg-card rounded-xl p-5 shadow-sm ring-1 ring-foreground/[0.06] sm:p-6"
        data-testid="client-header-card"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <ClientAvatar
              name={client.name}
              logoUrl={client.brand_logo_url}
              className="bg-card size-16 shadow-sm"
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="admin-page-header__title truncate text-xl font-bold tracking-tight sm:text-2xl">
                  {client.name}
                </h1>
                <StatusChip
                  tone={SUBSCRIPTION_TONE[client.status] ?? "neutral"}
                  dot
                >
                  {ts(`status.${client.status}`)}
                </StatusChip>
                {client.client_type === "MANAGEMENT" && (
                  <StatusChip tone="neutral" className="text-xs" >
                    {t(`header.profile.${profile}`)}
                  </StatusChip>
                )}
                {modernLook && (
                  <StatusChip tone="accent" icon={Sparkles} className="text-xs" title={t("header.modernLook")}>
                    {t("header.modernLook")}
                  </StatusChip>
                )}
              </div>
              <p className="admin-page-header__sub text-muted-foreground mt-1 text-sm">
                {ts(`type.${client.client_type}`)}
                {client.brand_display_name &&
                  client.brand_display_name !== client.name && (
                    <> · {client.brand_display_name}</>
                  )}
                {" · "}
                {t("header.since", { date: fmtDate(client.created_at, locale) })}
              </p>
              <div className="admin-page-header__sub text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <Mail className="size-3.5 shrink-0" aria-hidden />
                  {summary.owner ? (
                    <>
                      <span className="font-semibold">{summary.owner.full_name}</span>
                      <span dir="ltr" className="truncate">
                        {summary.owner.email}
                      </span>
                    </>
                  ) : (
                    <span className="italic">{t("header.ownerNone")}</span>
                  )}
                </span>
                {phone !== null && waLink !== null && (
                  <a
                    href={waLink}
                    target="_blank"
                    rel="noreferrer"
                    title={t("header.whatsapp")}
                    className="inline-flex items-center gap-1.5 font-semibold text-emerald-700 hover:underline dark:text-emerald-400"
                    data-testid="client-phone"
                  >
                    <MessageCircle className="size-3.5 shrink-0" aria-hidden />
                    <span dir="ltr">{phone}</span>
                  </a>
                )}
                {address !== null && (
                  <a
                    href={address}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary inline-flex min-w-0 items-center gap-1.5 font-semibold hover:underline"
                  >
                    <Globe className="size-3.5 shrink-0" aria-hidden />
                    <span dir="ltr" className="truncate">
                      {displayHost(address)}
                    </span>
                  </a>
                )}
              </div>
              <div className="mt-2.5">
                <ModuleTags modules={modules} />
              </div>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {address !== null && (
              <a
                href={address}
                target="_blank"
                rel="noreferrer"
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "bg-card")}
              >
                <ExternalLink className="size-3.5" aria-hidden />
                {t("header.openAddress")}
              </a>
            )}
            {can("academy.enter") && (
              <Button
                variant="outline"
                size="sm"
                className="bg-card"
                disabled={busy}
                onClick={() => setDialog("enter")}
                data-testid="client-enter"
              >
                <LogIn className="size-4" aria-hidden />
                {t("enter")}
              </Button>
            )}
            {/* Reactivating is the way back, so it stays a button; suspending stops every login
                at the client, so it waits one click deeper, away from the hand. */}
            {can("academy.suspend") && suspended && (
              <Button
                size="sm"
                disabled={busy}
                onClick={() => setDialog("reactivate")}
                data-testid="client-reactivate"
              >
                <CheckCircle2 className="size-4" aria-hidden />
                {t("reactivate")}
              </Button>
            )}
            {can("academy.suspend") && !suspended && (
              <DropdownMenu>
                <DropdownMenuTrigger>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    className="bg-card"
                    aria-label={t("header.more")}
                    data-testid="client-more"
                  >
                    <Ellipsis className="size-4" aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => setDialog("suspend")}
                    closeOnClick
                    data-testid="client-suspend"
                    className="text-destructive"
                  >
                    <Ban aria-hidden />
                    {t("suspend")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </div>

      {/* The one clock that is ringing — an overdue renewal, an ended or ending trial — says so
          above everything, with the tab that settles it one click away. */}
      {!suspended && alarm !== null && (
        <div
          role="status"
          data-testid="client-alarm"
          data-tone={alarm.tone}
          className={cn(
            "flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3",
            alarm.tone === "crit"
              ? "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200"
              : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200",
          )}
        >
          <TriangleAlert className="size-5 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1 text-sm font-bold">{alarm.text}</p>
          <Link
            href={clientTabHref(client.id, alarm.tab)}
            className={cn(buttonVariants({ size: "sm" }), "shrink-0")}
          >
            {alarm.action}
          </Link>
        </div>
      )}

      {suspended && (
        <AlertBanner
          variant="error"
          message={
            client.suspended_reason
              ? t("header.suspendedSinceReason", {
                  date: fmtDate(client.suspended_at, locale),
                  reason: client.suspended_reason,
                })
              : t("header.suspendedSince", {
                  date: fmtDate(client.suspended_at, locale),
                })
          }
        />
      )}

      <Modal
        open={dialog === "enter"}
        onClose={close}
        title={t("header.enterTitle")}
        size="sm"
      >
        <ConfirmBody
          body={t("header.enterBody", { name: client.name })}
          confirmLabel={t("enter")}
          cancelLabel={ts("subs.cancel")}
          busy={busy}
          onCancel={close}
          onConfirm={async () => {
            if (await onEnter()) close();
          }}
        />
      </Modal>

      <Modal
        open={dialog === "suspend"}
        onClose={close}
        title={t("header.suspendTitle", { name: client.name })}
        size="sm"
      >
        {/* Mounted only while open, so a typed reason never survives a cancel. */}
        {dialog === "suspend" && (
          <SuspendForm
            body={t("header.suspendBody")}
            busy={busy}
            onCancel={close}
            onConfirm={async (reason) => {
              if (await onSuspend(reason)) close();
            }}
          />
        )}
      </Modal>

      <Modal
        open={dialog === "reactivate"}
        onClose={close}
        title={t("header.reactivateTitle", { name: client.name })}
        size="sm"
      >
        <ConfirmBody
          body={t("header.reactivateBody")}
          confirmLabel={t("reactivate")}
          cancelLabel={ts("subs.cancel")}
          busy={busy}
          onCancel={close}
          onConfirm={async () => {
            if (await onReactivate()) close();
          }}
        />
      </Modal>
    </div>
  );
}

/** One labelled cell of the header's facts strip. */
/** The logo when there is one, the client's initials when there is not. */
export function ClientAvatar({
  name,
  logoUrl,
  className,
}: {
  name: string;
  logoUrl: string | null;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "bg-muted flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl ring-1 ring-foreground/[0.06]",
        className,
      )}
    >
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary client-owned host
        <img src={logoUrl} alt="" className="size-full object-contain p-1.5" />
      ) : (
        <span className="text-muted-foreground text-base font-bold tracking-wide">
          {initials(name)}
        </span>
      )}
    </div>
  );
}

function ConfirmBody({
  body,
  confirmLabel,
  cancelLabel,
  busy,
  destructive = false,
  onCancel,
  onConfirm,
}: {
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  busy: boolean;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm leading-relaxed">{body}</p>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </Button>
        <Button
          size="sm"
          variant={destructive ? "destructive" : "default"}
          disabled={busy}
          onClick={onConfirm}
          data-testid="confirm-action"
        >
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}

/** Holds the reason itself, so typing never re-renders the dialog that owns the focus trap. */
function SuspendForm({
  body,
  busy,
  onCancel,
  onConfirm,
}: {
  body: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const t = useTranslations("clients.detail");
  const ts = useTranslations("clients");
  const [reason, setReason] = useState("");

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm leading-relaxed">{body}</p>
      <Field
        label={t("header.suspendReasonLabel")}
        hint={t("header.suspendReasonHint")}
      >
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("suspendReasonPlaceholder")}
          className={fieldClass}
          data-testid="suspend-reason"
        />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={busy}>
          {ts("subs.cancel")}
        </Button>
        <Button
          variant="destructive"
          size="sm"
          disabled={busy}
          onClick={() => onConfirm(reason.trim())}
          data-testid="confirm-suspend"
        >
          <Ban className="size-3.5" aria-hidden />
          {t("suspend")}
        </Button>
      </div>
    </div>
  );
}
