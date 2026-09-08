import { Suspense } from "react";
import { FinanceDealsScreen } from "./screen";

/** Super Admin → Finance → Deals. The screen reads `?status=&kind=&overdue=&client=` presets. */
export default function AdminFinanceDealsPage() {
  return (
    <Suspense>
      <FinanceDealsScreen />
    </Suspense>
  );
}
