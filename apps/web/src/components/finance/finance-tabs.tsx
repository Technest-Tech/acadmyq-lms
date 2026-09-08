"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "overview", href: "/admin/finance" },
  { key: "deals", href: "/admin/finance/deals" },
  { key: "payments", href: "/admin/finance/payments" },
  { key: "clients", href: "/admin/finance/clients" },
] as const;

/**
 * The finance section's own navigation. One sidebar entry ("Finance") opens the overview; the
 * four screens are tabs of that one section rather than four sidebar items, because they are
 * four views of the same book — and the sidebar is already the owner's most-used real estate.
 */
export function FinanceTabs() {
  const t = useTranslations("finance.tabs");
  const pathname = usePathname();

  return (
    <nav
      className="bg-muted/50 inline-flex flex-wrap gap-1 rounded-xl p-1"
      aria-label="Finance"
    >
      {TABS.map((tab) => {
        const active =
          tab.href === "/admin/finance"
            ? pathname === tab.href
            : pathname.startsWith(tab.href);

        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
              active
                ? "bg-card text-foreground shadow-sm ring-1 ring-foreground/[0.06]"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(tab.key)}
          </Link>
        );
      })}
    </nav>
  );
}
