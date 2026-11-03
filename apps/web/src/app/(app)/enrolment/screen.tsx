"use client";

import { useTranslations } from "next-intl";
import { useAuth } from "@/components/auth-provider";
import { EnrolmentInbox } from "@/components/enrolment/enrolment-inbox";
import { useCapability } from "@/lib/capabilities";

/**
 * Client gate for the enrolment inbox: rendered only for a centre (`centre` switch) whose session
 * grants `trial.read`. UX gate only — the server's entitled:centre + Gate::authorize are the control.
 */
export function EnrolmentScreen() {
  const t = useTranslations("enrolment");
  const { can } = useAuth();
  const centre = useCapability("centre");

  if (!centre || !can("trial.read")) {
    return <p className="text-muted-foreground text-sm">{t("notAllowed")}</p>;
  }

  return <EnrolmentInbox />;
}
