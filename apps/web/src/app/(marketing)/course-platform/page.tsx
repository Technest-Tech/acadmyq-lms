import type { Metadata } from "next";
import { ProductPage } from "@/components/marketing/product-page";
import { marketing, ROUTES } from "@/content/marketing";
import { pageMetadata } from "../page-meta";

/**
 * The Course Platform landing page — the destination for course-creator advertising, so it stands
 * on its own: a visitor arriving here from an ad never has to pass through the homepage to
 * understand the offer, see the product, read the price or convert (the form is on the page).
 */

export async function generateMetadata(): Promise<Metadata> {
  const { locale, t } = await marketing();

  return pageMetadata({
    meta: t.meta.coursePlatform,
    path: ROUTES.coursePlatform,
    ogImage: "/marketing/og-course-platform.png",
    locale,
  });
}

export default async function CoursePlatformPage() {
  const { locale, t } = await marketing();

  return <ProductPage page={t.coursePlatform} t={t} locale={locale} />;
}
