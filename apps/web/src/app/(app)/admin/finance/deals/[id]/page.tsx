import { redirect } from "next/navigation";

/** /admin/finance/deals/[id] moved to /admin/accounts/deals/[id] (Accounts, 2026-11-08). */
export default async function RetiredDealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/admin/accounts/deals/${id}`);
}
