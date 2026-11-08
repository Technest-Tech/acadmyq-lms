import { MessageCircle } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { CONTACT, ROUTES, WHATSAPP, type MarketingContent } from "@/content/marketing";

/**
 * The site footer.
 *
 * Every link here goes somewhere real. There is no `href="#"` and no social icons. The WhatsApp line
 * (`WHATSAPP` in content/site.ts) is always shown; an email or phone appears only when the
 * deployment configured one, because an invented support address is a promise the site cannot keep.
 *
 * The year is read at render time. A server-rendered page that resolves the visitor's locale is
 * already dynamic, so this is genuinely "now" rather than the year of the last deploy — which is
 * how the old page ended up printing © 2025 well into 2026.
 */
export function SiteFooter({ t }: { t: MarketingContent }) {
  const year = new Date().getFullYear();

  const columns = [
    {
      heading: t.footer.productsHeading,
      links: [
        { href: ROUTES.academyManagement, label: t.nav.academyManagement },
        { href: ROUTES.coursePlatform, label: t.nav.coursePlatform },
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
    <footer className="mk-ink text-ink-foreground relative overflow-hidden">
      <div aria-hidden className="mk-lattice" />
      <span aria-hidden className="bg-gold/70 absolute inset-x-0 top-0 h-px" />
      <div className="relative mx-auto w-full max-w-7xl px-4 py-14 sm:px-8">
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
              <span className="text-lg font-extrabold">{t.brand.name}</span>
            </Link>
            <p className="text-ink-foreground/70 mt-4 text-sm leading-relaxed">
              {t.footer.tagline}
            </p>
          </div>

          {columns.map((column) => (
            <nav key={column.heading} aria-label={column.heading}>
              <h2 className="text-gold text-sm font-bold">
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
              <ul className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-6">
                <li>
                  <a
                    href={WHATSAPP.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${t.footer.whatsappLabel} ${WHATSAPP.display}`}
                    className="hover:text-ink-foreground focus-visible:outline-ink-foreground inline-flex items-center gap-2 rounded font-bold underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    <span
                      aria-hidden
                      className="flex size-7 items-center justify-center rounded-full bg-emerald-500 text-white"
                    >
                      <MessageCircle className="size-4" />
                    </span>
                    <span className="text-ink-foreground/50 font-normal">{t.footer.whatsappLabel}:</span>
                    <span dir="ltr">{WHATSAPP.display}</span>
                  </a>
                </li>
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
