"use client";

import {
  BookOpen,
  CalendarClock,
  CalendarDays,
  Check,
  ChevronDown,
  FileText,
  GraduationCap,
  Languages,
  Lock,
  NotebookPen,
  Receipt,
  Star,
  Users,
  Wallet,
} from "lucide-react";
import { useMemo, useState, useSyncExternalStore } from "react";
import { KhatamLattice } from "@/components/ornaments";
import type {
  PortalChild,
  PortalInvoice,
  PortalLesson,
  PortalLessonStatus,
  PortalPayload,
  PortalProgressReport,
  PortalReportField,
} from "@/lib/portal-api";
import {
  COPY,
  type Lang,
  dateText,
  dayKey,
  dayLabel,
  hours,
  lessons,
  minutesText,
  money,
  monthText,
  num,
  PARENT_LANG_COOKIE,
  shortDate,
  timeText,
  yearMonthText,
} from "./copy";

// ── The viewer's clock ──────────────────────────────────────────────────────

const noSubscription = () => () => {};
let clientNow: number | null = null;

function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/**
 * Times in the PARENT's zone — many families live abroad from their academy. The server renders in
 * the academy's zone (the only one it knows) and hydration switches to the browser's, through
 * useSyncExternalStore so the first client render matches the server's HTML exactly.
 */
function useViewerClock(academyTz: string, renderedAt: number): { tz: string; now: number } {
  const tz = useSyncExternalStore(noSubscription, () => browserTimeZone() ?? academyTz, () => academyTz);
  const now = useSyncExternalStore(noSubscription, () => (clientNow ??= Date.now()), () => renderedAt);
  return { tz, now };
}

// ── Look ────────────────────────────────────────────────────────────────────

/** One colour per child, by position — stable across tabs so a parent learns "Sara is violet". */
const HUES = [
  { avatar: "bg-emerald-100 text-emerald-800 ring-emerald-200", bar: "bg-emerald-500", chip: "bg-emerald-600" },
  { avatar: "bg-violet-100 text-violet-800 ring-violet-200", bar: "bg-violet-500", chip: "bg-violet-600" },
  { avatar: "bg-sky-100 text-sky-800 ring-sky-200", bar: "bg-sky-500", chip: "bg-sky-600" },
  { avatar: "bg-amber-100 text-amber-800 ring-amber-200", bar: "bg-amber-500", chip: "bg-amber-600" },
  { avatar: "bg-rose-100 text-rose-800 ring-rose-200", bar: "bg-rose-500", chip: "bg-rose-600" },
  { avatar: "bg-teal-100 text-teal-800 ring-teal-200", bar: "bg-teal-500", chip: "bg-teal-600" },
] as const;
type Hue = (typeof HUES)[number];

const CARD = "rounded-2xl bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.12)] ring-1 ring-slate-900/[0.06]";

const STATUS_TONE: Record<PortalLessonStatus, string> = {
  SCHEDULED: "bg-sky-50 text-sky-700 ring-sky-200",
  ATTENDED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  LATE: "bg-amber-50 text-amber-800 ring-amber-200",
  ABSENT: "bg-rose-50 text-rose-700 ring-rose-200",
  EXCUSED: "bg-amber-50 text-amber-800 ring-amber-200",
  CANCELLED: "bg-slate-100 text-slate-600 ring-slate-200",
  CANCELLED_BY_TEACHER: "bg-slate-100 text-slate-600 ring-slate-200",
  CANCELLED_BY_STUDENT: "bg-slate-100 text-slate-600 ring-slate-200",
  HELD: "bg-slate-100 text-slate-600 ring-slate-200",
};

const INVOICE_TONE: Record<PortalInvoice["state"], string> = {
  PAID: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  PARTIAL: "bg-sky-50 text-sky-700 ring-sky-200",
  UNPAID: "bg-amber-50 text-amber-800 ring-amber-200",
};

function initial(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "•";
}

function Avatar({ name, hue, size = "md" }: { name: string; hue: Hue; size?: "sm" | "md" | "lg" }) {
  const box = size === "lg" ? "size-12 text-lg" : size === "md" ? "size-9 text-sm" : "size-6 text-[11px]";
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full font-bold ring-1 ring-inset ${box} ${hue.avatar}`}
    >
      {initial(name)}
    </span>
  );
}

function Pill({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${tone}`}>
      {children}
    </span>
  );
}

