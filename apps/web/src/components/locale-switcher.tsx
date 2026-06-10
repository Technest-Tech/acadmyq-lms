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
 *
 * When authenticated, `onSwitch` is also invoked so the choice is persisted on
 * the user's row (PATCH /auth/locale) and survives the next login (Sprint 2
 * AC-2.11). Persistence is best-effort: a failure never blocks the UI flip.
 */
export function LocaleSwitcher({
  onSwitch,
}: {
  onSwitch?: (locale: Locale) => void | Promise<void>;
}) {
  const active = useLocale();
  const t = useTranslations("locale");
  const router = useRouter();

  function switchTo(locale: Locale): void {
    document.cookie = `${LOCALE_COOKIE}=${locale};path=/;max-age=31536000;samesite=lax`;
    void Promise.resolve(onSwitch?.(locale)).catch(() => {});
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
