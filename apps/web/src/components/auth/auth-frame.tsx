import { headers } from "next/headers";
import type { LoginBrand } from "@/app/login/login-screen";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { marketing } from "@/content/marketing";
import { resolveTenantSite } from "@/lib/tenant-site";

/**
 * The chrome around the password pages, decided the same way the sign-in page decides it: the
 * platform door wears the marketing site's header and footer, a client's own door wears only the
 * client (a locale switcher and a light ground — nothing of ours to sell to someone at their own
 * academy's address).
 */
export async function AuthFrame({
  brand,
  children,
}: {
  brand: LoginBrand | null;
  children: React.ReactNode;
}) {
  if (brand) {
    return (
      <div className="client-door text-foreground relative flex min-h-dvh flex-col overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(70rem 38rem at 50% -14%, oklch(0.519 0.158 163.2 / 0.18), transparent 68%)," +
              "linear-gradient(180deg, oklch(0.992 0.008 95) 0%, oklch(0.975 0.012 150) 100%)",
          }}
        />
        <div className="relative flex justify-end p-5">
          <LocaleSwitcher />
        </div>
        <main className="relative flex flex-1 items-start justify-center px-6 pb-16 pt-6">
          <div className="animate-page-enter w-full max-w-[26rem]">{children}</div>
        </main>
      </div>
    );
  }

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
        <section className="relative overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(70%_100%_at_50%_0%,color-mix(in_oklab,var(--primary)_10%,transparent),transparent_70%)]"
          />
          <div className="relative mx-auto w-full max-w-[26rem] px-4 py-14 sm:py-20">
            <div className="animate-page-enter">{children}</div>
          </div>
        </section>
      </main>
      <SiteFooter t={t} />
    </div>
  );
}

/** Resolve which door a password page is being served on — the same rule as the sign-in page. */
export async function doorBrand(): Promise<LoginBrand | null> {
  const handle = (await headers()).get("x-academy");
  if (!handle) return null;
  const site = await resolveTenantSite(handle);
  if (site === null || site.kind !== "MANAGEMENT") return null;
  return {
    handle,
    name: site.academy.displayName || site.academy.name || handle,
    logoUrl: site.academy.logoUrl,
  };
}
