"use client";

import { useTranslations } from "next-intl";
import { useAuth } from "@/components/auth-provider";
import { SubscriptionsManager } from "@/components/subscriptions/subscriptions-manager";
import type { SubscriptionView } from "@/lib/subscriptions-api";

/**
 * Client gate for the Subscriptions screen: rendered only when the session grants `package.read`
 * (the subscriptions reuse the packages' permission codes). UX gate only — the server's
 * Gate::authorize and `entitled:centre` are the real control.
 */
export function SubscriptionsScreen({ view = "open" }: { view?: SubscriptionView }) {
  const t = useTranslations("subscriptions");
  const { can } = useAuth();

  if (!can("package.read")) {
    return <p className="text-muted-foreground text-sm">{t("forbidden")}</p>;
  }

  return <SubscriptionsManager view={view} />;
}
