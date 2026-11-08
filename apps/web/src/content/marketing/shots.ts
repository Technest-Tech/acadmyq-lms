import type { Photo, Shot } from "./types";

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
 * The stock photographs (Unsplash licence: free for commercial use, no attribution required). Each
 * was downloaded once from images.unsplash.com, cropped and encoded to webp by hand
 * (`cwebp -q 78 -m 6`), so the site never hot-links a third party. They show PEOPLE AND PLACES only;
 * nothing here pretends to be a screen of the product.
 *
 *   quran   — photo-1542816417-0983c9c9ad53   a navy mushaf with gold ornament
 *   student — photo-1610484826917-0f101a7bf7f4 a boy with headphones at a laptop
 *   group   — photo-1588196749597-9ff075ee6b5b a video class on a laptop, a mug beside it
 *   parent  — photo-1609220136736-443140cffec6 a father carrying his two children
 *   chaos   — photo-1586473219010-2ffc57b0d282 a man covered in sticky notes
 */
const PHOTOS = {
  quran: { src: "/marketing/photos/quran.webp", width: 960, height: 720 },
  student: { src: "/marketing/photos/student.webp", width: 960, height: 720 },
  group: { src: "/marketing/photos/group.webp", width: 960, height: 720 },
  parent: { src: "/marketing/photos/parent.webp", width: 1200, height: 800 },
  chaos: { src: "/marketing/photos/chaos.webp", width: 880, height: 1100 },
} as const;

export type PhotoKey = keyof typeof PHOTOS;

/** Build a `Photo` for one registered picture. `alt` describes what is in it. */
export function photo(key: PhotoKey, alt: string): Photo {
  return { ...PHOTOS[key], alt };
}
