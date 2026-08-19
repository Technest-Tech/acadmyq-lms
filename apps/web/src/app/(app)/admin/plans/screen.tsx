"use client";

import { Coins, Pencil, Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { AddOnFormModal } from "./addon-form";
import { AdminPageHeader } from "@/components/admin/page-header";
import { EmptyState } from "@/components/admin/empty-state";
import { TableCard, Td, Th, TR_HEAD } from "@/components/admin/table";
import { MODULE_STYLE } from "@/components/clients/module-chips";
import { useAuth } from "@/components/auth-provider";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  ApiError,
  getCapabilityCatalog,
  getPlanCatalog,
  getPlatformSettings,
  MODULE_CODES,
  updatePlatformSettings,
  type AddOnCatalogItem,
  type CapabilityCatalog,
  type ModuleCode,
} from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * /admin/plans — module pricing (05-MODULES-NOT-PACKAGES §5). Packages are gone: a module's price
 * is whatever we agreed with each client, typed on that client's profile. What lives here is the
 * DEFAULT that pre-fills the form when a module is sold, so the common case needs no typing and a
 * custom deal stays one number away. Add-ons (extra feature keys sold on top) keep their catalog.
 */

type ModulePrice = { price_minor: number; currency: string };
type ModulePricing = Partial<Record<ModuleCode, ModulePrice>>;

