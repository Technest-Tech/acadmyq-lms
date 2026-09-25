"use client";

import {
  ArrowLeft,
  Blocks,
  CreditCard,
  LayoutDashboard,
  MessageCircle,
  MonitorPlay,
  ReceiptText,
  Settings2,
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
import { AcademySubscriptionPanel } from "@/components/academies/academy-subscription-panel";
import { SectionTabs, type SectionTab } from "@/components/admin/section-tabs";
import { useAuth } from "@/components/auth-provider";
import { ClientHeader } from "@/components/clients/client-header";
import { ClientKpis } from "@/components/clients/client-kpis";
import { ClientOverview } from "@/components/clients/client-overview";
import { ClientSettingsTab } from "@/components/clients/client-settings";
import type { ClientTab } from "@/components/clients/client-summary";
import { ClientXpayCard } from "@/components/clients/client-xpay-card";
import { FeaturesCard } from "@/components/clients/features-card";
import {
  ClientVideoCard,
  ClientWhatsappCard,
} from "@/components/clients/module-tabs";
import { ModulesCard } from "@/components/clients/modules-card";
import { ClientWhatsappGroupsCard } from "@/components/clients/whatsapp-groups-card";
import { AlertBanner } from "@/components/ui/alert";
import { useToast } from "@/components/ui/toast";
import {
  ApiError,
  enterAcademy,
  getClient,
  getPlatformSettings,
  reactivateAcademy,
  suspendAcademy,
  type ClientDetail,
  type ModuleCode,
  type PlatformSettings,
} from "@/lib/api";

/**
 * /admin/clients/[id] — the client control center (05-MODULES-NOT-PACKAGES §4), laid out the way
 * a customer page reads in any grown-up admin: an identity header with the lifecycle verbs, four
 * KPIs, then one section per concern behind a tab strip —
 *
 *   Overview            what needs a decision, what the client holds, the facts for a call
 *   Modules & features  THE writer for which modules it holds, at what price, and the switches
 *   Billing             our bills to this client and their payment proofs
 *   Payments            how the client collects from its own students (XPay)
 *   WhatsApp / Video    only when the client holds that module
 *   Settings            identity, owner login, domains, danger zone
 *
 * `?tab=` on the URL names the open section, so a refresh keeps its place and any other page can
 * link straight to a client's billing or settings.
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

  const load = useCallback(async () => {
    try {
      const [client, settings] = await Promise.all([
        getClient(clientId),
        can("platform.manage")
          ? getPlatformSettings().catch(() => ({
              settings: {} as PlatformSettings,
            }))
          : Promise.resolve({ settings: {} as PlatformSettings }),
      ]);
      setData(client);
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

  const tabs = useMemo<SectionTab<ClientTab>[]>(() => {
    const list: SectionTab<ClientTab>[] = [
      { key: "overview", label: t("tabs.overview"), icon: LayoutDashboard },
      {
        key: "modules",
        label: t("tabs.modules"),
        icon: Blocks,
        badge: activeModules.size > 0 ? activeModules.size : undefined,
      },
      { key: "billing", label: t("tabs.billing"), icon: ReceiptText },
      // Unconditional: how a client collects money from its own students is not a module, it is a
      // property of every client that bills anyone.
      { key: "payments", label: t("tabs.payments"), icon: CreditCard },
    ];
    if (activeModules.has("WHATSAPP")) {
      list.push({
        key: "whatsapp",
        label: t("tabs.whatsapp"),
        icon: MessageCircle,
      });
    }
    if (activeModules.has("VIDEO")) {
      list.push({ key: "video", label: t("tabs.video"), icon: MonitorPlay });
    }
    list.push({ key: "settings", label: t("tabs.settings"), icon: Settings2 });
    return list;
  }, [activeModules, t]);

  // The open section lives on the URL. An unknown or not-yet-available tab falls back to Overview.
  const requested = searchParams.get("tab");
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

      {tab === "modules" && (
        <TabSection
          title={t("sections.modules")}
          hint={t("sections.modulesHint")}
        >
          <ModulesCard
            clientId={clientId}
            clientType={data.catalog.clientType}
            modules={data.modules}
            currency={client.default_currency}
            defaultPricing={defaultPricing}
            onChanged={() => void load()}
          />
          <FeaturesCard
            clientId={clientId}
            catalog={data.catalog}
            modules={data.modules}
            onChanged={() => void load()}
          />
        </TabSection>
      )}

      {tab === "billing" && (
        <TabSection
          title={t("sections.billing")}
          hint={t("sections.billingHint")}
        >
          <AcademySubscriptionPanel
            academyId={clientId}
            onChanged={() => void load()}
          />
        </TabSection>
      )}

      {tab === "payments" && (
        <TabSection
          title={t("sections.payments")}
          hint={t("sections.paymentsHint")}
        >
          <ClientXpayCard clientId={clientId} />
        </TabSection>
      )}

      {tab === "whatsapp" && activeModules.has("WHATSAPP") && (
        <TabSection
          title={t("sections.whatsapp")}
          hint={t("sections.whatsappHint")}
        >
          <ClientWhatsappCard clientId={clientId} />
          <ClientWhatsappGroupsCard clientId={clientId} />
        </TabSection>
      )}

      {tab === "video" && activeModules.has("VIDEO") && (
        <TabSection title={t("sections.video")} hint={t("sections.videoHint")}>
          <ClientVideoCard clientId={clientId} />
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
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
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
