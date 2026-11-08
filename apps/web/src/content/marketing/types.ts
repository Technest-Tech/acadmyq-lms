import type { ProductInterest } from "./site";

/**
 * The shape of the whole public marketing site, in one type.
 *
 * Every word a visitor reads lives in `ar.ts` / `en.ts` and nowhere else; the page components take
 * a `MarketingContent` and lay it out. That is the point of this file — because the type is shared,
 * a section added to Arabic and forgotten in English is a compile error rather than a live page
 * with a hole in it, and a marketing edit never means opening a component.
 *
 * Icons travel as lucide NAMES, not components, so the content modules stay plain data (no JSX, no
 * imports from the component tree) and can be read start to finish as copy.
 */

/** Lucide icon names the marketing pages may render. Widening this is a one-line change. */
export type IconName =
  | "Award"
  | "BellRing"
  | "BookOpen"
  | "CalendarDays"
  | "CircleCheck"
  | "ClipboardCheck"
  | "Contact"
  | "CreditCard"
  | "FileText"
  | "Files"
  | "Globe"
  | "GraduationCap"
  | "HandCoins"
  | "History"
  | "KeyRound"
  | "Languages"
  | "LayoutDashboard"
  | "ListChecks"
  | "Lock"
  | "Megaphone"
  | "MessageCircle"
  | "Palette"
  | "PlayCircle"
  | "Receipt"
  | "Server"
  | "Shield"
  | "Smartphone"
  | "Sparkles"
  | "TrendingUp"
  | "TriangleAlert"
  | "UserCog"
  | "Users"
  | "Video"
  | "Wallet";

/** A real screenshot of the product. `src` is a file under `public/marketing/`. */
export interface Shot {
  src: string;
  /** Intrinsic pixel size of the capture — reserved by the layout so nothing shifts on load. */
  width: number;
  height: number;
  /** Describes what the screen SHOWS, for a reader who cannot see it. Never "screenshot of …". */
  alt: string;
  /** Printed under the image. One line; says what the reader is looking at. */
  caption: string;
}

export interface Feature {
  icon: IconName;
  title: string;
  body: string;
}

export interface Step {
  title: string;
  body: string;
}

export interface QA {
  q: string;
  a: string;
}

export interface Cta {
  label: string;
  href: string;
}

export interface Hero {
  title: string;
  /** Rendered in the brand colour on its own line — the one emphasis in the headline. */
  titleAccent?: string;
  subtitle: string;
  primary: Cta;
  secondary?: Cta;
  /** Short, checkable facts under the buttons. Three at most; they wrap badly beyond that. */
  points: string[];
}

export interface SectionHead {
  eyebrow: string;
  title: string;
  body?: string;
}

/**
 * A stock photograph (Unsplash licence, files under `public/marketing/photos/`). Used only for
 * PEOPLE AND PLACES: who the product is for and what their day looks like. A photograph never
 * stands in for a screen of the product; those are drawn (`HeroDemo`, `FeatureTiles`) or captured.
 */
export interface Photo {
  src: string;
  width: number;
  height: number;
  alt: string;
}

/** One kind of academy the homepage speaks to, with its photograph. */
export interface AudienceCard {
  photo: Photo;
  tag: string;
  title: string;
  body: string;
  points: string[];
}

/** A step of "a day in your academy": when it happens, what the system does. */
export interface DayStep {
  icon: IconName;
  time: string;
  title: string;
  body: string;
}

/** One billable module on the homepage's modules grid. */
export interface ModuleCard {
  icon: IconName;
  name: string;
  /** "The core" for management, "add-on" for the rest. */
  tag: string;
  body: string;
  points: string[];
  cta?: Cta;
}

/** A lesson as the drawn dashboard shows it. */
export type DemoLessonState = "done" | "live" | "next";