function SectionTitle({ icon: Icon, children }: { icon: typeof BookOpen; children: React.ReactNode }) {
  return (
    <h2 className="mb-3 flex items-center gap-2 text-[15px] font-bold text-slate-800">
      <Icon className="size-4 text-emerald-700" aria-hidden />
      {children}
    </h2>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className={`${CARD} px-5 py-8 text-center text-sm text-slate-500`}>{children}</p>;
}

// ── The page ────────────────────────────────────────────────────────────────

type Tab = "lessons" | "reports" | "invoices";

export function ParentPage({
  data,
  initialLang,
  renderedAt,
}: {
  data: PortalPayload;
  initialLang: Lang;
  renderedAt: number;
}) {
  const [lang, setLang] = useState<Lang>(initialLang);
  const [tab, setTab] = useState<Tab>("lessons");
  const [childId, setChildId] = useState<string | null>(null);
  const { tz, now } = useViewerClock(data.academy.timezone, renderedAt);
  const t = COPY[lang];

  const hueOf = useMemo(() => {
    const map = new Map<string, Hue>();
    data.children.forEach((c, i) => map.set(c.id, HUES[i % HUES.length]!));
    return map;
  }, [data.children]);
  const nameOf = useMemo(() => new Map(data.children.map((c) => [c.id, c.name])), [data.children]);
  const severalChildren = data.children.length > 1;

  function only<T extends { child_id: string }>(rows: T[]): T[] {
    return childId === null ? rows : rows.filter((r) => r.child_id === childId);
  }

  const upcoming = only(data.upcoming);
  const recent = only(data.recent);
  const progress = only(data.progress_reports);
  const lessonReports = recent.filter((l) => (l.report?.length ?? 0) > 0 || l.topic || l.homework);
  const unpaid = data.invoices.filter((i) => i.state !== "PAID").length;

  function switchLang() {
    const next: Lang = lang === "ar" ? "en" : "ar";
    setLang(next);
    try {
      document.cookie = `${PARENT_LANG_COOKIE}=${next}; path=/p; max-age=31536000; samesite=lax`;
      const url = new URL(window.location.href);
      url.searchParams.set("lang", next);
      window.history.replaceState(null, "", url);
    } catch {
      // Remembering is a convenience; the page has already switched.
    }
  }

  const ctx: ViewCtx = { lang, tz, now, hueOf, nameOf, showChild: severalChildren && childId === null };
  const next = data.upcoming[0] ?? null;

  return (
    <div dir={lang === "ar" ? "rtl" : "ltr"} lang={lang} className="parent-page min-h-dvh bg-[#f5f3ec] font-sans text-slate-900">
      {/* ── Academy bar ─────────────────────────────────────────── */}
      <header className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 pt-4 pb-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {data.academy.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.academy.logo_url}
              alt=""
              className="size-10 shrink-0 rounded-xl bg-white object-contain p-1 shadow-sm ring-1 ring-slate-900/[0.06]"
            />
          ) : (
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-700 text-base font-bold text-white shadow-sm">
              {initial(data.academy.name)}
            </span>
          )}
          <span className="truncate text-base font-bold text-slate-900">{data.academy.name}</span>
        </div>
        <button
          type="button"
          onClick={switchLang}
          data-testid="parent-lang"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-slate-900/[0.08] transition hover:bg-slate-50"
        >
          <Languages className="size-4 text-emerald-700" aria-hidden />
          {t.otherLang}
        </button>
      </header>

      <main className="mx-auto max-w-2xl px-4 pb-14">
        {/* ── Greeting ──────────────────────────────────────────── */}
        <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-700 via-emerald-800 to-teal-900 p-5 text-white shadow-lg sm:p-7">
          <KhatamLattice id="parent-hero-lattice" className="pointer-events-none absolute inset-0 size-full text-white/[0.07]" />
          <div className="pointer-events-none absolute -end-16 -top-16 size-48 rounded-full bg-amber-300/20 blur-3xl" aria-hidden />
          <div className="relative">
            <h1 className="text-2xl font-bold sm:text-3xl" data-testid="parent-hello">
              {t.hello(data.guardian.name)} <span aria-hidden>👋</span>
            </h1>
            <p className="mt-1.5 text-sm text-emerald-50/85">{t.intro(data.academy.name)}</p>

            <div className="mt-5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <HeroTile icon={CalendarClock} label={t.nextLesson}>
                {next ? (
                  <>
                    <span className="block">
                      {dayLabel(next.starts_at, tz, now, lang)} · {timeText(next.starts_at, tz, lang)}
                    </span>
                    <span className="block truncate text-xs font-normal text-emerald-50/80">
                      {[nameOf.get(next.child_id), next.group_name, next.teacher].filter(Boolean).join(" · ")}
                    </span>
                  </>
                ) : (
                  t.noNextLesson
                )}
              </HeroTile>
              <HeroTile icon={Wallet} label={t.outstanding} accent={data.balance.length > 0}>
                {data.balance.length > 0 ? (
                  <span className="block tabular-nums" data-testid="parent-balance">
                    {data.balance.map((b) => money(b.due_minor, b.currency, lang)).join(" + ")}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    <Check className="size-4" aria-hidden />
                    {t.nothingDue}
                  </span>
                )}
              </HeroTile>
            </div>
          </div>
        </section>

        {/* ── The children ──────────────────────────────────────── */}
        <section className="mt-7">
          <SectionTitle icon={GraduationCap}>{t.children}</SectionTitle>
          {data.children.length === 0 ? (
            <Empty>{t.noChildren}</Empty>
          ) : (
            <div className={`grid grid-cols-1 gap-3 ${severalChildren ? "sm:grid-cols-2" : ""}`}>
              {data.children.map((child) => (
                <ChildCard key={child.id} child={child} ctx={ctx} />
              ))}
            </div>
          )}
        </section>

        {/* ── Tabs (+ the child filter), kept in reach while scrolling ── */}
        <div className="sticky top-0 z-10 -mx-4 mt-7 bg-[#f5f3ec]/90 px-4 pt-3 pb-3 backdrop-blur">
          <div role="tablist" className="grid grid-cols-3 gap-1 rounded-2xl bg-white p-1 shadow-sm ring-1 ring-slate-900/[0.06]">
            <TabButton id="lessons" tab={tab} onSelect={setTab} icon={CalendarDays} label={t.tabs.lessons} count={upcoming.length} />
            <TabButton id="reports" tab={tab} onSelect={setTab} icon={FileText} label={t.tabs.reports} count={progress.length + lessonReports.length} />
            <TabButton id="invoices" tab={tab} onSelect={setTab} icon={Receipt} label={t.tabs.invoices} count={unpaid} alert={unpaid > 0} />
          </div>
          {severalChildren && tab !== "invoices" && (
            <div className="no-scrollbar mt-2.5 flex gap-2 overflow-x-auto" data-testid="parent-child-filter">
              <FilterChip active={childId === null} onClick={() => setChildId(null)}>
                <Users className="size-3.5" aria-hidden />
                {t.all}
              </FilterChip>
              {data.children.map((c) => (
                <FilterChip key={c.id} active={childId === c.id} onClick={() => setChildId(c.id)}>
                  <span className={`size-2 rounded-full ${hueOf.get(c.id)?.chip}`} aria-hidden />
                  {c.name}
                </FilterChip>
              ))}
            </div>
          )}
        </div>

        <div role="tabpanel" className="mt-2">
          {tab === "lessons" && <LessonsTab upcoming={upcoming} recent={recent} ctx={ctx} />}
          {tab === "reports" && <ReportsTab progress={progress} lessons={lessonReports} ctx={ctx} />}
          {tab === "invoices" && <InvoicesTab invoices={data.invoices} balance={data.balance} lang={lang} />}
        </div>

        <footer className="mt-12 space-y-1.5 text-center text-xs text-slate-500">
          <p className="flex items-center justify-center gap-1.5">
            <Lock className="size-3.5 shrink-0" aria-hidden />
            {t.privateNote}
          </p>
          {tz !== data.academy.timezone && <p>{t.timesNote}</p>}
          <p className="text-slate-400">© {data.academy.name}</p>
        </footer>
      </main>
    </div>
  );
}

