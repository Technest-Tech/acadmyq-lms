import { AccountScreen } from "./screen";

/** Super Admin → Accounts → one account (a client off our servers; a platform client's lives on its client page). */
export default async function AdminAccountPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <AccountScreen clientId={id} />;
}
