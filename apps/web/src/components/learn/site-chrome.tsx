"use client";

import {
  ArrowUpRight,
  ChevronDown,
  Clock,
  GraduationCap,
  LogOut,
  Mail,
  MapPin,
  Menu,
  Phone,
  Receipt,
  Search,
  Sparkles,
  Ticket,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ComponentType, ReactNode } from "react";
import { useEffect, useState } from "react";
import { useLearn } from "@/components/learn/context";
import {
  GlobeIcon,
  SOCIAL_GLYPHS,
  WhatsappIcon,
} from "@/components/learn/social-icons";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { learnNotifications } from "@/lib/learn-api";
import { cn } from "@/lib/utils";

/**
 * The header and footer every LMS client's public site shares (docs/lms/09). Structure, spacing and
 * behaviour are identical for all of them; the logo, the name, the links and the contact details
 * come from the academy's site profile.
 *
 * Nav items disappear when the client switched their page off (`pages.about|faq|contact`), so a
 * client who only wants a catalogue gets a two-item nav rather than dead links to empty pages.
 */

// ── shared bits ───────────────────────────────────────────────────────────────

/**
 * The academy's logo, or a monogram on the brand colour when they haven't uploaded one.
 *
 * The box is always square and the image always `object-contain`, which is what keeps the header
 * the same height for a wordmark, a circular badge and a tall crest alike — the three shapes a
 * white-label template actually receives. A client who uploaded a compact mark gets it here; one
 * who uploaded only a wide logo gets that, letterboxed rather than cropped.
 */
export function SiteLogo({
  className,
  size = 36,
}: {
  className?: string;
  size?: number;
}) {
  const { site, siteName } = useLearn();
  const src = site.brand.logo_mark_url || site.brand.logo_url;

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        className={cn("shrink-0 rounded-xl object-contain", className)}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      className={cn(
        "text-primary-foreground bg-primary flex shrink-0 items-center justify-center rounded-xl font-bold",
        className,
      )}
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      aria-hidden
    >
      {siteName.trim().charAt(0).toUpperCase() || (
        <GraduationCap className="size-4" />
      )}
    </span>
  );
}

interface NavItem {
  href: string;
  label: string;
}

function useNavItems(): NavItem[] {
  const t = useTranslations("learn.nav");
  const { academy, site } = useLearn();
  const base = `/learn/${academy}`;

  return [
    { href: base, label: t("home") },
    { href: `${base}/courses`, label: t("courses") },
    ...(site.pages.about ? [{ href: `${base}/about`, label: t("about") }] : []),
    ...(site.pages.faq ? [{ href: `${base}/faq`, label: t("faq") }] : []),
    ...(site.pages.contact
      ? [{ href: `${base}/contact`, label: t("contact") }]
      : []),
  ];
}

// ── header ────────────────────────────────────────────────────────────────────

