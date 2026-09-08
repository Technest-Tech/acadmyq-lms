import Image from "next/image";
import Link from "next/link";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { CONTACT, ROUTES, siteOrigin, type MarketingContent } from "@/content/marketing";

/**
 * The site footer.
 *
 * Every link here goes somewhere real. There is no `href="#"`, no social icons (we publish none,
 * and an icon linking nowhere is worse than no icon), and no email or phone unless the deployment
 * actually configured one — an invented support address is a promise the site cannot keep.
 *
 * The year is read at render time. A server-rendered page that resolves the visitor's locale is
 * already dynamic, so this is genuinely "now" rather than the year of the last deploy — which is
 * how the old page ended up printing © 2025 well into 2026.
 */
export function SiteFooter({ t }: { t: MarketingContent }) {
  const year = new Date().getFullYear();
  const domain = siteOrigin().replace(/^https?:\/\//, "");

  const columns = [
    {
      heading: t.footer.productsHeading,
      links: [
        { href: ROUTES.coursePlatform, label: t.nav.coursePlatform },
        { href: ROUTES.academyManagement, label: t.nav.academyManagement },
        { href: `${ROUTES.coursePlatform}#pricing`, label: t.nav.pricing },
      ],
    },
    {
      heading: t.footer.companyHeading,
      links: [
        { href: ROUTES.contact, label: t.nav.contact },
        { href: ROUTES.login, label: t.nav.login },
      ],
    },
    {
      heading: t.footer.legalHeading,
      links: [
        { href: ROUTES.privacy, label: t.privacy.title },
        { href: ROUTES.terms, label: t.terms.title },
      ],
    },
  ];

  return (
    <footer className="bg-ink text-ink-foreground">
      <div className="mx-auto w-full max-w-6xl px-5 py-14 sm:px-8">
        <div className="grid gap-10 md:grid-cols-[1.6fr_repeat(3,1fr)]">
          <div className="max-w-sm">
            <Link
              href={ROUTES.home}
              aria-label={t.brand.homeLabel}
              className="focus-visible:outline-ink-foreground inline-flex items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4"
            >
              <Image
                src="/logo.png"
                alt=""
                width={512}
                height={394}
                className="h-8 w-auto"
              />
              <span className="text-lg font-bold">{t.brand.name}</span>
            </Link>
            <p className="text-ink-foreground/70 mt-4 text-sm leading-relaxed">
              {t.footer.tagline}
            </p>
            <p className="text-ink-foreground/50 mt-4 text-sm">{domain}</p>
          </div>

          {columns.map((column) => (
            <nav key={column.heading} aria-label={column.heading}>
              <h2 className="text-ink-foreground text-sm font-semibold">
                {column.heading}
              </h2>
              <ul className="mt-4 flex flex-col gap-2.5">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-ink-foreground/70 hover:text-ink-foreground focus-visible:outline-ink-foreground rounded text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="border-ink-foreground/15 mt-12 border-t pt-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-ink-foreground/70 text-sm">
              <h2 className="text-ink-foreground mb-2 text-sm font-semibold">
                {t.footer.contactHeading}
              </h2>
              {CONTACT.email || CONTACT.phone ? (
                <ul className="flex flex-col gap-1.5 sm:flex-row sm:gap-6">
                  {CONTACT.email ? (
                    <li>
                      <span className="text-ink-foreground/50">
                        {t.footer.emailLabel}:{" "}
                      </span>
                      <a
                        href={`mailto:${CONTACT.email}`}
                        className="hover:text-ink-foreground focus-visible:outline-ink-foreground rounded underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
                      >
                        {CONTACT.email}
                      </a>
                    </li>
                  ) : null}
                  {CONTACT.phone ? (
                    <li>
                      <span className="text-ink-foreground/50">
                        {t.footer.phoneLabel}:{" "}
                      </span>
                      <a
                        href={`tel:${CONTACT.phone.replace(/[^\d+]/g, "")}`}
                        dir="ltr"
                        className="hover:text-ink-foreground focus-visible:outline-ink-foreground inline-block rounded underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
                      >
                        {CONTACT.phone}
                      </a>
                    </li>
                  ) : null}
                </ul>
              ) : (
                <p>
                  <Link
                    href={ROUTES.contact}
                    className="hover:text-ink-foreground focus-visible:outline-ink-foreground rounded underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    {t.footer.noContactNote}
                  </Link>
                </p>
              )}
            </div>

            <div className="marketing-footer-locale shrink-0">
              <LocaleSwitcher />
            </div>
          </div>

          <p className="text-ink-foreground/50 mt-6 text-sm">
            © {year} {t.brand.name}. {t.footer.rights}
          </p>
        </div>
      </div>
    </footer>
  );
}
