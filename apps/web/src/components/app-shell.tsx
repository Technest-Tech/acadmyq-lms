"use client";

import {
  Building2,
  CalendarDays,
  ClipboardCheck,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Menu,
  ReceiptText,
  Settings,
  UserCheck,
  UserCog,
  Wallet,
  X,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ComponentType } from "react";
import { useAuth } from "@/components/auth-provider";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { cn } from "@/lib/utils";

type NavKey =
  | "dashboard"
  | "academies"
  | "guardians"
  | "students"
  | "teachers"
  | "schedule"
  | "attendance"
  | "invoices"
  | "payroll"
  | "settings";

/**
 * Nav items gated by capability code (Sprint 2 §6.3). `dashboard` is always shown;
 * others appear only when the resolved session grants the permission — a hidden link
 * is UX, not security (server Gate::authorize is the real control). Each item belongs
 * to a nav group so the sidebar can render labelled sections.
 */
const NAV: ReadonlyArray<{
  key: NavKey;
  icon: ComponentType<{ className?: string }>;
  permission: string | null;
  href: string;
  group: "general" | "management" | "financial" | "system";
}> = [
  {
    key: "dashboard",
    icon: LayoutDashboard,
    permission: null,
    href: "/",
    group: "general",
  },
  {
    key: "academies",
    icon: Building2,
    permission: "academy.read",
    href: "/academies",
    group: "management",
  },
  {
    key: "guardians",
    icon: UserCheck,
    permission: "guardian.read",
    href: "/guardians",
    group: "management",
  },
  {
    key: "students",
    icon: GraduationCap,
    permission: "student.read",
    href: "/students",
    group: "management",
  },
  {
    key: "teachers",
    icon: UserCog,
    permission: "teacher.read",
    href: "/teachers",
    group: "management",
  },
  {
    key: "schedule",
    icon: CalendarDays,
    permission: "schedule.read",
    href: "/calendar",
    group: "management",
  },
  {
    key: "attendance",
    icon: ClipboardCheck,
    permission: "session.read",
    href: "/attendance",
    group: "management",
  },
  {
    key: "invoices",
    icon: ReceiptText,
    permission: "invoice.read",
    href: "/invoices",
    group: "financial",
  },
  {
    key: "payroll",
    icon: Wallet,
    permission: "payout.read",
    href: "#",
    group: "financial",
  },
  {
    key: "settings",
    icon: Settings,
    permission: "academy.configure",
    href: "#",
    group: "system",
  },
];

const NAV_GROUPS = ["general", "management", "financial", "system"] as const;

