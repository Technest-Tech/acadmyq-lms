"use client";

import { apiBase } from "@/lib/api-base";
import { formatMoney } from "@/lib/money";
import {
  Check,
  ChevronDown,
  Copy,
  CreditCard,
  Info,
  Landmark,
  Lock,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

const API_BASE = apiBase();

export interface PublicPaymentMethod {
  method: "BANK_TRANSFER" | "PAYPAL" | "XPAY";
  config: Record<string, string>;
}

interface PaymentOptionsProps {
  currency: string;
  methods: PublicPaymentMethod[];
  invoiceToken: string;
  /** What is left to pay — shown on the pay button and copied for a bank transfer. */
  amountMinor: number;
  /** Human reference the payer quotes on a bank transfer so the academy can match it. */
  reference: string;
}

// ── Bilingual text ──────────────────────────────────────────────────────────

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

function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
      aria-hidden
    />
  );
}

// ── Acceptance marks ────────────────────────────────────────────────────────

function VisaMark() {
  return (
    <svg
      viewBox="0 0 38 24"
      className="h-5 w-auto"
      role="img"
      aria-label="Visa"
    >
      <rect
        x=".5"
        y=".5"
        width="37"
        height="23"
        rx="3.5"
        fill="#fff"
        stroke="#E4E7EC"
      />
      <text
        x="19"
        y="16"
        textAnchor="middle"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize="10"
        fontWeight="800"
        fontStyle="italic"
        fill="#1A1F71"
      >
        VISA
      </text>
    </svg>
  );
}

function MastercardMark() {
  return (
    <svg
      viewBox="0 0 38 24"
      className="h-5 w-auto"
      role="img"
      aria-label="Mastercard"
    >
      <rect
        x=".5"
        y=".5"
        width="37"
        height="23"
        rx="3.5"
        fill="#fff"
        stroke="#E4E7EC"
      />
      <circle cx="15.5" cy="12" r="6.5" fill="#EB001B" />
      <circle cx="22.5" cy="12" r="6.5" fill="#F79E1B" />
      <path
        d="M19 6.52a6.5 6.5 0 0 1 0 10.96 6.5 6.5 0 0 1 0-10.96Z"
        fill="#FF5F00"
      />
    </svg>
  );
}

function MeezaMark() {
  return (
    <svg
      viewBox="0 0 38 24"
      className="h-5 w-auto"
      role="img"
      aria-label="Meeza"
    >
      <rect
        x=".5"
        y=".5"
        width="37"
        height="23"
        rx="3.5"
        fill="#fff"
        stroke="#E4E7EC"
      />
      <text
        x="19"
        y="15.5"
        textAnchor="middle"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize="8.5"
        fontWeight="700"
        fill="#0F7A3E"
      >
        meeza
      </text>
    </svg>
  );
}

function PaypalMark() {
  return (
    <span
      className="font-sans text-sm font-extrabold italic tracking-tight"
      aria-label="PayPal"
      dir="ltr"
    >
      <span className="text-[#003087]">Pay</span>
      <span className="text-[#009CDE]">Pal</span>
    </span>
  );
}

// ── Copyable detail row ──────────────────────────────────────────────────────

