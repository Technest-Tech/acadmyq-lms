import type { Metadata } from "next";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { marketing, siteOrigin } from "@/content/marketing";

/**
 * The public marketing site: `/`, the two product pages, contact, privacy and terms.
 *
 * A route GROUP — the parentheses add nothing to any URL — so the home page stays at `/` while
 * living next to the pages that share its chrome. Everything authenticated is under `(app)`, the
 * learner storefronts under `/learn/[academy]`, and none of them pass through here.
 *
 * `.marketing` pins this whole subtree to the light marketing palette (globals.css), the same way
 * `.learn-site` and `.client-door` do for their surfaces: a stranger reading a sales page must not
 * inherit a staff member's dark-mode preference from a previous visit to the dashboard.
 */

export const metadata: Metadata = {
  // Resolves every relative canonical/OG url the pages below declare.
  metadataBase: new URL(siteOrigin()),
};

export default async function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { t } = await marketing();

  return (
    <div className="marketing bg-background text-foreground flex min-h-screen flex-col">
      <a
        href="#main"
        className="bg-primary text-primary-foreground focus:ring-ring sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-1/2 focus:z-[60] focus:-translate-x-1/2 focus:rounded-lg focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:ring-2"
      >
        {t.nav.skipToContent}
      </a>

      <SiteHeader t={t} />

      <main id="main" className="flex-1">
        {children}
      </main>

      <SiteFooter t={t} />
    </div>
  );
}
