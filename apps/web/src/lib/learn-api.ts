// LMS public learner site API client (docs/lms). Separate from lib/api.ts: the learner site is a
// public, per-academy surface authenticated by a Sanctum BEARER token (stored in localStorage),
// with the academy carried in the `X-Academy` header (the subdomain handle). No cookies.

import { apiBase } from "@/lib/api-base";

const tokenKey = (academy: string) => `lms_token_${academy}`;

export function getLearnToken(academy: string): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(tokenKey(academy));
}

export function setLearnToken(academy: string, token: string): void {
  window.localStorage.setItem(tokenKey(academy), token);
}

export function clearLearnToken(academy: string): void {
  window.localStorage.removeItem(tokenKey(academy));
}

export class LearnApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
    this.name = "LearnApiError";
  }
}

async function learnFetch<T>(academy: string, path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-Academy": academy,
    ...((opts.headers as Record<string, string>) ?? {}),
  };
  const token = getLearnToken(academy);
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${apiBase()}/api/learn${path}`, {
    ...opts,
    headers,
    credentials: "same-origin",
  });

  const text = await res.text();
  const body = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const message =
      (body &&
        typeof body === "object" &&
        "message" in body &&
        (body as { message?: string }).message) ||
      `Request failed (${res.status})`;
    throw new LearnApiError(res.status, message, body);
  }
  return body as T;
}

// ── site profile (docs/lms/09) ───────────────────────────────────────────────

/**
 * The per-academy content of the shared site template. Every LMS client renders the SAME sections;
 * this is the only thing that differs between them. Blank strings and empty lists are normal — the
 * template substitutes its own translated copy, which is how a client who never opened the editor
 * still gets a finished, bilingual site.
 */
export interface LearnSiteContent {
  brand: {
    name: string;
    tagline: string;
    logo_url: string;
    /** `#rrggbb`; drives the whole palette through CSS variables. */
    color: string;
    hero_style: "gradient" | "image" | "plain";
  };
  hero: {
    eyebrow: string;
    title: string;
    subtitle: string;
    image_url: string;
    primary_cta: "browse" | "redeem" | "contact";
    badges: string[];
  };
  stats: { show: boolean; items: { value: string; label: string }[] };
  about: {
    show: boolean;
    heading: string;
    body: string;
    image_url: string;
    points: string[];
  };
  features: {
    show: boolean;
    heading: string;
    subheading: string;
    items: { icon: string; title: string; body: string }[];
  };
  steps: {
    show: boolean;
    heading: string;
    items: { title: string; body: string }[];
  };
  instructors: {
    show: boolean;
    heading: string;
    items: { name: string; role: string; bio: string; photo_url: string }[];
  };
  testimonials: {
    show: boolean;
    heading: string;
    items: {
      name: string;
      role: string;
      quote: string;
      photo_url: string;
      rating: number;
    }[];
  };
  faq: { show: boolean; heading: string; items: { q: string; a: string }[] };
  cta: {
    show: boolean;
    title: string;
    subtitle: string;
    button_label: string;
    button_href: string;
  };
  contact: {
    show: boolean;
    email: string;
    phone: string;
    whatsapp: string;
    address: string;
    map_url: string;
    socials: Record<string, string>;
  };
  footer: { note: string; links: { label: string; href: string }[] };
  seo: { title: string; description: string; og_image_url: string };
  pages: { about: boolean; faq: boolean; contact: boolean };
}

/** Live catalogue counters — what the stats band shows when the client wrote no numbers of its own. */
export interface LearnSiteStats {
  courses: number;
  lessons: number;
  learners: number;
  certificates: number;
}

export interface LearnSite {
  site: LearnSiteContent;
  stats: LearnSiteStats;
  academy: { name: string; subdomain: string | null };
}

export function learnSite(academy: string): Promise<LearnSite> {
  return learnFetch(academy, "/site");
}

// ── types ────────────────────────────────────────────────────────────────────

export interface LearnCourseCard {
  id: string;
  title: string;
  slug: string;
  subtitle: string | null;
  cover_image_path: string | null;
  lesson_count: number;
  /** Catalogue facts (docs/lms/09). Optional: an older API build sends only `lesson_count`. */
  section_count?: number;
  /** Total runtime of every timed lesson, in seconds. 0 when the course carries no durations. */
  duration_seconds?: number;
  preview_count?: number;
  /** ACTIVE enrolments — real social proof, shown only when there is some. */
  learner_count?: number;
  published_at?: string | null;
  updated_at?: string | null;
  /** One-off unlock price in integer minor units, in the academy's currency. 0 = free. */
  price_minor: number;
  currency: string;
  is_free: boolean;
}

export type LearnLessonType = "YOUTUBE" | "TEXT" | "PDF" | "AUDIO" | "VIDEO_UPLOAD" | "QUIZ";

export type LearnMediaStatus = "PENDING" | "UPLOADING" | "PROCESSING" | "READY" | "FAILED";

export interface LearnLesson {
  id: string;
  title: string;
  type: LearnLessonType;
  is_preview: boolean;
  duration_seconds: number | null;
  /** Present only for preview lessons (catalog) or any lesson (enrolled player). */
  youtube_video_id?: string | null;
  body?: string | null;
  attachment_path?: string | null;
  /** VIDEO_UPLOAD / uploaded AUDIO: an upload is attached, and whether it's finished transcoding. */
  has_media?: boolean;
  media_status?: LearnMediaStatus;
}

