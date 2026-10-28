import { CheckCircle2, CreditCard, ExternalLink, Languages, Users, Wallet } from "lucide-react";
import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import { BankTransfer, FamilyXpayCheckout } from "@/app/i/[token]/payment-options";
import { hours, isLang, type Lang, lessons, money, PARENT_LANG_COOKIE } from "@/app/p/[token]/copy";
import { apiBase } from "@/lib/api-base";

/**
 * The family's one payment link — what a parent opens when two children or more owe on their
 * packages: every child's bill, what it is for, the total, and the academy's transfer details for
 * the whole amount at once. The bills stay separate (each package is marked paid by its own money);
 * a card pays each through its own `/i/` page, linked from its line. No account, no password: the
 * link is the credential, so the page is never cached and never indexed.
 *
 * Data comes only from `GET /api/f/{token}` (FamilyPayController::build), which is the allow-list.
 */

const API_URL = process.env.API_URL ?? apiBase();

type Purpose = "NEW" | "RENEWAL" | "AUTO_RENEWAL" | "USAGE" | "UNBILLED" | "OVERDRAFT";

interface FamilyPayload {
  academy: { name: string; logo_url: string | null };
  guardian_name: string;
  items: Array<{
    child: string;
    package_no: number;
    label: string;
    course: string | null;
    purpose: Purpose;
    lessons: number;
    minutes: number;
    due_minor: number;
    currency: string;
    url: string;
  }>;
  totals: Array<{ currency: string; amount_minor: number }>;
  bank_transfer: Record<string, string> | null;
  card: boolean;
  /** XPay is on: one card payment for the whole total, split across the bills when it settles. */
  xpay?: boolean;
}

const COPY: Record<Lang, Record<string, string>> = {
  ar: {
    title: "مستحقات العائلة",
    total: "المطلوب سداده",
    items: "التفاصيل",
    packageNo: "الباقة رقم",
    payOne: "ادفع هذه وحدها",
    payAllTitle: "ادفع المبلغ كله بتحويل واحد",
    cardAllTitle: "ادفع المبلغ كله بالبطاقة",
    cardAllBody: "دفعة واحدة بالبطاقة تسدّد كل الفواتير أعلاه.",
    cardTitle: "الدفع بالبطاقة",
    cardBody: "تُدفع البطاقة لكل فاتورة على حدة — اضغط «ادفع هذه وحدها» بجانب كل واحدة.",
    noMethod: "تواصل مع الأكاديمية لإتمام الدفع.",
    nothingTitle: "لا توجد مستحقات الآن",
    nothingBody: "تم سداد كل شيء — شكرًا لكم.",
    switch: "English",
  },
  en: {
    title: "Family dues",
    total: "Amount to pay",
    items: "Details",
    packageNo: "Package #",
    payOne: "Pay this one only",
    payAllTitle: "Pay it all in one transfer",
    cardAllTitle: "Pay it all by card",
    cardAllBody: "One card payment settles every bill above.",
    cardTitle: "Pay by card",
    cardBody: "A card pays each bill on its own — use “Pay this one only” beside each.",
    noMethod: "Contact the academy to complete the payment.",
    nothingTitle: "Nothing is due right now",
    nothingBody: "Everything is paid — thank you.",
    switch: "العربية",
  },
};

const PURPOSE: Record<Lang, Record<Purpose, string>> = {
  ar: {
    NEW: "اشتراك جديد",
    RENEWAL: "تجديد",
    AUTO_RENEWAL: "تجديد تلقائي",
    USAGE: "عن الساعات المستهلكة",
    UNBILLED: "ساعات مستهلكة",
    OVERDRAFT: "ساعات زائدة",
  },
  en: {
    NEW: "New subscription",
    RENEWAL: "Renewal",
    AUTO_RENEWAL: "Auto-renewal",
    USAGE: "Hours used",
    UNBILLED: "Hours used",
    OVERDRAFT: "Extra hours",
  },
};

const PURPOSE_TONE: Record<Purpose, string> = {
  NEW: "bg-emerald-100 text-emerald-800",
  RENEWAL: "bg-sky-100 text-sky-800",
  AUTO_RENEWAL: "bg-sky-100 text-sky-800",
  USAGE: "bg-violet-100 text-violet-800",
  UNBILLED: "bg-amber-100 text-amber-800",
  OVERDRAFT: "bg-rose-100 text-rose-800",
};

