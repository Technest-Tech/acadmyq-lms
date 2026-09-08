import {
  Award,
  BookOpen,
  CalendarDays,
  CircleCheck,
  ClipboardCheck,
  CreditCard,
  FileText,
  Files,
  Globe,
  GraduationCap,
  History,
  KeyRound,
  Languages,
  LayoutDashboard,
  ListChecks,
  Lock,
  Palette,
  PlayCircle,
  Receipt,
  Server,
  Shield,
  Smartphone,
  Sparkles,
  TrendingUp,
  UserCog,
  Users,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import type { IconName, SectionHead } from "@/content/marketing";
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
  BookOpen,
  CalendarDays,
  CircleCheck,
  ClipboardCheck,
  CreditCard,
  FileText,
  Files,
  Globe,
  GraduationCap,
  History,
  KeyRound,
  Languages,
  LayoutDashboard,
  ListChecks,
  Lock,
  Palette,
  PlayCircle,
  Receipt,
  Server,
  Shield,
  Smartphone,
  Sparkles,
  TrendingUp,
  UserCog,
  Users,
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
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-6xl px-5 sm:px-8", className)}>
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
  /** `muted` is the alternating band; `ink` is the one deep brand ground. */
  tone?: "default" | "muted" | "ink";
}) {
  return (
    <section
      id={id}
      className={cn(
        "py-16 sm:py-24",
        tone === "muted" && "bg-muted/60 border-border border-y",
        tone === "ink" && "bg-ink text-ink-foreground",
        // `scroll-mt` keeps an in-page anchor from landing under the sticky header.
        id && "scroll-mt-20",
        className,
      )}
    >
      {children}
    </section>
  );
}

/**
 * The small label above a section title. No uppercase and no letter-spacing anywhere on this site:
 * both are meaningless in Arabic and actively damage it (Arabic has no case, and tracking pulls
 * apart letters that are supposed to join). The mark before it does the work instead.
 */
export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-primary flex items-center gap-2 text-sm font-semibold">
      <span aria-hidden className="bg-accent h-4 w-1 rounded-full" />
      {children}
    </p>
  );
}

export function SectionHeading({
  head,
  align = "start",
  onInk = false,
}: {
  head: SectionHead;
  align?: "start" | "center";
  onInk?: boolean;
}) {
  return (
    <header
      className={cn(
        "max-w-2xl",
        align === "center" && "mx-auto text-center",
        align === "center" && "[&>p:first-child]:justify-center",
      )}
    >
      <Eyebrow>{head.eyebrow}</Eyebrow>
      <h2
        className={cn(
          "mt-3 text-3xl font-bold text-balance sm:text-4xl",
          onInk && "text-ink-foreground",
        )}
      >
        {head.title}
      </h2>
      {head.body ? (
        <p
          className={cn(
            "text-muted-foreground mt-4 text-base leading-relaxed sm:text-lg",
            onInk && "text-ink-foreground/75",
          )}
        >
          {head.body}
        </p>
      ) : null}
    </header>
  );
}

const CTA_BASE =
  "inline-flex h-12 items-center justify-center gap-2 rounded-xl px-6 text-base font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export const ctaClass = {
  primary: cn(CTA_BASE, "bg-primary text-primary-foreground hover:bg-primary/90"),
  secondary: cn(
    CTA_BASE,
    "border-border bg-card text-foreground hover:bg-muted border",
  ),
  onInk: cn(
    CTA_BASE,
    "bg-ink-foreground text-ink hover:bg-ink-foreground/90",
  ),
  onInkGhost: cn(
    CTA_BASE,
    "border-ink-foreground/25 text-ink-foreground hover:bg-ink-foreground/10 border",
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
}: {
  children: React.ReactNode;
  onInk?: boolean;
}) {
  return (
    <li className="flex items-start gap-3">
      <CircleCheck
        aria-hidden
        className={cn(
          "mt-0.5 size-5 shrink-0",
          onInk ? "text-ink-foreground/70" : "text-primary",
        )}
      />
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
