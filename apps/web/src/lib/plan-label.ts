"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { useCapability } from "@/lib/capabilities";

/** What the API writes on a student billed by private blocks (LessonPackages::ensurePackageBilling). */
const PACKAGE_BILLING = "Package billing";

/**
 * How a student's plan reads. A centre's desk works in Arabic and calls it a private subscription, so
 * the API's English mark is put in its words there. Everywhere else the label reads as it always did.
 */
export function usePlanLabel(): (label: string | null | undefined) => string {
  const centre = useCapability("centre");
  const t = useTranslations("subscriptions");
  return useCallback((label) => (centre && label === PACKAGE_BILLING ? t("planPrivate") : (label ?? "")), [centre, t]);
}
