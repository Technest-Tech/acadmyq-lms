import {
  CalendarDays,
  Check,
  CheckCheck,
  ClipboardCheck,
  CreditCard,
  HandCoins,
  LayoutDashboard,
  Lock,
  MessageCircle,
  Receipt,
  Star,
  UserRound,
  Users,
  UsersRound,
  Wallet,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  DemoAttendance,
  DemoLessonState,
  FeatureTiles,
  HeroDemo,
} from "@/content/marketing";
import { cn } from "@/lib/utils";

/**
 * The drawn screens of the marketing site.
 *
 * Markup, not images: they are translated with the rest of the page, stay sharp at any width, flip
 * correctly in RTL, and cost nothing to load. They are DRAWINGS of the product in its modern
 * navy-and-gold look, with sample data; each one is a single `role="img"` with an `alt` that says
 * it is an example, and everything inside is hidden from assistive tech so a screen reader hears
 * one sentence, not forty fake numbers.
 */

const NAV_ICONS: LucideIcon[] = [
  LayoutDashboard,
  Users,
  UsersRound,
  CalendarDays,
  ClipboardCheck,
  Wallet,
  HandCoins,
  MessageCircle,
];

const BAR_HEIGHTS = [42, 55, 50, 66, 74, 90];

const LESSON_TONE: Record<DemoLessonState, string> = {
  done: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  live: "bg-amber-50 text-amber-800 ring-amber-200",
  next: "bg-slate-100 text-slate-600 ring-slate-200",
};

/** The sample academy's logo: a gold tile with the khatam star the Quran workspace is known for. */
function AcademyMark({ className }: { className?: string }) {
  return (
    <span className={cn("bg-gold flex shrink-0 items-center justify-center", className)}>
      <svg viewBox="0 0 24 24" className="size-[62%]" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="6" y="6" width="12" height="12" className="text-gold-foreground" />
        <rect x="6" y="6" width="12" height="12" transform="rotate(45 12 12)" className="text-gold-foreground" />
      </svg>
    </span>
  );
}

