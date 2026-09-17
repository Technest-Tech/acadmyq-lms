"use client";

import {
  Check,
  Copy,
  ExternalLink,
  Globe,
  Loader2,
  RefreshCw,
  Star,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { StatusChip, type ChipTone } from "@/components/admin/status-chip";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  ApiError,
  addClientDomain,
  getClientDomains,
  removeClientDomain,
  setClientDomainPrimary,
  verifyClientDomain,
  type ClientDomain,
  type ClientDomainKind,
  type ClientDomainStatus,
  type ClientDomains,
} from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Domains → the addresses one client answers on (docs/custom-domains).
 *
 * A client's platform handle (`noor.acadmyq.com`) always works and is never taken away. This card
 * adds the addresses they OWN on top of it, and its real job is not the form — it is the STATUS.
 * A custom domain fails in exactly one place, on the client's side, between "we told them the
 * record" and "the record exists": every one of those failures looks identical from the outside
 * (a white screen, or a certificate warning), so the panel has to say which step is stuck and
 * what to do about it. That is why `last_error` is printed verbatim — it is the sentence to read
 * down the phone.
 *
 * Nothing here issues a certificate. `Verify` only re-runs the DNS check; a root cron does the
 * rest (see the controller). The button exists so whoever is on the call does not have to wait for
 * the ten-minute sweep.
 */

const KINDS: ClientDomainKind[] = ["MANAGEMENT", "LMS"];

/** Only LIVE is good news; everything between is a "waiting", and FAILED needs someone. */
const STATUS_TONE: Record<ClientDomainStatus, ChipTone> = {
  PENDING_DNS: "warn",
  VERIFIED: "info",
  ISSUING: "info",
  LIVE: "good",
  FAILED: "crit",
};

export function ClientDomainsCard({ clientId }: { clientId: string }) {
  const t = useTranslations("clients.detail.domains");
  const { can } = useAuth();
  const toast = useToast();

  const [state, setState] = useState<ClientDomains | null>(null);
  const [host, setHost] = useState("");
  const [kind, setKind] = useState<ClientDomainKind>("MANAGEMENT");
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const canManage = can("platform.manage");

  useEffect(() => {
    let alive = true;
    void getClientDomains(clientId)
      .then((res) => alive && setState(res))
      .catch(() => alive && setState(null));

    return () => {
      alive = false;
    };
  }, [clientId]);

  /** Every action returns the whole list, so one helper covers all four. */
  const run = useCallback(
    async (key: string, action: () => Promise<ClientDomains>, okMessage?: string) => {
      setBusy(key);
      try {
        setState(await action());
        if (okMessage) toast.success(okMessage);
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [toast],
  );

  const copy = useCallback(async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard unavailable — the value is selectable on screen anyway */
    }
  }, []);

  if (state === null) {
    return (
      <section className="bg-card space-y-5 rounded-xl p-5 shadow-sm ring-1 ring-foreground/[0.06]">
        <h3 className="flex items-center gap-2 text-sm font-bold">
          <Globe className="text-muted-foreground size-4" aria-hidden />
          {t("title")}
        </h3>
        <p className="text-muted-foreground text-xs">{t("loading")}</p>
      </section>
    );
  }

  const hasHandle = state.subdomain !== null && state.subdomain !== "";
  const canAdd = canManage && state.enabled && hasHandle;

  return (
    <section
      className="bg-card space-y-5 rounded-xl p-5 shadow-sm ring-1 ring-foreground/[0.06]"
      data-testid="client-domains-card"
    >
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="min-w-0">
        <h3 className="flex items-center gap-2 text-sm font-bold">
          <Globe className="text-muted-foreground size-4" aria-hidden />
          {t("title")}
        </h3>
        <p className="text-muted-foreground mt-1.5 text-xs">{t("subtitle")}</p>
      </div>

      {/* The two prerequisites, each explained where it blocks rather than as a failed save. */}
      {!state.enabled && (
        <p className="bg-muted/40 text-muted-foreground rounded-lg p-3 text-xs">{t("disabled")}</p>
      )}
      {state.enabled && !hasHandle && (
        <p className="bg-muted/40 text-muted-foreground rounded-lg p-3 text-xs">{t("needsHandle")}</p>
      )}

      {/* ── The records to dictate to the client ────────────────────────────── */}
      {state.enabled && (
        <div className="bg-muted/40 space-y-2 rounded-lg p-3">
          <p className="text-muted-foreground text-[0.7rem] font-semibold tracking-wide uppercase">
            {t("dnsLabel")}
          </p>
          <DnsRecord
            type="A"
            value={state.instructions.origin_ip}
            copied={copied === state.instructions.origin_ip}
            onCopy={() => void copy(state.instructions.origin_ip)}
          />
          {state.instructions.cname_target !== null && (
            <DnsRecord
              type="CNAME"
              value={state.instructions.cname_target}
              copied={copied === state.instructions.cname_target}
              onCopy={() => void copy(state.instructions.cname_target ?? "")}
            />
          )}
          {/* The single most common failure, said before it happens rather than after. */}
          <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">
            {t("dnsOnlyWarning")}
          </p>
        </div>
      )}

      {/* ── The addresses themselves ────────────────────────────────────────── */}
      {state.domains.length === 0 ? (
        <p className="text-muted-foreground text-xs">{t("empty", { handle: state.subdomain ?? "" })}</p>
      ) : (
        <ul className="space-y-2">
          {state.domains.map((d) => (
            <DomainRow
              key={d.id}
              domain={d}
              canManage={canManage && state.enabled}
              busy={busy === d.id}
              onVerify={() =>
                void run(d.id, () => verifyClientDomain(clientId, d.id))
              }
              onPrimary={() =>
                void run(d.id, () => setClientDomainPrimary(clientId, d.id), t("primarySet"))
              }
              onRemove={() =>
                void run(d.id, () => removeClientDomain(clientId, d.id), t("removed"))
              }
            />
          ))}
        </ul>
      )}

      {/* ── Add one ─────────────────────────────────────────────────────────── */}
      {canAdd && (
        <form
          className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            const value = host.trim();
            if (value === "") return;

            void run("add", () => addClientDomain(clientId, { host: value, kind }), t("added")).then(
              () => setHost(""),
            );
          }}
        >
          <input
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder={t("hostPlaceholder")}
            aria-label={t("hostLabel")}
            dir="ltr"
            className="bg-background h-9 min-w-0 rounded-lg border px-3 font-mono text-xs"
            data-testid="client-domain-host"
          />
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as ClientDomainKind)}
            aria-label={t("kindLabel")}
            className="bg-background h-9 rounded-lg border px-2 text-xs"
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {t(k === "LMS" ? "kindLms" : "kindManagement")}
              </option>
            ))}
          </select>
          <Button type="submit" size="sm" disabled={busy !== null || host.trim() === ""}>
            {busy === "add" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
            {t("add")}
          </Button>
        </form>
      )}
    </section>
  );
}

