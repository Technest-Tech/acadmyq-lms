"use client";

import { ArrowRight, Loader2, Receipt, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useLearn, useLearnHref } from "@/components/learn/context";
import { Container, CtaButton, PageHero } from "@/components/learn/sections";
import { learnOrders, type LearnOrder } from "@/lib/learn-api";
import { formatMoney } from "@/lib/money";
import { OrderStatusPill } from "./status-pill";

/** The learner's own purchase history (docs/lms/10 §3) — every order and where it currently stands. */
export default function MyOrdersPage() {
  const t = useTranslations("learn");
  const locale = useLocale();
  const href = useLearnHref();
  const { academy, learner, loading, openAuth } = useLearn();

  const [orders, setOrders] = useState<LearnOrder[] | null>(null);

  useEffect(() => {
    if (!loading && learner === null) openAuth("login");
  }, [loading, learner, openAuth]);

  useEffect(() => {
    if (learner === null) return;
    learnOrders(academy)
      .then((r) => setOrders(r.orders))
      .catch(() => setOrders([]));
  }, [academy, learner]);

  return (
    <>
      <PageHero title={t("orders.title")} subtitle={t("orders.subtitle")} />
      <Container className="py-10">
        {learner === null || orders === null ? (
          <div className="py-16 text-center">
            <Loader2 className="text-muted-foreground mx-auto size-6 animate-spin" />
          </div>
        ) : orders.length === 0 ? (
          <div className="mx-auto max-w-md py-16 text-center">
            <ShoppingBag className="text-muted-foreground/40 mx-auto size-12" aria-hidden />
            <h2 className="mt-4 text-lg font-bold">{t("orders.empty")}</h2>
            <p className="text-muted-foreground mt-2 text-sm">{t("orders.emptyHint")}</p>
            <CtaButton className="mt-6" href={href("/courses")}>
              {t("orders.browse")}
            </CtaButton>
          </div>
        ) : (
          <ul className="mx-auto max-w-3xl space-y-3">
            {orders.map((o) => (
              <li key={o.id}>
                <Link
                  href={href(`/orders/${o.order_number}`)}
                  className="bg-card hover:border-primary/40 flex items-center gap-4 rounded-xl border p-4 transition-colors"
                >
                  <span className="bg-muted flex size-11 shrink-0 items-center justify-center rounded-xl">
                    <Receipt className="size-5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{o.course_title}</span>
                    <span className="text-muted-foreground block font-mono text-xs">
                      {o.order_number}
                    </span>
                  </span>
                  <span className="hidden shrink-0 text-end sm:block">
                    <span className="block font-bold tabular-nums">
                      {formatMoney({ amount: o.price_minor, currency: o.currency }, locale)}
                    </span>
                  </span>
                  <OrderStatusPill status={o.status} />
                  <ArrowRight
                    className="text-muted-foreground size-4 shrink-0 rtl:rotate-180"
                    aria-hidden
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Container>
    </>
  );
}
