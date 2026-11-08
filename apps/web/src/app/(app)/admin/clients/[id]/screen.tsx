"use client";

import {
  ArrowLeft,
  LayoutDashboard,
  PlugZap,
  ReceiptText,
  Settings2,
  SlidersHorizontal,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { SectionTabs, type SectionTab } from "@/components/admin/section-tabs";
import { useAuth } from "@/components/auth-provider";
import { ClientHeader } from "@/components/clients/client-header";
import { ClientKpis } from "@/components/clients/client-kpis";
import { ClientOverview } from "@/components/clients/client-overview";
import { ClientDomainsCard } from "@/components/clients/client-domains-card";
import { ClientSettingsTab } from "@/components/clients/client-settings";
import { LEGACY_CLIENT_TABS, type ClientTab } from "@/components/clients/client-summary";
import { ClientXpayCard } from "@/components/clients/client-xpay-card";
import { FeaturesCard } from "@/components/clients/features-card";
import { ClientWhatsappCard } from "@/components/clients/module-tabs";
import { ModulesCard } from "@/components/clients/modules-card";
import { AccountPanel } from "@/components/finance/account-panel";
import { AgreementFormModal, type AgreementTarget } from "@/components/finance/agreement-form-modal";
import { ClientWhatsappGroupsCard } from "@/components/clients/whatsapp-groups-card";
import { AlertBanner } from "@/components/ui/alert";
import { useToast } from "@/components/ui/toast";
import {
  ApiError,
  enterAcademy,
  getClient,
  getClientAccount,
  type AccountPayload,
  getPlatformSettings,
  reactivateAcademy,
  suspendAcademy,
  type ClientDetail,
  type ModuleCode,
  type PlatformSettings,
} from "@/lib/api";

/**
 * /admin/clients/[id] — the client control center, in five sections behind one tab strip (Ahmed,
 * 2026-11-07: the eight tabs had grown duplicates and an empty one):
 *
 *   Overview              what needs a decision, whether it is being used, the facts for a call
 *   Subscription & money  what it holds and pays (THE writer for modules, prices, trials) and our
 *                         bills to it with their proofs — one story, one tab
 *   Features              the per-client switches, opt-in extras first
 *   Connections           WhatsApp (when held), the payment gateway it collects with, its domains
 *   Settings              identity, owner login, danger zone
 *
 * `?tab=` on the URL names the open section, so a refresh keeps its place; the old eight names
 * still land in the right one (LEGACY_CLIENT_TABS).
 */
export function ClientScreen({ clientId }: { clientId: string }) {
  const t = useTranslations("clients.detail");
  const ts = useTranslations("clients");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { can, refresh: refreshSession } = useAuth();
  const toast = useToast();

  const [data, setData] = useState<ClientDetail | null>(null);
  /** Per-module default prices from platform settings — they only PRE-FILL the enable form. */
  const [defaultPricing, setDefaultPricing] = useState<
    Partial<Record<ModuleCode, { price_minor: number; currency: string }>>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** The client's account in the book (undefined = not loaded / no access, null = no agreement yet). */
  const [account, setAccount] = useState<AccountPayload | null | undefined>(undefined);
  /** Ending a trial with no agreement yet opens the agreement form (it ends the trial on save). */
  const [activating, setActivating] = useState<AgreementTarget | null>(null);

  const load = useCallback(async () => {
    try {
      const [client, settings, money] = await Promise.all([
        getClient(clientId),
        can("platform.manage")
          ? getPlatformSettings().catch(() => ({
              settings: {} as PlatformSettings,
            }))
          : Promise.resolve({ settings: {} as PlatformSettings }),
        can("platform.manage")
          ? getClientAccount(clientId).catch(() => undefined)
          : Promise.resolve(undefined),
      ]);
      setData(client);
      setAccount(money === undefined ? undefined : money.account === null ? null : (money as AccountPayload));
      setDefaultPricing(
        (settings.settings.module_pricing as
          | typeof defaultPricing
          | undefined) ?? {},
      );
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

  const tabs = useMemo<SectionTab<ClientTab>[]>(
    () => [
      { key: "overview", label: t("tabs.overview"), icon: LayoutDashboard },
      { key: "subscription", label: t("tabs.subscription"), icon: ReceiptText },
      { key: "features", label: t("tabs.features"), icon: SlidersHorizontal },
      { key: "connections", label: t("tabs.connections"), icon: PlugZap },
      { key: "settings", label: t("tabs.settings"), icon: Settings2 },
    ],
    [t],
  );

  // The open section lives on the URL. An old tab name maps onto its new home; anything else
  // falls back to Overview.
  const requestedRaw = searchParams.get("tab") ?? "";
  const requested = LEGACY_CLIENT_TABS[requestedRaw] ?? requestedRaw;
  const tab: ClientTab = tabs.some((x) => x.key === requested)
    ? (requested as ClientTab)
    : "overview";
  const setTab = (next: ClientTab) => {
    router.replace(next === "overview" ? pathname : `${pathname}?tab=${next}`, {
      scroll: false,
    });
  };

  const fail = (e: unknown) => {
    toast.error(e instanceof ApiError ? e.message : String(e));
    return false;
  };

  const enter = async (): Promise<boolean> => {
    setBusy(true);
    try {
      await enterAcademy(clientId);
      await refreshSession();
      router.push("/dashboard");
      return true;
    } catch (e) {
      setBusy(false);
      return fail(e);
    }
  };

  const suspend = async (reason: string): Promise<boolean> => {
    setBusy(true);
    try {
      await suspendAcademy(clientId, reason === "" ? undefined : reason);
      await load();
      return true;
    } catch (e) {
      return fail(e);
    } finally {
      setBusy(false);
    }
  };

  const reactivate = async (): Promise<boolean> => {
    setBusy(true);
    try {
      await reactivateAcademy(clientId);
      await load();
      return true;
    } catch (e) {
      return fail(e);
    } finally {
      setBusy(false);
    }
  };

  if (error !== null) {
    return (
      <div className="space-y-4">
        <Link
          href="/admin/clients"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs font-medium"
        >
          <ArrowLeft className="size-3.5 rtl:rotate-180" aria-hidden />
          {t("back")}
        </Link>
        <AlertBanner variant="error" message={error} />
      </div>
    );
  }

  if (data === null) {
    return <ClientSkeleton label={t("loadingProfile")} />;
  }

  const { client } = data;
  const trial = data.modules.find((m) => m.status === "ACTIVE" && m.is_trial) ?? null;
  const paid = data.modules.filter((m) => m.status === "ACTIVE" && !m.is_trial);
  const agreementTarget = {
    kind: "academy" as const,
    academyId: clientId,
    name: client.name,
    inTrial: trial !== null,
    trialEnd: trial?.trial_end ?? null,
    // What its modules were sold at (or the platform's default price) — the form's starting point.
    suggested: (() => {
      const sold = paid.reduce((sum, m) => sum + m.total_cost_minor, 0);
      if (sold > 0) return { amount_minor: sold, currency: paid[0]!.currency, interval: paid[0]!.billing_interval };
      const primary = data.modules[0]?.module;
      const preset = primary ? defaultPricing[primary] : undefined;
      return preset && preset.price_minor > 0 ? { amount_minor: preset.price_minor, currency: preset.currency, interval: "MONTHLY" as const } : null;
    })(),
  };

  return (
    <div className="space-y-6" data-testid="client-screen">
      <ClientHeader
        data={data}
        busy={busy}
        onEnter={enter}
        onSuspend={suspend}
        onReactivate={reactivate}
      />

      <ClientKpis data={data} />

      <SectionTabs
        tabs={tabs}
        value={tab}
        onChange={setTab}
        ariaLabel={ts("title")}
      />

      {tab === "overview" && <ClientOverview data={data} clientId={clientId} />}

      {tab === "subscription" && (
        <TabSection
          title={t("sections.subscription")}
          hint={t("sections.subscriptionHint")}
        >
          {account !== undefined && (
            <AccountPanel
              payload={account}
              target={agreementTarget}
              onChanged={() => void load()}
            />
          )}
          <ModulesCard
            clientId={clientId}
            clientType={data.catalog.clientType}
            modules={data.modules}
            currency={client.default_currency}
            defaultPricing={defaultPricing}
            onChanged={() => void load()}
            onActivate={
              account === null
                ? () => setActivating({ ...agreementTarget, inTrial: true })
                : undefined
            }
          />
          <AgreementFormModal
            open={activating !== null}
            target={activating}
            onClose={() => setActivating(null)}
            onSaved={() => {
              setActivating(null);
              void load();
            }}
          />
        </TabSection>
      )}

      {/* The card carries its own title and hint: a section heading over it would say it twice. */}
      {tab === "features" && (
        <div role="tabpanel">
          <FeaturesCard
            clientId={clientId}
            catalog={data.catalog}
            modules={data.modules}
            onChanged={() => void load()}
          />
        </div>
      )}

      {tab === "connections" && (
        <TabSection
          title={t("sections.connections")}
          hint={t("sections.connectionsHint")}
        >
          {activeModules.has("WHATSAPP") && (
            <>
              <ClientWhatsappCard clientId={clientId} />
              <ClientWhatsappGroupsCard clientId={clientId} />
            </>
          )}
          <ClientXpayCard clientId={clientId} />
          <ClientDomainsCard clientId={clientId} />
        </TabSection>
      )}

      {tab === "settings" && (
        <TabSection
          title={t("sections.settings")}
          hint={t("sections.settingsHint")}
        >
          <ClientSettingsTab data={data} onSaved={() => void load()} />
        </TabSection>
      )}
    </div>
  );
}

/** A section's heading line, then its panels. */
function TabSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-4" role="tabpanel">
      <div>
        <h2 className="text-lg font-extrabold tracking-tight">{title}</h2>
        <p className="text-muted-foreground mt-0.5 text-sm">{hint}</p>
      </div>
      {children}
    </div>
  );
}

/** The page's shape while the client read is in flight — header, KPI strip, tab strip. */
function ClientSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-6" aria-busy data-testid="client-skeleton">
      <span className="sr-only">{label}</span>
      <div className="bg-muted h-3.5 w-20 animate-pulse rounded" />
      <div className="flex items-start gap-4">
        <div className="bg-muted size-14 animate-pulse rounded-xl" />
        <div className="space-y-2.5 pt-1">
          <div className="bg-muted h-6 w-56 animate-pulse rounded-md" />
          <div className="bg-muted h-3 w-80 max-w-[70vw] animate-pulse rounded" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-muted h-24 animate-pulse rounded-xl" />
        ))}
      </div>
      <div className="bg-muted h-10 animate-pulse rounded-lg" />
    </div>
  );
}
