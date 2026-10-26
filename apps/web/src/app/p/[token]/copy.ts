/**
 * The parent page's words and number/date formatting. Deliberately NOT next-intl: the page's
 * language is the PARENT's choice (`?lang=`), not the staff locale cookie that drives the app — the
 * same reason the report card keeps its own copy.
 */
import type { PortalInvoice, PortalLessonStatus } from "@/lib/portal-api";
import { formatMoney } from "@/lib/money";

export type Lang = "ar" | "en";

/** The parent's language choice, remembered by the switch on the page — never the staff locale. */
export const PARENT_LANG_COOKIE = "parent_lang";

export function isLang(value: unknown): value is Lang {
  return value === "ar" || value === "en";
}

/** Arabic shows Arabic-Indic digits, like the invoice page the parent also receives. */
function locale(lang: Lang): string {
  return lang === "ar" ? "ar-EG-u-nu-arab" : "en-GB";
}

export function num(n: number, lang: Lang): string {
  return new Intl.NumberFormat(locale(lang), { maximumFractionDigits: 1 }).format(n);
}

export function money(minor: number, currency: string, lang: Lang): string {
  return formatMoney({ amount: minor, currency }, lang, { trimZeroDecimals: true });
}

/** Arabic counts agree with the number (حصة / حصتان / ٣ حصص / ١١ حصة), so plurals are ruled. */
function counted(n: number, lang: Lang, ar: { one: string; two: string; few: string; many: string }, en: [string, string]): string {
  if (lang === "en") return `${num(n, lang)} ${n === 1 ? en[0] : en[1]}`;
  switch (new Intl.PluralRules("ar").select(n)) {
    case "one":
      return ar.one;
    case "two":
      return ar.two;
    case "few":
      return `${num(n, lang)} ${ar.few}`;
    default:
      return `${num(n, lang)} ${ar.many}`;
  }
}

export function lessons(n: number, lang: Lang): string {
  return counted(n, lang, { one: "حصة واحدة", two: "حصتان", few: "حصص", many: "حصة" }, ["lesson", "lessons"]);
}

export function hours(minutes: number, lang: Lang): string {
  const h = Math.round((minutes / 60) * 10) / 10;
  if (!Number.isInteger(h)) return lang === "ar" ? `${num(h, lang)} ساعة` : `${num(h, lang)} hrs`;
  return counted(h, lang, { one: "ساعة واحدة", two: "ساعتان", few: "ساعات", many: "ساعة" }, ["hour", "hours"]);
}

export function minutesText(n: number, lang: Lang): string {
  return lang === "ar" ? `${num(n, lang)} دقيقة` : `${num(n, lang)} min`;
}

// ── Dates & times, in the viewer's own time zone ────────────────────────────

/** "2026-06-18" for an instant in `tz` — the key lessons are grouped by. */
export function dayKey(iso: string | number, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(iso),
  );
}

