import { apiBase } from "@/lib/api-base";
import type { LearnCourseCard, LearnSite, LearnSiteContent } from "@/lib/learn-api";

/**
 * Server-side loader for an academy's public-site content (docs/lms/09). The learner-site layout
 * calls this on every request, which is what lets each client's site have a real `<title>`, meta
 * description and OG image instead of the app's generic one — `generateMetadata` runs on the server,
 * so the content cannot come from the browser-only client in `lib/learn-api.ts`.
 *
 * Cached for a minute per academy: the site is public and read-mostly, and an editor save is not
 * worth paying a database round-trip on every page view of every tenant.
 */



/** Distinguishes "this academy does not exist" (⇒ 404 the page) from "the API blinked". */
export class UnknownAcademyError extends Error {}

export async function fetchLearnSite(academy: string): Promise<LearnSite> {
  let res: Response;
  try {
    res = await fetch(`${apiBase()}/api/learn/site`, {
      headers: { Accept: "application/json", "X-Academy": academy },
      next: { revalidate: 60, tags: [`learn-site:${academy}`] },
    });
  } catch {
    // API unreachable during a build or a transient blip — render the template on its own defaults
    // rather than taking every tenant's site down with it.
    return fallbackSite(academy);
  }

  if (res.status === 404) throw new UnknownAcademyError(academy);
  if (!res.ok) return fallbackSite(academy);

  return (await res.json()) as LearnSite;
}

/**
 * The published catalogue, on the server, for the same reason the site document is fetched there.
 *
 * The home page's hero previews the newest REAL course, and resolving that in the browser meant the
 * preview card painted a stand-in — the template's stock photo, or the client's own hero image —
 * and swapped it for the cover a beat later, on every single refresh. Fetched here, the first frame
 * already carries the right cover, title and lesson count.
 *
 * Cached for a minute per academy, like the site: a published catalogue is public and read-mostly.
 *
 * Returns null rather than throwing when the API is unreachable, because this is an ENHANCEMENT of
 * a page that can still fetch for itself — a blip should cost a slower first frame, not the whole
 * catalogue.
 */
export async function fetchLearnCatalog(
  academy: string,
): Promise<LearnCourseCard[] | null> {
  try {
    const res = await fetch(`${apiBase()}/api/learn/courses`, {
      headers: { Accept: "application/json", "X-Academy": academy },
      next: { revalidate: 60, tags: [`learn-catalog:${academy}`] },
    });
    if (!res.ok) return null;

    const body = (await res.json()) as { courses?: LearnCourseCard[] };
    return body.courses ?? [];
  } catch {
    return null;
  }
}

/**
 * A structurally complete, empty document. Every field the template reads exists; because blank
 * means "use the translated fallback", this still renders a coherent site — just an unbranded one.
 *
 * Note what `fallbackSite` does NOT do with it: it never fills the name with the subdomain handle.
 * An outage should degrade to neutral, translated copy, not publish an internal slug as the
 * academy's brand (see lib/learn-brand.ts).
 */
export function emptySiteContent(name = ""): LearnSiteContent {
  return {
    brand: {
      name,
      tagline: "",
      logo_url: "",
      logo_mark_url: "",
      favicon_url: "",
      color: "#12836a",
      hero_style: "gradient",
    },
    hero: {
      eyebrow: "",
      title: "",
      subtitle: "",
      image_url: "",
      primary_cta: "browse",
      cta_label: "",
      badges: [],
    },
    stats: { show: true, items: [] },
    about: {
      show: true,
      heading: "",
      body: "",
      image_url: "",
      points: [],
      mission: "",
      approach: "",
    },
    features: { show: true, heading: "", subheading: "", items: [] },
    steps: { show: true, heading: "", items: [] },
    instructors: { show: true, heading: "", items: [] },
    testimonials: { show: true, heading: "", items: [] },
    faq: { show: true, heading: "", items: [] },
    cta: { show: true, title: "", subtitle: "", button_label: "", button_href: "" },
    contact: {
      show: true,
      email: "",
      phone: "",
      whatsapp: "",
      address: "",
      hours: "",
      map_url: "",
      socials: {},
    },
    footer: { note: "", links: [] },
    seo: { title: "", description: "", og_image_url: "" },
    pages: { about: true, faq: true, contact: true },
    legal: {
      show: true,
      terms: "",
      refund: "",
      privacy: "",
      business_name: "",
      updated_at: "",
    },
  };
}

function fallbackSite(academy: string): LearnSite {
  return {
    site: emptySiteContent(""),
    stats: { courses: 0, lessons: 0, learners: 0, certificates: 0 },
    // Nothing is switched on: with the API unreachable we cannot know which doors are open, and a
    // Buy button offered on a guess strands the buyer. The template falls back to browsing.
    commerce: { free: false, free_course: null, checkout: false, codes: false, paid: false },
    academy: { name: "", subdomain: academy, url: null },
  };
}
