"use client";

import {
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  Copy,
  Landmark,
  Loader2,
  Lock,
  PlayCircle,
  Smartphone,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { CourseThumb } from "@/components/learn/course-bits";
import { useLearn, useLearnHref } from "@/components/learn/context";
import { Container, CtaButton } from "@/components/learn/sections";
import {
  learnCheckout,
  learnPlaceOrder,
  type LearnCheckout,
  type LearnPaymentMethod,
  type LearnPaymentMethodType,
} from "@/lib/learn-api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * Checkout (docs/lms/10 §3) — the «اشترِ الكورس» screen.
 *
 * Two steps, in this order, because that is the order the buyer's questions arrive in:
 *   1. **Where do I send the money?** — pick one of the client's accounts and copy the number.
 *   2. **How do you know I sent it?** — agree to the terms, place the order, upload the receipt.
 *
 * Step 2's upload lives on the ORDER page rather than here: the order must exist (and have a number
 * the buyer can quote) before there is anything to attach a receipt to, and a buyer who transfers
 * the money and closes the tab has to be able to come back and finish. Placing the order is the
 * commitment point; the receipt is a follow-up that can happen minutes or hours later.
 */

const METHOD_ICON: Record<LearnPaymentMethodType, typeof Wallet> = {
  INSTAPAY: Smartphone,
  VODAFONE_CASH: Wallet,
  BANK_TRANSFER: Landmark,
  OTHER: Building2,
};

