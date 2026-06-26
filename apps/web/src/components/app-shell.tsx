"use client";

import {
  Award,
  BarChart3,
  BellRing,
  Briefcase,
  Building2,
  CalendarClock,
  CalendarDays,
  ClipboardCheck,
  CreditCard,
  FileCheck2,
  GraduationCap,
  History,
  LayoutDashboard,
  Lock,
  LogOut,
  Menu,
  MessageCircle,
  NotebookPen,
  Package,
  ReceiptText,
  Settings,
  ShieldCheck,
  Sparkles,
  ToggleLeft,
  Users,
  UserCheck,
  UserCog,
  Video,
  Wallet,
  X,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ComponentType } from "react";
import { useAuth } from "@/components/auth-provider";
import { LocaleSwitcher } from "@/components/locale-switcher";
import {
  getDaySessionCount,
  getEntitlements,
  getNotificationsSummary,
} from "@/lib/api";
import { applyBranding, loadBranding } from "@/lib/branding";
import { cn } from "@/lib/utils";

type NavKey =
  | "dashboard"
  | "notifications"
  | "adminHome"
  | "academies"
  | "users"
  | "plans"
  | "staffDepartments"
  | "adminAutomation"
  | "guardians"
  | "students"
  | "teachers"
  | "staff"
  | "schedule"
  | "videoClassroom"
  | "trials"
  | "attendance"
  | "studentReports"
  | "studentReportReviews"
  | "certificates"
  | "billing"
  | "invoices"
  | "payroll"
  | "myPayroll"
  | "plan"
  | "financialStats"
  | "audit"
  | "settings"
  | "platformSettings"
  | "roles"
  | "academyRoles";

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
    href: "/dashboard",
    group: "general",
  },
  {
    key: "notifications",
    icon: BellRing,
    permission: "notification.read",
    href: "/notifications",
    group: "general",
  },
  {
    key: "adminHome",
    icon: LayoutDashboard,
    permission: "academy.read",
    href: "/admin",
    group: "management",
  },
  {
    key: "academies",
    icon: Building2,
    permission: "academy.read",
    href: "/academies",
    group: "management",
  },
  {
    key: "users",
    icon: Users,
    permission: "user.read_platform",
    href: "/admin/users",
    group: "management",
  },
  {
    key: "plans",
    icon: Package,
    permission: "plan.manage",
    href: "/admin/plans",
    group: "management",
  },
  {
    key: "staffDepartments",
    icon: Briefcase,
    permission: "staff_department.manage",
    href: "/admin/staff-departments",
    group: "management",
  },
  {
    key: "adminAutomation",
    icon: MessageCircle,
    permission: "automation.manage",
    href: "/admin/automation",
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
    key: "staff",
    icon: Users,
    permission: "staff.read",
    href: "/staff",
    group: "management",
  },
  {
    key: "academyRoles",
    icon: ShieldCheck,
    permission: "role.manage",
    href: "/roles",
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
    key: "videoClassroom",
    icon: Video,
    permission: "room.read",
    href: "/video-classroom",
    group: "management",
  },
  {
    key: "trials",
    icon: CalendarClock,
    permission: "trial.read",
    href: "/trials",
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
    key: "studentReports",
    icon: NotebookPen,
    permission: "student_report.submit",
    href: "/student-reports",
    group: "management",
  },
  {
    key: "studentReportReviews",
    icon: FileCheck2,
    permission: "student_report.review",
    href: "/student-report-reviews",
    group: "management",
  },
  {
    key: "certificates",
    icon: Award,
    permission: "certificate.read",
    href: "/certificates",
    group: "management",
  },
  {
    key: "billing",
    icon: CreditCard,
    permission: "academy_billing.manage",
    href: "/admin/billing",
    group: "financial",
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
    href: "/payroll",
    group: "financial",
  },
  {
    key: "myPayroll",
    icon: Wallet,
    permission: "payout.read_own",
    href: "/payroll",
    group: "financial",
  },
  {
    key: "plan",
    icon: Sparkles,
    permission: "invoice.read",
    href: "/plan",
    group: "financial",
  },
  {
    key: "financialStats",
    icon: BarChart3,
    permission: "invoice.read",
    href: "/financial-statistics",
    group: "financial",
  },
  {
    key: "audit",
    icon: History,
    permission: "audit.read",
    href: "/audit",
    group: "system",
  },
  {
    key: "settings",
    icon: Settings,
    permission: "specialization.manage",
    href: "/settings",
    group: "system",
  },
  {
    key: "platformSettings",
    icon: ToggleLeft,
    permission: "platform.manage",
    href: "/admin/settings",
    group: "system",
  },
  {
    key: "roles",
    icon: ShieldCheck,
    permission: "platform.manage",
    href: "/admin/roles",
    group: "system",
  },
];

