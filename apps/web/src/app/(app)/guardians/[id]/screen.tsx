"use client";

import { useTranslations } from "next-intl";
import { useAuth } from "@/components/auth-provider";
import { FamilyProfile } from "@/components/guardians/family-profile";

/** Client gate for a family's file (guardian.read). The API is the real control. */
export function FamilyProfileScreen({ guardianId }: { guardianId: string }) {
  const t = useTranslations("guardians");
  const { can } = useAuth();

  if (!can("guardian.read")) {
    return <p className="text-muted-foreground text-sm">{t("empty")}</p>;
  }

  return <FamilyProfile guardianId={guardianId} />;
}
