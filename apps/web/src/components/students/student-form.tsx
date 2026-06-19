"use client";

import { User, UserCheck, Zap } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Combobox, DialCodePicker, type ComboboxOption } from "@/components/ui/combobox";
import {
  ApiError,
  createStudent,
  type GuardianRow,
  listGuardians,
} from "@/lib/api";
import { COUNTRIES } from "@/lib/countries";
import { cn } from "@/lib/utils";

// ── Helpers ────────────────────────────────────────────────────────────────────

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

const countryOptions: ComboboxOption[] = [
  { value: "", label: "—" },
  ...COUNTRIES.map((c) => ({
    value: c.code,
    label: c.code,
    sublabel: c.name,
    pre: c.flag,
  })),
];

/** Split a stored E.164 phone back into a dial-code country + local number for the inputs. */
function splitPhone(phone: string | null | undefined): {
  dialCountry: string;
  localNumber: string;
} {
  if (!phone) return { dialCountry: "SA", localNumber: "" };
  const match = [...COUNTRIES]
    .sort((a, b) => b.dialCode.length - a.dialCode.length)
    .find((c) => phone.startsWith(c.dialCode));
  return match
    ? { dialCountry: match.code, localNumber: phone.slice(match.dialCode.length) }
    : { dialCountry: "SA", localNumber: phone.replace(/[^\d]/g, "") };
}

// ── Component ──────────────────────────────────────────────────────────────────

/**
 * A single, general "create student" form. It captures only the student's own details and
 * always saves them as a TRIAL — scheduling a trial session, assigning a teacher, and pricing
 * are completed afterwards from the student's profile (see the trial banner there). This keeps
 * intake fast: get the person into the system, then act on them from the details page.
 */
