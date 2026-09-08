import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { resolveSiteName } from "@/lib/learn-brand";
import { fetchLearnSite, UnknownAcademyError } from "@/lib/learn-server";
import { LearnProvider } from "./learn-provider";

/**
 * The public course site's shell (docs/lms/09). A SERVER component on purpose: the site profile is
 * fetched here, once per request, so (a) `generateMetadata` can give each client a real title,
 * description and OG image — a client-side fetch cannot — and (b) the branded header paints on the
 * first frame instead of flashing a generic one.
 *
 * An unknown subdomain 404s: the site simply does not exist for that host.
 */

async function load(academy: string) {
  try {
    return await fetchLearnSite(academy);
  } catch (error) {
    if (error instanceof UnknownAcademyError) notFound();
    throw error;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ academy: string }>;
}): Promise<Metadata> {
  const { academy } = await params;
  const t = await getTranslations("learn");
  const { site, academy: info } = await load(academy);

  // The tab title is the most-seen piece of this client's branding; the subdomain handle must never
  // stand in for their name there either (lib/learn-brand.ts).
  const name =
    resolveSiteName(site.brand.name, info.name, academy) ?? t("brand.fallbackName");
  const title = site.seo.title || `${name} — ${t("meta.suffix")}`;
  const description = site.seo.description || site.brand.tagline || t("meta.description", { name });
  const image = site.seo.og_image_url || site.hero.image_url || site.brand.logo_url;
  // A tenant's own favicon first, then their compact mark, then the full logo — a client who
  // uploaded one file still gets a branded tab.
  const icon = site.brand.favicon_url || site.brand.logo_mark_url || site.brand.logo_url;

  return {
    title,
    description,
    // Absolute, per-tenant, and only when the platform actually knows this site's origin — one
    // client's canonical must never point at another's host.
    ...(info.url && info.url.startsWith("http")
      ? { metadataBase: new URL(info.url), alternates: { canonical: info.url } }
      : {}),
    openGraph: {
      title,
      description,
      siteName: name,
      type: "website",
      ...(info.url && info.url.startsWith("http") ? { url: info.url } : {}),
      images: image ? [image] : undefined,
    },
    twitter: { card: image ? "summary_large_image" : "summary", title, description },
    icons: icon ? { icon } : undefined,
  };
}

export default async function LearnLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ academy: string }>;
}) {
  const { academy } = await params;
  const data = await load(academy);

  return (
    <LearnProvider
      academy={academy}
      site={data.site}
      stats={data.stats}
      commerce={data.commerce}
      academyName={data.academy.name}
      siteUrl={data.academy.url ?? null}
    >
      {children}
    </LearnProvider>
  );
}
