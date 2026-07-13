"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { AttendanceReport } from "@/components/attendance/attendance-report";
import { useAuth } from "@/components/auth-provider";

/**
 * Client gate for the session attendance/report screen: rendered only when the session grants
 * `session.read`. The API enforces the real boundary (a Teacher may act on their own sessions
 * only); this is the UX gate.
 */
export function SessionScreen({ sessionId }: { sessionId: string }) {
  const t = useTranslations("attendance");
  const { can } = useAuth();
  const [error, setError] = useState<string | null>(null);

  if (!can("session.read")) {
    return <p className="text-muted-foreground text-sm">{t("noPermission")}</p>;
  }

  return (
    <div className="mx-auto max-w-2xl">
      {error && (
        <p className="text-destructive mb-3 text-sm" role="alert">
          {error}
        </p>
      )}
      <AttendanceReport
        sessionId={sessionId}
        onError={setError}
        onChange={() => setError(null)}
      />
    </div>
  );
}
