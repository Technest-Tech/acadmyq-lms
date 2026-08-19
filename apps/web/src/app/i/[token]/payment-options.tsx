"use client";

import { apiBase } from "@/lib/api-base";
import {
  Check,
  ChevronDown,
  Copy,
  CreditCard,
  Landmark,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const API_BASE = apiBase();

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
  onPaid,
}: {
  invoiceToken: string;
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
      const res = await fetch(`${API_BASE}/api/i/${invoiceToken}/xpay/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
      });
      const body = (await res.json().catch(() => ({}))) as {
        url?: string;
        message?: string;
      };
      if (!res.ok || !body.url) {
        setState("error");
        setError(body.message ?? "Could not start the payment. Please try again.");
        return;
      }
      window.location.href = body.url;
    } catch {
      setState("error");
      setError("Could not reach the payment service. Please try again.");
    }
  };

  if (state === "success") {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-center">
        <div className="mx-auto mb-2 flex size-10 items-center justify-center rounded-full bg-emerald-100">
          <Check className="size-5 text-emerald-600" aria-hidden />
        </div>
        <p className="text-sm font-semibold text-emerald-800">
          <T en="Payment successful! Thank you." ar="تمّ الدفع بنجاح! شكراً لك." />
        </p>
      </div>
    );
  }

  if (state === "confirming") {
    return (
      <div className="flex items-center justify-center gap-2 py-3 text-sm text-gray-600">
        <div className="size-4 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
        <T en="Confirming your payment…" ar="جارٍ تأكيد عملية الدفع…" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {state === "cancelled" && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <T
            en="The payment was not completed. You can try again below."
            ar="لم تكتمل عملية الدفع. يمكنك المحاولة مرة أخرى أدناه."
          />
        </div>
      )}
      {state === "error" && error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={() => void start()}
        disabled={state === "redirecting"}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-60 print:hidden"
      >
        {state === "redirecting" ? (
          <>
            <div className="size-4 animate-spin rounded-full border-2 border-white/50 border-t-transparent" />
            <T en="Opening secure checkout…" ar="جارٍ فتح صفحة الدفع الآمنة…" />
          </>
        ) : (
          <>
            <CreditCard className="size-4" aria-hidden />
            <T en="Pay by card" ar="ادفع بالبطاقة" />
          </>
        )}
      </button>

      <p className="text-center text-xs text-gray-400">
        <T
          en="You will be taken to XPay's secure page to enter your card details."
          ar="سيتم تحويلك إلى صفحة XPay الآمنة لإدخال بيانات بطاقتك."
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
    icon: CreditCard,
    en: "Card",
    ar: "بطاقة بنكية",
    hintEn: "Visa, Mastercard & Meeza",
    hintAr: "فيزا وماستركارد وميزة",
  },
};

function MethodBody({
  pm,
  currency,
  invoiceToken,
  onPaid,
}: {
  pm: PublicPaymentMethod;
  currency: string;
  invoiceToken: string;
  onPaid: () => void;
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
  if (pm.method === "XPAY") {
    return <XpayCheckout invoiceToken={invoiceToken} onPaid={onPaid} />;
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
  const router = useRouter();

  // Open the first method by default so the payer immediately sees how to pay — unless they are
  // coming back from XPay, in which case open the panel that is about to confirm their payment.
  const [openKey, setOpenKey] = useState<string | null>(() => {
    if (typeof window !== "undefined" && methods.some((m) => m.method === "XPAY")) {
      const params = new URLSearchParams(window.location.search);
      if (params.has("xpay") || params.has("xpay_cancelled")) return "XPAY";
    }
    return methods.length > 0 ? methods[0]!.method : null;
  });

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
                  onPaid={() => router.refresh()}
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