export function SiteHeader() {
  const t = useTranslations("learn");
  const {
    academy,
    site,
    siteName,
    commerce,
    learner,
    logout,
    openAuth,
    openRedeem,
  } = useLearn();
  const pathname = usePathname();
  const items = useNavItems();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  // Close the mobile sheet on navigation — otherwise it hangs over the page the visitor just asked
  // for, which reads as a broken link.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const base = `/learn/${academy}`;

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b transition-all duration-300",
        scrolled
          ? "border-border/80 bg-background/92 shadow-[0_10px_35px_-28px_rgba(15,23,42,0.55)] backdrop-blur-xl"
          : "border-transparent bg-background/75 backdrop-blur-md",
      )}
    >
      <div className="mx-auto flex h-[4.5rem] max-w-7xl items-center gap-3 px-4 sm:px-6 lg:gap-5">
        {/* max-w keeps a 60-character academy name from eating the nav; the tagline is the first
            thing to go, because the name is the part that has to survive. */}
        <Link
          href={base}
          className="group focus-visible:ring-ring/60 flex min-w-0 max-w-[55%] items-center gap-2.5 rounded-xl focus-visible:ring-2 focus-visible:outline-none sm:max-w-xs sm:gap-3"
        >
          <SiteLogo
            size={40}
            className="shadow-sm transition-transform group-hover:scale-[1.03]"
          />
          <span className="min-w-0">
            <span
              dir="auto"
              className="block truncate text-[15px] leading-tight font-extrabold tracking-tight"
            >
              {siteName}
            </span>
            {site.brand.tagline && (
              <span className="text-muted-foreground hidden truncate text-[11px] leading-tight sm:block">
                {site.brand.tagline}
              </span>
            )}
          </span>
        </Link>

        <nav className="bg-muted/55 mx-auto hidden items-center gap-0.5 rounded-2xl border border-white/70 p-1 shadow-inner lg:flex">
          {items.map((item) => {
            const active =
              item.href === base
                ? pathname === base
                : pathname?.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "relative rounded-xl px-3.5 py-2 text-[13px] font-semibold transition-all",
                  active
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-card/60 hover:text-foreground",
                )}
              >
                {item.label}
                {active && (
                  <span className="bg-primary absolute inset-x-4 -bottom-1 h-0.5 rounded-full" />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="ms-auto flex items-center gap-2 lg:ms-0">
          <Link
            href={`${base}/courses`}
            aria-label={t("catalog.search")}
            title={t("catalog.search")}
            className="text-muted-foreground hover:bg-muted hover:text-foreground hidden size-9 items-center justify-center rounded-xl transition-colors xl:inline-flex"
          >
            <Search className="size-[18px]" aria-hidden />
          </Link>

          <span className="hidden md:block">
            <LocaleSwitcher />
          </span>

          {/* Only where a code actually unlocks something. On a site that sells online, the code is
              a side door and putting it in the header next to "Sign in" oversells it. */}
          {commerce.codes && (
            <button
              type="button"
              onClick={openRedeem}
              className="border-border bg-card hover:border-primary/50 hover:text-primary focus-visible:ring-ring/60 hidden h-10 items-center gap-1.5 rounded-xl border px-3.5 text-sm font-semibold shadow-sm transition-all hover:-translate-y-px focus-visible:ring-2 focus-visible:outline-none md:inline-flex"
            >
              <Ticket className="size-4" aria-hidden /> {t("redeem.cta")}
            </button>
          )}

          {learner ? (
            <>
              <Link
                href={`${base}/me`}
                className="text-primary hidden h-10 items-center rounded-xl bg-[var(--brand-soft)] px-3.5 text-sm font-semibold transition-colors hover:bg-[var(--brand-line)] xl:inline-flex"
              >
                {t("nav.myLearning")}
              </Link>
              <AccountMenu onLogout={() => void logout()} />
            </>
          ) : (
            <button
              type="button"
              onClick={() => openAuth("login")}
              className="bg-primary text-primary-foreground focus-visible:ring-ring/60 focus-visible:ring-offset-background inline-flex h-10 items-center rounded-xl px-4 text-sm font-bold shadow-md shadow-[var(--brand-soft)] transition-all hover:-translate-y-px hover:brightness-[1.06] focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              {t("auth.signIn")}
            </button>
          )}

          <button
            type="button"
            aria-label={t("nav.menu")}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="hover:bg-muted rounded-xl p-2 transition-colors lg:hidden"
          >
            {open ? (
              <X className="size-5" aria-hidden />
            ) : (
              <Menu className="size-5" aria-hidden />
            )}
          </button>
        </div>
      </div>

      {open && (
        // Capped and scrollable: a client with five pages plus the redeem row must not push its own
        // last item under the fold on a short phone in landscape.
        <div className="bg-background/96 max-h-[calc(100dvh-4.5rem)] overflow-y-auto border-t px-4 py-3 shadow-xl backdrop-blur-xl lg:hidden">
          <nav className="bg-card flex flex-col rounded-2xl border p-1.5 shadow-sm">
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors",
                  item.href === base
                    ? pathname === base
                      ? "bg-[var(--brand-soft)] text-primary"
                      : "hover:bg-muted"
                    : pathname?.startsWith(item.href)
                      ? "bg-[var(--brand-soft)] text-primary"
                      : "hover:bg-muted",
                )}
              >
                {item.label}
              </Link>
            ))}
            {learner && (
              <Link
                href={`${base}/me`}
                className="hover:bg-muted flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors"
              >
                <GraduationCap className="size-4" aria-hidden />
                {t("nav.myLearning")}
              </Link>
            )}
            {commerce.codes && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  openRedeem();
                }}
                className="hover:bg-muted flex items-center gap-2 rounded-xl px-3 py-2.5 text-start text-sm font-semibold transition-colors"
              >
                <Ticket className="size-4" aria-hidden /> {t("redeem.cta")}
              </button>
            )}
          </nav>
          <div className="flex items-center gap-2 pt-3 md:hidden">
            <LocaleSwitcher />
          </div>
        </div>
      )}
    </header>
  );
}