export default function CheckoutPage() {
  const t = useTranslations("learn");
  const locale = useLocale();
  const router = useRouter();
  const href = useLearnHref();
  const { academy, learner, loading: authLoading, openAuth } = useLearn();
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  const [data, setData] = useState<LearnCheckout | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [methodId, setMethodId] = useState<string | null>(null);
  const [terms, setTerms] = useState(false);
  const [placing, setPlacing] = useState(false);

  // You buy as somebody. An anonymous visitor gets the sign-in modal, not a broken screen.
  useEffect(() => {
    if (!authLoading && learner === null) openAuth("login");
  }, [authLoading, learner, openAuth]);

  useEffect(() => {
    if (learner === null) return;
    learnCheckout(academy, slug)
      .then((d) => {
        setData(d);
        setMethodId(d.open_order?.payment_method_id ?? d.payment_methods?.[0]?.id ?? null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : t("checkout.failed")));
  }, [academy, slug, learner, t]);

  async function place() {
    if (!terms || !data) return;
    setPlacing(true);
    setError(null);
    try {
      const r = await learnPlaceOrder(academy, slug, {
        payment_method_id: methodId,
        accept_terms: true,
      });
      router.push(href(`/orders/${r.order.order_number}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("checkout.failed"));
      setPlacing(false);
    }
  }

  if (authLoading || (learner === null && !error)) {
    return (
      <Container className="py-24 text-center">
        <Loader2 className="text-muted-foreground mx-auto size-6 animate-spin" />
        <p className="text-muted-foreground mt-3 text-sm">{t("checkout.signInFirst")}</p>
      </Container>
    );
  }

  if (error && !data) {
    return (
      <Container className="py-24 text-center">
        <p className="text-destructive text-sm">{error}</p>
        <CtaButton variant="outline" className="mt-6" href={href(`/c/${slug}`)}>
          {t("course.back")}
        </CtaButton>
      </Container>
    );
  }

  if (!data) {
    return (
      <Container className="py-24">
        <div className="bg-muted mx-auto h-64 max-w-3xl animate-pulse rounded-2xl" />
      </Container>
    );
  }

  // Already owns it — send them to the player rather than selling it twice.
  if (data.already_enrolled) {
    return (
      <Container className="py-24 text-center">
        <CheckCircle2 className="mx-auto size-10 text-emerald-600" />
        <h1 className="mt-4 text-2xl font-bold">{t("checkout.alreadyOwned")}</h1>
        <p className="text-muted-foreground mt-2 text-sm">{data.course.title}</p>
        <CtaButton className="mt-6" href={href(`/watch/${slug}`)}>
          <PlayCircle className="size-4" aria-hidden />
          {t("course.continue")}
        </CtaButton>
      </Container>
    );
  }

  const methods = data.payment_methods ?? [];
  const currency = data.currency ?? "EGP";
  const open = data.open_order;

  return (
    <Container className="py-10 sm:py-14">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t("checkout.title")}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t("checkout.subtitle")}</p>

        {open && (
          <div className="border-primary/30 bg-primary/5 mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
            <p className="text-sm">
              {t("checkout.resume", { number: open.order_number })}
            </p>
            <Link
              href={href(`/orders/${open.order_number}`)}
              className="text-primary inline-flex items-center gap-1 text-sm font-semibold"
            >
              {t("checkout.resumeCta")}
              <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
            </Link>
          </div>
        )}

        <div className="mt-8 grid gap-8 lg:grid-cols-[1.4fr_1fr]">
          <div className="space-y-8">
            <section className="space-y-4">
              <h2 className="flex items-center gap-2 text-lg font-bold">
                <span className="bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-full text-xs font-bold">
                  1
                </span>
                {t("checkout.chooseMethod")}
              </h2>

              {methods.length === 0 ? (
                <p className="text-muted-foreground rounded-xl border border-dashed p-6 text-sm">
                  {t("checkout.noMethods")}
                </p>
              ) : (
                <div className="space-y-3">
                  {methods.map((m) => (
                    <MethodOption
                      key={m.id}
                      method={m}
                      selected={methodId === m.id}
                      onSelect={() => setMethodId(m.id)}
                    />
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-4">
              <h2 className="flex items-center gap-2 text-lg font-bold">
                <span className="bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-full text-xs font-bold">
                  2
                </span>
                {t("checkout.confirm")}
              </h2>

              <ol className="text-muted-foreground space-y-2 text-sm">
                <li className="flex gap-2">
                  <Check className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
                  {t("checkout.step1")}
                </li>
                <li className="flex gap-2">
                  <Check className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
                  {t("checkout.step2")}
                </li>
                <li className="flex gap-2">
                  <Check className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
                  {t("checkout.step3")}
                </li>
              </ol>

              {/* Consent is recorded on the order, not assumed (docs/lms/10 §3). */}
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-4">
                <input
                  type="checkbox"
                  checked={terms}
                  onChange={(e) => setTerms(e.target.checked)}
                  className="accent-primary mt-0.5 size-4"
                />
                <span className="text-sm leading-relaxed">
                  {t.rich("checkout.terms", {
                    terms: (chunks) => (
                      <Link href={href("/legal/terms")} className="text-primary underline">
                        {chunks}
                      </Link>
                    ),
                    refund: (chunks) => (
                      <Link href={href("/legal/refund")} className="text-primary underline">
                        {chunks}
                      </Link>
                    ),
                  })}
                </span>
              </label>

              {error && <p className="text-destructive text-sm">{error}</p>}

              <CtaButton
                onClick={place}
                disabled={placing || !terms || methods.length === 0}
                className="w-full sm:w-auto"
              >
                {placing ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Lock className="size-4" aria-hidden />
                )}
                {t("checkout.placeOrder")}
              </CtaButton>
              <p className="text-muted-foreground text-xs">{t("checkout.placeHint")}</p>
            </section>
          </div>

          {/* Order summary */}
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="bg-card overflow-hidden rounded-2xl border shadow-sm">
              <CourseThumb src={data.course.cover_image_path} className="aspect-video" />
              <div className="space-y-4 p-5">
                <div>
                  <h3 className="font-bold">{data.course.title}</h3>
                  {data.course.subtitle && (
                    <p className="text-muted-foreground mt-1 text-sm">{data.course.subtitle}</p>
                  )}
                </div>
                <div className="flex items-baseline justify-between border-t pt-4">
                  <span className="text-muted-foreground text-sm">{t("checkout.total")}</span>
                  <span className="text-2xl font-bold tabular-nums">
                    {formatMoney({ amount: data.course.price_minor, currency }, locale)}
                  </span>
                </div>
                {data.buyer && (
                  <div className="text-muted-foreground border-t pt-4 text-xs">
                    <p className="text-foreground font-medium">{data.buyer.full_name}</p>
                    <p className="truncate">{data.buyer.email}</p>
                  </div>
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </Container>
  );
}

/** One receiving account — the number is the point, so it is big, LTR and one tap to copy. */
function MethodOption({
  method,
  selected,
  onSelect,
}: {
  method: LearnPaymentMethod;
  selected: boolean;
  onSelect: () => void;
}) {
  const t = useTranslations("learn");
  const Icon = METHOD_ICON[method.type];
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!method.account_number) return;
    try {
      await navigator.clipboard.writeText(method.account_number);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the number is on screen and selectable anyway */
    }
  };

  return (
    <div
      className={cn(
        "rounded-xl border p-4 transition-colors",
        selected ? "border-primary bg-primary/5" : "hover:border-primary/40",
      )}
    >
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="radio"
          name="payment-method"
          checked={selected}
          onChange={onSelect}
          className="accent-primary mt-1 size-4"
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 font-semibold">
            <Icon className="size-4" aria-hidden />
            {method.label || t(`checkout.method.${method.type}`)}
          </span>
          {method.account_name && (
            <span className="text-muted-foreground mt-1 block text-xs">
              {t("checkout.accountName")}: {method.account_name}
            </span>
          )}
          {method.bank_name && (
            <span className="text-muted-foreground block text-xs">{method.bank_name}</span>
          )}
        </span>
      </label>

      {selected && (
        <div className="mt-3 space-y-3 ps-7">
          {method.account_number && (
            <button
              type="button"
              onClick={copy}
              className="bg-muted hover:bg-muted/70 flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-start transition-colors"
            >
              <span dir="ltr" className="truncate font-mono text-sm font-semibold">
                {method.account_number}
              </span>
              <span className="text-muted-foreground inline-flex shrink-0 items-center gap-1 text-xs">
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {copied ? t("checkout.copied") : t("checkout.copy")}
              </span>
            </button>
          )}
          {method.instructions && (
            <p className="text-muted-foreground text-xs leading-relaxed whitespace-pre-line">
              {method.instructions}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
