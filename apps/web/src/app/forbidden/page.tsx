import { StatusPage } from "@/components/status-page";

/**
 * The 403 surface (AC-9.11). Reached when a user lands on something they may not access;
 * distinct from the 402 "upgrade" upsell (a plan gate) and the 404 not-found.
 */
export default function ForbiddenPage() {
  return <StatusPage variant="forbidden" />;
}