const NAV_GROUPS = ["general", "management", "financial", "system"] as const;

/**
 * Plan-gated nav items → the entitlement capability that unlocks them (Sprint 9 §3). Unlike
 * `permission` (which HIDES an item the role can't use), a missing capability keeps the item
 * visible but renders it disabled with an "Upgrade" badge that links to /plan — so an academy
 * owner can see what a higher tier offers. Items not listed here are never plan-locked. The
 * server still enforces the gate (entitled: middleware → 402); this is UX only.
 */
const NAV_CAPABILITY: Partial<Record<NavKey, string>> = {
  videoClassroom: "video.conferencing",
  staff: "staff",
  academyRoles: "custom_roles",
  trials: "trials",
  certificates: "certificates",
  studentReports: "student_reports",
  studentReportReviews: "student_reports",
  invoices: "invoicing",
  payroll: "payroll",
  myPayroll: "payroll",
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations();
  const { session, loading, can, signOut, exitAcademy, changeLocale } =
    useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [notifCount, setNotifCount] = useState(0);
  const [srCount, setSrCount] = useState(0);
  const [attnCount, setAttnCount] = useState(0);
  const [capabilities, setCapabilities] = useState<string[] | null>(null);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Keep the sidebar unread badge fresh: refetch whenever the route changes (so acting on the
  // Notifications page clears it) and on a slow heartbeat. Best-effort — failures stay silent.
  useEffect(() => {
    if (session === null || !can("notification.read")) {
      setNotifCount(0);
      setSrCount(0);
      return;
    }
    let alive = true;
    const refresh = () =>
      getNotificationsSummary()
        .then((s) => {
          if (!alive) return;
          setNotifCount(s.total);
          setSrCount(s.studentReports);
        })
        .catch(() => {});
    void refresh();
    const id = setInterval(refresh, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [session, can, pathname]);

  // Attendance badge: count of today's still-SCHEDULED sessions (whole local day, so a trial
  // booked for later today counts too). Refetch on navigation and on a slow heartbeat so it clears
  // as outcomes are recorded. Best-effort — failures stay silent.
  useEffect(() => {
    if (session === null || !can("session.read")) {
      setAttnCount(0);
      return;
    }
    let alive = true;
    const refresh = () => {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      getDaySessionCount({
        from: start.toISOString(),
        to: end.toISOString(),
      })
        .then((r) => alive && setAttnCount(r.count))
        .catch(() => {});
    };
    refresh();
    const id = setInterval(refresh, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [session, can, pathname]);

  // Resolve the academy's plan entitlements so the sidebar can lock features the plan doesn't
  // include (renders them disabled + "Upgrade" badge). Only meaningful inside an academy; a
  // platform Super Admin (academyId null) has no plan, so leave capabilities unresolved.
  useEffect(() => {
    if (session === null || session.academyId === null) {
      setCapabilities(null);
      return;
    }
    let alive = true;
    getEntitlements()
      .then((e) => alive && setCapabilities(e.capabilities))
      .catch(() => alive && setCapabilities(null));
    return () => {
      alive = false;
    };
  }, [session]);

  useEffect(() => {
    applyBranding(loadBranding());
  }, []);

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

  // A platform Super Admin (not inside an entered academy) has no tenant dashboard — their
  // home is the Platform Overview, so the generic "Dashboard" item would just be a redundant
  // second link to the same place. Hide it for them.
  const isPlatformAdmin =
    session.role === "SUPER_ADMIN" && session.academyId === null;
  const items = NAV.filter((item) => {
    if (item.permission !== null && !can(item.permission)) return false;
    if (item.key === "dashboard" && isPlatformAdmin) return false;
    // The Audit Log link is Super-Admin-only in the sidebar. Academy owners retain
    // audit.read (the page and API stay reachable) — this just keeps it out of the
    // owner panel's navigation.
    if (item.key === "audit" && session.role !== "SUPER_ADMIN") return false;
    return true;
  });
  const inEnteredAcademy =
    session.role === "SUPER_ADMIN" && session.academyId !== null;

  const initials = session.user.fullName
    .split(" ")
    .slice(0, 2)
    .map((w: string) => w[0] ?? "")
    .join("")
    .toUpperCase();

  // `/dashboard` and `/admin` are exact-match only — otherwise `/admin` would greedily
  // claim the `/admin/plans` and `/admin/staff-departments` routes via startsWith.
  const isExactOnly = (href: string) => href === "/dashboard" || href === "/admin";
  const activeItem = items.find(
    (item) =>
      pathname === item.href ||
      (!isExactOnly(item.href) && pathname.startsWith(item.href)),
  );

  return (
    <div className="bg-background flex h-dvh w-full overflow-hidden">
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 z-20 bg-black/50 backdrop-blur-sm md:hidden"
          aria-hidden
          onClick={() => setOpen(false)}
        />
      )}

      {/* ── Sidebar ─────────────────────────────────────────────────── */}
      <aside
        data-testid="sidebar"
        data-open={open}
        className={cn(
          "bg-sidebar text-sidebar-foreground border-sidebar-border fixed inset-y-0 z-30 flex w-60 shrink-0 flex-col border-e transition-transform duration-200 md:static md:h-full md:translate-x-0",
          open
            ? "translate-x-0"
            : "max-md:-translate-x-full max-md:rtl:translate-x-full",
        )}
      >
        {/* ── Brand ──────────────────────────────────────────── */}
        <div className="border-sidebar-border flex h-14 shrink-0 items-center justify-between border-b px-4">
          <div className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.png"
              alt="Acadmyq"
              className="size-8 shrink-0 object-contain"
            />
            <div>
              <div className="text-sidebar-foreground text-[13px] font-semibold leading-tight">
                Acadmyq
              </div>
              <div className="text-sidebar-foreground/35 text-[10px] leading-tight tracking-wide">
                Management
              </div>
            </div>
          </div>
          <button
            type="button"
            className="text-sidebar-foreground/40 hover:bg-sidebar-accent hover:text-sidebar-foreground rounded-lg p-1.5 transition-colors md:hidden"
            onClick={() => setOpen(false)}
            aria-label="Close"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        {/* ── Nav ────────────────────────────────────────────── */}
        <nav
          className="flex-1 overflow-y-auto px-3 py-3"
          data-testid="nav"
        >
          <div className="space-y-5">
            {NAV_GROUPS.map((group) => {
              const groupItems = items.filter((item) => item.group === group);
              if (groupItems.length === 0) return null;
              return (
                <div key={group}>
                  <p className="text-sidebar-foreground/40 mb-1.5 select-none px-2.5 text-[10px] font-bold uppercase tracking-[0.1em]">
                    {t(`navGroup.${group}`)}
                  </p>
                  <div className="space-y-0.5">
                    {groupItems.map(({ key, icon: Icon, href }) => {
                      const requiredCap = NAV_CAPABILITY[key];
                      const locked =
                        requiredCap !== undefined &&
                        capabilities !== null &&
                        !capabilities.includes(requiredCap);
                      const isActive =
                        !locked &&
                        (pathname === href ||
                          (!isExactOnly(href) && pathname.startsWith(href)));
                      return (
                        <Link
                          // A locked item still renders, but routes to /plan (the upgrade page)
                          // instead of the gated feature — the server would 402 it anyway.
                          key={key}
                          href={locked ? "/plan" : href}
                          data-nav={key}
                          data-locked={locked || undefined}
                          title={locked ? t("nav.upgradeHint") : undefined}
                          className={cn(
                            "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all duration-150",
                            isActive
                              ? "bg-primary/[0.12] font-semibold text-primary"
                              : locked
                                ? "font-medium text-sidebar-foreground/40 hover:bg-sidebar-accent/60"
                                : "font-medium text-sidebar-foreground hover:bg-sidebar-accent",
                          )}
                        >
                          <Icon
                            className={cn(
                              "size-4 shrink-0 transition-colors",
                              isActive
                                ? "text-primary"
                                : locked
                                  ? "text-sidebar-foreground/30"
                                  : "text-sidebar-foreground/60 group-hover:text-sidebar-foreground",
                            )}
                            aria-hidden
                          />
                          <span className="flex-1">{t(`nav.${key}`)}</span>
                          {locked ? (
                            <span
                              data-testid="nav-upgrade-badge"
                              className="ms-auto inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
                            >
                              <Lock className="size-2.5" aria-hidden />
                              {t("nav.upgradeBadge")}
                            </span>
                          ) : (
                            <>
                              {key === "notifications" && notifCount > 0 && (
                                <span
                                  data-testid="nav-notif-badge"
                                  aria-label={`${notifCount} new notifications`}
                                  className="ms-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-semibold tabular-nums text-white shadow-sm shadow-red-500/30"
                                >
                                  {notifCount > 99 ? "99+" : notifCount}
                                </span>
                              )}
                              {key === "attendance" && attnCount > 0 && (
                                <span
                                  data-testid="nav-attendance-badge"
                                  aria-label={`${attnCount} sessions awaiting attendance today`}
                                  className="ms-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-semibold tabular-nums text-white shadow-sm shadow-red-500/30"
                                >
                                  {attnCount > 99 ? "99+" : attnCount}
                                </span>
                              )}
                              {key === "studentReportReviews" && srCount > 0 && (
                                <span
                                  data-testid="nav-student-reports-badge"
                                  aria-label={`${srCount} student reports awaiting review`}
                                  className="ms-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-semibold tabular-nums text-white shadow-sm shadow-red-500/30"
                                >
                                  {srCount > 99 ? "99+" : srCount}
                                </span>
                              )}
                              {isActive &&
                                key !== "notifications" &&
                                !(key === "attendance" && attnCount > 0) &&
                                !(
                                  key === "studentReportReviews" && srCount > 0
                                ) && (
                                  <span className="bg-primary ms-auto size-1.5 rounded-full" />
                                )}
                            </>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </nav>

        {/* ── User footer ────────────────────────────────────── */}
        <div className="border-sidebar-border border-t p-3">
          {inEnteredAcademy && (
            <div
              className="mb-2 flex items-center justify-between rounded-lg border border-amber-300/40 bg-amber-50/80 px-3 py-2 text-xs dark:border-amber-700/30 dark:bg-amber-950/30"
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
            className="hover:bg-sidebar-accent group flex cursor-default items-center gap-2.5 rounded-lg px-2 py-2 transition-colors"
            data-testid="current-user"
          >
            <div className="from-primary/20 to-primary/[0.08] ring-primary/20 flex size-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-[11px] font-bold text-primary ring-1">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sidebar-foreground truncate text-[12px] font-semibold leading-tight">
                {session.user.fullName}
              </div>
              <div className="text-sidebar-foreground/40 truncate text-[11px] leading-tight">
                {t(`roles.${session.role}`)}
              </div>
            </div>
            <button
              type="button"
              className="text-sidebar-foreground/30 hover:bg-sidebar-border hover:text-sidebar-foreground/70 shrink-0 rounded-md p-1 transition-colors"
              aria-label={t("auth.signOut")}
              onClick={() => void signOut()}
            >
              <LogOut className="size-3.5" aria-hidden />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main area ───────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* ── Header ─────────────────────────────────────────── */}
        <header className="bg-background/80 supports-[backdrop-filter]:bg-background/60 border-border flex h-14 shrink-0 items-center gap-3 border-b px-5 backdrop-blur-xl">
          {/* Mobile menu toggle */}
          <button
            type="button"
            className="text-muted-foreground hover:bg-muted hover:text-foreground rounded-lg p-1.5 transition-colors md:hidden"
            aria-label={t("header.menu")}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <Menu className="size-5" aria-hidden />
          </button>

          {/* Page title */}
          {activeItem && (
            <div className="hidden items-center gap-1.5 md:flex">
              <activeItem.icon
                className="text-muted-foreground/50 size-3.5"
                aria-hidden
              />
              <span className="text-muted-foreground/40 select-none text-sm">
                /
              </span>
              <span className="text-foreground text-sm font-semibold">
                {t(`nav.${activeItem.key}`)}
              </span>
            </div>
          )}

          {/* Right-side actions */}
          <div className="ms-auto flex items-center gap-2">
            <LocaleSwitcher onSwitch={changeLocale} />

            <div className="bg-border h-5 w-px" aria-hidden />

            {/* User chip */}
            <div
              className="hover:bg-muted flex cursor-default items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors"
              data-testid="header-user"
            >
              <div className="from-primary/20 to-primary/[0.08] ring-primary/20 flex size-6 shrink-0 items-center justify-center rounded-md bg-gradient-to-br text-[10px] font-bold text-primary ring-1">
                {initials}
              </div>
              <span className="text-foreground hidden text-[13px] font-medium leading-none sm:block">
                {session.user.fullName.split(" ")[0]}
              </span>
            </div>
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
