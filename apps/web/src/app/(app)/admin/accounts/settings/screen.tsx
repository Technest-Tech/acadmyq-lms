"use client";

import { BellRing, Banknote, Tags } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { SectionCard, SectionCardFooter } from "@/components/admin/section-card";
import { useAuth } from "@/components/auth-provider";
import { RETIRED_MODULES } from "@/components/clients/client-summary";
import { AccountsTabs } from "@/components/finance/accounts-tabs";
import { Field, inputClass } from "@/components/finance/finance-fields";
import { errorMessage, fromMinor, toMinor } from "@/components/finance/finance-format";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  FINANCE_CURRENCIES,
  getPlatformSettings,
  listClients,
  MODULE_CODES,
  testAccountReminder,
  updatePlatformSettings,
  type AccountReminderSettings,
  type ClientDirectoryEntry,
  type ModuleCode,
} from "@/lib/api";

type PayMethods = {
  INSTAPAY: { enabled: boolean; display_name?: string; handle?: string };
  VODAFONE_CASH: { enabled: boolean; display_name?: string; number?: string };
};

const DEFAULT_PAY: PayMethods = {
  INSTAPAY: { enabled: true, display_name: "InstaPay", handle: "" },
  VODAFONE_CASH: { enabled: true, display_name: "Vodafone Cash", number: "" },
};

/**
 * Accounts → Settings — the three things the money section runs on, in one place:
 *
 *   reminders        which WhatsApp number sends them (any client of ours with a connected
 *                    WhatsApp — in practice the owner's own WhatsApp-only client), and the owner's
 *                    phone for the morning digest
 *   where to pay     the InstaPay / Vodafone Cash details every client's pay link shows
 *   default prices   per module, the starting price an agreement form fills in
 */
