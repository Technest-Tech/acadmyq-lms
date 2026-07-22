import type { ReactNode } from "react";
import { LearnProvider } from "./learn-provider";

export default async function LearnLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ academy: string }>;
}) {
  const { academy } = await params;
  return <LearnProvider academy={academy}>{children}</LearnProvider>;
}
