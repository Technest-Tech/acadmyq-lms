import {
  Award,
  Check,
  BellRing,
  BookOpen,
  CalendarDays,
  CircleCheck,
  ClipboardCheck,
  Contact,
  CreditCard,
  FileText,
  Files,
  Globe,
  GraduationCap,
  HandCoins,
  History,
  KeyRound,
  Languages,
  LayoutDashboard,
  ListChecks,
  Lock,
  Megaphone,
  MessageCircle,
  Palette,
  PlayCircle,
  Receipt,
  Server,
  Shield,
  Smartphone,
  Sparkles,
  TrendingUp,
  TriangleAlert,
  UserCog,
  Users,
  Video,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { ROUTES, type IconName, type SectionHead } from "@/content/marketing";
import { cn } from "@/lib/utils";

/**
 * The marketing site's layout kit: the spacing scale, the two CTA shapes, the section heading, and
 * the lucide lookup that turns an icon NAME in the content files into a component.
 *
 * Deliberately separate from `components/ui` (the app's shadcn primitives). Those are sized for
 * dense staff chrome — a 32px button in a toolbar — and a landing page needs 48px targets, wider
 * radii and more air. Reusing them here would have meant overriding almost every class at every
 * call site, which is how two design systems quietly become one mush.
 */

const ICONS: Record<IconName, LucideIcon> = {
  Award,
  BellRing,
  BookOpen,
  CalendarDays,
  CircleCheck,
  ClipboardCheck,
  Contact,
  CreditCard,
  FileText,
  Files,
  Globe,
  GraduationCap,
  HandCoins,
  History,
  KeyRound,
  Languages,
  LayoutDashboard,
  ListChecks,
  Lock,
  Megaphone,
  MessageCircle,
  Palette,
  PlayCircle,
  Receipt,
  Server,
  Shield,
  Smartphone,
  Sparkles,
  TrendingUp,
  TriangleAlert,
  UserCog,
  Users,
  Video,
  Wallet,
};

export function Icon({
  name,
  className,
}: {
  name: IconName;
  className?: string;
}) {
  const Cmp = ICONS[name];

  return <Cmp aria-hidden className={className} />;
}

/** The one horizontal rhythm on the site. Every section's content sits inside this. */
export function Container({
  children,
  className,
  wide = false,
}: {
  children: React.ReactNode;
  className?: string;
  /** The hero drawing and the feature grid get a little more room than running text. */
  wide?: boolean;
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-4 sm:px-8",
        wide ? "max-w-7xl" : "max-w-6xl",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Section({
  children,
  className,
  id,
  tone = "default",
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
  /** `muted` is the alternating cool band; `ink` is the deep navy brand ground with its lattice. */
  tone?: "default" | "muted" | "ink";
}) {
  return (
    <section
      id={id}
      className={cn(
        "relative py-16 sm:py-24",
        tone === "muted" && "border-border border-y bg-[oklch(0.972_0.007_255)]",
        tone === "ink" && "mk-ink overflow-hidden",
        // `scroll-mt` keeps an in-page anchor from landing under the sticky header.
        id && "scroll-mt-20",
        className,
      )}
    >
      {tone === "ink" ? <div aria-hidden className="mk-lattice" /> : null}
      <div className="relative">{children}</div>
    </section>
  );
}

/**
 * The small label above a section title: a pill with a gold dot. No uppercase and no
 * letter-spacing anywhere on this site — both are meaningless in Arabic and actively damage it
 * (Arabic has no case, and tracking pulls apart letters that are supposed to join).
 */
export function Eyebrow({
  children,
  onInk = false,
  className,
}: {
  children: React.ReactNode;
  onInk?: boolean;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-bold",
        onInk
          ? "text-gold border-white/15 bg-white/5"
          : "text-primary border-primary/15 bg-primary/[0.05]",
        className,
      )}
    >
      <span aria-hidden className="bg-gold size-1.5 rounded-full" />
      {children}
    </p>
  );
}

export function SectionHeading({
  head,
  align = "start",
  onInk = false,
  className,
}: {
  head: SectionHead;
  align?: "start" | "center";
  onInk?: boolean;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "max-w-2xl",
        align === "center" && "mx-auto text-center",
        className,
      )}
    >
      <Eyebrow onInk={onInk}>{head.eyebrow}</Eyebrow>
      <h2
        className={cn(
          "mt-4 text-3xl leading-[1.25] font-extrabold text-balance sm:text-4xl lg:text-[2.6rem]",
          onInk && "text-ink-foreground",
        )}
      >
        {head.title}
      </h2>
      {head.body ? (
        <p
          className={cn(
            "mt-4 text-base leading-relaxed text-pretty sm:text-lg",
            onInk ? "text-ink-foreground/75" : "text-muted-foreground",
          )}
        >
          {head.body}
        </p>
      ) : null}
    </header>
  );
}

