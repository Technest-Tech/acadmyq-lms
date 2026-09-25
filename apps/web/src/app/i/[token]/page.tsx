import { apiBase } from "@/lib/api-base";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatMoney } from "@/lib/money";
import type { InvoiceStatus } from "@academiq/contracts";
import {
  BookOpen,
  CalendarDays,
  Check,
  ChevronDown,
  Clock,
  GraduationCap,
  Hash,
  Lock,
  Receipt,
  ShieldCheck,
  UserRound,
  Users,
} from "lucide-react";
import { DownloadPdfButton } from "./download-pdf-button";
import { DownloadReportButton } from "./download-report-button";
import { PaymentOptions, type PublicPaymentMethod } from "./payment-options";

// ── Invoice DTO (mirrors app.public_invoice_by_token) ─────────────────────────

interface InvoiceLineItem {
  id: string;
  session_date: string | null; // ISO date "YYYY-MM-DD" (null for non-session lines)
  student_name: string | null;
  description: string;
  amount_minor: number;
  duration_minutes: number | null; // session length (null for manual/itemized lines)
  session_status: string | null; // raw session status (null for manual/itemized lines)
}

/**
 * Whether a lesson actually carried a charge. Every lesson is listed on the bill for the record
 * (#19) — attended, cancelled, free and trial — but only charged ones add to the hours/total; the
 * rest are shown as "Not charged". A zero amount is the single source of truth here (free, trial,
 * free-trial and cancelled lessons all bill at zero).
 */
function isCharged(li: InvoiceLineItem): boolean {
  return li.amount_minor > 0;
}

/** Localized headline for a non-charged lesson, derived from its session status (#19). */
function nonChargedLabel(li: InvoiceLineItem): { en: string; ar: string } {
  switch (li.session_status) {
    case "FREE":
      return { en: "Free lesson", ar: "حصة مجانية" };
    case "CANCELLED_BY_TEACHER":
      return { en: "Cancelled by teacher", ar: "ألغاها المعلّم" };
    case "CANCELLED_BY_STUDENT":
      return { en: "Cancelled by student", ar: "ألغاها الطالب" };
    case "ABSENT_UNEXCUSED":
    case "ABSENT_EXCUSED":
      return { en: "Absent", ar: "غياب" };
    default:
      // A zero-amount attended lesson is a trial / free-trial taster.
      return { en: "Trial lesson", ar: "حصة تجريبية" };
  }
}

interface PublicInvoiceDTO {
  id: string;
  status: InvoiceStatus;
  period_year: number;
  period_month: number;
  currency: string;
  subtotal_minor: number;
  total_minor: number;
  amount_paid_minor: number;
  sent_at: string | null;
  paid_at: string | null;
  payment_method: string | null;
  academy_name: string;
  payer_name: string;
  payer_whatsapp: string | null;
  payment_methods: PublicPaymentMethod[];
  line_items: InvoiceLineItem[];
}

// ── Data ──────────────────────────────────────────────────────────────────────

// `API_URL` lets a deploy point server-side fetches at an internal address; otherwise the shared
// resolver applies (and turns a port-only value into a loopback origin — there is no page host here).
const API_URL = process.env.API_URL ?? apiBase();