function CopyRow({
  labelEn,
  labelAr,
  value,
  display,
  mono = false,
}: {
  labelEn: string;
  labelAr: string;
  value: string;
  /** What to show when it differs from what gets copied (e.g. a formatted amount). */
  display?: React.ReactNode;
  mono?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  }
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="text-xs text-slate-500">
          <T en={labelEn} ar={labelAr} />
        </p>
        <p
          className={`mt-0.5 break-all text-sm font-semibold text-slate-900 ${mono ? "font-mono tracking-wide" : ""}`}
        >
          {display ?? <bdi>{value}</bdi>}
        </p>
      </div>
      <button
        type="button"
        onClick={() => void copy()}
        className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition-colors ${
          copied
            ? "bg-emerald-50 text-emerald-700"
            : "text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 hover:text-slate-900"
        }`}
      >
        {copied ? (
          <>
            <Check className="size-3.5" aria-hidden />
            <T en="Copied" ar="تم النسخ" />
          </>
        ) : (
          <>
            <Copy className="size-3.5" aria-hidden />
            <T en="Copy" ar="نسخ" />
          </>
        )}
      </button>
    </div>
  );
}

function SuccessPanel() {
  return (
    <div className="rounded-xl bg-emerald-50 px-5 py-6 text-center ring-1 ring-emerald-100">
      <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-emerald-600 text-white">
        <Check className="size-6" strokeWidth={3} aria-hidden />
      </div>
      <p className="font-semibold text-emerald-900">
        <T en="Payment successful" ar="تمّ الدفع بنجاح" />
      </p>
      <p className="mt-1 text-sm text-emerald-700">
        <T
          en="Thank you — your receipt is ready."
          ar="شكراً لك — إيصالك جاهز."
        />
      </p>
    </div>
  );
}

function Notice({
  tone,
  children,
}: {
  tone: "error" | "warning";
  children: React.ReactNode;
}) {
  return (
    <div
      role="alert"
      className={`flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-sm ${
        tone === "error"
          ? "bg-red-50 text-red-700 ring-1 ring-red-100"
          : "bg-amber-50 text-amber-800 ring-1 ring-amber-100"
      }`}
    >
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

// ── PayPal checkout ──────────────────────────────────────────────────────────

declare global {
  interface Window {
    paypal?: {
      Buttons: (opts: {
        createOrder: () => Promise<string>;
        onApprove: (data: { orderID: string }) => Promise<void>;
        onError: (err: unknown) => void;
      }) => { render: (selector: string) => void };
    };
  }
}

function PaypalCheckout({
  config,
  invoiceToken,
  currency,
}: {
  config: Record<string, string>;
  invoiceToken: string;
  currency: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [sdkState, setSdkState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [payState, setPayState] = useState<
    "idle" | "processing" | "success" | "error"
  >("idle");
  const [payError, setPayError] = useState<string | null>(null);

  const clientId = config.client_id;

  useEffect(() => {
    if (!clientId || typeof window === "undefined") {
      setSdkState("error");
      return;
    }
    if (window.paypal) {
      setSdkState("ready");
      return;
    }
    const script = document.createElement("script");
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(
      clientId,
    )}&currency=${encodeURIComponent(currency.toUpperCase())}&intent=capture`;
    script.async = true;
    script.onload = () => setSdkState("ready");
    script.onerror = () => setSdkState("error");
    document.head.appendChild(script);
    return () => {
      document.head.removeChild(script);
    };
  }, [clientId, currency]);

  useEffect(() => {
    if (sdkState !== "ready" || !window.paypal || !containerRef.current) return;
    containerRef.current.innerHTML = "";
    window.paypal
      .Buttons({
        createOrder: async () => {
          const res = await fetch(
            `${API_BASE}/api/i/${invoiceToken}/paypal/create-order`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
              },
            },
          );
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(
              (body as { message?: string }).message ??
                "Could not create order",
            );
          }
          const data = (await res.json()) as { order_id: string };
          return data.order_id;
        },
        onApprove: async ({ orderID }) => {
          setPayState("processing");
          const res = await fetch(
            `${API_BASE}/api/i/${invoiceToken}/paypal/capture/${orderID}`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
              },
            },
          );
          if (!res.ok) {
            setPayState("error");
            setPayError("Payment capture failed. Please contact support.");
            return;
          }
          setPayState("success");
        },
        onError: (err) => {
          console.error("PayPal error", err);
          setPayState("error");
          setPayError("Something went wrong with PayPal. Please try again.");
        },
      })
      .render("#paypal-buttons");
  }, [sdkState, invoiceToken]);

  if (!clientId) {
    return config.email ? (
      <div className="divide-y divide-slate-100 rounded-xl bg-white ring-1 ring-slate-200">
        <CopyRow
          labelEn="Send to PayPal"
          labelAr="أرسل إلى حساب باي بال"
          value={config.email}
          mono
        />
      </div>
    ) : (
      <p className="text-sm text-slate-500">
        <T
          en="Contact the academy for PayPal details."
          ar="تواصل مع الأكاديمية للحصول على تفاصيل باي بال."
        />
      </p>
    );
  }

  if (payState === "success") return <SuccessPanel />;

  return (
    <div className="space-y-3">
      {payState === "error" && payError && (
        <Notice tone="error">{payError}</Notice>
      )}
      {payState === "processing" && (
        <div className="flex items-center justify-center gap-2 py-2 text-sm text-slate-600">
          <Spinner className="text-emerald-600" />
          <T en="Processing payment…" ar="جارٍ معالجة الدفع…" />
        </div>
      )}
      {sdkState === "loading" && payState === "idle" && (
        <div className="flex items-center justify-center gap-2 py-3 text-sm text-slate-400">
          <Spinner />
          <T en="Loading PayPal…" ar="جارٍ تحميل باي بال…" />
        </div>
      )}
      {sdkState === "error" && (
        <Notice tone="error">
          <T
            en="Could not load PayPal. Please reload the page."
            ar="تعذّر تحميل باي بال. يُرجى إعادة تحميل الصفحة."
          />
        </Notice>
      )}
      <div id="paypal-buttons" ref={containerRef} />
    </div>
  );
}

