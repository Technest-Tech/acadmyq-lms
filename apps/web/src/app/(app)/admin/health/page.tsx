import { Suspense } from "react";
import { SystemHealthScreen } from "./screen";

/**
 * Super Admin → System health: which clients need stepping in for, and whether the machine behind
 * them is running (cron, queue, scheduled tasks, WhatsApp gateway). Gated client-side
 * (platform.manage) and server-side (the controller's Gate, and the SECURITY DEFINER reader
 * re-asserts SUPER_ADMIN).
 */
export default function AdminHealthPage() {
  // The screen reads its open tab from `?tab=`, which needs a Suspense boundary above it.
  return (
    <Suspense fallback={null}>
      <SystemHealthScreen />
    </Suspense>
  );
}
