"use client";

import { CalendarDays, Clock, Coins, GraduationCap, Link2, ListChecks, MapPin, Plus, StickyNote, Trash2, Users, Video, Wallet } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { useAuth } from "@/components/auth-provider";
import { fieldClass, hoursText, sortSlots, textareaClass, todayIn } from "@/components/groups/group-format";
import { StudentPicker } from "@/components/groups/student-picker";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { ApiError, listSpecializations, listTeachers, type Specialization, type TeacherRow } from "@/lib/api";
import { fetchRoster } from "@/lib/roster";
import { CURRENCIES } from "@/lib/countries";
import { formatMoney } from "@/lib/money";
import {
  createGroup,
  updateGroup,
  type GroupDetail,
  type GroupBillingMode,
  type GroupInput,
  type GroupMode,
  type GroupSlot,
  type GroupTeacherPayMode,
} from "@/lib/groups-api";
import { LessonPriceFields, lessonPriceFromTotal, lessonsIn, majorText, totalFromLessonPrice } from "@/components/packages/lesson-price-fields";
import { useAcademyDefaults } from "@/lib/academy-defaults";
import { LevelSelect } from "@/components/levels/level-select";
import { RoomSelect } from "@/components/rooms/room-select";
import { listRooms, type Room } from "@/lib/rooms-api";
import { getGroupDefaults } from "@/lib/group-defaults-api";
import { useCapability, useProfile } from "@/lib/capabilities";
import { cn } from "@/lib/utils";
import { useLevelWord } from "@/lib/levels";

/** A typed major-unit amount ("450", "12.5") → integer minor units; "" → null. */
export function toMinor(value: string): number | null {
  const n = Number.parseFloat(value.replace(",", "."));
  return value.trim() === "" || Number.isNaN(n) ? null : Math.round(n * 100);
}

/** Minor units → the major-unit text a form field shows. */
export function fromMinor(value: number | null | undefined): string {
  return value == null ? "" : String(value / 100);
}

const BILLING_MODES: GroupBillingMode[] = ["MONTHLY", "PER_LESSON", "COURSE"];
const PAY_MODES: Exclude<GroupTeacherPayMode, null>[] = ["PER_LESSON", "PER_HOUR", "PER_STUDENT", "REVENUE_SHARE"];
/** The lesson lengths a centre actually runs; anything else is typed under "Other". */
export const DURATION_PRESETS = [15, 20, 30, 40, 45, 60, 90, 120];

/** The first validation message an API refusal carries, else its message. */
export function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const errors = (err.body as { errors?: Record<string, string[]> } | undefined)?.errors;
    const first = errors ? Object.values(errors)[0]?.[0] : undefined;
    return first ?? err.message ?? fallback;
  }
  return fallback;
}