export function AccountsSettingsScreen() {
  const t = useTranslations("accounts.settings");
  const ta = useTranslations("accounts");
  const tm = useTranslations("clients.modules");
  const toast = useToast();
  const { can } = useAuth();

  const [reminders, setReminders] = useState<AccountReminderSettings>({ enabled: true, sender_academy_id: null, owner_phone: null });
  const [pay, setPay] = useState<PayMethods>(DEFAULT_PAY);
  const [prices, setPrices] = useState<Record<string, { price: string; currency: string }>>({});
  const [senders, setSenders] = useState<ClientDirectoryEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [settings, directory] = await Promise.all([getPlatformSettings(), listClients()]);
      const s = settings.settings as Record<string, unknown>;
      const r = (s.accounts_reminders ?? {}) as Partial<AccountReminderSettings>;
      setReminders({ enabled: r.enabled ?? true, sender_academy_id: r.sender_academy_id ?? null, owner_phone: r.owner_phone ?? null });
      const pm = (s.platform_payment_methods ?? {}) as Partial<PayMethods>;
      setPay({
        INSTAPAY: { ...DEFAULT_PAY.INSTAPAY, ...(pm.INSTAPAY ?? {}) },
        VODAFONE_CASH: { ...DEFAULT_PAY.VODAFONE_CASH, ...(pm.VODAFONE_CASH ?? {}) },
      });
      const mp = (s.module_pricing ?? {}) as Partial<Record<ModuleCode, { price_minor: number; currency: string }>>;
      setPrices(
        Object.fromEntries(
          MODULE_CODES.map((code) => [code, { price: mp[code]?.price_minor ? fromMinor(mp[code]!.price_minor) : "", currency: mp[code]?.currency ?? "EGP" }]),
        ),
      );
      setSenders(directory.clients.filter((c) => c.modules.some((m) => m.module === "WHATSAPP" && m.status === "ACTIVE")));
      setLoaded(true);
    } catch (e) {
      toast.error(errorMessage(e, ta("loadError")));
    }
  }, [toast, ta]);

  useEffect(() => {
    if (can("platform.manage")) void load();
  }, [load, can]);

  const modules = useMemo(
    () => MODULE_CODES.filter((code) => !RETIRED_MODULES.includes(code) || (prices[code]?.price ?? "") !== ""),
    [prices],
  );

  if (!can("platform.manage")) {
    return <p className="text-muted-foreground text-sm">{ta("noPermission")}</p>;
  }

  const save = async (key: string, payload: Record<string, unknown>) => {
    setBusy(key);
    try {
      await updatePlatformSettings(payload);
      toast.success(t("saved"));
    } catch (e) {
      toast.error(errorMessage(e, ta("loadError")));
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy("test");
    try {
      await updatePlatformSettings({ accounts_reminders: reminders });
      const res = await testAccountReminder();
      if (res.sent) toast.success(t("testSent"));
      else toast.error(t("testFailed"));
    } catch (e) {
      toast.error(errorMessage(e, t("testFailed")));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5" data-testid="accounts-settings">
      <AdminPageHeader title={ta("title")} subtitle={t("subtitle")} />
      <AccountsTabs />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SectionCard icon={BellRing} title={t("reminders")} description={t("remindersHint")} testId="settings-reminders">
          <div className="space-y-4">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                className="accent-primary size-4"
                checked={reminders.enabled}
                onChange={(e) => setReminders((r) => ({ ...r, enabled: e.target.checked }))}
              />
              {t("remindersOn")}
            </label>
            <Field label={t("sender")} htmlFor="acct-sender" hint={senders.length === 0 && loaded ? t("noSenders") : t("senderHint")}>
              <select
                id="acct-sender"
                className={inputClass}
                value={reminders.sender_academy_id ?? ""}
                onChange={(e) => setReminders((r) => ({ ...r, sender_academy_id: e.target.value || null }))}
                data-testid="acct-sender"
              >
                <option value="">{t("pickSender")}</option>
                {senders.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("ownerPhone")} htmlFor="acct-owner-phone" hint={t("ownerPhoneHint")}>
              <input
                id="acct-owner-phone"
                className={inputClass}
                dir="ltr"
                placeholder="+20…"
                value={reminders.owner_phone ?? ""}
                onChange={(e) => setReminders((r) => ({ ...r, owner_phone: e.target.value || null }))}
              />
            </Field>
            <ul className="text-muted-foreground list-disc space-y-0.5 ps-5 text-xs">
              <li>{t("rule1")}</li>
              <li>{t("rule2")}</li>
              <li>{t("rule3")}</li>
              <li>{t("rule4")}</li>
            </ul>
          </div>
          <SectionCardFooter className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy !== null} onClick={() => void save("reminders", { accounts_reminders: reminders })} data-testid="save-reminders">
              {t("save")}
            </Button>
            <Button size="sm" variant="outline" disabled={busy !== null || !reminders.sender_academy_id || !reminders.owner_phone} onClick={() => void test()}>
              {t("test")}
            </Button>
          </SectionCardFooter>
        </SectionCard>

        <SectionCard icon={Banknote} title={t("payTo")} description={t("payToHint")} testId="settings-pay">
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-end">
              <label className="flex items-center gap-2 text-sm font-medium sm:pb-2">
                <input
                  type="checkbox"
                  className="accent-primary size-4"
                  checked={pay.INSTAPAY.enabled}
                  onChange={(e) => setPay((p) => ({ ...p, INSTAPAY: { ...p.INSTAPAY, enabled: e.target.checked } }))}
                />
                InstaPay
              </label>
              <Field label={t("instapayHandle")} htmlFor="acct-instapay">
                <input
                  id="acct-instapay"
                  className={inputClass}
                  dir="ltr"
                  placeholder="name@instapay"
                  value={pay.INSTAPAY.handle ?? ""}
                  onChange={(e) => setPay((p) => ({ ...p, INSTAPAY: { ...p.INSTAPAY, handle: e.target.value } }))}
                />
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-end">
              <label className="flex items-center gap-2 text-sm font-medium sm:pb-2">
                <input
                  type="checkbox"
                  className="accent-primary size-4"
                  checked={pay.VODAFONE_CASH.enabled}
                  onChange={(e) => setPay((p) => ({ ...p, VODAFONE_CASH: { ...p.VODAFONE_CASH, enabled: e.target.checked } }))}
                />
                Vodafone Cash
              </label>
              <Field label={t("vodafoneNumber")} htmlFor="acct-vodafone">
                <input
                  id="acct-vodafone"
                  className={inputClass}
                  dir="ltr"
                  placeholder="+201xxxxxxxxx"
                  value={pay.VODAFONE_CASH.number ?? ""}
                  onChange={(e) => setPay((p) => ({ ...p, VODAFONE_CASH: { ...p.VODAFONE_CASH, number: e.target.value } }))}
                />
              </Field>
            </div>
          </div>
          <SectionCardFooter>
            <Button size="sm" disabled={busy !== null} onClick={() => void save("pay", { platform_payment_methods: pay })} data-testid="save-payment">
              {t("save")}
            </Button>
          </SectionCardFooter>
        </SectionCard>

        <SectionCard icon={Tags} title={t("prices")} description={t("pricesHint")} testId="settings-prices" className="xl:col-span-2">
          <div className="divide-y">
            {modules.map((code) => {
              const row = prices[code] ?? { price: "", currency: "EGP" };
              return (
                <div key={code} className="grid grid-cols-1 items-end gap-3 py-3 first:pt-0 sm:grid-cols-[10rem_minmax(0,12rem)_7rem]" data-testid={`price-row-${code}`}>
                  <span className="text-sm font-bold sm:pb-2">{tm(code)}</span>
                  <Field label={t("perMonth")} htmlFor={`price-${code}`}>
                    <input
                      id={`price-${code}`}
                      type="number"
                      min={0}
                      inputMode="decimal"
                      className={inputClass}
                      dir="ltr"
                      value={row.price}
                      onChange={(e) => setPrices((p) => ({ ...p, [code]: { ...row, price: e.target.value } }))}
                    />
                  </Field>
                  <Field label={t("currency")} htmlFor={`cur-${code}`}>
                    <select
                      id={`cur-${code}`}
                      className={inputClass}
                      value={row.currency}
                      onChange={(e) => setPrices((p) => ({ ...p, [code]: { ...row, currency: e.target.value } }))}
                    >
                      {FINANCE_CURRENCIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              );
            })}
          </div>
          <SectionCardFooter>
            <Button
              size="sm"
              disabled={busy !== null}
              data-testid="save-pricing"
              onClick={() =>
                void save("prices", {
                  module_pricing: Object.fromEntries(
                    MODULE_CODES.filter((c) => prices[c]).map((c) => [c, { price_minor: toMinor(prices[c]!.price) ?? 0, currency: prices[c]!.currency }]),
                  ),
                })
              }
            >
              {t("save")}
            </Button>
          </SectionCardFooter>
        </SectionCard>
      </div>
    </div>
  );
}
