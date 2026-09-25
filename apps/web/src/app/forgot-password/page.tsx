import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AuthFrame, doorBrand } from "@/components/auth/auth-frame";
import { ForgotPasswordScreen } from "./forgot-password-screen";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("forgotTitle"), robots: { index: false, follow: false } };
}

/** "Forgot your password?" — request a reset link. Public, on either door. */
export default async function ForgotPasswordPage() {
  const brand = await doorBrand();
  return (
    <AuthFrame brand={brand}>
      <ForgotPasswordScreen />
    </AuthFrame>
  );
}
