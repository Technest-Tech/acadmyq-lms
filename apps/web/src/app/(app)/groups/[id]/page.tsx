import { Suspense } from "react";
import { GroupScreen } from "./screen";

/**
 * One group's page (docs/groups). Wrapped in Suspense because the screen reads `?tab=` — the deep
 * link a freshly created group uses to land on its members.
 */
export default async function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <Suspense>
      <GroupScreen groupId={id} />
    </Suspense>
  );
}
