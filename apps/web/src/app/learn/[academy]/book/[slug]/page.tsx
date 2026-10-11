import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { cache } from "react";
import { resolveSiteName } from "@/lib/learn-brand";
import { fetchLearnBookingForm, fetchLearnSite } from "@/lib/learn-server";
import { BookingScreen } from "./booking-screen";

/**
 * A booking form on the course site (docs/lms/13) — "احجز استشارة", "احجز كورس", whatever the
 * client named it. The server half loads the form so the shared link previews with the form's own
 * title and intro (these links mostly travel over WhatsApp), and 404s a hidden or unknown one.
 */

type Props = { params: Promise<{ academy: string; slug: string }> };

/** One fetch per request, shared by generateMetadata and the page. */
const load = cache((academy: string, slug: string) => fetchLearnBookingForm(academy, slug));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { academy, slug } = await params;
  const data = await load(academy, slug).catch(() => null);
  if (data === null) return {};

  const t = await getTranslations("learn");
  let name: string | null = null;
  let url: string | null = null;
  try {
    const { site, academy: info } = await fetchLearnSite(academy);
    name = resolveSiteName(site.brand.name, info.name);
    url = info.url && info.url.startsWith("http") ? `${info.url}/book/${data.form.slug}` : null;
  } catch {
    // The title alone is still a good preview.
  }
  const siteName = name ?? t("brand.fallbackName");
  const description = data.form.description ?? t("booking.defaultIntro");

  return {
    title: `${data.form.title} — ${siteName}`,
    description,
    ...(url ? { alternates: { canonical: url } } : {}),
    openGraph: { title: data.form.title, description, siteName, ...(url ? { url } : {}) },
  };
}

export default async function BookingPage({ params }: Props) {
  const { academy, slug } = await params;
  const data = await load(academy, slug);
  if (data === null) notFound();

  return <BookingScreen form={data.form} courses={data.courses} />;
}
