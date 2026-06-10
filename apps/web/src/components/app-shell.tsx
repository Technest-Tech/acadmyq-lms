"use client";

import {
  Building2,
  CalendarDays,
  GraduationCap,
  LayoutDashboard,
  Menu,
  ReceiptText,
  Settings,
  Users,
  Wallet,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type ComponentType } from "react";
import { Button } from "@/components/ui/button";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { cn } from "@/lib/utils";

type NavKey =
  | "dashboard"
  | "academies"
  | "students"
  | "teachers"
  | "schedule"
  | "invoices"
  | "payroll"
  | "settings";

const NAV: ReadonlyArray<{ key: NavKey; icon: ComponentType<{ className?: string }> }> = [
  { key: "dashboard", icon: LayoutDashboard },
  { key: "academies", icon: Building2 },
  { key: "students", icon: GraduationCap },
  { key: "teachers", icon: Users },
  { key: "schedule", icon: CalendarDays },
  { key: "invoices", icon: ReceiptText },
  { key: "payroll", icon: Wallet },
  { key: "settings", icon: Settings },
];

/**
 * Static (unauthenticated) app shell: collapsible sidebar + header. Bilingual,
 * RTL-aware via CSS logical properties + the <html dir> set in the root layout.
 * On mobile the sidebar is an off-canvas drawer; from `md` up it is docked.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-background flex min-h-dvh w-full overflow-x-hidden">
      {/* Mobile backdrop */}
      {open && (
        <div
          className="bg-foreground/40 fixed inset-0 z-20 md:hidden"
          aria-hidden
          onClick={() => setOpen(false)}
        />
      )}

      <aside
        data-testid="sidebar"
        data-open={open}
        className={cn(
          "bg-sidebar text-sidebar-foreground fixed inset-y-0 z-30 flex w-64 shrink-0 flex-col border-e p-4 transition-transform md:static md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full rtl:translate-x-full md:translate-x-0",
        )}
      >
        <div className="mb-6 flex items-center gap-2 px-2">
          <GraduationCap className="text-primary size-6" aria-hidden />
          <span className="text-lg font-semibold">{t("app.name")}</span>
        </div>
        <nav className="flex flex-col gap-1">
          {NAV.map(({ key, icon: Icon }) => (
            <a
              key={key}
              href="#"
              className="hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex items-center gap-3 rounded-md px-3 py-2 text-sm"
            >
              <Icon className="size-4" aria-hidden />
              <span>{t(`nav.${key}`)}</span>
            </a>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-background flex h-14 items-center justify-between gap-3 border-b px-4">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="md:hidden"
              aria-label={t("header.menu")}
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              <Menu className="size-5" aria-hidden />
            </Button>
            <span className="text-muted-foreground hidden text-sm sm:inline">
              {t("app.tagline")}
            </span>
          </div>
          <LocaleSwitcher />
        </header>

        <main className="min-w-0 flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
