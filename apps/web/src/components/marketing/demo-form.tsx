"use client";

import { CircleAlert, CircleCheck } from "lucide-react";
import { usePathname } from "next/navigation";
import { useId, useState } from "react";
import { PRODUCTS, type MarketingContent, type ProductInterest } from "@/content/marketing";
import { COUNTRIES } from "@/lib/countries";
import type { Locale } from "@/i18n/config";
import { apiBase } from "@/lib/api-base";
import { cn } from "@/lib/utils";

/**
 * The demo-request form — the site's one conversion action, and a real one: it posts to
 * `POST /api/public/demo-requests`, which writes a row a Super Admin works from
 * (`/admin/demo-requests`). Nothing here is decorative.
 *
 * Notes on the shape of it:
 *
 *  - LABELS ARE PERSISTENT. Every field has a visible `<label>` that stays put; placeholders are
 *    examples, never the label. A placeholder-as-label form is unusable the moment someone starts
 *    typing, and worse on a phone where the field is half-covered by the keyboard.
 *  - The HONEYPOT is a real input, positioned off-screen rather than `display:none` (some bots skip
 *    what is not rendered), taken out of the tab order and hidden from assistive tech.
 *  - VALIDATION IS THE SERVER'S. `noValidate` turns off the browser's own bubbles so there is one
 *    error presentation, and per-field messages come back from Laravel and are mapped to localised
 *    strings here — the API's English validation text is never shown to an Arabic reader.
 *  - The submitted state REPLACES the form. Leaving a filled form under a success banner invites a
 *    second identical submission.
 */

type Status = "idle" | "submitting" | "done";

type FieldName = "name" | "phone" | "email" | "product" | "consent";

const FIELD_NAMES: FieldName[] = ["name", "phone", "email", "product", "consent"];

