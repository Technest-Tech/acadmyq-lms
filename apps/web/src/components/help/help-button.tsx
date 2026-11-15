"use client";

import { CircleHelp } from "lucide-react";
import { useTranslations } from "next-intl";
import { useHelp } from "@/components/help/help-provider";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * The header's "?" — the help for the page being looked at.
 *
 * It carries its words from `lg` up ("Explain this page"): the people this is for are the ones who
 * would not guess what a bare question mark does. A gold dot marks a page whose help this person
 * has never opened; it goes the first time they do, and never comes back for that page.
 */
export function HelpButton({ modern }: { modern: boolean }) {
  const t = useTranslations("help");
  const { openHelp, pageTopic, unseen } = useHelp();

  return (
    <Tooltip content={t("button")} side="bottom">
      <button
        type="button"
        data-testid="header-help"
        data-has-topic={pageTopic !== null}
        aria-label={t("button")}
        onClick={() => openHelp()}
        className={cn(
          "text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring/50 relative flex shrink-0 items-center gap-1.5 transition-colors outline-none focus-visible:ring-2",
          modern ? "h-10 min-w-10 justify-center rounded-xl lg:px-3" : "rounded-lg p-2 lg:px-2.5",
          pageTopic !== null && "lg:text-foreground lg:ring-border lg:ring-1",
        )}
      >
        <CircleHelp className={modern ? "size-5" : "size-4"} aria-hidden />
        {pageTopic !== null && (
          <span className={cn("hidden font-semibold lg:inline", modern ? "text-sm" : "text-[13px]")}>
            {t("button")}
          </span>
        )}
        {unseen && (
          <span
            data-testid="header-help-dot"
            aria-hidden
            className="bg-gold ring-card absolute -end-0.5 -top-0.5 size-2.5 rounded-full ring-2"
          />
        )}
      </button>
    </Tooltip>
  );
}
