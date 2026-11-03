"use client";

import { AlarmClock, BellRing, ChevronLeft, ChevronRight, History, Loader2, RefreshCw, Search, Users2, WifiOff } from "lucide-react";
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
  listReminderAssignments,
  listReminderGroups,
  listReminderLog,
  updateLessonReminderSettings,
  type LessonReminderSettings,
  type LessonRemindersOverview,
  type ReminderGroupOption,
  type ReminderLogRow,
  type ReminderPerson,
  type ReminderPersonKind,
} from "@/lib/lesson-reminders-api";
import { formatDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";

const selectClass =
  "border-input bg-background focus:border-primary focus:ring-primary/20 h-10 w-full rounded-xl border px-3 text-sm outline-none transition-all focus:ring-2 disabled:opacity-50";

/**
 * Settings → Lesson reminders (`whatsapp.group_reminders`, off until a Super Admin turns it on for
 * the client): give each student and teacher a WhatsApp group, choose when reminders go out, and
 * see whether they are arriving. Sending is the API's, on the scheduler.
 */
export function LessonRemindersManager() {
  const t = useTranslations("settings.lessonReminders");
  const describe = useReminderError();
  const { can } = useAuth();
  const [overview, setOverview] = useState<LessonRemindersOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setOverview(await getLessonReminders());
    } catch (err) {
      setError(describe(err));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `describe` only formats.
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (overview === null) {
    return error ? (
      <AlertBanner variant="error" message={error} />
    ) : (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-primary size-6 animate-spin" aria-hidden />
      </div>
    );
  }

  const connected = overview.whatsapp.state === "connected";

  return (
    <div className="space-y-6" data-testid="lesson-reminders">
      {!connected && (
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

      <Summary overview={overview} />

      <TimingCard overview={overview} canEdit={can("settings.manage")} onSaved={load} />
      <AssignCard connected={connected} canEditStudents={can("student.update")} canEditTeachers={can("teacher.update")} canSeeTeachers={can("teacher.read")} onChanged={load} />
      <LogCard timezone={overview.timezone} />
    </div>
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

function TimingCard({
  overview,
  canEdit,
  onSaved,
}: {
  overview: LessonRemindersOverview;
  canEdit: boolean;
  onSaved: () => Promise<void>;
}) {
  const t = useTranslations("settings.lessonReminders");
  const toast = useToast();
  const describe = useReminderError();
  const [form, setForm] = useState<LessonReminderSettings>(overview.settings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saved = overview.settings;
  const dirty = form.lead_minutes !== saved.lead_minutes || form.at_start !== saved.at_start || form.language !== saved.language;
  const silent = form.lead_minutes === 0 && !form.at_start;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await updateLessonReminderSettings(form);
      toast.success(t("saved"));
      await onSaved();
    } catch (err) {
      setError(describe(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard
      icon={AlarmClock}
      title={t("timingTitle")}
      description={t("timingDesc")}
      iconClassName="bg-gradient-to-br from-amber-500 to-orange-600 shadow-amber-500/25"
      testId="reminders-timing"
    >
      {error && (
        <div className="mb-4">
          <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">{t("lead")}</span>
          <select
            className={selectClass}
            value={form.lead_minutes}
            disabled={!canEdit}
            onChange={(e) => setForm({ ...form, lead_minutes: Number(e.target.value) })}
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
            disabled={!canEdit}
            onChange={(e) => setForm({ ...form, language: e.target.value === "en" ? "en" : "ar" })}
            data-testid="reminders-language"
          >
            <option value="ar">{t("arabic")}</option>
            <option value="en">{t("english")}</option>
          </select>
        </label>
      </div>

      <label className="mt-4 flex items-start justify-between gap-4 rounded-xl border p-3">
        <span className="min-w-0">
          <span className="block text-sm font-medium">{t("atStart")}</span>
          <span className="text-muted-foreground mt-0.5 block text-xs">{t("atStartHint")}</span>
        </span>
        <Switch
          checked={form.at_start}
          disabled={!canEdit}
          onChange={(e) => setForm({ ...form, at_start: e.target.checked })}
          aria-label={t("atStart")}
          data-testid="reminders-at-start"
        />
      </label>

      {silent && <p className="mt-3 text-xs font-medium text-amber-700 dark:text-amber-400">{t("silentWarn")}</p>}

      {canEdit && (
        <div className="mt-4 flex justify-end">
          <Button disabled={!dirty || saving} onClick={() => void save()} data-testid="reminders-save">
            {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t("save")}
          </Button>
        </div>
      )}
    </SectionCard>
  );
}

function AssignCard({
  connected,
  canEditStudents,
  canEditTeachers,
  canSeeTeachers,
  onChanged,
}: {
  connected: boolean;
  canEditStudents: boolean;
  canEditTeachers: boolean;
  canSeeTeachers: boolean;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations("settings.lessonReminders");
  const describe = useReminderError();
  const kinds: ReminderPersonKind[] = [...(canEditStudents ? (["student"] as const) : []), ...(canSeeTeachers ? (["teacher"] as const) : [])];
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
  const canEdit = kind === "student" ? canEditStudents : canEditTeachers;

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
          <div role="tablist" aria-label={t("assignTitle")} className="flex shrink-0 gap-1 rounded-xl border bg-muted/40 p-1">
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
                  "flex-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-all",
                  kind === k ? "bg-card shadow-sm ring-1 ring-black/5" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t(k === "student" ? "students" : "teachers")}
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
          {rows.map((row) => (
            <li key={row.id} className="flex flex-col gap-1 p-3 sm:flex-row sm:items-center sm:gap-3" data-testid={`reminder-log-${row.id}`}>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium break-words">{row.group_name}</p>
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
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
