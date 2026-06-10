"use client";

import {
  Building2,
  CalendarDays,
  GraduationCap,
  LogOut,
  Menu,
  ReceiptText,
  Settings,
  Users,
  Wallet,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ComponentType } from "react";
import { useAuth } from "@/components/auth-provider";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type NavKey =
  | "dashboard"
  | "academies"
  | "guardians"
  | "students"
  | "teachers"
  | "schedule"
  | "invoices"
  | "payroll"
  | "settings";

/**
 * Nav items are gated by a capability code (Sprint 2 §6.3). `dashboard` is always shown;
 * every other item appears only when the resolved session grants its permission — so a
 * Teacher never sees Academies/Teachers/Invoices/Payroll/Settings (AC-2.4/AC-2.12). A
 * hidden link is UX, not security: the server Gate::authorize is the real control.
 */
const NAV: ReadonlyArray<{
  key: NavKey;
  icon: ComponentType<{ className?: string }>;
  permission: string | null;
  href: string;
}> = [
  { key: "dashboard", icon: GraduationCap, permission: null, href: "/" },
  {
    key: "academies",
    icon: Building2,
    permission: "academy.read",
    href: "/academies",
  },
  {
    key: "guardians",
    icon: Users,
    permission: "guardian.read",
    href: "/guardians",
  },
  {
    key: "students",
    icon: GraduationCap,
    permission: "student.read",
    href: "/students",
  },
  {
    key: "teachers",
    icon: Users,
    permission: "teacher.read",
    href: "/teachers",
  },
  {
    key: "schedule",
    icon: CalendarDays,
    permission: "schedule.read",
    href: "/calendar",
  },
  { key: "invoices", icon: ReceiptText, permission: "invoice.read", href: "#" },
  { key: "payroll", icon: Wallet, permission: "payout.read", href: "#" },
  {
    key: "settings",
    icon: Settings,
    permission: "academy.configure",
    href: "#",
  },
];

/**
 * The authenticated app shell: collapsible sidebar + header. Bilingual, RTL-aware via CSS
 * logical properties + the <html dir> set in the root layout. Renders only the nav items
 * the current role is permitted to see, shows who is signed in, and (for a Super Admin
 * inside an entered academy) an exit affordance. Redirects to /login when unauthenticated.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations();
  const { session, loading, can, signOut, exitAcademy, changeLocale } =
    useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);

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
        <span className="text-muted-foreground text-sm">
          {t("auth.loading")}
        </span>
      </div>
    );
  }

  const items = NAV.filter(
    (item) => item.permission === null || can(item.permission),
  );
  const inEnteredAcademy =
    session.role === "SUPER_ADMIN" && session.academyId !== null;

  return (
    <div className="bg-background flex min-h-dvh w-full overflow-x-hidden">
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
          open
            ? "translate-x-0"
            : "-translate-x-full rtl:translate-x-full md:translate-x-0",
        )}
      >
        <div className="mb-6 flex items-center gap-2 px-2">
          <GraduationCap className="text-primary size-6" aria-hidden />
          <span className="text-lg font-semibold">{t("app.name")}</span>
        </div>
        <nav className="flex flex-col gap-1" data-testid="nav">
          {items.map(({ key, icon: Icon, href }) => (
            <a
              key={key}
              href={href}
              data-nav={key}
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
            {inEnteredAcademy && (
              <div
                className="flex items-center gap-2 text-sm"
                data-testid="entered-academy"
              >
                <span className="text-muted-foreground">
                  {t("header.enteredAcademy")}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => void exitAcademy()}
                >
                  {t("header.exit")}
                </Button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <div
              className="hidden text-end sm:block"
              data-testid="current-user"
            >
              <div className="text-sm leading-tight font-medium">
                {session.user.fullName}
              </div>
              <div className="text-muted-foreground text-xs leading-tight">
                {t(`roles.${session.role}`)}
              </div>
            </div>
            <LocaleSwitcher onSwitch={changeLocale} />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("auth.signOut")}
              onClick={() => void signOut()}
            >
              <LogOut className="size-5" aria-hidden />
            </Button>
          </div>
        </header>

        <main className="min-w-0 flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
