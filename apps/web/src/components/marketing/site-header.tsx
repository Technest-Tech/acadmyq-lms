"use client";

import { Menu, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { ROUTES, type MarketingContent } from "@/content/marketing";
import { cn } from "@/lib/utils";

/**
 * The marketing site's header.
 *
 * A client component for one reason only — the mobile menu has state. Everything it renders comes
 * from the server-resolved content object passed in as a prop, so no copy is duplicated here and
 * the header cannot drift from the pages beneath it.
 *
 * `LocaleSwitcher` is the app's own switcher, reused verbatim: it writes the `NEXT_LOCALE` cookie
 * and refreshes, which is exactly how a signed-in user changes language too. One mechanism, so a
 * visitor who picks English on the marketing site is still reading English after they log in.
 *
 * The sign-in link is present but quiet — an outline link, never a filled button — so it does not
 * compete with the one conversion action next to it.
 */
export function SiteHeader({ t }: { t: MarketingContent }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const panelId = useId();

  // Close on navigation: the panel is not unmounted by a client-side route change on its own.
  useEffect(() => setOpen(false), [pathname]);

  // Escape closes it, which is what a keyboard user reaches for first.
  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);

    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const links = [
    { href: ROUTES.coursePlatform, label: t.nav.coursePlatform },
    { href: ROUTES.academyManagement, label: t.nav.academyManagement },
    { href: `${ROUTES.coursePlatform}#pricing`, label: t.nav.pricing },
    { href: ROUTES.contact, label: t.nav.contact },
  ];

  return (
    <header className="bg-background/85 border-border sticky top-0 z-50 border-b backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-5 sm:px-8">
        <Link
          href={ROUTES.home}
          aria-label={t.brand.homeLabel}
          className="focus-visible:outline-ring flex shrink-0 items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4"
        >
          <Image
            src="/logo.png"
            alt=""
            width={512}
            height={394}
            priority
            className="h-8 w-auto"
          />
          <span className="text-lg font-bold">{t.brand.name}</span>
        </Link>

        <nav
          aria-label={t.nav.primaryLabel}
          className="ms-4 hidden items-center gap-1 lg:flex"
        >
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:outline-ring rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2",
                pathname === link.href && "text-foreground",
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ms-auto flex items-center gap-2">
          <div className="hidden sm:block">
            <LocaleSwitcher />
          </div>

          <Link
            href={ROUTES.login}
            className="text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:outline-ring hidden rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 sm:block"
          >
            {t.nav.login}
          </Link>

          <Link
            href={ROUTES.contact}
            className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-ring hidden h-10 items-center rounded-xl px-4 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 md:inline-flex"
          >
            {t.nav.demo}
          </Link>

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={open ? t.nav.closeMenu : t.nav.openMenu}
            className="border-border hover:bg-muted focus-visible:outline-ring inline-flex size-10 items-center justify-center rounded-xl border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 lg:hidden"
          >
            {open ? (
              <X aria-hidden className="size-5" />
            ) : (
              <Menu aria-hidden className="size-5" />
            )}
          </button>
        </div>
      </div>

      {/* `hidden` rather than conditional rendering: the panel keeps a stable id for aria-controls. */}
      <div
        id={panelId}
        hidden={!open}
        className="border-border bg-background border-t lg:hidden"
      >
        <nav aria-label={t.nav.primaryLabel} className="px-5 py-4 sm:px-8">
          <ul className="flex flex-col gap-1">
            {links.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="hover:bg-muted focus-visible:outline-ring block rounded-lg px-3 py-3 text-base font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  {link.label}
                </Link>
              </li>
            ))}
            <li>
              <Link
                href={ROUTES.login}
                className="hover:bg-muted focus-visible:outline-ring block rounded-lg px-3 py-3 text-base font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                {t.nav.login}
              </Link>
            </li>
          </ul>

          <div className="mt-4 flex items-center justify-between gap-3">
            <LocaleSwitcher />
            <Link
              href={ROUTES.contact}
              className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-ring inline-flex h-11 flex-1 items-center justify-center rounded-xl px-4 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              {t.nav.demo}
            </Link>
          </div>
        </nav>
      </div>
    </header>
  );
}