function Field({
  label,
  icon: Icon,
  required,
  hint,
  children,
}: {
  label: string;
  icon?: ComponentType<{ className?: string }>;
  required?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1.5 text-sm font-medium">
        {Icon && <Icon className="text-muted-foreground size-3.5" />}
        {label}
        {required && <span className="text-destructive">*</span>}
      </label>
      {children}
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
}

/**
 * One part of the form. A learning centre's look (`SessionAcademy.profile`) gives each part a card of
 * its own, headed by what it is about. Every other academy keeps the form it always had: no card, and
 * `plainClassName` is the plain bordered box the money and student parts already were.
 */
function FormSection({
  look,
  icon: Icon,
  tile,
  title,
  hint,
  titleEnd,
  plainClassName,
  testId,
  children,
}: {
  look: boolean;
  icon: ComponentType<{ className?: string }>;
  /** The icon tile's colours, in the centre's look. */
  tile: string;
  title: string;
  hint?: string;
  titleEnd?: ReactNode;
  plainClassName?: string;
  testId?: string;
  children: ReactNode;
}) {
  if (!look) {
    if (plainClassName === undefined) return <>{children}</>;
    return (
      <section className={plainClassName} data-testid={testId}>
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <Icon className="text-muted-foreground size-4" />
          {title}
          {titleEnd}
        </p>
        {children}
      </section>
    );
  }
  return (
    <section className="centre-surface bg-card rounded-2xl border p-4 sm:p-5" data-testid={testId}>
      <header className="mb-4 flex items-center gap-3">
        <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", tile)}>
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-x-2 text-base font-extrabold">
            {title}
            {titleEnd}
          </h3>
          {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
        </div>
      </header>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

const TILES = {
  violet: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  sky: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  pink: "bg-pink-100 text-pink-600 dark:bg-pink-500/15 dark:text-pink-300",
  slate: "bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300",
} as const;

/**
 * Create or edit a group: who teaches it, how many seats, online or in a room, its dates and its
 * weekly times. Saving regenerates its lessons server-side — future pending ones follow the edit,
 * held and past ones never move — which is what the hints under the timetable say in plain words.
 */
export function GroupForm({
  group,
  onSaved,
  onCancel,
}: {
  /** Absent = create. */
  group?: GroupDetail;
  onSaved: (group: GroupDetail) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("groups");
  const tTerm = useTranslations("courseTerm");
  const tRooms = useTranslations("rooms");
  const word = useLevelWord();
  const tw = useTranslations("scheduling");
  const locale = useLocale();
  const { can } = useAuth();
  const look = useProfile() === "CENTRE";
  const editing = group !== undefined;
  // Each half of the money is its own capability, and an edit only shows what the API showed us.
  const canPrice = can("student.set_price") && (!editing || group.pricing !== null);
  const canPay = can("teacher.set_pay") && (!editing || group.teacher_pay !== null);
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const [name, setName] = useState(group?.name ?? "");
  const [teacherId, setTeacherId] = useState(group?.teacher_id ?? "");
  const [specializationId, setSpecializationId] = useState(group?.specialization_id ?? "");
  const [level, setLevel] = useState(group?.level ?? "");
  // A centre's level comes from the academy's list (docs/centre-profile, Phase 2.1), not typed.
  const [levelId, setLevelId] = useState(group?.level_id ?? "");
  const [capacity, setCapacity] = useState(group?.capacity != null ? String(group.capacity) : "");
  // A centre's classes are in its rooms: a new group opens in person, so its room lands on the timetable.
  const centre = useCapability("centre");
  const [mode, setMode] = useState<GroupMode>(group?.mode ?? (centre ? "OFFLINE" : "ONLINE"));
  const [location, setLocation] = useState(group?.location ?? "");
  // A centre's room comes from its list (02-COHERENCE-AUDIT §3), not typed. A group still holding a
  // room typed before the list keeps that text until a room is picked.
  const [roomId, setRoomId] = useState(group?.room?.id ?? "");
  const legacyLocation = group?.room ? "" : (group?.location?.trim() ?? "");
  const [rooms, setRooms] = useState<Room[] | undefined>(undefined);
  const [meetingUrl, setMeetingUrl] = useState(group?.meeting_url ?? "");
  const [startDate, setStartDate] = useState(group?.start_date ?? todayIn(group?.timezone ?? browserTz));
  const [endDate, setEndDate] = useState(group?.end_date ?? "");
  // A centre's course promises a number of lessons (docs/centre-profile, Phase 2 §2).
  const [lessonsPlanned, setLessonsPlanned] = useState(group?.lessons_planned != null ? String(group.lessons_planned) : "");
  const [notes, setNotes] = useState(group?.notes ?? "");
  const [slots, setSlots] = useState<GroupSlot[]>(
    group?.slots.length ? group.slots : [{ weekday: 1, start_time_local: "17:00", duration_minutes: 60 }],
  );

  const [billingMode, setBillingMode] = useState<GroupBillingMode>(group?.pricing?.billing_mode ?? "MONTHLY");
  const [price, setPrice] = useState(fromMinor(group?.pricing?.price_minor));
  // The academy's own defaults (Settings → Academy) open the pickers; the form can still change them.
  const defaults = useAcademyDefaults();
  const [currency, setCurrency] = useState(group?.pricing?.currency ?? defaults.currency);
  const [chargeAbsent, setChargeAbsent] = useState(group?.pricing?.charge_absent ?? false);
  const [prorateJoin, setProrateJoin] = useState(group?.pricing?.prorate_join ?? true);
  // MONTHLY only: the hours one month buys. Empty = the calendar month (the way every group billed
  // before); set = the next month is raised once the group has held that many hours.
  const savedMonthMinutes = group?.pricing?.month_minutes ?? null;
  const [monthHours, setMonthHours] = useState(savedMonthMinutes != null ? hoursText(savedMonthMinutes) : "");
  // Hours group only: what a lesson counts against a student's hours when they are alone in it.
  const [soloMinutes, setSoloMinutes] = useState(group?.pricing?.solo_billed_minutes != null ? String(group.pricing.solo_billed_minutes) : "");
  // A centre counts a month in lessons and prices it by the lesson — 8 lessons × "40 minutes for 90"
  // — and the month's price is worked out (2026-10-25, lessons 2026-10-29). The length starts at the
  // group's own lesson length; the month is still kept in minutes (lessons × length).
  const [lessonMinutes, setLessonMinutes] = useState(group?.slots[0]?.duration_minutes ?? 60);
  const [monthLessons, setMonthLessons] = useState(() =>
    savedMonthMinutes != null ? String(lessonsIn(savedMonthMinutes, group?.slots[0]?.duration_minutes ?? 60)) : "",
  );
  /** What the month field holds — lessons in a centre, hours everywhere else. */
  const monthText = centre ? monthLessons : monthHours;
  const [lessonPrice, setLessonPrice] = useState(() => {
    const total = group?.pricing?.price_minor ?? null;
    const minutes = group?.pricing?.month_minutes ?? null;
    return total != null && minutes != null ? majorText(lessonPriceFromTotal(total, minutes, group?.slots[0]?.duration_minutes ?? 60)) : "";
  });
  const [payMode, setPayMode] = useState<GroupTeacherPayMode>(group?.teacher_pay?.mode ?? null);
  const [payAmount, setPayAmount] = useState(fromMinor(group?.teacher_pay?.amount_minor));
  // The amount was filled from the teacher's own hourly rate, not typed — so picking another
  // teacher may replace it, while a typed amount is never overwritten.
  const [payFromTeacher, setPayFromTeacher] = useState<number | null>(null);
  const [sharePct, setSharePct] = useState(
    group?.teacher_pay?.share_bp != null ? String(group.teacher_pay.share_bp / 100) : "",
  );
  // Create only: the students the class starts with.
  const [studentIds, setStudentIds] = useState<Set<string>>(new Set());

  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [subjects, setSubjects] = useState<Specialization[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchRoster(listTeachers, { filter: { status: "active" } })
      .then((res) => setTeachers(res.rows))
      .catch(() => setTeachers([]));
    void listSpecializations()
      .then((res) => setSubjects(res.specializations.filter((s) => s.is_active)))
      .catch(() => setSubjects([]));
  }, []);

  // Create only, a centre only: its group defaults (Settings) fill whatever nobody has touched yet.
  // They arrive after the form is on screen, so what was already typed or picked is kept.
  const touched = useRef(new Set<string>());
  useEffect(() => {
    if (!centre || editing) return;
    let live = true;
    void getGroupDefaults()
      .then(({ defaults: d }) => {
        if (!live) return;
        const open = (field: string) => !touched.current.has(field);
        if (d.mode && open("mode")) setMode(d.mode);
        const minutes = d.lesson_minutes;
        if (minutes) {
          if (open("duration")) setSlots((prev) => prev.map((s) => ({ ...s, duration_minutes: minutes })));
          if (open("lessonMinutes")) setLessonMinutes(minutes);
        }
        if (canPrice) {
          if (d.billing_mode && open("billing")) setBillingMode(d.billing_mode);
          if (d.month_lessons && open("monthLessons")) setMonthLessons(String(d.month_lessons));
        }
        if (canPay && d.teacher_pay_mode && open("pay")) {
          setPayMode(d.teacher_pay_mode);
          setPayFromTeacher(null);
          if (d.teacher_pay_mode === "REVENUE_SHARE") setSharePct(d.teacher_share_bp != null ? String(d.teacher_share_bp / 100) : "");
          else setPayAmount(fromMinor(d.teacher_pay_minor));
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!centre) return;
    void listRooms()
      .then((res) => setRooms(res.rooms))
      .catch(() => setRooms([]));
  }, [centre]);

  // An edit can be opened on a group whose teacher has since been deactivated: keep them pickable.
  const teacherOptions = useMemo(() => {
    const options = teachers.map((r) => ({ value: r.id, label: r.full_name }));
    if (group && !teachers.some((o) => o.id === group.teacher_id)) {
      return [{ value: group.teacher_id, label: group.teacher_name ?? "—" }, ...options];
    }
    return options;
  }, [teachers, group]);

  // Picking a teacher brings their own hourly rate into "what the teacher earns" — per hour, as a
  // starting point the desk can change. Only when nothing was typed there yet.
  useEffect(() => {
    if (!canPay || !teacherId) return;
    const teacher = teachers.find((r) => r.id === teacherId);
    const rate = teacher?.session_rate_minor ?? null;
    const untouched = payAmount === "" || (payFromTeacher !== null && payAmount === fromMinor(payFromTeacher));
    if (rate === null || rate <= 0 || !untouched || (payMode !== null && payMode !== "PER_HOUR")) return;
    setPayMode("PER_HOUR");
    setPayAmount(fromMinor(rate));
    setPayFromTeacher(rate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teacherId, teachers, canPay]);
  const payTeacherCurrency = teachers.find((r) => r.id === teacherId)?.currency ?? group?.teacher_pay?.currency ?? "EGP";

  const weekdays = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ value: d, label: tw(`weekday.${d}`) }));

  function updateSlot(i: number, patch: Partial<GroupSlot>) {
    setSlots((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  }

  function validate(): string | null {
    if (!name.trim()) return t("form.errors.name");
    if (!teacherId) return t("form.errors.teacher");
    if (!startDate) return t("form.errors.startDate");
    if (endDate && endDate < startDate) return t("form.errors.endDate");
    if (lessonsPlanned && (!Number.isInteger(Number(lessonsPlanned)) || Number(lessonsPlanned) < 1)) return tTerm("renew.errors.lessons");
    if (slots.length === 0) return t("form.errors.slots");
    const keys = slots.map((s) => `${s.weekday}|${s.start_time_local}`);
    if (new Set(keys).size !== keys.length) return t("form.errors.duplicateSlot");
    if (slots.some((s) => !s.start_time_local || s.duration_minutes < 1 || s.duration_minutes > 600)) {
      return t("form.errors.slotInvalid");
    }
    if (capacity && (!Number.isInteger(Number(capacity)) || Number(capacity) < 1)) return t("form.errors.capacity");
    if (canPrice && price.trim() !== "" && (toMinor(price) ?? -1) < 0) return t("form.errors.price");
    if (canPrice && byLesson() && lessonPrice.trim() !== "" && (toMinor(lessonPrice) ?? -1) < 0) return t("form.errors.price");
    if (canPrice && billingMode === "MONTHLY" && monthText.trim() !== "" && monthMinutes() === null) {
      return t("form.errors.monthHours");
    }
    if (canPrice && soloMinutes.trim() !== "" && (!Number.isInteger(Number(soloMinutes)) || Number(soloMinutes) < 1 || Number(soloMinutes) > 600)) {
      return t("form.errors.slotInvalid");
    }
    if (canPay && payMode !== null && payMode !== "REVENUE_SHARE" && toMinor(payAmount) === null) return t("form.errors.payAmount");
    if (canPay && payMode === "REVENUE_SHARE") {
      const pct = Number.parseFloat(sharePct);
      if (Number.isNaN(pct) || pct < 0 || pct > 100) return t("form.errors.share");
    }
    return null;
  }

  /** A centre's month of hours, priced by the lesson. */
  function byLesson(): boolean {
    return centre && billingMode === "MONTHLY" && monthMinutes() !== null;
  }

  /** What a month costs: the typed price — or, priced by the lesson, the lesson × the month's hours. */
  function priceMinor(): number | null {
    if (!byLesson()) return toMinor(price);
    const unit = toMinor(lessonPrice);
    return unit === null ? null : totalFromLessonPrice(unit, monthMinutes() ?? 0, lessonMinutes);
  }

  /** The typed month → minutes (a centre's lessons × their length, or hours); null when empty or not a positive number. */
  function monthMinutes(): number | null {
    if (centre) {
      const n = Number.parseFloat(monthLessons.replace(",", "."));
      if (monthLessons.trim() === "" || Number.isNaN(n) || n <= 0 || n > 500) return null;
      return Math.round(n * lessonMinutes);
    }
    const h = Number.parseFloat(monthHours.replace(",", "."));
    if (monthHours.trim() === "" || Number.isNaN(h) || h <= 0 || h > 1000) return null;
    return Math.round(h * 60);
  }

  async function submit() {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }

    const input: GroupInput = {
      name: name.trim(),
      teacher_id: teacherId,
      specialization_id: specializationId || null,
      // A centre picks from its list and the server names the text; everyone else types the text.
      ...(centre ? { level_id: levelId || null } : { level: level.trim() || null }),
      capacity: capacity ? Number(capacity) : null,
      mode,
      // A centre picks a room from its list and the server names the text; everyone else types it.
      ...(centre
        ? {
            room_id: mode === "OFFLINE" ? roomId || null : null,
            location: mode === "OFFLINE" && !roomId ? legacyLocation || null : null,
          }
        : { location: mode === "OFFLINE" ? location.trim() || null : null }),
      meeting_url: mode === "ONLINE" ? meetingUrl.trim() || null : null,
      start_date: startDate,
      end_date: endDate || null,
      ...(centre ? { lessons_planned: lessonsPlanned ? Number(lessonsPlanned) : null } : {}),
      notes: notes.trim() || null,
      slots: sortSlots(slots),
      ...(!editing && studentIds.size > 0 ? { student_ids: [...studentIds] } : {}),
      ...(canPrice
        ? {
            billing_mode: billingMode,
            price_minor: priceMinor(),
            currency: currency || null,
            charge_absent: billingMode === "PER_LESSON" && chargeAbsent,
            prorate_join: prorateJoin,
            month_minutes: billingMode === "MONTHLY" ? monthMinutes() : null,
            solo_billed_minutes: billingMode === "MONTHLY" && monthMinutes() !== null && soloMinutes.trim() !== "" ? Number(soloMinutes) : null,
          }
        : {}),
      ...(canPay
        ? {
            teacher_pay_mode: payMode,
            teacher_pay_minor: payMode !== null && payMode !== "REVENUE_SHARE" ? toMinor(payAmount) : null,
            teacher_share_bp: payMode === "REVENUE_SHARE" ? Math.round(Number.parseFloat(sharePct) * 100) : null,
          }
        : {}),
    };

    setBusy(true);
    setError(null);
    try {
      const res = editing ? await updateGroup(group.id, input) : await createGroup(input);
      onSaved(res.group);
    } catch (err) {
      setError(apiErrorMessage(err, t("form.errors.save")));
    } finally {
      setBusy(false);
    }
  }

  const sections = (
    <>
      <FormSection look={look} icon={Users} tile={TILES.violet} title={t("form.sections.basics")} hint={t("form.sections.basicsHint")}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label={t("form.name")} icon={Users} required>
            <input
              className={fieldClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("form.namePlaceholder")}
              maxLength={120}
              data-testid="group-name"
            />
          </Field>
        </div>

        <Field label={t("form.teacher")} icon={GraduationCap} required>
          <Combobox
            options={teacherOptions}
            value={teacherId}
            onChange={setTeacherId}
            placeholder={t("form.teacherPlaceholder")}
            searchPlaceholder={t("form.search")}
            data-testid="group-teacher"
          />
        </Field>

        <Field label={t("form.subject")}>
          <select
            className={fieldClass}
            value={specializationId}
            onChange={(e) => setSpecializationId(e.target.value)}
            data-testid="group-subject"
          >
            <option value="">{t("form.noSubject")}</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t("form.level", { word })}>
          {centre ? (
            <LevelSelect value={levelId} onChange={setLevelId} withAddLink testId="group-level" />
          ) : (
            <input
              className={fieldClass}
              value={level}
              onChange={(e) => setLevel(e.target.value)}
              placeholder={t("form.levelPlaceholder")}
              maxLength={60}
            />
          )}
        </Field>

        <Field label={t("form.capacity")} hint={t("form.capacityHint")}>
          <input
            className={fieldClass}
            type="number"
            inputMode="numeric"
            min={1}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            placeholder={t("form.capacityPlaceholder")}
            data-testid="group-capacity"
          />
        </Field>
      </div>

      </FormSection>

      {/* Where the class happens. */}
      <FormSection look={look} icon={MapPin} tile={TILES.sky} title={t("form.sections.place")} hint={t("form.sections.placeHint")}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("form.mode")}>
          {(["ONLINE", "OFFLINE"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => {
                touched.current.add("mode");
                setMode(m);
              }}
              className={cn(
                "rounded-xl border px-3 py-2 text-sm font-medium transition-colors",
                look && "flex items-center gap-3 p-3 text-start",
                mode === m ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted",
              )}
            >
              {look ? (
                <>
                  {m === "ONLINE" ? <Video className="size-5 shrink-0" aria-hidden /> : <MapPin className="size-5 shrink-0" aria-hidden />}
                  <span className="min-w-0">
                    <span className="block font-bold">{t(`mode.${m}`)}</span>
                    <span className="text-muted-foreground block text-xs font-normal">{t(`form.sections.modeHint${m}`)}</span>
                  </span>
                </>
              ) : (
                t(`mode.${m}`)
              )}
            </button>
          ))}
        </div>
        {mode === "ONLINE" ? (
          <Field label={t("form.meetingUrl")} icon={Link2} hint={t("form.meetingUrlHint")}>
            <input
              className={fieldClass}
              type="url"
              dir="ltr"
              value={meetingUrl}
              onChange={(e) => setMeetingUrl(e.target.value)}
              placeholder="https://"
            />
          </Field>
        ) : centre ? (
          <Field label={tRooms("select.label")} icon={MapPin} hint={!roomId && legacyLocation ? tRooms("legacyText", { text: legacyLocation }) : undefined}>
            <RoomSelect value={roomId} onChange={setRoomId} rooms={rooms} withAddLink testId="group-room" />
          </Field>
        ) : (
          <Field label={t("form.location")} icon={MapPin}>
            <input
              className={fieldClass}
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder={t("form.locationPlaceholder")}
              maxLength={200}
            />
          </Field>
        )}
      </div>

      </FormSection>

      <FormSection look={look} icon={CalendarDays} tile={TILES.amber} title={t("form.sections.schedule")} hint={t("form.sections.scheduleHint")}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t("form.startDate")} icon={CalendarDays} required hint={t("form.startDateHint")}>
          <input
            className={fieldClass}
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            data-testid="group-start"
          />
        </Field>
        <Field label={t("form.endDate")} icon={CalendarDays} hint={t("form.endDateHint")}>
          <input
            className={fieldClass}
            type="date"
            value={endDate}
            min={startDate || undefined}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </Field>
        {centre && (
          <Field label={tTerm("plannedLessons")} icon={ListChecks} hint={tTerm("plannedLessonsHint")}>
            <input
              className={fieldClass}
              type="number"
              inputMode="numeric"
              min={1}
              value={lessonsPlanned}
              onChange={(e) => setLessonsPlanned(e.target.value)}
              data-testid="group-lessons-planned"
            />
          </Field>
        )}
      </div>

      {/* The weekly timetable. */}
      <div className="space-y-2">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Clock className="text-muted-foreground size-3.5" />
          {t("form.slots")}
          <span className="text-destructive">*</span>
        </p>
        {look && (
          <div className="text-muted-foreground hidden gap-2 px-2 text-xs font-semibold sm:grid sm:grid-cols-[minmax(0,1fr)_8rem_minmax(7rem,auto)_1.75rem]" aria-hidden>
            <span>{tw("weekdayLabel")}</span>
            <span>{tw("startTime")}</span>
            <span>{tw("duration")}</span>
            <span />
          </div>
        )}
        <ul className="space-y-2">
          {slots.map((s, i) => (
            <li
              key={i}
              className={cn(
                "grid grid-cols-1 gap-2 rounded-xl border p-2 sm:items-center",
                look ? "bg-muted/40 sm:grid-cols-[minmax(0,1fr)_8rem_minmax(7rem,auto)_1.75rem]" : "sm:grid-cols-[1fr_auto_auto_auto]",
              )}
              data-testid="group-slot"
            >
              <select
                className={fieldClass}
                value={s.weekday}
                onChange={(e) => updateSlot(i, { weekday: Number(e.target.value) })}
                aria-label={tw("weekdayLabel")}
              >
                {weekdays.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
              <input
                className={cn(fieldClass, "sm:w-32")}
                type="time"
                value={s.start_time_local}
                onChange={(e) => updateSlot(i, { start_time_local: e.target.value })}
                aria-label={tw("startTime")}
              />
              <DurationField
                value={s.duration_minutes}
                onChange={(minutes) => {
                  touched.current.add("duration");
                  updateSlot(i, { duration_minutes: minutes });
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setSlots((prev) => prev.filter((_, j) => j !== i))}
                aria-label={tw("removeSlot")}
                disabled={slots.length === 1}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() =>
            setSlots((prev) => [
              ...prev,
              {
                weekday: ((prev[prev.length - 1]?.weekday ?? 0) + 2) % 7,
                start_time_local: prev[prev.length - 1]?.start_time_local ?? "17:00",
                duration_minutes: prev[prev.length - 1]?.duration_minutes ?? 60,
              },
            ])
          }
          data-testid="group-add-slot"
        >
          <Plus className="size-3.5" />
          {tw("addSlot")}
        </Button>
        <p className="text-muted-foreground text-xs">{editing ? t("form.slotsEditHint") : t("form.slotsHint")}</p>
      </div>
      </FormSection>

      {canPrice && (
        <FormSection
          look={look}
          icon={Wallet}
          tile={TILES.emerald}
          title={t("money.studentPays")}
          hint={t("form.sections.pricingHint")}
          plainClassName="space-y-3 rounded-xl border p-3"
          testId="group-pricing"
        >
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup" aria-label={t("money.billingMode")}>
            {BILLING_MODES.map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={billingMode === m}
                onClick={() => {
                  touched.current.add("billing");
                  setBillingMode(m);
                }}
                className={cn(
                  "rounded-xl border px-3 py-2 text-start text-sm transition-colors",
                  billingMode === m ? "border-primary bg-primary/10" : "hover:bg-muted",
                )}
                data-testid={`billing-${m}`}
              >
                <span className="block font-medium">{t(`money.mode.${m}`)}</span>
                <span className="text-muted-foreground block text-xs">{t(`money.modeHint.${m}`)}</span>
              </button>
            ))}
          </div>
          {centre && billingMode === "MONTHLY" ? (
            <div className="space-y-3" data-testid="group-pricing-centre">
              <Field label={t("money.monthLessons")} icon={Clock} hint={monthLessons.trim() ? t("money.monthLessonsOnHint", { lessons: monthLessons.trim() }) : t("money.monthLessonsHint")}>
                <input
                  className={cn(fieldClass, "sm:w-40")}
                  inputMode="numeric"
                  value={monthLessons}
                  onChange={(e) => {
                    touched.current.add("monthLessons");
                    setMonthLessons(e.target.value);
                  }}
                  placeholder={t("money.monthHoursPlaceholder")}
                  data-testid="group-month-lessons"
                />
              </Field>
              {monthMinutes() !== null ? (
                <LessonPriceFields
                  unitMinutes={lessonMinutes}
                  onUnitMinutes={(minutes) => {
                    touched.current.add("lessonMinutes");
                    setLessonMinutes(minutes);
                  }}
                  unitPrice={lessonPrice}
                  onUnitPrice={setLessonPrice}
                  totalMinutes={monthMinutes()}
                  currency={currency}
                  idPrefix="group-lesson"
                />
              ) : (
                <Field label={t(`money.priceLabel.${billingMode}`)} hint={t("money.priceHint")}>
                  <input
                    className={fieldClass}
                    inputMode="decimal"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder={t("money.pricePlaceholder")}
                    data-testid="group-price"
                  />
                </Field>
              )}
              <Field label={t("money.currency")} hint={t("money.currencyHint")}>
                <Combobox
                  options={[{ value: "", label: t("money.academyCurrency") }, ...CURRENCIES.map((c) => ({ value: c.code, label: c.code, sublabel: c.name }))]}
                  value={currency}
                  onChange={setCurrency}
                  placeholder={t("money.academyCurrency")}
                  searchPlaceholder={t("form.search")}
                />
              </Field>
            </div>
          ) : (
          <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t(`money.priceLabel.${billingMode}`)} hint={t("money.priceHint")}>
              <input
                className={fieldClass}
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder={t("money.pricePlaceholder")}
                data-testid="group-price"
              />
            </Field>
            <Field label={t("money.currency")} hint={t("money.currencyHint")}>
              <Combobox
                options={[{ value: "", label: t("money.academyCurrency") }, ...CURRENCIES.map((c) => ({ value: c.code, label: c.code, sublabel: c.name }))]}
                value={currency}
                onChange={setCurrency}
                placeholder={t("money.academyCurrency")}
                searchPlaceholder={t("form.search")}
              />
            </Field>
          </div>
          {billingMode === "MONTHLY" && (
            <Field label={t("money.monthHours")} icon={Clock} hint={monthHours.trim() ? t("money.monthHoursOnHint", { hours: monthHours.trim() }) : t("money.monthHoursHint")}>
              <input
                className={cn(fieldClass, "sm:w-40")}
                inputMode="decimal"
                value={monthHours}
                onChange={(e) => setMonthHours(e.target.value)}
                placeholder={t("money.monthHoursPlaceholder")}
                data-testid="group-month-hours"
              />
            </Field>
          )}
          </>
          )}
          {billingMode === "MONTHLY" && monthMinutes() !== null && (
            <Field label={t("money.soloMinutes")} icon={Users} hint={t("money.soloMinutesHint")}>
              <div className="flex items-center gap-1.5">
                <input
                  className={cn(fieldClass, "w-28")}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={600}
                  value={soloMinutes}
                  onChange={(e) => setSoloMinutes(e.target.value)}
                  placeholder={String(slots[0]?.duration_minutes ?? 60)}
                  data-testid="group-solo-minutes"
                />
                <span className="text-muted-foreground text-xs">{t("form.minutes")}</span>
              </div>
            </Field>
          )}
          {billingMode === "MONTHLY" && editing && (savedMonthMinutes === null) !== (monthText.trim() === "") && (
            <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              {t("money.monthHoursSwitchHint")}
            </p>
          )}
          {billingMode === "MONTHLY" && monthText.trim() === "" && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={prorateJoin} onChange={(e) => setProrateJoin(e.target.checked)} />
              {t("money.prorateJoin")}
            </label>
          )}
          {billingMode === "PER_LESSON" && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={chargeAbsent} onChange={(e) => setChargeAbsent(e.target.checked)} />
              {t("money.chargeAbsent")}
            </label>
          )}
          {editing && <p className="text-muted-foreground text-xs">{t("money.forwardOnly")}</p>}
        </FormSection>
      )}

      {canPay && (
        <FormSection
          look={look}
          icon={Coins}
          tile={TILES.pink}
          title={t("money.teacherEarns")}
          hint={t("form.sections.teacherHint")}
          plainClassName="space-y-3 rounded-xl border p-3"
          testId="group-teacher-pay"
        >
          <select
            className={fieldClass}
            value={payMode ?? ""}
            onChange={(e) => {
              touched.current.add("pay");
              setPayMode((e.target.value || null) as GroupTeacherPayMode);
            }}
            aria-label={t("money.teacherEarns")}
            data-testid="group-pay-mode"
          >
            <option value="">{t("money.payMode.DEFAULT")}</option>
            {PAY_MODES.map((m) => (
              <option key={m} value={m}>
                {t(`money.payMode.${m}`)}
              </option>
            ))}
          </select>
          {payMode !== null && payMode !== "REVENUE_SHARE" && (
            <Field
              label={t(`money.payAmount.${payMode}`)}
              hint={
                payMode === "PER_HOUR" && payFromTeacher !== null && payAmount === fromMinor(payFromTeacher)
                  ? t("money.rateFromTeacher", { rate: formatMoney({ amount: payFromTeacher, currency: payTeacherCurrency }, locale) })
                  : t("money.payCurrencyHint")
              }
            >
              <input className={fieldClass} inputMode="decimal" value={payAmount}
                onChange={(e) => {
                  touched.current.add("pay");
                  setPayAmount(e.target.value);
                }}
                data-testid="group-pay-amount"
              />
            </Field>
          )}
          {payMode === "REVENUE_SHARE" && (
            <Field label={t("money.sharePct")} hint={t("money.shareHint")}>
              <input className={fieldClass} inputMode="decimal" value={sharePct}
                onChange={(e) => {
                  touched.current.add("pay");
                  setSharePct(e.target.value);
                }}
                placeholder="50"
                data-testid="group-share"
              />
            </Field>
          )}
          <p className="text-muted-foreground text-xs">{t(`money.payModeHint.${payMode ?? "DEFAULT"}`)}</p>
        </FormSection>
      )}

      {!editing && (
        <FormSection
          look={look}
          icon={Users}
          tile={TILES.sky}
          title={t("form.students")}
          hint={t("form.sections.studentsHint")}
          titleEnd={studentIds.size > 0 ? <span className="text-muted-foreground text-xs font-normal">· {t("members.picked", { count: studentIds.size })}</span> : undefined}
          plainClassName="space-y-2 rounded-xl border p-3"
          testId="group-students"
        >
          <StudentPicker
            picked={studentIds}
            onToggle={(id) =>
              setStudentIds((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
          />
          <p className="text-muted-foreground text-xs">{t("form.studentsHint")}</p>
        </FormSection>
      )}

      <FormSection look={look} icon={StickyNote} tile={TILES.slate} title={t("form.sections.notes")}>
      <Field label={t("form.notes")}>
        <textarea className={textareaClass} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
      </Field>
      </FormSection>
    </>
  );

  // What the form adds up to so far, beside it on a wide screen.
  const summaryPrice = canPrice ? priceMinor() : null;
  const placeText = centre ? (rooms?.find((r) => r.id === roomId)?.name ?? (roomId ? (group?.room?.name ?? "") : legacyLocation)) : location.trim();
  const summaryRows: { key: string; icon: ComponentType<{ className?: string }>; text: string; muted?: boolean }[] = [
    {
      key: "teacher",
      icon: GraduationCap,
      text: teacherOptions.find((o) => o.value === teacherId)?.label ?? t("form.sections.summaryTeacher"),
      muted: !teacherId,
    },
    {
      key: "place",
      icon: mode === "ONLINE" ? Video : MapPin,
      text: mode === "OFFLINE" && placeText ? placeText : t(`mode.${mode}`),
    },
    {
      key: "seats",
      icon: Users,
      text: [
        capacity ? t("form.sections.summarySeats", { count: capacity }) : t("form.sections.summaryNoSeats"),
        studentIds.size > 0 ? t("members.picked", { count: studentIds.size }) : null,
      ]
        .filter(Boolean)
        .join(" · "),
    },
  ];

  return (
    <div className={look ? "group-form--centre space-y-4" : "space-y-5"} data-testid="group-form">
      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}

      {look ? (
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_15rem] lg:items-start lg:gap-4">
          <div className="min-w-0 space-y-4">{sections}</div>
          <aside className="centre-surface bg-card sticky top-0 hidden rounded-2xl border p-4 lg:block" data-testid="group-form-summary">
            <h3 className="text-muted-foreground text-xs font-bold">{t("form.sections.summary")}</h3>
            <p className={cn("mt-1 text-base leading-snug font-extrabold break-words", !name.trim() && "text-muted-foreground font-medium")}>
              {name.trim() || t("form.sections.summaryName")}
            </p>
            <ul className="mt-3 space-y-2.5 border-t pt-3 text-sm">
              {summaryRows.map(({ key, icon: Icon, text, muted }) => (
                <li key={key} className="flex items-start gap-2">
                  <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
                  <span className={cn("min-w-0 break-words", muted && "text-muted-foreground")}>{text}</span>
                </li>
              ))}
              {sortSlots(slots).map((slot) => (
                <li key={`${slot.weekday}-${slot.start_time_local}`} className="flex items-start gap-2">
                  <Clock className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
                  <span className="min-w-0">
                    {tw(`weekday.${slot.weekday}`)} · {slot.start_time_local} · {slot.duration_minutes} {t("form.minutes")}
                  </span>
                </li>
              ))}
            </ul>
            {canPrice && (
              <div className="mt-3 border-t pt-3">
                <p className="text-muted-foreground text-xs">{t(`money.priceLabel.${billingMode}`)}</p>
                <p className="mt-0.5 text-lg font-extrabold tabular-nums">
                  {summaryPrice !== null && summaryPrice > 0
                    ? formatMoney({ amount: summaryPrice, currency: currency || defaults.currency }, locale, { trimZeroDecimals: true })
                    : t("form.sections.summaryNoPrice")}
                </p>
              </div>
            )}
          </aside>
        </div>
      ) : (
        sections
      )}

      <div
        className={cn(
          "flex items-center justify-end gap-2",
          look ? "group-form__bar bg-card sticky bottom-0 z-10 rounded-2xl border p-3" : "border-t pt-4",
        )}
      >
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          {t("form.cancel")}
        </Button>
        <Button type="button" onClick={() => void submit()} disabled={busy} data-testid="group-save">
          {busy ? t("form.saving") : editing ? t("form.saveChanges") : t("form.create")}
        </Button>
      </div>
    </div>
  );
}

/**
 * A lesson's length: the lengths a centre runs as a list, "Other" for anything else. A saved length
 * that is not on the list opens as "Other" with its number, so nothing is silently rounded.
 */
function DurationField({ value, onChange }: { value: number; onChange: (minutes: number) => void }) {
  const t = useTranslations("groups");
  const tw = useTranslations("scheduling");
  const [chosenOther, setOther] = useState(() => !DURATION_PRESETS.includes(value));
  // A length that arrives later (the centre's default) and is off the list still reads as "Other".
  const other = chosenOther || !DURATION_PRESETS.includes(value);

  return (
    <div className="flex items-center gap-1.5">
      <select
        className={cn(fieldClass, "w-28")}
        value={other ? "other" : String(value)}
        onChange={(e) => {
          if (e.target.value === "other") {
            setOther(true);
            return;
          }
          setOther(false);
          onChange(Number(e.target.value));
        }}
        aria-label={tw("duration")}
        data-testid="group-duration"
      >
        {DURATION_PRESETS.map((m) => (
          <option key={m} value={m}>
            {m} {t("form.minutes")}
          </option>
        ))}
        <option value="other">{t("form.durationOther")}</option>
      </select>
      {other && (
        <input
          className={cn(fieldClass, "w-20")}
          type="number"
          min={1}
          max={600}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={tw("duration")}
          data-testid="group-duration-other"
        />
      )}
    </div>
  );
}