export function DemoForm({
  t,
  locale,
  className,
}: {
  t: MarketingContent;
  locale: Locale;
  className?: string;
}) {
  const f = t.form;
  const pathname = usePathname();
  const uid = useId();

  const [status, setStatus] = useState<Status>("idle");
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [product, setProduct] = useState<ProductInterest>("COURSE_PLATFORM");

  const id = (name: string) => `${uid}-${name}`;
  const errorId = (name: FieldName) => `${uid}-${name}-error`;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "submitting") return;

    const form = event.currentTarget;
    const data = new FormData(form);
    const value = (key: string) => String(data.get(key) ?? "").trim();

    // A first pass in the browser so the obvious misses are caught without a round trip. The server
    // repeats all of it — this is a courtesy, not the gate.
    const local: Partial<Record<FieldName, string>> = {};
    if (value("name").length < 2) local.name = f.errors.name;
    if (value("phone").length < 6) local.phone = f.errors.phone;
    if (!data.get("consent")) local.consent = f.errors.consent;

    if (Object.keys(local).length > 0) {
      setFieldErrors(local);
      setFormError(null);
      document.getElementById(id(Object.keys(local)[0]!))?.focus();

      return;
    }

    setStatus("submitting");
    setFormError(null);
    setFieldErrors({});

    try {
      const res = await fetch(`${apiBase()}/api/public/demo-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          name: value("name"),
          phone: value("phone"),
          email: value("email") || null,
          country: value("country") || null,
          product,
          role: value("role") || null,
          message: value("message") || null,
          consent: true,
          locale,
          source: pathname,
          website: value("website"),
        }),
      });

      if (res.ok) {
        setStatus("done");

        return;
      }

      if (res.status === 429) {
        setStatus("idle");
        setFormError(f.errors.rateLimited);

        return;
      }

      if (res.status === 422) {
        const body = (await res.json().catch(() => null)) as {
          errors?: Record<string, string[]>;
        } | null;
        const returned = body?.errors ?? {};
        const mapped: Partial<Record<FieldName, string>> = {};
        for (const name of FIELD_NAMES) {
          if (returned[name]) mapped[name] = f.errors[name];
        }

        setStatus("idle");
        setFieldErrors(mapped);
        setFormError(Object.keys(mapped).length > 0 ? null : f.errors.generic);
        const first = Object.keys(mapped)[0];
        if (first) document.getElementById(id(first))?.focus();

        return;
      }

      setStatus("idle");
      setFormError(f.errors.generic);
    } catch {
      setStatus("idle");
      setFormError(f.errors.network);
    }
  }

  if (status === "done") {
    return (
      <div
        className={cn(
          "border-border bg-card rounded-2xl border p-6 sm:p-8",
          className,
        )}
      >
        <div role="status" className="flex items-start gap-3">
          <CircleCheck aria-hidden className="text-primary mt-0.5 size-6 shrink-0" />
          <div>
            <h3 className="text-xl font-bold">{f.success.title}</h3>
            <p className="text-muted-foreground mt-2 leading-relaxed">
              {f.success.body}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setStatus("idle")}
          className="border-border hover:bg-muted focus-visible:outline-ring mt-6 inline-flex h-11 items-center rounded-xl border px-5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {f.success.again}
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn("border-border bg-card rounded-2xl border p-6 sm:p-8", className)}
    >
      <h3 className="text-xl font-bold">{f.title}</h3>
      <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{f.body}</p>

      {/* aria-live so the message is announced when it appears, not only seen. */}
      <div aria-live="polite">
        {formError ? (
          <p className="border-destructive/30 bg-destructive/5 text-destructive mt-5 flex items-start gap-2 rounded-xl border p-3 text-sm">
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>{formError}</span>
          </p>
        ) : null}
      </div>

      <form noValidate onSubmit={onSubmit} className="relative mt-6 flex flex-col gap-5">
        <Field
          id={id("name")}
          label={f.fields.name}
          required
          error={fieldErrors.name}
          errorId={errorId("name")}
        >
          <input
            id={id("name")}
            name="name"
            type="text"
            autoComplete="name"
            placeholder={f.fields.namePlaceholder}
            aria-invalid={Boolean(fieldErrors.name)}
            aria-describedby={fieldErrors.name ? errorId("name") : undefined}
            className={inputClass(Boolean(fieldErrors.name))}
          />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            id={id("phone")}
            label={f.fields.phone}
            required
            error={fieldErrors.phone}
            errorId={errorId("phone")}
          >
            <input
              id={id("phone")}
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              dir="ltr"
              placeholder={f.fields.phonePlaceholder}
              aria-invalid={Boolean(fieldErrors.phone)}
              aria-describedby={fieldErrors.phone ? errorId("phone") : undefined}
              className={cn(inputClass(Boolean(fieldErrors.phone)), "text-start")}
            />
          </Field>

          <Field
            id={id("email")}
            label={f.fields.email}
            optional={f.fields.optional}
            hint={f.fields.emailHint}
            hintId={`${uid}-email-hint`}
            error={fieldErrors.email}
            errorId={errorId("email")}
          >
            <input
              id={id("email")}
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              dir="ltr"
              aria-invalid={Boolean(fieldErrors.email)}
              aria-describedby={
                fieldErrors.email ? errorId("email") : `${uid}-email-hint`
              }
              className={cn(inputClass(Boolean(fieldErrors.email)), "text-start")}
            />
          </Field>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            id={id("country")}
            label={f.fields.country}
            optional={f.fields.optional}
          >
            <select
              id={id("country")}
              name="country"
              defaultValue=""
              autoComplete="country"
              className={cn(inputClass(false), "appearance-none")}
            >
              <option value="">{f.fields.countryPlaceholder}</option>
              {COUNTRIES.map((country) => (
                <option key={country.code} value={country.code}>
                  {country.flag} {t.countryNames[country.code] ?? country.name}
                </option>
              ))}
            </select>
          </Field>

          <Field id={id("role")} label={f.fields.role} optional={f.fields.optional}>
            <input
              id={id("role")}
              name="role"
              type="text"
              placeholder={f.fields.rolePlaceholder}
              className={inputClass(false)}
            />
          </Field>
        </div>

        <fieldset>
          <legend className="text-sm font-semibold">
            {f.fields.product}
            <span className="text-destructive ms-1" aria-hidden>
              *
            </span>
          </legend>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {PRODUCTS.map((value) => {
              const active = product === value;

              return (
                <label
                  key={value}
                  className={cn(
                    "flex cursor-pointer items-center gap-2.5 rounded-xl border p-3 text-sm font-medium transition-colors",
                    "has-focus-visible:outline-ring has-focus-visible:outline-2 has-focus-visible:outline-offset-2",
                    active
                      ? "border-primary bg-primary/5 text-foreground"
                      : "border-border hover:bg-muted text-muted-foreground",
                  )}
                >
                  <input
                    type="radio"
                    name="product"
                    value={value}
                    checked={active}
                    onChange={() => setProduct(value)}
                    className="accent-primary size-4 shrink-0"
                  />
                  <span>{f.fields.productOptions[value]}</span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <Field
          id={id("message")}
          label={f.fields.message}
          optional={f.fields.optional}
        >
          <textarea
            id={id("message")}
            name="message"
            rows={4}
            placeholder={f.fields.messagePlaceholder}
            className={cn(inputClass(false), "min-h-28 resize-y py-3")}
          />
        </Field>

        {/*
          Honeypot. Off-screen rather than `display:none`, out of the tab order, hidden from
          assistive tech, and never autofilled. A human cannot reach it; a form-filling bot will.
        */}
        <div aria-hidden className="pointer-events-none absolute -left-[9999px] h-0 w-0 overflow-hidden">
          <label htmlFor={id("website")}>Website</label>
          <input
            id={id("website")}
            name="website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
          />
        </div>

        <div>
          <label
            className={cn(
              "flex cursor-pointer items-start gap-3 text-sm leading-relaxed",
              fieldErrors.consent ? "text-destructive" : "text-muted-foreground",
            )}
          >
            <input
              id={id("consent")}
              name="consent"
              type="checkbox"
              value="1"
              aria-invalid={Boolean(fieldErrors.consent)}
              aria-describedby={
                fieldErrors.consent ? errorId("consent") : undefined
              }
              className="accent-primary mt-0.5 size-4 shrink-0"
            />
            <span>
              {f.fields.consent}
              <span className="text-destructive ms-1" aria-hidden>
                *
              </span>
            </span>
          </label>
          {fieldErrors.consent ? (
            <p id={errorId("consent")} className="text-destructive mt-2 text-sm">
              {fieldErrors.consent}
            </p>
          ) : null}
        </div>

        <button
          type="submit"
          disabled={status === "submitting"}
          className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-ring inline-flex h-12 items-center justify-center rounded-xl px-6 text-base font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-70"
        >
          {status === "submitting" ? f.submitting : f.submit}
        </button>
      </form>
    </div>
  );
}

function inputClass(invalid: boolean): string {
  return cn(
    "border-input bg-background focus:border-primary focus:ring-primary/20 h-12 w-full rounded-xl border px-3.5 text-base transition-colors focus:ring-2 focus:outline-none",
    invalid && "border-destructive focus:border-destructive focus:ring-destructive/20",
  );
}

function Field({
  id,
  label,
  required,
  optional,
  hint,
  hintId,
  error,
  errorId,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  optional?: string;
  hint?: string;
  hintId?: string;
  error?: string;
  errorId?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
        {required ? (
          <span className="text-destructive ms-1" aria-hidden>
            *
          </span>
        ) : null}
        {optional ? (
          <span className="text-muted-foreground ms-2 font-normal">
            ({optional})
          </span>
        ) : null}
      </label>
      <div className="mt-2">{children}</div>
      {hint ? (
        <p id={hintId} className="text-muted-foreground mt-1.5 text-xs">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-destructive mt-2 text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
