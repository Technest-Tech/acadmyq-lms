import { apiBase } from "@/lib/api-base";
import type { LearnSite, LearnSiteContent } from "@/lib/learn-api";

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
 * A structurally complete, empty document. Every field the template reads exists; because blank
 * means "use the translated fallback", this still renders a coherent site — just an unbranded one.
 */
export function emptySiteContent(name = ""): LearnSiteContent {
  return {
    brand: { name, tagline: "", logo_url: "", color: "#12836a", hero_style: "gradient" },
    hero: { eyebrow: "", title: "", subtitle: "", image_url: "", primary_cta: "browse", badges: [] },
    stats: { show: true, items: [] },
    about: { show: true, heading: "", body: "", image_url: "", points: [] },
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
      map_url: "",
      socials: {},
    },
    footer: { note: "", links: [] },
    seo: { title: "", description: "", og_image_url: "" },
    pages: { about: true, faq: true, contact: true },
  };
}

function fallbackSite(academy: string): LearnSite {
  return {
    site: emptySiteContent(academy),
    stats: { courses: 0, lessons: 0, learners: 0, certificates: 0 },
    academy: { name: academy, subdomain: academy },
  };
}
