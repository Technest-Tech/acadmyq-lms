"use client";

import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  ExternalLink,
  LogIn,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useState, type ReactNode } from "react";
import { Field, fieldClass } from "@/components/admin/field";
import { StatusChip, SUBSCRIPTION_TONE } from "@/components/admin/status-chip";
import { useAuth } from "@/components/auth-provider";
import { AlertBanner } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import type { ClientDetail } from "@/lib/api";
import { cn } from "@/lib/utils";
import { displayHost, fmtDate, initials, subdomainUrl } from "./client-summary";

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

  const { client, summary } = data;
  const suspended = client.status === "SUSPENDED";
  const address = subdomainUrl(client.subdomain);

  return (
    <div className="space-y-4" data-testid="client-header">
      <Link
        href="/admin/clients"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs font-medium"
      >
        <ArrowLeft className="size-3.5 rtl:rotate-180" aria-hidden />
        {t("back")}
      </Link>

      {/* The record card: identity + verbs on top, the facts people ask for on a call in a
          divided strip underneath. A thin accent on the top edge carries the lifecycle colour. */}
      <div
        className="bg-card relative overflow-hidden rounded-xl shadow-sm ring-1 ring-foreground/[0.06]"
        data-testid="client-header-card"
      >
        <div
          aria-hidden
          className={cn(
            "absolute inset-x-0 top-0 h-0.5",
            suspended ? "bg-rose-500" : "bg-primary",
          )}
        />
        <div
          className={cn(
            "flex flex-col gap-4 bg-gradient-to-b to-transparent p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between",
            suspended ? "from-rose-500/[0.05]" : "from-primary/[0.05]",
          )}
        >
          <div className="flex min-w-0 items-center gap-4">
            <ClientAvatar
              name={client.name}
              logoUrl={client.brand_logo_url}
              className="bg-card size-16 shadow-sm"
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-xl font-bold tracking-tight sm:text-2xl">
                  {client.name}
                </h1>
                <StatusChip
                  tone={SUBSCRIPTION_TONE[client.status] ?? "neutral"}
                  dot
                >
                  {ts(`status.${client.status}`)}
                </StatusChip>
              </div>
              <p className="text-muted-foreground mt-1 text-sm">
                {ts(`type.${client.client_type}`)}
                {client.brand_display_name &&
                  client.brand_display_name !== client.name && (
                    <> · {client.brand_display_name}</>
                  )}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {address !== null && (
              <a
                href={address}
                target="_blank"
                rel="noreferrer"
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
              >
                <ExternalLink className="size-3.5" aria-hidden />
                {t("header.openAddress")}
              </a>
            )}
            {can("academy.enter") && (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => setDialog("enter")}
                data-testid="client-enter"
              >
                <LogIn className="size-4" aria-hidden />
                {t("enter")}
              </Button>
            )}
            {can("academy.suspend") &&
              (suspended ? (
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => setDialog("reactivate")}
                  data-testid="client-reactivate"
                >
                  <CheckCircle2 className="size-4" aria-hidden />
                  {t("reactivate")}
                </Button>
              ) : (
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={busy}
                  onClick={() => setDialog("suspend")}
                  data-testid="client-suspend"
                >
                  <Ban className="size-4" aria-hidden />
                  {t("suspend")}
                </Button>
              ))}
          </div>
        </div>

        {/* gap-px over a border-coloured grid draws the dividers, and they stay right when the
            strip wraps to two or three columns on a smaller screen. */}
        <dl className="bg-border grid grid-cols-1 gap-px border-t sm:grid-cols-3 lg:grid-cols-5">
          <HeaderFact label={t("overview.owner")}>
            {summary.owner ? (
              <span dir="ltr">{summary.owner.email}</span>
            ) : (
              <span className="text-muted-foreground font-normal italic">
                {t("header.ownerNone")}
              </span>
            )}
          </HeaderFact>
          <HeaderFact label={t("overview.address")}>
            {address !== null ? (
              <a
                href={address}
                target="_blank"
                rel="noreferrer"
                dir="ltr"
                className="text-primary hover:underline"
              >
                {displayHost(address)}
              </a>
            ) : (
              <span className="text-muted-foreground font-normal italic">
                {t("overview.addressNone")}
              </span>
            )}
          </HeaderFact>
          <HeaderFact label={t("overview.currency")}>
            <span dir="ltr">{client.default_currency}</span>
          </HeaderFact>
          <HeaderFact label={t("overview.timezone")}>
            <span dir="ltr">{client.timezone}</span>
          </HeaderFact>
          <HeaderFact label={t("overview.created")}>
            {fmtDate(client.created_at, locale)}
          </HeaderFact>
        </dl>
      </div>

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
function HeaderFact({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="bg-card min-w-0 px-5 py-3 sm:px-6">
      <dt className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
        {label}
      </dt>
      <dd className="mt-0.5 truncate text-sm font-medium">{children}</dd>
    </div>
  );
}

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
