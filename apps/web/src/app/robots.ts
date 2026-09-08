import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/content/marketing";

/**
 * `/robots.txt`.
 *
 * The public marketing pages and every client's course site are crawlable — a client's catalogue
 * being findable is part of what they are paying for. What is disallowed is everything that is
 * either private or addressed by an unguessable token:
 *
 *  - the signed-in application (also `noindex` at the `(app)` layout, since a crawler that follows
 *    a link into it lands on a login page rather than a 404);
 *  - the token links — a public invoice, an academy's bill, a video room, a WhatsApp connect page.
 *    These are secret URLs, and a secret URL in an index is not secret.
 *
 * One file serves every host this app answers on, so the rules are written as paths that mean the
 * same thing on the platform host and on a client subdomain.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/admin",
        "/dashboard",
        "/students",
        "/guardians",
        "/teachers",
        "/staff",
        "/sessions",
        "/calendar",
        "/attendance",
        "/invoices",
        "/payroll",
        "/packages",
        "/notifications",
        "/audit",
        "/roles",
        "/settings",
        "/crm",
        "/lms",
        "/trials",
        "/certificates",
        "/discounts-awards",
        "/financial-statistics",
        "/student-reports",
        "/student-report-reviews",
        "/teacher-quality",
        "/video-classroom",
        "/forbidden",
        // Learner-private pages on a client's course site.
        "/me",
        "/watch/",
        "/checkout/",
        "/orders",
        // Token-addressed public links: the URL is the credential.
        "/i/",
        "/a/",
        "/r/",
        "/wa-connect/",
      ],
    },
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
