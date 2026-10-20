import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BadgeCheck, Ban, CalendarDays, Hash, UserRound, Wallet } from "lucide-react";
import { DownloadPdfButton } from "@/app/i/[token]/download-pdf-button";
import type { PublicReceipt, ReceiptMethod } from "@/lib/accounting-api";
import { apiBase } from "@/lib/api-base";
import { formatMoney } from "@/lib/money";

/**
 * The public payment receipt (docs/groups/01-ACCOUNTING.md) — what a parent opens from the WhatsApp
 * message: the academy, the receipt number, who paid, how much, how and when, and exactly what it
 * paid for. Bilingual like the invoice page, printable (Save as PDF), never indexed, never cached
 * (a voided receipt must say so the next time it is opened). Data comes only from the SECURITY
 * DEFINER `app.public_receipt_by_token`, which is the allow-list.
 */

const API_URL = process.env.API_URL ?? apiBase();

async function fetchReceipt(token: string): Promise<PublicReceipt | null> {
  const res = await fetch(`${API_URL}/api/rc/${token}`, { cache: "no-store", headers: { Accept: "application/json" } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Receipt fetch failed: ${res.status}`);
  return res.json() as Promise<PublicReceipt>;
}

export const metadata: Metadata = {
  title: "Receipt",
  robots: { index: false, follow: false, nosnippet: true },
};

const METHOD: Record<ReceiptMethod, { en: string; ar: string }> = {
  CASH: { en: "Cash", ar: "نقدًا" },
  INSTAPAY: { en: "InstaPay", ar: "إنستاباي" },
  WALLET: { en: "Mobile wallet", ar: "محفظة إلكترونية" },
  BANK_TRANSFER: { en: "Bank transfer", ar: "تحويل بنكي" },
  CARD: { en: "Card", ar: "بطاقة" },
  OTHER: { en: "Other", ar: "أخرى" },
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
  return <T en={formatMoney({ amount: minor, currency }, "en")} ar={formatMoney({ amount: minor, currency }, "ar")} />;
}

function dateText(iso: string, locale: "en" | "ar"): string {
  const [y = 1970, m = 1, d = 1] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-u-nu-arab" : "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

function monogram(name: string): string {
  const [first = "A", second] = name.trim().split(/\s+/).filter(Boolean);
  return (second ? first.slice(0, 1) + second.slice(0, 1) : first.slice(0, 2)).toUpperCase();
}

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function PublicReceiptPage({ params }: PageProps) {
  const { token } = await params;
  const receipt = await fetchReceipt(token);
  if (!receipt) notFound();

  const { currency } = receipt;
  const allocated = receipt.allocations.reduce((s, a) => s + a.amount_minor, 0);
  const credit = Math.max(0, receipt.amount_minor - allocated);

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-6 sm:py-12 print:bg-white print:p-0">
      <main className="mx-auto max-w-lg">
        <article className="overflow-hidden rounded-3xl bg-white shadow-xl ring-1 shadow-slate-900/5 ring-slate-200 print:shadow-none print:ring-0">
          {/* Academy band */}
          <header className="relative bg-emerald-900 px-5 pt-5 pb-16 text-white sm:px-7 print:bg-white print:pb-4 print:text-slate-900">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white text-sm font-bold text-emerald-800 print:ring-1 print:ring-slate-200">
                  {monogram(receipt.academy_name)}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-lg font-bold">{receipt.academy_name}</p>
                  <p className="text-sm text-emerald-100/80 print:text-slate-500">
                    <T en="Payment receipt" ar="إيصال استلام نقدية" />
                  </p>
                </div>
              </div>
              <DownloadPdfButton />
            </div>
          </header>

          {/* The amount */}
          <div className="relative -mt-10 px-5 sm:px-7 print:mt-0">
            <div className={`rounded-2xl border bg-white p-5 text-center shadow-sm ${receipt.voided ? "border-rose-200" : "border-emerald-100"}`}>
              {receipt.voided ? (
                <p className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700">
                  <Ban className="size-3.5" aria-hidden />
                  <T en="This receipt was cancelled" ar="تم إلغاء هذا الإيصال" />
                </p>
              ) : (
                <p className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                  <BadgeCheck className="size-3.5" aria-hidden />
                  <T en="Received — thank you" ar="تم الاستلام — شكرًا لكم" />
                </p>
              )}
              <p className={`mt-3 text-3xl font-bold break-words text-slate-900 tabular-nums sm:text-4xl ${receipt.voided ? "line-through opacity-60" : ""}`}>
                <Money minor={receipt.amount_minor} currency={currency} />
              </p>
            </div>
          </div>

          {/* The facts */}
          <dl className="mx-5 mt-5 divide-y divide-slate-100 rounded-2xl border border-slate-100 text-sm sm:mx-7">
            <Fact icon={Hash} label={<T en="Receipt no." ar="رقم الإيصال" />}>
              <span className="font-mono" dir="ltr">
                {receipt.number}
              </span>
            </Fact>
            <Fact icon={UserRound} label={<T en="Received from" ar="استلمنا من" />}>
              {receipt.payer_name ?? "—"}
            </Fact>
            <Fact icon={CalendarDays} label={<T en="Date" ar="التاريخ" />}>
              <T en={dateText(receipt.received_on, "en")} ar={dateText(receipt.received_on, "ar")} />
            </Fact>
            <Fact icon={Wallet} label={<T en="Paid by" ar="طريقة الدفع" />}>
              <T en={METHOD[receipt.method].en} ar={METHOD[receipt.method].ar} />
              {receipt.reference && (
                <span className="ms-2 font-mono text-xs text-slate-500" dir="ltr">
                  {receipt.reference}
                </span>
              )}
            </Fact>
          </dl>

          {/* What it paid for */}
          <section className="px-5 pt-6 pb-2 sm:px-7">
            <h2 className="text-sm font-bold text-slate-900">
              <T en="Paid for" ar="مقابل" />
            </h2>
            <ul className="mt-2 divide-y divide-slate-100">
              {receipt.allocations.map((a, i) => (
                <li key={i} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium break-words text-slate-800">{a.description}</p>
                    {a.student_name && <p className="text-xs text-slate-500">{a.student_name}</p>}
                  </div>
                  <span className="shrink-0 font-semibold text-slate-900 tabular-nums">
                    <Money minor={a.amount_minor} currency={currency} />
                  </span>
                </li>
              ))}
              {credit > 0 && !receipt.voided && (
                <li className="flex items-start justify-between gap-3 py-2.5 text-sm">
                  <p className="font-medium text-emerald-700">
                    <T en="Kept as credit for your next payments" ar="رصيد مقدم لحسابكم يُخصم من المستحقات القادمة" />
                  </p>
                  <span className="shrink-0 font-semibold text-emerald-700 tabular-nums">
                    <Money minor={credit} currency={currency} />
                  </span>
                </li>
              )}
            </ul>
          </section>

          <footer className="mt-4 border-t border-slate-100 bg-slate-50/70 px-5 py-4 text-xs text-slate-500 sm:px-7 print:bg-white">
            {receipt.received_by && (
              <p>
                <T en={`Received by ${receipt.received_by}`} ar={`المستلم: ${receipt.received_by}`} />
              </p>
            )}
            <p className="mt-1">
              <T en="Keep this receipt as proof of payment." ar="احتفظوا بهذا الإيصال كإثبات للدفع." />
            </p>
          </footer>
        </article>
      </main>
    </div>
  );
}

function Fact({ icon: Icon, label, children }: { icon: typeof Hash; label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 py-3">
      <dt className="flex shrink-0 items-center gap-2 text-slate-500">
        <Icon className="size-4" aria-hidden />
        {label}
      </dt>
      <dd className="min-w-0 text-end font-medium break-words text-slate-900">{children}</dd>
    </div>
  );
}
