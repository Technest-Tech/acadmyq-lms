import { apiBase } from "@/lib/api-base";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatMoney } from "@/lib/money";
import { PaymentSubmit, type ReceivingMethods } from "./payment-submit";

// ── Academy bill DTO (mirrors app.public_academy_invoice_by_token) ────────────

interface AcademyBillDTO {
  id: string;
  status: "OPEN" | "PAID" | "OVERDUE" | "VOID";
  period_start: string;
  period_end: string;
  currency: string;
  total_minor: number;
  amount_paid_minor: number;
  due_date: string;
  paid_at: string | null;
  academy_name: string;
  payment_methods: ReceivingMethods;
}

// `API_URL` lets a deploy point server-side fetches at an internal address; otherwise the shared
// resolver applies (and turns a port-only value into a loopback origin — there is no page host here).
const API_URL = process.env.API_URL ?? apiBase();

async function fetchBill(token: string): Promise<AcademyBillDTO | null> {
  const res = await fetch(`${API_URL}/api/a/${token}`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Bill fetch failed: ${res.status}`);
  return res.json() as Promise<AcademyBillDTO>;
}

export const metadata: Metadata = {
  robots: { index: false, follow: false, nosnippet: true },
};

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

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function AcademyPayPage({ params }: PageProps) {
  const { token } = await params;
  const bill = await fetchBill(token);
  if (!bill) notFound();

  const paid = bill.status === "PAID";
  const balance = Math.max(0, bill.total_minor - bill.amount_paid_minor);

  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl px-4 py-8 sm:py-12">
      <div className="overflow-hidden rounded-3xl border bg-card shadow-sm ring-1 ring-foreground/[0.04]">
        {/* Hero */}
        <div className="relative bg-gradient-to-br from-primary to-indigo-700 px-6 py-8 text-white sm:px-8">
          <p className="text-sm font-medium opacity-90">{bill.academy_name}</p>
          <h1 className="mt-1 text-lg font-semibold">
            <T en="Subscription invoice" ar="فاتورة الاشتراك" />
          </h1>
          <div className="mt-5 flex items-end justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-wide opacity-80">
                {paid ? (
                  <T en="Amount paid" ar="المبلغ المدفوع" />
                ) : (
                  <T en="Amount due" ar="المبلغ المستحق" />
                )}
              </p>
              <p className="mt-0.5 text-3xl font-bold" dir="ltr">
                <Money
                  minor={paid ? bill.total_minor : balance}
                  currency={bill.currency}
                />
              </p>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${
                paid
                  ? "bg-emerald-400/25 ring-emerald-200/50"
                  : "bg-white/20 ring-white/30"
              }`}
            >
              {paid ? (
                <T en="Paid" ar="مدفوعة" />
              ) : bill.status === "OVERDUE" ? (
                <T en="Overdue" ar="متأخرة" />
              ) : (
                <T en="Unpaid" ar="غير مدفوعة" />
              )}
            </span>
          </div>
        </div>

        {/* Facts */}
        <dl className="grid grid-cols-2 gap-px bg-border text-sm">
          <div className="bg-card px-6 py-4">
            <dt className="text-muted-foreground text-xs">
              <T en="Billing period" ar="فترة الفوترة" />
            </dt>
            <dd className="mt-0.5 font-medium" dir="ltr">
              {bill.period_start} → {bill.period_end}
            </dd>
          </div>
          <div className="bg-card px-6 py-4">
            <dt className="text-muted-foreground text-xs">
              <T en="Due date" ar="تاريخ الاستحقاق" />
            </dt>
            <dd className="mt-0.5 font-medium" dir="ltr">
              {bill.due_date}
            </dd>
          </div>
        </dl>

        {/* Payment / status */}
        <div className="border-t px-6 py-6 sm:px-8">
          {paid ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-5 text-center text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200">
              <p className="font-semibold">
                <T en="Payment received — thank you!" ar="تم استلام الدفعة — شكراً لكم!" />
              </p>
            </div>
          ) : bill.status === "VOID" ? (
            <p className="text-muted-foreground text-center text-sm">
              <T en="This invoice has been voided." ar="تم إلغاء هذه الفاتورة." />
            </p>
          ) : (
            <PaymentSubmit
              token={token}
              methods={bill.payment_methods}
            />
          )}
        </div>
      </div>
    </main>
  );
}
