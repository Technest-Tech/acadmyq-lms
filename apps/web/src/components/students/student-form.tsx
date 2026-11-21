"use client";

import {
  CalendarDays,
  CalendarPlus,
  CalendarRange,
  GraduationCap,
  Layers,
  Phone,
  Plus,
  User,
  UserCheck,
  UserPlus,
  Users,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import {
  PackageTermsFields,
  usePackageTerms,
} from "@/components/packages/package-terms";
import { MonthlyTermsFields, useMonthlyTerms } from "@/components/students/monthly-terms";
import { ClockField } from "@/components/scheduling/clock-field";
import { todayLocal } from "@/components/scheduling/start-date-field";
import { StudentSubscriptionFields, useStudentSubscriptionDraft } from "@/components/subscriptions/student-subscription-fields";
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
  putStudentSchedule,
  type ScheduleSlot,
  type TeacherRow,
} from "@/lib/api";
import { fetchRoster } from "@/lib/roster";
import { COUNTRIES, CURRENCIES } from "@/lib/countries";
import { hoursText, monthLessons } from "@/components/groups/group-format";
import { filterGroups, GroupSearchBox } from "@/components/groups/group-search";
import { addGroupMembers, listGroups, type GroupRow } from "@/lib/groups-api";
import { LevelSelect } from "@/components/levels/level-select";
import { useAcademyDefaults } from "@/lib/academy-defaults";
import { formatMoney } from "@/lib/money";
import { PaidFirstPackageField, usePaidFirstPackage } from "@/components/packages/paid-first-package";
import { cn } from "@/lib/utils";
import { useLevelsOn, useLevelWord } from "@/lib/levels";

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

/**
 * One part of the form — who the student is, who teaches them and when, how they pay — as its own
 * card with a heading, so a long form reads as three short ones (Ahmed 2026-11-17).
 */