function AccountMenu({ onLogout }: { onLogout: () => void }) {
  const t = useTranslations("learn");
  const { academy, learner } = useLearn();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const pathname = usePathname();

  useEffect(() => setOpen(false), [pathname]);

  // The one place the learner is told an order moved without opening it. Fetched once per mount
  // rather than polled: an order decision is minutes-to-hours work, not a live feed.
  useEffect(() => {
    if (!learner) return;
    learnNotifications(academy)
      .then((r) => setUnread(r.unread))
      .catch(() => undefined);
  }, [academy, learner]);

  if (!learner) return null;
  const first = learner.full_name.trim().split(/\s+/)[0] ?? "";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="border-border bg-card hover:border-primary/40 hover:bg-muted inline-flex h-10 items-center gap-2 rounded-xl border px-2 text-sm font-semibold shadow-sm transition-colors"
      >
        <span
          className="text-primary flex size-6 items-center justify-center rounded-lg bg-[var(--brand-soft)] text-[11px] font-extrabold"
          aria-hidden
        >
          {first.charAt(0).toUpperCase()}
        </span>
        <span className="hidden max-w-24 truncate sm:inline">{first}</span>
        <ChevronDown className="size-3.5 opacity-60" aria-hidden />
      </button>

      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-10 cursor-default"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
          />
          <div className="bg-card absolute end-0 z-20 mt-2 w-52 overflow-hidden rounded-xl border shadow-lg">
            <div className="border-b px-3 py-2.5">
              <p className="truncate text-sm font-semibold">
                {learner.full_name}
              </p>
              <p className="text-muted-foreground truncate text-xs">
                {learner.email}
              </p>
            </div>
            <Link
              href={`/learn/${academy}/me`}
              className="hover:bg-muted flex items-center gap-2 px-3 py-2.5 text-sm transition-colors"
            >
              <GraduationCap className="size-4" aria-hidden />{" "}
              {t("nav.myLearning")}
            </Link>
            {/* Purchases (docs/lms/10 §3). This is where a buyer comes back to finish an order or
                read why a receipt was refused, so it sits next to their learning, not buried. */}
            <Link
              href={`/learn/${academy}/orders`}
              className="hover:bg-muted flex items-center gap-2 px-3 py-2.5 text-sm transition-colors"
            >
              <Receipt className="size-4" aria-hidden /> {t("nav.myOrders")}
              {unread > 0 && (
                <span className="bg-primary text-primary-foreground ms-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </Link>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onLogout();
              }}
              className="hover:bg-muted flex w-full items-center gap-2 px-3 py-2.5 text-start text-sm transition-colors"
            >
              <LogOut className="size-4" aria-hidden /> {t("auth.logout")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── floating WhatsApp button ──────────────────────────────────────────────────

/**
 * Tells the rest of the site's fixed furniture how tall the bottom bar currently is.
 *
 * The sales page's sticky purchase bar and the floating WhatsApp button are both `position: fixed`
 * in the same corner, and neither can see the other. One CSS variable on the document element is
 * the cheapest honest channel between them: the bar publishes its height while it is on screen,
 * the button adds it to its own offset, and nothing ends up covering the price.
 */
export function useBottomBarInset(active: boolean, height = "4.75rem"): void {
  useEffect(() => {
    const root = document.documentElement;
    if (!active) {
      root.style.removeProperty("--learn-bottom-bar");
      return;
    }
    root.style.setProperty("--learn-bottom-bar", height);
    return () => {
      root.style.removeProperty("--learn-bottom-bar");
    };
  }, [active, height]);
}

/** `wa.me` only accepts digits — a client may type "+20 100 123 4567" in the editor. */
export function whatsappHref(number: string, text?: string): string {
  const digits = number.replace(/\D/g, "");
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

/**
 * Where "I don't have a code" sends a visitor (docs/lms/09). Codes are sold off-platform, so the ask
 * has to reach a person: the client's WhatsApp with the course already named, or — when they have
 * given no number — the site's own contact page, so the button is never a dead end.
 */
export function useRequestCodeHref(courseTitle?: string): string {
  const t = useTranslations("learn");
  const { academy, site, siteName } = useLearn();
  const number = site.contact.whatsapp?.trim() ?? "";

  if (number.replace(/\D/g, "") === "") return `/learn/${academy}/contact`;

  return whatsappHref(
    number,
    courseTitle
      ? t("whatsapp.requestCode", { name: siteName, course: courseTitle })
      : t("whatsapp.prefill", { name: siteName }),
  );
}

/**
 * The always-there "talk to a human" affordance (docs/lms/09). These clients sell on WhatsApp, so a
 * visitor deciding on a course should never have to hunt the footer for the number.
 *
 * Driven entirely by the site profile's `contact.whatsapp`: no number ⇒ no button, so a client who
 * hasn't filled it in gets a clean page rather than a dead link. The label is collapsed to the icon
 * on hover-less/narrow viewports and expands on hover, which keeps it out of the content on mobile.
 */
export function SiteWhatsappButton() {
  const t = useTranslations("learn");
  const { site, siteName } = useLearn();
  const number = site.contact.whatsapp?.trim() ?? "";

  if (number.replace(/\D/g, "") === "") return null;

  const label = t("whatsapp.float");

  return (
    <a
      href={whatsappHref(number, t("whatsapp.prefill", { name: siteName }))}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      // `--learn-bottom-bar` is published by the sales page's sticky purchase bar (see
      // useBottomBarInset). Without it the two fixed elements share the same corner and the
      // button sits on top of the price the visitor is trying to read.
      style={{
        bottom: "calc(1.25rem + var(--learn-bottom-bar, 0px) + env(safe-area-inset-bottom))",
      }}
      className="group fixed end-5 z-50 flex h-14 items-center rounded-full bg-[#25D366] px-4 text-white shadow-[0_12px_30px_-8px_rgba(37,211,102,0.75)] transition-all hover:-translate-y-0.5 hover:bg-[#1ebe5b] focus-visible:ring-2 focus-visible:ring-[#25D366] focus-visible:ring-offset-2 focus-visible:outline-none sm:end-6"
    >
      <span className="relative flex size-6 shrink-0 items-center justify-center">
        <span
          className="absolute inline-flex size-full rounded-full bg-white/25 motion-safe:animate-ping"
          aria-hidden
        />
        <WhatsappIcon className="relative size-6" />
      </span>
      <span className="hidden max-w-0 overflow-hidden ps-0 text-sm font-bold whitespace-nowrap transition-all duration-300 group-hover:max-w-52 group-hover:ps-3 sm:inline-block">
        {label}
      </span>
    </a>
  );
}

// ── footer ────────────────────────────────────────────────────────────────────

/**
 * Social links the client actually filled in, ready to render.
 *
 * Each carries a localized `label`: these render as icon-only buttons, and "facebook" as the
 * accessible name of a link is the network's id, not a sentence a screen reader should read out.
 */
export function useSocialLinks(): {
  key: string;
  href: string;
  label: string;
  Icon: ComponentType<{ className?: string }>;
}[] {
  const t = useTranslations("learn.social");
  const { site, siteName } = useLearn();

  return Object.entries(site.contact.socials ?? {})
    .filter(([, href]) => typeof href === "string" && href.trim() !== "")
    .map(([key, href]) => ({
      key,
      href,
      label: t("link", { network: t(`network.${key}`), name: siteName }),
      Icon: SOCIAL_GLYPHS[key] ?? GlobeIcon,
    }));
}

/**
 * The site's closing frame (docs/lms/09 §10).
 *
 * Two things it deliberately does NOT do any more:
 *
 *  - it no longer opens with a big call-to-action panel. That panel rendered `site.cta.title` and
 *    `site.cta.subtitle` — the very same words the CtaBand above it had just printed — so every
 *    page ended by asking the identical question twice, one block under the other.
 *  - it no longer says "contact details haven't been added yet". A public page must never report
 *    the shop's own configuration gaps to its customers; a column with nothing in it is removed.
 */
export function SiteFooter() {
  const t = useTranslations("learn");
  const { site, siteName, academy, commerce, learner, openRedeem } = useLearn();
  const items = useNavItems();
  const socials = useSocialLinks();
  const { contact } = site;
  const footerNote =
    site.footer.note ||
    site.brand.tagline ||
    t("footer.description", { name: siteName });
  const legalName = site.legal?.business_name?.trim() || siteName;

  const contactRows = [
    contact.email && {
      Icon: Mail,
      text: contact.email,
      href: `mailto:${contact.email}`,
    },
    contact.phone && {
      Icon: Phone,
      text: contact.phone,
      href: `tel:${contact.phone.replace(/[^\d+]/g, "")}`,
    },
    contact.whatsapp && {
      Icon: WhatsappIcon,
      text: contact.whatsapp,
      href: whatsappHref(contact.whatsapp),
    },
    contact.address && { Icon: MapPin, text: contact.address, href: null },
    contact.hours && { Icon: Clock, text: contact.hours, href: null },
  ].filter(Boolean) as {
    Icon: ComponentType<{ className?: string }>;
    text: string;
    href: string | null;
  }[];

  const legalLinks =
    site.legal?.show === false
      ? []
      : ([
          ["terms", t("legal.terms.title")],
          ["refund", t("legal.refund.title")],
          ["privacy", t("legal.privacy.title")],
        ] as const);

  return (
    <footer className="relative isolate mt-16 overflow-hidden rounded-t-[2rem] bg-[oklch(0.15_0.025_245)] text-white sm:mt-20 sm:rounded-t-[2.75rem]">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--brand)] to-transparent" />
      <div className="pointer-events-none absolute -top-48 -end-36 -z-10 size-[620px] rounded-full bg-[var(--brand)] opacity-15 blur-[150px]" />
      <span
        className="pointer-events-none absolute inset-x-0 -bottom-4 -z-10 truncate px-4 text-center text-[15vw] leading-none font-black text-white/[0.025] select-none"
        aria-hidden
      >
        {siteName}
      </span>

      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-[1.35fr_0.8fr_0.8fr_1.15fr] lg:gap-12 lg:py-14">
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <SiteLogo className="ring-1 ring-white/15" size={48} />
              <span className="min-w-0">
                <span dir="auto" className="block truncate text-lg font-bold">
                  {siteName}
                </span>
                {site.brand.tagline && (
                  <span className="block truncate text-xs text-white/50">
                    {site.brand.tagline}
                  </span>
                )}
              </span>
            </div>

            <p className="max-w-sm text-sm leading-relaxed text-white/55">
              {footerNote}
            </p>

            {socials.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {socials.map(({ key, href, Icon, label }) => (
                  <li key={key}>
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={label}
                      className="flex size-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/60 transition-all hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
                    >
                      <Icon className="size-4" />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-4">
            <h2 className="text-xs font-bold tracking-[0.16em] text-white/40 uppercase">
              {t("footer.explore")}
            </h2>
            <ul className="space-y-3">
              {items.map((item) => (
                <li key={item.href}>
                  <FooterLink href={item.href}>{item.label}</FooterLink>
                </li>
              ))}
              {site.footer.links.map((link) => (
                <li key={`${link.label}-${link.href}`}>
                  <FooterLink href={link.href} external>
                    {link.label}
                  </FooterLink>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-4">
            <h2 className="text-xs font-bold tracking-[0.16em] text-white/40 uppercase">
              {t("footer.learning")}
            </h2>
            <ul className="space-y-3">
              <li>
                <FooterLink href={`/learn/${academy}/courses`}>
                  {t("nav.courses")}
                </FooterLink>
              </li>
              {learner && (
                <>
                  <li>
                    <FooterLink href={`/learn/${academy}/me`}>
                      {t("nav.myLearning")}
                    </FooterLink>
                  </li>
                  {commerce.checkout && (
                    <li>
                      <FooterLink href={`/learn/${academy}/orders`}>
                        {t("nav.myOrders")}
                      </FooterLink>
                    </li>
                  )}
                </>
              )}
              {/* The code lives here rather than in a headline button on a site that also sells. */}
              {commerce.codes && (
                <li>
                  <button
                    type="button"
                    onClick={openRedeem}
                    className="text-sm text-white/65 transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
                  >
                    {t("redeem.cta")}
                  </button>
                </li>
              )}
            </ul>
          </div>

          {/* Contact, only when there is something to say. */}
          {contactRows.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-xs font-bold tracking-[0.16em] text-white/40 uppercase">
                {t("footer.contact")}
              </h2>
              <ul className="space-y-3">
                {contactRows.map(({ Icon, text, href }) => (
                  <li key={text}>
                    {href ? (
                      <a
                        href={href}
                        className="group flex items-start gap-3 text-sm text-white/60 transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] text-white/80 transition-transform group-hover:scale-105">
                          <Icon className="size-4" />
                        </span>
                        <span className="pt-2 break-words">{text}</span>
                      </a>
                    ) : (
                      <span className="flex items-start gap-3 text-sm text-white/60">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] text-white/80">
                          <Icon className="size-4" />
                        </span>
                        <span className="pt-2 break-words">{text}</span>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* The trust row (docs/lms/10 §6). Always rendered — the template carries a default policy
            for a client who wrote none, so these links are never dead. */}
        {legalLinks.length > 0 && (
          <nav
            aria-label={t("footer.legalHeading")}
            className="flex flex-wrap justify-center gap-x-5 gap-y-2 border-t border-white/10 pt-6 text-xs text-white/45 sm:justify-start"
          >
            {legalLinks.map(([doc, label]) => (
              <Link
                key={doc}
                href={`/learn/${academy}/legal/${doc}`}
                className="rounded transition-colors hover:text-white/80 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
              >
                {label}
              </Link>
            ))}
            {/* Only where money actually changes hands here — an idle promise about payments on a
                site that takes none is noise. */}
            {commerce.checkout && (
              <span className="text-white/35">
                {t("footer.paymentsNote", { name: legalName })}
              </span>
            )}
          </nav>
        )}

        <div className="flex flex-col items-center justify-between gap-3 border-t border-white/10 py-6 text-xs text-white/40 sm:flex-row">
          <p>{t("footer.rights", { name: legalName })}</p>
          <p className="inline-flex items-center gap-1.5">
            <Sparkles className="size-3.5 text-amber-300/70" aria-hidden />
            {t.rich("footer.poweredByRich", {
              a: (chunks) => (
                <a
                  href="https://acadmyq.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-white/60 underline decoration-white/20 underline-offset-4 transition-colors hover:text-white"
                >
                  {chunks}
                </a>
              ),
            })}
          </p>
        </div>
      </div>
    </footer>
  );
}

/** One footer link, with the shared hover arrow. `external` opens a client-supplied URL safely. */
function FooterLink({
  href,
  external = false,
  children,
}: {
  href: string;
  external?: boolean;
  children: ReactNode;
}) {
  const className =
    "group inline-flex items-center gap-2 rounded text-sm text-white/65 transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none";
  const body = (
    <>
      {children}
      <ArrowUpRight
        className="size-3.5 opacity-0 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:opacity-100 rtl:group-hover:-translate-x-0.5"
        aria-hidden
      />
    </>
  );

  return external && href.startsWith("http") ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {body}
    </a>
  ) : (
    <Link href={href} className={className}>
      {body}
    </Link>
  );
}
