import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { AuthFrame, doorBrand } from "@/components/auth/auth-frame";
import { ResetPasswordScreen } from "./reset-password-screen";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("resetTitle"), robots: { index: false, follow: false } };
}

/** The page a reset-link lands on: `/reset-password?token=…&email=…`. Public, on either door. */
export default async function ResetPasswordPage() {
  const brand = await doorBrand();
  return (
    <AuthFrame brand={brand}>
      <Suspense fallback={null}>
        <ResetPasswordScreen />
      </Suspense>
    </AuthFrame>
  );
}
