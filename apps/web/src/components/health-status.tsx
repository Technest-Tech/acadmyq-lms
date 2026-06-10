"use client";

import type { HealthResponse } from "@academiq/contracts";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getHealth } from "@/lib/api";

/**
 * Proves the decoupled architecture's cross-origin + credentials path
 * (AC-0.10 / TC-0.20): calls GET /api/health through lib/api.ts and renders it.
 */
export function HealthStatus() {
  const t = useTranslations("health");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    getHealth()
      .then(setHealth)
      .catch(() => setFailed(true));
  }, []);

  return (
    <Card className="max-w-sm">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 text-sm">
        {!health && !failed && <p>{t("checking")}</p>}
        {failed && <p className="text-destructive">{t("error")}</p>}
        {health && (
          <dl className="grid grid-cols-2 gap-1">
            <dt className="text-muted-foreground">{t("app")}</dt>
            <dd>{health.app === "ok" ? t("ok") : t("error")}</dd>
            <dt className="text-muted-foreground">{t("db")}</dt>
            <dd
              className={health.db === "ok" ? "text-primary" : "text-destructive"}
            >
              {health.db === "ok" ? t("ok") : t("error")}
            </dd>
            <dt className="text-muted-foreground">{t("version")}</dt>
            <dd>{health.version}</dd>
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
