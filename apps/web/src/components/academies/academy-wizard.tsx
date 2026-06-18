"use client";

import { INVOICE_GROUPING } from "@academiq/contracts";
import {
  Building2,
  Check,
  CreditCard,
  Globe,
  Receipt,
  ShieldCheck,
  Sparkles,
  UserCircle,
  X,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState, type ComponentType } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  type AcademyType,
  ApiError,
  type CreateAcademyInput,
  createAcademy,
  getAcademyTypes,
  getPlanCatalog,
  type PlanCatalogItem,
} from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

const inputClass =
  "border-input bg-background w-full rounded-lg border px-3 py-2.5 text-sm transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none";

type Step = 0 | 1 | 2 | 3 | 4;

const STEP_ICONS: ComponentType<{ className?: string }>[] = [
  Building2,
  Receipt,
  Globe,
  UserCircle,
  ShieldCheck,
];

/**
 * The Super Admin "new academy" wizard (Sprint 3 §4.1): Identity → Billing → Branding →
 * Owner → Review. A premium, guided flow — progress stepper, per-step context, selectable
 * type/plan cards. Branding inputs are reserved (R-BRA-1) and labelled as such — stored, not
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
  const locale = useLocale();
  const toast = useToast();
  const [types, setTypes] = useState<AcademyType[]>([]);
  const [plans, setPlans] = useState<PlanCatalogItem[]>([]);
  const [step, setStep] = useState<Step>(0);
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
    // Plans are optional for the picker; ignore failures (e.g. permission edge cases).
    void getPlanCatalog()
      .then((res) => setPlans(res.plans.filter((p) => p.is_active)))
      .catch(() => setPlans([]));
  }, []);

  function set<K extends keyof CreateAcademyInput>(
    key: K,
    value: CreateAcademyInput[K],
  ) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit() {
    setSubmitting(true);
    try {
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
      toast.error(err instanceof ApiError ? err.message : String(err));
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

  // Only the identity step has a hard requirement (a name); keep the rest non-blocking.
  const canAdvance = step !== 0 || form.name.trim().length > 0;
  const selectedType = types.find((x) => x.id === form.academy_type_id);
  const selectedPlan = plans.find((p) => p.id === form.plan_id);

  return (
    <div className="w-full space-y-6" data-testid="academy-wizard">
      {/* Header */}
      <div className="from-primary/[0.10] via-card to-card relative overflow-hidden rounded-2xl border bg-gradient-to-br p-5 shadow-sm ring-1 ring-foreground/[0.04]">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3.5">
            <div className="bg-primary/12 text-primary flex size-11 items-center justify-center rounded-xl">
              <Building2 className="size-5.5" aria-hidden />
            </div>
            <div>
              <h2 className="text-xl font-bold tracking-tight">{t("title")}</h2>
              <p className="text-muted-foreground mt-0.5 text-sm">
                {t("subtitle")}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onCancel}
            aria-label={t("cancel")}
          >
            <X className="size-4" aria-hidden />
          </Button>
        </div>
      </div>

      {/* Stepper */}
      <ol
        className="flex items-center justify-between gap-1"
        data-testid="wizard-steps"
      >
        {steps.map((label, i) => {
          const Icon = STEP_ICONS[i]!;
          const done = i < step;
          const active = i === step;
          return (
            <li
              key={label}
              data-active={active}
              className="flex flex-1 items-center gap-2 last:flex-none"
            >
              <button
                type="button"
                onClick={() => i < step && setStep(i as Step)}
                disabled={i > step}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-1 py-1 text-start transition-colors",
                  i < step && "cursor-pointer",
                )}
              >
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors",
                    active && "bg-primary text-primary-foreground shadow-sm",
                    done && "bg-primary/15 text-primary",
                    !active && !done && "bg-muted text-muted-foreground",
                  )}
                >
                  {done ? (
                    <Check className="size-4" aria-hidden />
                  ) : (
                    <Icon className="size-4" aria-hidden />
                  )}
                </span>
                <span
                  className={cn(
                    "hidden text-xs font-medium sm:block",
                    active ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {label}
                </span>
              </button>
              {i < steps.length - 1 && (
                <span
                  className={cn(
                    "h-px flex-1 transition-colors",
                    done ? "bg-primary/40" : "bg-border",
                  )}
                  aria-hidden
                />
              )}
            </li>
          );
        })}
      </ol>

      {/* Step body */}
      <div className="bg-card rounded-2xl border p-5 shadow-sm ring-1 ring-foreground/[0.04]">
        {step === 0 && (
          <div className="space-y-4" data-testid="step-identity">
            <StepIntro icon={Building2} title={t("stepIdentity")} hint={t("identityHint")} />
            <Field label={t("name")} required>
              <input
                aria-label={t("name")}
                className={inputClass}
                placeholder={t("namePlaceholder")}
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
              />
            </Field>
            <Field label={t("type")}>
              {/* Selectable type cards (a hidden select keeps the accessible label/testing path). */}
              <select
                aria-label={t("type")}
                className="sr-only"
                value={form.academy_type_id}
                onChange={(e) => set("academy_type_id", e.target.value)}
              >
                {types.map((ty) => (
                  <option key={ty.id} value={ty.id}>
                    {ty.name}
                  </option>
                ))}
              </select>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {types.map((ty) => (
                  <button
                    key={ty.id}
                    type="button"
                    onClick={() => set("academy_type_id", ty.id)}
                    className={cn(
                      "rounded-lg border p-3 text-start transition-colors",
                      form.academy_type_id === ty.id
                        ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                        : "hover:bg-muted/40",
                    )}
                  >
                    <span className="font-medium">{ty.name}</span>
                    {ty.description && (
                      <span className="text-muted-foreground mt-0.5 block text-xs">
                        {ty.description}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("currency")}>
                <input
                  aria-label={t("currency")}
                  className={inputClass}
                  maxLength={3}
                  dir="ltr"
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
                  dir="ltr"
                  value={form.timezone}
                  onChange={(e) => set("timezone", e.target.value)}
                />
              </Field>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4" data-testid="step-billing">
            <StepIntro icon={Receipt} title={t("stepBilling")} hint={t("billingHint")} />
            <Field label={t("plan")}>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <PlanOption
                  selected={form.plan_id == null}
                  onClick={() => set("plan_id", null)}
                  title={t("none")}
                />
                {plans.map((p) => (
                  <PlanOption
                    key={p.id}
                    selected={form.plan_id === p.id}
                    onClick={() => set("plan_id", p.id)}
                    title={p.name}
                    badge={p.code}
                    price={formatMoney(
                      { amount: p.price_minor, currency: p.currency },
                      locale,
                    )}
                  />
                ))}
              </div>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
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
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4" data-testid="step-branding">
            <StepIntro icon={Globe} title={t("stepBranding")} hint={t("reserved")} />
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
                dir="ltr"
                value={form.brand_logo_url ?? ""}
                onChange={(e) => set("brand_logo_url", e.target.value)}
              />
            </Field>
            <Field label={t("subdomain")}>
              <input
                aria-label={t("subdomain")}
                className={inputClass}
                dir="ltr"
                value={form.subdomain ?? ""}
                onChange={(e) => set("subdomain", e.target.value.toLowerCase())}
              />
            </Field>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4" data-testid="step-owner">
            <StepIntro icon={UserCircle} title={t("stepOwner")} hint={t("ownerHint")} />
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
                dir="ltr"
                className={inputClass}
                value={form.owner_email}
                onChange={(e) => set("owner_email", e.target.value)}
              />
            </Field>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4" data-testid="step-review">
            <StepIntro icon={ShieldCheck} title={t("stepReview")} hint={t("reviewHint")} />
            <dl className="divide-y rounded-lg border">
              <Row k={t("name")} v={form.name || "—"} />
              <Row k={t("type")} v={selectedType?.name ?? "—"} />
              <Row k={t("plan")} v={selectedPlan?.name ?? t("none")} />
              <Row k={t("currency")} v={form.default_currency} />
              <Row k={t("timezone")} v={form.timezone} />
              <Row k={t("grouping")} v={form.invoice_grouping ?? ""} />
              <Row k={t("billingDay")} v={String(form.billing_day)} />
              <Row k={t("ownerName")} v={form.owner_full_name || "—"} />
              <Row k={t("ownerEmail")} v={form.owner_email || "—"} />
            </dl>
            <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <Sparkles className="size-3.5" aria-hidden />
              {t("createNote")}
            </p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={step === 0}
          onClick={() => setStep((s) => (s - 1) as Step)}
        >
          {t("prev")}
        </Button>
        <span className="text-muted-foreground text-xs tabular-nums">
          {t("stepCounter", { current: step + 1, total: steps.length })}
        </span>
        {step < 4 ? (
          <Button
            type="button"
            size="sm"
            disabled={!canAdvance}
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

function StepIntro({
  icon: Icon,
  title,
  hint,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  hint: string;
}) {
  return (
    <div className="flex items-start gap-2.5 border-b pb-3">
      <Icon className="text-primary mt-0.5 size-4" aria-hidden />
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-muted-foreground text-xs">{hint}</p>
      </div>
    </div>
  );
}

function PlanOption({
  selected,
  onClick,
  title,
  badge,
  price,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  badge?: string;
  price?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center justify-between gap-2 rounded-lg border p-3 text-start transition-colors",
        selected
          ? "border-primary bg-primary/5 ring-1 ring-primary/30"
          : "hover:bg-muted/40",
      )}
    >
      <span className="flex items-center gap-2">
        {badge ? (
          <span className="bg-primary/10 text-primary inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold">
            {badge}
          </span>
        ) : (
          <CreditCard className="text-muted-foreground size-4" aria-hidden />
        )}
        <span className="text-sm font-medium">{title}</span>
      </span>
      {price && (
        <span className="text-muted-foreground text-xs tabular-nums">
          {price}
        </span>
      )}
    </button>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">
        {label}
        {required && <span className="text-destructive ms-0.5">*</span>}
      </span>
      {children}
    </label>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 px-3 py-2 text-sm">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-medium">{v}</dd>
    </div>
  );
}
