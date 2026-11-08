"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "dues", href: "/admin/accounts" },
  { key: "contracts", href: "/admin/accounts/contracts" },
  { key: "payments", href: "/admin/accounts/payments" },
  { key: "settings", href: "/admin/accounts/settings" },
] as const;

/**
 * Accounts' own navigation (2026-11-08: billing, subscriptions and finance became one section).
 * One sidebar entry opens Dues; the four screens are tabs of the same book rather than four
 * sidebar items. An account page and a deal page belong to Contracts.
 */
export function AccountsTabs() {
  const t = useTranslations("accounts.tabs");
  const pathname = usePathname();

  const activeKey = (() => {
    if (pathname === "/admin/accounts") return "dues";
    for (const tab of TABS) {
      if (tab.href !== "/admin/accounts" && pathname.startsWith(tab.href)) return tab.key;
    }
    return "contracts"; // /admin/accounts/[id], /admin/accounts/deals/[id]
  })();

  return (
    <nav
      className="bg-muted/50 no-scrollbar flex max-w-full gap-1 overflow-x-auto rounded-xl p-1 sm:inline-flex"
      aria-label={t("label")}
    >
      {TABS.map((tab) => {
        const active = tab.key === activeKey;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors sm:px-4",
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