/**
 * Every word drawn INSIDE the hero's product picture. The picture is markup, not an image, so it is
 * translated like the rest of the page and stays sharp; the figures in it are sample data, and the
 * picture's `alt` says it is an example.
 */
export interface HeroDemo {
  alt: string;
  url: string;
  academy: string;
  nav: string[];
  hello: string;
  helloSub: string;
  kpis: { label: string; value: string; delta: string }[];
  chartTitle: string;
  chartMonths: string[];
  todayTitle: string;
  lessons: { time: string; who: string; teacher: string; state: DemoLessonState }[];
  states: Record<DemoLessonState, string>;
  whatsapp: { app: string; text: string; time: string };
  payment: { title: string; body: string };
  marked: { title: string; body: string };
}

export type DemoAttendance = "present" | "absent" | "pending";

/** The small drawn screens inside the feature grid. Same rule as `HeroDemo`: sample data. */
export interface FeatureTiles {
  schedule: FeatureTile & {
    demo: {
      days: string[];
      /** `day` indexes `days`; `row` is the hour band (0–2). */
      blocks: { day: number; row: number; label: string; tone: "navy" | "gold" | "sky" }[];
      rows: { name: string; time: string; state: DemoAttendance }[];
      states: Record<DemoAttendance, string>;
    };
  };
  whatsapp: FeatureTile & {
    demo: {
      contact: string;
      status: string;
      messages: { text: string; time: string }[];
    };
  };
  money: FeatureTile & {
    demo: {
      title: string;
      number: string;
      lines: { label: string; value: string }[];
      totalLabel: string;
      total: string;
      duesTitle: string;
      dues: { name: string; value: string; late: boolean }[];
      lateLabel: string;
    };
  };
  portal: FeatureTile & {
    demo: {
      greeting: string;
      child: string;
      nextLabel: string;
      next: string;
      balanceLabel: string;
      balance: string;
      lessonsTitle: string;
      lessons: { date: string; state: string }[];
      pay: string;
    };
  };
  payroll: FeatureTile & {
    demo: {
      teacher: string;
      month: string;
      lines: { label: string; value: string }[];
      totalLabel: string;
      total: string;
      types: string[];
    };
  };
  reports: FeatureTile & {
    demo: {
      title: string;
      student: string;
      rows: { label: string; stars: number }[];
      note: string;
    };
  };
}

export interface FeatureTile {
  tag: string;
  title: string;
  body: string;
}

export interface HomeContent {
  hero: Hero & {
    /** The pill above the headline: what this is, in a few words. */
    badge: string;
  };
  heroDemo: HeroDemo;
  /** The academy types strip directly under the hero. */
  builtFor: { label: string; items: string[] };
  audiences: {
    head: SectionHead;
    items: AudienceCard[];
  };
  problem: {
    head: SectionHead;
    photo: Photo;
    beforeTitle: string;
    afterTitle: string;
    pairs: { before: string; after: string }[];
  };
  features: {
    head: SectionHead;
    tiles: FeatureTiles;
    more: { title: string; body: string; items: string[] };
  };
  day: {
    head: SectionHead;
    steps: DayStep[];
  };
  modules: {
    head: SectionHead;
    items: ModuleCard[];
  };
  foundation: {
    head: SectionHead;
    items: Feature[];
  };
  faq: {
    head: SectionHead;
    items: QA[];
  };
  close: {
    title: string;
    body: string;
    points: string[];
  };
}

export interface AudienceGroup {
  title: string;
  items: string[];
}

/**
 * How a product is priced on its page. Two shapes, because the two products genuinely are priced
 * differently and pretending otherwise is how a "starting from" number that nobody honours gets
 * onto a page: the Course Platform has ONE published annual offer, while an academy's subscription
 * depends on its size and the modules it runs, so its page asks for a conversation instead.
 */
export type PricingContent =
  | ({ kind: "published" } & PublishedPricing)
  | ({ kind: "quote" } & QuotePricing);

