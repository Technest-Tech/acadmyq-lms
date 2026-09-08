import { fetchLearnCatalog } from "@/lib/learn-server";
import { SiteHome } from "./home-screen";

/**
 * The landing page's server half (docs/lms/09): it loads the published catalogue before the page is
 * sent, and hands it to the client screen that renders everything.
 *
 * That is the whole job, and it exists for one visible reason. The hero's preview card shows the
 * newest real course; with the catalogue resolved in the browser it had nothing to show on the
 * first frame, so it painted the template's stock photo and swapped it for the real cover a beat
 * later — a flash on every refresh. The layout already fetches the site document on the server for
 * exactly this reason (no unbranded header flash); the catalogue now follows it.
 */
export default async function SiteHomePage({
  params,
}: {
  params: Promise<{ academy: string }>;
}) {
  const { academy } = await params;
  const courses = await fetchLearnCatalog(academy);

  return <SiteHome initialCourses={courses} />;
}
