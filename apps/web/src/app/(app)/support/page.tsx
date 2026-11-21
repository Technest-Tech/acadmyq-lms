import { SupportScreen } from "./screen";

/**
 * الدعم والطلبات — the academy's problems and change requests and where each one stands.
 * Gated client-side by support.manage; every /api/support route enforces it and names the academy.
 */
export default function SupportRoute() {
  return <SupportScreen />;
}
