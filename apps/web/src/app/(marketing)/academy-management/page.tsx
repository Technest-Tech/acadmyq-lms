import type { Metadata } from "next";
import { ProductPage } from "@/components/marketing/product-page";
import { marketing, ROUTES } from "@/content/marketing";
import { pageMetadata } from "../page-meta";

/**
 * The Academy Management landing page. Same structure as the Course Platform page, aimed at someone
 * who already runs an academy: the outcome is an organised day, and the price is a conversation
 * rather than a published figure.
 */

export async function generateMetadata(): Promise<Metadata> {
  const { locale, t } = await marketing();

  return pageMetadata({
    meta: t.meta.academyManagement,
    path: ROUTES.academyManagement,
    ogImage: "/marketing/og-academy-management.png",
    locale,
  });
}

export default async function AcademyManagementPage() {
  const { locale, t } = await marketing();

  return <ProductPage page={t.academyManagement} t={t} locale={locale} />;
}
