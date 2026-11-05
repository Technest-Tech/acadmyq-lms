"use client";

import {
  AlarmClock,
  BellRing,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleStop,
  History,
  Layers,
  Loader2,
  MessageCircle,
  Phone,
  RefreshCw,
  Rocket,
  Search,
  User,
  Users2,
  WifiOff,
  X,
  type LucideIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { GroupAssignment, useReminderError } from "@/components/lesson-reminders/group-assignment";
import { SectionCard } from "@/components/settings/section-card";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import {
  getLessonReminders,
  launchLessonReminders,
  listReminderAssignments,
  listReminderGroups,
  listReminderLog,
  stopLessonReminders,
  updateLessonReminderSettings,
  type LessonReminderChoices,
  type LessonReminderSettings,
  type LessonRemindersOverview,
  type ReminderAudience,
  type ReminderChannel,
  type ReminderGroupOption,
  type ReminderLogRow,
  type ReminderPerson,
  type ReminderPersonKind,
} from "@/lib/lesson-reminders-api";
import { formatDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";

const selectClass =
  "border-input bg-background focus:border-primary focus:ring-primary/20 h-10 w-full rounded-xl border px-3 text-sm outline-none transition-all focus:ring-2 disabled:opacity-50";

const CHANNELS: ReadonlyArray<{ key: ReminderChannel; icon: LucideIcon }> = [
  { key: "GROUPS", icon: Users2 },
  { key: "PRIVATE", icon: User },
  { key: "BOTH", icon: Layers },
];
const AUDIENCES: readonly ReminderAudience[] = ["BOTH", "STUDENTS", "TEACHERS"];

const usesGroups = (c: LessonReminderChoices) => c.channel !== "PRIVATE";
const usesPrivate = (c: LessonReminderChoices) => c.channel !== "GROUPS";
const reachesStudents = (c: LessonReminderChoices) => c.audience !== "TEACHERS";
const reachesTeachers = (c: LessonReminderChoices) => c.audience !== "STUDENTS";

function choicesOf(s: LessonReminderSettings): LessonReminderChoices {
  return { lead_minutes: s.lead_minutes, at_start: s.at_start, language: s.language, channel: s.channel, audience: s.audience };
}

function sameChoices(a: LessonReminderChoices, b: LessonReminderChoices): boolean {
  return (
    a.lead_minutes === b.lead_minutes &&
    a.at_start === b.at_start &&
    a.language === b.language &&
    a.channel === b.channel &&
    a.audience === b.audience
  );
}

/** Whether anybody would get a reminder with these choices — the same test the API runs before a launch. */
function reachable(o: LessonRemindersOverview, c: LessonReminderChoices): boolean {
  const groups =
    usesGroups(c) &&
    ((reachesStudents(c) && o.assigned.students.assigned + (o.assigned.classes?.assigned ?? 0) > 0) ||
      (reachesTeachers(c) && o.assigned.teachers.assigned > 0));
  const phones =
    usesPrivate(c) &&
    ((reachesStudents(c) && o.phones.students.with_phone > 0) || (reachesTeachers(c) && o.phones.teachers.with_phone > 0));
  return groups || phones;
}

/**
 * The lesson reminders on the academy's WhatsApp page (`whatsapp.group_reminders`, off until a Super
 * Admin turns it on for the client). The academy chooses how they travel (its WhatsApp groups, a
 * private message to each number, or both), to whom, and when — then launches them. Nothing is sent
 * before the launch. Sending is the API's, on the scheduler.
 *
 * `connectionVersion` changes when the number above links or drops, so the readiness list follows.
 */
export function LessonRemindersManager({ connectionVersion = 0 }: { connectionVersion?: number }) {
  const t = useTranslations("settings.lessonReminders");
  const toast = useToast();
  const describe = useReminderError();
  const { can } = useAuth();
  const canEdit = can("settings.manage");
  const [overview, setOverview] = useState<LessonRemindersOverview | null>(null);
  const [form, setForm] = useState<LessonReminderChoices | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "launch" | "stop" | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await getLessonReminders();
      setOverview(next);
      // Unsaved choices survive a refresh of the counts.
      setForm((current) => current ?? choicesOf(next.settings));
    } catch (err) {
      setError(describe(err));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `describe` only formats.
  }, []);

  useEffect(() => {
    void load();
  }, [load, connectionVersion]);

  if (overview === null || form === null) {
    return error ? (
      <AlertBanner variant="error" message={error} />
    ) : (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-primary size-6 animate-spin" aria-hidden />
      </div>
    );
  }

  const connected = overview.whatsapp.state === "connected";
  const dirty = !sameChoices(form, choicesOf(overview.settings));

  function applied(settings: LessonReminderSettings) {
    setOverview((current) => (current ? { ...current, settings } : current));
    setForm(choicesOf(settings));
  }

  async function save(): Promise<boolean> {
    if (!form) return false;
    setBusy("save");
    setError(null);
    try {
      applied((await updateLessonReminderSettings(form)).settings);
      void load();
      return true;
    } catch (err) {
      setError(describe(err));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function launch() {
    // The launch sends what is on screen, so unsaved choices are saved first.
    if (dirty && !(await save())) return;
    setBusy("launch");
    setError(null);
    try {
      applied((await launchLessonReminders()).settings);
      toast.success(t("launch.launched"));
      void load();
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(null);
    }
  }

  async function stop() {
    setBusy("stop");
    setError(null);
    try {
      applied((await stopLessonReminders()).settings);
      toast.success(t("launch.stopped"));
      void load();
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6" data-testid="lesson-reminders">
      {!connected && overview.settings.live && (
        <div
          className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm"
          data-testid="reminders-not-connected"
        >
          <WifiOff className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden />
          <div className="min-w-0">
            <p className="font-semibold">{t("notConnectedTitle")}</p>
            <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">{t("notConnectedBody")}</p>
          </div>
        </div>
      )}

      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}

      <LaunchCard overview={overview} form={form} canEdit={canEdit} busy={busy} onLaunch={() => void launch()} onStop={() => void stop()} />

      <SetupCard overview={overview} form={form} onChange={setForm} canEdit={canEdit} dirty={dirty} saving={busy === "save"} onSave={() => void save()} />

      {usesGroups(form) && (
        <AssignCard
          connected={connected}
          canEditStudents={can("student.update")}
          canEditTeachers={can("teacher.update")}
          canSeeTeachers={can("teacher.read")}
          canEditClasses={overview.assigned.classes !== null && can("group.manage")}
          onChanged={load}
        />
      )}

      {usesPrivate(form) && <PrivateReachCard overview={overview} form={form} />}

      <Summary overview={overview} />
      <LogCard timezone={overview.timezone} />
    </div>
  );
}

/** The state of the reminders and the one button that starts or stops them. */
function LaunchCard({
  overview,
  form,
  canEdit,
  busy,
  onLaunch,
  onStop,
}: {
  overview: LessonRemindersOverview;
  form: LessonReminderChoices;
  canEdit: boolean;
  busy: "save" | "launch" | "stop" | null;
  onLaunch: () => void;
  onStop: () => void;
}) {
  const t = useTranslations("settings.lessonReminders");
  const locale = useLocale();
  const { live, live_since: since } = overview.settings;
  const connected = overview.whatsapp.state === "connected";
  const timed = form.lead_minutes > 0 || form.at_start;
  const reach = reachable(overview, form);
  const ready = connected && timed && reach;

  const checks: ReadonlyArray<{ key: string; ok: boolean; label: string }> = [
    { key: "connected", ok: connected, label: connected ? t("launch.checkConnected") : t("launch.checkNotConnected") },
    { key: "timing", ok: timed, label: timed ? t("launch.checkTiming") : t("launch.checkNoTiming") },
    {
      key: "reach",
      ok: reach,
      label: reach ? t("launch.checkReach") : usesGroups(form) && !usesPrivate(form) ? t("launch.checkNoGroups") : t("launch.checkNoReach"),
    },
  ];

  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border shadow-sm",
        live ? "border-emerald-500/40 bg-emerald-500/[0.06]" : "bg-card",
      )}
      data-testid="reminders-launch"
      data-live={live ? "true" : "false"}
    >
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-6">
        <div className="flex min-w-0 flex-1 items-start gap-3.5">
          <div
            className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-2xl text-white shadow-sm",
              live ? "bg-gradient-to-br from-emerald-500 to-green-600" : "bg-gradient-to-br from-slate-400 to-slate-600",
            )}
          >
            {live ? <BellRing className="size-5" aria-hidden /> : <Rocket className="size-5" aria-hidden />}
          </div>
          <div className="min-w-0">
            <p className="text-base font-semibold" data-testid="reminders-launch-state">
              {live ? t("launch.liveTitle") : t("launch.offTitle")}
            </p>
            <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
              {live
                ? since
                  ? t("launch.liveSince", { date: formatDateTime(since, overview.timezone, locale) })
                  : t("launch.liveDesc")
                : t("launch.offDesc")}
            </p>
            {live && (
              <p className="mt-1.5 text-xs font-medium">
                {t(`channel.${overview.settings.channel}.title`)} · {t(`audience.${overview.settings.audience}`)}
              </p>
            )}
          </div>
        </div>

        {canEdit &&
          (live ? (
            <Button variant="outline" disabled={busy !== null} onClick={onStop} data-testid="reminders-stop">
              {busy === "stop" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <CircleStop className="size-4" aria-hidden />}
              {t("launch.stop")}
            </Button>
          ) : (
            <Button size="lg" disabled={busy !== null || !ready} onClick={onLaunch} data-testid="reminders-launch-button">
              {busy === "launch" || busy === "save" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Rocket className="size-4" aria-hidden />}
              {t("launch.button")}
            </Button>
          ))}
      </div>

      {!live && (
        <ul className="grid gap-2 border-t px-4 py-3 sm:grid-cols-3 sm:px-6" data-testid="reminders-checklist">
          {checks.map(({ key, ok, label }) => (
            <li key={key} className="flex items-start gap-2 text-xs" data-testid={`reminders-check-${key}`} data-ok={ok ? "true" : "false"}>
              <span
                className={cn(
                  "mt-px flex size-4 shrink-0 items-center justify-center rounded-full",
                  ok ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground",
                )}
              >
                {ok ? <Check className="size-3" aria-hidden /> : <X className="size-3" aria-hidden />}
              </span>
              <span className={cn("min-w-0 break-words", !ok && "text-muted-foreground")}>{label}</span>
            </li>
          ))}
        </ul>
      )}
      {!canEdit && <p className="text-muted-foreground border-t px-4 py-2.5 text-xs sm:px-6">{t("launch.viewOnly")}</p>}
    </div>
  );
}

