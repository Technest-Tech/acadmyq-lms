import { StaffDetailSkeleton } from "@/components/staff/staff-detail";

/**
 * Shown the instant a staff row is clicked, while Next fetches this segment — without it the
 * list froze for as long as the navigation took, with nothing on screen to say why.
 */
export default function StaffDetailLoading() {
  return <StaffDetailSkeleton />;
}
