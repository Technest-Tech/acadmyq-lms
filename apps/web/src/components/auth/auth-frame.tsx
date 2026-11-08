import { MessageCircle } from "lucide-react";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import type { LoginBrand } from "@/app/login/login-screen";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { SiteHeader } from "@/components/marketing/site-header";
import { marketingFont } from "@/components/marketing/surface";
import { marketing, WHATSAPP } from "@/content/marketing";
import { resolveTenantSite } from "@/lib/tenant-site";
import { cn } from "@/lib/utils";

/**
 * The frame around every sign-in door: the sign-in page, forgot-password and reset-password.
 *
 * One look for all of them — the marketing site's deep navy ground with its faint khatam lattice,
 * and a single white card in the middle. Nothing else: no sales pitch, no feature list, no footer
 * of links. The person on this page came to get in, and anything beside the form is in the way.
 *
 * The two doors differ only in what frames the card:
 *  - THE PLATFORM door (`app.<root>/login`, no `brand`): the site header (transparent over the
 *    navy, see `DARK_TOP` in site-header), and one help line under the card — our WhatsApp.
 *  - A CLIENT's door (`<handle>.<root>`, `brand` set, docs/lms/02): only a language switch and a
 *    quiet "powered by" line. Nothing of ours to sell, and no number of ours to call: the client's
 *    people get help from their academy, not from us.
 *
 * Light text on navy everywhere here, so the `.marketing` wrapper (palette + face) is set on the
 * frame itself: these routes live outside `app/(marketing)` and would otherwise get neither.
 */
export async function AuthFrame({
  brand,
  children,
}: {
  brand: LoginBrand | null;
  children: React.ReactNode;
}) {
  const t = await getTranslations("login");

  return (
    <div
      className={cn(
        "marketing mk-ink relative flex min-h-dvh flex-col",
        marketingFont.variable,
      )}
    >
      <div aria-hidden className="mk-lattice" />

      {brand ? (
        <div className="marketing-footer-locale relative flex justify-end p-4 sm:p-5">
          <LocaleSwitcher />
        </div>
      ) : (
        <PlatformHeader />
      )}

      <main
        id="main"
        className="relative flex flex-1 items-center justify-center px-4 py-10 sm:py-14"
      >
        <div className="animate-page-enter w-full max-w-[27rem]">
          {children}

          {brand ? (
            <p className="text-ink-foreground/55 mt-6 text-center text-xs">
              {t("poweredBy")}
            </p>
          ) : (
            <p className="text-ink-foreground/70 mt-6 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-sm">
              <span>{t("needHelp")}</span>
              <a
                href={WHATSAPP.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-gold focus-visible:outline-gold inline-flex items-center gap-1.5 rounded font-bold underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <MessageCircle aria-hidden className="size-4" />
                {t("whatsappUs")}
              </a>
            </p>
          )}
        </div>
      </main>
    </div>
  );
}

/** The site header, so a visitor can walk back to the site, plus the keyboard skip link. */
async function PlatformHeader() {
  const { t } = await marketing();

  return (
    <>
      <a
        href="#main"
        className="bg-primary text-primary-foreground focus:ring-ring sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-1/2 focus:z-[60] focus:-translate-x-1/2 focus:rounded-lg focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:ring-2"
      >
        {t.nav.skipToContent}
      </a>
      <SiteHeader t={t} />
    </>
  );
}

/** Resolve which door a page is being served on: a management client's handle, or the platform. */
export async function doorBrand(): Promise<LoginBrand | null> {
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