async function fetchInvoice(token: string): Promise<PublicInvoiceDTO | null> {
  const res = await fetch(`${API_URL}/api/i/${token}`, {
    next: { revalidate: 60 },
    headers: { Accept: "application/json" },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Invoice fetch failed: ${res.status}`);
  return res.json() as Promise<PublicInvoiceDTO>;
}

export const metadata: Metadata = {
  robots: { index: false, follow: false, nosnippet: true },
};

// ── Bilingual helpers ─────────────────────────────────────────────────────────

function T({ en, ar }: { en: string; ar: string }) {
  return (
    <>
      <span className="ltr:inline rtl:hidden">{en}</span>
      <span className="rtl:inline ltr:hidden">{ar}</span>
    </>
  );
}

function Money({ minor, currency }: { minor: number; currency: string }) {
  return (
    <T
      en={formatMoney({ amount: minor, currency }, "en")}
      ar={formatMoney({ amount: minor, currency }, "ar")}
    />
  );
}

function periodLabel(year: number, month: number, locale: "en" | "ar"): string {
  const bcp47 = locale === "ar" ? "ar-u-nu-arab" : "en-US";
  return new Intl.DateTimeFormat(bcp47, {
    month: "long",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function Period({ year, month }: { year: number; month: number }) {
  return (
    <T
      en={periodLabel(year, month, "en")}
      ar={periodLabel(year, month, "ar")}
    />
  );
}

function formatDate(iso: string, locale: "en" | "ar"): string {
  const bcp47 = locale === "ar" ? "ar-u-nu-arab" : "en-US";
  return new Intl.DateTimeFormat(bcp47, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

function DateText({ iso }: { iso: string }) {
  return <T en={formatDate(iso, "en")} ar={formatDate(iso, "ar")} />;
}

/** Minutes → localized hours string (e.g. "1.5"), Arabic-Indic digits in 'ar'. */
function hoursStr(minutes: number, locale: "en" | "ar"): string {
  const bcp47 = locale === "ar" ? "ar-u-nu-arab" : "en-US";
  return new Intl.NumberFormat(bcp47, { maximumFractionDigits: 1 }).format(
    minutes / 60,
  );
}

function Hours({ minutes }: { minutes: number }) {
  return (
    <T
      en={`${hoursStr(minutes, "en")} hr`}
      ar={`${hoursStr(minutes, "ar")} س`}
    />
  );
}

function countStr(n: number, locale: "en" | "ar"): string {
  return new Intl.NumberFormat(
    locale === "ar" ? "ar-u-nu-arab" : "en-US",
  ).format(n);
}

/** Short, human reference for the bill — what a payer quotes on a transfer or to the academy. */
function invoiceReference(id: string): string {
  return `INV-${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

/** Up to two letters for the academy's monogram tile. */
function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((w) => Array.from(w)[0] ?? "")
    .join("")
    .toUpperCase();
}

/** One child's lessons within a guardian invoice. */
interface LessonGroup {
  student: string;
  lines: InvoiceLineItem[];
  subtotal: number;
  chargedCount: number;
  minutes: number;
}

/** Groups line items by student, preserving first-seen order. */
function groupLinesByStudent(items: InvoiceLineItem[]): LessonGroup[] {
  const map = new Map<string, LessonGroup>();
  for (const li of items) {
    const key = li.student_name ?? "—";
    let group = map.get(key);
    if (!group) {
      group = {
        student: key,
        lines: [],
        subtotal: 0,
        chargedCount: 0,
        minutes: 0,
      };
      map.set(key, group);
    }
    group.lines.push(li);
    group.subtotal += li.amount_minor;
    if (isCharged(li)) {
      group.chargedCount += 1;
      group.minutes += li.duration_minutes ?? 0;
    }
  }
  return Array.from(map.values());
}

// ── Pieces ────────────────────────────────────────────────────────────────────

/**
 * A single line on the invoice. Charged lessons show their amount (and hours); non-charged lessons
 * — cancelled, free or trial — are listed for the record, muted, with a "Not charged" tag so the
 * parent sees every lesson without it being mistaken for a charge (#19).
 */
function LineItemRow({
  li,
  currency,
  showStudent,
}: {
  li: InvoiceLineItem;
  currency: string;
  showStudent: boolean;
}) {
  const charged = isCharged(li);
  const headline = charged ? null : nonChargedLabel(li);

  const sub: React.ReactNode[] = [];
  if (li.session_date) sub.push(<DateText key="d" iso={li.session_date} />);
  if (showStudent && li.student_name)
    sub.push(<span key="s">{li.student_name}</span>);
  if (charged && li.duration_minutes)
    sub.push(<Hours key="h" minutes={li.duration_minutes} />);

  return (
    <li className="flex items-center justify-between gap-4 py-3 break-inside-avoid">
      <div className="min-w-0">
        <p
          className={`text-sm font-medium ${charged ? "text-slate-800" : "text-slate-500"}`}
        >
          {headline ? <T en={headline.en} ar={headline.ar} /> : li.description}
        </p>
        {sub.length > 0 && (
          <p className="mt-0.5 text-xs text-slate-500">
            {sub.map((node, i) => (
              <span key={i}>
                {i > 0 && <span className="mx-1.5 text-slate-300">•</span>}
                {node}
              </span>
            ))}
          </p>
        )}
      </div>
      {charged ? (
        <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">
          <Money minor={li.amount_minor} currency={currency} />
        </span>
      ) : (
        <span className="shrink-0 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
          <T en="Not charged" ar="بدون رسوم" />
        </span>
      )}
    </li>
  );
}

function LineList({
  lines,
  currency,
  showStudent,
}: {
  lines: InvoiceLineItem[];
  currency: string;
  showStudent: boolean;
}) {
  return (
    <ul className="divide-y divide-slate-100">
      {lines.map((li) => (
        <LineItemRow
          key={li.id}
          li={li}
          currency={currency}
          showStudent={showStudent}
        />
      ))}
    </ul>
  );
}

const STATUS_PILL: Record<
  InvoiceStatus,
  { en: string; ar: string; className: string; dot: string }
> = {
  OPEN: {
    en: "Awaiting payment",
    ar: "بانتظار الدفع",
    className: "bg-amber-50 text-amber-800 ring-amber-200",
    dot: "bg-amber-500",
  },
  CLOSED: {
    en: "Awaiting payment",
    ar: "بانتظار الدفع",
    className: "bg-amber-50 text-amber-800 ring-amber-200",
    dot: "bg-amber-500",
  },
  PARTIALLY_PAID: {
    en: "Partially paid",
    ar: "مدفوعة جزئياً",
    className: "bg-sky-50 text-sky-800 ring-sky-200",
    dot: "bg-sky-500",
  },
  PAID: {
    en: "Paid",
    ar: "مدفوعة",
    className: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    dot: "bg-emerald-500",
  },
  VOID: {
    en: "Cancelled",
    ar: "ملغاة",
    className: "bg-slate-100 text-slate-600 ring-slate-200",
    dot: "bg-slate-400",
  },
};

function StatusPill({ status }: { status: InvoiceStatus }) {
  const s = STATUS_PILL[status] ?? STATUS_PILL.OPEN;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${s.className}`}
    >
      <span className={`size-1.5 rounded-full ${s.dot}`} aria-hidden />
      <T en={s.en} ar={s.ar} />
    </span>
  );
}

function Chip({
  icon: Icon,
  children,
}: {
  icon: typeof Clock;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-200/70">
      <Icon className="size-3.5 text-emerald-600" aria-hidden />
      {children}
    </span>
  );
}

function DetailRow({
  icon: Icon,
  labelEn,
  labelAr,
  children,
}: {
  icon: typeof Clock;
  labelEn: string;
  labelAr: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 py-3">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 print:hidden">
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 sm:flex sm:items-baseline sm:justify-between sm:gap-4">
        <dt className="text-xs text-slate-500 sm:text-sm">
          <T en={labelEn} ar={labelAr} />
        </dt>
        <dd className="mt-0.5 text-sm font-semibold text-slate-900 sm:mt-0 sm:text-end">
          {children}
        </dd>
      </div>
    </div>
  );
}

const PAID_VIA: Record<string, { en: string; ar: string }> = {
  CASH: { en: "Cash", ar: "نقداً" },
  BANK_TRANSFER: { en: "Bank transfer", ar: "تحويل بنكي" },
  PAYPAL: { en: "PayPal", ar: "باي بال" },
  XPAY: { en: "Card", ar: "بطاقة بنكية" },
};

const CARD =
  "rounded-2xl bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-16px_rgba(15,23,42,0.18)] ring-1 ring-slate-900/[0.06] print:shadow-none print:ring-0";

// ── Decoration ────────────────────────────────────────────────────────────────

function Sparkle({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={`pointer-events-none absolute ${className}`}
      aria-hidden
    >
      <path d="M12 1c.9 5.6 4.4 9.1 10 10-5.6.9-9.1 4.4-10 10-.9-5.6-4.4-9.1-10-10 5.6-.9 9.1-4.4 10-10Z" />
    </svg>
  );
}

/**
 * The page's wallpaper: a light tile of school doodles behind everything, in the spirit of a chat
 * wallpaper. It only ever shows in the gaps — every card and the header are opaque and sit above it
 * — so it adds colour without ever running under text.
 */
function Wallpaper() {
  return (
    <svg
      className="pointer-events-none fixed inset-0 size-full print:hidden"
      aria-hidden
    >
      <defs>
        <pattern
          id="invoice-doodles"
          width="188"
          height="188"
          patternUnits="userSpaceOnUse"
        >
          <g opacity="0.5" strokeLinecap="round" strokeLinejoin="round">
            <path
              transform="translate(14 16) scale(.8)"
              fill="#F59E0B"
              opacity=".45"
              d="M12 1c.9 5.6 4.4 9.1 10 10-5.6.9-9.1 4.4-10 10-.9-5.6-4.4-9.1-10-10 5.6-.9 9.1-4.4 10-10Z"
            />
            <g
              transform="translate(104 12) scale(1.1)"
              fill="none"
              stroke="#059669"
              strokeWidth="1.6"
              opacity=".4"
            >
              <path d="M3 5.5C5.5 4 8.5 4 12 6c3.5-2 6.5-2 9-.5V19c-2.5-1.5-5.5-1.5-9 .5-3.5-2-6.5-2-9-.5V5.5Z" />
              <path d="M12 6v13.5" />
            </g>
            <path
              transform="translate(58 66) scale(.7)"
              fill="#EC4899"
              opacity=".4"
              d="m12 2 2.9 6.3 6.9.7-5.2 4.6 1.5 6.8L12 17l-6.1 3.4 1.5-6.8L2.2 9l6.9-.7L12 2Z"
            />
            <circle
              cx="156"
              cy="88"
              r="8"
              fill="none"
              stroke="#0EA5E9"
              strokeWidth="2"
              opacity=".4"
            />
            <path
              transform="translate(16 112) scale(.9)"
              fill="#059669"
              opacity=".3"
              d="M15 2.5a9.5 9.5 0 1 0 6.5 16.4A8.2 8.2 0 0 1 15 2.5Z"
            />
            <path
              transform="translate(88 146)"
              fill="none"
              stroke="#F59E0B"
              strokeWidth="2.4"
              opacity=".45"
              d="M3 6c4.5-5 8.5-5 13 0s8.5 5 13 0 8.5-5 13 0"
            />
            <path
              transform="translate(152 148) scale(.6)"
              fill="none"
              stroke="#EC4899"
              strokeWidth="3.5"
              opacity=".4"
              d="M12 5v14M5 12h14"
            />
            <g fill="#0EA5E9" opacity=".35">
              <circle cx="76" cy="118" r="1.8" />
              <circle cx="84" cy="118" r="1.8" />
              <circle cx="76" cy="126" r="1.8" />
              <circle cx="84" cy="126" r="1.8" />
            </g>
            <path
              transform="translate(128 50) scale(.5)"
              fill="#F59E0B"
              opacity=".4"
              d="M12 1c.9 5.6 4.4 9.1 10 10-5.6.9-9.1 4.4-10 10-.9-5.6-4.4-9.1-10-10 5.6-.9 9.1-4.4 10-10Z"
            />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#invoice-doodles)" />
    </svg>
  );
}

/** A small burst of confetti around the paid check. */
function Confetti() {
  const bits = [
    "start-[18%] top-[18%] size-2 rotate-12 rounded-sm bg-amber-400",
    "start-[28%] top-[52%] size-1.5 rounded-full bg-pink-400",
    "start-[12%] top-[44%] h-2.5 w-1 -rotate-45 rounded-full bg-sky-400",
    "end-[18%] top-[20%] size-2 -rotate-12 rounded-sm bg-emerald-500",
    "end-[27%] top-[50%] size-1.5 rounded-full bg-amber-400",
    "end-[12%] top-[42%] h-2.5 w-1 rotate-45 rounded-full bg-pink-400",
    "start-[40%] top-[10%] size-1.5 rounded-full bg-sky-400",
    "end-[40%] top-[8%] size-1.5 rotate-45 rounded-sm bg-pink-300",
  ];
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      {bits.map((c) => (
        <span key={c} className={`absolute ${c}`} />
      ))}
      <Sparkle className="end-[22%] top-[62%] size-4 text-amber-400" />
      <Sparkle className="start-[22%] top-[66%] size-3 text-emerald-500" />
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function PublicInvoicePage({ params }: PageProps) {
  const { token } = await params;
  const invoice = await fetchInvoice(token);
  if (!invoice) notFound();

  const isPaid = invoice.status === "PAID";
  const isVoid = invoice.status === "VOID";
  const isPartial = invoice.status === "PARTIALLY_PAID";
  const reference = invoiceReference(invoice.id);
  const currency = invoice.currency;

  const balanceDue = Math.max(
    0,
    invoice.total_minor - invoice.amount_paid_minor,
  );
  const paidPct =
    invoice.total_minor > 0
      ? Math.min(
          100,
          Math.round((invoice.amount_paid_minor / invoice.total_minor) * 100),
        )
      : 0;

  // Every lesson of the month is listed for the record (#19) — attended, cancelled, free and trial —
  // in one date-ordered list. Non-charged lessons ride along at zero and so never move the
  // subtotal/total (those come straight from the server).
  const lineItems = [...invoice.line_items].sort((a, b) =>
    (a.session_date ?? "").localeCompare(b.session_date ?? ""),
  );

  // A lesson bill (monthly/per-session) vs an itemised one (quick/manual bill). Lesson bills can run
  // to dozens of lines, so on screen they collapse to a per-child summary with the full list one tap
  // away; an itemised bill is short and just lists its lines.
  const isLessonBill = lineItems.some((li) => li.session_date != null);
  const firstItem = lineItems[0];

  const students = Array.from(
    new Set(lineItems.map((li) => li.student_name).filter(Boolean) as string[]),
  );
  const studentLabel =
    students.length > 0 ? students.join("، ") : invoice.payer_name;
  const groups = groupLinesByStudent(lineItems);
  const multiStudent = students.length > 1;
  const soleStudent =
    students.length === 1 && students[0] !== invoice.payer_name
      ? students[0]
      : null;

  // Billed hours: only CHARGED lessons count, so free/cancelled/trial lessons never inflate it.
  const chargedCount = lineItems.filter(isCharged).length;
  const totalMinutes = lineItems.reduce(
    (sum, li) => sum + (isCharged(li) ? (li.duration_minutes ?? 0) : 0),
    0,
  );

  const paidVia = invoice.payment_method
    ? PAID_VIA[invoice.payment_method]
    : undefined;
  const settledTotal = isPaid || isVoid;

  // The facts, breakdown and totals. Open on desktop and in the printout; on a phone — where most
  // payers are — it folds into one row under the pay card so the page is amount → pay → done.
  const detailsBody = (
    <>
      <div className="px-5 pt-4 sm:px-7 sm:pt-6">
        <h2 className="hidden text-base font-bold text-slate-900 lg:block print:block">
          <T en="Invoice details" ar="تفاصيل الفاتورة" />
        </h2>
        <dl className="divide-y divide-slate-100 lg:mt-1">
          <DetailRow icon={UserRound} labelEn="Billed to" labelAr="فاتورة إلى">
            {invoice.payer_name}
            {invoice.payer_whatsapp && (
              <span className="block text-xs font-normal text-slate-500">
                <bdi dir="ltr">{invoice.payer_whatsapp}</bdi>
              </span>
            )}
          </DetailRow>
          {students.length > 0 && (
            <DetailRow
              icon={Users}
              labelEn={multiStudent ? "Students" : "Student"}
              labelAr={multiStudent ? "الطلاب" : "الطالب"}
            >
              {studentLabel}
            </DetailRow>
          )}
          <DetailRow
            icon={CalendarDays}
            labelEn="Billing period"
            labelAr="فترة الفوترة"
          >
            <Period year={invoice.period_year} month={invoice.period_month} />
          </DetailRow>
          {invoice.sent_at && (
            <DetailRow
              icon={CalendarDays}
              labelEn="Issued on"
              labelAr="تاريخ الإصدار"
            >
              <DateText iso={invoice.sent_at} />
            </DetailRow>
          )}
          <DetailRow icon={Hash} labelEn="Reference" labelAr="المرجع">
            <span className="font-mono" dir="ltr">
              {reference}
            </span>
          </DetailRow>
        </dl>
      </div>

      {/* Breakdown */}
      <div className="mt-1 border-t border-slate-100 px-5 py-4 sm:px-7 sm:py-5">
        <h3 className="text-sm font-semibold text-slate-900">
          {isLessonBill ? (
            <T en="Lessons this month" ar="حصص هذا الشهر" />
          ) : (
            <T en="Items" ar="البنود" />
          )}
        </h3>

        {lineItems.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">
            <T
              en="No items on this invoice."
              ar="لا توجد بنود في هذه الفاتورة."
            />
          </p>
        ) : !isLessonBill ? (
          <div className="mt-1">
            <LineList lines={lineItems} currency={currency} showStudent />
          </div>
        ) : (
          <>
            {/* Per-child summary — the at-a-glance answer to "what am I paying for". */}
            <ul className="mt-3 space-y-2">
              {groups.map((g) => (
                <li
                  key={g.student}
                  className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3.5 py-2.5 ring-1 ring-inset ring-slate-100"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white text-sm font-bold text-emerald-700 ring-1 ring-slate-200">
                      {monogram(g.student)}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {g.student}
                      </p>
                      <p className="text-xs text-slate-500">
                        <T
                          en={`${countStr(g.chargedCount, "en")} ${g.chargedCount === 1 ? "lesson" : "lessons"}`}
                          ar={`${countStr(g.chargedCount, "ar")} ${g.chargedCount === 1 ? "حصة" : "حصص"}`}
                        />
                        {g.minutes > 0 && (
                          <>
                            <span className="mx-1.5 text-slate-300">•</span>
                            <T
                              en={`${hoursStr(g.minutes, "en")} hrs`}
                              ar={`${hoursStr(g.minutes, "ar")} ساعة`}
                            />
                          </>
                        )}
                      </p>
                    </div>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">
                    <Money minor={g.subtotal} currency={currency} />
                  </span>
                </li>
              ))}
            </ul>

            {/* Full list on screen: collapsed so the bill stays uncluttered. */}
            <details className="group mt-3 rounded-xl ring-1 ring-slate-200 print:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-slate-700 hover:text-slate-900 [&::-webkit-details-marker]:hidden">
                <T
                  en={`Show all lessons (${countStr(lineItems.length, "en")})`}
                  ar={`عرض كل الحصص (${countStr(lineItems.length, "ar")})`}
                />
                <ChevronDown
                  className="size-4 text-slate-400 transition-transform group-open:rotate-180"
                  aria-hidden
                />
              </summary>
              <div className="border-t border-slate-100 px-4">
                <LineList
                  lines={lineItems}
                  currency={currency}
                  showStudent={multiStudent}
                />
              </div>
            </details>

            {/* Printout: every lesson, split per child. */}
            <div className="mt-4 hidden space-y-5 print:block">
              {groups.map((g) => (
                <div key={g.student}>
                  {multiStudent && (
                    <p className="border-b border-slate-200 pb-1.5 text-sm font-semibold text-slate-800">
                      {g.student}
                    </p>
                  )}
                  <LineList
                    lines={g.lines}
                    currency={currency}
                    showStudent={false}
                  />
                </div>
              ))}
            </div>

            <div className="mt-3 print:hidden">
              <DownloadReportButton />
            </div>
          </>
        )}
      </div>

      {/* Totals */}
      <dl className="space-y-2.5 rounded-b-2xl border-t border-slate-100 bg-slate-50/70 px-5 py-4 text-sm sm:px-7 sm:py-5 print:bg-white">
        <div className="flex justify-between gap-3">
          <dt className="text-slate-500">
            <T en="Subtotal" ar="المجموع الفرعي" />
          </dt>
          <dd className="font-medium tabular-nums text-slate-900">
            <Money minor={invoice.subtotal_minor} currency={currency} />
          </dd>
        </div>
        {invoice.total_minor !== invoice.subtotal_minor && (
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">
              <T en="Total" ar="الإجمالي" />
            </dt>
            <dd className="font-medium tabular-nums text-slate-900">
              <Money minor={invoice.total_minor} currency={currency} />
            </dd>
          </div>
        )}
        {invoice.amount_paid_minor > 0 && (
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">
              <T en="Paid" ar="المدفوع" />
            </dt>
            <dd className="font-medium tabular-nums text-emerald-700">
              −<Money minor={invoice.amount_paid_minor} currency={currency} />
            </dd>
          </div>
        )}
        <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-3">
          <dt className="font-semibold text-slate-900">
            {settledTotal ? (
              <T en="Total" ar="الإجمالي" />
            ) : (
              <T en="Balance due" ar="المبلغ المستحق" />
            )}
          </dt>
          <dd className="text-lg font-bold tabular-nums text-slate-900">
            <Money
              minor={settledTotal ? invoice.total_minor : balanceDue}
              currency={currency}
            />
          </dd>
        </div>
      </dl>
    </>
  );

  return (
    <div className="relative min-h-screen bg-slate-100 print:bg-white">
      <Wallpaper />

      <div className="relative">
        {/* ── Brand band ── just the top bar on a phone; taller on larger screens so the cards
            overlap it. */}
        <div className="relative overflow-hidden rounded-b-3xl bg-emerald-900 sm:rounded-none print:overflow-visible print:bg-transparent">
          <div
            className="absolute inset-0 bg-[radial-gradient(120%_120%_at_100%_0%,rgba(52,211,153,0.25),transparent_60%)] print:hidden"
            aria-hidden
          />
          <header className="relative mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-4 sm:px-6 sm:pb-40 sm:pt-8 print:px-0 print:pb-0 print:pt-0">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white text-sm font-bold text-emerald-800 shadow-sm sm:size-11 sm:text-base print:ring-1 print:ring-slate-200">
                {monogram(invoice.academy_name)}
              </span>
              <div className="min-w-0">
                <p className="truncate text-base font-bold text-white sm:text-lg print:text-slate-900">
                  {invoice.academy_name}
                </p>
                <p className="flex items-center gap-1 text-xs text-emerald-100/80 print:text-slate-500">
                  <Lock className="size-3" aria-hidden />
                  <T en="Secure invoice" ar="فاتورة آمنة" />
                </p>
              </div>
            </div>
            <DownloadPdfButton />
          </header>
        </div>

        <div className="relative mx-auto max-w-5xl px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4 sm:-mt-32 sm:px-6 sm:pb-12 sm:pt-0 print:mt-0 print:max-w-none print:px-0">
          <main className="grid grid-cols-1 gap-3.5 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_400px] lg:grid-rows-[auto_1fr] lg:gap-6 print:mt-6 print:block print:space-y-6">
            {/* ── Summary ── */}
            <section
              className={`${CARD} p-5 sm:p-7 lg:col-start-1 lg:row-start-1`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-slate-500">
                  <T en="Invoice" ar="فاتورة" />{" "}
                  <span className="font-mono text-slate-700" dir="ltr">
                    {reference}
                  </span>
                </p>
                <StatusPill status={invoice.status} />
              </div>

              <p className="mt-4 text-sm font-medium text-slate-500 sm:mt-6">
                {isVoid ? (
                  <T en="Invoice total" ar="إجمالي الفاتورة" />
                ) : isPaid ? (
                  <T en="Amount paid" ar="المبلغ المدفوع" />
                ) : (
                  <T en="Amount due" ar="المبلغ المستحق" />
                )}
              </p>
              <p
                className={`mt-0.5 text-4xl font-bold tracking-tight tabular-nums sm:text-5xl ${
                  isVoid
                    ? "text-slate-400 line-through decoration-2"
                    : "text-slate-900"
                }`}
              >
                <Money
                  minor={settledTotal ? invoice.total_minor : balanceDue}
                  currency={currency}
                />
              </p>
              <p className="mt-2 text-sm text-slate-600">
                {isLessonBill || !firstItem ? (
                  <span className="font-medium text-slate-800">
                    <Period
                      year={invoice.period_year}
                      month={invoice.period_month}
                    />
                  </span>
                ) : (
                  <span className="font-medium text-slate-800">
                    {firstItem.description}
                    {lineItems.length > 1 && (
                      <span className="font-normal text-slate-500">
                        {" "}
                        <T
                          en={`+${countStr(lineItems.length - 1, "en")} more`}
                          ar={`+${countStr(lineItems.length - 1, "ar")} أخرى`}
                        />
                      </span>
                    )}
                  </span>
                )}
                <span className="mx-1.5 text-slate-300">•</span>
                <T en="Billed to " ar="إلى " />
                <span className="font-medium text-slate-800">
                  {invoice.payer_name}
                </span>
              </p>

              {isPartial && (
                <div className="mt-4">
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-emerald-500"
                      style={{ width: `${paidPct}%` }}
                    />
                  </div>
                  <p className="mt-2 flex justify-between gap-3 text-xs text-slate-500">
                    <span>
                      <T en="Paid " ar="تم دفع " />
                      <span className="font-semibold text-emerald-700">
                        <Money
                          minor={invoice.amount_paid_minor}
                          currency={currency}
                        />
                      </span>
                    </span>
                    <span>
                      <T en="of " ar="من " />
                      <Money minor={invoice.total_minor} currency={currency} />
                    </span>
                  </p>
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                {soleStudent && <Chip icon={GraduationCap}>{soleStudent}</Chip>}
                {multiStudent && (
                  <Chip icon={Users}>
                    <T
                      en={`${countStr(students.length, "en")} students`}
                      ar={`${countStr(students.length, "ar")} طلاب`}
                    />
                  </Chip>
                )}
                {isLessonBill ? (
                  <>
                    {chargedCount > 0 && (
                      <Chip icon={BookOpen}>
                        <T
                          en={`${countStr(chargedCount, "en")} ${chargedCount === 1 ? "lesson" : "lessons"}`}
                          ar={`${countStr(chargedCount, "ar")} ${chargedCount === 1 ? "حصة" : "حصص"}`}
                        />
                      </Chip>
                    )}
                    {totalMinutes > 0 && (
                      <Chip icon={Clock}>
                        <T
                          en={`${hoursStr(totalMinutes, "en")} hours`}
                          ar={`${hoursStr(totalMinutes, "ar")} ساعة`}
                        />
                      </Chip>
                    )}
                  </>
                ) : (
                  <Chip icon={CalendarDays}>
                    <Period
                      year={invoice.period_year}
                      month={invoice.period_month}
                    />
                  </Chip>
                )}
              </div>
            </section>

            {/* ── Pay / receipt ── */}
            <aside className="lg:col-start-2 lg:row-span-2 lg:row-start-1 print:hidden">
              <div className="space-y-3 lg:sticky lg:top-6 lg:space-y-4">
                {isPaid ? (
                  <section className={`${CARD} overflow-hidden`}>
                    <div className="relative bg-emerald-50 px-6 pb-5 pt-6 text-center sm:pb-6 sm:pt-7">
                      <Confetti />
                      <div className="relative mx-auto flex size-14 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg shadow-emerald-600/25 ring-8 ring-emerald-100">
                        <Check className="size-7" strokeWidth={3} aria-hidden />
                      </div>
                      <h2 className="relative mt-4 text-lg font-bold text-emerald-950">
                        <T en="Paid in full" ar="تم الدفع بالكامل" />
                      </h2>
                      <p className="relative mt-1 text-sm text-emerald-800/80">
                        <T
                          en="Thank you! This invoice is settled."
                          ar="شكراً لك! تم سداد هذه الفاتورة."
                        />
                      </p>
                    </div>
                    <dl className="divide-y divide-slate-100 px-5 text-sm sm:px-6">
                      {invoice.paid_at && (
                        <div className="flex justify-between gap-3 py-3">
                          <dt className="text-slate-500">
                            <T en="Paid on" ar="تاريخ الدفع" />
                          </dt>
                          <dd className="font-semibold text-slate-900">
                            <DateText iso={invoice.paid_at} />
                          </dd>
                        </div>
                      )}
                      {paidVia && (
                        <div className="flex justify-between gap-3 py-3">
                          <dt className="text-slate-500">
                            <T en="Method" ar="طريقة الدفع" />
                          </dt>
                          <dd className="font-semibold text-slate-900">
                            <T en={paidVia.en} ar={paidVia.ar} />
                          </dd>
                        </div>
                      )}
                    </dl>
                    <div className="px-5 pb-5 pt-2 sm:px-6 sm:pb-6">
                      <DownloadReportButton
                        labelEn="Download receipt"
                        labelAr="تنزيل الإيصال"
                      />
                    </div>
                  </section>
                ) : isVoid ? (
                  <section className={`${CARD} p-6 text-center`}>
                    <p className="font-semibold text-slate-900">
                      <T
                        en="This invoice was cancelled"
                        ar="تم إلغاء هذه الفاتورة"
                      />
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      <T
                        en="There is nothing to pay. Contact the academy if you have questions."
                        ar="لا يوجد مبلغ مستحق. تواصل مع الأكاديمية لأي استفسار."
                      />
                    </p>
                  </section>
                ) : (
                  <section className={`${CARD} p-4 sm:p-6`}>
                    <div className="mb-3 flex items-baseline justify-between gap-3 px-1 sm:mb-4 sm:px-0">
                      <h2 className="text-base font-bold text-slate-900">
                        <T en="Pay this invoice" ar="ادفع هذه الفاتورة" />
                      </h2>
                      <span className="flex items-center gap-1 text-xs font-medium text-slate-500">
                        <Lock className="size-3 text-emerald-600" aria-hidden />
                        <T en="Secure" ar="آمن" />
                      </span>
                    </div>
                    <PaymentOptions
                      currency={currency}
                      methods={invoice.payment_methods ?? []}
                      invoiceToken={token}
                      amountMinor={balanceDue}
                      reference={reference}
                    />
                  </section>
                )}
              </div>
            </aside>

            {/* ── Details: folded on phones… ── */}
            <details className={`${CARD} group/details lg:hidden print:hidden`}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 [&::-webkit-details-marker]:hidden">
                <span className="flex min-w-0 items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                    <Receipt className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-slate-900">
                      <T en="Invoice details" ar="تفاصيل الفاتورة" />
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      {isLessonBill ? (
                        <T
                          en="Lessons, dates and totals"
                          ar="الحصص والتواريخ والإجمالي"
                        />
                      ) : (
                        <T en="Items and totals" ar="البنود والإجمالي" />
                      )}
                    </span>
                  </span>
                </span>
                <ChevronDown
                  className="size-5 shrink-0 text-slate-400 transition-transform group-open/details:rotate-180"
                  aria-hidden
                />
              </summary>
              <div className="border-t border-slate-100">{detailsBody}</div>
            </details>

            {/* …always open on desktop and in the printout. */}
            <section
              className={`${CARD} hidden lg:col-start-1 lg:row-start-2 lg:block lg:self-start print:block`}
            >
              {detailsBody}
            </section>
          </main>

          <footer className="mt-6 flex justify-center sm:mt-10 print:hidden">
            <div className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-full bg-white px-4 py-2 text-xs text-slate-500 shadow-sm ring-1 ring-slate-900/5">
              <span className="flex items-center gap-1.5">
                <ShieldCheck
                  className="size-3.5 text-emerald-600"
                  aria-hidden
                />
                <T en="Private & encrypted" ar="خاصة ومشفّرة" />
              </span>
              <span className="text-slate-300" aria-hidden>
                •
              </span>
              <span>
                <T en="Powered by " ar="مدعوم بواسطة " />
                <span className="font-semibold text-emerald-700">Acadmyq</span>
              </span>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}
