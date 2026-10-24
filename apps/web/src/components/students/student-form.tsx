"use client";

import {
  Banknote,
  CalendarDays,
  CalendarRange,
  Hash,
  Layers,
  Phone,
  User,
  UserCheck,
  UserPlus,
  Users,
  Zap,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import {
  PackageTermsFields,
  usePackageTerms,
} from "@/components/packages/package-terms";
import {
  TeacherLinksField,
  toTeacherInputs,
  type TeacherLinkDraft,
} from "@/components/students/teacher-links-field";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Combobox, DialCodePicker, type ComboboxOption } from "@/components/ui/combobox";
import { joinPhone, PhoneInput, type PhoneParts } from "@/components/ui/phone-input";
import {
  ApiError,
  createStudent,
  type GuardianRow,
  listGuardians,
  listTeachers,
  type TeacherRow,
} from "@/lib/api";
import { COUNTRIES, CURRENCIES } from "@/lib/countries";
import { hoursText } from "@/components/groups/group-format";
import { addGroupMembers, listGroups, type GroupRow } from "@/lib/groups-api";
import { formatMoney } from "@/lib/money";
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
 * One of a pair of mutually exclusive choices, as a card. Used for every switch on this form —
 * the lifecycle the student starts in, whether they sit under a guardian, monthly or package —
 * and by the enrolment wizard's billing step, so they all read as the same kind of decision.
 */