export interface LearnSection {
  id: string;
  title: string;
  lessons: LearnLesson[];
}

export interface LearnCourseDetail {
  course: {
    id: string;
    title: string;
    slug: string;
    subtitle: string | null;
    description: string | null;
    cover_image_path: string | null;
    /** Sales-page facts — absent from the player payload, which sells nothing. */
    learner_count?: number;
    published_at?: string | null;
    updated_at?: string | null;
    /** One-off unlock price in integer minor units, in the academy's currency. 0 = free. */
    price_minor: number;
    currency: string;
    is_free: boolean;
  };
  sections: LearnSection[];
}

export interface LearnProfile {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
}

export interface LearnProgress {
  status: "IN_PROGRESS" | "COMPLETED";
  position_seconds: number;
  completed_at: string | null;
}

// ── auth ─────────────────────────────────────────────────────────────────────

export function learnRegister(
  academy: string,
  input: { full_name: string; email: string; password: string; phone?: string },
): Promise<{ token: string; learner: LearnProfile }> {
  return learnFetch(academy, "/auth/register", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function learnLogin(
  academy: string,
  input: { email: string; password: string },
): Promise<{ token: string; learner: LearnProfile }> {
  return learnFetch(academy, "/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function learnMe(
  academy: string,
): Promise<{ learner: LearnProfile; enrolled_course_ids: string[] }> {
  return learnFetch(academy, "/me");
}

export function learnLogout(academy: string): Promise<{ ok: boolean }> {
  return learnFetch(academy, "/auth/logout", { method: "POST" });
}

// ── catalog / redeem / player ──────────────────────────────────────────────────

export function learnCatalog(academy: string): Promise<{ courses: LearnCourseCard[] }> {
  return learnFetch(academy, "/courses");
}

export function learnCourse(academy: string, slug: string): Promise<LearnCourseDetail> {
  return learnFetch(academy, `/courses/${slug}`);
}

export function learnRedeem(
  academy: string,
  code: string,
): Promise<{
  ok: boolean;
  already_redeemed: boolean;
  courses: { id: string; title: string; slug: string }[];
}> {
  return learnFetch(academy, "/redeem", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

/** Self-enroll in a FREE course — no code, just a signed-in learner (the API re-checks the price). */
export function learnEnrollFree(
  academy: string,
  slug: string,
): Promise<{
  ok: boolean;
  already_enrolled: boolean;
  course: { id: string; title: string; slug: string };
}> {
  return learnFetch(academy, `/courses/${slug}/enroll`, { method: "POST" });
}

export function learnPlayer(
  academy: string,
  slug: string,
): Promise<LearnCourseDetail & { progress: Record<string, LearnProgress> }> {
  return learnFetch(academy, `/courses/${slug}/content`);
}

/**
 * Saves a resume point and/or completion for one lesson. Completing the last outstanding lesson
 * finishes the course, which is why a certificate can come back from a progress save.
 */
export function learnSaveProgress(
  academy: string,
  lessonId: string,
  input: { position_seconds?: number; completed?: boolean },
): Promise<{ ok: boolean; certificate: { serial: string } | null }> {
  return learnFetch(academy, `/lessons/${lessonId}/progress`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/**
 * A short-lived signed URL for an uploaded lesson's media (VIDEO_UPLOAD / uploaded AUDIO). `protocol`
 * is `hls` for a transcoded video (play with hls.js) or `progressive` for audio / a v0 MP4 (a plain
 * `<audio>`/`<video>` source).
 */
export function learnPlayback(
  academy: string,
  lessonId: string,
): Promise<{
  url: string;
  kind: "VIDEO" | "AUDIO";
  protocol: "hls" | "progressive";
}> {
  return learnFetch(academy, `/lessons/${lessonId}/playback`);
}

// ── quizzes & certificates (docs/lms/04) ───────────────────────────────────────

export type LearnQuestionType = "SINGLE" | "MULTIPLE" | "TRUE_FALSE";

export interface LearnQuizPayload {
  quiz: {
    id: string;
    title: string | null;
    pass_mark: number;
    max_attempts: number | null;
    attempts_used: number;
    passed: boolean;
    best_score: number | null;
  };
  // NB: no is_correct — grading is server-side.
  questions: Array<{
    id: string;
    prompt: string;
    type: LearnQuestionType;
    points: number;
    options: Array<{ id: string; text: string }>;
  }>;
}

export interface LearnQuizResult {
  score: number;
  passed: boolean;
  attempts_used: number;
  max_attempts: number | null;
  certificate: { serial: string } | null;
}

export interface LearnCertificate {
  serial: string;
  issued_at: string | null;
  course_title: string;
  learner_name: string;
}

export function learnQuiz(academy: string, lessonId: string): Promise<LearnQuizPayload> {
  return learnFetch(academy, `/lessons/${lessonId}/quiz`);
}

export function learnSubmitQuiz(
  academy: string,
  lessonId: string,
  answers: Array<{ question_id: string; selected_option_ids: string[] }>,
): Promise<LearnQuizResult> {
  return learnFetch(academy, `/lessons/${lessonId}/quiz/submit`, {
    method: "POST",
    body: JSON.stringify({ answers }),
  });
}

export function learnCertificate(academy: string, slug: string): Promise<LearnCertificate> {
  return learnFetch(academy, `/courses/${slug}/certificate`);
}
