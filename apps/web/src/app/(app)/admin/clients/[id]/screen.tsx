"use client";

import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  LogIn,
  MonitorPlay,
  ReceiptText,
  Settings2,
  MessageCircle,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AcademyOwnerSection } from "@/components/academies/academy-owner-section";
import { AcademySubscriptionPanel } from "@/components/academies/academy-subscription-panel";
import { useAuth } from "@/components/auth-provider";
import { ClientVideoCard, ClientWhatsappCard } from "@/components/clients/module-tabs";
import { SubscriptionsCard } from "@/components/clients/subscriptions-card";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  ApiError,
  enterAcademy,
  getClient,
  listPlans,
  reactivateAcademy,
  suspendAcademy,
  updateAcademy,
  type ClientDetail,
  type Plan,
} from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * /admin/clients/[id] — the client control center (R2, 04-CLIENT-FIRST-REDESIGN §4): header with
 * the derived status + Enter/Suspend, the Subscriptions card (THE writer for module/plan/trial
 * state), and tabs that appear only for enabled modules — Billing (the client's bills + proofs),
 * WhatsApp (connection/toggles/keys), Video (link to its ops detail), Settings (name/branding/
 * owner). A real route at last, so every trial chip and proof row can deep-link here.
 */

const STATUS_STYLE: Record<string, string> = {
  ACTIVE:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  TRIAL: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  SUSPENDED:
    "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
};

type Tab = "billing" | "whatsapp" | "video" | "settings";

/** Subdomain provisioning (docs/lms/02): DNS-safe handle → the LMS learner site. Mirrors the API's
 *  validation + the learner-site middleware's reserved list so the admin sees the resulting URL and
 *  never round-trips an avoidable 422. */
const SUBDOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const RESERVED_SUBDOMAINS = new Set(["www", "app", "api", "admin", "mail", "static", "assets", "cdn"]);
const LEARNER_ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN;
/** `http` for local development, `https` in prod — mirror of the API's LMS_SITE_SCHEME. */
const LEARNER_SCHEME =
  process.env.NEXT_PUBLIC_ROOT_SCHEME === "http" ? "http" : "https";

export function ClientScreen({ clientId }: { clientId: string }) {
  const t = useTranslations("clients.detail");
  const ts = useTranslations("clients");
  const locale = useLocale();
  const router = useRouter();
  const { can, refresh: refreshSession } = useAuth();
  const toast = useToast();

  const [data, setData] = useState<ClientDetail | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("billing");
  const [confirmEnter, setConfirmEnter] = useState(false);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [suspendReason, setSuspendReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [client, catalog] = await Promise.all([
        getClient(clientId),
        can("plan.manage") ? listPlans() : Promise.resolve({ plans: [] as Plan[] }),
      ]);
      setData(client);
      setPlans(catalog.plans);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }, [clientId, can]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeModules = useMemo(
    () => new Set((data?.modules ?? []).map((m) => m.module)),
    [data],
  );

  const tabs = useMemo(() => {
    const list: { key: Tab; icon: typeof ReceiptText }[] = [
      { key: "billing", icon: ReceiptText },
    ];
    if (activeModules.has("WHATSAPP")) list.push({ key: "whatsapp", icon: MessageCircle });
    if (activeModules.has("VIDEO")) list.push({ key: "video", icon: MonitorPlay });
    list.push({ key: "settings", icon: Settings2 });
    return list;
  }, [activeModules]);

  const enter = async () => {
    setBusy(true);
    try {
      await enterAcademy(clientId);
      await refreshSession();
      router.push("/dashboard");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
      setBusy(false);
    }
  };

  const toggleSuspension = async () => {
    if (data === null) return;
    setBusy(true);
    try {
      if (data.client.status === "SUSPENDED") {
        await reactivateAcademy(clientId);
      } else {
        await suspendAcademy(clientId, suspendReason.trim() || undefined);
      }
      setSuspendOpen(false);
      setSuspendReason("");
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (error !== null) {
    return (
      <div className="space-y-4">
        <BackLink label={t("back")} />
        <AlertBanner variant="error" message={error} />
      </div>
    );
  }

  if (data === null) {
    return <p className="text-muted-foreground py-10 text-center text-sm">{ts("loading")}</p>;
  }

  const { client } = data;

  return (
    <div className="space-y-5" data-testid="client-screen">
      <BackLink label={t("back")} />

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="truncate text-xl font-bold tracking-tight">{client.name}</h1>
            <span
              className={cn(
                "rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                STATUS_STYLE[client.status],
              )}
            >
              {ts(`status.${client.status}`)}
            </span>
          </div>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {client.default_currency} · {client.timezone}
            {client.subdomain !== null && <> · {client.subdomain}</>}
            {" · "}
            {t("since", {
              date: new Date(client.created_at).toLocaleDateString(locale),
            })}
          </p>
          {client.status === "SUSPENDED" && client.suspended_reason !== null && (
            <p className="text-destructive mt-1 text-xs font-medium">
              {t("suspendedReason", { reason: client.suspended_reason })}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {can("academy.enter") && (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirmEnter(true)}>
              <LogIn className="size-4" aria-hidden />
              {t("enter")}
            </Button>
          )}
          {can("academy.suspend") &&
            (client.status === "SUSPENDED" ? (
              <Button size="sm" disabled={busy} onClick={toggleSuspension}>
                <CheckCircle2 className="size-4" aria-hidden />
                {t("reactivate")}
              </Button>
            ) : (
              <Button
                variant="destructive"
                size="sm"
                disabled={busy}
                onClick={() => setSuspendOpen(true)}
              >
                <Ban className="size-4" aria-hidden />
                {t("suspend")}
              </Button>
            ))}
        </div>
      </div>

      {/* Enter confirmation */}
      {confirmEnter && (
        <div className="bg-muted/40 flex flex-wrap items-center gap-2 rounded-xl border p-3 text-sm">
          <span className="flex-1">{t("enterConfirm", { name: client.name })}</span>
          <Button size="sm" variant="outline" onClick={() => setConfirmEnter(false)}>
            {ts("subs.cancel")}
          </Button>
          <Button size="sm" disabled={busy} onClick={enter}>
            {t("enter")}
          </Button>
        </div>
      )}

      {/* Suspend form */}
      {suspendOpen && client.status !== "SUSPENDED" && (
        <div className="bg-muted/40 flex flex-wrap items-center gap-2 rounded-xl border p-3 text-sm">
          <input
            value={suspendReason}
            onChange={(e) => setSuspendReason(e.target.value)}
            placeholder={t("suspendReasonPlaceholder")}
            className="bg-card h-9 min-w-56 flex-1 rounded-lg border px-3 text-sm"
          />
          <Button size="sm" variant="outline" onClick={() => setSuspendOpen(false)}>
            {ts("subs.cancel")}
          </Button>
          <Button size="sm" variant="destructive" disabled={busy} onClick={toggleSuspension}>
            {t("suspend")}
          </Button>
        </div>
      )}

      {/* ── The Subscriptions card — the one writer ─────────────────────── */}
      <SubscriptionsCard
        clientId={clientId}
        modules={data.modules}
        plans={plans}
        onChanged={() => void load()}
      />

      {/* ── Module tabs (only enabled modules render one) ───────────────── */}
      <div>
        <div className="flex gap-1 overflow-x-auto border-b" role="tablist">
          {tabs.map(({ key, icon: Icon }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cn(
                "-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-semibold transition-colors",
                tab === key
                  ? "border-primary text-primary"
                  : "text-muted-foreground hover:text-foreground border-transparent",
              )}
            >
              <Icon className="size-4" aria-hidden />
              {t(`tabs.${key}`)}
            </button>
          ))}
        </div>

        <div className="pt-4">
          {tab === "billing" && (
            <AcademySubscriptionPanel academyId={clientId} onChanged={() => void load()} />
          )}
          {tab === "whatsapp" && activeModules.has("WHATSAPP") && (
            <ClientWhatsappCard clientId={clientId} />
          )}
          {tab === "video" && activeModules.has("VIDEO") && (
            <ClientVideoCard clientId={clientId} />
          )}
          {tab === "settings" && (
            <div className="grid gap-4 lg:grid-cols-2">
              <ClientSettingsForm client={client} onSaved={() => void load()} />
              <AcademyOwnerSection academyId={clientId} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BackLink({ label }: { label: string }) {
  return (
    <Link
      href="/admin/clients"
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs font-medium"
    >
      <ArrowLeft className="size-3.5 rtl:rotate-180" aria-hidden />
      {label}
    </Link>
  );
}

/** Name / branding / subdomain — the client-page home of the old academy config card. */
function ClientSettingsForm({
  client,
  onSaved,
}: {
  client: ClientDetail["client"];
  onSaved: () => void;
}) {
  const t = useTranslations("clients.detail");
  const { can } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(client.name);
  const [brandName, setBrandName] = useState(client.brand_display_name ?? "");
  const [subdomain, setSubdomain] = useState(client.subdomain ?? "");
  const [logoUrl, setLogoUrl] = useState(client.brand_logo_url ?? "");
  const [saving, setSaving] = useState(false);

  if (!can("academy.configure")) return null;

  // Live subdomain feedback: format/reserved checks + the public URL the handle resolves to.
  const sub = subdomain.trim();
  const subValid = sub === "" || SUBDOMAIN_RE.test(sub);
  const subReserved = RESERVED_SUBDOMAINS.has(sub);
  const subUrl =
    sub === "" || !subValid || subReserved
      ? null
      : LEARNER_ROOT_DOMAIN
        ? `${LEARNER_SCHEME}://${sub}.${LEARNER_ROOT_DOMAIN}`
        : `/learn/${sub}`;

  const save = async () => {
    setSaving(true);
    try {
      await updateAcademy(client.id, {
        name: name.trim(),
        brand_display_name: brandName.trim() === "" ? null : brandName.trim(),
        subdomain: subdomain.trim() === "" ? null : subdomain.trim(),
        brand_logo_url: logoUrl.trim() === "" ? null : logoUrl.trim(),
      });
      toast.success(t("saved"));
      onSaved();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const field = "bg-card h-9 w-full rounded-lg border px-3 text-sm";

  return (
    <section className="bg-card space-y-3 rounded-2xl border p-5 shadow-sm">
      <h3 className="text-sm font-bold">{t("settingsTitle")}</h3>
      <label className="block text-xs font-medium">
        <span className="text-muted-foreground mb-1 block">{t("fieldName")}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} className={field} />
      </label>
      <label className="block text-xs font-medium">
        <span className="text-muted-foreground mb-1 block">{t("fieldBrandName")}</span>
        <input value={brandName} onChange={(e) => setBrandName(e.target.value)} className={field} />
      </label>
      <label className="block text-xs font-medium">
        <span className="text-muted-foreground mb-1 block">{t("fieldSubdomain")}</span>
        <input
          value={subdomain}
          onChange={(e) => setSubdomain(e.target.value.toLowerCase())}
          placeholder="my-academy"
          className={cn(field, !subValid || subReserved ? "border-red-400 dark:border-red-500" : "")}
        />
        {subReserved ? (
          <span className="mt-1 block text-red-600 dark:text-red-400">{t("subdomainReserved")}</span>
        ) : !subValid ? (
          <span className="mt-1 block text-red-600 dark:text-red-400">{t("subdomainInvalid")}</span>
        ) : subUrl ? (
          <span className="text-muted-foreground mt-1 block break-all">
            {t("subdomainPreview", { url: subUrl })}
          </span>
        ) : (
          <span className="text-muted-foreground mt-1 block">{t("subdomainHint")}</span>
        )}
      </label>
      <label className="block text-xs font-medium">
        <span className="text-muted-foreground mb-1 block">{t("fieldLogoUrl")}</span>
        <input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} className={field} />
      </label>
      <div className="flex justify-end">
        <Button
          size="sm"
          disabled={saving || name.trim() === "" || !subValid || subReserved}
          onClick={save}
        >
          {t("save")}
        </Button>
      </div>
    </section>
  );
}
