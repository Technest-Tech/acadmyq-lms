"use client";

import { Banknote, CalendarDays, Hash, User, UserCheck, Users, Zap } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Combobox, DialCodePicker, type ComboboxOption } from "@/components/ui/combobox";
import {
  ApiError,
  createStudent,
  type GuardianRow,
  listGuardians,
} from "@/lib/api";
import { COUNTRIES, CURRENCIES } from "@/lib/countries";
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

/**
 * One of a pair of mutually exclusive choices, as a card. Used for both switches on this form —
 * the lifecycle the student starts in, and whether they sit under a guardian — so the two read
 * as the same kind of decision rather than two unrelated widgets.
 */
function ChoiceCard({
  icon: Icon,
  title,
  hint,
  selected,
  onSelect,
  testId,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  hint: string;
  selected: boolean;
  onSelect: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      data-testid={testId}
      className={cn(
        "rounded-xl border px-3.5 py-3 text-start transition-colors",
        selected
          ? "border-primary/40 bg-primary/8 ring-primary/15 ring-2"
          : "border-input bg-background hover:bg-muted/40",
      )}
    >
      <span className="flex items-center gap-2">
        <Icon
          className={cn("size-4 shrink-0", selected ? "text-primary" : "text-muted-foreground")}
          aria-hidden
        />
        <span className={cn("text-sm font-semibold", selected && "text-primary")}>{title}</span>
      </span>
      <span className="text-muted-foreground/80 mt-1 block text-[11px] leading-snug">{hint}</span>
    </button>
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

function toMinor(val: string): number {
  return Math.round(parseFloat(val || "0") * 100);
}

type Intent = "trial" | "enrolled";

// ── Component ──────────────────────────────────────────────────────────────────

/**
 * A single, general "create student" form. Assigning a teacher and a timetable are still
 * completed afterwards from the student's profile; the price is not, because it decides which
 * lifecycle the student is even in.
 *
 * `intent` decides which lifecycle the new student starts in, because the two ways people arrive
 * are genuinely different:
 *   • "trial" (default) — walk-in intake. Saved as a TRIAL; the trial session is scheduled from
 *     their profile afterwards.
 *   • "enrolled" — the CRM's SUBSCRIBED stage. They already had their trial in the pipeline and
 *     are subscribing now, so they are saved REGULAR and land on the Students page as a learner,
 *     not back in a trial queue.
 *
 * PASSING `intent` FIXES IT. Omit the prop and the choice becomes the form's first question — two
 * cards, trial preselected — because a walk-in intake is not always a trial: some people arrive
 * already sold, and making them a trial first only to activate them a minute later is a detour.
 * The flows that convert an existing trial or CRM lead pass "enrolled" and so keep their single
 * meaning; there, offering "save as trial" would contradict the flow the user is already in.
 */
export function StudentForm({
  fixedGuardianId,
  initialFullName,
  initialPhone,
  intent,
  onCreated,
  onCancel,
}: {
  fixedGuardianId?: string;
  /** Prefill the name (e.g. converting a trial lead into a student). */
  initialFullName?: string;
  /** Prefill the phone from a stored E.164 number, split into dial-code + local. */
  initialPhone?: string | null;
  /** Fix the lifecycle the student starts in; omit to let the user choose — see the note above. */
  intent?: Intent;
  onCreated: (studentId: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("students");
  const { can } = useAuth();
  // Naming a price is a pricing act wherever it happens — the API enforces `student.set_price`
  // on the inline subscription too, so a role without it is never shown the package fields.
  const canPrice = can("student.set_price");
  const initialSplit = splitPhone(initialPhone);
  const [guardians, setGuardians] = useState<GuardianRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [mode, setMode] = useState<Intent>(intent ?? "trial");
  const [fullName, setFullName] = useState(initialFullName ?? "");
  const [dialCountry, setDialCountry] = useState(initialSplit.dialCountry);
  const [localNumber, setLocalNumber] = useState(initialSplit.localNumber);
  const [country, setCountry] = useState("");
  const [selfGuardian, setSelfGuardian] = useState(false);
  const [guardianId, setGuardianId] = useState(fixedGuardianId ?? "");

  // Package — hourly, matching the enrolment wizard's pricing step and the student-detail form.
  const [price, setPrice] = useState("");
  const [hours, setHours] = useState("");
  const [currency, setCurrency] = useState("");
  const [startDate, setStartDate] = useState(
    () => new Date().toISOString().split("T")[0] ?? "",
  );

  const currencyOptions = useMemo<ComboboxOption[]>(
    () => [
      { value: "", label: t("form.none"), sublabel: "—" },
      ...CURRENCIES.map((c) => ({ value: c.code, label: c.code, sublabel: c.name })),
    ],
    [t],
  );

  // Only where the user actually gets to decide; a fixed intent has no cards.
  const choosable = intent === undefined;
  const enrolling = mode === "enrolled";
  const showPackage = enrolling && canPrice;

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
    // A REGULAR student with no package is a learner nobody ever invoices, so when the user may
    // price, the package is the price of choosing "active" — not an optional extra.
    if (showPackage && (!price.trim() || !startDate)) {
      setError(t("form.packageRequired"));
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
        status: enrolling ? "REGULAR" : "TRIAL",
        ...(showPackage
          ? {
              subscription: {
                // The package is always hourly here; derive a display label from the quota.
                plan_label: hours ? `${hours} hrs/month` : "Hourly",
                sessions_per_month: hours ? Number(hours) : null,
                price_minor: toMinor(price),
                currency: currency || undefined,
                price_basis: "PER_HOUR" as const,
                start_date: startDate,
              },
            }
          : {}),
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

      {/* What this save will produce — a trial intake, or an enrolled student. Two cards where
          the user decides; the flow's own banner where the caller has already decided. */}
      {choosable ? (
        <div className="space-y-1.5">
          <span className="text-sm font-medium">{t("form.intentTitle")}</span>
          <div className="grid gap-2 sm:grid-cols-2">
            <ChoiceCard
              icon={Zap}
              title={t("form.intentTrial")}
              hint={t("form.intentTrialHint")}
              selected={!enrolling}
              onSelect={() => setMode("trial")}
              testId="intent-trial"
            />
            <ChoiceCard
              icon={UserCheck}
              title={t("form.intentActive")}
              hint={t("form.intentActiveHint")}
              selected={enrolling}
              onSelect={() => setMode("enrolled")}
              testId="intent-enrolled"
            />
          </div>
        </div>
      ) : enrolling ? (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-800/40 dark:bg-emerald-950/20">
          <UserCheck className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div>
            <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">
              {t("form.enrolledBannerTitle")}
            </p>
            <p className="mt-0.5 text-xs text-emerald-700/80 dark:text-emerald-400/70">
              {t("form.enrolledBannerBody")}
            </p>
          </div>
        </div>
      ) : (
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
      )}

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

      {/* Who the student belongs to. Stated as a switch rather than a tick-box because the two
          answers are equally ordinary — an adult booking for themselves is not "the exception". */}
      <div className="space-y-1.5">
        <span className="text-sm font-medium">{t("form.guardianMode")}</span>
        <div className="grid gap-2 sm:grid-cols-2">
          <ChoiceCard
            icon={Users}
            title={t("form.guardianModeFamily")}
            hint={t("form.guardianModeFamilyHint")}
            selected={!selfGuardian}
            onSelect={() => setSelfGuardian(false)}
            testId="guardian-mode-family"
          />
          <ChoiceCard
            icon={UserCheck}
            title={t("form.guardianModeSingle")}
            hint={t("form.guardianModeSingleHint")}
            selected={selfGuardian}
            onSelect={() => setSelfGuardian(true)}
            testId="guardian-mode-single"
          />
        </div>
      </div>

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

      {/* ── Package ─────────────────────────────────────────────────────────
          Only for an active student, and only for whoever may name a price. A role without
          `student.set_price` still gets to create the learner; the package is added later by
          someone who may price, rather than the whole card being denied to them. */}
      {enrolling &&
        (canPrice ? (
          <div
            className="space-y-3 rounded-xl border border-primary/20 bg-primary/[0.04] p-3.5"
            data-testid="package-details"
          >
            <div>
              <p className="text-sm font-semibold">{t("form.packageTitle")}</p>
              <p className="text-muted-foreground mt-0.5 text-xs">{t("form.packageHint")}</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("subscription.priceHourly")} required>
                <div className="relative">
                  <Banknote className="text-muted-foreground pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2" />
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    aria-label={t("subscription.priceHourly")}
                    className={cn(inputBase, "py-2.5 ps-10 pe-3.5")}
                    placeholder="0.00"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                  />
                </div>
              </Field>

              <Field label={t("subscription.hoursPerMonth")}>
                <div className="relative">
                  <Hash className="text-muted-foreground pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2" />
                  <input
                    type="number"
                    min={0}
                    aria-label={t("subscription.hoursPerMonth")}
                    className={cn(inputBase, "py-2.5 ps-10 pe-3.5")}
                    placeholder="8"
                    value={hours}
                    onChange={(e) => setHours(e.target.value)}
                  />
                </div>
              </Field>

              <Field label={t("subscription.currency")}>
                <Combobox
                  options={currencyOptions}
                  value={currency}
                  onChange={setCurrency}
                  placeholder={t("form.currencyPlaceholder")}
                  searchPlaceholder={t("form.searchCurrency")}
                />
              </Field>

              <Field label={t("subscription.startDate")} required>
                <div className="relative">
                  <CalendarDays className="text-muted-foreground pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2" />
                  <input
                    type="date"
                    aria-label={t("subscription.startDate")}
                    className={cn(inputBase, "py-2.5 ps-10 pe-3.5")}
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
              </Field>
            </div>
          </div>
        ) : (
          <p className="rounded-xl border border-dashed px-3.5 py-2.5 text-xs text-muted-foreground">
            {t("form.packageNoRights")}
          </p>
        ))}

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
          ) : enrolling ? (
            <UserCheck className="size-3.5" />
          ) : (
            <Zap className="size-3.5" />
          )}
          {enrolling ? t("form.createEnrolled") : t("form.create")}
        </Button>
      </div>
    </div>
  );
}