// ── XPay hosted checkout ─────────────────────────────────────────────────────

/**
 * XPay runs as a HOSTED redirect: we ask the API to open a Checkout Session, send the payer to
 * XPay's page (card entry + 3-D Secure live there, so no card data ever touches this app), and they
 * come back to `/i/{token}?xpay=cs_…`.
 *
 * That return is a courtesy, not the confirmation — the payer can close the tab and the payment
 * still lands. The real settlement is the `checkout.session.completed` webhook. What the return
 * does is let us ASK the API to confirm, which also covers the case where the academy's webhook
 * endpoint was never configured.
 */
function XpayCheckout({
  invoiceToken,
  amountMinor,
  currency,
  onPaid,
}: {
  invoiceToken: string;
  amountMinor: number;
  currency: string;
  onPaid: () => void;
}) {
  const [state, setState] = useState<
    "idle" | "redirecting" | "confirming" | "success" | "cancelled" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);

  // On return from XPay, confirm the session named in the query string.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);

    if (params.get("xpay_cancelled") === "1") {
      setState("cancelled");
      return;
    }

    const sessionId = params.get("xpay");
    if (!sessionId) return;

    setState("confirming");
    void (async () => {
      try {
        const res = await fetch(
          `${API_BASE}/api/i/${invoiceToken}/xpay/session/${encodeURIComponent(sessionId)}`,
          { headers: { Accept: "application/json" } },
        );
        const body = (await res.json().catch(() => ({}))) as {
          paid?: boolean;
          message?: string;
        };
        if (res.ok && body.paid) {
          setState("success");
          onPaid();
        } else {
          setState("error");
          setError(
            body.message ??
              "We could not confirm the payment yet. If you were charged, it will update shortly.",
          );
        }
      } catch {
        setState("error");
        setError("We could not reach the payment service. Please refresh.");
      }
    })();
  }, [invoiceToken, onPaid]);

  const start = async () => {
    setState("redirecting");
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/i/${invoiceToken}/xpay/session`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        url?: string;
        message?: string;
      };
      if (!res.ok || !body.url) {
        setState("error");
        setError(
          body.message ?? "Could not start the payment. Please try again.",
        );
        return;
      }
      window.location.href = body.url;
    } catch {
      setState("error");
      setError("Could not reach the payment service. Please try again.");
    }
  };

  if (state === "success") return <SuccessPanel />;

  if (state === "confirming") {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl bg-slate-50 py-4 text-sm font-medium text-slate-700">
        <Spinner className="text-emerald-600" />
        <T en="Confirming your payment…" ar="جارٍ تأكيد عملية الدفع…" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {state === "cancelled" && (
        <Notice tone="warning">
          <T
            en="The payment was not completed. You can try again."
            ar="لم تكتمل عملية الدفع. يمكنك المحاولة مرة أخرى."
          />
        </Notice>
      )}
      {state === "error" && error && <Notice tone="error">{error}</Notice>}

      <button
        type="button"
        onClick={() => void start()}
        disabled={state === "redirecting"}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 text-[0.95rem] font-semibold text-white shadow-sm shadow-emerald-900/20 transition-colors hover:bg-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:opacity-70"
      >
        {state === "redirecting" ? (
          <>
            <Spinner />
            <T en="Opening secure checkout…" ar="جارٍ فتح صفحة الدفع الآمنة…" />
          </>
        ) : (
          <>
            <Lock className="size-4" aria-hidden />
            <T en="Pay" ar="ادفع" />{" "}
            <Money minor={amountMinor} currency={currency} />
          </>
        )}
      </button>

      <p className="flex items-center justify-center gap-1.5 text-center text-xs text-slate-500">
        <ShieldCheck
          className="size-3.5 shrink-0 text-emerald-600"
          aria-hidden
        />
        <T
          en="Card details are entered on XPay's secure page, with 3-D Secure."
          ar="تُدخل بيانات البطاقة في صفحة XPay الآمنة مع التحقق ثلاثي الأبعاد."
        />
      </p>
    </div>
  );
}

// ── Bank transfer ────────────────────────────────────────────────────────────

function BankTransfer({
  config: c,
  amountMinor,
  currency,
  reference,
}: {
  config: Record<string, string>;
  amountMinor: number;
  currency: string;
  reference: string;
}) {
  return (
    <div className="space-y-3">
      <div className="divide-y divide-slate-100 overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
        <CopyRow
          labelEn="Amount to transfer"
          labelAr="المبلغ المطلوب تحويله"
          value={(amountMinor / 100).toFixed(2)}
          display={<Money minor={amountMinor} currency={currency} />}
        />
        {c.bank_name && (
          <CopyRow labelEn="Bank" labelAr="البنك" value={c.bank_name} />
        )}
        {c.account_holder && (
          <CopyRow
            labelEn="Account holder"
            labelAr="اسم صاحب الحساب"
            value={c.account_holder}
          />
        )}
        {c.account_number && (
          <CopyRow
            labelEn="Account number"
            labelAr="رقم الحساب"
            value={c.account_number}
            mono
          />
        )}
        {c.iban && (
          <CopyRow labelEn="IBAN" labelAr="الآيبان" value={c.iban} mono />
        )}
        <CopyRow
          labelEn="Transfer reference"
          labelAr="مرجع التحويل"
          value={reference}
          mono
        />
      </div>
      <p className="flex items-start gap-2 text-xs leading-relaxed text-slate-500">
        <Info className="mt-px size-3.5 shrink-0 text-slate-400" aria-hidden />
        <T
          en="Write the reference in the transfer note, then send the receipt to the academy so they can confirm your payment."
          ar="اكتب المرجع في ملاحظة التحويل، ثم أرسل الإيصال إلى الأكاديمية لتأكيد الدفع."
        />
      </p>
    </div>
  );
}

// ── Method metadata ──────────────────────────────────────────────────────────

const METHOD_META: Record<
  PublicPaymentMethod["method"],
  {
    icon: typeof Landmark;
    en: string;
    ar: string;
    hintEn: string;
    hintAr: string;
  }
> = {
  XPAY: {
    icon: CreditCard,
    en: "Debit or credit card",
    ar: "بطاقة بنكية",
    hintEn: "Instant confirmation",
    hintAr: "تأكيد فوري",
  },
  PAYPAL: {
    icon: Wallet,
    en: "PayPal",
    ar: "باي بال",
    hintEn: "Pay with your PayPal account",
    hintAr: "ادفع من حسابك في باي بال",
  },
  BANK_TRANSFER: {
    icon: Landmark,
    en: "Bank transfer",
    ar: "تحويل بنكي",
    hintEn: "Confirmed by the academy",
    hintAr: "تؤكّده الأكاديمية",
  },
};

/** Instant methods first — the card is what most payers want, the transfer is the fallback. */
const METHOD_ORDER: PublicPaymentMethod["method"][] = [
  "XPAY",
  "PAYPAL",
  "BANK_TRANSFER",
];

function CardMarks({ className }: { className: string }) {
  return (
    <span className={`items-center gap-1 ${className}`} dir="ltr">
      <VisaMark />
      <MastercardMark />
      <MeezaMark />
    </span>
  );
}

function MethodMarks({ method }: { method: PublicPaymentMethod["method"] }) {
  // On a phone the card marks sit under the label instead (see the tile), where there is room.
  if (method === "XPAY") return <CardMarks className="hidden sm:flex" />;
  if (method === "PAYPAL") return <PaypalMark />;
  return null;
}

function MethodBody({
  pm,
  currency,
  invoiceToken,
  amountMinor,
  reference,
  onPaid,
}: {
  pm: PublicPaymentMethod;
  currency: string;
  invoiceToken: string;
  amountMinor: number;
  reference: string;
  onPaid: () => void;
}) {
  if (pm.method === "BANK_TRANSFER") {
    return (
      <BankTransfer
        config={pm.config}
        amountMinor={amountMinor}
        currency={currency}
        reference={reference}
      />
    );
  }
  if (pm.method === "PAYPAL") {
    return (
      <PaypalCheckout
        config={pm.config}
        invoiceToken={invoiceToken}
        currency={currency}
      />
    );
  }
  if (pm.method === "XPAY") {
    return (
      <XpayCheckout
        invoiceToken={invoiceToken}
        amountMinor={amountMinor}
        currency={currency}
        onPaid={onPaid}
      />
    );
  }
  return (
    <p className="text-sm text-slate-500">
      <T
        en="Contact the academy to complete the payment."
        ar="تواصل مع الأكاديمية لإتمام عملية الدفع."
      />
    </p>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export function PaymentOptions({
  currency,
  methods: unordered,
  invoiceToken,
  amountMinor,
  reference,
}: PaymentOptionsProps) {
  const router = useRouter();
  // Stable, because XpayCheckout's confirm effect depends on it — a fresh closure per render
  // would re-run the confirmation after every refresh.
  const onPaid = useCallback(() => router.refresh(), [router]);
  const methods = [...unordered].sort(
    (a, b) => METHOD_ORDER.indexOf(a.method) - METHOD_ORDER.indexOf(b.method),
  );

  // Every method starts folded so the card stays short on a phone; the payer opens the one they
  // want. The exception is a return from XPay, which opens the panel about to confirm the payment.
  const [openKey, setOpenKey] = useState<string | null>(() => {
    if (
      typeof window !== "undefined" &&
      methods.some((m) => m.method === "XPAY")
    ) {
      const params = new URLSearchParams(window.location.search);
      if (params.has("xpay") || params.has("xpay_cancelled")) return "XPAY";
    }
    return null;
  });

  if (methods.length === 0) {
    return (
      <div className="flex items-start gap-3 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white text-slate-500 ring-1 ring-slate-200">
          <Landmark className="size-4" aria-hidden />
        </span>
        <p className="text-sm leading-relaxed text-slate-600">
          <T
            en="Payment is arranged directly with the academy. Please contact them to complete it."
            ar="يتم الدفع مباشرة مع الأكاديمية. يُرجى التواصل معها لإتمام الدفع."
          />
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {methods.map((pm) => {
        const meta = METHOD_META[pm.method];
        const Icon = meta.icon;
        const isOpen = openKey === pm.method;
        return (
          <div
            key={pm.method}
            className={`overflow-hidden rounded-2xl bg-white transition-shadow ${
              isOpen
                ? "shadow-sm ring-2 ring-emerald-600"
                : "ring-1 ring-slate-200 hover:ring-slate-300"
            }`}
          >
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpenKey(isOpen ? null : pm.method)}
              className="flex w-full items-center gap-3 px-3.5 py-3 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500"
            >
              <span
                className={`flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors ${
                  isOpen
                    ? "bg-emerald-600 text-white"
                    : "bg-emerald-50 text-emerald-700"
                }`}
              >
                <Icon className="size-[1.1rem]" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-slate-900">
                  <T en={meta.en} ar={meta.ar} />
                </span>
                <span className="block text-xs text-slate-500">
                  <T en={meta.hintEn} ar={meta.hintAr} />
                </span>
                {pm.method === "XPAY" && (
                  <CardMarks className="mt-1.5 flex sm:hidden" />
                )}
              </span>
              <MethodMarks method={pm.method} />
              <ChevronDown
                className={`size-5 shrink-0 text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
                aria-hidden
              />
            </button>
            {isOpen && (
              <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-4">
                <MethodBody
                  pm={pm}
                  currency={currency}
                  invoiceToken={invoiceToken}
                  amountMinor={amountMinor}
                  reference={reference}
                  onPaid={onPaid}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