/** The hero: the academy dashboard in a browser window, with three events floating around it. */
export function HeroDemoPicture({
  demo,
  floating = true,
}: {
  demo: HeroDemo;
  /** The three event cards around the window. Off where the drawing sits in a narrow column. */
  floating?: boolean;
}) {
  return (
    <figure role="img" aria-label={demo.alt} className="relative">
      {/*
        Sized by its CONTAINER, not the viewport (`@container` + `@lg:`/`@3xl:`): the same drawing
        fills the homepage's full width and the product page's half column, and lays itself out
        for whichever it is given.
      */}
      <div aria-hidden className="mk-window @container relative overflow-hidden rounded-2xl bg-white sm:rounded-3xl">
        {/* The window bar */}
        <div className="flex h-9 items-center gap-3 border-b border-slate-200/80 bg-slate-50 px-3 @lg:h-11 @lg:px-4">
          <div className="flex gap-1.5">
            <span className="size-2.5 rounded-full bg-rose-300" />
            <span className="size-2.5 rounded-full bg-amber-300" />
            <span className="size-2.5 rounded-full bg-emerald-300" />
          </div>
          <div
            dir="ltr"
            className="mx-auto flex h-6 w-full max-w-[16rem] items-center justify-center gap-1.5 rounded-md bg-white text-[11px] text-slate-500 ring-1 ring-slate-200"
          >
            <Lock className="size-3" />
            {demo.url}
          </div>
          <div className="w-10" />
        </div>

        <div className="flex">
          {/* The sidebar */}
          <div className="bg-ink hidden w-44 shrink-0 flex-col gap-1 p-3 @3xl:flex @5xl:w-48">
            <div className="mb-3 flex items-center gap-2 px-1.5 pt-1">
              <AcademyMark className="size-8 rounded-lg" />
              <span className="truncate text-[13px] font-bold text-white">{demo.academy}</span>
            </div>
            {demo.nav.map((label, i) => {
              const NavIcon = NAV_ICONS[i % NAV_ICONS.length] ?? LayoutDashboard;
              return (
                <div
                  key={label}
                  className={cn(
                    "relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12.5px]",
                    i === 0 ? "bg-white/10 font-bold text-white" : "text-white/60",
                  )}
                >
                  {i === 0 ? (
                    <span className="bg-gold absolute inset-y-1.5 start-0 w-0.5 rounded-full" />
                  ) : null}
                  <NavIcon className="size-4 shrink-0" />
                  {label}
                </div>
              );
            })}
          </div>

          {/* The page */}
          <div className="min-w-0 flex-1 bg-[oklch(0.975_0.006_255)] p-3 @lg:p-5">
            <div className="relative overflow-hidden rounded-xl bg-[linear-gradient(120deg,oklch(0.93_0.03_255),oklch(0.97_0.01_255))] p-4 ring-1 ring-[oklch(0.9_0.025_255)] @lg:p-5">
              <p className="text-ink text-[15px] font-extrabold @lg:text-lg">{demo.hello}</p>
              <p className="mt-1 text-[11.5px] text-slate-600 @lg:text-[13px]">{demo.helloSub}</p>
              <svg
                viewBox="0 0 120 60"
                className="absolute end-3 top-1/2 hidden h-14 -translate-y-1/2 opacity-80 @lg:block"
              >
                <rect x="34" y="10" width="40" height="40" rx="3" fill="none" stroke="#C99A2E" strokeOpacity=".45" />
                <rect x="34" y="10" width="40" height="40" rx="3" fill="none" stroke="#C99A2E" strokeOpacity=".45" transform="rotate(45 54 30)" />
                <circle cx="54" cy="30" r="6" fill="#E2B550" fillOpacity=".7" />
                <circle cx="100" cy="16" r="3" fill="#5B7FB8" fillOpacity=".5" />
                <circle cx="12" cy="44" r="2.5" fill="#5B7FB8" fillOpacity=".5" />
              </svg>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 @lg:gap-3 @xl:grid-cols-4">
              {demo.kpis.map((kpi, i) => (
                <div key={kpi.label} className="rounded-xl bg-white p-3 ring-1 ring-slate-200/80">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[10.5px] text-slate-500 @lg:text-[11.5px]">{kpi.label}</span>
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        i === 2 ? "bg-gold" : "bg-[oklch(0.55_0.1_258)]",
                      )}
                    />
                  </div>
                  <div className="mt-1.5 flex items-baseline justify-between gap-2">
                    <span dir="ltr" className="text-ink text-base font-extrabold @lg:text-xl">
                      {kpi.value}
                    </span>
                    <span dir={/^[+−-]/.test(kpi.delta) ? "ltr" : undefined} className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                      {kpi.delta}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-3 grid gap-2 @lg:gap-3 @xl:grid-cols-5">
              <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200/80 @lg:p-4 @xl:col-span-3">
                <p className="text-ink text-[12.5px] font-bold">{demo.chartTitle}</p>
                <div className="mt-3 flex h-28 gap-2 border-b border-slate-200 pb-px @lg:h-32 @lg:gap-3">
                  {BAR_HEIGHTS.map((h, i) => (
                    <div key={i} className="flex h-full flex-1 flex-col items-center justify-end">
                      <div
                        className={cn(
                          "w-full max-w-9 rounded-t-md",
                          i === BAR_HEIGHTS.length - 1
                            ? "bg-[linear-gradient(180deg,#F0CB6E,#C99A2E)]"
                            : "bg-[linear-gradient(180deg,oklch(0.62_0.1_258),oklch(0.45_0.1_262))]",
                        )}
                        style={{ height: `${h}%` }}
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-1.5 flex gap-2 @lg:gap-3">
                  {demo.chartMonths.map((m) => (
                    <span key={m} className="flex-1 text-center text-[10px] text-slate-500">
                      {m}
                    </span>
                  ))}
                </div>
              </div>

              <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200/80 @lg:p-4 @xl:col-span-2">
                <p className="text-ink text-[12.5px] font-bold">{demo.todayTitle}</p>
                <ul className="mt-2.5 flex flex-col gap-2">
                  {demo.lessons.map((lesson) => (
                    <li
                      key={lesson.who}
                      className="flex items-center gap-2.5 rounded-lg bg-slate-50 px-2.5 py-2 ring-1 ring-slate-100"
                    >
                      <span className="text-ink w-12 shrink-0 text-[10.5px] font-bold">{lesson.time}</span>
                      <span className="min-w-0 flex-1">
                        <span className="text-ink block truncate text-[11.5px] font-bold">{lesson.who}</span>
                        <span className="block truncate text-[10px] text-slate-500">{lesson.teacher}</span>
                      </span>
                      <span
                        className={cn(
                          "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1",
                          LESSON_TONE[lesson.state],
                        )}
                      >
                        {lesson.state === "live" ? (
                          <span className="mk-live-dot bg-gold size-1.5 rounded-full" />
                        ) : null}
                        {demo.states[lesson.state]}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* The three events around the screen — only where there is room for them beside it. */}
      {floating ? (
        <>
      <div aria-hidden className="mk-float mk-float-card absolute -top-7 end-6 hidden w-72 rounded-2xl bg-white p-3.5 lg:-end-8 lg:block">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-full bg-emerald-500 text-white">
            <MessageCircle className="size-4.5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center justify-between gap-2">
              <span className="text-ink text-[12.5px] font-bold">{demo.whatsapp.app}</span>
              <span className="text-[10.5px] text-slate-400">{demo.whatsapp.time}</span>
            </span>
            <span className="mt-0.5 block text-[12px] leading-snug text-slate-600">{demo.whatsapp.text}</span>
          </span>
        </div>
      </div>

      <div aria-hidden className="mk-float mk-float--late mk-float-card absolute -bottom-10 end-10 hidden items-center gap-3 rounded-2xl bg-white p-3.5 pe-5 lg:end-20 lg:flex">
        <span className="bg-gold/20 text-gold-foreground flex size-10 items-center justify-center rounded-xl">
          <Receipt className="size-5" />
        </span>
        <span>
          <span className="text-ink block text-[13px] font-bold">{demo.payment.title}</span>
          <span className="block text-[12px] text-slate-500">{demo.payment.body}</span>
        </span>
      </div>

      <div aria-hidden className="mk-float mk-float--later mk-float-card absolute -start-12 top-[46%] hidden items-center gap-3 rounded-2xl bg-white p-3.5 pe-5 xl:flex">
        <span className="flex size-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
          <ClipboardCheck className="size-5" />
        </span>
        <span>
          <span className="text-ink block text-[13px] font-bold">{demo.marked.title}</span>
          <span className="block text-[12px] text-slate-500">{demo.marked.body}</span>
        </span>
      </div>
        </>
      ) : null}
    </figure>
  );
}

/* ── The feature grid's small screens ─────────────────────────────────────────────────────── */

const BLOCK_TONE = {
  navy: "bg-[oklch(0.93_0.03_258)] text-[oklch(0.38_0.1_262)] ring-[oklch(0.86_0.05_258)]",
  gold: "bg-amber-50 text-amber-800 ring-amber-200",
  sky: "bg-sky-50 text-sky-700 ring-sky-200",
} as const;

const ATTENDANCE_TONE: Record<DemoAttendance, string> = {
  present: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  absent: "bg-rose-50 text-rose-700 ring-rose-200",
  pending: "bg-amber-50 text-amber-800 ring-amber-200",
};

const ATTENDANCE_ICON: Record<DemoAttendance, LucideIcon> = {
  present: Check,
  absent: X,
  pending: ClipboardCheck,
};

export function ScheduleDemo({ demo }: { demo: FeatureTiles["schedule"]["demo"] }) {
  return (
    <div aria-hidden className="grid gap-3 sm:grid-cols-[1.25fr_1fr]">
      <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200/80">
        <div
          className="grid gap-1.5"
          style={{ gridTemplateColumns: `repeat(${demo.days.length}, minmax(0, 1fr))`, gridTemplateRows: "auto repeat(3, 2.1rem)" }}
        >
          {demo.days.map((day, i) => (
            <span
              key={day}
              className="truncate pb-1 text-center text-[10.5px] font-bold text-slate-500"
              style={{ gridColumn: i + 1, gridRow: 1 }}
            >
              {day}
            </span>
          ))}
          {demo.days.map((day, d) =>
            [0, 1, 2].map((r) => (
              <span
                key={`${day}-${r}`}
                className="rounded-md border border-dashed border-slate-200"
                style={{ gridColumn: d + 1, gridRow: r + 2 }}
              />
            )),
          )}
          {demo.blocks.map((block, i) => (
            <span
              key={i}
              className={cn(
                "flex items-center justify-center truncate rounded-md px-1 text-[10.5px] font-bold ring-1",
                BLOCK_TONE[block.tone],
              )}
              style={{ gridColumn: block.day + 1, gridRow: block.row + 2 }}
            >
              {block.label}
            </span>
          ))}
        </div>
      </div>

      <ul className="flex flex-col gap-2">
        {demo.rows.map((row) => {
          const StateIcon = ATTENDANCE_ICON[row.state];
          return (
            <li key={row.name} className="flex items-center gap-2.5 rounded-xl bg-white px-3 py-2.5 ring-1 ring-slate-200/80">
              <span className="min-w-0 flex-1">
                <span className="text-ink block truncate text-[12px] font-bold">{row.name}</span>
                <span className="block text-[10.5px] text-slate-500">{row.time}</span>
              </span>
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold ring-1",
                  ATTENDANCE_TONE[row.state],
                )}
              >
                <StateIcon className="size-3" strokeWidth={3} />
                {demo.states[row.state]}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function WhatsAppDemo({ demo }: { demo: FeatureTiles["whatsapp"]["demo"] }) {
  return (
    <div aria-hidden className="overflow-hidden rounded-xl ring-1 ring-slate-200/80">
      <div className="flex items-center gap-2.5 bg-[oklch(0.42_0.08_165)] px-3 py-2.5 text-white">
        <AcademyMark className="size-8 rounded-full" />
        <span className="min-w-0">
          <span className="block truncate text-[12.5px] font-bold">{demo.contact}</span>
          <span className="block text-[10.5px] text-white/75">{demo.status}</span>
        </span>
      </div>
      <div className="mk-chat flex flex-col gap-2 p-3">
        {demo.messages.map((message) => (
          <div
            key={message.time}
            className="max-w-[88%] rounded-xl rounded-ss-sm bg-white px-3 py-2 text-[12px] leading-relaxed text-slate-700 shadow-sm"
          >
            {message.text}
            <span className="mt-1 flex items-center justify-end gap-1 text-[10px] text-slate-400">
              {message.time}
              <CheckCheck className="size-3.5 text-sky-500" />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MoneyDemo({ demo }: { demo: FeatureTiles["money"]["demo"] }) {
  return (
    <div aria-hidden className="grid gap-3 sm:grid-cols-[1.1fr_1fr]">
      <div className="relative rounded-xl bg-white p-4 ring-1 ring-slate-200/80">
        <div className="flex items-center justify-between">
          <span className="text-ink flex items-center gap-2 text-[12.5px] font-bold">
            <Receipt className="text-primary size-4" />
            {demo.title}
          </span>
          <span dir="ltr" className="text-[11px] font-bold text-slate-400">
            {demo.number}
          </span>
        </div>
        <dl className="mt-3 flex flex-col gap-1.5 border-t border-dashed border-slate-200 pt-3">
          {demo.lines.map((line) => (
            <div key={line.label} className="flex items-center justify-between gap-3 text-[11.5px]">
              <dt className="text-slate-500">{line.label}</dt>
              <dd className="text-ink font-bold">{line.value}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-3 flex items-end justify-between border-t border-slate-200 pt-3">
          <span className="text-[11px] text-slate-500">{demo.totalLabel}</span>
          <span className="text-ink text-xl font-extrabold">{demo.total}</span>
        </div>
        <span className="absolute -top-2.5 end-4 flex size-7 items-center justify-center rounded-full bg-emerald-500 text-white shadow-md ring-4 ring-white">
          <Check className="size-4" strokeWidth={3} />
        </span>
      </div>

      <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200/80">
        <p className="text-ink text-[12px] font-bold">{demo.duesTitle}</p>
        <ul className="mt-2 flex flex-col gap-1.5">
          {demo.dues.map((due) => (
            <li key={due.name} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-2">
              <span className="text-ink truncate text-[11.5px] font-bold">{due.name}</span>
              <span className="flex shrink-0 items-center gap-1.5">
                {due.late ? (
                  <span className="rounded-full bg-rose-50 px-1.5 py-0.5 text-[9.5px] font-bold text-rose-700 ring-1 ring-rose-200">
                    {demo.lateLabel}
                  </span>
                ) : null}
                <span className="text-[11.5px] font-bold text-slate-700">{due.value}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function PortalDemo({ demo }: { demo: FeatureTiles["portal"]["demo"] }) {
  return (
    <div aria-hidden className="flex justify-center">
      <div className="border-ink w-full max-w-[15.5rem] overflow-hidden rounded-[2rem] border-[7px] bg-white shadow-[0_20px_40px_-20px_oklch(0.2_0.05_264/0.5)]">
        <div className="bg-ink px-4 pt-3 pb-5 text-white">
          <div className="mx-auto mb-3 h-1.5 w-14 rounded-full bg-white/20" />
          <p className="text-[12.5px] font-bold">{demo.greeting}</p>
          <span className="bg-gold/20 text-gold mt-2 inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-bold">
            {demo.child}
          </span>
        </div>
        <div className="-mt-3 flex flex-col gap-2 rounded-t-2xl bg-white px-3 pt-3 pb-4">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-[oklch(0.95_0.02_258)] p-2.5">
              <p className="text-[9.5px] text-slate-500">{demo.nextLabel}</p>
              <p className="text-ink mt-0.5 text-[11.5px] font-bold">{demo.next}</p>
            </div>
            <div className="rounded-xl bg-emerald-50 p-2.5">
              <p className="text-[9.5px] text-slate-500">{demo.balanceLabel}</p>
              <p className="mt-0.5 text-[11.5px] font-bold text-emerald-700">{demo.balance}</p>
            </div>
          </div>
          <p className="text-ink mt-1 text-[11px] font-bold">{demo.lessonsTitle}</p>
          <ul className="flex flex-col gap-1.5">
            {demo.lessons.map((lesson) => (
              <li key={lesson.date} className="flex items-center justify-between rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px]">
                <span className="text-slate-600">{lesson.date}</span>
                <span className="inline-flex items-center gap-1 font-bold text-emerald-700">
                  <Check className="size-3" strokeWidth={3} />
                  {lesson.state}
                </span>
              </li>
            ))}
          </ul>
          <span className="bg-gold text-gold-foreground mt-1 flex h-9 items-center justify-center gap-1.5 rounded-xl text-[12px] font-bold">
            <CreditCard className="size-3.5" />
            {demo.pay}
          </span>
        </div>
      </div>
    </div>
  );
}

export function PayrollDemo({ demo }: { demo: FeatureTiles["payroll"]["demo"] }) {
  return (
    <div aria-hidden className="rounded-xl bg-white p-4 ring-1 ring-slate-200/80">
      <div className="flex items-center gap-2.5">
        <span className="bg-ink text-gold flex size-9 items-center justify-center rounded-full">
          <UserRound className="size-4.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="text-ink block truncate text-[12.5px] font-bold">{demo.teacher}</span>
          <span className="block text-[10.5px] text-slate-500">{demo.month}</span>
        </span>
      </div>
      <div className="mt-3 flex gap-1.5">
        {demo.types.map((type, i) => (
          <span
            key={type}
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-bold ring-1",
              i === 0 ? "bg-ink text-white ring-transparent" : "bg-white text-slate-500 ring-slate-200",
            )}
          >
            {type}
          </span>
        ))}
      </div>
      <dl className="mt-3 flex flex-col gap-1.5">
        {demo.lines.map((line) => (
          <div key={line.label} className="flex items-center justify-between text-[11.5px]">
            <dt className="text-slate-500">{line.label}</dt>
            <dd
              dir="ltr"
              className={cn(
                "font-bold",
                line.value.startsWith("+") && "text-emerald-600",
                line.value.startsWith("−") && "text-rose-600",
                !/^[+−]/.test(line.value) && "text-ink",
              )}
            >
              {line.value}
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex items-center justify-between rounded-lg bg-[oklch(0.95_0.02_258)] px-3 py-2">
        <span className="text-[11px] font-bold text-slate-600">{demo.totalLabel}</span>
        <span className="text-ink text-base font-extrabold">{demo.total}</span>
      </div>
    </div>
  );
}

export function ReportDemo({ demo }: { demo: FeatureTiles["reports"]["demo"] }) {
  return (
    <div aria-hidden className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-200/80">
      <div className="bg-ink relative px-4 py-3 text-white">
        <span className="bg-gold absolute inset-x-0 bottom-0 h-0.5" />
        <p className="text-gold text-[10.5px] font-bold">{demo.title}</p>
        <p className="text-[13px] font-bold">{demo.student}</p>
      </div>
      <ul className="flex flex-col gap-2 px-4 pt-3">
        {demo.rows.map((row) => (
          <li key={row.label} className="flex items-center justify-between text-[11.5px]">
            <span className="text-slate-600">{row.label}</span>
            <span className="flex gap-0.5">
              {[0, 1, 2, 3, 4].map((i) => (
                <Star
                  key={i}
                  className={cn(
                    "size-3.5",
                    i < row.stars ? "fill-[#E2B550] text-[#E2B550]" : "fill-slate-100 text-slate-200",
                  )}
                />
              ))}
            </span>
          </li>
        ))}
      </ul>
      <p className="m-3 rounded-lg bg-amber-50/70 px-3 py-2 text-[11.5px] leading-relaxed text-amber-900">
        {demo.note}
      </p>
    </div>
  );
}
