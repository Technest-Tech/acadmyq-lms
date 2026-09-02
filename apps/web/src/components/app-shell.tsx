"use client";

import {
  Award,
  BookOpen,
  BarChart3,
  BellRing,
  Briefcase,
  Building2,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  ClipboardCheck,
  CreditCard,
  FileCheck2,
  Globe,
  GraduationCap,
  History,
  KeyRound,
  LayoutDashboard,
  LibraryBig,
  LifeBuoy,
  ListChecks,
  LogOut,
  Menu,
  MessageCircle,
  MonitorPlay,
  NotebookPen,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Layers,
  ReceiptText,
  Scale,
  Settings,
  ShieldCheck,
  ToggleLeft,
  Users,
  UserCheck,
  UserCog,
  UserPlus,
  Video,
  Wallet,
  X,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ComponentType } from "react";
import { useAuth } from "@/components/auth-provider";
import { CommandPalette, type CommandItem } from "@/components/command-palette";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipProvider } from "@/components/ui/tooltip";
import {
  getDaySessionCount,
  getLessonPackageSummary,
  getNotificationsSummary,
} from "@/lib/api";
import {
  KhatamLattice,
  Octagram,
  OrnateRule,
} from "@/components/ornaments";
import { applyBranding, loadBranding } from "@/lib/branding";
import { cn } from "@/lib/utils";

type NavKey =
  | "dashboard"
  | "notifications"
  | "adminHome"
  | "clients"
  | "users"
  | "plans"
  | "staffDepartments"
  | "adminAutomation"
  | "adminVideo"
  | "adminLms"
  | "guardians"
  | "students"
  | "teachers"
  | "staff"
  | "schedule"
  | "videoClassroom"
  | "trials"
  | "crm"
  | "lmsHome"
  | "courses"
  | "lmsQuizzes"
  | "lmsLearners"
  | "lmsCodes"
  | "lmsSite"
  | "attendance"
  | "studentReports"
  | "studentReportReviews"
  | "certificates"
  | "billing"
  | "invoices"
  | "packages"
  | "payroll"
  | "teacherQuality"
  | "discountsAwards"
  | "myPayroll"
  | "plan"
  | "financialStats"
  | "audit"
  | "settings"
  | "platformSettings"
  | "roles"
  | "academyRoles";

/**
 * The sidebar's nav groups. `management` used to be a single bucket of fourteen items — long enough
 * to scroll on a laptop and impossible to scan. It is now split by what the user is actually trying
 * to do (people / academics / scheduling), which is what makes the list skimmable.
 *
 * `platform` holds the Super-Admin links. On the platform view they are rendered as module dropdowns
 * instead (see ADMIN_MODULES); this group is what an admin sees once they've entered an academy.
 */
type NavGroup =
  | "general"
  | "people"
  | "academics"
  | "lms"
  | "scheduling"
  | "financial"
  | "platform"
  | "system";

const NAV_GROUPS: readonly NavGroup[] = [
  "general",
  "people",
  "academics",
  "lms",
  "scheduling",
  "financial",
  "platform",
  "system",
];

/**
 * Nav items gated by capability code (Sprint 2 §6.3). `dashboard` is always shown; others appear
 * only when the resolved session grants the permission — a hidden link is UX, not security (server
 * Gate::authorize is the real control).
 */
