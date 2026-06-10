"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ApiError, createGuardian, type GuardianInput } from "@/lib/api";

const inputClass =
  "border-input bg-background w-full rounded-md border px-3 py-2 text-sm";

/** Create a guardian — the billing anchor; currency defaults to the academy default. */
export function GuardianForm({
  onCreated,
  onCancel,
}: {
  onCreated: (guardianId: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("guardians");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("");
  const [currency, setCurrency] = useState("");
  const [notes, setNotes] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const input: GuardianInput = {
        full_name: fullName,
        whatsapp_phone: phone,
        country: country || null,
        currency: currency || null,
        notes: notes || null,
      };
      const res = await createGuardian(input);
      onCreated(res.guardianId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="max-w-xl space-y-4"
      onSubmit={submit}
      data-testid="guardian-form"
    >
      <h2 className="text-lg font-medium">{t("new")}</h2>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      <label className="block space-y-1">
        <span className="text-sm font-medium">{t("form.fullName")}</span>
        <input
          aria-label={t("form.fullName")}
          className={inputClass}
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          required
        />
      </label>
      <label className="block space-y-1">
        <span className="text-sm font-medium">{t("form.phone")}</span>
        <input
          aria-label={t("form.phone")}
          className={inputClass}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className="text-sm font-medium">{t("form.country")}</span>
          <input
            aria-label={t("form.country")}
            className={inputClass}
            maxLength={2}
            value={country}
            onChange={(e) => setCountry(e.target.value.toUpperCase())}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">{t("form.currency")}</span>
          <input
            aria-label={t("form.currency")}
            className={inputClass}
            maxLength={3}
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          />
        </label>
      </div>
      <label className="block space-y-1">
        <span className="text-sm font-medium">{t("form.notes")}</span>
        <textarea
          aria-label={t("form.notes")}
          className={inputClass}
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? t("form.creating") : t("form.create")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t("back")}
        </Button>
      </div>
    </form>
  );
}
