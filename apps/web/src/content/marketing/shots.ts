import type { Shot } from "./types";

/**
 * The registry of real product screenshots the marketing pages show.
 *
 * File name and intrinsic size live HERE, once; the Arabic and English content files supply only
 * the alt text and the caption. That split is deliberate — a screenshot re-captured at a different
 * size is a one-line edit that cannot leave one locale reserving the wrong space and shifting its
 * layout while the other is fine.
 *
 * Every capture is a real screen of the running product, taken at a 1440×900 viewport against the
 * demo tenants (`ShowcaseAcademySeeder` for the management system, the LMS demo catalogue for the
 * course platform). Nothing here is a mock-up or a drawing of an interface that does not exist.
 */
const SIZE = { width: 1440, height: 900 } as const;

const FILES = {
  // ── Course platform — what a learner sees ──────────────────────────────────────────────────
  cpSiteHome: "/marketing/cp-site-home.png",
  cpCatalog: "/marketing/cp-catalog.png",
  cpCourse: "/marketing/cp-course.png",
  cpPlayer: "/marketing/cp-player.png",
  cpQuiz: "/marketing/cp-quiz.png",
  cpCertificate: "/marketing/cp-certificate.png",
  cpMyCourses: "/marketing/cp-my-courses.png",
  // ── Course platform — the client's dashboard ───────────────────────────────────────────────
  cpBuilder: "/marketing/cp-builder.png",
  cpCourses: "/marketing/cp-courses.png",
  cpLearners: "/marketing/cp-learners.png",
  cpCodes: "/marketing/cp-codes.png",
  cpSiteEditor: "/marketing/cp-site-editor.png",
  // ── Academy management ─────────────────────────────────────────────────────────────────────
  amDashboard: "/marketing/am-dashboard.png",
  amStudents: "/marketing/am-students.png",
  amCalendar: "/marketing/am-calendar.png",
  amAttendance: "/marketing/am-attendance.png",
  amInvoices: "/marketing/am-invoices.png",
  amFinancial: "/marketing/am-financial.png",
  amRoles: "/marketing/am-roles.png",
  amAudit: "/marketing/am-audit.png",
} as const;

export type ShotKey = keyof typeof FILES;

/** Build a `Shot` for one registered capture. `alt` describes the screen; `caption` labels it. */
export function shot(key: ShotKey, alt: string, caption: string): Shot {
  return { src: FILES[key], ...SIZE, alt, caption };
}
