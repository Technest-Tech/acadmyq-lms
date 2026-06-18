"use client";

import { Coins, FileText, Globe, User } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Combobox, DialCodePicker, type ComboboxOption } from "@/components/ui/combobox";
import { ApiError, createGuardian, type GuardianInput } from "@/lib/api";
import { COUNTRIES, CURRENCIES } from "@/lib/countries";
import { cn } from "@/lib/utils";

const inputBase =
  "border-input bg-background placeholder:text-muted-foreground focus:border-primary focus:ring-primary/15 w-full rounded-xl border text-sm outline-none transition-colors focus:ring-3 disabled:opacity-50";

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">
        {label}
        {required && <span className="text-destructive ms-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
}

// ── Option lists (memoised outside the component so they're stable) ───────────

const dialOptions: ComboboxOption[] = COUNTRIES.map((c) => ({
  value: c.code,
  label: c.name,
  sublabel: c.dialCode,
  pre: c.flag,
}));

const countryOptions: ComboboxOption[] = [
  { value: "", label: "—" },
  ...COUNTRIES.map((c) => ({
    value: c.code,
    label: c.code,
    sublabel: c.name,
    pre: c.flag,
  })),
];

const currencyOptions: ComboboxOption[] = [
  { value: "", label: "None", sublabel: "—" },
  ...CURRENCIES.map((c) => ({
    value: c.code,
    label: c.code,
    sublabel: c.name,
  })),
];

// ── Component ─────────────────────────────────────────────────────────────────

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
  // Phone split: dialCountryCode (ISO-2) + localNumber (digits only)
  const [dialCountry, setDialCountry] = useState("SA");
  const [localNumber, setLocalNumber] = useState("");
  const [country, setCountry] = useState("");
  const [currency, setCurrency] = useState("");
  const [notes, setNotes] = useState("");

  // When a country is picked, auto-fill dial code + currency (if both are still empty/default)
  function handleCountryChange(code: string) {
    setCountry(code);
    if (!code) return;
    const found = COUNTRIES.find((c) => c.code === code);
    if (!found) return;
    setDialCountry(found.code);
    if (!currency) setCurrency(found.currency);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const dialEntry = COUNTRIES.find((c) => c.code === dialCountry);
      const whatsapp_phone = dialEntry
        ? dialEntry.dialCode + localNumber
        : localNumber;

      const input: GuardianInput = {
        full_name: fullName,
        whatsapp_phone,
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
    <form className="space-y-5" onSubmit={submit} data-testid="guardian-form">
      {error && (
        <AlertBanner
          variant="error"
          message={error}
          onDismiss={() => setError(null)}
        />
      )}

      {/* Full name */}
      <Field label={t("form.fullName")} required>
        <div className="relative">
          <User className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            id="gf-name"
            aria-label={t("form.fullName")}
            className={cn(inputBase, "py-2.5 ps-10 pe-3.5")}
            placeholder="e.g. Ahmed Family"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
          />
        </div>
      </Field>

      {/* WhatsApp phone — always LTR with country-code picker */}
      <Field
        label={t("form.phone")}
        required
        hint={t("form.phoneHint")}
      >
        {/* Unified input group: [Flag+Code ▾ | number...] */}
        <div
          dir="ltr"
          className={cn(
            "border-input flex h-10 overflow-hidden rounded-xl border transition-all",
            "focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20",
          )}
        >
          <DialCodePicker
            options={dialOptions}
            value={dialCountry}
            onChange={setDialCountry}
            searchPlaceholder="Country or code…"
          />
          <input
            id="gf-phone"
            dir="ltr"
            type="tel"
            inputMode="numeric"
            aria-label={t("form.phone")}
            placeholder="512345678"
            value={localNumber}
            onChange={(e) => setLocalNumber(e.target.value.replace(/[^\d]/g, ""))}
            required
            className="flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      </Field>

      {/* Country + Currency — searchable comboboxes */}
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("form.country")}>
          <Combobox
            options={countryOptions}
            value={country}
            onChange={handleCountryChange}
            placeholder={t("form.countryPlaceholder")}
            searchPlaceholder="Search country…"
          />
        </Field>
        <Field label={t("form.currency")}>
          <Combobox
            options={currencyOptions}
            value={currency}
            onChange={setCurrency}
            placeholder={t("form.currencyPlaceholder")}
            searchPlaceholder="Search currency…"
          />
        </Field>
      </div>

      {/* Notes */}
      <Field label={t("form.notes")}>
        <div className="relative">
          <FileText className="pointer-events-none absolute start-3.5 top-3 size-4 text-muted-foreground" />
          <textarea
            id="gf-notes"
            aria-label={t("form.notes")}
            className={cn(inputBase, "resize-none py-2.5 ps-10 pe-3.5")}
            rows={3}
            placeholder="Optional notes…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </Field>

      <div className="flex justify-end gap-2 pt-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={busy}
        >
          {t("back")}
        </Button>
        <Button type="submit" disabled={busy} className="gap-1.5">
          {busy && (
            <span className="size-3.5 animate-spin rounded-full border border-current border-t-transparent" />
          )}
          {busy ? t("form.creating") : t("form.create")}
        </Button>
      </div>
    </form>
  );
}
