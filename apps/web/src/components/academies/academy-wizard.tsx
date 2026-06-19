"use client";

import {
  Building2,
  ChevronDown,
  CreditCard,
  Eye,
  EyeOff,
  Settings2,
  Sparkles,
  UserCircle,
  X,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The Super Admin "new academy" flow: a single screen that asks only for the essentials —
 * name, type, plan and the first owner — with optional branding tucked behind an "Advanced"
 * disclosure. Currency (EGP), timezone (Africa/Cairo) and invoice grouping (PER_GUARDIAN,
 * monthly) are fixed platform defaults, sent silently and never surfaced. The FREE plan is a
 * 5-day TRIAL (status TRIAL → expires unless converted); a paid tier (BASIC/PRO) goes straight
 * to ACTIVE with no free days. On submit the whole thing is created server-side in one
 * transaction, which seeds the chosen type's report fields, provisions the first owner, and
 * opens the subscription.
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
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
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
    email: "",
    password: "",
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

  const selectedPlan = plans.find((p) => p.id === form.plan_id);

  async function submit() {
    setSubmitting(true);
    try {
      // FREE is a 5-day trial; a paid tier goes live immediately with no free days (backend reads `status`).
      const status = selectedPlan?.code === "FREE" ? "TRIAL" : "ACTIVE";
      const payload: CreateAcademyInput = {
        ...form,
        status,
        brand_display_name: form.brand_display_name || null,
        brand_logo_url: form.brand_logo_url || null,
        subdomain: form.subdomain || null,
        plan_id: form.plan_id || null,
      };
      const res = await createAcademy(payload);
      onCreated(res.academyId);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const canCreate =
    form.name.trim().length > 0 &&
    form.academy_type_id !== "" &&
    form.plan_id != null &&
    EMAIL_RE.test(form.email) &&
    form.password.length >= 8;

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

      {/* Essentials */}
      <div
        className="bg-card space-y-5 rounded-2xl border p-5 shadow-sm ring-1 ring-foreground/[0.04]"
        data-testid="section-essentials"
      >
        <Field label={t("name")} required>
          <input
            aria-label={t("name")}
            className={inputClass}
            placeholder={t("namePlaceholder")}
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </Field>

        <Field label={t("type")} required>
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

        <Field label={t("plan")} required>
          <div className="grid gap-2 sm:grid-cols-3">
            {plans.map((p) => (
              <PlanCard
                key={p.id}
                selected={form.plan_id === p.id}
                onClick={() => set("plan_id", p.id)}
                code={p.code}
                name={p.name}
                price={
                  p.price_minor === 0
                    ? t("free")
                    : formatMoney(
                        { amount: p.price_minor, currency: p.currency },
                        locale,
                      )
                }
                perMonth={p.price_minor > 0 ? t("perMonth") : undefined}
                trial={p.code === "FREE" ? t("trialBadge") : undefined}
                students={p.features?.limits?.maxStudents ?? null}
                teachers={p.features?.limits?.maxTeachers ?? null}
                studentsLabel={t("studentsLimit", {
                  count: p.features?.limits?.maxStudents ?? 0,
                })}
                teachersLabel={t("teachersLimit", {
                  count: p.features?.limits?.maxTeachers ?? 0,
                })}
              />
            ))}
          </div>
        </Field>
      </div>

      {/* Owner login credentials */}
      <div
        className="bg-card space-y-4 rounded-2xl border p-5 shadow-sm ring-1 ring-foreground/[0.04]"
        data-testid="section-owner"
      >
        <SectionIntro
          icon={UserCircle}
          title={t("ownerSection")}
          hint={t("ownerSectionHint")}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("ownerEmail")} required>
            <input
              aria-label={t("ownerEmail")}
              type="email"
              dir="ltr"
              autoComplete="off"
              className={inputClass}
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
            />
          </Field>
          <Field label={t("ownerPassword")} required>
            <div className="relative">
              <input
                aria-label={t("ownerPassword")}
                type={showPassword ? "text" : "password"}
                dir="ltr"
                autoComplete="new-password"
                className={cn(inputClass, "pe-10")}
                placeholder={t("passwordPlaceholder")}
                value={form.password}
                onChange={(e) => set("password", e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={t(showPassword ? "hidePassword" : "showPassword")}
                className="text-muted-foreground hover:text-foreground absolute inset-y-0 end-0 flex items-center pe-3"
              >
                {showPassword ? (
                  <EyeOff className="size-4" aria-hidden />
                ) : (
                  <Eye className="size-4" aria-hidden />
                )}
              </button>
            </div>
          </Field>
        </div>
      </div>

      {/* Advanced (collapsed by default — sensible defaults already applied) */}
      <div className="bg-card overflow-hidden rounded-2xl border shadow-sm ring-1 ring-foreground/[0.04]">
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          aria-expanded={showAdvanced}
          data-testid="advanced-toggle"
          className="hover:bg-muted/40 flex w-full items-center justify-between gap-3 p-5 text-start transition-colors"
        >
          <span className="flex items-center gap-2.5">
            <Settings2 className="text-muted-foreground size-4" aria-hidden />
            <span>
              <span className="block text-sm font-semibold">
                {t("advanced")}
              </span>
              <span className="text-muted-foreground block text-xs">
                {t("advancedHint")}
              </span>
            </span>
          </span>
          <ChevronDown
            className={cn(
              "text-muted-foreground size-4 transition-transform",
              showAdvanced && "rotate-180",
            )}
            aria-hidden
          />
        </button>
        {showAdvanced && (
          <div className="space-y-4 border-t p-5" data-testid="advanced-panel">
            <Field label={t("brandName")}>
              <input
                aria-label={t("brandName")}
                className={inputClass}
                value={form.brand_display_name ?? ""}
                onChange={(e) => set("brand_display_name", e.target.value)}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
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
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <Sparkles className="size-3.5 shrink-0" aria-hidden />
          {t("createHint")}
        </p>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            {t("cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!canCreate || submitting}
            onClick={() => void submit()}
          >
            {submitting ? t("creating") : t("create")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function SectionIntro({
  icon: Icon,
  title,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  hint: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="text-primary mt-0.5 size-4" aria-hidden />
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-muted-foreground text-xs">{hint}</p>
      </div>
    </div>
  );
}

function PlanCard({
  selected,
  onClick,
  code,
  name,
  price,
  perMonth,
  trial,
  students,
  teachers,
  studentsLabel,
  teachersLabel,
}: {
  selected: boolean;
  onClick: () => void;
  code: string;
  name: string;
  price: string;
  perMonth?: string;
  trial?: string;
  students: number | null;
  teachers: number | null;
  studentsLabel: string;
  teachersLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      data-testid={`plan-${code}`}
      className={cn(
        "flex flex-col gap-2 rounded-xl border p-4 text-start transition-colors",
        selected
          ? "border-primary bg-primary/5 ring-1 ring-primary/30"
          : "hover:bg-muted/40",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <CreditCard className="text-primary size-4" aria-hidden />
          <span className="text-sm font-semibold">{name}</span>
        </span>
        {trial && (
          <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            {trial}
          </span>
        )}
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-base font-bold tabular-nums">{price}</span>
        {perMonth && (
          <span className="text-muted-foreground text-xs">{perMonth}</span>
        )}
      </div>
      <div className="text-muted-foreground space-y-0.5 text-xs">
        {students != null && <span className="block">{studentsLabel}</span>}
        {teachers != null && <span className="block">{teachersLabel}</span>}
      </div>
      <span className="sr-only">{code}</span>
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
