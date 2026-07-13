import { ClientScreen } from "./screen";

export default async function ClientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <ClientScreen clientId={id} />;
}
