"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { StatusPage } from "@/components/status-page";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations("errors");
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
