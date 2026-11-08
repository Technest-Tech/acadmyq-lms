"use client";

import {
  BookOpen,
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  MessageCircle,
  School,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { fieldClass } from "@/components/admin/field";
import { AdminPageHeader } from "@/components/admin/page-header";
import { displayHost, subdomainUrl } from "@/components/clients/client-summary";
import { todayIso } from "@/components/finance/finance-format";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import {
  ApiError,
  createAcademy,
  createWhatsappOnlyClient,
  getAcademyTypes,
  getPlatformSettings,
  setClientAgreement,
  type AcademyType,
  type ClientType,
  type ModuleCode,
} from "@/lib/api";
import { formatMoney, formatNumber } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * /admin/clients/new — create a client in three steps (Ahmed, 2026-11-07: the old form asked for
 * an email and a password and little else).
 *
 *   1. The client   what it is (a management system, a course platform, WhatsApp only), what kind
 *                   of school (Quran academy or learning centre), its name and address
 *   2. The owner    who to call (name, WhatsApp number) and their first login
 *   3. Subscription what it pays (price and interval), WhatsApp on top for a management client,
 *                   a trial of N days or paid from today, and the modern look from day one
 *
 * A WhatsApp-only client has no login, so it skips step 2. The video platform is retired: it is
 * neither a client type nor an extra here. A summary beside the form says what will be created.
 */

type Kind = Extract<ClientType, "MANAGEMENT" | "LMS" | "WHATSAPP">;
type Interval = "MONTHLY" | "YEARLY";
type Step = "client" | "owner" | "plan";

const KINDS: readonly { kind: Kind; Icon: LucideIcon }[] = [
  { kind: "MANAGEMENT", Icon: School },
  { kind: "LMS", Icon: BookOpen },
  { kind: "WHATSAPP", Icon: MessageCircle },
];
const PRIMARY: Record<Kind, ModuleCode> = { MANAGEMENT: "MANAGEMENT", LMS: "LMS", WHATSAPP: "WHATSAPP" };
/** The school types this form offers, in this order; any other row (an internal one) is not a choice. */
const SCHOOLS = ["QURAN", "CENTRE"] as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9 ()-]{6,32}$/;
const DEFAULT_TRIAL_DAYS = 5;

type ModulePricing = Partial<Record<ModuleCode, { price_minor: number; currency: string }>>;

/** Twelve characters with no look-alikes (0/O, 1/l/I), from the browser's crypto. */
function generatePassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

const toMinor = (value: string): number | null => {
  if (value.trim() === "") return 0;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};
const toInput = (minor?: number): string => (minor === undefined || minor === 0 ? "" : String(minor / 100));

