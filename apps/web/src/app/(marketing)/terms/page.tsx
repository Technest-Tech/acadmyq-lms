import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/legal-page";
import { marketing, ROUTES } from "@/content/marketing";
import { pageMetadata } from "../page-meta";

export async function generateMetadata(): Promise<Metadata> {
  const { locale, t } = await marketing();

  return pageMetadata({
    meta: t.meta.terms,
    path: ROUTES.terms,
    ogImage: "/marketing/og-home.png",
    locale,
  });
}

export default async function TermsPage() {
  const { locale, t } = await marketing();

  return <LegalPage doc={t.terms} locale={locale} />;
}