const CTA_BASE =
  "inline-flex h-12 items-center justify-center gap-2 rounded-xl px-6 text-base font-bold transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:translate-y-px";

export const ctaClass = {
  primary: cn(
    CTA_BASE,
    "bg-primary text-primary-foreground shadow-[0_10px_24px_-12px_oklch(0.42_0.1_262/0.7)] hover:bg-primary/90",
  ),
  secondary: cn(
    CTA_BASE,
    "border-border bg-card text-foreground hover:bg-muted border",
  ),
  /** The loudest button on a navy band: gold with dark ink on it. */
  onInk: cn(
    CTA_BASE,
    "bg-gold text-gold-foreground shadow-[0_12px_28px_-12px_oklch(0.8_0.125_82/0.7)] hover:brightness-105 focus-visible:outline-gold",
  ),
  onInkGhost: cn(
    CTA_BASE,
    "text-ink-foreground border border-white/20 bg-white/5 hover:bg-white/10 focus-visible:outline-gold",
  ),
} as const;

/** A CTA that is always a real link to a real destination — the site has no dead buttons. */
export function CtaLink({
  href,
  children,
  variant = "primary",
  className,
}: {
  href: string;
  children: React.ReactNode;
  variant?: keyof typeof ctaClass;
  className?: string;
}) {
  // The login page leaves the marketing site, so it gets a full page load: marketing pages are
  // handed a trimmed message catalogue (app/layout.tsx), and a client-side hop would carry that
  // catalogue into the login screen, which then renders raw keys until a refresh.
  if (href === ROUTES.login) {
    return (
      <a href={href} className={cn(ctaClass[variant], className)}>
        {children}
      </a>
    );
  }

  return (
    <Link href={href} className={cn(ctaClass[variant], className)}>
      {children}
    </Link>
  );
}

/** A checked list item — the one place a tick mark appears, so it always means the same thing. */
export function CheckItem({
  children,
  onInk = false,
  className,
}: {
  children: React.ReactNode;
  onInk?: boolean;
  className?: string;
}) {
  return (
    <li className={cn("flex items-start gap-3", className)}>
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
          onInk ? "bg-gold/15 text-gold" : "bg-primary/10 text-primary",
        )}
      >
        <Check className="size-3.5" strokeWidth={3} />
      </span>
      <span
        className={cn(
          "leading-relaxed",
          onInk ? "text-ink-foreground/85" : "text-muted-foreground",
        )}
      >
        {children}
      </span>
    </li>
  );
}

/** A square icon tile: navy on a soft navy wash, or gold on the ink band. */
export function IconTile({
  name,
  onInk = false,
  className,
}: {
  name: IconName;
  onInk?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex size-11 shrink-0 items-center justify-center rounded-xl",
        onInk
          ? "text-gold bg-white/[0.07] ring-1 ring-white/10"
          : "text-primary bg-[linear-gradient(135deg,oklch(0.95_0.025_255),oklch(0.91_0.04_258))] ring-1 ring-[oklch(0.88_0.04_258)]",
        className,
      )}
    >
      <Icon name={name} className="size-5" />
    </span>
  );
}
