"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  ApiError,
  createAddOn,
  updateAddOn,
  type AddOnCatalogItem,
  type CapabilityCatalog,
} from "@/lib/api";

const inputClass =
  "border-input bg-background w-full rounded-md border px-3 py-2 text-sm";

const toMinor = (major: string) => Math.round(parseFloat(major || "0") * 100);
const toMajor = (minor: number) => (minor / 100).toString();

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
