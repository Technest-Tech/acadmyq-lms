"use client";

import { Menu, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { ROUTES, type MarketingContent } from "@/content/marketing";
import { cn } from "@/lib/utils";

/**
 * The pages that open on a deep navy hero. Over those the header starts transparent with light text
 * and turns solid once the visitor scrolls; everywhere else it is solid from the first paint. Listed
 * rather than detected so the first server render is already right and nothing flashes.
 */
const DARK_TOP = new Set<string>([
  ROUTES.home,
  ROUTES.coursePlatform,
  ROUTES.academyManagement,
  // The sign-in doors (components/auth/auth-frame) are navy from top to bottom.
  ROUTES.login,
  "/forgot-password",
  "/reset-password",
]);

/**
 * The marketing site's header.
 *
 * A client component for two reasons — the mobile menu has state, and the header changes paint on
 * scroll. Everything it renders comes from the server-resolved content object passed in as a prop,
 * so no copy is duplicated here and the header cannot drift from the pages beneath it.
 *
 * `LocaleSwitcher` is the app's own switcher, reused verbatim: it writes the `NEXT_LOCALE` cookie
 * and refreshes, which is exactly how a signed-in user changes language too.
 */
/**
 * A fixed id, not `useId()`: there is one header per page, and on `/login` the server and client
 * trees differ above it (the full-catalogue provider), so a generated id came out different on
 * each side and React reported a hydration mismatch on every load of the sign-in page.
 */
const PANEL_ID = "site-menu-panel";

export function SiteHeader({ t }: { t: MarketingContent }) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const pathname = usePathname();

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

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const overlay = DARK_TOP.has(pathname) && !scrolled && !open;
  // On the sign-in page itself a "Log in" link would point at the page you are on.
  const showLogin = pathname !== ROUTES.login;

  const links = [
    { href: `${ROUTES.home}#features`, label: t.nav.features },
    { href: ROUTES.academyManagement, label: t.nav.academyManagement },
    { href: ROUTES.coursePlatform, label: t.nav.coursePlatform },
    { href: ROUTES.contact, label: t.nav.contact },
  ];

  return (
    <header
      className={cn(
        "sticky top-0 z-50 border-b transition-[background-color,border-color,box-shadow] duration-300",
        overlay
          ? "border-transparent bg-transparent"
          : "border-border bg-background/90 shadow-[0_6px_24px_-18px_oklch(0.2_0.05_264/0.5)] backdrop-blur-md",
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-3 px-4 sm:px-8">
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
          <span
            className={cn(
              "text-lg font-extrabold transition-colors",
              overlay ? "text-white" : "text-foreground",
            )}
          >
            {t.brand.name}
          </span>
        </Link>

        <nav
          aria-label={t.nav.primaryLabel}
          className="ms-6 hidden items-center gap-1 lg:flex"
        >
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "focus-visible:outline-ring rounded-lg px-3 py-2 text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2",
                overlay
                  ? "text-white/75 hover:bg-white/10 hover:text-white"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
                pathname === link.href &&
                  (overlay ? "text-white" : "text-foreground"),
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ms-auto flex items-center gap-2">
          <div
            className={cn(
              "hidden sm:block",
              overlay && "marketing-footer-locale",
            )}
          >
            <LocaleSwitcher />
          </div>

          {/* A plain <a>, not <Link>: see CtaLink (marketing/ui.tsx) — login needs a full page load. */}
          {showLogin ? (
            <a
              href={ROUTES.login}
              className={cn(
                "focus-visible:outline-ring hidden rounded-lg px-3 py-2 text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 sm:block",
                overlay
                  ? "text-white/80 hover:bg-white/10 hover:text-white"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {t.nav.login}
            </a>
          ) : null}

          <Link
            href={ROUTES.contact}
            className={cn(
              "focus-visible:outline-ring hidden h-10 items-center rounded-xl px-4 text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 md:inline-flex",
              overlay
                ? "bg-gold text-gold-foreground hover:brightness-105"
                : "bg-primary text-primary-foreground hover:bg-primary/90",
            )}
          >
            {t.nav.demo}
          </Link>

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={PANEL_ID}
            aria-label={open ? t.nav.closeMenu : t.nav.openMenu}
            className={cn(
              "focus-visible:outline-ring inline-flex size-10 items-center justify-center rounded-xl border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 lg:hidden",
              overlay
                ? "border-white/20 text-white hover:bg-white/10"
                : "border-border hover:bg-muted",
            )}
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
        id={PANEL_ID}
        hidden={!open}
        className="border-border bg-background border-t lg:hidden"
      >
        <nav aria-label={t.nav.primaryLabel} className="px-4 py-4 sm:px-8">
          <ul className="flex flex-col gap-1">
            {links.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="hover:bg-muted focus-visible:outline-ring block rounded-lg px-3 py-3 text-base font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  {link.label}
                </Link>
              </li>
            ))}
            <li>
              <a
                href={ROUTES.login}
                className="hover:bg-muted focus-visible:outline-ring block rounded-lg px-3 py-3 text-base font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                {t.nav.login}
              </a>
            </li>
          </ul>

          <div className="mt-4 flex items-center justify-between gap-3">
            <LocaleSwitcher />
            <Link
              href={ROUTES.contact}
              className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-ring inline-flex h-11 flex-1 items-center justify-center rounded-xl px-4 text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              {t.nav.demo}
            </Link>
          </div>
        </nav>
      </div>
    </header>
  );
}
