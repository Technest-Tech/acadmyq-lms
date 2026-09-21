import { FamilyProfileScreen } from "./screen";

/**
 * A family's file. Same authenticated shell as the rest of the app; the screen is permission-
 * gated client-side (guardian.read) and the API enforces it for real.
 */
export default async function FamilyProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <FamilyProfileScreen guardianId={id} />;
}
