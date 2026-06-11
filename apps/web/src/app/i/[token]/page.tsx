import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { formatMoney } from '@/lib/money';
import type { InvoiceStatus } from '@academiq/contracts';
import { PaymentInfoButton } from './payment-info-button';

// ── Invoice DTO ──────────────────────────────────────────────────────────────

interface InvoiceLineItem {
  id: string;
  session_date: string; // ISO date "YYYY-MM-DD"
  student_name: string | null;
  description: string;
  amount_minor: number;
}

interface PublicInvoiceDTO {
  token: string;
  status: InvoiceStatus;
  academy_name: string;
  period_label_en: string; // e.g. "June 2026"
  period_label_ar: string; // e.g. "يونيو 2026"
  payer_name: string;
  payer_phone: string;
  currency: string;
  subtotal_minor: number;
  total_minor: number;
  paid_at: string | null; // ISO datetime, present when PAID
  line_items: InvoiceLineItem[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const API_URL =
  process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

async function fetchInvoice(token: string): Promise<PublicInvoiceDTO | null> {
  const res = await fetch(`${API_URL}/api/i/${token}`, {
    next: { revalidate: 60 }, // light caching; invoice data rarely changes
    headers: { Accept: 'application/json' },
  });

  if (res.status === 404) return null;

  if (!res.ok) {
    throw new Error(`Invoice fetch failed: ${res.status}`);
  }

  return res.json() as Promise<PublicInvoiceDTO>;
}

// ── Metadata ─────────────────────────────────────────────────────────────────

export const metadata: Metadata = {
  robots: { index: false, follow: false, nosnippet: true },
};

// ── Status badge ─────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<InvoiceStatus, string> = {
  OPEN: 'bg-blue-100 text-blue-800',
  CLOSED: 'bg-gray-100 text-gray-700',
  PAID: 'bg-emerald-100 text-emerald-800',
  PARTIALLY_PAID: 'bg-amber-100 text-amber-800',
  VOID: 'bg-red-100 text-red-700',
};

const STATUS_LABEL: Record<InvoiceStatus, { en: string; ar: string }> = {
  OPEN: { en: 'Open', ar: 'مفتوحة' },
  CLOSED: { en: 'Closed', ar: 'مغلقة' },
  PAID: { en: 'Paid', ar: 'مدفوعة' },
  PARTIALLY_PAID: { en: 'Partially Paid', ar: 'مدفوعة جزئياً' },
  VOID: { en: 'Void', ar: 'ملغاة' },
};

function StatusBadge({ status }: { status: InvoiceStatus }) {
  const style = STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-700';
  const label = STATUS_LABEL[status] ?? { en: status, ar: status };
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${style}`}
    >
      <span className="ltr:inline rtl:hidden">{label.en}</span>
      <span className="rtl:inline ltr:hidden">{label.ar}</span>
    </span>
  );
}

// ── Date formatting ───────────────────────────────────────────────────────────

function formatDate(iso: string, locale: 'en' | 'ar'): string {
  const bcp47 = locale === 'ar' ? 'ar-u-nu-arab' : 'en';
  return new Intl.DateTimeFormat(bcp47, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(iso));
}

// ── Page ─────────────────────────────────────────────────────────────────────

interface PageProps {
  params: { token: string };
}

export default async function PublicInvoicePage({ params }: PageProps) {
  const invoice = await fetchInvoice(params.token);

  if (!invoice) {
    notFound();
  }

  const isPaid = invoice.status === 'PAID';
  const isVoid = invoice.status === 'VOID';

  // Sort line items by session_date ascending
  const lineItems = [...invoice.line_items].sort((a, b) =>
    a.session_date.localeCompare(b.session_date),
  );

  // Detect whether any line item has a student_name (guardian invoice with multiple students)
  const showStudentColumn = lineItems.some((li) => li.student_name != null);

  return (
    <>
      {/*
        The /i/[token] route is a public, auth-free page that must be
        self-contained: no shared app shell, no locale cookie dependency.
        We render a minimal <html> wrapper via the layout.tsx root, but
        explicitly set dir on the outer div to support RTL regardless of
        the user's cookie/session locale.
      */}
      <div className="min-h-screen bg-gray-50">
        {/* ── Page content ── */}
        <main className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
          {/* ── Card ── */}
          <div className="overflow-hidden rounded-2xl bg-white shadow-md">

            {/* ── Header ── */}
            <div className="bg-indigo-600 px-6 py-6 sm:px-8">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-indigo-200">
                    <span className="ltr:inline rtl:hidden">Invoice</span>
                    <span className="rtl:inline ltr:hidden">فاتورة</span>
                  </p>
                  <h1 className="mt-1 text-2xl font-bold text-white leading-tight">
                    {invoice.academy_name}
                  </h1>
                  <p className="mt-1 text-sm text-indigo-200">
                    <span className="ltr:inline rtl:hidden">
                      {invoice.period_label_en}
                    </span>
                    <span className="rtl:inline ltr:hidden">
                      {invoice.period_label_ar}
                    </span>
                    <span className="mx-1.5 opacity-50">/</span>
                    <span className="ltr:inline rtl:hidden">
                      {invoice.period_label_ar}
                    </span>
                    <span className="rtl:inline ltr:hidden">
                      {invoice.period_label_en}
                    </span>
                  </p>
                </div>
                <StatusBadge status={invoice.status} />
              </div>
            </div>

            {/* ── Body ── */}
            <div className="divide-y divide-gray-100">

              {/* ── Payer info ── */}
              <section className="px-6 py-5 sm:px-8">
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
                  <span className="ltr:inline rtl:hidden">Billed to</span>
                  <span className="rtl:inline ltr:hidden">فاتورة إلى</span>
                </h2>
                <p className="text-base font-semibold text-gray-900">
                  {invoice.payer_name}
                </p>
                {invoice.payer_phone && (
                  <p className="mt-0.5 text-sm text-gray-500 font-mono">
                    {invoice.payer_phone}
                  </p>
                )}
              </section>

              {/* ── Line items ── */}
              <section className="px-6 py-5 sm:px-8">
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
                  <span className="ltr:inline rtl:hidden">Sessions</span>
                  <span className="rtl:inline ltr:hidden">الجلسات</span>
                </h2>

                {lineItems.length === 0 ? (
                  <p className="text-sm text-gray-400 italic">
                    <span className="ltr:inline rtl:hidden">No sessions.</span>
                    <span className="rtl:inline ltr:hidden">لا توجد جلسات.</span>
                  </p>
                ) : (
                  <div className="overflow-x-auto -mx-1">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100">
                          <th className="pb-2 text-start text-xs font-medium text-gray-400 pe-3 whitespace-nowrap">
                            <span className="ltr:inline rtl:hidden">Date</span>
                            <span className="rtl:inline ltr:hidden">التاريخ</span>
                          </th>
                          {showStudentColumn && (
                            <th className="pb-2 text-start text-xs font-medium text-gray-400 pe-3">
                              <span className="ltr:inline rtl:hidden">Student</span>
                              <span className="rtl:inline ltr:hidden">الطالب</span>
                            </th>
                          )}
                          <th className="pb-2 text-start text-xs font-medium text-gray-400 pe-3">
                            <span className="ltr:inline rtl:hidden">Description</span>
                            <span className="rtl:inline ltr:hidden">الوصف</span>
                          </th>
                          <th className="pb-2 text-end text-xs font-medium text-gray-400 whitespace-nowrap">
                            <span className="ltr:inline rtl:hidden">Amount</span>
                            <span className="rtl:inline ltr:hidden">المبلغ</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {lineItems.map((li) => (
                          <tr key={li.id} className="group">
                            <td className="py-2.5 pe-3 text-gray-500 whitespace-nowrap align-top">
                              <span className="ltr:inline rtl:hidden">
                                {formatDate(li.session_date, 'en')}
                              </span>
                              <span className="rtl:inline ltr:hidden">
                                {formatDate(li.session_date, 'ar')}
                              </span>
                            </td>
                            {showStudentColumn && (
                              <td className="py-2.5 pe-3 text-gray-700 align-top">
                                {li.student_name ?? '—'}
                              </td>
                            )}
                            <td className="py-2.5 pe-3 text-gray-700 align-top">
                              {li.description}
                            </td>
                            <td className="py-2.5 text-end font-medium text-gray-900 align-top whitespace-nowrap">
                              <span className="ltr:inline rtl:hidden">
                                {formatMoney(
                                  { amount: li.amount_minor, currency: invoice.currency },
                                  'en',
                                )}
                              </span>
                              <span className="rtl:inline ltr:hidden">
                                {formatMoney(
                                  { amount: li.amount_minor, currency: invoice.currency },
                                  'ar',
                                )}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* ── Totals ── */}
              <section className="px-6 py-5 sm:px-8">
                <dl className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <dt className="text-gray-500">
                      <span className="ltr:inline rtl:hidden">Subtotal</span>
                      <span className="rtl:inline ltr:hidden">المجموع الفرعي</span>
                    </dt>
                    <dd className="font-medium text-gray-800">
                      <span className="ltr:inline rtl:hidden">
                        {formatMoney(
                          { amount: invoice.subtotal_minor, currency: invoice.currency },
                          'en',
                        )}
                      </span>
                      <span className="rtl:inline ltr:hidden">
                        {formatMoney(
                          { amount: invoice.subtotal_minor, currency: invoice.currency },
                          'ar',
                        )}
                      </span>
                    </dd>
                  </div>
                  <div className="flex justify-between border-t border-gray-100 pt-2 text-base">
                    <dt className="font-semibold text-gray-900">
                      <span className="ltr:inline rtl:hidden">Total</span>
                      <span className="rtl:inline ltr:hidden">الإجمالي</span>
                    </dt>
                    <dd className="font-bold text-indigo-700">
                      <span className="ltr:inline rtl:hidden">
                        {formatMoney(
                          { amount: invoice.total_minor, currency: invoice.currency },
                          'en',
                        )}
                      </span>
                      <span className="rtl:inline ltr:hidden">
                        {formatMoney(
                          { amount: invoice.total_minor, currency: invoice.currency },
                          'ar',
                        )}
                      </span>
                    </dd>
                  </div>
                </dl>
              </section>

              {/* ── Paid banner ── */}
              {isPaid && invoice.paid_at && (
                <section className="px-6 py-4 sm:px-8 bg-emerald-50">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 text-sm font-bold">
                      ✓
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-emerald-800">
                        <span className="ltr:inline rtl:hidden">Paid</span>
                        <span className="rtl:inline ltr:hidden">تم الدفع</span>
                      </p>
                      <p className="text-xs text-emerald-600">
                        <span className="ltr:inline rtl:hidden">
                          {formatDate(invoice.paid_at, 'en')}
                        </span>
                        <span className="rtl:inline ltr:hidden">
                          {formatDate(invoice.paid_at, 'ar')}
                        </span>
                      </p>
                    </div>
                  </div>
                </section>
              )}

              {/* ── Payment button (inert placeholder, Sprint 11) ── */}
              {!isPaid && !isVoid && (
                <section className="px-6 py-5 sm:px-8">
                  <PaymentInfoButton
                    currency={invoice.currency}
                    totalMinor={invoice.total_minor}
                  />
                </section>
              )}
            </div>

            {/* ── Footer ── */}
            <div className="border-t border-gray-100 bg-gray-50 px-6 py-4 text-center sm:px-8">
              <p className="text-xs text-gray-400">
                <span className="ltr:inline rtl:hidden">Powered by </span>
                <span className="rtl:inline ltr:hidden">مدعوم بواسطة </span>
                <span className="font-semibold text-gray-500">Academiq</span>
              </p>
            </div>

          </div>
        </main>
      </div>
    </>
  );
}
