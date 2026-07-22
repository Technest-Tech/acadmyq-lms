// LMS public learner site API client (docs/lms). Separate from lib/api.ts: the learner site is a
// public, per-academy surface authenticated by a Sanctum BEARER token (stored in localStorage),
// with the academy carried in the `X-Academy` header (the subdomain handle). No cookies.

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

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

async function learnFetch<T>(
  academy: string,
  path: string,
  opts: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-Academy": academy,
    ...((opts.headers as Record<string, string>) ?? {}),
  };
  const token = getLearnToken(academy);
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}/api/learn${path}`, {
    ...opts,
    headers,
    credentials: "same-origin",
  });

  const text = await res.text();
  const body = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const message =
      (body && typeof body === "object" && "message" in body && (body as { message?: string }).message) ||
      `Request failed (${res.status})`;
    throw new LearnApiError(res.status, message, body);
  }
  return body as T;
}

// ── types ────────────────────────────────────────────────────────────────────

export interface LearnCourseCard {
  id: string;
  title: string;
  slug: string;
  subtitle: string | null;
  cover_image_path: string | null;
  lesson_count: number;
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
  return learnFetch(academy, "/auth/register", { method: "POST", body: JSON.stringify(input) });
}

export function learnLogin(
  academy: string,
  input: { email: string; password: string },
): Promise<{ token: string; learner: LearnProfile }> {
  return learnFetch(academy, "/auth/login", { method: "POST", body: JSON.stringify(input) });
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
): Promise<{ ok: boolean; already_redeemed: boolean; courses: { id: string; title: string; slug: string }[] }> {
  return learnFetch(academy, "/redeem", { method: "POST", body: JSON.stringify({ code }) });
}

export function learnPlayer(
  academy: string,
  slug: string,
): Promise<LearnCourseDetail & { progress: Record<string, LearnProgress> }> {
  return learnFetch(academy, `/courses/${slug}/content`);
}

export function learnSaveProgress(
  academy: string,
  lessonId: string,
  input: { position_seconds?: number; completed?: boolean },
): Promise<{ ok: boolean }> {
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
): Promise<{ url: string; kind: "VIDEO" | "AUDIO"; protocol: "hls" | "progressive" }> {
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
