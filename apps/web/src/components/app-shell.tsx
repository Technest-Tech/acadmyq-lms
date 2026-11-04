"use client";

import {
  AlertTriangle,
  Award,
  BookOpen,
  CircleDollarSign,
  BarChart3,
  BellRing,
  Briefcase,
  Building2,
  CalendarCheck2,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  Eye,
  Gauge,
  FileCheck2,
  Globe,
  GraduationCap,
  History,
  Inbox,
  Coins,
  KeyRound,
  LayoutDashboard,
  Library,
  LibraryBig,
  LifeBuoy,
  ListChecks,
  LogOut,
  Menu,
  MessageCircle,
  MonitorPlay,
  Newspaper,
  NotebookPen,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Layers,
  PackageCheck,
  AlarmClock,
  Calculator,
  ReceiptText,
  Vault,
  Scale,
  Settings,
  ShieldCheck,
  ToggleLeft,
  Users,
  UsersRound,
  UserCheck,
  UserCog,
  Crown,
  UserPlus,
  Video,
  ShoppingBag,
  Wallet,
  X,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useState, type ComponentType } from "react";
import { CollectQuickAction } from "@/components/accounting/collect-quick-action";
import { useAuth } from "@/components/auth-provider";
import { ChangePasswordModal } from "@/components/change-password-modal";
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
  getBookingSummary,
  getCourseSalesSummary,
  getDaySessionCount,
  getInvoiceFollowUp,
  getLessonPackageSummary,
  getNotificationsSummary,
  getTrialSummary,
} from "@/lib/api";
import {
  KhatamLattice,
  Octagram,
  OrnateRule,
} from "@/components/ornaments";
import { applyWorkspaceTheme, rememberedCentre, rememberWorkspace } from "@/lib/branding";
import { getEnrolmentSummary } from "@/lib/enrolment-api";
import { getGroupLessonsSummary } from "@/lib/groups-api";
import { roleLabel } from "@/lib/roles";
import { getSubscriptionsSummary } from "@/lib/subscriptions-api";
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
  | "demoRequests"
  | "adminFinance"
  | "guardians"
  | "students"
  | "groups"
  | "groupsAll"
  | "groupsLessons"
  | "groupsStudents"
  | "groupsPayments"
  | "groupsReports"
  | "teachers"
  | "staff"
  | "schedule"
  | "videoClassroom"
  | "trials"
  | "enrolment"
  | "crm"
  | "lmsHome"
  | "courses"
  | "lmsBooks"
  | "lmsBlog"
  | "lmsBookings"
  | "lmsQuizzes"
  | "lmsLearners"
  | "lmsCodes"
  | "lmsSales"
  | "lmsPayments"
  | "lmsSite"
  | "attendance"
  | "supervision"
  | "studentReports"
  | "studentReportReviews"
  | "certificates"
  | "billing"
  | "invoices"
  | "accounting"
  | "accountingOverview"
  | "accountingArrears"
  | "accountingTreasury"
  | "accountingReports"
  | "packages"
  | "packagesDue"
  | "packagesFinished"
  | "subsDue"
  | "subsOpen"
  | "subsFinished"
  | "subsOutside"
  | "centreSubscriptions"
  | "centreAdmissions"
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
  | "teaching"
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
 * The learning centre's sidebar (`SessionAcademy.profile === "CENTRE"`, App\Support\AcademyProfile).
 * Same items, a different shape: a centre's day is its GROUPS, their timetable and their sheets, so
 * those open a "Teaching" group of their own at the top; the people follow; the money keeps its
 * group. Nothing here changes what a link does — only where it sits and what it is called. A Quran
 * academy never reads any of it: its sidebar is NAV_GROUPS and `item.group`, byte for byte.
 */
const CENTRE_NAV_GROUPS: readonly NavGroup[] = [
  "general",
  "teaching",
  "people",
  "lms",
  "financial",
  "platform",
  "system",
];

/** Where an item sits for a centre when that differs from its home group. */
const CENTRE_GROUP_OF: Partial<Record<NavKey, NavGroup>> = {
  groups: "teaching",
  groupsAll: "teaching",
  groupsLessons: "teaching",
  groupsStudents: "teaching",
  groupsPayments: "teaching",
  groupsReports: "teaching",
  schedule: "teaching",
  attendance: "teaching",
  // A centre's packages ARE its lesson subscriptions (the `*Centre` labels below).
  packagesDue: "teaching",
  packages: "teaching",
  packagesFinished: "teaching",
  subsDue: "teaching",
  subsOpen: "teaching",
  subsFinished: "teaching",
  subsOutside: "teaching",
  centreSubscriptions: "teaching",
  centreAdmissions: "teaching",
  trials: "teaching",
  enrolment: "teaching",
  certificates: "teaching",
  videoClassroom: "teaching",
  crm: "people",
};

/** The order inside each group for a centre; anything unlisted keeps its NAV order after these. */
const CENTRE_ORDER: readonly NavKey[] = [
  "groups",
  "schedule",
  "attendance",
  "centreSubscriptions",
  "centreAdmissions",
  "subsDue",
  "subsOpen",
  "subsFinished",
  "subsOutside",
  "packagesDue",
  "packages",
  "packagesFinished",
  "trials",
  "enrolment",
  "certificates",
  "videoClassroom",
  "students",
  "guardians",
  "teachers",
  "crm",
  "accounting",
  "payroll",
  "discountsAwards",
  "myPayroll",
  "financialStats",
  "billing",
];

/**
 * Items a centre does not list. The month-bill page is the Quran academy's money screen; a centre on
 * receipts has the Accounting section for the same job. The groups' lessons board is the very
 * component the Attendance page shows a centre, and "group students" is every student a centre has
 * — the Students page carries that board's call-list flags for a centre instead. The Quran-only
 * FEATURES (supervision, the teacher rubric, the memorisation report) are not here: the centre
 * preset switches them off, so NAV_CAPABILITY already hides them — and the server refuses them,
 * which a hidden link never does.
 */
const CENTRE_HIDDEN_KEYS = new Set<NavKey>(["invoices", "groupsLessons", "groupsStudents", "packages", "packagesDue", "packagesFinished"]);

/**
 * The centre's subscriptions pages (docs/centre-profile/01-PRIVATE-SUBSCRIPTION-SPLIT.md): four views
 * of `/subscriptions`, the rows under the "الاشتراكات" dropdown. They replace the packages rows for a
 * centre — the hour-package pages keep serving the Quran academy and are hidden here — and exist for
 * no other shape: the server answers 402 on them without `centre`.
 */
const CENTRE_ONLY_KEYS = new Set<NavKey>(["subsDue", "subsOpen", "subsFinished", "subsOutside"]);

