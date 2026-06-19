import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatMoney } from "@/lib/money";
import type { InvoiceStatus } from "@academiq/contracts";
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
  paid_at: string | null;
  payment_method: string | null;
  academy_name: string;
  payer_name: string;
  payer_whatsapp: string | null;
  payment_methods: PublicPaymentMethod[];
  line_items: InvoiceLineItem[];
}

// ── Data ──────────────────────────────────────────────────────────────────────

const API_URL =
  process.env.API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

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
    <>
      <span className="ltr:inline rtl:hidden">
        {formatMoney({ amount: minor, currency }, "en")}
      </span>
      <span className="rtl:inline ltr:hidden">
        {formatMoney({ amount: minor, currency }, "ar")}
      </span>
    </>
  );
}

function periodLabel(year: number, month: number, locale: "en" | "ar"): string {
  const bcp47 = locale === "ar" ? "ar-u-nu-arab" : "en-US";
  return new Intl.DateTimeFormat(bcp47, {
    month: "long",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function formatDate(iso: string, locale: "en" | "ar"): string {
  const bcp47 = locale === "ar" ? "ar-u-nu-arab" : "en-US";
  return new Intl.DateTimeFormat(bcp47, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

/** Minutes → localized hours string (e.g. "1.5"), Arabic-Indic digits in 'ar'. */
function hoursStr(minutes: number, locale: "en" | "ar"): string {
  const bcp47 = locale === "ar" ? "ar-u-nu-arab" : "en-US";
  return new Intl.NumberFormat(bcp47, { maximumFractionDigits: 1 }).format(
    minutes / 60,
  );
}

/** One child's lessons within a guardian invoice. */
interface LessonGroup {
  student: string;
  lines: InvoiceLineItem[];
  subtotal: number;
}

/** Groups line items by student, preserving first-seen order. */
function groupLinesByStudent(items: InvoiceLineItem[]): LessonGroup[] {
  const map = new Map<string, LessonGroup>();
  for (const li of items) {
    const key = li.student_name ?? "—";
    const group = map.get(key);
    if (group) {
      group.lines.push(li);
      group.subtotal += li.amount_minor;
    } else {
      map.set(key, { student: key, lines: [li], subtotal: li.amount_minor });
    }
  }
  return Array.from(map.values());
}

/**
 * A single lesson on the public invoice. Charged lessons show their amount (and hours); non-charged
 * lessons — cancelled, free or trial — are listed for the record, muted, with a "Not charged" pill
 * and a status headline so the parent sees every lesson without it being mistaken for a charge (#19).
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
  if (showStudent && li.student_name)
    sub.push(<span key="s">{li.student_name}</span>);
  if (li.session_date)
    sub.push(
      <T
        key="d"
        en={formatDate(li.session_date, "en")}
        ar={formatDate(li.session_date, "ar")}
      />,
    );
  return (
    <li
      className={
        charged
          ? "flex items-center justify-between gap-3 rounded-2xl border border-gray-100 bg-gray-50/70 px-4 py-3"
          : "flex items-center justify-between gap-3 rounded-2xl border border-dashed border-gray-200 bg-gray-50/40 px-4 py-3"
      }
    >
      <div className="min-w-0">
        <p
          className={
            charged
              ? "truncate font-medium text-gray-800"
              : "truncate font-medium text-gray-500"
          }
        >
          {headline ? <T en={headline.en} ar={headline.ar} /> : li.description}
        </p>
        {sub.length > 0 && (
          <p className="mt-0.5 text-xs text-gray-400">
            {sub.map((node, i) => (
              <span key={i}>
                {i > 0 && <span className="mx-1.5">·</span>}
                {node}
              </span>
            ))}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        {charged && li.duration_minutes ? (
          <span className="inline-flex items-center rounded-lg bg-white px-2 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-100">
            <T
              en={`${hoursStr(li.duration_minutes, "en")} hr`}
              ar={`${hoursStr(li.duration_minutes, "ar")} س`}
            />
          </span>
        ) : null}
        {charged ? (
          <span className="font-semibold tabular-nums text-gray-900">
            <Money minor={li.amount_minor} currency={currency} />
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-500">
            <T en="Not charged" ar="بدون رسوم" />
          </span>
        )}
      </div>
    </li>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<InvoiceStatus, string> = {
  OPEN: "bg-white/20 text-white ring-white/30",
  CLOSED: "bg-white/20 text-white ring-white/30",
  PAID: "bg-emerald-400/25 text-white ring-emerald-200/50",
  PARTIALLY_PAID: "bg-amber-400/25 text-white ring-amber-200/50",
  VOID: "bg-red-400/25 text-white ring-red-200/50",
};

const STATUS_LABEL: Record<InvoiceStatus, { en: string; ar: string }> = {
  OPEN: { en: "Unpaid", ar: "غير مدفوعة" },
  CLOSED: { en: "Unpaid", ar: "غير مدفوعة" },
  PAID: { en: "Paid", ar: "مدفوعة" },
  PARTIALLY_PAID: { en: "Partially Paid", ar: "مدفوعة جزئياً" },
  VOID: { en: "Void", ar: "ملغاة" },
};

function StatusBadge({ status }: { status: InvoiceStatus }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.OPEN;
  const label = STATUS_LABEL[status] ?? { en: status, ar: status };
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ring-1 backdrop-blur ${style}`}
    >
      <T en={label.en} ar={label.ar} />
    </span>
  );
}

// ── Islamic geometric pattern (decorative header overlay) ─────────────────────

function IslamicPattern() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 size-full text-white/[0.08]"
      aria-hidden
    >
      <defs>
        <pattern
          id="girih"
          width="56"
          height="56"
          patternUnits="userSpaceOnUse"
        >
          <g fill="none" stroke="currentColor" strokeWidth="1.25">
            <rect x="13" y="13" width="30" height="30" />
            <rect
              x="13"
              y="13"
              width="30"
              height="30"
              transform="rotate(45 28 28)"
            />
            <circle cx="28" cy="28" r="4.5" />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#girih)" />
    </svg>
  );
}

// ── Crest emblem (8-point star) ───────────────────────────────────────────────

function Crest() {
  return (
    <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/30 backdrop-blur">
      <svg viewBox="0 0 24 24" className="size-6 text-amber-200" aria-hidden>
        <g fill="none" stroke="currentColor" strokeWidth="1.4">
          <rect x="5" y="5" width="14" height="14" rx="1" />
          <rect
            x="5"
            y="5"
            width="14"
            height="14"
            rx="1"
            transform="rotate(45 12 12)"
          />
        </g>
      </svg>
    </span>
  );
}

// ── Fact tile ─────────────────────────────────────────────────────────────────

function Fact({
  labelEn,
  labelAr,
  children,
}: {
  labelEn: string;
  labelAr: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-gray-50 p-4 ring-1 ring-gray-900/5">
      <p className="text-[0.7rem] font-semibold uppercase tracking-wider text-gray-400">
        <T en={labelEn} ar={labelAr} />
      </p>
      <div className="mt-1 text-sm font-semibold text-gray-900">{children}</div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

interface PageProps {
  params: { token: string };
}

export default async function PublicInvoicePage({ params }: PageProps) {
  const invoice = await fetchInvoice(params.token);
  if (!invoice) notFound();

  const isPaid = invoice.status === "PAID";
  const isVoid = invoice.status === "VOID";
  const isPartial = invoice.status === "PARTIALLY_PAID";

  const balanceDue = Math.max(
    0,
    invoice.total_minor - invoice.amount_paid_minor,
  );

  // Every lesson of the month is listed for the record (#19) — attended, cancelled, free and trial —
  // in one date-ordered list, split per child below. Non-charged lessons ride along at zero and so
  // never move the subtotal/total (those come straight from the server).
  const sortByDate = (a: InvoiceLineItem, b: InvoiceLineItem) =>
    (a.session_date ?? "").localeCompare(b.session_date ?? "");
  const lineItems = [...invoice.line_items].sort(sortByDate);
  const showStudentColumn = lineItems.some((li) => li.student_name != null);

  // Distinct student names (for the "Student" fact on guardian-level bills).
  const students = Array.from(
    new Set(lineItems.map((li) => li.student_name).filter(Boolean) as string[]),
  );
  const studentLabel =
    students.length > 0 ? students.join("، ") : invoice.payer_name;

  // More than one child on this bill → break the lessons into a section per child (#7/#19).
  const grouped = students.length > 1;

  // Billed hours (the academy bills PER_HOUR); only the CHARGED lessons count toward the figure so
  // free/cancelled/trial lessons never inflate it.
  const totalMinutes = lineItems.reduce(
    (sum, li) => sum + (isCharged(li) ? (li.duration_minutes ?? 0) : 0),
    0,
  );
  const hasHours = totalMinutes > 0;

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50 via-teal-50/40 to-slate-50 px-4 py-8 sm:py-12 print:bg-white print:py-0">
      <main className="mx-auto max-w-2xl">
        <div className="overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-emerald-900/5 print:rounded-none print:shadow-none print:ring-0">
          {/* ── Header ── */}
          <header className="relative overflow-hidden bg-gradient-to-br from-emerald-700 via-emerald-700 to-teal-800 px-6 py-7 sm:px-9 print:bg-emerald-700">
            <IslamicPattern />
            <div
              className="pointer-events-none absolute -end-12 -top-12 size-44 rounded-full bg-amber-300/10 blur-3xl print:hidden"
              aria-hidden
            />

            <div className="relative flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <Crest />
                <div>
                  <p className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-amber-200/90">
                    <T en="Invoice" ar="فاتورة" />
                  </p>
                  <h1 className="text-lg font-bold leading-tight text-white sm:text-xl">
                    {invoice.academy_name}
                  </h1>
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <DownloadPdfButton />
                <StatusBadge status={invoice.status} />
              </div>
            </div>

            {/* Amount hero */}
            <div className="relative mt-7 text-center sm:text-start">
              <p className="text-xs font-medium uppercase tracking-wider text-emerald-100/80">
                {isPaid ? (
                  <T en="Amount paid" ar="المبلغ المدفوع" />
                ) : (
                  <T en="Amount due" ar="المبلغ المستحق" />
                )}
              </p>
              <p className="mt-1 text-4xl font-extrabold tracking-tight text-white">
                <Money
                  minor={isPaid ? invoice.total_minor : balanceDue}
                  currency={invoice.currency}
                />
              </p>
              <p className="mt-1.5 text-sm text-emerald-100/90">
                <T
                  en={periodLabel(
                    invoice.period_year,
                    invoice.period_month,
                    "en",
                  )}
                  ar={periodLabel(
                    invoice.period_year,
                    invoice.period_month,
                    "ar",
                  )}
                />
                {isPartial && (
                  <>
                    <span className="mx-2 opacity-50">·</span>
                    <T en="Paid" ar="مدفوع" />{" "}
                    <Money
                      minor={invoice.amount_paid_minor}
                      currency={invoice.currency}
                    />
                  </>
                )}
              </p>
            </div>
          </header>

          {/* ── Facts ── */}
          <section className="grid grid-cols-2 gap-3 px-6 py-6 sm:px-9">
            <Fact labelEn="Billed to" labelAr="فاتورة إلى">
              {invoice.payer_name}
              {invoice.payer_whatsapp && (
                <span className="mt-0.5 block font-mono text-xs font-normal text-gray-500">
                  <bdi dir="ltr">{invoice.payer_whatsapp}</bdi>
                </span>
              )}
            </Fact>
            <Fact labelEn="Student" labelAr="الطالب">
              {studentLabel}
            </Fact>
            <Fact labelEn="Billing period" labelAr="فترة الفوترة">
              <T
                en={periodLabel(
                  invoice.period_year,
                  invoice.period_month,
                  "en",
                )}
                ar={periodLabel(
                  invoice.period_year,
                  invoice.period_month,
                  "ar",
                )}
              />
            </Fact>
            <Fact labelEn="Total" labelAr="الإجمالي">
              <span className="text-lg font-extrabold tabular-nums text-emerald-700">
                <Money
                  minor={invoice.total_minor}
                  currency={invoice.currency}
                />
              </span>
            </Fact>
          </section>

          {/* ── Items / billed hours ── */}
          <section className="px-6 pb-2 sm:px-9">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                {hasHours ? (
                  <T en="Billed hours" ar="الساعات المحتسبة" />
                ) : (
                  <T en="Bill items" ar="بنود الفاتورة" />
                )}
              </h2>
              <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-700">
                {hasHours ? (
                  <T
                    en={`${hoursStr(totalMinutes, "en")} hrs`}
                    ar={`${hoursStr(totalMinutes, "ar")} ساعة`}
                  />
                ) : (
                  <T
                    en={`${lineItems.length} items`}
                    ar={`${lineItems.length} بنود`}
                  />
                )}
              </span>
            </div>

            {lineItems.length === 0 ? (
              <p className="py-4 text-sm italic text-gray-400">
                <T
                  en="No items on this invoice."
                  ar="لا توجد بنود في هذه الفاتورة."
                />
              </p>
            ) : (
              <>
                {/* On-screen: a single button to download the full report (keeps the bill
                    uncluttered). The per-session breakdown below renders only in the printout. */}
                <div className="print:hidden">
                  <DownloadReportButton />
                </div>
                <div className="hidden print:block">
                  {grouped ? (
                    <div className="space-y-5">
                      {groupLinesByStudent(lineItems).map((g) => (
                        <div key={g.student}>
                          <div className="mb-2 flex items-center justify-between gap-2 border-b border-gray-100 pb-1.5">
                            <h3 className="text-sm font-semibold text-gray-700">
                              {g.student}
                              <span className="ms-2 text-xs font-normal text-gray-400">
                                <T
                                  en={`${g.lines.length} ${g.lines.length === 1 ? "lesson" : "lessons"}`}
                                  ar={`${g.lines.length} ${g.lines.length === 1 ? "حصة" : "حصص"}`}
                                />
                              </span>
                            </h3>
                            <span className="text-xs font-semibold tabular-nums text-emerald-700">
                              <Money
                                minor={g.subtotal}
                                currency={invoice.currency}
                              />
                            </span>
                          </div>
                          <ul className="space-y-2">
                            {g.lines.map((li) => (
                              <LineItemRow
                                key={li.id}
                                li={li}
                                currency={invoice.currency}
                                showStudent={false}
                              />
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <ul className="space-y-2">
                      {lineItems.map((li) => (
                        <LineItemRow
                          key={li.id}
                          li={li}
                          currency={invoice.currency}
                          showStudent={showStudentColumn}
                        />
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </section>

          {/* ── Totals ── */}
          <section className="px-6 py-5 sm:px-9">
            <dl className="space-y-2 rounded-2xl bg-gray-50 p-4 ring-1 ring-gray-900/5">
              <div className="flex justify-between text-sm">
                <dt className="text-gray-500">
                  <T en="Subtotal" ar="المجموع الفرعي" />
                </dt>
                <dd className="text-base font-semibold tabular-nums text-gray-900">
                  <Money
                    minor={invoice.subtotal_minor}
                    currency={invoice.currency}
                  />
                </dd>
              </div>
              {invoice.amount_paid_minor > 0 && (
                <div className="flex justify-between text-sm">
                  <dt className="text-gray-500">
                    <T en="Paid" ar="المدفوع" />
                  </dt>
                  <dd className="font-medium text-emerald-600">
                    −{" "}
                    <Money
                      minor={invoice.amount_paid_minor}
                      currency={invoice.currency}
                    />
                  </dd>
                </div>
              )}
              <div className="flex items-center justify-between border-t border-gray-200 pt-2.5">
                <dt className="text-lg font-bold text-gray-900">
                  {isPaid ? (
                    <T en="Total" ar="الإجمالي" />
                  ) : (
                    <T en="Balance due" ar="المبلغ المستحق" />
                  )}
                </dt>
                <dd className="text-2xl font-extrabold tabular-nums text-emerald-700">
                  <Money
                    minor={isPaid ? invoice.total_minor : balanceDue}
                    currency={invoice.currency}
                  />
                </dd>
              </div>
            </dl>
          </section>

          {/* ── Paid banner ── */}
          {isPaid && invoice.paid_at && (
            <section className="mx-6 mb-2 rounded-2xl bg-emerald-50 px-5 py-4 ring-1 ring-emerald-200 sm:mx-9">
              <div className="flex items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                  ✓
                </span>
                <div>
                  <p className="text-sm font-semibold text-emerald-800">
                    <T en="Payment received" ar="تم استلام الدفعة" />
                  </p>
                  <p className="text-xs text-emerald-600">
                    <T
                      en={formatDate(invoice.paid_at, "en")}
                      ar={formatDate(invoice.paid_at, "ar")}
                    />
                  </p>
                </div>
              </div>
            </section>
          )}

          {/* ── Payment options ── */}
          {!isPaid && !isVoid && (
            <section className="px-6 pb-6 sm:px-9 print:hidden">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
                <T en="How to pay" ar="طريقة الدفع" />
              </h2>
              <PaymentOptions
                currency={invoice.currency}
                methods={invoice.payment_methods ?? []}
                invoiceToken={params.token}
              />
            </section>
          )}

          {/* ── Footer ── */}
          <footer className="border-t border-gray-100 bg-gray-50/80 px-6 py-4 text-center sm:px-9">
            <p className="text-xs text-gray-400">
              <T en="Powered by " ar="مدعوم بواسطة " />
              <span className="font-semibold text-emerald-700">Acadmyq</span>
            </p>
          </footer>
        </div>
      </main>
    </div>
  );
}