const fetchFamily = cache(async (token: string): Promise<FamilyPayload | null> => {
  const res = await fetch(`${API_URL}/api/f/${encodeURIComponent(token)}`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Family payment page fetch failed: ${res.status}`);
  return res.json() as Promise<FamilyPayload>;
});

interface PageProps {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ lang?: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;
  const data = await fetchFamily(token);

  return {
    title: data ? data.academy.name : "Acadmyq",
    robots: { index: false, follow: false, nosnippet: true },
    ...(data?.academy.logo_url ? { icons: { icon: data.academy.logo_url } } : {}),
  };
}

export default async function FamilyPayPage({ params, searchParams }: PageProps) {
  const { token } = await params;
  const { lang: asked } = await searchParams;
  const data = await fetchFamily(token);
  if (!data) notFound();

  const remembered = (await cookies()).get(PARENT_LANG_COOKIE)?.value;
  const staffLocale = await getLocale();
  const lang: Lang = isLang(asked) ? asked : isLang(remembered) ? remembered : isLang(staffLocale) ? staffLocale : "ar";
  const t = COPY[lang];
  const nothingDue = data.items.length === 0;

  return (
    <main dir={lang === "ar" ? "rtl" : "ltr"} lang={lang} className="min-h-dvh bg-slate-50 px-4 py-6 text-slate-900 sm:py-10">
      <div className="mx-auto max-w-xl space-y-4">
        {/* The academy, and the way to the other language */}
        <header className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {data.academy.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- the academy's own logo, any host
              <img src={data.academy.logo_url} alt="" className="size-10 shrink-0 rounded-xl bg-white object-contain ring-1 ring-slate-200" />
            ) : (
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-sm font-bold text-white">
                {data.academy.name.slice(0, 1)}
              </span>
            )}
            <p className="truncate font-bold">{data.academy.name}</p>
          </div>
          <a
            href={`?lang=${lang === "ar" ? "en" : "ar"}`}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"
          >
            <Languages className="size-3.5" aria-hidden />
            {t.switch}
          </a>
        </header>

        {/* Who, and the one number */}
        <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <div className="flex items-center gap-3 bg-gradient-to-br from-emerald-600 to-emerald-700 px-5 py-5 text-white">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white/15">
              <Users className="size-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-medium text-emerald-50/90">{t.title}</p>
              <h1 className="truncate text-lg font-bold">{data.guardian_name}</h1>
            </div>
          </div>
          {nothingDue ? (
            <div className="flex flex-col items-center gap-2 px-5 py-8 text-center">
              <CheckCircle2 className="size-10 text-emerald-600" aria-hidden />
              <p className="font-bold">{t.nothingTitle}</p>
              <p className="text-sm text-slate-500">{t.nothingBody}</p>
            </div>
          ) : (
            <div className="px-5 py-4">
              <p className="text-xs font-medium text-slate-500">{t.total}</p>
              {data.totals.map((o) => (
                <p key={o.currency} className="text-3xl font-extrabold tabular-nums text-slate-900" data-testid="family-total">
                  {money(o.amount_minor, o.currency, lang)}
                </p>
              ))}
            </div>
          )}
        </section>

        {/* Each child's bill */}
        {!nothingDue && (
          <section className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
            <h2 className="border-b border-slate-100 px-5 py-3 text-sm font-bold">{t.items}</h2>
            <ul className="divide-y divide-slate-100">
              {data.items.map((item) => (
                <li key={item.url} className="px-5 py-3.5" data-testid="family-item">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold">{item.child}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                        <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${PURPOSE_TONE[item.purpose]}`}>
                          {PURPOSE[lang][item.purpose]}
                        </span>
                        <span>
                          {t.packageNo} {item.package_no} · {item.label}
                          {item.course ? ` · ${item.course}` : ""}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {hours(item.minutes, lang)} · {lessons(item.lessons, lang)}
                      </p>
                    </div>
                    <div className="shrink-0 text-end">
                      <p className="font-bold tabular-nums">{money(item.due_minor, item.currency, lang)}</p>
                      <a
                        href={item.url}
                        className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline"
                      >
                        {t.payOne}
                        <ExternalLink className="size-3" aria-hidden />
                      </a>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* How to pay it all */}
        {/* One card payment for the whole total — first, because it is the one that is done in a minute. */}
        {!nothingDue && data.xpay && (
          <section className="space-y-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200" data-testid="family-card-pay">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-bold">
                <CreditCard className="size-4 text-emerald-600" aria-hidden />
                {t.cardAllTitle}
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">{t.cardAllBody}</p>
            </div>
            {data.totals.map((o, i) => (
              <FamilyXpayCheckout
                key={o.currency}
                familyToken={token}
                amountMinor={o.amount_minor}
                currency={o.currency}
                confirmsReturn={i === 0}
              />
            ))}
          </section>
        )}
        {!nothingDue && data.bank_transfer && (
          <section className="space-y-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <h2 className="flex items-center gap-2 text-sm font-bold">
              <Wallet className="size-4 text-emerald-600" aria-hidden />
              {t.payAllTitle}
            </h2>
            {data.totals.map((o) => (
              <BankTransfer
                key={o.currency}
                config={data.bank_transfer!}
                amountMinor={o.amount_minor}
                currency={o.currency}
                reference={data.guardian_name}
              />
            ))}
          </section>
        )}
        {/* PayPal (no XPay): a card still pays each bill through its own page. */}
        {!nothingDue && data.card && !data.xpay && (
          <section className="flex items-start gap-3 rounded-2xl bg-white p-5 text-sm shadow-sm ring-1 ring-slate-200">
            <CreditCard className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
            <div>
              <p className="font-bold">{t.cardTitle}</p>
              <p className="mt-0.5 text-slate-500">{t.cardBody}</p>
            </div>
          </section>
        )}
        {!nothingDue && !data.bank_transfer && !data.card && (
          <p className="text-center text-sm text-slate-500">{t.noMethod}</p>
        )}
      </div>
    </main>
  );
}
