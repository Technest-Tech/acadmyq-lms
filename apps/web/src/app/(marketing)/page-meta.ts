import type { Metadata } from "next";
import { absoluteUrl, type PageMeta } from "@/content/marketing";

/**
 * Builds one marketing page's metadata: title, description, canonical, Open Graph and Twitter.
 *
 * Written once because the six pages must agree on the shape of it. Two decisions worth stating:
 *
 *  - NO `hreflang` alternates. This app serves both languages from ONE url and picks between them
 *    from the `NEXT_LOCALE` cookie (see `i18n/request.ts`) — there is no `/ar` or `/en` path to
 *    point an alternate at, so declaring one would name a page that does not exist. The canonical
 *    is the single url, and a crawler sees the default locale.
 *  - The OG image is a real file per page under `public/marketing/`, sized 1200×630.
 */
export function pageMetadata({
  meta,
  path,
  ogImage,
  locale,
  robots,
}: {
  meta: PageMeta;
  path: string;
  ogImage: string;
  locale: string;
  robots?: Metadata["robots"];
}): Metadata {
  const url = absoluteUrl(path);

  return {
    title: meta.title,
    description: meta.description,
    alternates: { canonical: url },
    robots,
    openGraph: {
      type: "website",
      url,
      siteName: "Acadmyq",
      title: meta.title,
      description: meta.description,
      locale: locale === "ar" ? "ar_EG" : "en_US",
      images: [{ url: ogImage, width: 1200, height: 630, alt: meta.title }],
    },
    twitter: {
      card: "summary_large_image",
      title: meta.title,
      description: meta.description,
      images: [ogImage],
    },
  };
}
