import { FinanceDealScreen } from "./screen";

export default async function AdminFinanceDealPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <FinanceDealScreen dealId={id} />;
}
