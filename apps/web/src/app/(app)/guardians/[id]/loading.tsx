import { FamilyProfileSkeleton } from "@/components/guardians/family-profile";

/**
 * Shown the instant a family card is clicked, while Next fetches this segment — otherwise the
 * board simply freezes for the length of the navigation with no signal that anything happened.
 */
export default function FamilyProfileLoading() {
  return <FamilyProfileSkeleton />;
}
