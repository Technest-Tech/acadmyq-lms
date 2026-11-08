import { apiBase } from "@/lib/api-base";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatMoney } from "@/lib/money";
import { PaymentSubmit, type ReceivingMethods } from "./payment-submit";

// ── The client's account as its pay link shows it (mirrors app.public_account_by_token) ──

interface AccountDue {
  id: string;
  title: string;
  due_on: string;
  remaining_minor: number;
  currency: string;
  overdue: boolean;
}

interface AccountDTO {
  client_name: string;
  payment_methods: ReceivingMethods;
  /** Every open due on the client's active agreement lines, oldest first. */
  dues: AccountDue[];
  /** What to pay now — everything already due plus anything falling due within a week. */
  due_now: Array<{ currency: string; amount_minor: number }>;
  next_due_on: string | null;
  overdue: boolean;
  /** A proof was uploaded and waits for the owner's review. */
  pending_proof: boolean;
}

// `API_URL` lets a deploy point server-side fetches at an internal address; otherwise the shared
// resolver applies (and turns a port-only value into a loopback origin — there is no page host here).
const API_URL = process.env.API_URL ?? apiBase();

async function fetchAccount(token: string): Promise<AccountDTO | null> {
  const res = await fetch(`${API_URL}/api/a/${token}`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Account fetch failed: ${res.status}`);
  return res.json() as Promise<AccountDTO>;
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
      <span className="ltr:inline rtl:hidden">{formatMoney({ amount: minor, currency }, "en")}</span>
      <span className="rtl:inline ltr:hidden">{formatMoney({ amount: minor, currency }, "ar")}</span>
    </>
  );
}

interface PageProps {
  params: Promise<{ token: string }>;
}

/**
 * /a/{token} — a client's ONE pay link (Accounts, 2026-11-08). It shows what the client owes the
 * platform now (late + due within a week) and what comes after, with the platform's receiving
 * details and a transfer-screenshot upload. The same link works for every payment, so a client
 * keeps one bookmark; a link to an old per-module bill opens its account too.
 */
export default async function AccountPayPage({ params }: PageProps) {
  const { token } = await params;
  const account = await fetchAccount(token);
  if (!account) notFound();

  const now = account.due_now.filter((d) => d.amount_minor > 0);
  const owesNow = now.length > 0;
  const first = now[0];
  const later = account.dues.filter((d) => !d.overdue).slice(0, 6);
  const late = account.dues.filter((d) => d.overdue);

  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl px-4 py-8 sm:py-12">
      <div className="bg-card overflow-hidden rounded-3xl border shadow-sm ring-1 ring-foreground/[0.04]">
        {/* Hero */}
        <div className="from-primary relative bg-gradient-to-br to-indigo-700 px-6 py-8 text-white sm:px-8">
          <p className="text-sm font-medium opacity-90">{account.client_name}</p>
          <h1 className="mt-1 text-lg font-semibold">
            <T en="Your subscription" ar="اشتراككم" />
          </h1>
          <div className="mt-5 flex items-end justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs tracking-wide uppercase opacity-80">
                {owesNow ? <T en="Amount due now" ar="المستحق الآن" /> : <T en="Nothing due now" ar="لا يوجد مستحق الآن" />}
              </p>
              {owesNow && first ? (
                <p className="mt-0.5 text-3xl font-bold break-words" dir="ltr">
                  {now.map((d, i) => (
                    <span key={d.currency}>
                      {i > 0 ? " + " : ""}
                      <Money minor={d.amount_minor} currency={d.currency} />
                    </span>
                  ))}
                </p>
              ) : account.next_due_on ? (
                <p className="mt-1 text-sm font-medium" dir="ltr">
                  <T en={`Next payment ${account.next_due_on}`} ar={`الدفعة القادمة ${account.next_due_on}`} />
                </p>
              ) : null}
            </div>
            <span
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${
                account.overdue ? "bg-rose-400/30 ring-rose-200/50" : owesNow ? "bg-white/20 ring-white/30" : "bg-emerald-400/25 ring-emerald-200/50"
              }`}
            >
              {account.overdue ? <T en="Overdue" ar="متأخر" /> : owesNow ? <T en="Due" ar="مستحق" /> : <T en="All paid" ar="مدفوع بالكامل" />}
            </span>
          </div>
        </div>

        {/* What it is for */}
        {(late.length > 0 || later.length > 0) && (
          <ul className="divide-y text-sm">
            {[...late, ...later].map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 px-6 py-3 sm:px-8">
                <div className="min-w-0">
                  <p className="font-medium break-words">{d.title}</p>
                  <p className={`text-xs ${d.overdue ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground"}`} dir="ltr">
                    {d.overdue ? <T en={`Overdue since ${d.due_on}`} ar={`متأخر من ${d.due_on}`} /> : <T en={`Due ${d.due_on}`} ar={`مستحق ${d.due_on}`} />}
                  </p>
                </div>
                <span className="shrink-0 font-semibold tabular-nums" dir="ltr">
                  <Money minor={d.remaining_minor} currency={d.currency} />
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* Payment / status */}
        <div className="border-t px-6 py-6 sm:px-8">
          {account.pending_proof && (
            <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
              <T en="We received your payment proof and are reviewing it." ar="استلمنا إثبات الدفع وجارٍ مراجعته." />
            </div>
          )}
          {account.dues.length === 0 ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-5 text-center text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200">
              <p className="font-semibold">
                <T en="Everything is paid — thank you!" ar="كل المستحقات مدفوعة — شكراً لكم!" />
              </p>
            </div>
          ) : (
            <PaymentSubmit token={token} methods={account.payment_methods} amountMinor={first?.amount_minor} />
          )}
        </div>
      </div>
    </main>
  );
}