export function ChoiceCard({
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

/** Which clock an active student starts on. Mutually exclusive — two clocks is a double bill. */
type Billing = "monthly" | "package";

// ── Component ──────────────────────────────────────────────────────────────────

/**
 * A single, general "create student" form. The student's teachers — one per course, as many as
 * they study with — can be set right here; each teacher's weekly timetable is still built
 * afterwards from the profile's Schedule tab. The price is set here too, because it decides
 * which lifecycle the student is even in.
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
  /** `packageOpened` is true when the save also opened a lesson package for them. */
  onCreated: (studentId: string, result?: { packageOpened: boolean }) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("students");
  const locale = useLocale();
  const { can, session } = useAuth();
  // Naming a price is a pricing act wherever it happens — the API enforces `student.set_price`
  // on the inline subscription too, so a role without it is never shown the package fields.
  const canPrice = can("student.set_price");
  const initialSplit = splitPhone(initialPhone);
  const [guardians, setGuardians] = useState<GuardianRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A new student is active by default (Ahmed, 2026-10-24); a trial is the deliberate choice.
  const [mode, setMode] = useState<Intent>(intent ?? "enrolled");
  const [fullName, setFullName] = useState(initialFullName ?? "");
  const [dialCountry, setDialCountry] = useState(initialSplit.dialCountry);
  const [localNumber, setLocalNumber] = useState(initialSplit.localNumber);
  const [country, setCountry] = useState("");
  const [selfGuardian, setSelfGuardian] = useState(false);
  // With a family on the record, the student's own numbers are the exception: folded away.
  const [ownPhones, setOwnPhones] = useState(false);
  const [guardianId, setGuardianId] = useState(fixedGuardianId ?? "");
  // Optional second number (the other parent, a home line) — contact only.
  const [otherPhone, setOtherPhone] = useState<PhoneParts>({
    dialCountry: initialSplit.dialCountry,
    localNumber: "",
  });

  /**
   * No parent on file yet: rather than leave the form for the parents page and come back, the
   * parent is typed in here and created in the same save as the student. Only for a role that may
   * create parents; it opens by itself when the academy has none at all.
   */
  const canCreateGuardian = can("guardian.create");
  const [newParent, setNewParent] = useState(false);
  const [parentName, setParentName] = useState("");
  const [parentPhone, setParentPhone] = useState<PhoneParts>({
    dialCountry: initialSplit.dialCountry,
    localNumber: "",
  });
  const [parentOtherPhone, setParentOtherPhone] = useState<PhoneParts>({
    dialCountry: initialSplit.dialCountry,
    localNumber: "",
  });
  const [parentCurrency, setParentCurrency] = useState("");
  const addingParent = newParent && !selfGuardian && !fixedGuardianId;

  // Teachers are offered only to a role that can see the teacher list at all.
  const canPickTeachers = can("teacher.read");
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [teacherLinks, setTeacherLinks] = useState<TeacherLinkDraft[]>([]);

  /**
   * Monthly or package — asked right here, so an active student's whole billing setup happens in
   * the save that creates them. Offered only where a package can actually be opened: the role may
   * price AND manage packages, and the client's modules include invoicing (the entitlement that
   * gates /api/packages). Anyone else gets the monthly fields exactly as before.
   */
  const packagesAvailable =
    canPrice &&
    can("package.manage") &&
    (session?.capabilities == null ||
      (session.capabilities.includes("invoicing") &&
        session.capabilities.includes("packages")));
  // A centre (`centre`) sells subscriptions: a new student starts on one; a Quran academy starts monthly.
  const centre = session?.capabilities?.includes("centre") ?? false;
  const [billing, setBilling] = useState<Billing>(centre && packagesAvailable ? "package" : "monthly");
  // A centre enrols the student in their groups in the same save (docs/groups/01-ACCOUNTING.md,
  // "Centre mode"): the chosen groups, and the active ones to choose from.
  const groupsOn = centre && (session?.capabilities?.includes("groups") ?? false) && can("group.manage");
  const [groupOptions, setGroupOptions] = useState<GroupRow[] | null>(null);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [pickingGroup, setPickingGroup] = useState("");
  // Set once the student exists but a group enrolment failed: the form stays open to say so.
  const [createdId, setCreatedId] = useState<string | null>(null);
  useEffect(() => {
    if (!groupsOn) return;
    void listGroups({ state: "ACTIVE" })
      .then((r) => setGroupOptions(r.groups))
      .catch(() => setGroupOptions([]));
  }, [groupsOn]);
  const onPackage = packagesAvailable && billing === "package";

  // Monthly — hourly, matching the enrolment wizard's pricing step and the student-detail form.
  const [price, setPrice] = useState("");
  const [hours, setHours] = useState("");
  const [currency, setCurrency] = useState("");
  const [startDate, setStartDate] = useState(
    () => new Date().toISOString().split("T")[0] ?? "",
  );

  // Package — the same fields, defaults and suggestions as the packages screen, because they are
  // literally the same component. A new student has no agreed rate yet, so no total is suggested;
  // the guardian's currency seeds the field since that is who pays.
  const guardianCurrency = addingParent
    ? parentCurrency
    : (guardians.find((g) => g.id === (fixedGuardianId ?? guardianId))?.currency ?? "");
  const terms = usePackageTerms({ defaultCurrency: guardianCurrency });

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
      void listGuardians({ pageSize: 200 }).then((r) => {
        setGuardians(r.rows);
        // Nobody to pick yet: the only way forward is a new parent, so start there.
        if (r.rows.length === 0 && canCreateGuardian) setNewParent(true);
      });
    }
  }, [fixedGuardianId, canCreateGuardian]);

  useEffect(() => {
    if (!canPickTeachers) return;
    void listTeachers({ pageSize: 100, filter: { status: "active" } })
      .then((r) => setTeachers(r.rows))
      .catch(() => setTeachers([]));
  }, [canPickTeachers]);

  function handleCountryChange(code: string) {
    setCountry(code);
    const found = code ? COUNTRIES.find((c) => c.code === code) : undefined;
    if (!found) return;
    // Every number still empty follows the country; one already typed keeps its code.
    const follow = (p: PhoneParts) => (p.localNumber ? p : { ...p, dialCountry: found.code });
    setOtherPhone(follow);
    setParentPhone(follow);
    setParentOtherPhone(follow);
    if (!parentCurrency) setParentCurrency(found.currency);
    if (!localNumber) setDialCountry(found.code);
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
      if (c) {
        setDialCountry(c.code);
        setOtherPhone((p) => (p.localNumber ? p : { ...p, dialCountry: c.code }));
      }
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
    if (addingParent && (!parentName.trim() || !parentPhone.localNumber)) {
      setError(t("form.newGuardianRequired"));
      return false;
    }
    if (!selfGuardian && !addingParent && !guardianId && !fixedGuardianId) {
      setError(t("form.guardianRequired"));
      return false;
    }
    // A REGULAR student with no billing terms is a learner nobody ever invoices, so when the user
    // may price, the terms are the price of choosing "active" — not an optional extra.
    if (showPackage && onPackage && !terms.valid) {
      setError(t("form.packageTermsRequired"));
      return false;
    }
    if (showPackage && !onPackage && (!price.trim() || !startDate)) {
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
    const links = toTeacherInputs(teacherLinks);
    try {
      const res = await createStudent({
        full_name: fullName,
        whatsapp_phone: buildPhone(),
        secondary_phone: joinPhone(otherPhone),
        country: country || null,
        is_self_guardian: selfGuardian,
        guardian_id:
          selfGuardian || addingParent ? undefined : ((fixedGuardianId ?? guardianId) || undefined),
        ...(addingParent
          ? {
              new_guardian: {
                full_name: parentName.trim(),
                whatsapp_phone: joinPhone(parentPhone) ?? "",
                secondary_phone: joinPhone(parentOtherPhone),
                country: country || null,
                currency: parentCurrency || null,
              },
            }
          : {}),
        status: enrolling ? "REGULAR" : "TRIAL",
        ...(links.length > 0 ? { teachers: links } : {}),
        // The package path opens the package in the same request, which also creates the
        // student's package-billing subscription — so it sends no `subscription` of its own.
        ...(showPackage && onPackage ? { package: terms.toPayload() } : {}),
        ...(showPackage && !onPackage
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
      // The groups: each enrolment is its own call; one that fails leaves the student made and
      // the form open to say which one, rather than losing the save.
      const failed: string[] = [];
      for (const gid of groupIds) {
        try {
          await addGroupMembers(gid, { student_ids: [res.studentId], joined_on: startDate });
        } catch {
          failed.push(groupOptions?.find((g) => g.id === gid)?.name ?? gid);
        }
      }
      if (failed.length > 0) {
        setCreatedId(res.studentId);
        setError(t("form.groupJoinFailed", { names: failed.join("، ") }));
        return;
      }
      onCreated(res.studentId, { packageOpened: Boolean(res.packageId) });
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
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label className="text-sm font-medium">
                {addingParent ? t("form.newGuardian") : t("form.guardian")}
                <span className="text-destructive ms-0.5">*</span>
              </label>
              {canCreateGuardian && (
                <button
                  type="button"
                  onClick={() => setNewParent((v) => !v)}
                  className="text-primary inline-flex items-center gap-1 text-xs font-semibold underline-offset-4 hover:underline"
                  data-testid="guardian-new-toggle"
                >
                  {addingParent ? (
                    <>
                      <Users className="size-3.5" aria-hidden />
                      {t("form.pickExistingGuardian")}
                    </>
                  ) : (
                    <>
                      <UserPlus className="size-3.5" aria-hidden />
                      {t("form.addNewGuardian")}
                    </>
                  )}
                </button>
              )}
            </div>

            {addingParent ? (
              <div
                className="space-y-3 rounded-xl border border-primary/20 bg-primary/[0.04] p-3.5"
                data-testid="new-guardian"
              >
                <p className="text-muted-foreground text-xs">{t("form.newGuardianHint")}</p>
                <Field label={t("form.guardianName")} required>
                  <div className="relative">
                    <User className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      aria-label={t("form.guardianName")}
                      className={cn(inputBase, "py-2.5 ps-10 pe-3.5")}
                      placeholder={t("form.guardianNamePlaceholder")}
                      value={parentName}
                      onChange={(e) => setParentName(e.target.value)}
                    />
                  </div>
                </Field>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label={t("form.guardianPhone")} required>
                    <PhoneInput
                      value={parentPhone}
                      onChange={setParentPhone}
                      ariaLabel={t("form.guardianPhone")}
                      testId="new-guardian-phone"
                    />
                  </Field>
                  <Field label={t("form.secondaryPhone")}>
                    <PhoneInput
                      value={parentOtherPhone}
                      onChange={setParentOtherPhone}
                      ariaLabel={t("form.guardianSecondaryPhone")}
                    />
                  </Field>
                </div>
                <Field label={t("subscription.currency")} hint={t("form.guardianCurrencyHint")}>
                  <Combobox
                    options={currencyOptions}
                    value={parentCurrency}
                    onChange={setParentCurrency}
                    placeholder={t("form.currencyPlaceholder")}
                    searchPlaceholder={t("form.searchCurrency")}
                  />
                </Field>
              </div>
            ) : (
              <Combobox
                options={guardians.map((g) => ({
                  value: g.id,
                  label: g.full_name,
                  sublabel: g.whatsapp_phone,
                }))}
                value={guardianId}
                onChange={handleGuardianChange}
                placeholder={t("form.none")}
                searchPlaceholder={t("form.searchGuardian")}
                data-testid="guardian-select"
              />
            )}
          </div>
        )
      )}

      {!selfGuardian && !ownPhones && (
        <button
          type="button"
          onClick={() => setOwnPhones(true)}
          className="text-primary inline-flex items-center gap-1 text-xs font-semibold underline-offset-4 hover:underline"
          data-testid="own-phones-toggle"
        >
          <Phone className="size-3.5" aria-hidden />
          {t("form.ownPhones")}
          <span className="text-muted-foreground font-normal">· {t("form.ownPhonesHint")}</span>
        </button>
      )}

      {(selfGuardian || ownPhones) && (
        <>
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

      <Field label={t("form.secondaryPhone")} hint={t("form.secondaryPhoneHint")}>
        <PhoneInput
          value={otherPhone}
          onChange={setOtherPhone}
          ariaLabel={t("form.secondaryPhone")}
          testId="student-secondary-phone"
        />
      </Field>
        </>
      )}

      <Field label={t("form.country")}>
        <Combobox
          options={countryOptions}
          value={country}
          onChange={handleCountryChange}
          placeholder={t("form.countryPlaceholder")}
          searchPlaceholder={t("form.searchCountry")}
        />
      </Field>

      {/* ── Teachers ────────────────────────────────────────────────────────
          A list, because a student may study different courses with different teachers. */}
      {canPickTeachers && teachers.length > 0 && (
        <Field label={t("form.teachers")} hint={t("teacher.formHint")}>
          <TeacherLinksField
            value={teacherLinks}
            onChange={setTeacherLinks}
            teachers={teachers}
            disabled={busy}
          />
        </Field>
      )}

      {/* ── Billing ─────────────────────────────────────────────────────────
          Only for an active student, and only for whoever may name a price. A role without
          `student.set_price` still gets to create the learner; billing is added later by
          someone who may price, rather than the whole card being denied to them.

          Monthly or package is the first question inside it, because it changes what every field
          below means. Picking package shows the very same fields as the packages screen and opens
          the package in this save — there is no second step on another page. */}
      {enrolling &&
        (canPrice ? (
          <div
            className="space-y-3 rounded-xl border border-primary/20 bg-primary/[0.04] p-3.5"
            data-testid="billing-details"
          >
            <div>
              <p className="text-sm font-semibold">{t("form.billingTitle")}</p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {onPackage ? t("form.billingPackageIntro") : t("form.packageHint")}
              </p>
            </div>

            {packagesAvailable && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <ChoiceCard
                  icon={CalendarRange}
                  title={centre ? t("form.noPrivate") : t("form.billingMonthly")}
                  hint={centre ? t("form.noPrivateHint") : t("form.billingMonthlyHint")}
                  selected={billing === "monthly"}
                  onSelect={() => setBilling("monthly")}
                  testId="billing-monthly"
                />
                <ChoiceCard
                  icon={Layers}
                  title={centre ? t("form.billingSubscription") : t("form.billingPackage")}
                  hint={centre ? t("form.billingSubscriptionHint") : t("form.billingPackageHint")}
                  selected={billing === "package"}
                  onSelect={() => setBilling("package")}
                  testId="billing-package"
                />
              </div>
            )}

            {groupsOn && (
              <div className="space-y-2 rounded-xl border bg-background/60 p-3" data-testid="group-subs">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{t("form.groupSubs")}</p>
                  <select
                    className={cn(inputBase, "w-56 px-3 py-1.5 text-sm")}
                    value={pickingGroup}
                    onChange={(e) => {
                      const id = e.target.value;
                      setPickingGroup("");
                      if (id && !groupIds.includes(id)) setGroupIds((prev) => [...prev, id]);
                    }}
                    aria-label={t("form.pickGroup")}
                    data-testid="group-subs-pick"
                  >
                    <option value="">{groupOptions === null ? "…" : groupOptions.length === 0 ? t("form.noGroups") : t("form.addGroup")}</option>
                    {(groupOptions ?? [])
                      .filter((g) => !groupIds.includes(g.id))
                      .map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                          {g.teacher_name ? ` · ${g.teacher_name}` : ""}
                        </option>
                      ))}
                  </select>
                </div>
                {groupIds.length === 0 ? (
                  <p className="text-muted-foreground text-xs">{t("form.groupSubsHint")}</p>
                ) : (
                  <ul className="divide-y rounded-lg border" data-testid="group-subs-list">
                    {groupIds.map((id) => {
                      const g = groupOptions?.find((x) => x.id === id);
                      const pr = g?.pricing ?? null;
                      const price = pr?.price_minor != null && pr.currency ? formatMoney({ amount: pr.price_minor, currency: pr.currency }, locale) : null;
                      const summary =
                        price === null
                          ? t("form.groupNoPrice")
                          : pr?.billing_mode === "MONTHLY" && pr.month_minutes
                            ? t("form.groupPrice", { price, hours: hoursText(pr.month_minutes) })
                            : pr?.billing_mode === "PER_LESSON"
                              ? t("form.groupPriceLesson", { price })
                              : pr?.billing_mode === "COURSE"
                                ? t("form.groupPriceCourse", { price })
                                : t("form.groupPriceMonthly", { price });
                      return (
                        <li key={id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm" data-testid={`group-sub-${id}`}>
                          <span className="min-w-0">
                            <span className="block font-medium">{g?.name ?? id}</span>
                            <span className="text-muted-foreground block text-xs">{[g?.teacher_name, summary].filter(Boolean).join(" · ")}</span>
                          </span>
                          <button type="button" onClick={() => setGroupIds((prev) => prev.filter((x) => x !== id))} className="text-muted-foreground hover:text-destructive text-xs">
                            {t("form.removeGroup")}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}

            {onPackage ? (
              <PackageTermsFields terms={terms} idPrefix="new-student-pkg" />
            ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
            )}
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
          onClick={() => (createdId ? onCreated(createdId, { packageOpened: false }) : void save())}
          disabled={busy}
          className="gap-1.5"
          data-testid="submit-student"
        >
          {busy ? (
            <span className="size-3.5 animate-spin rounded-full border border-current border-t-transparent" />
          ) : enrolling ? (
            <UserCheck className="size-3.5" />
          ) : (
            <Zap className="size-3.5" />
          )}
          {createdId ? t("form.closeAfter") : enrolling ? t("form.createEnrolled") : t("form.create")}
        </Button>
      </div>
    </div>
  );
}
