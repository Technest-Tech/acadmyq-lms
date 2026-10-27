"use client";

import { CalendarClock, StickyNote, User } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DialCodePicker, type ComboboxOption } from "@/components/ui/combobox";
import {
  ApiError,
  createLead,
  LEAD_SOURCES,
  listSpecializations,
  updateLead,
  type LeadRow,
  type LeadSource,
} from "@/lib/api";
import { COUNTRIES } from "@/lib/countries";
import { useAcademyDefaults } from "@/lib/academy-defaults";
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

const dialOptions: ComboboxOption[] = COUNTRIES.map((c) => ({
  value: c.code,
  label: c.name,
  sublabel: c.dialCode,
  pre: c.flag,
}));

/**
 * A stored number split back into the picker's two halves. The longest matching dial code wins, so
 * "+971…" is the Emirates and not a "+97" that does not exist; no match keeps the academy default.
 */
function splitPhone(phone: string | null, fallback: string): { country: string; local: string } {
  if (!phone) return { country: fallback, local: "" };
  const match = COUNTRIES.filter((c) => phone.startsWith(c.dialCode)).sort(
    (a, b) => b.dialCode.length - a.dialCode.length,
  )[0];
  return match
    ? { country: match.code, local: phone.slice(match.dialCode.length).replace(/\D/g, "") }
    : { country: fallback, local: phone.replace(/\D/g, "") };
}

/**
 * Capture a new lead in one small screen: who, how to reach them, where they came from,
 * what they want, and when to call back. The source is a row of big tappable chips (not a
 * dropdown) because the sales desk fills this in mid-phone-call.
 *
 * Given a `lead`, the same screen corrects it after it was added — prefilled, saved as an edit. The
 * first-note box is creation-only: later notes go on the timeline, where they keep their date.
 */
export function LeadForm({
  lead,
  onCreated,
  onCancel,
}: {
  lead?: LeadRow;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("crm");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [fullName, setFullName] = useState(lead?.full_name ?? "");
  // The academy's own defaults (Settings → Academy) open the pickers; the form can still change them.
  const defaults = useAcademyDefaults();
  const [initialPhone] = useState(() => splitPhone(lead?.whatsapp_phone ?? null, defaults.dialCountry));
  const [dialCountry, setDialCountry] = useState(initialPhone.country);
  const [localNumber, setLocalNumber] = useState(initialPhone.local);
  const [source, setSource] = useState<LeadSource>(lead?.source ?? "WHATSAPP");
  const [interestedIn, setInterestedIn] = useState(lead?.interested_in ?? "");
  const [followUpAt, setFollowUpAt] = useState(lead?.follow_up_at ?? "");
  const [note, setNote] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);

  // Offer the academy's specializations as "interested in" suggestions (free text stays allowed).
  useEffect(() => {
    void listSpecializations()
      .then((r) => setSuggestions(r.specializations.filter((s) => s.is_active).map((s) => s.name)))
      .catch(() => {});
  }, []);

  function buildPhone(): string | null {
    if (!localNumber) return null;
    const dialEntry = COUNTRIES.find((c) => c.code === dialCountry);
    return dialEntry ? dialEntry.dialCode + localNumber : localNumber;
  }

  async function save() {
    if (!fullName.trim()) {
      setError(t("form.nameRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // An untouched number goes back exactly as stored — a split that guessed wrong can't rewrite it.
      const phoneUntouched =
        lead !== undefined && dialCountry === initialPhone.country && localNumber === initialPhone.local;
      const details = {
        full_name: fullName.trim(),
        whatsapp_phone: phoneUntouched ? lead.whatsapp_phone : buildPhone(),
        source,
        interested_in: interestedIn.trim() || null,
        follow_up_at: followUpAt || null,
      };
      if (lead) {
        await updateLead(lead.id, details);
      } else {
        await createLead({ ...details, note: note.trim() || null });
      }
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5" data-testid="crm-lead-form">
      {error && (
        <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />
      )}

      <Field label={t("form.name")} required>
        <div className="relative">
          <User className="text-muted-foreground pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2" />
          <input
            aria-label={t("form.name")}
            className={cn(inputBase, "py-2.5 ps-10 pe-3.5")}
            placeholder={t("form.namePlaceholder")}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            data-testid="crm-form-name"
          />
        </div>
      </Field>

      <Field label={t("form.phone")} hint={t("form.phoneHint")}>
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
            dir="ltr"
            type="tel"
            inputMode="numeric"
            aria-label={t("form.phone")}
            placeholder="1012345678"
            value={localNumber}
            onChange={(e) => setLocalNumber(e.target.value.replace(/[^\d]/g, ""))}
            className="placeholder:text-muted-foreground flex-1 bg-transparent px-3 text-sm outline-none"
            data-testid="crm-form-phone"
          />
        </div>
      </Field>

      <Field label={t("form.source")} required>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4" role="radiogroup">
          {LEAD_SOURCES.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={source === s}
              onClick={() => setSource(s)}
              data-testid={`crm-source-${s}`}
              className={cn(
                "rounded-xl border px-2 py-2 text-xs font-medium transition-colors",
                source === s
                  ? "border-primary bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted/50",
              )}
            >
              {t(`source.${s}`)}
            </button>
          ))}
        </div>
      </Field>

      <Field label={t("form.interestedIn")} hint={t("form.interestedInHint")}>
        <input
          aria-label={t("form.interestedIn")}
          className={cn(inputBase, "px-3.5 py-2.5")}
          placeholder={t("form.interestedInPlaceholder")}
          value={interestedIn}
          onChange={(e) => setInterestedIn(e.target.value)}
          list="crm-interest-suggestions"
          data-testid="crm-form-interest"
        />
        <datalist id="crm-interest-suggestions">
          {suggestions.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </Field>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label={t("form.followUp")} hint={t("form.followUpHint")}>
          <div className="relative">
            <CalendarClock className="text-muted-foreground pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2" />
            <input
              type="date"
              aria-label={t("form.followUp")}
              className={cn(inputBase, "py-2.5 ps-10 pe-3.5")}
              value={followUpAt}
              onChange={(e) => setFollowUpAt(e.target.value)}
              data-testid="crm-form-followup"
            />
          </div>
        </Field>
      </div>

      {!lead && (
      <Field label={t("form.note")}>
        <div className="relative">
          <StickyNote className="text-muted-foreground pointer-events-none absolute start-3.5 top-3 size-4" />
          <textarea
            aria-label={t("form.note")}
            rows={2}
            maxLength={2000}
            className={cn(inputBase, "py-2.5 ps-10 pe-3.5")}
            placeholder={t("form.notePlaceholder")}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            data-testid="crm-form-note"
          />
        </div>
      </Field>
      )}

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <div className="mt-2 flex items-center justify-between gap-2 border-t pt-4">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          {t("form.cancel")}
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => void save()}
          disabled={busy}
          className="gap-1.5"
          data-testid="crm-form-save"
        >
          {busy && (
            <span className="size-3.5 animate-spin rounded-full border border-current border-t-transparent" />
          )}
          {lead ? t("form.saveChanges") : t("form.save")}
        </Button>
      </div>
    </div>
  );
}
