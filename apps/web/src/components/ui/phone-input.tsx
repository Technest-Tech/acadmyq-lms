"use client";

import { DialCodePicker, type ComboboxOption } from "@/components/ui/combobox";
import { COUNTRIES } from "@/lib/countries";
import { cn } from "@/lib/utils";

const dialOptions: ComboboxOption[] = COUNTRIES.map((c) => ({
  value: c.code,
  label: c.name,
  sublabel: c.dialCode,
  pre: c.flag,
}));

/** A phone as the forms take it: the dial-code country (ISO-2) and the local digits. */
export interface PhoneParts {
  dialCountry: string;
  localNumber: string;
}

/** The parts → the E.164 string the API stores; null when no number was typed. */
export function joinPhone({ dialCountry, localNumber }: PhoneParts): string | null {
  if (!localNumber) return null;
  const dial = COUNTRIES.find((c) => c.code === dialCountry);
  return dial ? dial.dialCode + localNumber : localNumber;
}

/**
 * [Flag + code ▾ | number] — the same input group the student and parent forms use for WhatsApp,
 * for the numbers added beside it (a second phone, a parent typed into the student form).
 */
export function PhoneInput({
  value,
  onChange,
  ariaLabel,
  required,
  testId,
}: {
  value: PhoneParts;
  onChange: (next: PhoneParts) => void;
  ariaLabel: string;
  required?: boolean;
  testId?: string;
}) {
  return (
    <div
      dir="ltr"
      className={cn(
        "border-input flex h-10 overflow-hidden rounded-xl border transition-all",
        "focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20",
      )}
    >
      <DialCodePicker
        options={dialOptions}
        value={value.dialCountry}
        onChange={(dialCountry) => onChange({ ...value, dialCountry })}
        searchPlaceholder="Country or code…"
      />
      <input
        dir="ltr"
        type="tel"
        inputMode="numeric"
        aria-label={ariaLabel}
        placeholder="512345678"
        value={value.localNumber}
        onChange={(e) => onChange({ ...value, localNumber: e.target.value.replace(/[^\d]/g, "") })}
        required={required}
        data-testid={testId}
        className="flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}
