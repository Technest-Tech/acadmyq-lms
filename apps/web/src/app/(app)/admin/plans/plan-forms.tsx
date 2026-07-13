"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  ApiError,
  createAddOn,
  createPlan,
  updateAddOn,
  updatePlan,
  type AddOnCatalogItem,
  type CapabilityCatalog,
  type PlanCatalogItem,
} from "@/lib/api";

const inputClass =
  "border-input bg-background w-full rounded-md border px-3 py-2 text-sm";

const toMinor = (major: string) => Math.round(parseFloat(major || "0") * 100);
const toMajor = (minor: number) => (minor / 100).toString();

// ── Plan create / edit ───────────────────────────────────────────────────────

export function PlanFormModal({
  open,
  plan,
  catalog,
  onClose,
  onSaved,
}: {
  open: boolean;
  plan: PlanCatalogItem | null;
  catalog: CapabilityCatalog;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("planAdmin.form");
  const editing = plan !== null;

  const [code, setCode] = useState(plan?.code ?? "");
  const [name, setName] = useState(plan?.name ?? "");
  const [price, setPrice] = useState(toMajor(plan?.price_minor ?? 0));
  const [currency, setCurrency] = useState(plan?.currency ?? "EGP");
  // R3: every plan belongs to one sellable module (plans.module).
  const [planModule, setPlanModule] = useState<"MANAGEMENT" | "VIDEO" | "WHATSAPP">(
    plan?.module ?? "MANAGEMENT",
  );
  const [isActive, setIsActive] = useState(plan?.is_active ?? true);
  const [caps, setCaps] = useState<string[]>(
    plan?.features?.capabilities ?? [],
  );
  const [limits, setLimits] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const key of Object.keys(catalog.limits)) {
      const v = plan?.features?.limits?.[key];
      init[key] = v === null || v === undefined ? "" : String(v);
    }
    return init;
  });
  // Boolean plan flags live in features.limits as 1/0 (fail open) — checked = allowed unless the
  // stored value is exactly 0.
  const flagCatalog = catalog.flags ?? {};
  const [flags, setFlags] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const key of Object.keys(flagCatalog)) {
      init[key] = plan?.features?.limits?.[key] !== 0;
    }
    return init;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleCap(key: string) {
    setCaps((c) => (c.includes(key) ? c.filter((k) => k !== key) : [...c, key]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const features = {
      capabilities: caps,
      limits: {
        ...Object.fromEntries(
          Object.keys(catalog.limits).map((k) => [
            k,
            limits[k]?.trim() ? Number(limits[k]) : null,
          ]),
        ),
        // Flags ride in the same map as 1/0 so Entitlement resolves them with the limits.
        ...Object.fromEntries(Object.keys(flagCatalog).map((k) => [k, flags[k] ? 1 : 0])),
      },
    };
    try {
      if (editing) {
        await updatePlan(plan.id, {
          name: name.trim(),
          price_minor: toMinor(price),
          currency: currency.toUpperCase(),
          module: planModule,
          features,
          is_active: isActive,
        });
      } else {
        await createPlan({
          code: code.trim(),
          name: name.trim(),
          price_minor: toMinor(price),
          currency: currency.toUpperCase(),
          module: planModule,
          features,
          is_active: isActive,
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title={editing ? t("editPlan") : t("newPlan")}
      footer={
        <>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            size="sm"
            disabled={busy}
            onClick={submit}
            data-testid="plan-form-save"
          >
            {busy ? t("saving") : t("save")}
          </Button>
        </>
      }
    >
      <form className="space-y-3" onSubmit={submit}>
        {error && <AlertBanner variant="error" message={error} />}
        {!editing && (
          <label className="block space-y-1">
            <span className="text-sm font-medium">{t("code")}</span>
            <input
              aria-label={t("code")}
              className={inputClass}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              required
              dir="ltr"
            />
          </label>
        )}
        <label className="block space-y-1">
          <span className="text-sm font-medium">{t("name")}</span>
          <input
            aria-label={t("name")}
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-sm font-medium">{t("price")}</span>
            <input
              aria-label={t("price")}
              type="number"
              min="0"
              step="0.01"
              className={inputClass}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              dir="ltr"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">{t("currency")}</span>
            <input
              aria-label={t("currency")}
              className={inputClass}
              maxLength={3}
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              dir="ltr"
            />
          </label>
        </div>

        <label className="block space-y-1">
          <span className="text-sm font-medium">{t("module")}</span>
          <select
            aria-label={t("module")}
            className={inputClass}
            value={planModule}
            onChange={(e) => setPlanModule(e.target.value as "MANAGEMENT" | "VIDEO" | "WHATSAPP")}
            data-testid="plan-module"
          >
            <option value="MANAGEMENT">{t("moduleManagement")}</option>
            <option value="VIDEO">{t("moduleVideo")}</option>
            <option value="WHATSAPP">{t("moduleWhatsapp")}</option>
          </select>
        </label>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t("capabilities")}</legend>
          {Object.entries(catalog.capabilities).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={caps.includes(key)}
                onChange={() => toggleCap(key)}
                data-testid={`cap-${key}`}
              />
              <span>{label}</span>
              <span className="text-muted-foreground font-mono text-xs" dir="ltr">
                {key}
              </span>
            </label>
          ))}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t("limits")}</legend>
          <p className="text-muted-foreground text-xs">{t("limitsHint")}</p>
          {Object.entries(catalog.limits).map(([key, label]) => (
            <label key={key} className="flex items-center justify-between gap-2 text-sm">
              <span>{label}</span>
              <input
                aria-label={label}
                type="number"
                min="0"
                placeholder={t("unlimited")}
                className="border-input bg-background w-28 rounded-md border px-2 py-1 text-sm"
                value={limits[key] ?? ""}
                onChange={(e) =>
                  setLimits((l) => ({ ...l, [key]: e.target.value }))
                }
                dir="ltr"
              />
            </label>
          ))}
        </fieldset>

        {Object.keys(flagCatalog).length > 0 && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t("flags")}</legend>
            <p className="text-muted-foreground text-xs">{t("flagsHint")}</p>
            {Object.entries(flagCatalog).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={flags[key] ?? true}
                  onChange={() => setFlags((f) => ({ ...f, [key]: !(f[key] ?? true) }))}
                  data-testid={`flag-${key}`}
                />
                <span>{label}</span>
                <span className="text-muted-foreground font-mono text-xs" dir="ltr">
                  {key}
                </span>
              </label>
            ))}
          </fieldset>
        )}

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          <span>{t("active")}</span>
        </label>
      </form>
    </Modal>
  );
}

