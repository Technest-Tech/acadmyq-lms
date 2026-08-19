"use client";

import { GraduationCap, MessageCircle, MonitorPlay, School } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { AcademyWizard } from "@/components/academies/academy-wizard";
import { AdminPageHeader } from "@/components/admin/page-header";
import { MODULE_STYLE } from "@/components/clients/module-chips";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  ApiError,
  CLIENT_TYPES,
  CLIENT_TYPE_MODULES,
  createWhatsappOnlyClient,
  getPlatformSettings,
  type ClientType,
  type ModuleCode,
} from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * /admin/clients/new — create a client (05-MODULES-NOT-PACKAGES §2). First decide WHAT this client
 * is: a management system client (which may also take Video and WhatsApp), or a single-product
 * client — video platform, WhatsApp, or the course platform. There is no package to pick: each
 * module carries the price we agreed with this client, and every feature the module owns is on
 * until someone switches it off in the client's profile.
 */

type ExtraModule = Extract<ModuleCode, "VIDEO" | "WHATSAPP">;

type ExtraPick = { on: boolean; price: string };

const EXTRA_MODULES: readonly ExtraModule[] = ["VIDEO", "WHATSAPP"];

const TYPE_ICON: Record<ClientType, typeof School> = {
  MANAGEMENT: School,
  VIDEO: MonitorPlay,
  WHATSAPP: MessageCircle,
  LMS: GraduationCap,
};

type ModulePricing = Partial<Record<ModuleCode, { price_minor: number; currency: string }>>;

