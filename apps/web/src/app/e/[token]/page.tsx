import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import { apiBase } from "@/lib/api-base";
import type { PublicEnrolmentPayload } from "@/lib/enrolment-api";
import { ENROL_LANG_COOKIE, isLang, type Lang } from "./copy";
import { EnrolForm } from "./enrol-form";

/**
 * The centre's public enrolment form — what a parent opens from the advert (docs/centre-profile
 * Phase 2 §6). No account and no password; the token names the academy, so the page is never cached
 * and never indexed. Built outside the staff shell like `/p/`: a parent should see the centre, not
 * our product.
 *
 * The form's words and switches come from `GET /api/e/{token}`; the submit goes from the browser.
 */

const API_URL = process.env.API_URL ?? apiBase();

const fetchForm = cache(async (token: string): Promise<PublicEnrolmentPayload | null> => {
  const res = await fetch(`${API_URL}/api/e/${encodeURIComponent(token)}`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Enrolment page fetch failed: ${res.status}`);
  return res.json() as Promise<PublicEnrolmentPayload>;
});

interface PageProps {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ lang?: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;
  const data = await fetchForm(token);

  return {
    title: data ? `${data.form.title} — ${data.academy.displayName || data.academy.name}` : "Acadmyq",
    robots: { index: false, follow: false, nosnippet: true },
    ...(data?.academy.logoUrl ? { icons: { icon: data.academy.logoUrl } } : {}),
  };
}

export default async function EnrolmentPage({ params, searchParams }: PageProps) {
  const { token } = await params;
  const { lang: asked } = await searchParams;
  const data = await fetchForm(token);
  if (!data) notFound();

  const remembered = (await cookies()).get(ENROL_LANG_COOKIE)?.value;
  const staffLocale = await getLocale();
  const lang: Lang = isLang(asked) ? asked : isLang(remembered) ? remembered : isLang(staffLocale) ? staffLocale : "ar";

  return <EnrolForm token={token} data={data} initialLang={lang} />;
}
