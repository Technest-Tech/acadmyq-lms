"use client";

import { CalendarClock, Check, ChevronDown, Globe, Home, TriangleAlert, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { academyTimeZone, deviceClockGap } from "@/lib/academy-clock";
import { ApiError } from "@/lib/api";
import {
  anchorTimetables,
  clockName,
  countryFlag,
  countryName,
  getClockChanges,
  type AbroadGroup,
  type ClockChange,
  type ClockChanges,
} from "@/lib/clock-api";
import { cn } from "@/lib/utils";

/** A dismissal is remembered per browser; storage may be blocked, and the notice then just shows. */
function wasDismissed(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function dismiss(key: string): void {
  try {
    window.localStorage.setItem(key, "1");
  } catch {
    // Not remembered; it shows again next load.
  }
}

/** "an hour" / "30 minutes" for a gap in minutes. */
function useSpan(): (minutes: number) => string {
  const t = useTranslations("scheduling.clock");
  return (minutes: number) => {
    const abs = Math.abs(minutes);
    if (abs % 60 === 0) return t("hours", { count: abs / 60 });
    return t("minutes", { count: abs });
  };
}

/**
 * The device's clock disagrees with the academy's. Nothing on screen depends on the device any
 * more, so this only explains why the times here differ from the corner of the user's screen.
 */
export function DeviceClockNotice({ className }: { className?: string }) {
  const t = useTranslations("scheduling.clock");
  const locale = useLocale();
  const span = useSpan();
  const { session } = useAuth();
  const gap = useMemo(() => (session?.academy ? deviceClockGap() : null), [session]);
  // Remembered per gap, not per day: someone who really lives abroad is told once, and again only
  // if the gap changes (their country or the academy's moves its clocks).
  const key = `clock-device-${gap?.kind ?? ""}-${gap?.minutes ?? 0}`;
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    setHidden(gap === null || wasDismissed(key));
  }, [gap, key]);

  if (gap === null || hidden) return null;
  const place = clockName(academyTimeZone(), locale, null, session?.academy?.country ?? undefined);

  return (
    <div
      role="status"
      data-testid="device-clock-notice"
      className={cn(
        "flex items-start gap-2.5 rounded-xl border border-amber-300/60 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900 dark:border-amber-700/40 dark:bg-amber-950/30 dark:text-amber-200",
        className,
      )}
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1 leading-relaxed">
        {t(gap.minutes > 0 ? "deviceAhead" : "deviceBehind", { span: span(gap.minutes), place })}
      </p>
      <button
        type="button"
        aria-label={t("dismiss")}
        onClick={() => {
          dismiss(key);
          setHidden(true);
        }}
        className="rounded-md p-0.5 opacity-70 hover:opacity-100"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

/** The pages where a manager plans lessons: the only places the clock-change card belongs. */
const PLANNING_PAGES = ["/dashboard", "/attendance", "/calendar"];

/**
 * A clock change is coming (or just happened) in a country this academy teaches in: who moves, by
 * how much, and the way to stop it mattering (tie the students abroad to their own clock).
 */
export function ClockChangeNotice({ pathname, className }: { pathname: string; className?: string }) {
  const t = useTranslations("scheduling.clock");
  const locale = useLocale();
  const span = useSpan();
  const { session, can } = useAuth();
  const [data, setData] = useState<ClockChanges | null>(null);
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [toolOpen, setToolOpen] = useState(false);

  const wanted =
    session?.academy != null && can("schedule.manage") && PLANNING_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  const load = useCallback(() => {
    getClockChanges()
      .then(setData)
      .catch(() => {
        // Best-effort: the page works without the card.
      });
  }, []);

  useEffect(() => {
    if (wanted && data === null) load();
  }, [wanted, data, load]);

  if (!wanted || data === null) return null;

  // The next change that moves a lesson; failing that, the latest one that just did.
  const moving = data.changes.filter((c) => c.moving_for_student > 0 || c.moving_on_academy_clock > 0);
  const change: ClockChange | undefined = moving.find((c) => !c.past) ?? [...moving].reverse().find((c) => c.past);
  const stillOnAcademyClock = data.abroad.reduce((n, g) => n + g.on_academy_clock.length, 0);
  const tool = toolOpen && <StudentClocksModal data={data} onClose={() => setToolOpen(false)} onChanged={load} />;

  // No change near: still say, once, that students abroad are riding the academy's clock.
  if (!change) {
    const nudgeKey = "clock-abroad-nudge";
    if (stillOnAcademyClock === 0 || (hidden[nudgeKey] ?? wasDismissed(nudgeKey))) return tool || null;
    return (
      <>
        <div
          role="status"
          data-testid="clock-abroad-nudge"
          className={cn(
            "flex items-start gap-2.5 rounded-xl border border-sky-300/60 bg-sky-50 px-3.5 py-3 text-xs text-sky-950 dark:border-sky-700/40 dark:bg-sky-950/30 dark:text-sky-100",
            className,
          )}
        >
          <Globe className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1 space-y-1 leading-relaxed">
            <p>{t("abroadNudge", { count: stillOnAcademyClock })}</p>
            <button
              type="button"
              data-testid="open-abroad-tool"
              onClick={() => setToolOpen(true)}
              className="font-semibold text-sky-700 underline underline-offset-2 dark:text-sky-300"
            >
              {t("abroadNudgeAction")}
            </button>
          </div>
          <button
            type="button"
            aria-label={t("dismiss")}
            onClick={() => {
              dismiss(nudgeKey);
              setHidden((h) => ({ ...h, [nudgeKey]: true }));
            }}
            className="rounded-md p-0.5 opacity-70 hover:opacity-100"
          >
            <X className="size-3.5" />
          </button>
        </div>
        {tool}
      </>
    );
  }

  const key = `clock-change-${change.date}`;
  if (hidden[key] ?? wasDismissed(key)) return tool || null;

  const dateLabel = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(`${change.date}T12:00:00Z`),
  );
  const places = change.places
    .map((p) => `${countryName(p.country, locale) || p.country} (${p.shift_minutes > 0 ? "+" : "−"}${span(p.shift_minutes)})`)
    .join("، ");

  return (
    <>
      <div
        role="status"
        data-testid="clock-change-notice"
        className={cn(
          "rounded-xl border border-sky-300/60 bg-sky-50 px-3.5 py-3 text-xs text-sky-950 dark:border-sky-700/40 dark:bg-sky-950/30 dark:text-sky-100",
          className,
        )}
      >
        <div className="flex items-start gap-2.5">
          <CalendarClock className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1 space-y-1 leading-relaxed">
            <p className="font-semibold">{t(change.past ? "changeWas" : "changeComing", { date: dateLabel, places })}</p>
            {change.moving_for_student > 0 && (
              <p>
                {t(
                  (change.student_shift_minutes ?? 0) > 0 ? "studentLater" : "studentEarlier",
                  { count: change.moving_for_student, span: span(change.student_shift_minutes ?? 0) },
                )}
              </p>
            )}
            {change.moving_on_academy_clock > 0 && (
              <p>
                {t(
                  (change.academy_shift_minutes ?? 0) > 0 ? "academyLater" : "academyEarlier",
                  { count: change.moving_on_academy_clock, span: span(change.academy_shift_minutes ?? 0) },
                )}
              </p>
            )}
            {stillOnAcademyClock > 0 && (
              <button
                type="button"
                data-testid="open-abroad-tool"
                onClick={() => setToolOpen(true)}
                className="font-semibold text-sky-700 underline underline-offset-2 dark:text-sky-300"
              >
                {t("openTool", { count: stillOnAcademyClock })}
              </button>
            )}
          </div>
          <button
            type="button"
            aria-label={t("dismiss")}
            onClick={() => {
              dismiss(key);
              setHidden((h) => ({ ...h, [key]: true }));
            }}
            className="rounded-md p-0.5 opacity-70 hover:opacity-100"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>
      {tool}
    </>
  );
}

/**
 * A standing way into the same tool, for the timetables page: students abroad still tied to the
 * academy's clock, by country, each tied to their own in one press.
 */
export function StudentClocksButton({ onChanged }: { onChanged?: () => void }) {
  const t = useTranslations("scheduling.clock");
  const [data, setData] = useState<ClockChanges | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    getClockChanges()
      .then(setData)
      .catch(() => {
        // The button then stays hidden.
      });
  }, []);
  useEffect(load, [load]);

  if (data === null || data.abroad.length === 0) return null;
  const pending = data.abroad.reduce((n, g) => n + g.on_academy_clock.length, 0);

  return (
    <>
      <Button type="button" size="sm" variant="outline" data-testid="student-clocks" onClick={() => setOpen(true)} className="gap-1.5">
        <Globe className="size-3.5" />
        {t("toolButton")}
        {pending > 0 && (
          <span className="rounded-full bg-amber-500/15 px-1.5 text-[0.7rem] font-semibold tabular-nums text-amber-700 dark:text-amber-300">
            {pending}
          </span>
        )}
      </Button>
      {open && (
        <StudentClocksModal
          data={data}
          onClose={() => setOpen(false)}
          onChanged={() => {
            load();
            onChanged?.();
          }}
        />
      )}
    </>
  );
}

