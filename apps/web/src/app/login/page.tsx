import type { Metadata } from "next";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { resolveTenantSite } from "@/lib/tenant-site";
import { type LoginBrand, LoginScreen } from "./login-screen";

/**
 * The sign-in route — the platform's own door at `app.<root>/login`, and every management client's
 * door at their `<handle>.<root>` (docs/lms/02).
 *
 * A SERVER component so the client's identity is resolved before the first frame: the middleware
 * forwards the handle as `x-academy`, and the brand is fetched here rather than in the browser, so
 * a client's people never see the platform's login flash past on the way to their own. No handle
 * (the platform host, or subdomain routing switched off) ⇒ exactly the screen that was there before.
 */

/** The client whose door this is, or null for the platform login. */
async function brand(): Promise<LoginBrand | null> {
  const handle = (await headers()).get("x-academy");
  if (!handle) return null;

  const site = await resolveTenantSite(handle);
  // Unknown handle, or a course-platform client (whose door is their course site, not this one) —
  // neither should wear a client identity here.
  if (site === null || site.kind !== "MANAGEMENT") return null;

  return {
    handle,
    name: site.academy.displayName || site.academy.name || handle,
    logoUrl: site.academy.logoUrl,
  };
}

export async function generateMetadata(): Promise<Metadata> {
  const client = await brand();
  const t = await getTranslations();

  return client === null
    ? { title: `${t("auth.signIn")} — ${t("app.name")}` }
    : {
        title: `${t("auth.signIn")} — ${client.name}`,
        icons: client.logoUrl ? { icon: client.logoUrl } : undefined,
      };
}

export default async function LoginPage() {
  return <LoginScreen brand={await brand()} />;
}
