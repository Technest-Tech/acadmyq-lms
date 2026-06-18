"use client";

import {
  Building2,
  Check,
  ChevronDown,
  Copy,
  Landmark,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export interface PublicPaymentMethod {
  method: "BANK_TRANSFER" | "PAYPAL" | "XPAY";
  config: Record<string, string>;
}

interface PaymentOptionsProps {
  currency: string;
  methods: PublicPaymentMethod[];
  invoiceToken: string;
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

// ── Copyable detail row ──────────────────────────────────────────────────────

function CopyRow({
  labelEn,
  labelAr,
  value,
  mono = false,
}: {
  labelEn: string;
  labelAr: string;
  value: string;
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
    <div className="flex items-center justify-between gap-3 rounded-xl bg-white/70 px-3.5 py-2.5 ring-1 ring-emerald-900/5">
      <div className="min-w-0">
        <p className="text-[0.7rem] font-medium uppercase tracking-wide text-emerald-700/70">
          <T en={labelEn} ar={labelAr} />
        </p>
        <p
          className={`truncate text-sm font-semibold text-gray-800 ${mono ? "font-mono" : ""}`}
        >
          {value}
        </p>
      </div>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label="Copy"
        className="flex size-8 shrink-0 items-center justify-center rounded-lg text-emerald-700 transition-colors hover:bg-emerald-100 print:hidden"
      >
        {copied ? (
          <Check className="size-4 text-emerald-600" aria-hidden />
        ) : (
          <Copy className="size-4" aria-hidden />
        )}
      </button>
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
      <CopyRow
        labelEn="PayPal email"
        labelAr="بريد باي بال"
        value={config.email}
        mono
      />
    ) : (
      <p className="text-sm text-gray-500">
        <T
          en="Contact the academy for PayPal details."
          ar="تواصل مع الأكاديمية للحصول على تفاصيل باي بال."
        />
      </p>
    );
  }

  if (payState === "success") {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-center">
        <div className="mx-auto mb-2 flex size-10 items-center justify-center rounded-full bg-emerald-100">
          <Check className="size-5 text-emerald-600" aria-hidden />
        </div>
        <p className="text-sm font-semibold text-emerald-800">
          <T
            en="Payment successful! Thank you."
            ar="تمّ الدفع بنجاح! شكراً لك."
          />
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {payState === "error" && payError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {payError}
        </div>
      )}
      {payState === "processing" && (
        <div className="flex items-center justify-center gap-2 py-2 text-sm text-gray-600">
          <div className="size-4 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
          <T en="Processing payment…" ar="جارٍ معالجة الدفع…" />
        </div>
      )}
      {sdkState === "loading" && payState === "idle" && (
        <div className="flex items-center justify-center gap-2 py-3 text-xs text-gray-400">
          <div className="size-3.5 animate-spin rounded-full border-2 border-gray-300 border-t-transparent" />
          <T en="Loading PayPal…" ar="جارٍ تحميل باي بال…" />
        </div>
      )}
      {sdkState === "error" && (
        <p className="text-xs text-red-600">
          <T
            en="Could not load PayPal. Please reload the page."
            ar="تعذّر تحميل باي بال. يُرجى إعادة تحميل الصفحة."
          />
        </p>
      )}
      <div id="paypal-buttons" ref={containerRef} />
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
  BANK_TRANSFER: {
    icon: Landmark,
    en: "Bank Transfer",
    ar: "تحويل بنكي",
    hintEn: "Transfer to the account below",
    hintAr: "حوّل إلى الحساب أدناه",
  },
  PAYPAL: {
    icon: Wallet,
    en: "PayPal",
    ar: "باي بال",
    hintEn: "Pay securely online",
    hintAr: "ادفع بأمان عبر الإنترنت",
  },
  XPAY: {
    icon: Building2,
    en: "XPay",
    ar: "إكس باي",
    hintEn: "Pay securely online",
    hintAr: "ادفع بأمان عبر الإنترنت",
  },
};

function MethodBody({
  pm,
  currency,
  invoiceToken,
}: {
  pm: PublicPaymentMethod;
  currency: string;
  invoiceToken: string;
}) {
  if (pm.method === "BANK_TRANSFER") {
    const c = pm.config;
    return (
      <div className="space-y-2">
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
      </div>
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
  return (
    <p className="text-sm text-gray-500">
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
  methods,
  invoiceToken,
}: PaymentOptionsProps) {
  // Open the first method by default so the payer immediately sees how to pay.
  const [openKey, setOpenKey] = useState<string | null>(
    methods.length > 0 ? methods[0]!.method : null,
  );

  if (methods.length === 0) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
        <p className="text-sm leading-relaxed text-amber-800">
          <T
            en="Payment is arranged directly with the academy. Please contact your academy to complete the payment."
            ar="يتم الدفع مباشرة مع الأكاديمية. يُرجى التواصل مع الأكاديمية لإتمام عملية الدفع."
          />
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {methods.map((pm) => {
        const meta = METHOD_META[pm.method];
        const Icon = meta.icon;
        const isOpen = openKey === pm.method;
        return (
          <div
            key={pm.method}
            className={`overflow-hidden rounded-2xl border transition-colors ${
              isOpen
                ? "border-emerald-400 bg-emerald-100 ring-1 ring-emerald-300"
                : "border-gray-200 bg-gray-100 hover:border-emerald-300 hover:bg-emerald-50"
            }`}
          >
            <button
              type="button"
              onClick={() => setOpenKey(isOpen ? null : pm.method)}
              aria-expanded={isOpen}
              className="flex w-full items-center gap-3.5 px-4 py-3.5 text-start"
            >
              <span
                className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${
                  isOpen
                    ? "bg-emerald-600 text-white"
                    : "bg-emerald-100 text-emerald-700"
                }`}
              >
                <Icon className="size-5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-gray-900">
                  <T en={meta.en} ar={meta.ar} />
                </span>
                <span className="block text-xs text-gray-500">
                  <T en={meta.hintEn} ar={meta.hintAr} />
                </span>
              </span>
              <ChevronDown
                className={`size-5 shrink-0 text-gray-400 transition-transform ${
                  isOpen ? "rotate-180" : ""
                } print:hidden`}
                aria-hidden
              />
            </button>
            {isOpen && (
              <div className="border-t border-emerald-100 px-4 py-4">
                <MethodBody
                  pm={pm}
                  currency={currency}
                  invoiceToken={invoiceToken}
                />
              </div>
            )}
          </div>
        );
      })}

      <div className="flex items-center justify-center gap-1.5 pt-1 text-xs text-gray-400">
        <ShieldCheck className="size-3.5" aria-hidden />
        <T
          en="Secure payment — your details are kept private."
          ar="دفع آمن — تبقى بياناتك خاصة."
        />
      </div>
    </div>
  );
}