export function StudentForm({
  fixedGuardianId,
  initialFullName,
  initialPhone,
  onCreated,
  onCancel,
}: {
  fixedGuardianId?: string;
  /** Prefill the name (e.g. converting a trial lead into a student). */
  initialFullName?: string;
  /** Prefill the phone from a stored E.164 number, split into dial-code + local. */
  initialPhone?: string | null;
  onCreated: (studentId: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("students");
  const initialSplit = splitPhone(initialPhone);
  const [guardians, setGuardians] = useState<GuardianRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [fullName, setFullName] = useState(initialFullName ?? "");
  const [dialCountry, setDialCountry] = useState(initialSplit.dialCountry);
  const [localNumber, setLocalNumber] = useState(initialSplit.localNumber);
  const [country, setCountry] = useState("");
  const [selfGuardian, setSelfGuardian] = useState(false);
  const [guardianId, setGuardianId] = useState(fixedGuardianId ?? "");

  useEffect(() => {
    if (!fixedGuardianId) {
      void listGuardians({ pageSize: 50 }).then((r) => setGuardians(r.rows));
    }
  }, [fixedGuardianId]);

  function handleCountryChange(code: string) {
    setCountry(code);
    if (!code || localNumber) return;
    const found = COUNTRIES.find((c) => c.code === code);
    if (found) setDialCountry(found.code);
  }

  // Selecting a guardian copies their country + WhatsApp onto the student, since
  // children almost always share the parent's contact details. The stored phone is
  // a full E.164 string, so split it back into dial-code + local parts for the inputs.
  function handleGuardianChange(id: string) {
    setGuardianId(id);
    const g = guardians.find((row) => row.id === id);
    if (!g) return;
    if (g.country) {
      setCountry(g.country);
      const c = COUNTRIES.find((x) => x.code === g.country);
      if (c) setDialCountry(c.code);
    }
    if (g.whatsapp_phone) {
      const phone = g.whatsapp_phone;
      // Several countries share a dial code (e.g. +1), so prefer the guardian's own
      // country when its prefix matches; otherwise fall back to the longest match.
      const ownCountry = COUNTRIES.find((c) => c.code === g.country);
      const match =
        ownCountry && phone.startsWith(ownCountry.dialCode)
          ? ownCountry
          : [...COUNTRIES]
              .sort((a, b) => b.dialCode.length - a.dialCode.length)
              .find((c) => phone.startsWith(c.dialCode));
      if (match) {
        setDialCountry(match.code);
        setLocalNumber(phone.slice(match.dialCode.length));
      } else {
        setLocalNumber(phone.replace(/[^\d]/g, ""));
      }
    }
  }

  function buildPhone(): string | null {
    if (!localNumber) return null;
    const dialEntry = COUNTRIES.find((c) => c.code === dialCountry);
    return dialEntry ? dialEntry.dialCode + localNumber : localNumber;
  }

  function validate(): boolean {
    if (!fullName.trim()) {
      setError(t("form.fullNameRequired"));
      return false;
    }
    if (!selfGuardian && !guardianId && !fixedGuardianId) {
      setError(t("form.guardianRequired"));
      return false;
    }
    setError(null);
    return true;
  }

  async function save() {
    if (!validate()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await createStudent({
        full_name: fullName,
        whatsapp_phone: buildPhone(),
        country: country || null,
        is_self_guardian: selfGuardian,
        guardian_id: selfGuardian ? undefined : ((fixedGuardianId ?? guardianId) || undefined),
        status: "TRIAL",
      });
      onCreated(res.studentId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5" data-testid="student-form">
      {error && (
        <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />
      )}

      {/* Trial intake banner — the student is saved as a trial; setup happens in their profile. */}
      <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800/40 dark:bg-amber-950/20">
        <Zap className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div>
          <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
            {t("form.trialBannerTitle")}
          </p>
          <p className="mt-0.5 text-xs text-amber-700/80 dark:text-amber-400/70">
            {t("form.trialBannerBody")}
          </p>
        </div>
      </div>

      <Field label={t("form.fullName")} required>
        <div className="relative">
          <User className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            aria-label={t("form.fullName")}
            className={cn(inputBase, "py-2.5 ps-10 pe-3.5")}
            placeholder={t("form.fullNamePlaceholder")}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
          />
        </div>
      </Field>

      <label className="flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2.5 transition-colors hover:bg-muted/30">
        <input
          type="checkbox"
          checked={selfGuardian}
          onChange={(e) => setSelfGuardian(e.target.checked)}
          data-testid="self-guardian"
          className="size-4 rounded accent-primary"
        />
        <div className="flex items-center gap-2">
          <UserCheck className="size-4 text-muted-foreground" aria-hidden />
          <span className="text-sm font-medium">{t("form.selfGuardian")}</span>
        </div>
      </label>

      {selfGuardian ? (
        <p className="rounded-xl border border-primary/20 bg-primary/5 px-3.5 py-2.5 text-xs text-muted-foreground">
          {t("form.selfGuardianHint")}
        </p>
      ) : (
        !fixedGuardianId && (
          <Field label={t("form.guardian")} required>
            <Combobox
              options={guardians.map((g) => ({ value: g.id, label: g.full_name }))}
              value={guardianId}
              onChange={handleGuardianChange}
              placeholder={t("form.none")}
              searchPlaceholder={t("form.searchGuardian")}
              data-testid="guardian-select"
            />
          </Field>
        )
      )}

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
            placeholder="512345678"
            value={localNumber}
            onChange={(e) => setLocalNumber(e.target.value.replace(/[^\d]/g, ""))}
            className="flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      </Field>

      <Field label={t("form.country")}>
        <Combobox
          options={countryOptions}
          value={country}
          onChange={handleCountryChange}
          placeholder={t("form.countryPlaceholder")}
          searchPlaceholder={t("form.searchCountry")}
        />
      </Field>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <div className="mt-2 flex items-center justify-between gap-2 border-t pt-4">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          {t("back")}
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => void save()}
          disabled={busy}
          className="gap-1.5"
        >
          {busy ? (
            <span className="size-3.5 animate-spin rounded-full border border-current border-t-transparent" />
          ) : (
            <Zap className="size-3.5" />
          )}
          {t("form.create")}
        </Button>
      </div>
    </div>
  );
}