/**
 * The authenticated app shell: light premium sidebar + header. Bilingual, RTL-aware
 * via CSS logical properties + the <html dir> set in the root layout. Uses Next.js
 * <Link> for client-side navigation (no full page reloads). Redirects to /login when
 * unauthenticated.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations();
  const { session, loading, can, signOut, exitAcademy, changeLocale } =
    useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // close mobile drawer on navigation
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!loading && session === null) {
      router.replace("/login");
    }
  }, [loading, session, router]);

  if (loading || session === null) {
    return (
      <div
        className="bg-background flex min-h-dvh items-center justify-center"
        data-testid="shell-loading"
      >
        <div className="flex flex-col items-center gap-3">
          <div className="border-primary size-8 animate-spin rounded-full border-2 border-t-transparent" />
          <span className="text-muted-foreground text-sm">
            {t("auth.loading")}
          </span>
        </div>
      </div>
    );
  }

  const items = NAV.filter(
    (item) => item.permission === null || can(item.permission),
  );
  const inEnteredAcademy =
    session.role === "SUPER_ADMIN" && session.academyId !== null;

  const initials = session.user.fullName
    .split(" ")
    .slice(0, 2)
    .map((w: string) => w[0] ?? "")
    .join("")
    .toUpperCase();

  return (
    <div className="bg-background flex min-h-dvh w-full overflow-x-hidden">
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 z-20 bg-black/40 backdrop-blur-sm md:hidden"
          aria-hidden
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        data-testid="sidebar"
        data-open={open}
        className={cn(
          "bg-sidebar text-sidebar-foreground border-sidebar-border fixed inset-y-0 z-30 flex w-64 shrink-0 flex-col border-e shadow-sm transition-transform duration-200 md:static md:translate-x-0",
          open
            ? "translate-x-0"
            : "max-md:-translate-x-full max-md:rtl:translate-x-full",
        )}
      >
        {/* Brand */}
        <div className="border-sidebar-border flex items-center justify-between border-b px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="bg-primary flex size-8 items-center justify-center rounded-lg">
              <GraduationCap className="size-4 text-white" aria-hidden />
            </div>
            <div>
              <div className="text-sidebar-foreground text-sm font-bold">
                {t("app.name")}
              </div>
              <div className="text-sidebar-foreground/40 mt-0.5 text-[10px] uppercase tracking-wide leading-none">
                Management
              </div>
            </div>
          </div>
          <button
            type="button"
            className="text-sidebar-foreground/40 hover:text-sidebar-foreground rounded-md p-1 transition-colors md:hidden"
            onClick={() => setOpen(false)}
            aria-label="Close"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        {/* Navigation groups */}
        <nav
          className="flex-1 space-y-4 overflow-y-auto px-3 py-4"
          data-testid="nav"
        >
          {NAV_GROUPS.map((group) => {
            const groupItems = items.filter((item) => item.group === group);
            if (groupItems.length === 0) return null;
            return (
              <div key={group}>
                <p className="text-sidebar-foreground/35 mb-1 select-none px-2 text-[10px] font-semibold uppercase tracking-widest">
                  {t(`navGroup.${group}`)}
                </p>
                <div className="space-y-0.5">
                  {groupItems.map(({ key, icon: Icon, href }) => {
                    const isActive =
                      pathname === href ||
                      (href !== "/" && pathname.startsWith(href));
                    return (
                      <Link
                        key={key}
                        href={href}
                        data-nav={key}
                        className={cn(
                          "group flex items-center gap-3 rounded-lg border-s-2 px-3 py-2 text-sm font-medium transition-all",
                          isActive
                            ? "border-primary bg-primary/8 text-primary"
                            : "border-transparent text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                        )}
                      >
                        <Icon
                          className={cn(
                            "size-4 shrink-0 transition-colors",
                            isActive ? "text-primary" : "",
                          )}
                          aria-hidden
                        />
                        <span>{t(`nav.${key}`)}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        {/* User profile + actions */}
        <div className="border-sidebar-border space-y-1.5 border-t p-3">
          {inEnteredAcademy && (
            <div
              className="flex items-center justify-between rounded-lg border border-amber-400/30 bg-amber-50 px-3 py-2 text-xs dark:border-amber-700/30 dark:bg-amber-950/30"
              data-testid="entered-academy"
            >
              <span className="text-amber-700 dark:text-amber-400">
                {t("header.enteredAcademy")}
              </span>
              <button
                type="button"
                className="font-semibold text-amber-700 transition-colors hover:text-amber-900 dark:text-amber-400 dark:hover:text-amber-200"
                onClick={() => void exitAcademy()}
              >
                {t("header.exit")}
              </button>
            </div>
          )}

          <div
            className="flex items-center gap-3 rounded-lg px-2 py-2"
            data-testid="current-user"
          >
            <div className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sidebar-foreground truncate text-xs font-semibold">
                {session.user.fullName}
              </div>
              <div className="text-sidebar-foreground/45 truncate text-[11px]">
                {t(`roles.${session.role}`)}
              </div>
            </div>
            <button
              type="button"
              className="text-sidebar-foreground/35 hover:text-sidebar-foreground shrink-0 transition-colors"
              aria-label={t("auth.signOut")}
              onClick={() => void signOut()}
            >
              <LogOut className="size-4" aria-hidden />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="bg-card flex h-14 shrink-0 items-center justify-between gap-3 border-b px-4 shadow-sm">
          <button
            type="button"
            className="text-muted-foreground hover:bg-muted hover:text-foreground rounded-md p-1.5 transition-colors md:hidden"
            aria-label={t("header.menu")}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <Menu className="size-5" aria-hidden />
          </button>

          <div className="ms-auto flex items-center gap-3">
            <LocaleSwitcher onSwitch={changeLocale} />
          </div>
        </header>

        <main className="min-w-0 flex-1 overflow-auto p-6">
          <div key={pathname} className="animate-page-enter">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
