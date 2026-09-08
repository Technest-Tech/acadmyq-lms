import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/legal-page";
import { marketing, ROUTES } from "@/content/marketing";
import { pageMetadata } from "../page-meta";

export async function generateMetadata(): Promise<Metadata> {
  const { locale, t } = await marketing();

  return pageMetadata({
    meta: t.meta.privacy,
    path: ROUTES.privacy,
    ogImage: "/marketing/og-home.png",
    locale,
  });
}

export default async function PrivacyPage() {
  const { locale, t } = await marketing();

  return <LegalPage doc={t.privacy} locale={locale} />;
}
