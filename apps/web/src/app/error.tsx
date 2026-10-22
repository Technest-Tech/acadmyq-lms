"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { StatusPage } from "@/components/status-page";
import { reportClientError } from "@/lib/api";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errors");

  // The page only says "500"; the cause would die with the tab. Send it to the server log once.
  useEffect(() => {
    reportClientError({
      message: `${error.name}: ${error.message}`.slice(0, 2000),
      stack: error.stack?.slice(0, 20000),
      digest: error.digest,
      path: window.location.pathname + window.location.search,
    }).catch(() => {});
  }, [error]);

  return (
    <StatusPage
      variant="server"
      action={
        <Button type="button" onClick={() => reset()}>
          {t("tryAgain")}
        </Button>
      }
    />
  );
}