function FormSection({
  icon: Icon,
  title,
  hint,
  testId,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  hint?: string;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-card space-y-4 rounded-2xl border p-4 sm:p-5" data-testid={testId}>
      <header className="flex items-start gap-3">
        <span className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-xl">
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 pt-0.5">
          <h3 className="text-sm font-semibold">{title}</h3>
          {hint && <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">{hint}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}

/** The week as the desk reads it: Saturday first. */
const WEEK_ORDER = [6, 0, 1, 2, 3, 4, 5];

/** Backend bounds for a slot's length (ScheduleController: integer, min:1, max:600). */
const SLOT_MINUTES_MAX = 600;

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
function splitPhone(phone: string | null | undefined, fallbackCountry = "SA"): {
  dialCountry: string;
  localNumber: string;
} {
  if (!phone) return { dialCountry: fallbackCountry, localNumber: "" };
  const match = [...COUNTRIES]
    .sort((a, b) => b.dialCode.length - a.dialCode.length)
    .find((c) => phone.startsWith(c.dialCode));
  return match
    ? { dialCountry: match.code, localNumber: phone.slice(match.dialCode.length) }
    : { dialCountry: fallbackCountry, localNumber: phone.replace(/[^\d]/g, "") };
}

type Intent = "trial" | "enrolled";

/** Which clock an active student starts on. Mutually exclusive — two clocks is a double bill. */
/** `none` = no private subscription at all — a centre student on groups only; `subscription` = a centre's block of lessons. */
type Billing = "monthly" | "package" | "none" | "subscription";

// ── Component ──────────────────────────────────────────────────────────────────

/**
 * A single, general "create student" form, in three cards: the student, their teachers and
 * weekly timetable, their billing. The student's teachers — one per course, as many as they study
 * with — can be set right here, and one weekly timetable with them (one lesson per picked day;
 * anything richer is the profile's Schedule tab). The price is set here too, because it decides
 * which lifecycle the student is even in. Where a lesson package can be sold it is the default
 * (Ahmed 2026-11-17), paid up front from today.
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
  initialCountry,
  initialClock,
  intent,
  onCreated,
  onCancel,
}: {
  fixedGuardianId?: string;
  /** Prefill the name (e.g. converting a trial lead into a student). */
  initialFullName?: string;
  /** Prefill the phone from a stored E.164 number, split into dial-code + local. */
  initialPhone?: string | null;
  /** Where the student lives, when already known (a trial booked on their clock). */
  initialCountry?: string | null;
  /** The clock they keep there — a country with several (US, Canada, Australia) needs the city. */
  initialClock?: string | null;
  /** Fix the lifecycle the student starts in; omit to let the user choose — see the note above. */
  intent?: Intent;
  /** `packageOpened` is true when the save also opened a lesson package for them. */
  onCreated: (studentId: string, result?: { packageOpened: boolean }) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("students");
  const tSched = useTranslations("scheduling");
  const tLevels = useTranslations("levels");
  const tSubs = useTranslations("subscriptions");
  const word = useLevelWord();
  const locale = useLocale();
  const { can, session } = useAuth();
  // Naming a price is a pricing act wherever it happens — the API enforces `student.set_price`
  // on the inline subscription too, so a role without it is never shown the package fields.
  const canPrice = can("student.set_price");
  // What the academy set under Settings: the country (and its dial code) and the currency.
  const defaults = useAcademyDefaults();
  const initialSplit = splitPhone(initialPhone, defaults.dialCountry);
  const [guardians, setGuardians] = useState<GuardianRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A new student is active by default (Ahmed, 2026-10-24); a trial is the deliberate choice.
  const [mode, setMode] = useState<Intent>(intent ?? "enrolled");
  const [fullName, setFullName] = useState(initialFullName ?? "");
  const [dialCountry, setDialCountry] = useState(initialSplit.dialCountry);
  const [localNumber, setLocalNumber] = useState(initialSplit.localNumber);
  const [country, setCountry] = useState(initialCountry || defaults.country);
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
  const [parentCurrency, setParentCurrency] = useState(defaults.currency);
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
  // A centre's private subscription (docs/centre-profile/01): its own object, sold in the same save
  // as `subscription:` — needs the pricing right and the subscriptions' manage code, nothing else.
  const subscriptionAvailable = centre && canPrice && can("package.manage");
  // What the user picked; until then the form's own default (below, once we know about groups).
  const [billingPick, setBilling] = useState<Billing | null>(null);
  // A centre enrols the student in their groups in the same save (docs/groups/01-ACCOUNTING.md,
  // "Centre mode"): the chosen groups, and the active ones to choose from.
  const groupsOn = centre && (session?.capabilities?.includes("groups") ?? false) && can("group.manage");
  // A centre student may take groups alone: the first tile is then "no private subscription".
  const groupsOnlyChoice = centre && groupsOn;
  // A centre with groups starts on "no private subscription": a private block is only ever sold by
  // picking it. Starting on it sold one to every group-only student whose tile nobody touched (lingo).
  const billing: Billing =
    billingPick ?? (groupsOnlyChoice ? "none" : subscriptionAvailable ? "subscription" : packagesAvailable ? "package" : "monthly");
  const [groupOptions, setGroupOptions] = useState<GroupRow[] | null>(null);
  const [groupQuery, setGroupQuery] = useState("");
  // The student's level / grade (docs/centre-profile, Phase 2.1) — optional, from the academy's
  // list: a centre's always, a Quran academy's once it switched levels on in Settings.
  const levelsOn = useLevelsOn();
  const [levelId, setLevelId] = useState("");
  // Each group picked, from the day the student joins it.
  const [groupPicks, setGroupPicks] = useState<{ id: string; joinedOn: string }[]>([]);
  const groupIds = groupPicks.map((g) => g.id);
  // Set once the student exists but a group enrolment failed: the form stays open to say so.
  const [createdId, setCreatedId] = useState<string | null>(null);
  useEffect(() => {
    if (!groupsOn) return;
    void listGroups({ state: "ACTIVE" })
      .then((r) => setGroupOptions(r.groups))
      .catch(() => setGroupOptions([]));
  }, [groupsOn]);
  const onPackage = !centre && packagesAvailable && billing === "package";
  const onSubscription = subscriptionAvailable && billing === "subscription";
  const groupsOnly = groupsOnlyChoice && billing === "none";

  function pickGroup(id: string) {
    const g = groupOptions?.find((x) => x.id === id);
    if (!g || groupIds.includes(id)) return;
    const today = new Date().toISOString().split("T")[0] ?? "";
    // A class nobody has attended yet takes the student from its first lesson; else from today.
    const joinedOn = g.lessons?.held === 0 ? g.start_date : today < g.start_date ? g.start_date : today;
    setGroupPicks((prev) => [...prev, { id, joinedOn }]);
  }

  // Monthly — lessons of a length, priced by the hour or the lesson, or free. The same fields as
  // the enrolment wizard's pricing step and the profile's edit modal (they are one component).
  const monthly = useMonthlyTerms({ defaultCurrency: defaults.currency });

  // Package — the same fields, defaults and suggestions as the packages screen, because they are
  // literally the same component. A new student has no agreed rate yet, so no total is suggested;
  // the guardian's currency seeds the field since that is who pays.
  const guardianCurrency =
    (addingParent ? parentCurrency : (guardians.find((g) => g.id === (fixedGuardianId ?? guardianId))?.currency ?? "")) || defaults.currency;
  const terms = usePackageTerms({ defaultCurrency: guardianCurrency });
  // Paid before being added: the package opens on that paid bill instead of raising a second one.
  const paidFirst = usePaidFirstPackage(selfGuardian || addingParent ? "" : (fixedGuardianId ?? guardianId));
  // A centre's block: the subject is one of the teacher links above, or a new one.
  const subscriptionDraft = useStudentSubscriptionDraft(teacherLinks.map((l) => ({ teacher_id: l.teacher_id, course: l.course.trim() || null })));

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
  // Monthly — neither a package, a centre's block, nor groups alone.
  const monthlyOn = !onPackage && !onSubscription && !groupsOnly;

  /**
   * The weekly timetable, saved right after the student (Ahmed 2026-11-17) — optional, and only
   * for an active student: a trial's single lesson is booked from the trials board. Each picked
   * day is one weekly lesson; two lessons on one day, or per-subject slots, stay with the full
   * editor on the profile's Schedule tab.
   */
  const showTimetable = enrolling && can("schedule.manage") && canPickTeachers && teachers.length > 0;
  const [timetableOn, setTimetableOn] = useState(false);
  const [timetablePick, setTimetablePick] = useState("");
  const [timezone, setTimezone] = useState("");
  const [slots, setSlots] = useState<ScheduleSlot[]>([]);
  const [lengthEdited, setLengthEdited] = useState(false);
  // The lesson the price is for: every day starts at that length until someone types another.
  const lessonLength = showPackage && onPackage ? terms.unitMinutes : showPackage && monthlyOn ? monthly.unitMinutes : null;
  useEffect(() => {
    if (lengthEdited || lessonLength === null) return;
    setSlots((prev) => prev.map((slot) => ({ ...slot, duration_minutes: lessonLength })));
  }, [lessonLength, lengthEdited]);
  // The first teacher chosen above, until another one is picked for the timetable.
  const linkedTeacherIds = teacherLinks.map((l) => l.teacher_id).filter(Boolean);
  const timetableTeacher = timetablePick || linkedTeacherIds[0] || "";
  const timetableTeacherOptions = useMemo<ComboboxOption[]>(() => {
    const course = new Map(teacherLinks.filter((l) => l.teacher_id).map((l) => [l.teacher_id, l.course.trim()]));
    return [...teachers]
      .sort((a, b) => Number(course.has(b.id)) - Number(course.has(a.id)))
      .map((tch) => ({ value: tch.id, label: tch.full_name, sublabel: course.get(tch.id) || undefined }));
  }, [teachers, teacherLinks]);
  const orderedSlots = [...slots].sort((a, b) => WEEK_ORDER.indexOf(a.weekday) - WEEK_ORDER.indexOf(b.weekday));

  function toggleDay(day: number) {
    setSlots((prev) => {
      if (prev.some((slot) => slot.weekday === day)) return prev.filter((slot) => slot.weekday !== day);
      const last = prev.at(-1);
      return [
        ...prev,
        {
          weekday: day,
          start_time_local: last?.start_time_local ?? "17:00",
          duration_minutes: last?.duration_minutes ?? lessonLength ?? 30,
        },
      ];
    });
  }

  function updateSlot(day: number, patch: Partial<ScheduleSlot>) {
    setSlots((prev) => prev.map((slot) => (slot.weekday === day ? { ...slot, ...patch } : slot)));
  }

  useEffect(() => {
    if (!fixedGuardianId) {
      void fetchRoster(listGuardians).then((r) => {
        setGuardians(r.rows);
        // Nobody to pick yet: the only way forward is a new parent, so start there.
        if (r.rows.length === 0 && canCreateGuardian) setNewParent(true);
      });
    }
  }, [fixedGuardianId, canCreateGuardian]);

  useEffect(() => {
    if (!canPickTeachers) return;
    void fetchRoster(listTeachers, { filter: { status: "active" } })
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
    if (showPackage && onPackage && !paidFirst.valid) {
      setError(t("form.paidFirstRequired"));
      return false;
    }
    if (showPackage && onSubscription && !subscriptionDraft.valid) {
      setError(tSubs("studentForm.termsRequired"));
      return false;
    }
    // Groups only: at least one group, or there is nothing to bill this active student for.
    if (showPackage && groupsOnly && groupPicks.length === 0) {
      setError(t("form.groupOrPrivateRequired"));
      return false;
    }
    if (showPackage && !onPackage && !onSubscription && !groupsOnly && !monthly.valid) {
      setError(t("form.packageRequired"));
      return false;
    }
    if (showTimetable && timetableOn) {
      if (!timetableTeacher) {
        setError(t("form.timetableTeacherRequired"));
        return false;
      }
      if (slots.length === 0) {
        setError(t("form.timetableDaysRequired"));
        return false;
      }
      if (slots.some((slot) => !Number.isInteger(slot.duration_minutes) || slot.duration_minutes < 1 || slot.duration_minutes > SLOT_MINUTES_MAX)) {
        setError(t("form.timetableLengthInvalid"));
        return false;
      }
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
        ...(levelsOn && levelId ? { level_id: levelId } : {}),
        ...(links.length > 0 ? { teachers: links } : {}),
        // The package path opens the package in the same request, which also creates the
        // student's package-billing subscription — so it sends no `subscription` of its own.
        ...(showPackage && onPackage
          ? { package: { ...terms.toPayload(), ...(paidFirst.paidInvoiceId !== null ? { paid_invoice_id: paidFirst.paidInvoiceId } : {}) } }
          : {}),
        // A centre's block travels as `subscription` too (docs/centre-profile/01 "API contract").
        ...(showPackage && onSubscription ? { subscription: subscriptionDraft.toPayload() } : {}),
        ...(showPackage && !onPackage && !onSubscription && !groupsOnly ? { subscription: monthly.toPayload() } : {}),
      });
      // The groups: each enrolment is its own call; one that fails leaves the student made and
      // the form open to say which one, rather than losing the save.
      const failed: string[] = [];
      for (const pick of groupPicks) {
        try {
          await addGroupMembers(pick.id, { student_ids: [res.studentId], joined_on: pick.joinedOn });
        } catch {
          failed.push(groupOptions?.find((g) => g.id === pick.id)?.name ?? pick.id);
        }
      }
      // The timetable: from today — or from a billing start still ahead. This form never writes
      // lessons into the past; a back-dated timetable is the profile editor's deliberate step.
      let timetableFailed: string | null = null;
      if (showTimetable && timetableOn && slots.length > 0 && timetableTeacher) {
        const today = todayLocal();
        const billStart = showPackage && onPackage ? terms.startsOn : showPackage && monthlyOn ? monthly.startDate : "";
        try {
          await putStudentSchedule(res.studentId, {
            teacher_id: timetableTeacher,
            timezone: timezone || undefined,
            start_date: billStart > today ? billStart : today,
            slots: slots.map((slot) => ({
              weekday: slot.weekday,
              start_time_local: slot.start_time_local,
              duration_minutes: slot.duration_minutes,
            })),
          });
        } catch (err) {
          timetableFailed = err instanceof ApiError ? err.message : String(err);
        }
      }
      if (failed.length > 0 || timetableFailed !== null) {
        setCreatedId(res.studentId);
        setError(
          [
            failed.length > 0 ? t("form.groupJoinFailed", { names: failed.join("، ") }) : null,
            timetableFailed !== null ? t("form.timetableFailed", { reason: timetableFailed }) : null,
          ]
            .filter(Boolean)
            .join(" "),
        );
        return;
      }
      onCreated(res.studentId, { packageOpened: Boolean(res.packageId ?? res.subscriptionId) });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const packageCard = (
    <ChoiceCard
      icon={Layers}
      title={centre ? t("form.billingSubscription") : t("form.billingPackage")}
      hint={centre ? t("form.billingSubscriptionHint") : t("form.billingPackageHint")}
      selected={billing === "package"}
      onSelect={() => setBilling("package")}
      testId="billing-package"
    />
  );

  return (
    <div className="space-y-4" data-testid="student-form">
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

      {/* ── 1 · The student ──────────────────────────────────────────────── */}
      <FormSection icon={User} title={t("form.sectionStudent")} testId="section-student">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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

          <Field label={t("form.country")}>
            <Combobox
              options={countryOptions}
              value={country}
              onChange={handleCountryChange}
              placeholder={t("form.countryPlaceholder")}
              searchPlaceholder={t("form.searchCountry")}
            />
          </Field>

          {/* Level / grade — the academy's classification, from its own list (Settings) */}
          {levelsOn && (
            <Field label={tLevels("select.label", { word })}>
              <LevelSelect value={levelId} onChange={setLevelId} withAddLink testId="student-level" />
            </Field>
          )}
        </div>

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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
          </div>
        )}
      </FormSection>

      {/* ── 2 · Teachers and the weekly timetable ──────────────────────────
          A list, because a student may study different courses with different teachers. */}
      {canPickTeachers && teachers.length > 0 && (
        <FormSection
          icon={GraduationCap}
          title={showTimetable ? t("form.sectionTeachers") : t("form.teachers")}
          hint={t("teacher.formHint")}
          testId="section-teachers"
        >
          <TeacherLinksField
            value={teacherLinks}
            onChange={setTeacherLinks}
            teachers={teachers}
            disabled={busy}
          />

          {showTimetable &&
            (!timetableOn ? (
              <button
                type="button"
                onClick={() => {
                  setTimetableOn(true);
                  if (slots.length === 0) toggleDay(WEEK_ORDER[0] ?? 6);
                }}
                className="group hover:border-primary/40 hover:bg-primary/5 hover:text-primary text-muted-foreground flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed px-3 py-3 text-sm font-semibold transition-colors"
                data-testid="timetable-open"
              >
                <CalendarPlus className="size-4" aria-hidden />
                {t("form.timetableAdd")}
                <span className="hidden font-normal sm:inline">· {t("form.timetableAddHint")}</span>
              </button>
            ) : (
              <div className="space-y-4 rounded-xl border bg-muted/20 p-3.5" data-testid="new-student-timetable">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="flex items-center gap-1.5 text-sm font-semibold">
                      <CalendarDays className="text-primary size-4" aria-hidden />
                      {t("form.timetableTitle")}
                    </p>
                    <p className="text-muted-foreground mt-0.5 text-xs">{t("form.timetableHint")}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTimetableOn(false)}
                    className="text-muted-foreground hover:text-destructive shrink-0 text-xs font-medium"
                    data-testid="timetable-close"
                  >
                    {t("form.timetableRemove")}
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label={t("form.timetableTeacher")} required>
                    <Combobox
                      options={timetableTeacherOptions}
                      value={timetableTeacher}
                      onChange={setTimetablePick}
                      placeholder={tSched("timetables.selectTeacher")}
                      searchPlaceholder={tSched("timetables.searchTeacher")}
                      data-testid="timetable-teacher"
                    />
                  </Field>
                  <div className="space-y-1.5">
                    <span className="text-sm font-medium">{t("form.timetableDays")}</span>
                    <div className="flex flex-wrap gap-1.5">
                      {WEEK_ORDER.map((day) => {
                        const on = slots.some((slot) => slot.weekday === day);
                        return (
                          <button
                            key={day}
                            type="button"
                            aria-pressed={on}
                            onClick={() => toggleDay(day)}
                            data-testid={`timetable-day-${day}`}
                            className={cn(
                              "rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors",
                              on
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-input bg-background text-muted-foreground hover:bg-muted/50",
                            )}
                          >
                            {tSched(`weekday.${day}`)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {orderedSlots.length > 0 && (
                  <ul className="bg-background divide-y rounded-xl border" data-testid="timetable-slots">
                    {orderedSlots.map((slot) => (
                      <li
                        key={slot.weekday}
                        className="grid grid-cols-[4.5rem_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2"
                        data-testid={`timetable-slot-${slot.weekday}`}
                      >
                        <span className="text-sm font-medium">{tSched(`weekday.${slot.weekday}`)}</span>
                        <input
                          type="time"
                          aria-label={`${tSched("startTime")} · ${tSched(`weekday.${slot.weekday}`)}`}
                          className={cn(inputBase, "px-2.5 py-1.5")}
                          value={slot.start_time_local}
                          onChange={(e) => updateSlot(slot.weekday, { start_time_local: e.target.value })}
                        />
                        <div className="relative">
                          <input
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={SLOT_MINUTES_MAX}
                            step={5}
                            aria-label={`${tSched("duration")} · ${tSched(`weekday.${slot.weekday}`)}`}
                            className={cn(inputBase, "py-1.5 ps-2.5 pe-12")}
                            value={slot.duration_minutes || ""}
                            onChange={(e) => {
                              setLengthEdited(true);
                              updateSlot(slot.weekday, { duration_minutes: Number(e.target.value) });
                            }}
                          />
                          <span className="text-muted-foreground pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-xs">
                            {t("form.minutesShort")}
                          </span>
                        </div>
                        <button
                          type="button"
                          aria-label={tSched("removeSlot")}
                          onClick={() => toggleDay(slot.weekday)}
                          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive flex size-8 items-center justify-center rounded-lg transition-colors"
                        >
                          <X className="size-4" aria-hidden />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {/* Which clock the timetable keeps: the academy's, or the student's country. */}
                <ClockField
                  className="sm:max-w-md"
                  value={timezone}
                  slots={slots}
                  studentCountry={country || null}
                  studentTimezone={initialClock && country === initialCountry ? initialClock : null}
                  disabled={busy}
                  onChange={(tz, next) => {
                    setTimezone(tz);
                    setSlots(next);
                  }}
                />
                <p className="text-muted-foreground text-[11px]">{t("form.timetableStartsToday")}</p>
              </div>
            ))}
        </FormSection>
      )}

      {/* ── 3 · Billing ─────────────────────────────────────────────────────
          Only for an active student, and only for whoever may name a price. A role without
          `student.set_price` still gets to create the learner; billing is added later by
          someone who may price, rather than the whole card being denied to them.

          Package or monthly is the first question inside it, because it changes what every field
          below means. Picking package shows the very same fields as the packages screen and opens
          the package in this save — there is no second step on another page. */}
      {enrolling &&
        (canPrice ? (
          <FormSection
            icon={Wallet}
            title={t("form.billingTitle")}
            hint={onSubscription ? tSubs("studentForm.intro") : onPackage ? t("form.billingPackageIntro") : groupsOnly ? t("form.groupsOnlyIntro") : t("form.packageHint")}
            testId="billing-details"
          >
            {groupsOn && (
              <div className="space-y-2 rounded-xl border bg-background/60 p-3" data-testid="group-subs">
                <div>
                  <p className="text-sm font-semibold">{t("form.groupSubs")}</p>
                  <p className="text-muted-foreground text-xs">{t("form.groupSubsHint")}</p>
                </div>
                {groupPicks.length > 0 && (
                  <ul className="divide-y rounded-lg border bg-background" data-testid="group-subs-list">
                    {groupPicks.map((pick) => {
                      const g = groupOptions?.find((x) => x.id === pick.id);
                      const pr = g?.pricing ?? null;
                      const price = pr?.price_minor != null && pr.currency ? formatMoney({ amount: pr.price_minor, currency: pr.currency }, locale) : null;
                      const summary =
                        price === null
                          ? t("form.groupNoPrice")
                          : pr?.billing_mode === "MONTHLY" && pr.month_minutes
                            ? centre && g?.slots
                              ? t("form.groupPriceLessons", { price, lessons: monthLessons(pr.month_minutes, g.slots) })
                              : t("form.groupPrice", { price, hours: hoursText(pr.month_minutes) })
                            : pr?.billing_mode === "PER_LESSON"
                              ? t("form.groupPriceLesson", { price })
                              : pr?.billing_mode === "COURSE"
                                ? t("form.groupPriceCourse", { price })
                                : t("form.groupPriceMonthly", { price });
                      return (
                        <li key={pick.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm" data-testid={`group-sub-${pick.id}`}>
                          <span className="min-w-0 flex-1">
                            <span className="block font-medium">{g?.name ?? pick.id}</span>
                            <span className="text-muted-foreground block text-xs">{[g?.teacher_name, summary].filter(Boolean).join(" · ")}</span>
                          </span>
                          <label className="text-muted-foreground flex items-center gap-1.5 text-xs">
                            {t("form.groupFrom")}
                            <input
                              type="date"
                              className={cn(inputBase, "w-36 px-2 py-1 text-xs")}
                              value={pick.joinedOn}
                              min={g?.start_date}
                              onChange={(e) => setGroupPicks((prev) => prev.map((x) => (x.id === pick.id ? { ...x, joinedOn: e.target.value } : x)))}
                              data-testid={`group-sub-from-${pick.id}`}
                            />
                          </label>
                          <button type="button" onClick={() => setGroupPicks((prev) => prev.filter((x) => x.id !== pick.id))} className="text-muted-foreground hover:text-destructive text-xs">
                            {t("form.removeGroup")}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {/* Always under the list, full width: where the next group is added. */}
                <GroupSearchBox count={groupOptions?.length ?? 0} value={groupQuery} onChange={setGroupQuery} testId="group-subs-search" />
                <div className="relative">
                  <Plus className="text-primary pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2" aria-hidden />
                  <select
                    className={cn(inputBase, "border-primary/40 text-primary border-dashed py-2 ps-9 pe-3 text-sm font-medium")}
                    value=""
                    onChange={(e) => pickGroup(e.target.value)}
                    aria-label={t("form.pickGroup")}
                    disabled={groupOptions !== null && groupOptions.filter((g) => !groupIds.includes(g.id)).length === 0}
                    data-testid="group-subs-pick"
                  >
                    <option value="">
                      {groupOptions === null
                        ? "…"
                        : groupOptions.length === 0
                          ? t("form.noGroups")
                          : groupPicks.length === 0
                            ? t("form.addGroup")
                            : t("form.addAnotherGroup")}
                    </option>
                    {filterGroups(groupOptions ?? [], groupQuery)
                      .filter((g) => !groupIds.includes(g.id))
                      .map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                          {g.teacher_name ? ` · ${g.teacher_name}` : ""}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
            )}

            {centre && (subscriptionAvailable || groupsOnlyChoice) ? (
              <div className="space-y-1.5" data-testid="centre-private-choice">
                <p className="text-sm font-semibold">{t("form.privateTitle")}</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {groupsOnlyChoice && (
                    <ChoiceCard
                      icon={CalendarRange}
                      title={t("form.noPrivate")}
                      hint={t("form.noPrivateHint")}
                      selected={billing === "none"}
                      onSelect={() => setBilling("none")}
                      testId="billing-monthly"
                    />
                  )}
                  {subscriptionAvailable && (
                    <ChoiceCard
                      icon={Layers}
                      title={t("form.billingSubscription")}
                      hint={t("form.billingSubscriptionHint")}
                      selected={billing === "subscription"}
                      onSelect={() => setBilling("subscription")}
                      testId="billing-package"
                    />
                  )}
                </div>
              </div>
            ) : (packagesAvailable || groupsOnlyChoice) && (
              <div className="space-y-1.5">
                {groupsOnlyChoice && <p className="text-sm font-semibold">{t("form.privateTitle")}</p>}
                {/* A Quran academy sells packages first (Ahmed 2026-11-17): the package card leads. */}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {!centre && packagesAvailable && packageCard}
                  <ChoiceCard
                    icon={CalendarRange}
                    title={groupsOnlyChoice ? t("form.noPrivate") : t("form.billingMonthly")}
                    hint={groupsOnlyChoice ? t("form.noPrivateHint") : t("form.billingMonthlyHint")}
                    selected={billing === (groupsOnlyChoice ? "none" : "monthly")}
                    onSelect={() => setBilling(groupsOnlyChoice ? "none" : "monthly")}
                    testId="billing-monthly"
                  />
                  {packagesAvailable ? (
                    centre && packageCard
                  ) : (
                    <ChoiceCard
                      icon={Layers}
                      title={t("form.billingMonthly")}
                      hint={t("form.billingMonthlyHint")}
                      selected={billing === "monthly"}
                      onSelect={() => setBilling("monthly")}
                      testId="billing-hourly"
                    />
                  )}
                </div>
              </div>
            )}

            {onSubscription ? (
              <StudentSubscriptionFields
                draft={subscriptionDraft}
                links={teacherLinks.map((l) => ({ teacher_id: l.teacher_id, course: l.course.trim() || null }))}
                teachers={teachers}
                currency={guardianCurrency}
                idPrefix="new-student-sub"
              />
            ) : onPackage ? (
              <>
                <PackageTermsFields terms={terms} idPrefix="new-student-pkg" simple />
                <PaidFirstPackageField state={paidFirst} priceMinor={terms.priceMinor} idPrefix="new-student-pkg" />
              </>
            ) : groupsOnly ? null : (
              <MonthlyTermsFields terms={monthly} idPrefix="new-student-monthly" />
            )}
          </FormSection>
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
