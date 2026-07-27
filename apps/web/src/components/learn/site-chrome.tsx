"use client";

import {
  ArrowUpRight,
  BookOpen,
  ChevronDown,
  GraduationCap,
  LogOut,
  Mail,
  MapPin,
  Menu,
  Phone,
  Search,
  Sparkles,
  Ticket,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ComponentType } from "react";
import { useEffect, useState } from "react";
import { useLearn } from "@/components/learn/context";
import {
  GlobeIcon,
  SOCIAL_GLYPHS,
  WhatsappIcon,
} from "@/components/learn/social-icons";
import { LocaleSwitcher } from "@/components/locale-switcher";
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

/** The academy's logo, or a monogram on the brand colour when they haven't uploaded one. */
export function SiteLogo({
  className,
  size = 36,
}: {
  className?: string;
  size?: number;
}) {
  const { site, siteName } = useLearn();

  if (site.brand.logo_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={site.brand.logo_url}
        alt={siteName}
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
  const { academy, site, siteName, learner, logout, openAuth, openRedeem } =
    useLearn();
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
        <Link href={base} className="group flex min-w-0 items-center gap-3">
          <SiteLogo
            size={40}
            className="shadow-sm transition-transform group-hover:scale-[1.03]"
          />
          <span className="min-w-0">
            <span className="block truncate text-[15px] leading-tight font-extrabold tracking-tight">
              {siteName}
            </span>
            {site.brand.tagline && (
              <span className="text-muted-foreground block truncate text-[11px] leading-tight">
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

          <button
            type="button"
            onClick={openRedeem}
            className="border-border bg-card hover:border-primary/50 hover:text-primary hidden h-10 items-center gap-1.5 rounded-xl border px-3.5 text-sm font-semibold shadow-sm transition-all hover:-translate-y-px md:inline-flex"
          >
            <Ticket className="size-4" aria-hidden /> {t("redeem.cta")}
          </button>

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
              className="bg-primary text-primary-foreground inline-flex h-10 items-center rounded-xl px-4 text-sm font-bold shadow-md shadow-[var(--brand-soft)] transition-all hover:-translate-y-px hover:opacity-95"
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
        <div className="bg-background/96 border-t px-4 py-3 shadow-xl backdrop-blur-xl lg:hidden">
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
  const pathname = usePathname();

  useEffect(() => setOpen(false), [pathname]);

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
      className="group fixed bottom-5 end-5 z-50 flex h-14 items-center rounded-full bg-[#25D366] px-4 text-white shadow-[0_12px_30px_-8px_rgba(37,211,102,0.75)] transition-all hover:-translate-y-0.5 hover:bg-[#1ebe5b] focus-visible:ring-2 focus-visible:ring-[#25D366] focus-visible:ring-offset-2 focus-visible:outline-none sm:bottom-6 sm:end-6"
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

/** Social links the client actually filled in, ready to render. */
export function useSocialLinks(): {
  key: string;
  href: string;
  Icon: ComponentType<{ className?: string }>;
}[] {
  const { site } = useLearn();
  return Object.entries(site.contact.socials ?? {})
    .filter(([, href]) => typeof href === "string" && href.trim() !== "")
    .map(([key, href]) => ({
      key,
      href,
      Icon: SOCIAL_GLYPHS[key] ?? GlobeIcon,
    }));
}

export function SiteFooter() {
  const t = useTranslations("learn");
  const { site, siteName, academy, learner, openRedeem } = useLearn();
  const items = useNavItems();
  const socials = useSocialLinks();
  const { contact } = site;
  const footerTitle =
    site.cta.title || t("defaults.cta.title", { name: siteName });
  const footerSubtitle = site.cta.subtitle || t("defaults.cta.subtitle");
  const footerNote =
    site.footer.note ||
    site.brand.tagline ||
    t("footer.description", { name: siteName });

  const contactRows = [
    contact.email && {
      Icon: Mail,
      text: contact.email,
      href: `mailto:${contact.email}`,
    },
    contact.phone && {
      Icon: Phone,
      text: contact.phone,
      href: `tel:${contact.phone}`,
    },
    contact.whatsapp && {
      Icon: WhatsappIcon,
      text: contact.whatsapp,
      href: whatsappHref(contact.whatsapp),
    },
    contact.address && { Icon: MapPin, text: contact.address, href: null },
  ].filter(Boolean) as {
    Icon: ComponentType<{ className?: string }>;
    text: string;
    href: string | null;
  }[];

  return (
    <footer className="relative isolate mt-24 overflow-hidden rounded-t-[2.75rem] bg-[oklch(0.15_0.025_245)] text-white">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--brand)] to-transparent" />
      <div className="pointer-events-none absolute -top-48 -end-36 -z-10 size-[620px] rounded-full bg-[var(--brand)] opacity-15 blur-[150px]" />
      <div className="pointer-events-none absolute -bottom-56 -start-36 -z-10 size-[520px] rounded-full bg-indigo-500/10 blur-[140px]" />
      <span
        className="pointer-events-none absolute inset-x-0 -bottom-4 -z-10 truncate px-4 text-center text-[15vw] leading-none font-black text-white/[0.025] select-none"
        aria-hidden
      >
        {siteName}
      </span>

      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div
          className="relative -mt-px overflow-hidden rounded-b-[2rem] border border-t-0 border-white/10 px-6 py-8 sm:px-9 lg:flex lg:items-center lg:justify-between lg:gap-10"
          style={{
            background:
              "linear-gradient(125deg, color-mix(in oklab, var(--brand) 58%, black), oklch(0.2 0.035 245) 68%)",
          }}
        >
          <div className="relative max-w-2xl">
            <span className="mb-3 inline-flex items-center gap-2 text-xs font-bold tracking-[0.18em] text-white/65 uppercase">
              <Sparkles className="size-3.5 text-amber-300" aria-hidden />
              {t("footer.ctaEyebrow")}
            </span>
            <h2 className="text-2xl font-bold tracking-tight text-balance sm:text-3xl">
              {footerTitle}
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/65 sm:text-base">
              {footerSubtitle}
            </p>
          </div>

          <div className="relative mt-6 flex flex-col gap-3 sm:flex-row lg:mt-0 lg:shrink-0">
            <Link
              href={`/learn/${academy}/courses`}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-white px-5 text-sm font-bold text-[oklch(0.18_0.025_245)] shadow-xl shadow-black/15 transition-all hover:-translate-y-0.5 hover:bg-white/90"
            >
              <BookOpen className="size-4" aria-hidden />
              {t("nav.courses")}
            </Link>
            <button
              type="button"
              onClick={openRedeem}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/[0.07] px-5 text-sm font-bold text-white transition-all hover:-translate-y-0.5 hover:bg-white/15"
            >
              <Ticket className="size-4" aria-hidden />
              {t("redeem.cta")}
            </button>
          </div>
        </div>

        <div className="grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-[1.35fr_0.8fr_0.8fr_1.15fr] lg:gap-12">
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <SiteLogo className="ring-1 ring-white/15" size={48} />
              <span className="min-w-0">
                <span className="block truncate text-lg font-bold">
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
              <div className="flex flex-wrap gap-2">
                {socials.map(({ key, href, Icon }) => (
                  <a
                    key={key}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={key}
                    className="flex size-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/60 transition-all hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/10 hover:text-white"
                  >
                    <Icon className="size-4" />
                  </a>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-4">
            <h3 className="text-xs font-bold tracking-[0.16em] text-white/40 uppercase">
              {t("footer.explore")}
            </h3>
            <ul className="space-y-3">
              {items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="group inline-flex items-center gap-2 text-sm text-white/65 transition-colors hover:text-white"
                  >
                    {item.label}
                    <ArrowUpRight
                      className="size-3.5 opacity-0 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:opacity-100 rtl:group-hover:-translate-x-0.5"
                      aria-hidden
                    />
                  </Link>
                </li>
              ))}
              {site.footer.links.map((link) => (
                <li key={`${link.label}-${link.href}`}>
                  <a
                    href={link.href}
                    className="group inline-flex items-center gap-2 text-sm text-white/65 transition-colors hover:text-white"
                    {...(link.href.startsWith("http")
                      ? { target: "_blank", rel: "noopener noreferrer" }
                      : {})}
                  >
                    {link.label}
                    <ArrowUpRight
                      className="size-3.5 opacity-0 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:opacity-100 rtl:group-hover:-translate-x-0.5"
                      aria-hidden
                    />
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-4">
            <h3 className="text-xs font-bold tracking-[0.16em] text-white/40 uppercase">
              {t("footer.learning")}
            </h3>
            <ul className="space-y-3">
              <li>
                <Link
                  href={`/learn/${academy}/courses`}
                  className="group inline-flex items-center gap-2 text-sm text-white/65 transition-colors hover:text-white"
                >
                  {t("nav.courses")}
                  <ArrowUpRight
                    className="size-3.5 opacity-0 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:opacity-100 rtl:group-hover:-translate-x-0.5"
                    aria-hidden
                  />
                </Link>
              </li>
              {learner && (
                <li>
                  <Link
                    href={`/learn/${academy}/me`}
                    className="group inline-flex items-center gap-2 text-sm text-white/65 transition-colors hover:text-white"
                  >
                    {t("nav.myLearning")}
                    <ArrowUpRight
                      className="size-3.5 opacity-0 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:opacity-100 rtl:group-hover:-translate-x-0.5"
                      aria-hidden
                    />
                  </Link>
                </li>
              )}
              <li>
                <button
                  type="button"
                  onClick={openRedeem}
                  className="text-sm text-white/65 transition-colors hover:text-white"
                >
                  {t("redeem.cta")}
                </button>
              </li>
            </ul>
          </div>

          <div className="space-y-4">
            <h3 className="text-xs font-bold tracking-[0.16em] text-white/40 uppercase">
              {t("footer.contact")}
            </h3>
            {contactRows.length > 0 ? (
              <ul className="space-y-3">
                {contactRows.map(({ Icon, text, href }) => (
                  <li key={text}>
                    {href ? (
                      <a
                        href={href}
                        className="group flex items-start gap-3 text-sm text-white/60 transition-colors hover:text-white"
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
            ) : (
              <p className="max-w-xs text-sm leading-relaxed text-white/50">
                {t("contact.empty")}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-col items-center justify-between gap-3 border-t border-white/10 py-6 text-xs text-white/40 sm:flex-row">
          <p>{t("footer.rights", { name: siteName })}</p>
          <p className="inline-flex items-center gap-1.5">
            <Sparkles className="size-3.5 text-amber-300/70" aria-hidden />
            {t("footer.poweredBy")}
          </p>
        </div>
      </div>
    </footer>
  );
}