export function PlanAdminScreen() {
  const t = useTranslations("planAdmin");
  const tm = useTranslations("clients.modules");
  const locale = useLocale();
  const { can } = useAuth();
  const canManage = can("platform.manage");

  const [pricing, setPricing] = useState<ModulePricing>({});
  const [draft, setDraft] = useState<Record<string, { price: string; currency: string }>>({});
  const [addOns, setAddOns] = useState<AddOnCatalogItem[]>([]);
  const [catalog, setCatalog] = useState<CapabilityCatalog | null>(null);
  const [addOnModal, setAddOnModal] = useState<AddOnCatalogItem | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const [settings, planCatalog, caps] = await Promise.all([
        getPlatformSettings(),
        getPlanCatalog(),
        getCapabilityCatalog(),
      ]);
      const stored = (settings.settings.module_pricing ?? {}) as ModulePricing;
      setPricing(stored);
      setDraft(
        Object.fromEntries(
          MODULE_CODES.map((code) => [
            code,
            {
              price: stored[code] ? String((stored[code] as ModulePrice).price_minor / 100) : "",
              currency: stored[code]?.currency ?? "EGP",
            },
          ]),
        ),
      );
      setAddOns(planCatalog.addOns);
      setCatalog(caps);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const next: ModulePricing = {};
      for (const code of MODULE_CODES) {
        const row = draft[code];
        if (row === undefined) continue;
        next[code] = {
          price_minor: row.price.trim() === "" ? 0 : Math.max(0, Math.round(Number(row.price) * 100)),
          currency: (row.currency || "EGP").toUpperCase(),
        };
      }
      await updatePlatformSettings({ module_pricing: next });
      setPricing(next);
      setSaved(true);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (!canManage) {
    return <AlertBanner variant="info" message={t("noPermission")} />;
  }

  return (
    <div className="space-y-5" data-testid="pricing-screen">
      <AdminPageHeader title={t("title")} subtitle={t("subtitle")} />

      {error !== null && <AlertBanner variant="error" message={error} />}

      {/* Default price per module — a pre-fill, never a package. */}
      <section className="bg-card overflow-hidden rounded-xl shadow-sm ring-1 ring-foreground/[0.06]">
        <header className="bg-muted/40 flex items-center justify-between border-b px-4 py-2.5">
          <h2 className="text-muted-foreground text-[11px] font-bold uppercase tracking-[0.08em]">
            {t("modulePricing")}
          </h2>
          {canManage && (
            <div className="flex items-center gap-2">
              {saved && <span className="text-muted-foreground text-xs">{t("saved")}</span>}
              <Button size="sm" disabled={saving} onClick={() => void save()} data-testid="save-pricing">
                {t("savePricing")}
              </Button>
            </div>
          )}
        </header>

        <p className="text-muted-foreground border-b px-4 py-2 text-xs">{t("modulePricingHint")}</p>

        <div className="divide-y">
          {MODULE_CODES.map((code) => {
            const row = draft[code] ?? { price: "", currency: "EGP" };
            const stored = pricing[code];

            return (
              <div key={code} className="flex flex-wrap items-end gap-3 px-4 py-3" data-testid={`price-row-${code}`}>
                <span className="flex w-40 shrink-0 items-center gap-2 text-sm font-bold">
                  <span
                    className={cn(
                      "inline-flex size-5 items-center justify-center rounded-md text-[10px] ring-1",
                      MODULE_STYLE[code].on,
                    )}
                    aria-hidden
                  >
                    {MODULE_STYLE[code].label}
                  </span>
                  {tm(code)}
                </span>

                <label className="text-xs font-medium">
                  <span className="text-muted-foreground mb-1 block">{t("defaultPrice")}</span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={row.price}
                    disabled={!canManage}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, [code]: { ...row, price: e.target.value } }))
                    }
                    className="bg-card h-8 w-32 rounded-md border px-2 text-sm tabular-nums"
                  />
                </label>

                <label className="text-xs font-medium">
                  <span className="text-muted-foreground mb-1 block">{t("currency")}</span>
                  <input
                    value={row.currency}
                    maxLength={3}
                    disabled={!canManage}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        [code]: { ...row, currency: e.target.value.toUpperCase() },
                      }))
                    }
                    className="bg-card h-8 w-20 rounded-md border px-2 text-sm uppercase"
                  />
                </label>

                <span className="text-muted-foreground ms-auto text-xs tabular-nums">
                  {stored !== undefined && stored.price_minor > 0
                    ? t("currentDefault", {
                        amount: formatMoney(
                          { amount: stored.price_minor, currency: stored.currency },
                          locale,
                        ),
                      })
                    : t("noDefault")}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Add-ons: a single extra feature key sold on top of a client's modules. */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t("addOnsTitle")}</h2>
          {canManage && (
            <Button size="sm" variant="outline" onClick={() => setAddOnModal("new")}>
              <Plus className="size-4" aria-hidden />
              {t("form.newAddOn")}
            </Button>
          )}
        </div>

        {addOns.length === 0 ? (
          <EmptyState icon={Coins} message={t("noAddOns")} />
        ) : (
          <TableCard>
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className={TR_HEAD}>
                  <Th>{t("addOnCode")}</Th>
                  <Th>{t("addOnName")}</Th>
                  <Th>{t("addOnFeature")}</Th>
                  <Th className="text-end">{t("addOnPrice")}</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {addOns.map((a) => (
                  <tr key={a.id} className="border-b last:border-b-0">
                    <Td className="font-mono text-xs">{a.code}</Td>
                    <Td className="font-medium">{a.name}</Td>
                    <Td className="text-muted-foreground font-mono text-xs">{a.feature_key}</Td>
                    <Td className="text-end tabular-nums">
                      {formatMoney({ amount: a.price_minor, currency: a.currency }, locale)}
                    </Td>
                    <Td className="text-end">
                      {canManage && (
                        <button
                          type="button"
                          onClick={() => setAddOnModal(a)}
                          aria-label={t("form.editAddOn")}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <Pencil className="size-4" aria-hidden />
                        </button>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableCard>
        )}
      </section>

      {addOnModal !== null && catalog !== null && (
        <AddOnFormModal
          open
          addOn={addOnModal === "new" ? null : addOnModal}
          catalog={catalog}
          onClose={() => setAddOnModal(null)}
          onSaved={() => {
            setAddOnModal(null);
            void load();
          }}
        />
      )}
    </div>
  );
}
