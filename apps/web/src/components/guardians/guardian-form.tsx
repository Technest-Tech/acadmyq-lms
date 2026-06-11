"use client";

import { Coins, FileText, Globe, MessageCircle, User } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ApiError, createGuardian, type GuardianInput } from "@/lib/api";
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
    <form className="space-y-5" onSubmit={submit} data-testid="guardian-form">
      {error && (
        <AlertBanner
          variant="error"
          message={error}
          onDismiss={() => setError(null)}
        />
      )}

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

      <Field
        label={t("form.phone")}
        required
        hint="E.164 format — e.g. +966512345678"
      >
        <div className="relative">
          <MessageCircle className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-emerald-500" />
          <input
            id="gf-phone"
            aria-label={t("form.phone")}
            className={cn(inputBase, "py-2.5 ps-10 pe-3.5")}
            placeholder="+966512345678"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t("form.country")}>
          <div className="relative">
            <Globe className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              id="gf-country"
              aria-label={t("form.country")}
              className={cn(inputBase, "py-2.5 ps-10 pe-3.5")}
              placeholder="SA"
              maxLength={2}
              value={country}
              onChange={(e) => setCountry(e.target.value.toUpperCase())}
            />
          </div>
        </Field>
        <Field label={t("form.currency")}>
          <div className="relative">
            <Coins className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              id="gf-currency"
              aria-label={t("form.currency")}
              className={cn(inputBase, "py-2.5 ps-10 pe-3.5")}
              placeholder="SAR"
              maxLength={3}
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            />
          </div>
        </Field>
      </div>

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