export interface PublishedPricing {
  eyebrow: string;
  title: string;
  body: string;
  firstYearLabel: string;
  firstYearNote: string;
  renewalLabel: string;
  renewalNote: string;
  includesHeading: string;
  includes: string[];
  /** The plain statement that this is a subscription to a hosted service, not a sale of software. */
  ownership: string;
  cta: Cta;
}

export interface QuotePricing {
  eyebrow: string;
  title: string;
  body: string;
  includesHeading: string;
  includes: string[];
  note: string;
  cta: Cta;
}

export interface ProductPageContent {
  hero: Hero;
  audience: {
    head: SectionHead;
    groups: AudienceGroup[];
  };
  /** The learner-facing (or staff-facing) walkthrough — the screenshot-led spine of the page. */
  tour: {
    head: SectionHead;
    shots: Shot[];
  };
  capabilities: {
    head: SectionHead;
    items: Feature[];
  };
  workflow: {
    head: SectionHead;
    steps: Step[];
  };
  pricing: PricingContent;
  faq: {
    head: SectionHead;
    items: QA[];
  };
  close: {
    title: string;
    body: string;
    primary: Cta;
  };
}

export interface FormContent {
  title: string;
  body: string;
  fields: {
    name: string;
    namePlaceholder: string;
    email: string;
    emailHint: string;
    phone: string;
    phonePlaceholder: string;
    country: string;
    countryPlaceholder: string;
    product: string;
    productOptions: Record<ProductInterest, string>;
    role: string;
    rolePlaceholder: string;
    message: string;
    messagePlaceholder: string;
    consent: string;
    optional: string;
  };
  submit: string;
  submitting: string;
  success: {
    title: string;
    body: string;
    again: string;
  };
  errors: {
    /** Shown above the form when the server refuses the submission as a whole. */
    generic: string;
    rateLimited: string;
    network: string;
    /** Per-field messages, keyed by the field name the server validates. */
    name: string;
    phone: string;
    email: string;
    product: string;
    consent: string;
  };
}

/** A legal page: a title, a last-updated line, and ordered sections of plain paragraphs. */
export interface LegalContent {
  title: string;
  intro: string;
  updatedLabel: string;
  sections: { heading: string; paragraphs: string[] }[];
}

export interface PageMeta {
  title: string;
  description: string;
}

export interface MarketingContent {
  brand: {
    name: string;
    /** Read by screen readers on the home link in the header. */
    homeLabel: string;
  };
  nav: {
    /** Accessible name for the header's navigation landmarks. */
    primaryLabel: string;
    /** The keyboard-only link that jumps past the header straight to the page content. */
    skipToContent: string;
    /** The homepage's feature grid (`/#features`). */
    features: string;
    coursePlatform: string;
    academyManagement: string;
    pricing: string;
    contact: string;
    login: string;
    demo: string;
    openMenu: string;
    closeMenu: string;
    language: string;
  };
  footer: {
    tagline: string;
    productsHeading: string;
    companyHeading: string;
    legalHeading: string;
    contactHeading: string;
    rights: string;
    /** "© {year} Acadmyq." is assembled at render time; the year is never written down here. */
    emailLabel: string;
    phoneLabel: string;
    whatsappLabel: string;
  };
  meta: {
    home: PageMeta;
    coursePlatform: PageMeta;
    academyManagement: PageMeta;
    contact: PageMeta;
    privacy: PageMeta;
    terms: PageMeta;
  };
  home: HomeContent;
  coursePlatform: ProductPageContent;
  academyManagement: ProductPageContent;
  contact: {
    hero: { title: string; subtitle: string };
    expect: { title: string; items: string[] };
    reach: { title: string; body: string };
  };
  form: FormContent;
  privacy: LegalContent;
  terms: LegalContent;
  /** Country names in this locale, for the form's select. Falls back to the English name. */
  countryNames: Record<string, string>;
}