function StudentClocksModal({
  data,
  onClose,
  onChanged,
}: {
  data: ClockChanges;
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useTranslations("scheduling.clock");
  const locale = useLocale();
  const academyName = clockName(data.timezone, locale, null, data.country ?? undefined);

  return (
    <Modal open onClose={onClose} title={t("toolTitle")} description={t("toolIntro", { place: academyName })} size="lg">
      <div className="space-y-3" data-testid="student-clocks-modal">
        {data.abroad.length === 0 ? (
          <p className="rounded-xl border border-dashed py-8 text-center text-sm text-muted-foreground">{t("toolEmpty")}</p>
        ) : (
          data.abroad.map((group) => <CountryRow key={group.country} group={group} onChanged={onChanged} />)
        )}
        {data.no_country > 0 && (
          <p className="text-[11px] leading-relaxed text-muted-foreground">{t("noCountry", { count: data.no_country })}</p>
        )}
      </div>
    </Modal>
  );
}

function CountryRow({ group, onChanged }: { group: AbroadGroup; onChanged: () => void }) {
  const t = useTranslations("scheduling.clock");
  const locale = useLocale();
  const span = useSpan();
  const [timezone, setTimezone] = useState(group.suggested);
  const [open, setOpen] = useState(false);
  const [skip, setSkip] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pending = group.on_academy_clock;
  const chosen = pending.filter((s) => !skip[s.schedule_id]);
  const name = countryName(group.country, locale) || group.country;

  async function tie() {
    setBusy(true);
    setError(null);
    try {
      await anchorTimetables(
        chosen.map((s) => s.schedule_id),
        timezone,
      );
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border bg-card p-3" data-testid={`clock-country-${group.country}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg leading-none">{countryFlag(group.country)}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{name}</p>
          <p className="text-[11px] text-muted-foreground">
            {group.gap_minutes === 0
              ? t("gapNone")
              : t(group.gap_minutes > 0 ? "gapAhead" : "gapBehind", { span: span(group.gap_minutes) })}
          </p>
        </div>
        {group.on_own_clock > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
            <Check className="size-3" />
            {t("onOwnClock", { count: group.on_own_clock })}
          </span>
        )}
      </div>

      {pending.length > 0 && (
        <div className="mt-2.5 space-y-2 border-t pt-2.5">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex w-full items-center gap-1.5 text-start text-xs font-medium text-foreground"
          >
            <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
            {t("onAcademyCount", { count: pending.length })}
          </button>
          {open && (
            <ul className="max-h-44 space-y-1 overflow-y-auto rounded-lg bg-muted/40 p-2">
              {pending.map((s) => (
                <li key={s.schedule_id}>
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={!skip[s.schedule_id]}
                      onChange={(e) => setSkip((prev) => ({ ...prev, [s.schedule_id]: !e.target.checked }))}
                    />
                    <span className="min-w-0 flex-1 truncate">{s.student_name ?? "—"}</span>
                    {s.teacher_name && <span className="shrink-0 text-muted-foreground">{s.teacher_name}</span>}
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {group.zones.length > 1 && (
              <select
                aria-label={t("pickCity")}
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                disabled={busy}
                className="border-input bg-background h-9 min-w-0 flex-1 rounded-xl border px-2.5 text-xs outline-none focus:border-primary"
              >
                {group.zones.map((z) => (
                  <option key={z.timezone} value={z.timezone}>
                    {locale.startsWith("ar") ? (z.city_ar ?? z.city) : z.city}
                  </option>
                ))}
              </select>
            )}
            <Button
              type="button"
              size="sm"
              disabled={busy || chosen.length === 0}
              data-testid={`clock-tie-${group.country}`}
              onClick={() => void tie()}
              className="ms-auto gap-1.5"
            >
              <Home className="size-3.5" />
              {busy ? t("tying") : t("tie", { count: chosen.length, country: name })}
            </Button>
          </div>
          {group.zones.length > 1 && <p className="text-[11px] text-muted-foreground">{t("cityHint")}</p>}
          {error && <p className="text-[11px] text-destructive">{error}</p>}
        </div>
      )}
    </div>
  );
}