export function timeText(iso: string, tz: string, lang: Lang): string {
  return new Intl.DateTimeFormat(locale(lang), { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

export function dateText(iso: string, tz: string, lang: Lang, withWeekday = true): string {
  return new Intl.DateTimeFormat(locale(lang), {
    timeZone: tz,
    weekday: withWeekday ? "long" : undefined,
    day: "numeric",
    month: "long",
  }).format(new Date(iso));
}

/** "15 Sept" — for the narrow date column of the lesson history. */
export function shortDate(iso: string, tz: string, lang: Lang): string {
  return new Intl.DateTimeFormat(locale(lang), { timeZone: tz, day: "numeric", month: "short" }).format(new Date(iso));
}

/** "Today" / "Tomorrow" / "Thursday 19 June" — how a parent thinks about the week ahead. */
export function dayLabel(iso: string, tz: string, now: number, lang: Lang): string {
  const key = dayKey(iso, tz);
  if (key === dayKey(now, tz)) return COPY[lang].today;
  if (key === dayKey(now + 86_400_000, tz)) return COPY[lang].tomorrow;
  return dateText(iso, tz, lang);
}

export function monthText(year: number, month: number, lang: Lang): string {
  return new Intl.DateTimeFormat(locale(lang), { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
}

/** "2026-05" → "May 2026". */
export function yearMonthText(ym: string, lang: Lang): string {
  const [y, m] = ym.split("-").map(Number);
  return monthText(y ?? 1970, m ?? 1, lang);
}

// ── The words ────────────────────────────────────────────────────────────────

type Copy = {
  hello: (name: string) => string;
  intro: (academy: string) => string;
  otherLang: string;
  children: string;
  nextLesson: string;
  noNextLesson: string;
  outstanding: string;
  nothingDue: string;
  thisMonth: string;
  attended: string;
  absent: string;
  hoursLabel: string;
  /** Between names in a list. */
  comma: string;
  all: string;
  tabs: { lessons: string; reports: string; invoices: string };
  comingUp: string;
  recent: string;
  noUpcoming: string;
  noRecent: string;
  today: string;
  tomorrow: string;
  group: string;
  hoursLeft: (left: string, total: string) => string;
  expires: (date: string) => string;
  status: Record<PortalLessonStatus, string>;
  report: string;
  topic: string;
  homework: string;
  monthlyReports: string;
  lessonReports: string;
  noReports: string;
  invoiceState: Record<PortalInvoice["state"], string>;
  running: string;
  paidOf: (paid: string, total: string) => string;
  pay: string;
  view: string;
  monthBill: string;
  noInvoices: string;
  settled: string;
  noChildren: string;
  timesNote: string;
  privateNote: string;
};

export const COPY: Record<Lang, Copy> = {
  ar: {
    hello: (name) => `أهلاً، ${name}`,
    intro: (academy) => `كل ما يخص أبناءك في ${academy}، في مكان واحد.`,
    otherLang: "English",
    children: "الأبناء",
    nextLesson: "الحصة القادمة",
    noNextLesson: "لا توجد حصص قريبة",
    outstanding: "المبلغ المستحق",
    nothingDue: "لا توجد مستحقات",
    thisMonth: "هذا الشهر",
    attended: "حضور",
    absent: "غياب",
    hoursLabel: "ساعات",
    comma: "، ",
    all: "الكل",
    tabs: { lessons: "الحصص", reports: "التقارير", invoices: "الفواتير" },
    comingUp: "الحصص القادمة",
    recent: "الحصص السابقة",
    noUpcoming: "لا توجد حصص في الأسبوعين القادمين.",
    noRecent: "لا توجد حصص مسجّلة في آخر شهرين.",
    today: "اليوم",
    tomorrow: "غداً",
    group: "مجموعة",
    hoursLeft: (left, total) => `متبقٍ ${left} من ${total}`,
    expires: (date) => `تنتهي ${date}`,
    status: {
      SCHEDULED: "قادمة",
      ATTENDED: "حضر",
      LATE: "حضر متأخراً",
      ABSENT: "غاب",
      EXCUSED: "غياب بعذر",
      CANCELLED: "أُلغيت",
      CANCELLED_BY_TEACHER: "ألغاها المعلّم",
      CANCELLED_BY_STUDENT: "أُلغيت بطلبكم",
      HELD: "تمّت",
    },
    report: "تقرير الحصة",
    topic: "ما تمّ شرحه",
    homework: "الواجب",
    monthlyReports: "التقارير الشهرية",
    lessonReports: "تقارير الحصص",
    noReports: "لا توجد تقارير بعد — ستظهر هنا أول ما يكتبها المعلّم.",
    invoiceState: { PAID: "مدفوعة", PARTIAL: "مدفوعة جزئياً", UNPAID: "غير مدفوعة" },
    running: "الشهر الجاري",
    paidOf: (paid, total) => `دُفع ${paid} من ${total}`,
    pay: "ادفع الآن",
    view: "عرض",
    monthBill: "فاتورة شهر",
    noInvoices: "لا توجد فواتير بعد.",
    settled: "كل الفواتير مدفوعة — شكراً لكم",
    noChildren: "لا يوجد أبناء مسجّلون حالياً.",
    timesNote: "المواعيد معروضة بتوقيتك المحلي.",
    privateNote: "هذه الصفحة خاصة بعائلتك — من فضلك لا تشارك الرابط.",
  },
  en: {
    hello: (name) => `Hello, ${name}`,
    intro: (academy) => `Everything about your children at ${academy}, in one place.`,
    otherLang: "العربية",
    children: "Children",
    nextLesson: "Next lesson",
    noNextLesson: "No lessons coming up",
    outstanding: "Amount due",
    nothingDue: "Nothing due",
    thisMonth: "This month",
    attended: "Attended",
    absent: "Absent",
    hoursLabel: "Hours",
    comma: ", ",
    all: "All",
    tabs: { lessons: "Lessons", reports: "Reports", invoices: "Invoices" },
    comingUp: "Coming up",
    recent: "Recent lessons",
    noUpcoming: "No lessons in the next two weeks.",
    noRecent: "No lessons recorded in the last two months.",
    today: "Today",
    tomorrow: "Tomorrow",
    group: "Group",
    hoursLeft: (left, total) => `${left} left of ${total}`,
    expires: (date) => `Expires ${date}`,
    status: {
      SCHEDULED: "Upcoming",
      ATTENDED: "Attended",
      LATE: "Attended late",
      ABSENT: "Absent",
      EXCUSED: "Excused",
      CANCELLED: "Cancelled",
      CANCELLED_BY_TEACHER: "Cancelled by teacher",
      CANCELLED_BY_STUDENT: "Cancelled at your request",
      HELD: "Held",
    },
    report: "Lesson report",
    topic: "What was taught",
    homework: "Homework",
    monthlyReports: "Monthly reports",
    lessonReports: "Lesson reports",
    noReports: "No reports yet — they appear here as soon as the teacher writes them.",
    invoiceState: { PAID: "Paid", PARTIAL: "Partly paid", UNPAID: "Unpaid" },
    running: "This month",
    paidOf: (paid, total) => `${paid} paid of ${total}`,
    pay: "Pay now",
    view: "View",
    monthBill: "Bill for",
    noInvoices: "No invoices yet.",
    settled: "All invoices are paid — thank you",
    noChildren: "No children are enrolled at the moment.",
    timesNote: "Times are shown in your local time.",
    privateNote: "This page is private to your family — please don’t share the link.",
  },
};