/** One DNS record, big enough to read out and one tap to copy. */
function DnsRecord({
  type,
  value,
  copied,
  onCopy,
}: {
  type: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground w-14 shrink-0 text-[0.7rem] font-semibold">{type}</span>
      <code className="min-w-0 flex-1 font-mono text-xs break-all" dir="ltr">
        {value || "—"}
      </code>
      <button
        type="button"
        onClick={onCopy}
        aria-label={`copy ${type}`}
        className="hover:bg-muted flex size-7 shrink-0 items-center justify-center rounded-md transition-colors"
      >
        {copied ? (
          <Check className="size-3.5 text-emerald-600" aria-hidden />
        ) : (
          <Copy className="text-muted-foreground size-3.5" aria-hidden />
        )}
      </button>
    </div>
  );
}

function DomainRow({
  domain,
  canManage,
  busy,
  onVerify,
  onPrimary,
  onRemove,
}: {
  domain: ClientDomain;
  canManage: boolean;
  busy: boolean;
  onVerify: () => void;
  onPrimary: () => void;
  onRemove: () => void;
}) {
  const t = useTranslations("clients.detail.domains");
  const live = domain.status === "LIVE";

  return (
    <li className="rounded-lg border p-3" data-testid={`client-domain-${domain.host}`}>
      <div className="flex flex-wrap items-center gap-2">
        {live ? (
          <a
            href={domain.url}
            target="_blank"
            rel="noreferrer"
            dir="ltr"
            className="text-primary inline-flex min-w-0 items-center gap-1 font-mono text-xs font-semibold break-all hover:underline"
          >
            {domain.host}
            <ExternalLink className="size-3 shrink-0" aria-hidden />
          </a>
        ) : (
          <span dir="ltr" className="min-w-0 font-mono text-xs font-semibold break-all">
            {domain.host}
          </span>
        )}

        <StatusChip tone={STATUS_TONE[domain.status]} dot>
          {t(`status.${domain.status}`)}
        </StatusChip>
        <StatusChip tone="neutral">
          {t(domain.kind === "LMS" ? "kindLms" : "kindManagement")}
        </StatusChip>
        {domain.is_primary && (
          <StatusChip tone="accent" icon={Star}>
            {t("primary")}
          </StatusChip>
        )}
      </div>

      {/* Verbatim, because this is the sentence someone reads down the phone. */}
      {domain.last_error !== null && domain.last_error !== "" && (
        <p className="text-muted-foreground mt-2 text-xs break-words" dir="auto">
          {domain.last_error}
        </p>
      )}

      {canManage && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {!live && (
            <Button size="xs" variant="outline" disabled={busy} onClick={onVerify}>
              {busy ? (
                <Loader2 className="size-3 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="size-3" aria-hidden />
              )}
              {t("verify")}
            </Button>
          )}
          {live && !domain.is_primary && (
            <Button size="xs" variant="outline" disabled={busy} onClick={onPrimary}>
              <Star className="size-3" aria-hidden />
              {t("makePrimary")}
            </Button>
          )}
          <Button
            size="xs"
            variant="ghost"
            disabled={busy}
            onClick={onRemove}
            className={cn("text-destructive")}
          >
            <Trash2 className="size-3" aria-hidden />
            {t("remove")}
          </Button>
        </div>
      )}
    </li>
  );
}
