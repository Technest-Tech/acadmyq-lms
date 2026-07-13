"use client";

import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme, type Theme } from "@/components/theme-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const OPTIONS: ReadonlyArray<{
  value: Theme;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { value: "light", icon: Sun },
  { value: "dark", icon: Moon },
  { value: "system", icon: Monitor },
];

export function ThemeToggle() {
  const t = useTranslations("theme");
  const { theme, resolved, setTheme } = useTheme();

  // The trigger shows what's on screen (resolved), not what was chosen — on `system` a moon icon
  // over a dark page is the honest signal; a monitor icon would say nothing about the current look.
  const TriggerIcon = resolved === "dark" ? Moon : Sun;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <button
          type="button"
          aria-label={t("label")}
          data-testid="theme-toggle"
          className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring/50 rounded-lg p-2 transition-colors outline-none focus-visible:ring-2"
        >
          <TriggerIcon className="size-4" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-40">
        {OPTIONS.map(({ value, icon: Icon }) => (
          <DropdownMenuItem key={value} onClick={() => setTheme(value)}>
            <Icon aria-hidden />
            <span className="flex-1">{t(value)}</span>
            <Check
              className={cn(
                "text-primary size-3.5",
                theme === value ? "opacity-100" : "opacity-0",
              )}
              aria-hidden
            />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