const NAV: ReadonlyArray<{
  key: NavKey;
  icon: ComponentType<{ className?: string }>;
  permission: string | null;
  href: string;
  group: NavGroup;
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

  // ── People ──────────────────────────────────────────────────────────────
  {
    key: "students",
    icon: GraduationCap,
    permission: "student.read",
    href: "/students",
    group: "people",
  },
  {
    key: "attendance",
    icon: ClipboardCheck,
    permission: "session.read",
    href: "/attendance",
    group: "people",
  },
  {
    key: "schedule",
    icon: CalendarDays,
    permission: "schedule.read",
    href: "/calendar",
    group: "people",
  },
  {
    key: "trials",
    icon: CalendarClock,
    permission: "trial.read",
    href: "/trials",
    group: "people",
  },
  {
    key: "crm",
    icon: UserPlus,
    permission: "crm.read",
    href: "/crm",
    group: "people",
  },
  {
    key: "guardians",
    icon: UserCheck,
    permission: "guardian.read",
    href: "/guardians",
    group: "people",
  },
  {
    key: "teachers",
    icon: UserCog,
    permission: "teacher.read",
    href: "/teachers",
    group: "people",
  },

  // ── Course platform (LMS, docs/lms) ─────────────────────────────────────
  // Its own group: an LMS client's whole workspace, and a distinct section for a school that also
  // sells courses. `lms.only` collapses the sidebar to exactly these (+ the account screens).
  {
    key: "lmsHome",
    icon: LayoutDashboard,
    permission: "course.read",
    href: "/lms",
    group: "lms",
  },
  {
    key: "courses",
    icon: BookOpen,
    permission: "course.read",
    href: "/lms/courses",
    group: "lms",
  },
  // Quizzes live inside a course (a QUIZ lesson points at one), so this is purely the cross-course
  // overview + their results — the one place staff can see every quiz and how learners did.
  {
    key: "lmsQuizzes",
    icon: ListChecks,
    permission: "course.read",
    href: "/lms/quizzes",
    group: "lms",
  },
  {
    key: "lmsLearners",
    icon: Users,
    permission: "learner.read",
    href: "/lms/learners",
    group: "lms",
  },
  {
    key: "lmsCodes",
    icon: KeyRound,
    permission: "access_code.manage",
    href: "/lms/codes",
    group: "lms",
  },
  // The public site's content (docs/lms/09) — the client's own half of the shared learner-site
  // template. Read-gated like the rest of the workspace; the editor itself needs `course.manage`.
  {
    key: "lmsSite",
    icon: Globe,
    permission: "course.read",
    href: "/lms/site",
    group: "lms",
  },

  // ── Academics ───────────────────────────────────────────────────────────
  {
    key: "studentReports",
    icon: NotebookPen,
    permission: "student_report.submit",
    href: "/student-reports",
    group: "academics",
  },
  {
    key: "studentReportReviews",
    icon: FileCheck2,
    permission: "student_report.review",
    href: "/student-report-reviews",
    group: "academics",
  },
  {
    key: "certificates",
    icon: Award,
    permission: "certificate.read",
    href: "/certificates",
    group: "academics",
  },

  // ── Scheduling ──────────────────────────────────────────────────────────
  {
    key: "videoClassroom",
    icon: Video,
    permission: "room.read",
    href: "/video-classroom",
    group: "scheduling",
  },

  // ── Financial ───────────────────────────────────────────────────────────
  {
    key: "invoices",
    icon: ReceiptText,
    permission: "invoice.read",
    href: "/invoices",
    group: "financial",
  },
  // Lesson packages sit directly under Invoices because they ARE invoicing — the same money on a
  // different clock (a block of hours instead of a calendar month), for the students on that mode.
  {
    key: "packages",
    icon: Layers,
    permission: "package.read",
    href: "/packages",
    group: "financial",
  },
  {
    key: "payroll",
    icon: Wallet,
    permission: "payout.read",
    href: "/payroll",
    group: "financial",
  },
  // Payroll's two management surfaces sit directly under it — both only ever move money on the
  // statements the item above shows.
  {
    key: "teacherQuality",
    icon: ClipboardCheck,
    permission: "teacher_quality.read",
    href: "/teacher-quality",
    group: "financial",
  },
  {
    key: "discountsAwards",
    icon: Scale,
    permission: "payout.adjust",
    href: "/discounts-awards",
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
    key: "financialStats",
    icon: BarChart3,
    permission: "invoice.read",
    href: "/financial-statistics",
    group: "financial",
  },
  {
    key: "billing",
    icon: CreditCard,
    permission: "academy_billing.manage",
    href: "/admin/billing",
    group: "financial",
  },

  // ── Platform (Super Admin) ──────────────────────────────────────────────
  {
    key: "adminHome",
    icon: LayoutDashboard,
    permission: "academy.read",
    href: "/admin",
    group: "platform",
  },
  {
    key: "clients",
    icon: Building2,
    permission: "academy.read",
    href: "/admin/clients",
    group: "platform",
  },
  {
    key: "users",
    icon: Users,
    permission: "user.read_platform",
    href: "/admin/users",
    group: "platform",
  },
  {
    key: "plans",
    icon: Package,
    permission: "plan.manage",
    href: "/admin/plans",
    group: "platform",
  },
  {
    key: "staffDepartments",
    icon: Briefcase,
    permission: "staff_department.manage",
    href: "/admin/staff-departments",
    group: "platform",
  },
  {
    key: "adminAutomation",
    icon: MessageCircle,
    permission: "automation.manage",
    href: "/admin/automation",
    group: "platform",
  },
  {
    key: "adminVideo",
    icon: MonitorPlay,
    permission: "platform.manage",
    href: "/admin/video",
    group: "platform",
  },
  {
    key: "adminLms",
    icon: LibraryBig,
    permission: "platform.manage",
    href: "/admin/lms",
    group: "platform",
  },

  // ── System ──────────────────────────────────────────────────────────────
  {
    key: "settings",
    icon: Settings,
    permission: "specialization.manage",
    href: "/settings",
    group: "system",
  },
  {
    key: "audit",
    icon: History,
    permission: "audit.read",
    href: "/audit",
    group: "system",
  },
  {
    key: "staff",
    icon: Users,
    permission: "staff.read",
    href: "/staff",
    group: "system",
  },
  {
    key: "academyRoles",
    icon: ShieldCheck,
    permission: "role.manage",
    href: "/roles",
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

/**
 * The platform Super Admin sidebar (R2, docs/superadmin-modules/04-CLIENT-FIRST-REDESIGN §3): a
 * SHORT FLAT list — one item per job, ordered by how often the owner needs it. The Phase-4 module
 * dropdowns are gone: "module" is a property of a CLIENT (chips on /admin/clients, three rows on
 * the client page), not a section of the sidebar. Items missing from this list never render on
 * the platform view (the tenant nav is untouched).
 */
const PLATFORM_NAV: readonly NavKey[] = [
  "adminHome", // Overview
  "clients", // THE hub — roster, client pages, wizard
  "billing", // money only: proof review, dues, MRR per module
  "plans", // catalog, one tab per module + add-ons
  "adminVideo", // Video Ops (platform-wide health/usage)
  "adminLms", // Course Platform Ops (LMS clients, usage, per-client controls)
  "adminAutomation", // WhatsApp Ops (gateway health/activity)
  "users",
  "platformSettings", // + tabs: roles matrix, staff departments (R3)
  "audit",
];

/**
 * Entitlement-gated nav items → the capability that unlocks them. A client gets every feature its
 * modules own, so a MISSING capability means we deliberately switched that feature off for this
 * client (05-MODULES-NOT-PACKAGES §6) — there is no tier to upgrade to, so the item is HIDDEN
 * rather than advertised. Items not listed here are never entitlement-gated. The server still
 * enforces the gate (entitled: middleware → 402); this is UX only.
 */
const NAV_CAPABILITY: Partial<Record<NavKey, string>> = {
  videoClassroom: "video.conferencing",
  staff: "staff",
  academyRoles: "custom_roles",
  trials: "trials",
  crm: "crm",
  courses: "lms",
  certificates: "certificates",
  studentReports: "student_reports",
  studentReportReviews: "student_reports",
  invoices: "invoicing",
  // Packages ARE invoicing — the same money on a different clock — so they live and die with
  // the same entitlement rather than being a module of their own.
  packages: "invoicing",
  payroll: "payroll",
  // Both live behind the payroll entitlement — they are payroll features, not a separate module,
  // so a client without payroll loses them exactly as it loses payroll.
  teacherQuality: "payroll",
  discountsAwards: "payroll",
  myPayroll: "payroll",
};

/**
 * The LMS workspace (docs/lms). `LMS_EXTRA_KEYS` are the surfaces that only make sense once the
 * module is on (they're hidden outright otherwise); `courses` is deliberately NOT one of them, so a
 * client without the module sees none of them (a school can never hold the course platform).
 * `LMS_ONLY_KEYS` is everything an `lms.only` client keeps: its workspace + the account screens.
 * Settings is deliberately NOT one of them — every knob on it (subjects, logo, colours, payment) is
 * either school-only or already owned by "My site", so for these clients it is a dead end.
 */
const LMS_EXTRA_KEYS = new Set<NavKey>([
  "lmsHome",
  "lmsQuizzes",
  "lmsLearners",
  "lmsCodes",
  "lmsSite",
]);
const LMS_ONLY_KEYS = new Set<NavKey>([
  "lmsHome",
  "courses",
  "lmsQuizzes",
  "lmsLearners",
  "lmsCodes",
  "lmsSite",
  "plan",
]);

const SIDEBAR_COLLAPSED_KEY = "sidebarCollapsed";

/** The unread pill. One component, because three hand-rolled copies drift. */
function NavBadge({ count, label }: { count: number; label: string }) {
  return (
    <span
      aria-label={label}
      className="bg-destructive text-white ms-auto inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums shadow-sm"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations();
  const { session, loading, can, signOut, exitAcademy, changeLocale } =
    useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [notifCount, setNotifCount] = useState(0);
  const [srCount, setSrCount] = useState(0);
  const [attnCount, setAttnCount] = useState(0);
  const [pkgCount, setPkgCount] = useState(0);
  // The academy's resolved plan capabilities, used to lock nav items the plan doesn't include.
  // They arrive with the session itself, so by the time we have a session we have these too — there
  // is no separate loading state to guard, and no window in which a video-only ("Meet Plan") academy
  // could flash the full academy chrome. `null` = a platform Super Admin, who has no plan.
  const capabilities = session?.capabilities ?? null;

  // The preference is read after mount, never during render — reading localStorage while
  // rendering would make the server and client markup disagree.
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true");
    } catch {
      // ignore malformed / unavailable storage
    }
  }, []);

  const toggleCollapsed = () =>
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      } catch {
        // ignore
      }
      return next;
    });

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

  // Packages badge: how many blocks of hours need the owner to DO something — running out,
  // finished and unpaid, or an overdraft still to bill. Deliberately not "unread": the count is
  // derived from package state, so it clears when the work is done rather than when it is seen.
  useEffect(() => {
    if (session === null || !can("package.read")) {
      setPkgCount(0);
      return;
    }
    let alive = true;
    const refresh = () =>
      getLessonPackageSummary()
        .then((s) => alive && setPkgCount(s.total))
        .catch(() => {});
    void refresh();
    const id = setInterval(refresh, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [session, can, pathname]);

  useEffect(() => {
    applyBranding(loadBranding());
  }, []);

  useEffect(() => {
    if (!loading && session === null) {
      router.replace("/login");
    }
  }, [loading, session, router]);

  // A video-only ("Meet Plan") academy has no general dashboard — send it to the video classroom,
  // its only surface.
  useEffect(() => {
    if (capabilities?.includes("video.only") && pathname === "/dashboard") {
      router.replace("/video-classroom");
    }
  }, [capabilities, pathname, router]);

  // An LMS-only client's home is the course platform's own dashboard, not the school's (docs/lms).
  // Settings goes the same way: it is off their sidebar, so the bare URL must not be a back door
  // into a screen full of school knobs they have no use for.
  useEffect(() => {
    if (
      capabilities?.includes("lms.only") &&
      (pathname === "/dashboard" || pathname === "/settings")
    ) {
      router.replace("/lms");
    }
  }, [capabilities, pathname, router]);

  // Cold start only. The shell lives in the (app) layout, so it mounts once per session and stays
  // mounted across every navigation — this full-screen state is what a hard load or a sign-in
  // transition looks like, never what clicking a nav link looks like.
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
  // A "Meet Plan" academy (the `video.only` capability) manages the video classroom and nothing
  // else — collapse the whole nav to just that.
  const videoOnly =
    capabilities !== null && capabilities.includes("video.only");
  // An LMS-only client (the `lms.only` capability) sells courses and runs no school — collapse the
  // nav to the course platform plus the account screens every client still needs (docs/lms).
  const lmsOnly = capabilities !== null && capabilities.includes("lms.only");
  const hasLms = capabilities === null || capabilities.includes("lms");
  /** Switched off for this client (or not part of its modules) ⇒ the item does not exist for them. */
  const isLocked = (key: NavKey) => {
    const requiredCap = NAV_CAPABILITY[key];
    return (
      requiredCap !== undefined &&
      capabilities !== null &&
      !capabilities.includes(requiredCap)
    );
  };

  const items = NAV.filter((item) => {
    if (item.permission !== null && !can(item.permission)) return false;
    if (item.key === "dashboard" && isPlatformAdmin) return false;
    // The Audit Log link is Super-Admin-only in the sidebar. Academy owners retain
    // audit.read (the page and API stay reachable) — this just keeps it out of the
    // owner panel's navigation.
    if (item.key === "audit" && session.role !== "SUPER_ADMIN") return false;
    if (videoOnly && item.key !== "videoClassroom") return false;
    if (lmsOnly && !LMS_ONLY_KEYS.has(item.key)) return false;
    // A client without the course platform never sees any of its surfaces.
    if (!hasLms && LMS_EXTRA_KEYS.has(item.key)) return false;
    if (isLocked(item.key)) return false;
    return true;
  });
  const inEnteredAcademy =
    session.role === "SUPER_ADMIN" && session.academyId !== null;

  // The panel's own identity (see the Brand block below). A platform Super Admin has no academy, so
  // these fall back to the platform's mark; an academy with no logo uploaded gets its initials.
  const academyName = session.academy?.displayName || "Acadmyq";
  const academyLogo = session.academy?.logoUrl ?? null;
  const academyInitials = (session.academy?.displayName ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();

  const initials = session.user.fullName
    .split(" ")
    .slice(0, 2)
    .map((w: string) => w[0] ?? "")
    .join("")
    .toUpperCase();

  // `/dashboard`, `/admin` and `/lms` are exact-match only — otherwise `/admin` would greedily
  // claim the `/admin/plans` and `/admin/staff-departments` routes via startsWith, and the LMS
  // home would claim every `/lms/*` workspace page.
  const isExactOnly = (href: string) =>
    href === "/dashboard" || href === "/admin" || href === "/lms";
  const matches = (href: string) =>
    pathname === href || (!isExactOnly(href) && pathname.startsWith(href));
  const activeItem = items.find((item) => matches(item.href));

  /** The unread count owned by a nav item, if any. */
  const badgeFor = (key: NavKey): { count: number; label: string } | null => {
    if (key === "notifications" && notifCount > 0) {
      return { count: notifCount, label: `${notifCount} new notifications` };
    }
    if (key === "attendance" && attnCount > 0) {
      return {
        count: attnCount,
        label: `${attnCount} sessions awaiting attendance today`,
      };
    }
    if (key === "packages" && pkgCount > 0) {
      return {
        count: pkgCount,
        label: `${pkgCount} lesson packages need attention`,
      };
    }
    if (key === "studentReportReviews" && srCount > 0) {
      return {
        count: srCount,
        label: `${srCount} student reports awaiting review`,
      };
    }
    return null;
  };

  const commandItems: CommandItem[] = items.map((item) => ({
    key: item.key,
    label: t(`nav.${item.key}`),
    href: item.href,
    icon: item.icon,
    group: t(`navGroup.${item.group}`),
  }));

  /**
   * One sidebar link — shared by the flat group layout (tenant / entered admin) and the collapsible
   * module layout (platform Super Admin).
   *
   * Active state is a single signal: an accent bar on the inline-start edge plus a tint. The old
   * design used a tint AND a trailing dot, and then suppressed the dot whenever a badge was present
   * — so "active" looked like a different thing depending on your unread count.
   */
  const renderNavItem = ({ key, icon: Icon, href }: (typeof NAV)[number]) => {
    const isActive = matches(href);
    const badge = badgeFor(key);
    const label = t(`nav.${key}`);

    const link = (
      <Link
        key={key}
        href={href}
        data-nav={key}
        data-active={isActive || undefined}
        aria-current={isActive ? "page" : undefined}
        className={cn(
          "group relative flex items-center rounded-lg text-sm font-medium transition-colors duration-150",
          "focus-visible:ring-ring/50 outline-none focus-visible:ring-2",
          collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2.5",
          isActive
            ? "bg-primary/[0.12] text-primary font-semibold"
            : "text-sidebar-foreground hover:bg-sidebar-accent",
        )}
      >
        {/* The accent bar. Absolutely positioned so it never shifts the label; gold, because it is
            the one warm mark in a column of emerald and has to be findable at a glance. */}
        {isActive && (
          <span
            className="from-gold to-gold/40 absolute inset-y-1.5 start-0 w-[3px] rounded-full bg-gradient-to-b"
            aria-hidden
          />
        )}
        <Icon
          className={cn(
            "size-4 shrink-0 transition-colors",
            isActive
              ? "text-primary"
              : "text-sidebar-foreground/60 group-hover:text-sidebar-foreground",
          )}
          aria-hidden
        />
        {collapsed ? (
          <>
            <span className="sr-only">{label}</span>
            {/* No room for a pill on the rail — a dot still says "something is waiting here". */}
            {badge !== null && (
              <span
                className="bg-destructive absolute end-1.5 top-1.5 size-2 rounded-full"
                aria-hidden
              />
            )}
          </>
        ) : (
          <>
            <span className="flex-1 truncate">{label}</span>
            {badge !== null && <NavBadge count={badge.count} label={badge.label} />}
          </>
        )}
      </Link>
    );

    // Collapsed to the rail, the icon is all that's left — the tooltip is what names it.
    return collapsed ? (
      <Tooltip key={key} content={label} side="right">
        {link}
      </Tooltip>
    ) : (
      link
    );
  };

  /** A labelled section header; on the rail it degrades to a plain rule. */
  // The gold star that opens each group is the sign-in door's divider at chrome scale — enough to
  // carry the motif through the panel, small enough to stay a bullet rather than an ornament.
  const groupLabel = (label: string) =>
    collapsed ? (
      <div className="bg-sidebar-border mx-auto mb-1.5 h-px w-6" aria-hidden />
    ) : (
      <p className="text-sidebar-foreground/40 mb-1.5 flex select-none items-center gap-1.5 px-2.5 text-[10px] font-bold tracking-[0.1em] uppercase">
        <Octagram className="text-gold/70 size-2 shrink-0" />
        {label}
      </p>
    );

  return (
    <TooltipProvider>
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
          data-collapsed={collapsed}
          className={cn(
            "bg-sidebar text-sidebar-foreground border-sidebar-border relative fixed inset-y-0 z-30 flex shrink-0 flex-col border-e transition-[width,transform] duration-200 md:static md:h-full md:translate-x-0",
            // The rail keeps the icons on the same optical axis as the expanded list.
            collapsed ? "w-[4.5rem]" : "w-60",
            open
              ? "translate-x-0"
              : "max-md:-translate-x-full max-md:rtl:translate-x-full",
          )}
        >
          {/* The sidebar is a wall, so it carries the pattern: a khatam lattice down its full
              height, fading as it descends, over a faint emerald wash. Everything below sits on
              top of it (the nav is `relative`). */}
          <div
            className="text-primary pointer-events-none absolute inset-0 opacity-[0.09]"
            style={{
              maskImage: "linear-gradient(180deg, black 20%, transparent 100%)",
              WebkitMaskImage:
                "linear-gradient(180deg, black 20%, transparent 100%)",
            }}
            aria-hidden
          >
            <KhatamLattice id="sidebar-wall" size={56} className="size-full" />
          </div>
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "linear-gradient(180deg, oklch(0.519 0.158 163.2 / 0.10) 0%, transparent 42%)",
            }}
            aria-hidden
          />
          {/* A gold thread down the sidebar's outer edge — the frame's own hairline. */}
          <span
            aria-hidden
            className="via-gold/45 pointer-events-none absolute inset-y-0 end-0 w-px bg-gradient-to-b from-transparent to-transparent"
          />
          {/* ── Brand ──────────────────────────────────────────────────────
              WHOSE panel this is. A client sees their own academy — logo (or initials) and name,
              from the session (docs/lms/02) — because the door they came through was theirs and the
              chrome should not change hands behind it. A platform Super Admin has no academy, so
              the platform's own mark stays. The khatam lattice behind it and the gold hairline
              under it are the same ornament the sign-in door wears, at chrome strength. */}
          <div
            className={cn(
              "border-sidebar-border relative flex h-14 shrink-0 items-center overflow-hidden border-b",
              collapsed ? "justify-center px-2" : "justify-between px-4",
            )}
          >
            <div
              className="text-primary pointer-events-none absolute inset-0 opacity-[0.10]"
              style={{
                maskImage: "linear-gradient(180deg, black, transparent 88%)",
                WebkitMaskImage:
                  "linear-gradient(180deg, black, transparent 88%)",
              }}
            >
              <KhatamLattice id="sidebar-lattice" size={44} className="size-full" />
            </div>
            {/* The gold hairline sits ON the border, brightest under the name. */}
            <span
              aria-hidden
              className="via-gold/50 absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent to-transparent"
            />

            <div className="relative flex min-w-0 items-center gap-2.5">
              {academyLogo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={academyLogo}
                  alt={academyName}
                  className="ring-gold/30 size-8 shrink-0 rounded-lg bg-white object-contain p-0.5 ring-1"
                />
              ) : session.academy ? (
                <span
                  aria-hidden
                  className="bg-primary/12 text-primary ring-gold/30 flex size-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold ring-1"
                >
                  {academyInitials}
                </span>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src="/logo.png"
                  alt="Acadmyq"
                  className="size-8 shrink-0 object-contain"
                />
              )}
              {!collapsed && (
                <div className="min-w-0">
                  <div className="text-sidebar-foreground truncate text-[13px] font-semibold leading-tight">
                    {academyName}
                  </div>
                  <div className="text-sidebar-foreground/35 truncate text-[10px] leading-tight tracking-wide">
                    {t(`roles.${session.role}`)}
                  </div>
                </div>
              )}
            </div>
            <button
              type="button"
              className="text-sidebar-foreground/40 hover:bg-sidebar-accent hover:text-sidebar-foreground relative rounded-lg p-1.5 transition-colors md:hidden"
              onClick={() => setOpen(false)}
              aria-label={t("header.close")}
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>

          {/* ── Nav ────────────────────────────────────────────────────── */}
          <nav
            className={cn(
              "scroll-ornate relative flex-1 overflow-y-auto py-3",
              collapsed ? "px-2.5" : "px-3",
            )}
            data-testid="nav"
          >
            <div className="space-y-5">
              {isPlatformAdmin ? (
                // Platform Super Admin: ONE short flat list, no groups to decode (R2,
                // 04-CLIENT-FIRST-REDESIGN §3) — the module idea lives on the client, not here.
                <div className="space-y-0.5" data-testid="platform-nav">
                  {PLATFORM_NAV.map((key) =>
                    items.find((item) => item.key === key),
                  )
                    .filter((item) => item !== undefined)
                    .map((item) => renderNavItem(item))}
                </div>
              ) : (
                // Tenant (or an admin acting inside an academy): the flat labelled groups.
                NAV_GROUPS.map((group) => {
                  const groupItems = items.filter(
                    (item) => item.group === group,
                  );
                  if (groupItems.length === 0) return null;
                  return (
                    <div key={group}>
                      {groupLabel(t(`navGroup.${group}`))}
                      <div className="space-y-0.5">
                        {groupItems.map(renderNavItem)}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </nav>

          {/* ── Footer ─────────────────────────────────────────────────── */}
          <div className="border-sidebar-border border-t p-3">
            {inEnteredAcademy &&
              (collapsed ? (
                <Tooltip content={t("header.enteredAcademy")} side="right">
                  <button
                    type="button"
                    data-testid="entered-academy"
                    onClick={() => void exitAcademy()}
                    aria-label={t("header.exit")}
                    className="mb-2 flex w-full items-center justify-center rounded-lg border border-amber-300/40 bg-amber-50/80 py-2 text-amber-700 transition-colors hover:bg-amber-100/80 dark:border-amber-700/30 dark:bg-amber-950/30 dark:text-amber-400"
                  >
                    <LogOut className="size-3.5" aria-hidden />
                  </button>
                </Tooltip>
              ) : (
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
              ))}

            {/* The rail's collapse control. On the expanded sidebar it lives in the header, next
                to the breadcrumb — but there is no room for a label out here. */}
            <Tooltip
              content={collapsed ? t("header.expand") : t("header.collapse")}
              side="right"
            >
              <button
                type="button"
                onClick={toggleCollapsed}
                data-testid="sidebar-collapse"
                aria-label={
                  collapsed ? t("header.expand") : t("header.collapse")
                }
                aria-pressed={collapsed}
                className={cn(
                  "text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-ring/50 hidden w-full items-center rounded-lg px-2 py-2 text-[12px] font-medium transition-colors outline-none focus-visible:ring-2 md:flex",
                  collapsed ? "justify-center" : "gap-2.5",
                )}
              >
                {collapsed ? (
                  <PanelLeftOpen
                    className="size-4 shrink-0 rtl:-scale-x-100"
                    aria-hidden
                  />
                ) : (
                  <>
                    <PanelLeftClose
                      className="size-4 shrink-0 rtl:-scale-x-100"
                      aria-hidden
                    />
                    <span>{t("header.collapse")}</span>
                  </>
                )}
              </button>
            </Tooltip>
          </div>
        </aside>

        {/* ── Main area ───────────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* ── Header ───────────────────────────────────────────────── */}
          <header className="bg-background border-border relative flex h-14 shrink-0 items-center gap-3 border-b px-4 md:px-5">
            <span
              aria-hidden
              className="via-gold/35 absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent to-transparent"
            />
            {/* Mobile menu toggle */}
            <button
              type="button"
              className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring/50 rounded-lg p-1.5 transition-colors outline-none focus-visible:ring-2 md:hidden"
              aria-label={t("header.menu")}
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              <Menu className="size-5" aria-hidden />
            </button>

            {/* Breadcrumb. The group is context, the page is the anchor, and on a detail route the
                page name becomes a link back to its list — which is the one thing the old header
                (an icon, a slash, and a page name that never changed) could not do. */}
            {activeItem && (
              <nav
                aria-label={t("header.breadcrumb")}
                data-testid="breadcrumb"
                className="hidden min-w-0 items-center gap-1.5 text-sm md:flex"
              >
                <span className="text-muted-foreground/70 select-none">
                  {t(`navGroup.${activeItem.group}`)}
                </span>
                <span className="text-muted-foreground/40 select-none">/</span>
                {pathname === activeItem.href ? (
                  <span className="text-foreground font-semibold">
                    {t(`nav.${activeItem.key}`)}
                  </span>
                ) : (
                  <>
                    <Link
                      href={activeItem.href}
                      className="text-muted-foreground hover:text-foreground font-medium transition-colors"
                    >
                      {t(`nav.${activeItem.key}`)}
                    </Link>
                    <span className="text-muted-foreground/40 select-none">
                      /
                    </span>
                    <span className="text-foreground truncate font-semibold">
                      {t("header.details")}
                    </span>
                  </>
                )}
              </nav>
            )}

            {/* Right-side actions */}
            <div className="ms-auto flex items-center gap-1.5">
              <CommandPalette items={commandItems} />

              {can("notification.read") && (
                <Tooltip content={t("nav.notifications")} side="bottom">
                  <Link
                    href="/notifications"
                    data-testid="header-notifications"
                    aria-label={t("nav.notifications")}
                    className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring/50 relative rounded-lg p-2 transition-colors outline-none focus-visible:ring-2"
                  >
                    <BellRing className="size-4" aria-hidden />
                    {notifCount > 0 && (
                      <span className="bg-destructive text-white absolute -end-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums">
                        {notifCount > 9 ? "9+" : notifCount}
                      </span>
                    )}
                  </Link>
                </Tooltip>
              )}

              <ThemeToggle />

              <LocaleSwitcher onSwitch={changeLocale} />

              <div className="bg-border mx-1 h-5 w-px" aria-hidden />

              {/* The user chip is a real menu now. It used to be `cursor-default` — an avatar and a
                  name that looked clickable, did nothing, and duplicated the sidebar footer. */}
              <DropdownMenu>
                <DropdownMenuTrigger>
                  <button
                    type="button"
                    data-testid="header-user"
                    className="hover:bg-muted focus-visible:ring-ring/50 flex items-center gap-2 rounded-lg px-1.5 py-1.5 transition-colors outline-none focus-visible:ring-2"
                  >
                    <span className="from-primary/20 to-primary/[0.08] ring-primary/20 text-primary flex size-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-[11px] font-bold ring-1">
                      {initials}
                    </span>
                    <span className="text-foreground hidden text-[13px] font-medium leading-none sm:block">
                      {session.user.fullName.split(" ")[0]}
                    </span>
                    <ChevronDown
                      className="text-muted-foreground/50 hidden size-3.5 sm:block"
                      aria-hidden
                    />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuLabel>
                    <div data-testid="current-user">
                      <p className="text-foreground truncate text-sm font-semibold">
                        {session.user.fullName}
                      </p>
                      <p className="text-muted-foreground truncate text-xs">
                        {session.user.email}
                      </p>
                      <p className="text-muted-foreground/70 mt-1 text-[11px]">
                        {t(`roles.${session.role}`)}
                      </p>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {can("specialization.manage") && !lmsOnly && (
                    <DropdownMenuItem
                      onClick={() => router.push("/settings")}
                      closeOnClick
                    >
                      <Settings aria-hidden />
                      {t("nav.settings")}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    onClick={() => router.push("/docs/teacher-guide")}
                    closeOnClick
                  >
                    <LifeBuoy aria-hidden />
                    {t("header.help")}
                  </DropdownMenuItem>
                  {inEnteredAcademy && (
                    <DropdownMenuItem
                      onClick={() => void exitAcademy()}
                      closeOnClick
                    >
                      <Building2 aria-hidden />
                      {t("header.exitAcademy")}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => void signOut()}
                    destructive
                    closeOnClick
                  >
                    <LogOut aria-hidden />
                    {t("auth.signOut")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>

          {/* The width cap stops tables from stretching to the far edge of a 27" display, where the
              eye has to travel the whole desk to tie a row back to its header. */}
          <main className="scroll-ornate relative min-w-0 flex-1 overflow-auto">
            {/* The same lattice as the sidebar, at a whisper: enough to make the canvas feel like
                part of the frame, faint enough that a table never fights it. Fixed to the viewport
                so it does not slide around as the page scrolls. */}
            <div
              className="text-primary pointer-events-none fixed inset-0 opacity-[0.05]"
              style={{
                maskImage:
                  "radial-gradient(120% 90% at 50% 0%, black, transparent 78%)",
                WebkitMaskImage:
                  "radial-gradient(120% 90% at 50% 0%, black, transparent 78%)",
              }}
              aria-hidden
            >
              <KhatamLattice id="canvas-lattice" size={92} className="size-full" />
            </div>
            <div
              key={pathname}
              className="animate-page-enter relative mx-auto max-w-[1600px] p-4 md:p-6"
            >
              <OrnateRule className="mb-4 md:mb-5" />
              {children}
            </div>
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
