import type { HeroImage, Shot } from "./types";

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
 *
 * WEBP, not PNG. These are 1.5× captures of flat UI, and at that size the PNG set came to 14MB in
 * the repository for no visible gain — the whole set is 1.8MB as webp, and `next/image` re-encodes
 * to whatever the visitor's browser prefers either way. (The Open Graph cards stay PNG: some social
 * crawlers still will not render a webp preview.)
 */
const SIZE = { width: 2160, height: 1350 } as const;

const FILES = {
  // ── Course platform — what a learner sees ──────────────────────────────────────────────────
  cpSiteHome: "/marketing/cp-site-home.webp",
  cpCatalog: "/marketing/cp-catalog.webp",
  cpCourse: "/marketing/cp-course.webp",
  cpPlayer: "/marketing/cp-player.webp",
  cpQuiz: "/marketing/cp-quiz.webp",
  cpCertificate: "/marketing/cp-certificate.webp",
  cpMyCourses: "/marketing/cp-my-courses.webp",
  // ── Course platform — the client's dashboard ───────────────────────────────────────────────
  cpBuilder: "/marketing/cp-builder.webp",
  cpCourses: "/marketing/cp-courses.webp",
  cpLearners: "/marketing/cp-learners.webp",
  cpCodes: "/marketing/cp-codes.webp",
  cpSiteEditor: "/marketing/cp-site-editor.webp",
  // ── Academy management ─────────────────────────────────────────────────────────────────────
  amDashboard: "/marketing/am-dashboard.webp",
  amStudents: "/marketing/am-students.webp",
  amCalendar: "/marketing/am-calendar.webp",
  amAttendance: "/marketing/am-attendance.webp",
  amInvoices: "/marketing/am-invoices.webp",
  amFinancial: "/marketing/am-financial.webp",
  amRoles: "/marketing/am-roles.webp",
  amAudit: "/marketing/am-audit.webp",
} as const;

export type ShotKey = keyof typeof FILES;

/** Build a `Shot` for one registered capture. `alt` describes the screen; `caption` labels it. */
export function shot(key: ShotKey, alt: string, caption: string): Shot {
  return { src: FILES[key], ...SIZE, alt, caption };
}

/**
 * The homepage hero image — the one picture on the site that is NOT a capture of a running screen.
 *
 * A real capture cannot lead this page. The screen a visitor would recognise as "a course site on
 * Acadmyq" belongs to a client, and every client site is full of that client's own courses, covers
 * and instructor photographs — material we do not own and must not put on our advertising. So the
 * hero is a drawn example instead: a fictional academy, generated cover art, no real course and no
 * real person. Everything BELOW the hero stays a genuine capture, taken against the demo tenants.
 *
 * It ships with its own window frame and its own soft shadow already drawn, and with the flat
 * ground behind them knocked out to transparency — which is why `HeroImage` is a separate type from
 * `Shot` and the page renders it bare, with no `ProductShot` border, no second shadow and no
 * caption. Framing a frame looks like a mistake.
 */
const HERO_IMAGE = {
  src: "/marketing/hero-course-site.webp",
  width: 1586,
  height: 992,
} as const;

/** Build the homepage hero image. `alt` describes the example site it draws. */
export function heroImage(alt: string): HeroImage {
  return { ...HERO_IMAGE, alt };
}