export function NewClientScreen() {
  const t = useTranslations("clients.new");
  const tm = useTranslations("clients.modules");
  const ts = useTranslations("clients.subs");
  const tt = useTranslations("clients.type");
  const router = useRouter();
  const toast = useToast();

  const [clientType, setClientType] = useState<ClientType>("MANAGEMENT");
  const [defaults, setDefaults] = useState<ModulePricing>({});
  const [picks, setPicks] = useState<Record<ExtraModule, ExtraPick>>({
    VIDEO: { on: false, price: "" },
    WHATSAPP: { on: false, price: "" },
  });

  useEffect(() => {
    getPlatformSettings()
      .then((res) => {
        const pricing = (res.settings.module_pricing ?? {}) as ModulePricing;
        setDefaults(pricing);
        setPicks((prev) => ({
          VIDEO: { ...prev.VIDEO, price: minorToInput(pricing.VIDEO?.price_minor) },
          WHATSAPP: { ...prev.WHATSAPP, price: minorToInput(pricing.WHATSAPP?.price_minor) },
        }));
      })
      .catch(() => setDefaults({}));
  }, []);

  const setPick = (module: ExtraModule, patch: Partial<ExtraPick>) =>
    setPicks((prev) => ({ ...prev, [module]: { ...prev[module], ...patch } }));

  const extraModules =
    clientType === "MANAGEMENT"
      ? EXTRA_MODULES.filter((m) => picks[m].on).map((m) => ({
          module: m as ModuleCode,
          price_minor: inputToMinor(picks[m].price),
        }))
      : [];

  return (
    <div className="space-y-5" data-testid="new-client-screen">
      <AdminPageHeader
        backHref="/admin/clients"
        backLabel={t("back")}
        title={t("title")}
        subtitle={t("subtitle")}
      />

      {/* 1. What kind of client is this? */}
      <section className="bg-card rounded-xl p-4 shadow-sm ring-1 ring-foreground/[0.06]">
        <h2 className="text-sm font-semibold">{t("typeTitle")}</h2>
        <p className="text-muted-foreground mt-0.5 text-xs">{t("typeHint")}</p>

        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {CLIENT_TYPES.map((type) => {
            const Icon = TYPE_ICON[type];
            const selected = clientType === type;
            return (
              <button
                key={type}
                type="button"
                aria-pressed={selected}
                data-testid={`client-type-${type}`}
                onClick={() => setClientType(type)}
                className={cn(
                  "flex flex-col gap-1.5 rounded-xl border p-3 text-start transition-colors",
                  selected
                    ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                    : "hover:bg-muted/40",
                )}
              >
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <Icon className="text-primary size-4" aria-hidden />
                  {tt(type)}
                </span>
                <span className="text-muted-foreground text-xs">{tt(`${type}Hint`)}</span>
                <span className="text-muted-foreground/80 text-[11px]">
                  {CLIENT_TYPE_MODULES[type].map((m) => tm(m)).join(" · ")}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* 2a. A WhatsApp client needs no login at all — create it in one step. */}
      {clientType === "WHATSAPP" && (
        <WhatsappOnlyCard defaultPriceMinor={defaults.WHATSAPP?.price_minor ?? 0} />
      )}

      {/* 2b. A management client can also be sold Video and WhatsApp, each at its own price. */}
      {clientType === "MANAGEMENT" && (
        <section className="bg-card rounded-xl p-4 shadow-sm ring-1 ring-foreground/[0.06]">
          <h2 className="text-sm font-semibold">{t("modulesTitle")}</h2>
          <p className="text-muted-foreground mt-0.5 text-xs">{t("modulesHint")}</p>

          <div className="mt-3 space-y-2.5">
            {EXTRA_MODULES.map((module) => {
              const pick = picks[module];
              return (
                <div
                  key={module}
                  className={cn(
                    "rounded-xl border p-3 transition-colors",
                    pick.on ? "border-primary/40 bg-primary/[0.03]" : "bg-muted/20",
                  )}
                >
                  <label className="flex cursor-pointer items-center gap-2.5 text-sm font-semibold">
                    <input
                      type="checkbox"
                      checked={pick.on}
                      onChange={(e) => setPick(module, { on: e.target.checked })}
                      className="accent-primary size-4"
                      data-testid={`pick-${module}`}
                    />
                    <span
                      className={cn(
                        "inline-flex size-5 items-center justify-center rounded-md text-[10px] font-bold ring-1",
                        MODULE_STYLE[module].on,
                      )}
                      aria-hidden
                    >
                      {MODULE_STYLE[module].label}
                    </span>
                    {tm(module)}
                  </label>

                  {pick.on && (
                    <div className="mt-2.5 flex flex-wrap items-end gap-2.5 ps-7">
                      <label className="text-xs font-medium">
                        <span className="text-muted-foreground mb-1 block">
                          {ts("price", { currency: defaults[module]?.currency ?? "EGP" })}
                        </span>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={pick.price}
                          onChange={(e) => setPick(module, { price: e.target.value })}
                          className="bg-card h-8 w-28 rounded-md border px-2 text-sm tabular-nums"
                        />
                      </label>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 3. The client itself: name, academy type, first owner, trial-or-paid. */}
      {clientType !== "WHATSAPP" && (
        <AcademyWizard
          clientType={clientType}
          extraModules={extraModules}
          onCreated={(academyId) => router.push(`/admin/clients/${academyId}`)}
          onCancel={() => router.push("/admin/clients")}
        />
      )}
    </div>
  );
}

/** A WhatsApp client is a name, a price and a QR scan later — no owner login exists for it. */
function WhatsappOnlyCard({ defaultPriceMinor }: { defaultPriceMinor: number }) {
  const t = useTranslations("clients.new");
  const ts = useTranslations("clients.subs");
  const router = useRouter();
  const toast = useToast();

  const [name, setName] = useState("");
  const [price, setPrice] = useState(minorToInput(defaultPriceMinor));
  const [mode, setMode] = useState<"trial" | "active">("trial");
  const [days, setDays] = useState(5);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPrice(minorToInput(defaultPriceMinor));
  }, [defaultPriceMinor]);

  const create = async () => {
    setBusy(true);
    try {
      const res = await createWhatsappOnlyClient({
        name: name.trim(),
        mode,
        price_minor: inputToMinor(price),
        ...(mode === "trial" ? { trial_days: days } : {}),
      });
      router.push(`/admin/clients/${res.clientId}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <section
      className="bg-card rounded-xl p-4 shadow-sm ring-1 ring-foreground/[0.06]"
      data-testid="whatsapp-only-card"
    >
      <h2 className="text-sm font-semibold">{t("waOnlyTitle")}</h2>
      <p className="text-muted-foreground mt-0.5 text-xs">{t("waOnlyHint")}</p>

      <div className="mt-3 flex flex-wrap items-end gap-2.5">
        <label className="text-xs font-medium">
          <span className="text-muted-foreground mb-1 block">{t("waOnlyName")}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="bg-card h-8 w-56 rounded-md border px-2 text-sm"
            data-testid="wa-only-name"
          />
        </label>
        <label className="text-xs font-medium">
          <span className="text-muted-foreground mb-1 block">{ts("price", { currency: "EGP" })}</span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="bg-card h-8 w-28 rounded-md border px-2 text-sm tabular-nums"
          />
        </label>
        <label className="text-xs font-medium">
          <span className="text-muted-foreground mb-1 block">{ts("mode")}</span>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as "trial" | "active")}
            className="bg-card h-8 rounded-md border px-2 text-sm"
          >
            <option value="trial">{ts("modeTrial")}</option>
            <option value="active">{ts("modeActive")}</option>
          </select>
        </label>
        {mode === "trial" && (
          <label className="text-xs font-medium">
            <span className="text-muted-foreground mb-1 block">{ts("trialDays")}</span>
            <input
              type="number"
              min={1}
              max={3650}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="bg-card h-8 w-20 rounded-md border px-2 text-sm tabular-nums"
            />
          </label>
        )}
        <Button
          size="sm"
          className="ms-auto"
          disabled={busy || name.trim() === ""}
          onClick={() => void create()}
          data-testid="wa-only-create"
        >
          {t("waOnlyCreate")}
        </Button>
      </div>
    </section>
  );
}

const minorToInput = (minor?: number): string =>
  minor === undefined || minor === 0 ? "" : String(minor / 100);

const inputToMinor = (value: string): number =>
  value.trim() === "" ? 0 : Math.max(0, Math.round(Number(value) * 100));
