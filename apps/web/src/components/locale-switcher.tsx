"use client";

import { Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { LOCALE_COOKIE, locales, type Locale } from "@/i18n/config";

/**
 * Switches the active locale by writing the NEXT_LOCALE cookie (read by
 * next-intl on the server) and refreshing so server components re-render with
 * the new locale + direction. The choice persists across reloads (TC-0.13).
 */
export function LocaleSwitcher() {
  const active = useLocale();
  const t = useTranslations("locale");
  const router = useRouter();

  function switchTo(locale: Locale): void {
    document.cookie = `${LOCALE_COOKIE}=${locale};path=/;max-age=31536000;samesite=lax`;
    router.refresh();
  }

  return (
    <div className="flex items-center gap-1" role="group" aria-label="language">
      <Languages className="text-muted-foreground size-4" aria-hidden />
      {locales.map((locale) => (
        <Button
          key={locale}
          type="button"
          size="sm"
          variant={locale === active ? "default" : "ghost"}
          aria-pressed={locale === active}
          onClick={() => switchTo(locale)}
        >
          {t(locale)}
        </Button>
      ))}
    </div>
  );
}