interface ViewCtx {
  lang: Lang;
  tz: string;
  now: number;
  hueOf: Map<string, Hue>;
  nameOf: Map<string, string>;
  /** Name the child on each row — only when several children are shown together. */
  showChild: boolean;
}

function HeroTile({
  icon: Icon,
  label,
  accent = false,
  children,
}: {
  icon: typeof BookOpen;
  label: string;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3 rounded-2xl bg-white/10 p-3.5 ring-1 ring-white/15 backdrop-blur-sm">
      <span className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${accent ? "bg-amber-300 text-amber-950" : "bg-white/15 text-white"}`}>
        <Icon className="size-4.5" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-xs text-emerald-50/75">{label}</p>
        <div className="mt-0.5 text-[15px] font-bold leading-snug">{children}</div>
      </div>
    </div>
  );
}

function TabButton({
  id,
  tab,
  onSelect,
  icon: Icon,
  label,
  count,
  alert = false,
}: {
  id: Tab;
  tab: Tab;
  onSelect: (t: Tab) => void;
  icon: typeof BookOpen;
  label: string;
  count: number;
  alert?: boolean;
}) {
  const active = tab === id;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-testid={`parent-tab-${id}`}
      onClick={() => onSelect(id)}
      className={`flex items-center justify-center gap-1.5 rounded-xl px-2 py-2.5 text-sm font-semibold transition ${
        active ? "bg-emerald-700 text-white shadow-sm" : "text-slate-600 hover:bg-slate-50"
      }`}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
      {count > 0 && (
        <span
          className={`min-w-5 rounded-full px-1.5 text-[11px] leading-5 tabular-nums ${
            active ? "bg-white/20 text-white" : alert ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium ring-1 transition ${
        active ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-700 ring-slate-900/[0.08] hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}

// ── A child ─────────────────────────────────────────────────────────────────

function ChildCard({ child, ctx }: { child: PortalChild; ctx: ViewCtx }) {
  const { lang, tz, now } = ctx;
  const t = COPY[lang];
  const hue = ctx.hueOf.get(child.id) ?? HUES[0];
  const teachers = child.teachers.map((x) => (x.course ? `${x.name} · ${x.course}` : x.name)).join(t.comma);

  return (
    <article className={`${CARD} p-4`} data-testid="parent-child">
      <div className="flex items-center gap-3">
        <Avatar name={child.name} hue={hue} size="lg" />
        <div className="min-w-0">
          <h3 className="truncate text-base font-bold text-slate-900">{child.name}</h3>
          {teachers && <p className="truncate text-xs text-slate-500">{teachers}</p>}
        </div>
      </div>

      {child.groups.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {child.groups.map((g) => (
            <span key={g.name} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
              <Users className="size-3 text-slate-500" aria-hidden />
              {g.name}
            </span>
          ))}
        </div>
      )}

      <p className="mt-4 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">{t.thisMonth}</p>
      <dl className="mt-1.5 grid grid-cols-3 gap-2 text-center">
        <MonthStat label={t.attended} value={num(child.month.attended, lang)} tone="text-emerald-700" />
        <MonthStat label={t.absent} value={num(child.month.absent, lang)} tone={child.month.absent > 0 ? "text-rose-600" : "text-slate-700"} />
        <MonthStat label={t.hoursLabel} value={num(Math.round((child.month.minutes / 60) * 10) / 10, lang)} tone="text-slate-700" />
      </dl>

      {child.packages.map((p, i) => {
        const pct = p.total_minutes > 0 ? Math.min(100, Math.round((p.remaining_minutes / p.total_minutes) * 100)) : 0;
        return (
          <div key={i} className="mt-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs">
              <span className="font-semibold text-slate-700">{p.course ?? p.label}</span>
              <span className="text-slate-500">{t.hoursLeft(hours(p.remaining_minutes, lang), hours(p.total_minutes, lang))}</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full rounded-full ${pct <= 20 ? "bg-amber-500" : hue.bar}`} style={{ width: `${pct}%` }} />
            </div>
            {p.expires_on && <p className="mt-1 text-[11px] text-slate-400">{t.expires(dateText(p.expires_on, "UTC", lang, false))}</p>}
          </div>
        );
      })}

      {child.next_lesson && (
        <p className="mt-4 flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
          <CalendarClock className="size-4 shrink-0 text-emerald-700" aria-hidden />
          <span className="min-w-0">
            <span className="font-semibold">{t.nextLesson}:</span>{" "}
            {dayLabel(child.next_lesson.starts_at, tz, now, lang)} · {timeText(child.next_lesson.starts_at, tz, lang)}
          </span>
        </p>
      )}
    </article>
  );
}

function MonthStat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-2 py-2">
      <dd className={`text-lg leading-tight font-bold tabular-nums ${tone}`}>{value}</dd>
      <dt className="text-[11px] text-slate-500">{label}</dt>
    </div>
  );
}

// ── Lessons ─────────────────────────────────────────────────────────────────

function LessonsTab({ upcoming, recent, ctx }: { upcoming: PortalLesson[]; recent: PortalLesson[]; ctx: ViewCtx }) {
  const { lang, tz, now } = ctx;
  const t = COPY[lang];

  // Upcoming lessons by day, in the viewer's zone.
  const days: { key: string; label: string; isToday: boolean; lessons: PortalLesson[] }[] = [];
  for (const l of upcoming) {
    const key = dayKey(l.starts_at, tz);
    let day = days.find((d) => d.key === key);
    if (!day) {
      day = { key, label: dayLabel(l.starts_at, tz, now, lang), isToday: key === dayKey(now, tz), lessons: [] };
      days.push(day);
    }
    day.lessons.push(l);
  }

  return (
    <div className="space-y-8">
      <section>
        <SectionTitle icon={CalendarClock}>{t.comingUp}</SectionTitle>
        {days.length === 0 ? (
          <Empty>{t.noUpcoming}</Empty>
        ) : (
          <div className="space-y-4">
            {days.map((day) => (
              <div key={day.key}>
                <p
                  className={`mb-2 inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${
                    day.isToday ? "bg-emerald-700 text-white" : "text-slate-600"
                  }`}
                >
                  {day.label}
                </p>
                <ul className={`${CARD} divide-y divide-slate-100`}>
                  {day.lessons.map((l) => (
                    <li key={`${l.kind}-${l.id}`} className="flex items-center gap-3 px-4 py-3" data-testid="parent-upcoming">
                      <div className="w-16 shrink-0 text-center">
                        <p className="text-sm font-bold text-slate-900 tabular-nums">{timeText(l.starts_at, tz, lang)}</p>
                        <p className="text-[11px] text-slate-500">{minutesText(l.duration_minutes, lang)}</p>
                      </div>
                      <span className="h-9 w-px shrink-0 bg-slate-200" aria-hidden />
                      <LessonWho lesson={l} ctx={ctx} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionTitle icon={BookOpen}>{t.recent}</SectionTitle>
        {recent.length === 0 ? (
          <Empty>{t.noRecent}</Empty>
        ) : (
          <ul className={`${CARD} divide-y divide-slate-100`}>
            {recent.map((l) => (
              <RecentLesson key={`${l.kind}-${l.id}`} lesson={l} ctx={ctx} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Who and with whom: the child (when several are shown), the group, the teacher. */
function LessonWho({ lesson, ctx }: { lesson: PortalLesson; ctx: ViewCtx }) {
  const t = COPY[ctx.lang];
  const name = ctx.nameOf.get(lesson.child_id) ?? "";
  const hue = ctx.hueOf.get(lesson.child_id) ?? HUES[0];
  const line = [lesson.kind === "GROUP" ? `${t.group}: ${lesson.group_name ?? ""}` : null, lesson.teacher].filter(Boolean).join(" · ");

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2.5">
      {ctx.showChild && <Avatar name={name} hue={hue} size="sm" />}
      <div className="min-w-0">
        {ctx.showChild && <p className="truncate text-sm font-semibold text-slate-900">{name}</p>}
        <p className={`truncate ${ctx.showChild ? "text-xs text-slate-500" : "text-sm font-medium text-slate-800"}`}>{line || "—"}</p>
      </div>
    </div>
  );
}

function RecentLesson({ lesson, ctx }: { lesson: PortalLesson; ctx: ViewCtx }) {
  const { lang, tz } = ctx;
  const t = COPY[lang];
  const hasReport = (lesson.report?.length ?? 0) > 0 || !!lesson.topic || !!lesson.homework;

  return (
    <li className="px-4 py-3" data-testid="parent-recent">
      <div className="flex items-center gap-3">
        <div className="w-16 shrink-0 text-center">
          <p className="text-xs font-bold text-slate-900">{shortDate(lesson.starts_at, tz, lang)}</p>
          <p className="text-[11px] text-slate-500 tabular-nums">{timeText(lesson.starts_at, tz, lang)}</p>
        </div>
        <span className="h-9 w-px shrink-0 bg-slate-200" aria-hidden />
        <LessonWho lesson={lesson} ctx={ctx} />
        <Pill tone={STATUS_TONE[lesson.status]}>{t.status[lesson.status]}</Pill>
      </div>
      {hasReport && (
        <details className="group mt-2.5 rounded-xl bg-slate-50 ring-1 ring-slate-100 ring-inset">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-semibold text-emerald-800 [&::-webkit-details-marker]:hidden">
            <span className="inline-flex items-center gap-1.5">
              <NotebookPen className="size-3.5" aria-hidden />
              {t.report}
            </span>
            <ChevronDown className="size-4 text-slate-400 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <div className="border-t border-slate-200/70 px-3 py-2.5">
            <ReportBody lesson={lesson} lang={lang} />
          </div>
        </details>
      )}
    </li>
  );
}

// ── Reports ─────────────────────────────────────────────────────────────────

function ReportBody({ lesson, lang }: { lesson: PortalLesson; lang: Lang }) {
  const t = COPY[lang];
  const rows: { label: string; field?: PortalReportField; text?: string }[] = [
    ...(lesson.report ?? []).map((f) => ({ label: lang === "ar" ? f.label_ar : f.label_en, field: f })),
    ...(lesson.topic ? [{ label: t.topic, text: lesson.topic }] : []),
    ...(lesson.homework ? [{ label: t.homework, text: lesson.homework }] : []),
  ];

  return (
    <dl className="space-y-2.5">
      {rows.map((row, i) => (
        <div key={i}>
          <dt className="text-[11px] font-semibold text-slate-500">{row.label}</dt>
          <dd className="mt-0.5 text-sm text-slate-800">
            {row.field ? <FieldValue field={row.field} /> : <span className="whitespace-pre-line">{row.text}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** A score out of five reads as stars; everything else as the teacher wrote it. */
function FieldValue({ field }: { field: PortalReportField }) {
  const n = Number(field.value);
  if (field.type === "RATING" && Number.isFinite(n) && n > 0 && n <= 5) {
    const filled = Math.round(n);
    return (
      <span className="inline-flex items-center gap-0.5" aria-label={`${field.value} / 5`}>
        {[1, 2, 3, 4, 5].map((i) => (
          <Star key={i} className={`size-4 ${i <= filled ? "fill-amber-400 text-amber-400" : "text-slate-300"}`} aria-hidden />
        ))}
      </span>
    );
  }
  return <span className={field.type === "TEXTAREA" ? "whitespace-pre-line" : undefined}>{field.value}</span>;
}

function ReportsTab({ progress, lessons: withReports, ctx }: { progress: PortalProgressReport[]; lessons: PortalLesson[]; ctx: ViewCtx }) {
  const { lang, tz } = ctx;
  const t = COPY[lang];

  if (progress.length === 0 && withReports.length === 0) return <Empty>{t.noReports}</Empty>;

  return (
    <div className="space-y-8">
      {progress.length > 0 && (
        <section>
          <SectionTitle icon={FileText}>{t.monthlyReports}</SectionTitle>
          <div className="space-y-3">
            {progress.map((r) => {
              const name = ctx.nameOf.get(r.child_id) ?? "";
              return (
                <article key={r.id} className={`${CARD} overflow-hidden`} data-testid="parent-progress-report">
                  <div className="flex items-center gap-3 border-b border-slate-100 bg-gradient-to-l from-amber-50/60 to-emerald-50/60 px-4 py-3">
                    <Avatar name={name} hue={ctx.hueOf.get(r.child_id) ?? HUES[0]} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-slate-900">{name}</p>
                      <p className="truncate text-xs text-slate-500">
                        {[yearMonthText(r.month, lang), r.teacher].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                  </div>
                  <div className="px-4 py-3.5">
                    <h3 className="text-[15px] font-bold text-slate-900">{r.title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed whitespace-pre-line text-slate-700">{r.body}</p>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {withReports.length > 0 && (
        <section>
          <SectionTitle icon={NotebookPen}>{t.lessonReports}</SectionTitle>
          <div className="space-y-3">
            {withReports.map((l) => (
              <article key={`${l.kind}-${l.id}`} className={`${CARD} p-4`} data-testid="parent-lesson-report">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Avatar name={ctx.nameOf.get(l.child_id) ?? ""} hue={ctx.hueOf.get(l.child_id) ?? HUES[0]} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {ctx.nameOf.get(l.child_id)} · {dateText(l.starts_at, tz, lang)}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {[l.kind === "GROUP" ? l.group_name : null, l.teacher].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                  </div>
                  <Pill tone={STATUS_TONE[l.status]}>{t.status[l.status]}</Pill>
                </div>
                <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2.5">
                  <ReportBody lesson={l} lang={lang} />
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ── Invoices ────────────────────────────────────────────────────────────────

function InvoicesTab({
  invoices,
  balance,
  lang,
}: {
  invoices: PortalInvoice[];
  balance: PortalPayload["balance"];
  lang: Lang;
}) {
  const t = COPY[lang];

  return (
    <div className="space-y-4">
      {balance.length > 0 ? (
        <div className="flex items-center gap-3 rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200/80">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-400 text-amber-950">
            <Wallet className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-medium text-amber-900/80">{t.outstanding}</p>
            <p className="text-xl font-bold text-amber-950 tabular-nums">
              {balance.map((b) => money(b.due_minor, b.currency, lang)).join(" + ")}
            </p>
          </div>
        </div>
      ) : invoices.length > 0 ? (
        <div className="flex items-center gap-3 rounded-2xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-900 ring-1 ring-emerald-200/80">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white">
            <Check className="size-5" aria-hidden />
          </span>
          {t.settled}
        </div>
      ) : null}

      {invoices.length === 0 ? (
        <Empty>{t.noInvoices}</Empty>
      ) : (
        <ul className="space-y-3">
          {invoices.map((inv) => {
            const month = monthText(inv.period_year, inv.period_month, lang);
            const sub = [
              inv.title ? month : null,
              inv.child_name,
              inv.lesson_count > 0 ? lessons(inv.lesson_count, lang) : null,
              inv.running ? t.running : null,
            ].filter(Boolean);
            const pct = inv.total_minor > 0 ? Math.round((inv.paid_minor / inv.total_minor) * 100) : 0;

            return (
              <li key={inv.id} className={`${CARD} p-4`} data-testid="parent-invoice">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold text-slate-900">{inv.title ?? `${t.monthBill} ${month}`}</p>
                    {sub.length > 0 && <p className="mt-0.5 text-xs text-slate-500">{sub.join(" · ")}</p>}
                  </div>
                  <Pill tone={INVOICE_TONE[inv.state]}>{t.invoiceState[inv.state]}</Pill>
                </div>

                <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className="text-lg font-bold text-slate-900 tabular-nums">{money(inv.total_minor, inv.currency, lang)}</p>
                    {inv.state === "PARTIAL" && (
                      <p className="text-xs text-slate-500">
                        {t.paidOf(money(inv.paid_minor, inv.currency, lang), money(inv.total_minor, inv.currency, lang))}
                      </p>
                    )}
                  </div>
                  <a
                    href={inv.url}
                    className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                      inv.due_minor > 0
                        ? "bg-emerald-700 text-white shadow-sm hover:bg-emerald-800"
                        : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    {inv.due_minor > 0 ? <Wallet className="size-4" aria-hidden /> : <Receipt className="size-4" aria-hidden />}
                    {inv.due_minor > 0 ? t.pay : t.view}
                  </a>
                </div>

                {inv.state === "PARTIAL" && (
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-sky-500" style={{ width: `${pct}%` }} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
