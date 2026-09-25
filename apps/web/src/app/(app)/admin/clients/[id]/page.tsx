import { Suspense } from "react";
import { ClientScreen } from "./screen";

export default async function ClientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // The screen reads its open tab from `?tab=`, which needs a Suspense boundary above it.
  return (
    <Suspense fallback={null}>
      <ClientScreen clientId={id} />
    </Suspense>
  );
}
