import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import { apiBase } from "@/lib/api-base";
import type { PortalPayload } from "@/lib/portal-api";
import { isLang, type Lang, PARENT_LANG_COOKIE } from "./copy";
import { ParentPage } from "./parent-page";

/**
 * The parent's page — what a family opens from the WhatsApp message: their children, the lessons
 * coming up, the lessons just taken with the teacher's report, the approved monthly reports and the
 * family's bills (each paying through its own `/i/` link). No account and no password; the link is
 * the credential, so the page is never cached and never indexed. Built from scratch, outside the
 * staff app's shell: a parent should see their academy, not our product.
 *
 * Data comes only from `GET /api/p/{token}` (GuardianPortal::build), which is the allow-list.
 */

const API_URL = process.env.API_URL ?? apiBase();

const fetchPortal = cache(async (token: string): Promise<PortalPayload | null> => {
  const res = await fetch(`${API_URL}/api/p/${encodeURIComponent(token)}`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Parent page fetch failed: ${res.status}`);
  return res.json() as Promise<PortalPayload>;
});

interface PageProps {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ lang?: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;
  const data = await fetchPortal(token);

  return {
    title: data ? data.academy.name : "Acadmyq",
    robots: { index: false, follow: false, nosnippet: true },
    // The academy's own mark in the tab, as on its course site.
    ...(data?.academy.logo_url ? { icons: { icon: data.academy.logo_url } } : {}),
  };
}

export default async function ParentPortalPage({ params, searchParams }: PageProps) {
  const { token } = await params;
  const { lang: asked } = await searchParams;
  const data = await fetchPortal(token);
  if (!data) notFound();

  const remembered = (await cookies()).get(PARENT_LANG_COOKIE)?.value;
  const staffLocale = await getLocale();
  const lang: Lang = isLang(asked) ? asked : isLang(remembered) ? remembered : isLang(staffLocale) ? staffLocale : "ar";

  return <ParentPage data={data} initialLang={lang} renderedAt={Date.now()} />;
}
