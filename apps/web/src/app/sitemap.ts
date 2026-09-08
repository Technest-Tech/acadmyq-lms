import type { MetadataRoute } from "next";
import { absoluteUrl, ROUTES } from "@/content/marketing";

/**
 * The marketing sitemap — the six public pages, and nothing else.
 *
 * Deliberately not generated from the route tree: everything under `(app)` is behind a login and
 * every `/learn/[academy]` page belongs to a client's own site on their own host, so neither has
 * any business in the platform's sitemap.
 *
 * One url per page, because this app serves both languages from a single url and switches on the
 * `NEXT_LOCALE` cookie — there is no `/ar` or `/en` variant to list.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  return [
    { url: absoluteUrl(ROUTES.home), lastModified: now, changeFrequency: "monthly", priority: 1 },
    {
      url: absoluteUrl(ROUTES.coursePlatform),
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.9,
    },
    {
      url: absoluteUrl(ROUTES.academyManagement),
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.9,
    },
    {
      url: absoluteUrl(ROUTES.contact),
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.7,
    },
    {
      url: absoluteUrl(ROUTES.privacy),
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: absoluteUrl(ROUTES.terms),
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
