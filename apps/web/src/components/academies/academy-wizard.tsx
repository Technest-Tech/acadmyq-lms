"use client";

import { INVOICE_GROUPING } from "@academiq/contracts";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  type AcademyType,
  ApiError,
  type CreateAcademyInput,
  createAcademy,
  getAcademyTypes,
} from "@/lib/api";

const inputClass =
  "border-input bg-background w-full rounded-md border px-3 py-2 text-sm";

type Step = 0 | 1 | 2 | 3 | 4;

/**
 * The Super Admin "new academy" wizard (Sprint 3 §4.1): Identity → Billing → Branding →
 * Owner → Review. Branding inputs are reserved (R-BRA-1) and labelled as such — stored, not
 * surfaced. On submit the whole thing is created server-side in one transaction, which seeds
 * the chosen type's report fields and provisions the first owner.
 */
export function AcademyWizard({
  onCreated,
  onCancel,
}: {
  onCreated: (academyId: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("academies.wizard");
  const [types, setTypes] = useState<AcademyType[]>([]);
  const [step, setStep] = useState<Step>(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState<CreateAcademyInput>({
    name: "",
    academy_type_id: "",
    plan_id: null,
    default_currency: "EGP",
    timezone: "Africa/Cairo",
    invoice_grouping: "PER_GUARDIAN",
    billing_day: 1,
    brand_display_name: "",
    brand_logo_url: "",
    subdomain: "",
    owner_full_name: "",
    owner_email: "",
  });

  useEffect(() => {
    void getAcademyTypes().then((res) => {
      setTypes(res.academyTypes);
      setForm((f) =>
        f.academy_type_id === "" && res.academyTypes[0]
          ? { ...f, academy_type_id: res.academyTypes[0].id }
          : f,
      );
    });
  }, []);

  function set<K extends keyof CreateAcademyInput>(
    key: K,
    value: CreateAcademyInput[K],
  ) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      // Strip empty optional strings so the API stores NULLs, not "".
      const payload: CreateAcademyInput = {
        ...form,
        brand_display_name: form.brand_display_name || null,
        brand_logo_url: form.brand_logo_url || null,
        subdomain: form.subdomain || null,
        plan_id: form.plan_id || null,
      };
      const res = await createAcademy(payload);
      onCreated(res.academyId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setStep(0);
    } finally {
      setSubmitting(false);
    }
  }

  const steps = [
    t("stepIdentity"),
    t("stepBilling"),
    t("stepBranding"),
    t("stepOwner"),
    t("stepReview"),
  ];

  return (
    <div className="max-w-xl space-y-6" data-testid="academy-wizard">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">{t("title")}</h2>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          ✕
        </Button>
      </div>

      <ol className="flex flex-wrap gap-2 text-xs" data-testid="wizard-steps">
        {steps.map((label, i) => (
          <li
            key={label}
            data-active={i === step}
            className={
              i === step ? "text-primary font-medium" : "text-muted-foreground"
            }
          >
            {i + 1}. {label}
          </li>
        ))}
      </ol>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      {step === 0 && (
        <div className="space-y-3" data-testid="step-identity">
          <Field label={t("name")}>
            <input
              aria-label={t("name")}
              className={inputClass}
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </Field>
          <Field label={t("type")}>
            <select
              aria-label={t("type")}
              className={inputClass}
              value={form.academy_type_id}
              onChange={(e) => set("academy_type_id", e.target.value)}
            >
              {types.map((ty) => (
                <option key={ty.id} value={ty.id}>
                  {ty.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("currency")}>
            <input
              aria-label={t("currency")}
              className={inputClass}
              maxLength={3}
              value={form.default_currency}
              onChange={(e) =>
                set("default_currency", e.target.value.toUpperCase())
              }
            />
          </Field>
          <Field label={t("timezone")}>
            <input
              aria-label={t("timezone")}
              className={inputClass}
              value={form.timezone}
              onChange={(e) => set("timezone", e.target.value)}
            />
          </Field>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-3" data-testid="step-billing">
          <Field label={t("grouping")}>
            <select
              aria-label={t("grouping")}
              className={inputClass}
              value={form.invoice_grouping}
              onChange={(e) =>
                set(
                  "invoice_grouping",
                  e.target.value as CreateAcademyInput["invoice_grouping"],
                )
              }
            >
              {INVOICE_GROUPING.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("billingDay")}>
            <input
              aria-label={t("billingDay")}
              type="number"
              min={1}
              max={28}
              className={inputClass}
              value={form.billing_day}
              onChange={(e) => set("billing_day", Number(e.target.value))}
            />
          </Field>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3" data-testid="step-branding">
          <p className="text-muted-foreground text-xs">{t("reserved")}</p>
          <Field label={t("brandName")}>
            <input
              aria-label={t("brandName")}
              className={inputClass}
              value={form.brand_display_name ?? ""}
              onChange={(e) => set("brand_display_name", e.target.value)}
            />
          </Field>
          <Field label={t("logoUrl")}>
            <input
              aria-label={t("logoUrl")}
              className={inputClass}
              value={form.brand_logo_url ?? ""}
              onChange={(e) => set("brand_logo_url", e.target.value)}
            />
          </Field>
          <Field label={t("subdomain")}>
            <input
              aria-label={t("subdomain")}
              className={inputClass}
              value={form.subdomain ?? ""}
              onChange={(e) => set("subdomain", e.target.value.toLowerCase())}
            />
          </Field>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-3" data-testid="step-owner">
          <Field label={t("ownerName")}>
            <input
              aria-label={t("ownerName")}
              className={inputClass}
              value={form.owner_full_name}
              onChange={(e) => set("owner_full_name", e.target.value)}
            />
          </Field>
          <Field label={t("ownerEmail")}>
            <input
              aria-label={t("ownerEmail")}
              type="email"
              className={inputClass}
              value={form.owner_email}
              onChange={(e) => set("owner_email", e.target.value)}
            />
          </Field>
        </div>
      )}

      {step === 4 && (
        <dl
          className="space-y-1 rounded-md border p-3 text-sm"
          data-testid="step-review"
        >
          <Row k={t("name")} v={form.name} />
          <Row
            k={t("type")}
            v={types.find((x) => x.id === form.academy_type_id)?.name ?? "—"}
          />
          <Row k={t("currency")} v={form.default_currency} />
          <Row k={t("timezone")} v={form.timezone} />
          <Row k={t("grouping")} v={form.invoice_grouping ?? ""} />
          <Row k={t("ownerEmail")} v={form.owner_email} />
        </dl>
      )}

      <div className="flex justify-between">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={step === 0}
          onClick={() => setStep((s) => (s - 1) as Step)}
        >
          {t("prev")}
        </Button>
        {step < 4 ? (
          <Button
            type="button"
            size="sm"
            onClick={() => setStep((s) => (s + 1) as Step)}
          >
            {t("next")}
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            disabled={submitting}
            onClick={() => void submit()}
          >
            {submitting ? t("creating") : t("create")}
          </Button>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-medium">{v}</dd>
    </div>
  );
}