/**
 * The two dropdowns only a centre's sidebar has, gathering pages that were each a row of their own.
 * Links to nothing by themselves: they exist for the children below, and are dropped without any.
 */
const CENTRE_ONLY_PARENTS = new Set<NavKey>(["centreSubscriptions", "centreAdmissions"]);
const CENTRE_PARENT_OF: Partial<Record<NavKey, NavKey>> = {
  subsDue: "centreSubscriptions",
  subsOpen: "centreSubscriptions",
  subsFinished: "centreSubscriptions",
  subsOutside: "centreSubscriptions",
  packagesDue: "centreSubscriptions",
  packages: "centreSubscriptions",
  packagesFinished: "centreSubscriptions",
  trials: "centreAdmissions",
  enrolment: "centreAdmissions",
};

/**
 * A centre's phone bar: the first four of these the signed-in person can reach. The full menu stays
 * behind the header's button. The screens a front desk or a teacher returns to all day, one thumb away instead of behind a drawer.
 */
const CENTRE_BOTTOM_NAV: readonly NavKey[] = [
  "dashboard",
  "groups",
  "attendance",
  "students",
  "accounting",
  "schedule",
  "myPayroll",
];

/** Items whose label a centre reads differently (`nav.<key>Centre`). */
const CENTRE_LABEL_KEYS = new Set<NavKey>([
  "packages",
  "packagesDue",
  "packagesFinished",
  "trials",
  "schedule",
  "groupsReports",
]);

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
  /** A sub-page: rendered inside its parent's dropdown instead of on the group's own list. */
  parent?: NavKey;
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

  { key: "centreSubscriptions", icon: Crown, permission: null, href: "/subscriptions?view=due", group: "teaching" },
  // The centre's subscriptions, one row per view: what is owed (carries the badge), the open blocks,
  // the finished ones waiting for the next sale, and students taking lessons outside any block.
  { key: "subsDue", icon: CircleDollarSign, permission: "package.read", href: "/subscriptions?view=due", group: "teaching" },
  { key: "subsOpen", icon: Layers, permission: "package.read", href: "/subscriptions?view=open", group: "teaching" },
  { key: "subsFinished", icon: PackageCheck, permission: "package.read", href: "/subscriptions?view=finished", group: "teaching" },
  { key: "subsOutside", icon: AlertTriangle, permission: "package.read", href: "/subscriptions?view=outside", group: "teaching" },
  { key: "centreAdmissions", icon: UserPlus, permission: null, href: "/trials", group: "teaching" },

  // ── People ──────────────────────────────────────────────────────────────
  {
    key: "students",
    icon: GraduationCap,
    permission: "student.read",
    href: "/students",
    group: "people",
  },
  // Group classes (docs/groups) — one teacher, several students, a weekly timetable and an
  // attendance sheet of their own. Next to the students because that is where a language centre
  // looks for its classes; hidden for a client the feature is switched off for.
  {
    key: "groups",
    icon: UsersRound,
    permission: "group.read",
    href: "/groups",
    group: "people",
  },
  // …a section of its own, opened as a dropdown: the groups, their lessons and sheets, their
  // students, their money (money roles only) and the reports.
  { key: "groupsAll", icon: Layers, permission: "group.read", href: "/groups", group: "people", parent: "groups" },
  { key: "groupsLessons", icon: ClipboardCheck, permission: "group.read", href: "/groups/lessons", group: "people", parent: "groups" },
  { key: "groupsStudents", icon: GraduationCap, permission: "group.read", href: "/groups/students", group: "people", parent: "groups" },
  { key: "groupsPayments", icon: Wallet, permission: "invoice.read", href: "/groups/payments", group: "people", parent: "groups" },
  { key: "groupsReports", icon: BarChart3, permission: "group.read", href: "/groups/reports", group: "people", parent: "groups" },
  {
    key: "attendance",
    icon: ClipboardCheck,
    permission: "session.read",
    href: "/attendance",
    group: "people",
  },
  // How promptly each supervisor followed the day's lessons and how promptly outcomes were
  // recorded — the measurement behind the "Following" button on the attendance rows above.
  {
    key: "supervision",
    icon: Eye,
    permission: "supervision.stats",
    href: "/supervision",
    group: "people",
  },
  // Teacher performance: how each teacher enters, reports and attends — measured from the Enter
  // button, the report log and attendance, so it sits with the people it measures, not with pay.
  {
    key: "teacherQuality",
    icon: Gauge,
    // A statistics page (PermissionCatalog::STATISTICS) — not the quality reports themselves.
    permission: "teacher_quality.insights",
    href: "/teacher-quality",
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
  // The centre's enrolment inbox (docs/centre-profile Phase 2 §6) — the front of the trials pipeline.
  {
    key: "enrolment",
    icon: ClipboardList,
    permission: "trial.read",
    href: "/enrolment",
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
  // Books & PDFs (docs/lms/11) — the catalogue's second shelf. Same capability as Courses: a client
  // who lets someone publish courses is not meaningfully protected by withholding books from them.
  {
    key: "lmsBooks",
    icon: Library,
    permission: "course.read",
    href: "/lms/books",
    group: "lms",
  },
  // The course site's blog (docs/lms/12) — articles that bring search traffic to the catalogue.
  // Same capability as Courses and Books: it is the same public site, written by the same people.
  {
    key: "lmsBlog",
    icon: Newspaper,
    permission: "course.read",
    href: "/lms/blog",
    group: "lms",
  },
  // Booking requests (docs/lms/13) — "book a consultation", "book a course": the inbox every
  // course-site booking form feeds, and the forms themselves. Its own capability: the person who
  // returns "call me back" requests is not necessarily the one building courses.
  {
    key: "lmsBookings",
    icon: CalendarCheck2,
    permission: "booking.read",
    href: "/lms/bookings",
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
  // The sales desk (docs/lms/10): the order queue, the transfer receipts awaiting a decision, and
  // what the catalogue has actually made. Read-gated; the decisions need `course_order.manage`.
  {
    key: "lmsSales",
    icon: ShoppingBag,
    permission: "course_order.read",
    href: "/lms/sales",
    group: "lms",
  },
  // Where that money lands — the client's InstaPay handle, wallet number and bank account.
  {
    key: "lmsPayments",
    icon: Wallet,
    permission: "course_order.read",
    href: "/lms/payments",
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
  // Accounting (docs/groups/01-ACCOUNTING.md) — a section of its own, opened as a dropdown, laid
  // out by the question an accountant asks rather than by table: how is the month going (Overview),
  // who owes (Arrears, with a family's statement as an action on its row), where is the money and
  // what moved (Treasury: accounts, receipts, expenses as tabs) and the reports (daily collections,
  // income vs expenses, group collections as tabs). Nine pages were cut to these four; the old URLs
  // redirect to the tab that replaced them. Only for a client on receipts (`accounting`, opt-in);
  // every other client never sees any of it.
  {
    key: "accounting",
    icon: Calculator,
    permission: "invoice.read",
    href: "/accounting",
    group: "financial",
  },
  { key: "accountingOverview", icon: LayoutDashboard, permission: "invoice.read", href: "/accounting", group: "financial", parent: "accounting" },
  { key: "accountingArrears", icon: AlarmClock, permission: "invoice.read", href: "/accounting/arrears", group: "financial", parent: "accounting" },
  { key: "accountingTreasury", icon: Vault, permission: "invoice.read", href: "/accounting/treasury", group: "financial", parent: "accounting" },
  { key: "accountingReports", icon: BarChart3, permission: "invoice.read", href: "/accounting/reports", group: "financial", parent: "accounting" },
  // Lesson packages sit directly under Invoices because they ARE invoicing — the same money on a
  // different clock (a block of hours instead of a calendar month), for the students on that mode.
  // Three pages: Due (the payments to collect — payment is up front, so a block that opened today
  // is already due; carries the red badge), Open (the live balances) and Finished (history).
  {
    key: "packagesDue",
    icon: CircleDollarSign,
    permission: "package.read",
    href: "/packages/due",
    group: "financial",
  },
  {
    key: "packages",
    icon: Layers,
    permission: "package.read",
    href: "/packages",
    group: "financial",
  },
  {
    key: "packagesFinished",
    icon: PackageCheck,
    permission: "package.read",
    href: "/packages/finished",
    group: "financial",
  },
  {
    key: "payroll",
    icon: Wallet,
    permission: "payout.read",
    href: "/payroll",
    group: "financial",
  },
  // Payroll's management surface sits directly under it — it only ever moves money on the
  // statements the item above shows.
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
  {
    key: "demoRequests",
    icon: Inbox,
    permission: "platform.manage",
    href: "/admin/demo-requests",
    group: "platform",
  },
  {
    key: "adminFinance",
    icon: Coins,
    permission: "platform.manage",
    href: "/admin/finance",
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
  // Team & permissions: the people who sign in AND the roles they sign in as, one page with two
  // tabs (/staff, /staff?tab=roles). /roles redirects there. Shown to whoever holds either half —
  // see the filter below.
  {
    key: "staff",
    icon: Users,
    permission: null,
    href: "/staff",
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
  "adminFinance", // the owner's OWN income book — deals, installments, payments (an island)
  "plans", // catalog, one tab per module + add-ons
  "adminVideo", // Video Ops (platform-wide health/usage)
  "adminLms", // Course Platform Ops (LMS clients, usage, per-client controls)
  "adminAutomation", // WhatsApp Ops (gateway health/activity)
  "demoRequests", // the marketing site's form — prospects, before they are clients
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
const NAV_CAPABILITY: Partial<Record<NavKey, string | readonly string[]>> = {
  videoClassroom: "video.conferencing",
  staff: "staff",
  academyRoles: "custom_roles",
  trials: "trials",
  enrolment: "centre",
  crm: "crm",
  groups: "groups",
  groupsAll: "groups",
  groupsLessons: "groups",
  groupsStudents: "groups",
  groupsPayments: "groups",
  groupsReports: "groups",
  courses: "lms",
  lmsBooks: "lms",
  lmsBlog: "lms",
  lmsBookings: "lms",
  lmsSales: "lms",
  lmsPayments: "lms",
  certificates: "certificates",
  studentReports: "student_reports",
  studentReportReviews: "student_reports",
  invoices: "invoicing",
  accounting: "accounting",
  accountingOverview: "accounting",
  accountingArrears: "accounting",
  accountingTreasury: "accounting",
  // The reports page shows its group tab only to a client that also holds `groups`.
  accountingReports: "accounting",
  // Packages ARE invoicing (the same money on a different clock) and the server keeps them inside
  // that gate — but they carry their own switch on top, so an academy that bills monthly is never
  // offered the second clock.
  packages: "packages",
  packagesDue: "packages",
  packagesFinished: "packages",
  subsDue: "centre",
  subsOpen: "centre",
  subsFinished: "centre",
  subsOutside: "centre",
  payroll: "payroll",
  // Teacher performance and Discounts & Awards share one switch of their own, so an academy can
  // pay teachers without measuring them.
  teacherQuality: "teacher_quality",
  discountsAwards: "teacher_quality",
  myPayroll: "payroll",
  supervision: "supervision",
  financialStats: "financial_statistics",
};

/**
 * Items a client stops seeing once it holds a capability that brings a fuller page for the same job.
 * The Groups section's "Payments" is the classic month's group money; a client on receipts gets the
 * Accounting section's group collection & profit page instead. Every other client keeps it as is.
 */
const NAV_REPLACED_BY: Partial<Record<NavKey, string>> = {
  groupsPayments: "accounting",
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
  "lmsBooks",
  "lmsBlog",
  "lmsBookings",
  "lmsQuizzes",
  "lmsLearners",
  "lmsCodes",
  "lmsSales",
  "lmsPayments",
  "lmsSite",
]);
const LMS_ONLY_KEYS = new Set<NavKey>([
  "lmsHome",
  "courses",
  "lmsBooks",
  "lmsBlog",
  "lmsBookings",
  "lmsQuizzes",
  "lmsLearners",
  "lmsCodes",
  "lmsSales",
  "lmsPayments",
  "lmsSite",
  "plan",
]);

const SIDEBAR_COLLAPSED_KEY = "sidebarCollapsed";

/** The unread pill. One component, because three hand-rolled copies drift. */
/**
 * A sidebar badge's heartbeat: fetch now and every minute — but only while this tab is on screen.
 * Staff keep several tabs open, and each used to poll every badge forever; a hidden tab now asks
 * nothing and catches up the moment it is looked at again. Returns the cleanup.
 */
function pollWhileVisible(refresh: () => void, ms = 60_000): () => void {
  const visible = () => typeof document === "undefined" || document.visibilityState !== "hidden";
  refresh();
  const id = setInterval(() => {
    if (visible()) refresh();
  }, ms);
  const onVisibility = () => {
    if (visible()) refresh();
  };
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    clearInterval(id);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

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
  const tRoles = useTranslations("roles");
  const { session, loading, can, signOut, exitAcademy, changeLocale } =
    useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [notifCount, setNotifCount] = useState(0);
  const [srCount, setSrCount] = useState(0);
  const [attnCount, setAttnCount] = useState(0);
  const [pkgCount, setPkgCount] = useState(0);
  // A centre's subscriptions: what is owed, and the students taking lessons outside any block.
  const [subsDueCount, setSubsDueCount] = useState(0);
  const [subsOutsideCount, setSubsOutsideCount] = useState(0);
  const [salesCount, setSalesCount] = useState(0);
  const [bookingCount, setBookingCount] = useState(0);
  const [trialCount, setTrialCount] = useState(0);
  const [enrolCount, setEnrolCount] = useState(0);
  const [groupOwedCount, setGroupOwedCount] = useState(0);
  const [invoiceFollowUpCount, setInvoiceFollowUpCount] = useState(0);
  // Which sidebar dropdowns are open. Closed by default — only a click opens or closes one.
  const [openParents, setOpenParents] = useState<Set<NavKey>>(() => new Set());
  // The academy's resolved plan capabilities, used to lock nav items the plan doesn't include.
  // They arrive with the session itself, so by the time we have a session we have these too — there
  // is no separate loading state to guard, and no window in which a video-only ("Meet Plan") academy
  // could flash the full academy chrome. `null` = a platform Super Admin, who has no plan.
  const capabilities = session?.capabilities ?? null;
  // The workspace's SHAPE follows the academy's profile (CENTRE_* above); an older session with no
  // profile is a Quran academy. The `centre` feature switch alone still turns "packages" into
  // "subscriptions", as it did before profiles — a Quran academy switched onto the centre's ways
  // keeps reading its money the centre's way.
  const centreShape = (session?.academy?.profile ?? "QURAN") === "CENTRE";
  const centre = (capabilities?.includes("centre") ?? false) || centreShape;
  const navLabel = (key: NavKey): string =>
    (centre && (key === "packages" || key === "packagesDue" || key === "packagesFinished")) ||
    (centreShape && CENTRE_LABEL_KEYS.has(key))
      ? t(`nav.${key}Centre`)
      : t(`nav.${key}`);

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
    const stop = pollWhileVisible(refresh);
    return () => {
      alive = false;
      stop();
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
    const stop = pollWhileVisible(refresh);
    return () => {
      alive = false;
      stop();
    };
  }, [session, can, pathname]);

  // Due-packages badge: how many packages still have money owed on them, open or finished.
  // Deliberately not "unread": the count is derived from package state, so it clears when the
  // money arrives rather than when it is seen.
  useEffect(() => {
    if (session === null || !can("package.read")) {
      setPkgCount(0);
      return;
    }
    let alive = true;
    const refresh = () =>
      getLessonPackageSummary()
        .then((s) => alive && setPkgCount(s.due))
        .catch(() => {});
    const stop = pollWhileVisible(refresh);
    return () => {
      alive = false;
      stop();
    };
  }, [session, can, pathname]);

  // Subscriptions badges (a centre, docs/centre-profile/01): blocks with money owed, and students
  // with a lesson outside any block. Derived like the packages badge — they clear when the desk acts.
  useEffect(() => {
    if (session === null || !centreShape || !can("package.read") || !(capabilities?.includes("centre") ?? false)) {
      setSubsDueCount(0);
      setSubsOutsideCount(0);
      return;
    }
    let alive = true;
    const refresh = () =>
      getSubscriptionsSummary()
        .then((s) => {
          if (!alive) return;
          setSubsDueCount(s.due_count);
          setSubsOutsideCount(s.outside_students);
        })
        .catch(() => {});
    const stop = pollWhileVisible(refresh);
    return () => {
      alive = false;
      stop();
    };
  }, [session, can, pathname, centreShape, capabilities]);

  // Sales badge (docs/lms/10 §4): transfer receipts waiting on a human. Like the packages badge it
  // is DERIVED state, not "unread" — it clears when the client actually decides, not when they look.
  useEffect(() => {
    if (session === null || !can("course_order.read") || !(capabilities?.includes("lms") ?? true)) {
      setSalesCount(0);
      return;
    }
    let alive = true;
    const refresh = () =>
      getCourseSalesSummary()
        .then((s) => alive && setSalesCount(s.stats.pending_receipts))
        .catch(() => {});
    const stop = pollWhileVisible(refresh);
    return () => {
      alive = false;
      stop();
    };
  }, [session, can, capabilities, pathname]);

  // Bookings badge (docs/lms/13): requests nobody has picked up yet. Derived, like the sales badge —
  // it clears when someone moves the request to "contacted", not when they glance at the inbox.
  useEffect(() => {
    if (session === null || !can("booking.read") || !(capabilities?.includes("lms") ?? true)) {
      setBookingCount(0);
      return;
    }
    let alive = true;
    const refresh = () =>
      getBookingSummary()
        .then((s) => alive && setBookingCount(s.stats.new))
        .catch(() => {});
    const stop = pollWhileVisible(refresh);
    return () => {
      alive = false;
      stop();
    };
  }, [session, can, capabilities, pathname]);

  // Trials badge: trials whose slot ENDED with no decision (attended / no-show). Derived like the
  // packages badge — it clears when someone decides, not when someone looks.
  useEffect(() => {
    if (session === null || !can("trial.read") || !(capabilities?.includes("trials") ?? true)) {
      setTrialCount(0);
      return;
    }
    let alive = true;
    const refresh = () =>
      getTrialSummary()
        .then((s) => alive && setTrialCount(s.needs_decision ?? 0))
        .catch(() => {});
    const stop = pollWhileVisible(refresh);
    return () => {
      alive = false;
      stop();
    };
  }, [session, can, capabilities, pathname]);

  // Enrolment badge (docs/centre-profile Phase 2 §6): requests from the public form nobody has picked
  // up yet. Derived like the bookings badge — it clears when someone moves the request on.
  useEffect(() => {
    if (session === null || !can("trial.read") || !(capabilities?.includes("centre") ?? false)) {
      setEnrolCount(0);
      return;
    }
    let alive = true;
    const refresh = () =>
      getEnrolmentSummary()
        .then((s) => alive && setEnrolCount(s.new ?? 0))
        .catch(() => {});
    const stop = pollWhileVisible(refresh);
    return () => {
      alive = false;
      stop();
    };
  }, [session, can, capabilities, pathname]);

  // Group sheets owed: group lessons whose time passed with no attendance recorded. Derived like the
  // trials badge — it clears when the sheet is saved, not when someone looks.
  useEffect(() => {
    if (session === null || !can("group.read") || !(capabilities?.includes("groups") ?? true)) {
      setGroupOwedCount(0);
      return;
    }
    let alive = true;
    const refresh = () =>
      getGroupLessonsSummary()
        .then((s) => alive && setGroupOwedCount(s.owed ?? 0))
        .catch(() => {});
    const stop = pollWhileVisible(refresh);
    return () => {
      alive = false;
      stop();
    };
  }, [session, can, capabilities, pathname]);

  // Custom bills a day old and still unpaid. Derived like the packages badge — it clears when the
  // money arrives, not when someone looks.
  useEffect(() => {
    if (session === null || !can("invoice.read") || !(capabilities?.includes("invoicing") ?? true)) {
      setInvoiceFollowUpCount(0);
      return;
    }
    let alive = true;
    const refresh = () =>
      getInvoiceFollowUp()
        .then((s) => alive && setInvoiceFollowUpCount(s.count))
        .catch(() => {});
    const stop = pollWhileVisible(refresh);
    return () => {
      alive = false;
      stop();
    };
  }, [session, can, capabilities, pathname]);

  // Before paint. While the session is still on its way, the workspace this browser last opened
  // stands in for it (a sign-in, which the script in the (app) layout does not see), so a centre's
  // loading screen is violet too. Signing out clears the session, so the login screen is back on the
  // default colours.
  useLayoutEffect(() => {
    if (loading) {
      applyWorkspaceTheme(rememberedCentre());
      return;
    }
    applyWorkspaceTheme(centreShape);
    if (session !== null) rememberWorkspace(centreShape);
  }, [loading, session, centreShape]);

  // Off the (app) area altogether (a shared link opened in this tab): not a centre's page any more.
  useEffect(
    () => () => {
      delete document.documentElement.dataset.profile;
    },
    [],
  );

  // A centre's dropdown opens by itself on the page it holds, so the sidebar always shows where you are.
  useEffect(() => {
    if (!centreShape) return;
    const holder = NAV.find((item) => {
      const parent = CENTRE_PARENT_OF[item.key] ?? item.parent;
      return parent !== undefined && pathname.startsWith(item.href);
    });
    const parent = holder ? (CENTRE_PARENT_OF[holder.key] ?? holder.parent) : undefined;
    if (parent !== undefined) setOpenParents((prev) => (prev.has(parent) ? prev : new Set(prev).add(parent)));
  }, [centreShape, pathname]);

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
    if (requiredCap === undefined || capabilities === null) return false;
    const required: readonly string[] = typeof requiredCap === "string" ? [requiredCap] : requiredCap;
    return required.some((cap) => !capabilities.includes(cap));
  };
  /** Replaced for this client by a fuller page elsewhere (NAV_REPLACED_BY), so not listed twice. */
  const isReplaced = (key: NavKey) => {
    const by = NAV_REPLACED_BY[key];
    return by !== undefined && capabilities !== null && capabilities.includes(by);
  };

  const items = NAV.filter((item) => {
    if (item.permission !== null && !can(item.permission)) return false;
    if (item.key === "staff" && !can("staff.read") && !can("role.manage")) return false;
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
    if (isReplaced(item.key)) return false;
    // A centre's shape (CENTRE_HIDDEN_KEYS): the month-bill page gives way to Accounting.
    if (centreShape && CENTRE_HIDDEN_KEYS.has(item.key)) return false;
    if (!centreShape && (CENTRE_ONLY_PARENTS.has(item.key) || CENTRE_ONLY_KEYS.has(item.key))) return false;
    return true;
  })
    .map((item) => {
      const parent = centreShape ? CENTRE_PARENT_OF[item.key] : undefined;
      return parent !== undefined ? { ...item, parent } : item;
    })
    .filter((item, _, all) => !CENTRE_ONLY_PARENTS.has(item.key) || all.some((other) => other.parent === item.key));
  // The centre's sidebar regroups and reorders the same items (CENTRE_GROUP_OF / CENTRE_ORDER);
  // a Quran academy's is the NAV order inside each item's own group, as it always was.
  const navGroups = centreShape ? CENTRE_NAV_GROUPS : NAV_GROUPS;
  const groupOf = (item: (typeof NAV)[number]): NavGroup =>
    centreShape ? (CENTRE_GROUP_OF[item.key] ?? item.group) : item.group;
  const orderIn = (list: (typeof NAV)[number][]): (typeof NAV)[number][] => {
    if (!centreShape) return list;
    const rank = (key: NavKey) => {
      const i = CENTRE_ORDER.indexOf(key);
      return i === -1 ? CENTRE_ORDER.length : i;
    };
    return [...list].sort((a, b) => rank(a.key) - rank(b.key));
  };
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
    href === "/dashboard" ||
    href === "/admin" ||
    href === "/lms" ||
    // Open packages must not also light up on its siblings, /packages/due and /packages/finished.
    href === "/packages" ||
    // The Accounting overview must not light up on its own sub-pages.
    href === "/accounting";
  const matches = (href: string) => {
    // "All groups" is /groups and every group's own page (/groups/<uuid>) — never its sibling
    // pages (/groups/lessons, …), which own their own link.
    if (href === "/groups") {
      return pathname === "/groups" || /^\/groups\/[0-9a-f]{8}-[0-9a-f-]{27}/i.test(pathname);
    }
    // The subscriptions views share one path and differ by `?view=`: the row whose view is open
    // lights up, and only that one (a page with no view reads as "open").
    const query = href.indexOf("?");
    if (query !== -1) {
      const path = href.slice(0, query);
      if (pathname !== path) return false;
      const wanted = new URLSearchParams(href.slice(query + 1)).get("view");
      const current = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("view");
      return (current ?? "open") === wanted;
    }
    return pathname === href || (!isExactOnly(href) && pathname.startsWith(href));
  };
  /** A nav item that opens a dropdown: it has sub-pages among the visible items. */
  const childrenOf = (key: NavKey) => items.filter((item) => item.parent === key);
  const activeItem =
    items.find((item) => item.parent !== undefined && matches(item.href)) ??
    items.find((item) => matches(item.href));

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
    if (key === "invoices" && invoiceFollowUpCount > 0) {
      return {
        count: invoiceFollowUpCount,
        label: `${invoiceFollowUpCount} custom bills unpaid for over a day`,
      };
    }
    if (key === "packagesDue" && pkgCount > 0) {
      return {
        count: pkgCount,
        label: `${pkgCount} packages awaiting payment`,
      };
    }
    if (key === "subsDue" && subsDueCount > 0) {
      return { count: subsDueCount, label: `${subsDueCount} subscriptions awaiting payment` };
    }
    if (key === "subsOutside" && subsOutsideCount > 0) {
      return { count: subsOutsideCount, label: `${subsOutsideCount} students outside a subscription` };
    }
    if (key === "lmsSales" && salesCount > 0) {
      return {
        count: salesCount,
        label: `${salesCount} payment receipts awaiting review`,
      };
    }
    if (key === "groupsLessons" && groupOwedCount > 0) {
      return {
        count: groupOwedCount,
        label: `${groupOwedCount} group lessons waiting for attendance`,
      };
    }
    if (key === "trials" && trialCount > 0) {
      return {
        count: trialCount,
        label: `${trialCount} trials waiting for a decision`,
      };
    }
    if (key === "lmsBookings" && bookingCount > 0) {
      return {
        count: bookingCount,
        label: `${bookingCount} new booking requests`,
      };
    }
    if (key === "enrolment" && enrolCount > 0) {
      return {
        count: enrolCount,
        label: `${enrolCount} new enrolment requests`,
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

  const commandItems: CommandItem[] = items.filter((item) => childrenOf(item.key).length === 0).map((item) => ({
    key: item.key,
    label: navLabel(item.key),
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
    const label = navLabel(key);

    const link = (
      <Link
        key={key}
        href={href}
        data-nav={key}
        data-active={isActive || undefined}
        aria-current={isActive ? "page" : undefined}
        className={cn(
          "group relative flex items-center font-medium transition-colors duration-150",
          centreShape ? "rounded-xl text-[0.9375rem]" : "rounded-lg text-sm",
          "focus-visible:ring-ring/50 outline-none focus-visible:ring-2",
          collapsed ? "justify-center px-0 py-2.5" : centreShape ? "gap-3 px-3.5 py-2.5" : "gap-3 px-3 py-2.5",
          isActive
            ? centreShape
              ? "centre-nav-active text-sidebar-primary-foreground font-bold"
              : "bg-primary/[0.12] text-primary font-semibold"
            : "text-sidebar-foreground hover:bg-sidebar-accent",
        )}
      >
        {/* The accent bar. Absolutely positioned so it never shifts the label; gold, because it is
            the one warm mark in a column of emerald and has to be findable at a glance. */}
        {isActive && (
          <span
            className="ornament from-gold to-gold/40 absolute inset-y-1.5 start-0 w-[3px] rounded-full bg-gradient-to-b"
            aria-hidden
          />
        )}
        <Icon
          className={cn(
            "shrink-0 transition-colors",
            centreShape ? "size-5" : "size-4",
            isActive
              ? centreShape
                ? "text-sidebar-primary-foreground"
                : "text-primary"
              : centreShape
                ? "text-sidebar-foreground/80 group-hover:text-sidebar-foreground"
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

  /**
   * A nav item with sub-pages (Groups): a disclosure that opens to its own links, indented under it.
   * Closed by default and opened / closed only by a click (it is highlighted while it holds the
   * current page). On the collapsed rail there is no room for a list, so it is just the icon,
   * linking to its first page. While closed it carries its sub-pages' badges, so "something is
   * waiting" is never hidden.
   */
  const renderNavParent = (item: (typeof NAV)[number], children: (typeof NAV)[number][]) => {
    if (collapsed) {
      return renderNavItem({ ...item, href: children[0]?.href ?? item.href });
    }

    const Icon = item.icon;
    const holdsPage = children.some((c) => matches(c.href));
    const isOpen = openParents.has(item.key);
    const label = navLabel(item.key);
    const waiting = children.reduce((sum, c) => sum + (badgeFor(c.key)?.count ?? 0), 0);
    const toggle = () =>
      setOpenParents((prev) => {
        const next = new Set(prev);
        if (next.has(item.key)) next.delete(item.key);
        else next.add(item.key);
        return next;
      });

    return (
      <div key={item.key} data-nav-parent={item.key}>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={isOpen}
          data-nav={item.key}
          className={cn(
            "group relative flex w-full items-center gap-3 text-start font-medium transition-colors duration-150",
            centreShape ? "rounded-xl px-3.5 py-2.5 text-[0.9375rem]" : "rounded-lg px-3 py-2.5 text-sm",
            "focus-visible:ring-ring/50 outline-none focus-visible:ring-2",
            holdsPage
              ? centreShape
                ? "bg-sidebar-accent text-sidebar-accent-foreground font-bold"
                : "text-primary font-semibold"
              : "text-sidebar-foreground hover:bg-sidebar-accent",
          )}
        >
          <Icon
            className={cn(
              "shrink-0 transition-colors",
              centreShape ? "size-5" : "size-4",
              holdsPage
                ? centreShape
                  ? "text-sidebar-accent-foreground"
                  : "text-primary"
                : centreShape
                  ? "text-sidebar-foreground/80 group-hover:text-sidebar-foreground"
                  : "text-sidebar-foreground/60 group-hover:text-sidebar-foreground",
            )}
            aria-hidden
          />
          <span className="flex-1 truncate">{label}</span>
          {!isOpen && waiting > 0 && <NavBadge count={waiting} label={`${waiting} waiting`} />}
          <ChevronDown
            className={cn(
              "shrink-0 transition-transform",
              centreShape ? "text-sidebar-foreground/70 size-4" : "text-sidebar-foreground/50 size-3.5",
              isOpen && "rotate-180",
            )}
            aria-hidden
          />
        </button>
        {isOpen && (
          <div
            // A centre's sub-pages stay on their parent's level: the same icon column and the same
            // width, so a long name is never cut. The soft panel is what says they belong to it.
            className={cn(
              "mt-0.5 space-y-0.5",
              centreShape ? "bg-sidebar-accent/50 rounded-xl" : "border-sidebar-border ms-5 border-s ps-2",
            )}
            data-nav-children={item.key}
          >
            {children.map(renderNavItem)}
          </div>
        )}
      </div>
    );
  };

  /** A labelled section header; on the rail it degrades to a plain rule. */
  // The gold star that opens each group is the sign-in door's divider at chrome scale — enough to
  // carry the motif through the panel, small enough to stay a bullet rather than an ornament.
  const groupLabel = (label: string) =>
    collapsed ? (
      <div className="bg-sidebar-border mx-auto mb-1.5 h-px w-6" aria-hidden />
    ) : centreShape ? (
      <p className="text-sidebar-foreground/75 mb-2 flex select-none items-center gap-2.5 px-3.5 text-[0.8125rem] font-semibold">
        <span className="shrink-0">{label}</span>
        <span className="bg-sidebar-border h-px flex-1" aria-hidden />
      </p>
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
            collapsed ? "w-[4.5rem]" : centreShape ? "w-[17rem]" : "w-60",
            centreShape && "overflow-hidden border-e-0",
            open
              ? "translate-x-0"
              : "max-md:-translate-x-full max-md:rtl:translate-x-full",
          )}
        >
          {/* The sidebar is a wall, so it carries the pattern: a khatam lattice down its full
              height, fading as it descends, over a faint emerald wash. Everything below sits on
              top of it (the nav is `relative`). */}
          <div
            className="ornament text-primary pointer-events-none absolute inset-0 opacity-[0.09]"
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
            className="ornament pointer-events-none absolute inset-0"
            style={{
              background:
                "linear-gradient(180deg, oklch(0.519 0.158 163.2 / 0.10) 0%, transparent 42%)",
            }}
            aria-hidden
          />
          {/* A gold thread down the sidebar's outer edge — the frame's own hairline. */}
          <span
            aria-hidden
            className="ornament via-gold/45 pointer-events-none absolute inset-y-0 end-0 w-px bg-gradient-to-b from-transparent to-transparent"
          />
          {/* ── Brand ──────────────────────────────────────────────────────
              WHOSE panel this is. A client sees their own academy — logo (or initials) and name,
              from the session (docs/lms/02) — because the door they came through was theirs and the
              chrome should not change hands behind it. A platform Super Admin has no academy, so
              the platform's own mark stays. The khatam lattice behind it and the gold hairline
              under it are the same ornament the sign-in door wears, at chrome strength. */}
          <div
            className={cn(
              "border-sidebar-border relative flex shrink-0 items-center overflow-hidden",
              centreShape && "border-b",
              // A centre's brand block is exactly the header's height, so the logo and the profile
              // picture across the top sit on one line.
              centreShape ? "h-16 md:h-[4.5rem]" : "h-14 border-b",
              collapsed ? "justify-center px-2" : centreShape ? "justify-between gap-1 px-3" : "justify-between px-4",
            )}
          >
            <div
              className="ornament text-primary pointer-events-none absolute inset-0 opacity-[0.10]"
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
              className="ornament via-gold/50 absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent to-transparent"
            />

            <div
              className={cn(
                "relative flex min-w-0 items-center",
                centreShape
                  ? cn("gap-3", !collapsed && "flex-1 rounded-2xl bg-white/[0.06] px-2 py-1.5 ring-1 ring-white/10")
                  : "gap-2.5",
              )}
            >
              {academyLogo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={academyLogo}
                  alt={academyName}
                  className={cn(
                    "shrink-0 bg-white object-contain p-0.5",
                    centreShape ? "size-10 rounded-xl" : "ring-gold/30 size-8 rounded-lg ring-1",
                  )}
                />
              ) : session.academy ? (
                <span
                  aria-hidden
                  className={cn(
                    "flex shrink-0 items-center justify-center font-bold",
                    centreShape
                      ? "centre-nav-active text-sidebar-primary-foreground size-10 rounded-xl text-sm"
                      : "bg-primary/12 text-primary ring-gold/30 size-8 rounded-lg text-[11px] ring-1",
                  )}
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
                  <div
                    className={cn(
                      "text-sidebar-foreground",
                      centreShape ? "line-clamp-2 text-sm leading-[1.3] font-bold" : "truncate text-[13px] leading-tight font-semibold",
                    )}
                  >
                    {academyName}
                  </div>
                  {/* A centre shows the role once, beside the profile picture in the header. */}
                  {!centreShape && (
                    <div className="text-sidebar-foreground/35 truncate text-[10px] leading-tight tracking-wide">
                      {roleLabel(tRoles, session.role, session.roleName)}
                    </div>
                  )}
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
                navGroups.map((group) => {
                  // Sub-pages render inside their parent's dropdown, not on the group's own list.
                  const groupItems = orderIn(
                    items.filter(
                      (item) => groupOf(item) === group && item.parent === undefined,
                    ),
                  );
                  if (groupItems.length === 0) return null;
                  return (
                    <div key={group}>
                      {!(centreShape && group === "general") && groupLabel(t(`navGroup.${group}`))}
                      <div className="space-y-0.5">
                        {groupItems.map((item) => {
                          const children = childrenOf(item.key);
                          return children.length > 0 ? renderNavParent(item, children) : renderNavItem(item);
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </nav>

          {/* ── Footer ─────────────────────────────────────────────────── */}
          <div className="border-sidebar-border relative border-t p-3">
            {/* On a phone a centre's header keeps only what a thumb needs; these two move here. */}
            {centreShape && (
              <div className="centre-drawer-tools mb-2 flex items-center justify-center gap-2 md:hidden">
                <ThemeToggle />
                <LocaleSwitcher onSwitch={changeLocale} compact />
              </div>
            )}
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
                  "focus-visible:ring-ring/50 hidden w-full items-center font-medium transition-colors outline-none focus-visible:ring-2 md:flex",
                  centreShape
                    ? "text-sidebar-foreground border-sidebar-border bg-sidebar/50 hover:bg-sidebar-accent rounded-xl border px-3 py-2.5 text-sm backdrop-blur-sm"
                    : "text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-foreground rounded-lg px-2 py-2 text-[12px]",
                  collapsed ? "justify-center" : centreShape ? "justify-center gap-2.5" : "gap-2.5",
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
          <header
            className={cn(
              "border-border relative flex shrink-0 items-center gap-2 border-b sm:gap-3",
              centreShape ? "bg-card h-16 px-3 md:h-[4.5rem] md:px-6" : "bg-background h-14 px-3 sm:px-4 md:px-5",
            )}
          >
            <span
              aria-hidden
              className="ornament via-gold/35 absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent to-transparent"
            />
            {/* Mobile menu toggle */}
            <button
              type="button"
              className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring/50 order-0 rounded-lg p-1.5 transition-colors outline-none focus-visible:ring-2 md:hidden"
              aria-label={t("header.menu")}
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              <Menu className="size-5" aria-hidden />
            </button>

            {/* A centre's phone header names the academy; its desktop header opens on the search. */}
            {centreShape && (
              <>
                <Link href="/dashboard" className="order-1 flex min-w-0 flex-1 items-center justify-center gap-2 md:hidden">
                  {academyLogo && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={academyLogo} alt="" className="size-8 shrink-0 rounded-lg bg-white object-contain p-0.5" />
                  )}
                  <span dir="auto" className="truncate text-base font-extrabold">
                    {academyName}
                  </span>
                </Link>
                <div className="order-2 shrink-0 md:order-1 md:max-w-[32rem] md:min-w-0 md:flex-1">
                  <CommandPalette items={commandItems} variant="bar" />
                </div>
              </>
            )}

            {/* Breadcrumb. The group is context, the page is the anchor, and on a detail route the
                page name becomes a link back to its list — which is the one thing the old header
                (an icon, a slash, and a page name that never changed) could not do. */}
            {activeItem && (!centreShape || pathname !== activeItem.href) && (
              <nav
                aria-label={t("header.breadcrumb")}
                data-testid="breadcrumb"
                className={cn(
                  "hidden min-w-0 items-center gap-1.5 text-sm",
                  centreShape ? "order-1 xl:flex" : "md:flex",
                )}
              >
                <span className="text-muted-foreground/70 select-none">
                  {t(`navGroup.${groupOf(activeItem)}`)}
                </span>
                <span className="text-muted-foreground/40 select-none">/</span>
                {pathname === activeItem.href ? (
                  <span className="text-foreground font-semibold">
                    {navLabel(activeItem.key)}
                  </span>
                ) : (
                  <>
                    <Link
                      href={activeItem.href}
                      className="text-muted-foreground hover:text-foreground font-medium transition-colors"
                    >
                      {navLabel(activeItem.key)}
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
            <div className={cn("flex items-center", centreShape ? "order-3 ms-auto gap-1 md:gap-2" : "ms-auto gap-0.5 sm:gap-1.5")}>
              {/* A desk on receipts collects from anywhere (docs/groups/01-ACCOUNTING.md). */}
              <CollectQuickAction />
              {!centreShape && <CommandPalette items={commandItems} />}

              {can("notification.read") && (
                <Tooltip content={t("nav.notifications")} side="bottom">
                  <Link
                    href="/notifications"
                    data-testid="header-notifications"
                    aria-label={t("nav.notifications")}
                    className={cn(
                      "text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring/50 relative transition-colors outline-none focus-visible:ring-2",
                      centreShape ? "flex size-10 items-center justify-center rounded-xl" : "rounded-lg p-2",
                    )}
                  >
                    <BellRing className={centreShape ? "size-5" : "size-4"} aria-hidden />
                    {notifCount > 0 && (
                      <span className="bg-destructive text-white absolute -end-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums">
                        {notifCount > 9 ? "9+" : notifCount}
                      </span>
                    )}
                  </Link>
                </Tooltip>
              )}

              {/* A centre's phone keeps these two in the drawer (the sidebar's footer). */}
              <div className={centreShape ? "hidden md:contents" : "contents"}>
                <ThemeToggle />

                {/* The two-segment pill is a third of a phone's header on its own — which pushed the
                    user menu off the edge at 320px — so a phone gets the one-button form. */}
                <div className="hidden sm:block">
                  <LocaleSwitcher onSwitch={changeLocale} />
                </div>
                <div className="sm:hidden">
                  <LocaleSwitcher onSwitch={changeLocale} compact />
                </div>
              </div>

              <div className="bg-border mx-1 hidden h-5 w-px sm:block" aria-hidden />

              {/* The user chip is a real menu now. It used to be `cursor-default` — an avatar and a
                  name that looked clickable, did nothing, and duplicated the sidebar footer. */}
              <DropdownMenu>
                <DropdownMenuTrigger>
                  <button
                    type="button"
                    data-testid="header-user"
                    className={cn(
                      "hover:bg-muted focus-visible:ring-ring/50 flex items-center transition-colors outline-none focus-visible:ring-2",
                      centreShape ? "gap-2.5 rounded-xl p-1 md:px-2" : "gap-2 rounded-lg px-1.5 py-1.5",
                    )}
                  >
                    <span
                      className={cn(
                        "flex shrink-0 items-center justify-center font-bold",
                        centreShape
                          ? "centre-button-primary size-10 rounded-full text-[0.8125rem]"
                          : "from-primary/20 to-primary/[0.08] ring-primary/20 text-primary size-7 rounded-lg bg-gradient-to-br text-[11px] ring-1",
                      )}
                    >
                      {initials}
                    </span>
                    {centreShape ? (
                      <span className="hidden min-w-0 text-start leading-tight md:block">
                        <span className="text-foreground block max-w-40 truncate text-sm font-bold">{session.user.fullName}</span>
                        <span className="text-muted-foreground block max-w-40 truncate text-xs">
                          {roleLabel(tRoles, session.role, session.roleName)}
                        </span>
                      </span>
                    ) : (
                      <span className="text-foreground hidden text-[13px] font-medium leading-none sm:block">
                        {session.user.fullName.split(" ")[0]}
                      </span>
                    )}
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
                        {roleLabel(tRoles, session.role, session.roleName)}
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
                    onClick={() => setPasswordOpen(true)}
                    closeOnClick
                    data-testid="change-password"
                  >
                    <KeyRound aria-hidden />
                    {t("auth.changePassword")}
                  </DropdownMenuItem>
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

          <ChangePasswordModal
            open={passwordOpen}
            onClose={() => setPasswordOpen(false)}
          />

          {/* The width cap stops tables from stretching to the far edge of a 27" display, where the
              eye has to travel the whole desk to tie a row back to its header. */}
          <main className="scroll-ornate relative min-w-0 flex-1 overflow-auto">
            {/* The same lattice as the sidebar, at a whisper: enough to make the canvas feel like
                part of the frame, faint enough that a table never fights it. Fixed to the viewport
                so it does not slide around as the page scrolls. */}
            <div
              className="ornament text-primary pointer-events-none fixed inset-0 opacity-[0.05]"
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
              <OrnateRule className="ornament mb-4 md:mb-5" />
              {children}
            </div>
          </main>

          {/* In the column's flow, not fixed: <main> shrinks to make room, so it can never cover the
              end of a page. */}
          {centreShape && !videoOnly && !lmsOnly && (
            <nav
              data-testid="bottom-nav"
              className="bg-card border-border flex shrink-0 items-stretch gap-1 border-t px-2 pt-1.5 pb-[calc(0.375rem+env(safe-area-inset-bottom))] md:hidden"
            >
              {CENTRE_BOTTOM_NAV.map((key) => items.find((item) => item.key === key))
                .filter((item) => item !== undefined)
                .slice(0, 4)
                .map((item) => {
                  const Icon = item.icon;
                  const active =
                    item.href === "/dashboard"
                      ? pathname === item.href
                      : pathname === item.href || pathname.startsWith(`${item.href}/`);
                  const waiting =
                    badgeFor(item.key)?.count ??
                    childrenOf(item.key).reduce((sum, c) => sum + (badgeFor(c.key)?.count ?? 0), 0);
                  return (
                    <Link
                      key={item.key}
                      href={item.href}
                      data-bottom-nav={item.key}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "relative flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl py-1.5 text-xs font-semibold",
                        active ? "text-primary bg-primary/[0.08] font-bold" : "text-muted-foreground",
                      )}
                    >
                      <Icon className="size-5 shrink-0" aria-hidden />
                      <span className="max-w-full truncate px-1">{navLabel(item.key)}</span>
                      {waiting > 0 && (
                        <span
                          className="bg-destructive absolute end-[calc(50%-1rem)] top-1.5 size-2 rounded-full"
                          aria-hidden
                        />
                      )}
                    </Link>
                  );
                })}
            </nav>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