export function NewClientScreen() {
  const t = useTranslations("clients.create");
  const tn = useTranslations("clients.new");
  const tm = useTranslations("clients.modules");
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();

  const [step, setStep] = useState<Step>("client");
  const [types, setTypes] = useState<AcademyType[]>([]);
  const [pricing, setPricing] = useState<ModulePricing>({});

  // Step 1
  const [kind, setKind] = useState<Kind>("MANAGEMENT");
  const [school, setSchool] = useState<(typeof SCHOOLS)[number]>("QURAN");
  const [name, setName] = useState("");
  const [subdomain, setSubdomain] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  // Step 2
  const [ownerName, setOwnerName] = useState("");
  const [ownerPhone, setOwnerPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState(false);
  // Step 3
  const [price, setPrice] = useState("");
  const [cycle, setCycle] = useState<Interval>("MONTHLY");
  const [withWhatsapp, setWithWhatsapp] = useState(false);
  const [waPrice, setWaPrice] = useState("");
  const [trial, setTrial] = useState(true);
  const [trialDays, setTrialDays] = useState(String(DEFAULT_TRIAL_DAYS));
  const [modern, setModern] = useState(false);

  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getAcademyTypes()
      .then((res) => setTypes(res.academyTypes))
      .catch(() => setTypes([]));
    void getPlatformSettings()
      .then((res) => setPricing((res.settings.module_pricing ?? {}) as ModulePricing))
      .catch(() => setPricing({}));
  }, []);

  // The platform's default price for the chosen module pre-fills the field until someone types.
  const [priceTyped, setPriceTyped] = useState(false);
  const [waTyped, setWaTyped] = useState(false);
  useEffect(() => {
    if (!priceTyped) setPrice(toInput(pricing[PRIMARY[kind]]?.price_minor));
    if (!waTyped) setWaPrice(toInput(pricing.WHATSAPP?.price_minor));
  }, [pricing, kind, priceTyped, waTyped]);

  const steps: Step[] = kind === "WHATSAPP" ? ["client", "plan"] : ["client", "owner", "plan"];
  const at = steps.indexOf(step);
  const centre = kind === "MANAGEMENT" && school === "CENTRE";
  const typeId = useMemo(() => {
    const wanted = kind === "MANAGEMENT" ? school : "QURAN";
    return types.find((ty) => ty.code === wanted)?.id ?? types[0]?.id ?? "";
  }, [types, kind, school]);
  const offeredSchools = SCHOOLS.filter((code) => types.some((ty) => ty.code === code));

  const priceMinor = toMinor(price);
  const waMinor = toMinor(waPrice);
  const days = Number(trialDays);
  const address = subdomainUrl(subdomain);

  const errors = {
    name: name.trim() === "" ? t("errors.required") : null,
    ownerPhone: ownerPhone.trim() !== "" && !PHONE_RE.test(ownerPhone.trim()) ? t("errors.phone") : null,
    email: !EMAIL_RE.test(email.trim()) ? t("errors.email") : null,
    password: password.length < 8 ? t("errors.password") : null,
    price: priceMinor === null ? t("errors.price") : null,
    waPrice: withWhatsapp && waMinor === null ? t("errors.price") : null,
    trialDays: trial && !(Number.isInteger(days) && days >= 1 && days <= 365) ? t("errors.required") : null,
  };
  const stepValid: Record<Step, boolean> = {
    client: errors.name === null && (kind === "WHATSAPP" || typeId !== ""),
    owner: errors.email === null && errors.password === null && errors.ownerPhone === null,
    plan: errors.price === null && errors.waPrice === null && errors.trialDays === null,
  };
  const show = (error: string | null) => (touched ? error : null);

  const go = (next: number) => {
    if (next > at && !stepValid[step]) {
      setTouched(true);
      return;
    }
    setTouched(false);
    const target = steps[next];
    if (target !== undefined) setStep(target);
  };

  const money = (minor: number) => formatMoney({ amount: minor, currency: "EGP" }, locale, { trimZeroDecimals: true });
  const priceLabel = (minor: number | null) =>
    minor === null ? "—" : minor === 0 ? t("summaryFree") : `${money(minor)}${t(`per.${cycle}`)}`;
  const totalMinor = (priceMinor ?? 0) + (kind === "MANAGEMENT" && withWhatsapp ? (waMinor ?? 0) : 0);

  const create = async () => {
    if (steps.some((s) => !stepValid[s])) {
      setTouched(true);
      const firstBad = steps.find((s) => !stepValid[s]);
      if (firstBad) setStep(firstBad);
      return;
    }
    setBusy(true);
    /**
     * A client that pays from today gets its agreement in the accounts book straight away (monthly or
     * yearly at the price typed here), so the reminders and the Dues screen know about it from day one.
     * A trial's agreement is set when the trial ends. Either way the client page can change it to any
     * of the six agreements.
     */
    const agree = async (academyId: string) => {
      if (trial || totalMinor <= 0) return;
      try {
        await setClientAgreement(academyId, {
          plan: cycle,
          currency: "EGP",
          recurring: { amount_minor: totalMinor, first_due_on: todayIso() },
        });
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : String(e));
      }
    };
    try {
      if (kind === "WHATSAPP") {
        const res = await createWhatsappOnlyClient({
          name: name.trim(),
          mode: trial ? "trial" : "active",
          price_minor: priceMinor ?? 0,
          billing_interval: cycle,
          ...(trial ? { trial_days: days } : {}),
        });
        await agree(res.clientId);
        router.push(`/admin/clients/${res.clientId}${trial ? "" : "?tab=subscription"}`);
        return;
      }
      const modules: { module: ModuleCode; price_minor: number; billing_interval: Interval }[] = [
        { module: PRIMARY[kind], price_minor: priceMinor ?? 0, billing_interval: cycle },
      ];
      if (kind === "MANAGEMENT" && withWhatsapp) {
        modules.push({ module: "WHATSAPP", price_minor: waMinor ?? 0, billing_interval: cycle });
      }
      const res = await createAcademy({
        name: name.trim(),
        academy_type_id: typeId,
        client_type: kind,
        modules,
        default_currency: "EGP",
        timezone: "Africa/Cairo",
        status: trial ? "TRIAL" : "ACTIVE",
        ...(trial ? { trial_days: days } : {}),
        subdomain: subdomain.trim() || null,
        brand_logo_url: logoUrl.trim() || null,
        email: email.trim(),
        password,
        owner_name: ownerName.trim() || null,
        owner_phone: ownerPhone.trim() || null,
        ...(kind === "MANAGEMENT" && modern && !centre ? { enable_features: ["modern_look"] } : {}),
      });
      await agree(res.academyId);
      router.push(`/admin/clients/${res.academyId}${trial ? "" : "?tab=subscription"}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
      setBusy(false);
    }
  };

  const copyPassword = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // No clipboard (an insecure origin): the password is on screen to copy by hand.
    }
  };

  return (
    <div className="space-y-5" data-testid="new-client-screen">
      <AdminPageHeader backHref="/admin/clients" backLabel={tn("back")} title={t("title")} subtitle={t("subtitle")} />

      {/* ── Where you are ── */}
      <ol className="flex items-center gap-2" data-testid="create-steps">
        {steps.map((s, i) => (
          <li key={s} className="flex min-w-0 flex-1 items-center gap-2">
            <button
              type="button"
              onClick={() => (i < at ? go(i) : undefined)}
              disabled={i > at}
              aria-current={s === step ? "step" : undefined}
              className={cn(
                "flex min-w-0 items-center gap-2 rounded-full py-1 pe-3 ps-1 text-sm font-bold transition-colors",
                s === step ? "bg-primary text-primary-foreground" : i < at ? "text-primary hover:bg-primary/10" : "text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full text-xs",
                  s === step ? "bg-primary-foreground/20" : i < at ? "bg-primary/15" : "bg-muted",
                )}
              >
                {i < at ? <Check className="size-4" aria-hidden /> : i + 1}
              </span>
              <span className="truncate">{t(`steps.${s}`)}</span>
            </button>
            {i < steps.length - 1 && <span className="bg-border h-px min-w-4 flex-1" aria-hidden />}
          </li>
        ))}
      </ol>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="admin-surface bg-card rounded-xl p-5 shadow-sm ring-1 ring-foreground/[0.06] sm:p-6">
          {step === "client" && (
            <div className="space-y-6" data-testid="step-client">
              <Choice title={t("kind.title")}>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                  {KINDS.map(({ kind: k, Icon }) => (
                    <OptionCard
                      key={k}
                      selected={kind === k}
                      onSelect={() => setKind(k)}
                      Icon={Icon}
                      title={t(`kind.${k}`)}
                      hint={t(`kind.${k}Hint`)}
                      testId={`kind-${k}`}
                    />
                  ))}
                </div>
              </Choice>

              {kind === "MANAGEMENT" && offeredSchools.length > 1 && (
                <Choice title={t("school.title")}>
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    {offeredSchools.map((code) => (
                      <OptionCard
                        key={code}
                        selected={school === code}
                        onSelect={() => setSchool(code)}
                        title={t(`school.${code}`)}
                        hint={t(`school.${code}Hint`)}
                        testId={`school-${code}`}
                      />
                    ))}
                  </div>
                </Choice>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <TextField
                  label={t("name")}
                  value={name}
                  onChange={setName}
                  placeholder={t("namePlaceholder")}
                  error={show(errors.name)}
                  testId="create-name"
                  className="sm:col-span-2"
                />
                {kind !== "WHATSAPP" && (
                  <>
                    <TextField
                      label={t("subdomain")}
                      optional={t("optional")}
                      value={subdomain}
                      onChange={(v) => setSubdomain(v.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                      dir="ltr"
                      placeholder="alnoor"
                      hint={address !== null ? t("subdomainHint", { host: displayHost(address) }) : undefined}
                      testId="create-subdomain"
                    />
                    <TextField
                      label={t("logo")}
                      optional={t("optional")}
                      value={logoUrl}
                      onChange={setLogoUrl}
                      dir="ltr"
                      placeholder="https://…"
                      testId="create-logo"
                    />
                  </>
                )}
              </div>
            </div>
          )}

          {step === "owner" && (
            <div className="space-y-5" data-testid="step-owner">
              <StepTitle title={t("ownerTitle")} hint={t("ownerHint")} />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <TextField label={t("ownerName")} value={ownerName} onChange={setOwnerName} testId="create-owner-name" />
                <TextField
                  label={t("ownerPhone")}
                  value={ownerPhone}
                  onChange={setOwnerPhone}
                  dir="ltr"
                  type="tel"
                  placeholder="+20 100 123 4567"
                  hint={t("ownerPhoneHint")}
                  error={show(errors.ownerPhone)}
                  testId="create-owner-phone"
                />
                <TextField
                  label={t("ownerEmail")}
                  value={email}
                  onChange={setEmail}
                  dir="ltr"
                  type="email"
                  error={show(errors.email)}
                  testId="create-email"
                  className="sm:col-span-2"
                />
                <div className="sm:col-span-2">
                  <span className="mb-1.5 block text-sm font-bold">{t("password")}</span>
                  <div className="flex flex-wrap gap-2">
                    <div className="relative min-w-0 flex-1">
                      <input
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        dir="ltr"
                        autoComplete="new-password"
                        aria-label={t("password")}
                        data-testid="create-password"
                        className={cn(fieldClass, "h-10 rounded-xl pe-10 font-mono", show(errors.password) && "border-destructive")}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? t("hide") : t("show")}
                        className="text-muted-foreground hover:text-foreground absolute inset-y-0 end-2 my-auto flex size-7 items-center justify-center rounded-md"
                      >
                        {showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                      </button>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setPassword(generatePassword());
                        setShowPassword(true);
                      }}
                      data-testid="create-generate"
                    >
                      <KeyRound className="size-4" aria-hidden />
                      {t("generate")}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => void copyPassword()} disabled={password === ""}>
                      {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
                      {copied ? t("copied") : t("copy")}
                    </Button>
                  </div>
                  <p className={cn("mt-1 text-xs", show(errors.password) ? "text-destructive" : "text-muted-foreground")}>
                    {show(errors.password) ?? t("passwordHint")}
                  </p>
                </div>
              </div>
            </div>
          )}

          {step === "plan" && (
            <div className="space-y-6" data-testid="step-plan">
              <StepTitle title={t("planTitle")} hint={t("planHint")} />

              <div className="flex flex-wrap items-end gap-3">
                <TextField
                  label={t("price", { module: tm(PRIMARY[kind]) })}
                  value={price}
                  onChange={(v) => {
                    setPriceTyped(true);
                    setPrice(v);
                  }}
                  type="number"
                  dir="ltr"
                  suffix="EGP"
                  error={show(errors.price)}
                  testId="create-price"
                  className="w-48"
                />
                <div className="bg-muted inline-flex h-10 rounded-xl p-1" role="group">
                  {(["MONTHLY", "YEARLY"] as const).map((iv) => (
                    <button
                      key={iv}
                      type="button"
                      aria-pressed={cycle === iv}
                      onClick={() => setCycle(iv)}
                      data-testid={`create-interval-${iv}`}
                      className={cn(
                        "rounded-lg px-4 text-sm font-bold transition-colors",
                        cycle === iv ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {t(`interval.${iv}`)}
                    </button>
                  ))}
                </div>
              </div>

              {kind === "MANAGEMENT" && (
                <ToggleRow
                  Icon={MessageCircle}
                  title={t("addWhatsapp")}
                  hint={t("addWhatsappHint")}
                  checked={withWhatsapp}
                  onChange={setWithWhatsapp}
                  testId="create-whatsapp"
                >
                  {withWhatsapp && (
                    <TextField
                      label={t("price", { module: tm("WHATSAPP") })}
                      value={waPrice}
                      onChange={(v) => {
                        setWaTyped(true);
                        setWaPrice(v);
                      }}
                      type="number"
                      dir="ltr"
                      suffix="EGP"
                      error={show(errors.waPrice)}
                      testId="create-wa-price"
                      className="mt-3 w-48"
                    />
                  )}
                </ToggleRow>
              )}

              <Choice title={t("startTitle")}>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <OptionCard selected={trial} onSelect={() => setTrial(true)} title={t("startTrial")} hint={t("startTrialHint")} testId="start-trial" />
                  <OptionCard selected={!trial} onSelect={() => setTrial(false)} title={t("startPaid")} hint={t("startPaidHint")} testId="start-paid" />
                </div>
                {trial && (
                  <TextField
                    label={t("trialDays")}
                    value={trialDays}
                    onChange={setTrialDays}
                    type="number"
                    dir="ltr"
                    suffix={t("days")}
                    error={show(errors.trialDays)}
                    testId="create-trial-days"
                    className="mt-3 w-40"
                  />
                )}
              </Choice>

              {kind === "MANAGEMENT" &&
                (centre ? (
                  <p className="text-muted-foreground flex items-center gap-2 text-sm">
                    <Sparkles className="text-primary size-4" aria-hidden />
                    {t("modernCentre")}
                  </p>
                ) : (
                  <ToggleRow
                    Icon={Sparkles}
                    title={t("modernTitle")}
                    hint={t("modernHint")}
                    checked={modern}
                    onChange={setModern}
                    testId="create-modern"
                  />
                ))}
            </div>
          )}

          {/* ── Back / next / create ── */}
          <div className="mt-8 flex items-center justify-between gap-3 border-t pt-5">
            {at > 0 ? (
              <Button type="button" variant="outline" onClick={() => go(at - 1)}>
                {t("back")}
              </Button>
            ) : (
              <span />
            )}
            {at < steps.length - 1 ? (
              <Button type="button" onClick={() => go(at + 1)} data-testid="create-next">
                {t("next")}
              </Button>
            ) : (
              <Button type="button" onClick={() => void create()} disabled={busy} data-testid="create-submit">
                {busy ? t("creating") : t("create")}
              </Button>
            )}
          </div>
        </div>

        {/* ── What will be created ── */}
        <aside className="admin-surface bg-card h-fit rounded-xl p-5 shadow-sm ring-1 ring-foreground/[0.06] lg:sticky lg:top-4" data-testid="create-summary">
          <h2 className="text-base font-extrabold">{t("summaryTitle")}</h2>
          <dl className="mt-3 space-y-3 text-sm">
            <SummaryRow label={t("name")} value={name.trim() || t("summaryNone")} muted={name.trim() === ""} />
            <SummaryRow label={t("kind.title")} value={t(`kind.${kind}`) + (kind === "MANAGEMENT" ? ` · ${t(`school.${school}`)}` : "")} />
            {kind === "WHATSAPP" ? (
              <SummaryRow label={t("steps.owner")} value={t("summaryNoLogin")} muted />
            ) : (
              <SummaryRow
                label={t("steps.owner")}
                value={[ownerName.trim(), email.trim()].filter(Boolean).join(" · ") || t("summaryNone")}
                muted={email.trim() === ""}
              />
            )}
            <SummaryRow
              label={t("steps.plan")}
              value={
                trial
                  ? t("summaryTrial", {
                      days: Number.isFinite(days) && trialDays !== "" ? formatNumber(days, locale) : "—",
                      price: priceLabel(totalMinor),
                    })
                  : t("summaryPaid", { price: priceLabel(totalMinor) })
              }
            />
            {kind === "MANAGEMENT" && (modern || centre) && <SummaryRow label={t("modernTitle")} value="✓" />}
          </dl>
        </aside>
      </div>
    </div>
  );
}

function StepTitle({ title, hint }: { title: string; hint: string }) {
  return (
    <div>
      <h2 className="text-lg font-extrabold">{title}</h2>
      <p className="text-muted-foreground mt-0.5 text-sm">{hint}</p>
    </div>
  );
}

function Choice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-bold">{title}</legend>
      {children}
    </fieldset>
  );
}

/** A big pressable choice: an icon, a title and a line saying what it means. */
function OptionCard({
  selected,
  onSelect,
  Icon,
  title,
  hint,
  testId,
}: {
  selected: boolean;
  onSelect: () => void;
  Icon?: LucideIcon;
  title: string;
  hint: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      data-testid={testId}
      className={cn(
        "flex h-full items-start gap-3 rounded-xl border p-3.5 text-start transition-colors",
        selected ? "border-primary bg-primary/[0.06] ring-primary/25 ring-2" : "hover:bg-muted/40",
      )}
    >
      {Icon && (
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-xl",
            selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
          )}
        >
          <Icon className="size-5" aria-hidden />
        </span>
      )}
      <span className="min-w-0">
        <span className="block text-sm font-bold">{title}</span>
        <span className="text-muted-foreground mt-0.5 block text-xs leading-relaxed">{hint}</span>
      </span>
    </button>
  );
}

/** A switch with its title and meaning; what it opens sits under it. */
function ToggleRow({
  Icon,
  title,
  hint,
  checked,
  onChange,
  testId,
  children,
}: {
  Icon: LucideIcon;
  title: string;
  hint: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  testId?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cn("rounded-xl border p-3.5 transition-colors", checked && "border-primary/40 bg-primary/[0.04]")}>
      <label className="flex cursor-pointer items-center gap-3">
        <span className="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-xl">
          <Icon className="size-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold">{title}</span>
          <span className="text-muted-foreground block text-xs">{hint}</span>
        </span>
        <Switch checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />
      </label>
      {children}
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  optional,
  hint,
  error,
  placeholder,
  type = "text",
  dir,
  suffix,
  testId,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  optional?: string;
  hint?: string;
  error?: string | null;
  placeholder?: string;
  type?: string;
  dir?: "ltr" | "rtl";
  suffix?: string;
  testId?: string;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 flex items-baseline gap-1.5 text-sm font-bold">
        {label}
        {optional && <span className="text-muted-foreground text-xs font-normal">({optional})</span>}
      </span>
      <span className="relative block">
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          dir={dir}
          min={type === "number" ? 0 : undefined}
          step={type === "number" ? "any" : undefined}
          data-testid={testId}
          aria-invalid={error ? true : undefined}
          className={cn(fieldClass, "h-10 rounded-xl", suffix && "pe-14", error && "border-destructive")}
        />
        {suffix && (
          <span className="text-muted-foreground pointer-events-none absolute inset-y-0 end-3 my-auto flex items-center text-xs font-semibold">
            {suffix}
          </span>
        )}
      </span>
      {(error || hint) && <span className={cn("mt-1 block text-xs", error ? "text-destructive" : "text-muted-foreground")}>{error ?? hint}</span>}
    </label>
  );
}

function SummaryRow({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs font-semibold">{label}</dt>
      <dd className={cn("mt-0.5 font-bold break-words", muted && "text-muted-foreground font-normal italic")}>{value}</dd>
    </div>
  );
}