/** How reminders travel, to whom, and when. */
function SetupCard({
  overview,
  form,
  onChange,
  canEdit,
  dirty,
  saving,
  onSave,
}: {
  overview: LessonRemindersOverview;
  form: LessonReminderChoices;
  onChange: (form: LessonReminderChoices) => void;
  canEdit: boolean;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
}) {
  const t = useTranslations("settings.lessonReminders");
  const silent = form.lead_minutes === 0 && !form.at_start;

  return (
    <SectionCard
      icon={AlarmClock}
      title={t("setupTitle")}
      description={t("setupDesc")}
      iconClassName="bg-gradient-to-br from-amber-500 to-orange-600 shadow-amber-500/25"
      testId="reminders-timing"
    >
      <fieldset disabled={!canEdit} className="space-y-5">
        <div className="space-y-2">
          <span className="block text-sm font-medium">{t("channel.title")}</span>
          <div role="radiogroup" aria-label={t("channel.title")} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {CHANNELS.map(({ key, icon: Icon }) => {
              const selected = form.channel === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => onChange({ ...form, channel: key })}
                  data-testid={`reminders-channel-${key}`}
                  className={cn(
                    "flex items-start gap-3 rounded-xl border p-3 text-start transition-all disabled:cursor-not-allowed disabled:opacity-60",
                    selected ? "border-primary bg-primary/5 ring-primary/20 ring-2" : "hover:bg-muted/50",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-lg",
                      selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                    )}
                  >
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{t(`channel.${key}.title`)}</span>
                    <span className="text-muted-foreground mt-0.5 block text-xs leading-relaxed">{t(`channel.${key}.desc`)}</span>
                  </span>
                </button>
              );
            })}
          </div>
          {usesGroups(form) && <p className="text-muted-foreground text-xs">{t("sharedHint")}</p>}
        </div>

        <div className="space-y-2">
          <span className="block text-sm font-medium">{t("audience.title")}</span>
          <div role="radiogroup" aria-label={t("audience.title")} className="no-scrollbar flex gap-1 overflow-x-auto rounded-xl border bg-muted/40 p-1">
            {AUDIENCES.map((key) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={form.audience === key}
                onClick={() => onChange({ ...form, audience: key })}
                data-testid={`reminders-audience-${key}`}
                className={cn(
                  "flex-1 shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-all disabled:cursor-not-allowed",
                  form.audience === key ? "bg-card shadow-sm ring-1 ring-black/5" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t(`audience.${key}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">{t("lead")}</span>
            <select
              className={selectClass}
              value={form.lead_minutes}
              onChange={(e) => onChange({ ...form, lead_minutes: Number(e.target.value) })}
              data-testid="reminders-lead"
            >
              {overview.lead_choices.map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? t("leadOff") : t("leadMinutes", { n })}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="text-sm font-medium">{t("language")}</span>
            <select
              className={selectClass}
              value={form.language}
              onChange={(e) => onChange({ ...form, language: e.target.value === "en" ? "en" : "ar" })}
              data-testid="reminders-language"
            >
              <option value="ar">{t("arabic")}</option>
              <option value="en">{t("english")}</option>
            </select>
          </label>
        </div>

        <label className="flex items-start justify-between gap-4 rounded-xl border p-3">
          <span className="min-w-0">
            <span className="block text-sm font-medium">{t("atStart")}</span>
            <span className="text-muted-foreground mt-0.5 block text-xs">{t("atStartHint")}</span>
          </span>
          <Switch
            checked={form.at_start}
            disabled={!canEdit}
            onChange={(e) => onChange({ ...form, at_start: e.target.checked })}
            aria-label={t("atStart")}
            data-testid="reminders-at-start"
          />
        </label>
      </fieldset>

      {silent && <p className="mt-3 text-xs font-medium text-amber-700 dark:text-amber-400">{t("silentWarn")}</p>}

      {canEdit && (
        <div className="mt-4 flex items-center justify-end gap-3">
          {dirty && overview.settings.live && <p className="text-muted-foreground text-xs">{t("liveSaveHint")}</p>}
          <Button disabled={!dirty || saving} onClick={onSave} data-testid="reminders-save">
            {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t("save")}
          </Button>
        </div>
      )}
    </SectionCard>
  );
}

/** Private messages go to the numbers on file: how many of the chosen people have one. */
function PrivateReachCard({ overview, form }: { overview: LessonRemindersOverview; form: LessonReminderChoices }) {
  const t = useTranslations("settings.lessonReminders.private");
  const rows: ReadonlyArray<{ key: "students" | "teachers"; on: boolean }> = [
    { key: "students", on: reachesStudents(form) },
    { key: "teachers", on: reachesTeachers(form) },
  ];

  return (
    <SectionCard
      icon={Phone}
      title={t("title")}
      description={t("desc")}
      iconClassName="bg-gradient-to-br from-sky-500 to-blue-600 shadow-sky-500/25"
      testId="reminders-private"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {rows
          .filter((row) => row.on)
          .map(({ key }) => {
            const { with_phone: withPhone, total } = overview.phones[key];
            return (
              <div key={key} className="rounded-xl border p-3" data-testid={`reminders-phones-${key}`}>
                <p className="text-muted-foreground text-xs">{t(`${key}Label`)}</p>
                <p className={cn("mt-1 text-xl font-bold tabular-nums", withPhone === 0 && "text-destructive")}>
                  {withPhone} <span className="text-muted-foreground text-sm font-medium">/ {total}</span>
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs">{t(key, { with: withPhone, total })}</p>
              </div>
            );
          })}
      </div>
      <p className="text-muted-foreground mt-3 text-xs leading-relaxed">{t("hint")}</p>
    </SectionCard>
  );
}

function Summary({ overview }: { overview: LessonRemindersOverview }) {
  const t = useTranslations("settings.lessonReminders");
  const { capacity, last_day: day, assigned } = overview;
  // Reminders stop at 90% of the cap (the API keeps the rest for bills and reports).
  const tight = capacity !== null && capacity.expected_next_day > capacity.daily_cap * 0.9;

  const tiles: ReadonlyArray<{ key: "sent" | "waiting" | "failed" | "missed"; alert?: boolean }> = [
    { key: "sent" },
    { key: "waiting" },
    { key: "failed", alert: day.failed > 0 },
    { key: "missed", alert: day.missed > 0 },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map(({ key, alert }) => (
          <div key={key} className="bg-card rounded-2xl border p-4 shadow-sm" data-testid={`reminders-stat-${key}`}>
            <p className="text-muted-foreground text-xs">{t(`stats.${key}`)}</p>
            <p className={cn("mt-1 text-2xl font-bold tabular-nums", alert && "text-destructive")}>{day[key]}</p>
          </div>
        ))}
      </div>
      <p className="text-muted-foreground text-xs">
        {t("statsHint")} · {t("assignedStudents", assigned.students)} · {t("assignedTeachers", assigned.teachers)}
        {assigned.classes && <> · {t("assignedClasses", assigned.classes)}</>}
        {capacity && <> · {t("sentToday", { sent: capacity.sent_today, cap: capacity.daily_cap })}</>}
      </p>
      {tight && capacity && (
        <div data-testid="reminders-capacity-warning">
          <AlertBanner variant="info" message={t("capacityWarn", { expected: capacity.expected_next_day, cap: capacity.daily_cap })} />
        </div>
      )}
    </div>
  );
}

function AssignCard({
  connected,
  canEditStudents,
  canEditTeachers,
  canSeeTeachers,
  canEditClasses,
  onChanged,
}: {
  connected: boolean;
  canEditStudents: boolean;
  canEditTeachers: boolean;
  canSeeTeachers: boolean;
  /** A centre's classes, each with one WhatsApp group for all its students. */
  canEditClasses: boolean;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations("settings.lessonReminders");
  const describe = useReminderError();
  const kinds: ReminderPersonKind[] = [
    ...(canEditClasses ? (["class"] as const) : []),
    ...(canEditStudents ? (["student"] as const) : []),
    ...(canSeeTeachers ? (["teacher"] as const) : []),
  ];
  const [kind, setKind] = useState<ReminderPersonKind>(kinds[0] ?? "student");
  const [assigned, setAssigned] = useState<"" | "yes" | "no">("");
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<ReminderPerson[] | null>(null);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(30);
  const [groups, setGroups] = useState<ReminderGroupOption[]>([]);
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Search as they stop typing, not on every letter.
  useEffect(() => {
    const id = setTimeout(() => {
      setSearch(typed.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [typed]);

  const loadGroups = useCallback(
    async (refresh = false) => {
      if (!connected) return;
      setRefreshing(true);
      try {
        setGroups((await listReminderGroups(refresh)).groups);
        setGroupsLoaded(true);
      } catch (err) {
        setError(describe(err));
      } finally {
        setRefreshing(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `describe` only formats.
    [connected],
  );

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    let live = true;
    setRows(null);
    listReminderAssignments({ kind, page, search, assigned: assigned === "" ? undefined : assigned })
      .then((res) => {
        if (!live) return;
        setRows(res.rows);
        setTotal(res.total);
        setPageSize(res.pageSize);
      })
      .catch((err: unknown) => {
        if (!live) return;
        setRows([]);
        setError(describe(err));
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `describe` only formats.
  }, [kind, page, search, assigned]);

  function saved(person: ReminderPerson) {
    setRows((current) => current?.map((r) => (r.id === person.id ? person : r)) ?? current);
    // The counts on the picker and in the summary changed with it.
    void loadGroups();
    void onChanged();
  }

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const canEdit = kind === "student" ? canEditStudents : kind === "teacher" ? canEditTeachers : canEditClasses;
  const kindLabel = (k: ReminderPersonKind) => t(k === "student" ? "students" : k === "teacher" ? "teachers" : "classes");

  return (
    <SectionCard
      icon={Users2}
      title={t("assignTitle")}
      description={t("assignDesc")}
      iconClassName="bg-gradient-to-br from-emerald-500 to-green-600 shadow-emerald-500/25"
      testId="reminders-assign"
    >
      {error && (
        <div className="mb-4">
          <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {kinds.length > 1 && (
          <div role="tablist" aria-label={t("assignTitle")} className="no-scrollbar flex shrink-0 gap-1 overflow-x-auto rounded-xl border bg-muted/40 p-1">
            {kinds.map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={kind === k}
                onClick={() => {
                  setKind(k);
                  setPage(1);
                }}
                data-testid={`reminders-kind-${k}`}
                className={cn(
                  "flex-1 shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-all",
                  kind === k ? "bg-card shadow-sm ring-1 ring-black/5" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {kindLabel(k)}
              </button>
            ))}
          </div>
        )}

        <div className="relative min-w-0 flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2" aria-hidden />
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={t("search")}
            aria-label={t("search")}
            className="border-input bg-background focus:border-primary focus:ring-primary/20 h-10 w-full rounded-xl border ps-9 pe-3 text-sm outline-none transition-all focus:ring-2"
            data-testid="reminders-search"
          />
        </div>

        <select
          className={cn(selectClass, "sm:w-40")}
          value={assigned}
          aria-label={t("filter")}
          onChange={(e) => {
            setAssigned(e.target.value as "" | "yes" | "no");
            setPage(1);
          }}
          data-testid="reminders-filter"
        >
          <option value="">{t("filterAll")}</option>
          <option value="no">{t("filterWithout")}</option>
          <option value="yes">{t("filterWith")}</option>
        </select>

        {connected && (
          <Button type="button" variant="outline" disabled={refreshing} onClick={() => void loadGroups(true)} data-testid="reminders-refresh">
            <RefreshCw className={cn("size-4", refreshing && "animate-spin")} aria-hidden />
            {t("refreshGroups")}
          </Button>
        )}
      </div>

      {kind === "class" && <p className="text-muted-foreground mt-3 text-xs">{t("classesHint")}</p>}

      <div className="mt-4 divide-y rounded-xl border">
        {rows === null ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="text-primary size-5 animate-spin" aria-hidden />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground px-4 py-8 text-center text-sm">{t("noRows")}</p>
        ) : (
          rows.map((person) => (
            <div key={person.id} className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:items-start" data-testid={`reminder-row-${person.id}`}>
              <p className="min-w-0 pt-1.5 text-sm font-medium break-words">{person.name}</p>
              <GroupAssignment
                kind={kind}
                person={person}
                groups={groups}
                groupsLoaded={groupsLoaded}
                canEdit={canEdit && connected}
                onSaved={saved}
                onError={setError}
              />
            </div>
          ))
        )}
      </div>

      {pages > 1 && (
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-muted-foreground text-xs tabular-nums">{t("pageOf", { page, pages })}</p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label={t("previous")}>
              <ChevronLeft className="rtl:rotate-180" aria-hidden />
              {t("previous")}
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label={t("next")}>
              {t("next")}
              <ChevronRight className="rtl:rotate-180" aria-hidden />
            </Button>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

function LogCard({ timezone }: { timezone: string }) {
  const t = useTranslations("settings.lessonReminders");
  const locale = useLocale();
  const describe = useReminderError();
  const [problems, setProblems] = useState(false);
  const [rows, setRows] = useState<ReminderLogRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setRows(null);
    listReminderLog(problems)
      .then((res) => {
        if (live) setRows(res.rows);
      })
      .catch((err: unknown) => {
        if (!live) return;
        setRows([]);
        setError(describe(err));
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `describe` only formats.
  }, [problems]);

  return (
    <SectionCard
      icon={History}
      title={t("logTitle")}
      description={t("logDesc")}
      iconClassName="bg-gradient-to-br from-slate-500 to-slate-700 shadow-slate-500/25"
      testId="reminders-log"
    >
      {error && (
        <div className="mb-4">
          <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <label className="mb-3 flex items-center gap-2 text-sm">
        <Switch checked={problems} onChange={(e) => setProblems(e.target.checked)} aria-label={t("logProblems")} data-testid="reminders-log-problems" />
        {t("logProblems")}
      </label>

      {rows === null ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="text-primary size-5 animate-spin" aria-hidden />
        </div>
      ) : rows.length === 0 ? (
        <div className="text-muted-foreground flex flex-col items-center gap-2 py-8 text-center text-sm">
          <BellRing className="size-5" aria-hidden />
          {t(problems ? "logNoProblems" : "logEmpty")}
        </div>
      ) : (
        <ul className="divide-y rounded-xl border">
          {rows.map((row) => {
            const Icon = row.channel === "PRIVATE" ? MessageCircle : Users2;
            return (
              <li key={row.id} className="flex flex-col gap-1 p-3 sm:flex-row sm:items-center sm:gap-3" data-testid={`reminder-log-${row.id}`}>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-sm font-medium break-words">
                    <Icon className="text-muted-foreground size-3.5 shrink-0" aria-label={t(row.channel === "PRIVATE" ? "logPrivate" : "logGroup")} />
                    <span className="min-w-0 break-words">{row.group_name}</span>
                    {row.recipient_kind && (
                      <span className="text-muted-foreground shrink-0 text-xs font-normal">· {t(`recipient.${row.recipient_kind}`)}</span>
                    )}
                  </p>
                  <p className="text-muted-foreground mt-0.5 text-xs break-words">
                    {t(`stage.${row.event_type}`)}
                    {row.lesson.starts_at && <> · {formatDateTime(row.lesson.starts_at, timezone, locale)}</>}
                    {" · "}
                    {row.lesson.class ?? row.lesson.student ?? "—"}
                    {row.lesson.teacher && <> — {row.lesson.teacher}</>}
                  </p>
                </div>
                <span
                  className={cn(
                    "w-fit shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold",
                    row.status === "FAILED" || row.status === "EXPIRED"
                      ? "bg-destructive/10 text-destructive"
                      : row.status === "SENT" || row.status === "DELIVERED"
                        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {t(`status.${row.status}`)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