// ── Add-on create / edit ─────────────────────────────────────────────────────

export function AddOnFormModal({
  open,
  addOn,
  catalog,
  onClose,
  onSaved,
}: {
  open: boolean;
  addOn: AddOnCatalogItem | null;
  catalog: CapabilityCatalog;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("planAdmin.form");
  const editing = addOn !== null;
  const capKeys = Object.keys(catalog.capabilities);

  const [code, setCode] = useState(addOn?.code ?? "");
  const [name, setName] = useState(addOn?.name ?? "");
  const [price, setPrice] = useState(toMajor(addOn?.price_minor ?? 0));
  const [currency, setCurrency] = useState(addOn?.currency ?? "EGP");
  const [featureKey, setFeatureKey] = useState(
    addOn?.feature_key ?? capKeys[0] ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (editing) {
        await updateAddOn(addOn.id, {
          name: name.trim(),
          price_minor: toMinor(price),
          currency: currency.toUpperCase(),
          feature_key: featureKey,
        });
      } else {
        await createAddOn({
          code: code.trim(),
          name: name.trim(),
          price_minor: toMinor(price),
          currency: currency.toUpperCase(),
          feature_key: featureKey,
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title={editing ? t("editAddOn") : t("newAddOn")}
      footer={
        <>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            size="sm"
            disabled={busy}
            onClick={submit}
            data-testid="addon-form-save"
          >
            {busy ? t("saving") : t("save")}
          </Button>
        </>
      }
    >
      <form className="space-y-3" onSubmit={submit}>
        {error && <AlertBanner variant="error" message={error} />}
        {!editing && (
          <label className="block space-y-1">
            <span className="text-sm font-medium">{t("code")}</span>
            <input
              aria-label={t("code")}
              className={inputClass}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              required
              dir="ltr"
            />
          </label>
        )}
        <label className="block space-y-1">
          <span className="text-sm font-medium">{t("name")}</span>
          <input
            aria-label={t("name")}
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-sm font-medium">{t("price")}</span>
            <input
              aria-label={t("price")}
              type="number"
              min="0"
              step="0.01"
              className={inputClass}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              dir="ltr"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">{t("currency")}</span>
            <input
              aria-label={t("currency")}
              className={inputClass}
              maxLength={3}
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              dir="ltr"
            />
          </label>
        </div>
        <label className="block space-y-1">
          <span className="text-sm font-medium">{t("featureKey")}</span>
          <select
            aria-label={t("featureKey")}
            className={inputClass}
            value={featureKey}
            onChange={(e) => setFeatureKey(e.target.value)}
            dir="ltr"
          >
            {capKeys.map((k) => (
              <option key={k} value={k}>
                {catalog.capabilities[k]} ({k})
              </option>
            ))}
          </select>
        </label>
      </form>
    </Modal>
  );
}
