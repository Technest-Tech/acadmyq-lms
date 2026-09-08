import type { Metadata } from "next";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { marketing } from "@/content/marketing";
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
  const client = await brand();

  // A client's door wears their identity and none of ours — no Acadmyq header selling two products
  // to someone who is already at their academy's own address, and no marketing footer under it.
  if (client) return <LoginScreen brand={client} />;

  // The platform door IS the marketing site's last page, so it wears that site's chrome and its
  // light palette (`.marketing`, globals.css) — the same reason the layout there pins it: a visitor
  // who walked in from a sales page must not inherit a staff member's dark mode mid-journey.
  const { t } = await marketing();

  return (
    <div className="marketing bg-background text-foreground flex min-h-dvh flex-col">
      <a
        href="#main"
        className="bg-primary text-primary-foreground focus:ring-ring sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-1/2 focus:z-[60] focus:-translate-x-1/2 focus:rounded-lg focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:ring-2"
      >
        {t.nav.skipToContent}
      </a>

      <SiteHeader t={t} />

      <main id="main" className="flex-1">
        <LoginScreen brand={null} />
      </main>

      <SiteFooter t={t} />
    </div>
  );
}
