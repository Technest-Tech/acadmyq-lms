"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
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
  compact = false,
}: {
  onSwitch?: (locale: Locale) => void | Promise<void>;
  /**
   * One button naming the OTHER language (`EN` / `ع`) instead of the two-segment pill — for a
   * phone-width header, where the pill alone is a third of the bar.
   */
  compact?: boolean;
}) {
  const active = useLocale();
  const t = useTranslations("locale");
  const router = useRouter();

  function switchTo(locale: Locale): void {
    document.cookie = `${LOCALE_COOKIE}=${locale};path=/;max-age=31536000;samesite=lax`;
    void Promise.resolve(onSwitch?.(locale)).catch(() => {});
    router.refresh();
  }

  if (compact) {
    const other = locales.find((locale) => locale !== active) ?? locales[0];
    return (
      <button
        type="button"
        onClick={() => switchTo(other)}
        aria-label={t(other)}
        lang={other}
        className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring/50 flex size-8 items-center justify-center rounded-lg text-[12px] font-bold transition-colors outline-none focus-visible:ring-2"
      >
        {other === "ar" ? "ع" : "EN"}
      </button>
    );
  }

  return (
    <div
      className="bg-muted/70 flex items-center gap-0.5 rounded-lg p-0.5"
      role="group"
      aria-label="language"
    >
      {locales.map((locale) => {
        const isActive = locale === active;
        return (
          <button
            key={locale}
            type="button"
            aria-pressed={isActive}
            onClick={() => switchTo(locale)}
            className={cn(
              "rounded-md px-2.5 py-1 text-[11px] font-semibold tracking-wide transition-all duration-150 uppercase",
              isActive
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(locale)}
          </button>
        );
      })}
    </div>
  );
}
