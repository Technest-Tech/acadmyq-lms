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

/**
 * Same request, but for a `FormData` body (the transfer-receipt upload). The Content-Type header is
 * deliberately NOT set: the browser has to write it itself so the multipart boundary is correct.
 */
async function learnUpload<T>(academy: string, path: string, form: FormData): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json", "X-Academy": academy };
  const token = getLearnToken(academy);
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${apiBase()}/api/learn${path}`, {
    method: "POST",
    headers,
    body: form,
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
      `Upload failed (${res.status})`;
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
    /**
     * The compact/square mark and the browser-tab icon. Optional in the TYPE (not in the document)
     * because during a rolling deploy the web can be a version ahead of the API: a missing key must
     * degrade to the full logo, never throw on a page every visitor sees.
     */
    logo_mark_url?: string;
    favicon_url?: string;
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
    /** Overrides the primary button's label; blank ⇒ the template's translated one. */
    cta_label?: string;
    badges: string[];
  };
  stats: { show: boolean; items: { value: string; label: string }[] };
  about: {
    show: boolean;
    heading: string;
    /** The story. `mission` and `approach` are the two blocks only the About page adds on top. */
    body: string;
    image_url: string;
    points: string[];
    mission?: string;
    approach?: string;
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
    items: {
      name: string;
      role: string;
      bio: string;
      photo_url: string;
      /** Comma-separated areas of expertise, rendered as chips. */
      expertise?: string;
      link_url?: string;
    }[];
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
    /** When someone is there to answer — free text, e.g. "Sat–Thu, 10:00–18:00". */
    hours?: string;
    map_url: string;
    socials: Record<string, string>;
  };
  footer: { note: string; links: { label: string; href: string }[] };
  seo: { title: string; description: string; og_image_url: string };
  pages: { about: boolean; faq: boolean; contact: boolean };
  /**
   * The trust pages (docs/lms/10 §6). Empty strings are the normal state — the template renders its
   * own translated default policy, so a client who never opened the editor still has a refund
   * policy, terms and a privacy page. `business_name` names who the buyer is actually contracting
   * with, because the platform is never the seller of a course.
   */
  legal: {
    show: boolean;
    terms: string;
    refund: string;
    privacy: string;
    business_name: string;
    updated_at: string;
  };
}

/** Live catalogue counters — what the stats band shows when the client wrote no numbers of its own. */
export interface LearnSiteStats {
  courses: number;
  lessons: number;
  learners: number;
  certificates: number;
  /** Published books. Optional: an older API build does not send it. */
  books?: number;
}

/**
 * Which doors into a course this client actually has open, across their published catalogue
 * (docs/lms/09 §2). Real rows, computed server-side and delivered with the site document, so the
 * hero's CTAs, the FAQ's answers and the footer render the truth on the FIRST frame — inferring it
 * later from the catalogue fetch would mean a visible CTA swap on every page load.
 */
export interface LearnSiteCommerce {
  /** At least one published free course with lessons in it. */
  free: boolean;
  /** The newest such course — where "start with a free course" goes. */
  free_course: { slug: string; title: string } | null;
  /** A priced course can actually be bought here: checkout on AND a live receiving account. */
  checkout: boolean;
  /** Access codes unlock at least one published course. */
  codes: boolean;
  /** The catalogue contains something that costs money. */
  paid: boolean;
  /**
   * The bookshop (docs/lms/11). Absent from an older API build — a missing block means "this client
   * sells no books", which is what makes the header's Books link safe to render on the first frame
   * instead of flickering in after a catalogue fetch.
   */
  books?: LearnSiteBooks;
}

/** Whether this client sells digital products at all, and on what terms. */
export interface LearnSiteBooks {
  /** At least one published book with a file behind it — the predicate the nav link turns on. */
  any: boolean;
  count: number;
  free: boolean;
  /** The newest free book — where a "start with a free download" CTA goes. */
  free_book: { slug: string; title: string } | null;
  paid: boolean;
  /** A priced book can actually be bought: checkout on AND a live receiving account. */
  checkout: boolean;
  /** At least one free sample chapter exists anywhere in the shop. */
  preview: boolean;
}

export interface LearnSite {
  site: LearnSiteContent;
  stats: LearnSiteStats;
  /** Absent from an older API build — treat a missing block as "nothing is switched on". */
  commerce?: LearnSiteCommerce;
  academy: { name: string; subdomain: string | null; url?: string | null };
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
  /** How this course may be unlocked (docs/lms/10 §1). Optional: an older API build omits them. */
  checkout_enabled?: boolean;
  code_enabled?: boolean;
  /** The honest Buy-button predicate: priced + checkout on + the client has a live payment method. */
  sells_online?: boolean;
  /** Sales metadata (docs/lms/09 §4) — null until the client fills it in; never invented. */
  level?: LearnCourseLevel | null;
  category?: string | null;
}

export type LearnCourseLevel =
  | "BEGINNER"
  | "INTERMEDIATE"
  | "ADVANCED"
  | "ALL_LEVELS";

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
    checkout_enabled?: boolean;
    code_enabled?: boolean;
    sells_online?: boolean;
    level?: LearnCourseLevel | null;
    category?: string | null;
    /**
     * The sales blocks (docs/lms/09 §4): what you'll be able to do, what you need first, who it is
     * for. Empty lists are the normal state and the page hides those sections entirely.
     */
    outcomes?: string[];
    requirements?: string[];
    audience?: string[];
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

// ── checkout & orders (docs/lms/10) ──────────────────────────────────────────

export type LearnPaymentMethodType = "INSTAPAY" | "VODAFONE_CASH" | "BANK_TRANSFER" | "OTHER";

/**
 * One of the client's receiving accounts, as the checkout screen renders it. Account numbers only
 * ever travel on signed-in requests — the public catalogue never carries them.
 */
export interface LearnPaymentMethod {
  id: string;
  type: LearnPaymentMethodType;
  label: string | null;
  account_name: string | null;
  account_number: string | null;
  bank_name: string | null;
  instructions: string | null;
}

export type LearnOrderStatus =
  | "AWAITING_PAYMENT"
  | "UNDER_REVIEW"
  | "PAID"
  | "REJECTED"
  | "CANCELLED"
  | "REFUNDED";

export interface LearnOrder {
  id: string;
  order_number: string;
  status: LearnOrderStatus;
  price_minor: number;
  currency: string;
  channel: "MANUAL" | "GATEWAY";
  payment_method_id: string | null;
  payment_method_type: LearnPaymentMethodType | null;
  /** Shown to the learner verbatim when the client refuses a receipt — never paraphrased. */
  rejection_reason: string | null;
  refund_reason?: string | null;
  submitted_at: string | null;
  confirmed_at: string | null;
  created_at: string | null;
  /**
   * What was bought (docs/lms/11). The `course_*` keys below are filled from whichever catalogue the
   * order points at, so they stay correct for a book; `item_type` is what decides where the "open
   * it" link goes — the player for a course, the download page for a book.
   */
  item_type?: "COURSE" | "PRODUCT";
  item_title?: string | null;
  item_slug?: string | null;
  course_title?: string | null;
  course_slug?: string | null;
  course_cover?: string | null;
}

export interface LearnOrderReceipt {
  id: string;
  method_type: LearnPaymentMethodType;
  sender_name: string | null;
  sender_reference: string | null;
  amount_minor: number | null;
  paid_at: string | null;
  note: string | null;
  review_status: "PENDING" | "APPROVED" | "REJECTED";
  rejection_reason: string | null;
  created_at: string | null;
}

export interface LearnCheckout {
  /** True when the learner already owns the course — the screen sends them to the player instead. */
  already_enrolled: boolean;
  course: {
    id: string;
    title: string;
    slug: string;
    subtitle: string | null;
    cover_image_path: string | null;
    price_minor: number;
  };
  currency?: string;
  payment_methods?: LearnPaymentMethod[];
  /** The order they already started, if any — checkout is resumable, never duplicated. */
  open_order?: LearnOrder | null;
  buyer?: { full_name: string; email: string; phone: string | null };
}

export function learnCheckout(academy: string, slug: string): Promise<LearnCheckout> {
  return learnFetch(academy, `/checkout/${slug}`);
}

export function learnPlaceOrder(
  academy: string,
  slug: string,
  input: { payment_method_id?: string | null; accept_terms: true },
): Promise<{ ok: boolean; order: LearnOrder }> {
  return learnFetch(academy, `/courses/${slug}/orders`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function learnOrders(academy: string): Promise<{ orders: LearnOrder[] }> {
  return learnFetch(academy, "/orders");
}

export function learnOrder(
  academy: string,
  number: string,
): Promise<{
  order: LearnOrder;
  course: LearnCheckout["course"] | null;
  /** The same row as `course`, plus which catalogue it came from. */
  item?: (LearnCheckout["course"] & { item_type: "COURSE" | "PRODUCT" }) | null;
  receipts: LearnOrderReceipt[];
  payment_methods: LearnPaymentMethod[];
}> {
  return learnFetch(academy, `/orders/${number}`);
}

export function learnChooseMethod(
  academy: string,
  number: string,
  paymentMethodId: string,
): Promise<{ ok: boolean; order: LearnOrder }> {
  return learnFetch(academy, `/orders/${number}/method`, {
    method: "POST",
    body: JSON.stringify({ payment_method_id: paymentMethodId }),
  });
}

/** Upload the transfer proof. Multipart, so it goes through `learnUpload`, not `learnFetch`. */
export function learnUploadReceipt(
  academy: string,
  number: string,
  input: {
    receipt: File;
    payment_method_id?: string | null;
    sender_name?: string;
    sender_reference?: string;
    amount_minor?: number | null;
    paid_at?: string;
    note?: string;
  },
): Promise<{ ok: boolean; order: LearnOrder }> {
  const form = new FormData();
  form.append("receipt", input.receipt);
  if (input.payment_method_id) form.append("payment_method_id", input.payment_method_id);
  if (input.sender_name) form.append("sender_name", input.sender_name);
  if (input.sender_reference) form.append("sender_reference", input.sender_reference);
  if (input.amount_minor != null) form.append("amount_minor", String(input.amount_minor));
  if (input.paid_at) form.append("paid_at", input.paid_at);
  if (input.note) form.append("note", input.note);

  return learnUpload(academy, `/orders/${number}/receipt`, form);
}

export function learnCancelOrder(academy: string, number: string): Promise<{ ok: boolean }> {
  return learnFetch(academy, `/orders/${number}/cancel`, { method: "POST" });
}

// ── the bookshop (docs/lms/11) ───────────────────────────────────────────────
// Books and PDFs sold alongside the courses. The catalogue and the sales page are PUBLIC — and so
// is the free sample, deliberately: asking someone to register before they can read a sample
// chapter is the friction that loses the sale. Paid files are only ever reachable through
// `learnProductAccess`, which needs a signed-in learner holding an ACTIVE entitlement.

export type LearnProductKind =
  | "EBOOK"
  | "PDF"
  | "AUDIOBOOK"
  | "WORKBOOK"
  | "BUNDLE";

export interface LearnProductCard {
  id: string;
  title: string;
  slug: string;
  subtitle: string | null;
  cover_image_path: string | null;
  kind: LearnProductKind;
  author: string | null;
  language: string | null;
  category: string | null;
  page_count: number | null;
  file_count: number | null;
  /** How many free samples this book offers — 0 hides the "read a sample" affordance. */
  preview_count: number | null;
  owner_count: number | null;
  price_minor: number;
  currency: string;
  is_free: boolean;
  checkout_enabled: boolean;
  /** The honest Buy-button predicate: priced + checkout on + a live receiving account. */
  sells_online: boolean;
  published_at: string | null;
  updated_at: string | null;
}

/**
 * One file in the bundle. `url` is null for every paid file on the public sales page — the visitor
 * can see WHAT they would get (the title, the format, the page count) but reach only the sample.
 */
export interface LearnProductFile {
  id: string;
  title: string;
  format: string | null;
  size_bytes: number | null;
  page_count: number | null;
  is_preview: boolean;
  url: string | null;
}

export interface LearnProductDetail {
  product: LearnProductCard & {
    description: string | null;
    owner_count: number;
    highlights: string[];
    audience: string[];
  };
  files: LearnProductFile[];
}

export function learnProducts(
  academy: string,
): Promise<{ products: LearnProductCard[] }> {
  return learnFetch(academy, "/products");
}

export function learnProduct(
  academy: string,
  slug: string,
): Promise<LearnProductDetail> {
  return learnFetch(academy, `/products/${slug}`);
}

/** A signed URL for one free sample. Public — no token required. */
export function learnProductPreview(
  academy: string,
  slug: string,
  fileId: string,
): Promise<{ id: string; title: string; format: string | null; url: string | null }> {
  return learnFetch(academy, `/products/${slug}/preview/${fileId}`);
}

/**
 * The owner's download links. Answers `owned: false` rather than 403 for someone who has not bought
 * it — the sales page calls this to choose between "Download" and "Buy", and an error there would
 * make the normal case look broken.
 */
export function learnProductAccess(
  academy: string,
  slug: string,
): Promise<{ owned: boolean; files: LearnProductFile[] }> {
  return learnFetch(academy, `/products/${slug}/access`);
}

/** Everything this learner owns. */
export function learnLibrary(academy: string): Promise<{
  products: (LearnProductCard & {
    granted_at: string | null;
    download_count: number;
  })[];
}> {
  return learnFetch(academy, "/library");
}

/** Take a FREE book: one click, no order, no code. Idempotent. */
export function learnClaimProduct(
  academy: string,
  slug: string,
): Promise<{ ok: boolean; slug: string }> {
  return learnFetch(academy, `/products/${slug}/claim`, { method: "POST" });
}

export function learnBookCheckout(
  academy: string,
  slug: string,
): Promise<Omit<LearnCheckout, "already_enrolled" | "course"> & {
  already_owned: boolean;
  product: LearnCheckout["course"] & {
    item_type: "PRODUCT";
    kind: LearnProductKind | null;
    author: string | null;
  };
}> {
  return learnFetch(academy, `/checkout/book/${slug}`);
}

export function learnPlaceBookOrder(
  academy: string,
  slug: string,
  input: { payment_method_id?: string | null; accept_terms: true },
): Promise<{ ok: boolean; order: LearnOrder }> {
  return learnFetch(academy, `/products/${slug}/orders`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// ── learner notifications (docs/lms/10 §5) ───────────────────────────────────

export interface LearnNotification {
  id: string;
  type:
    | "RECEIPT_RECEIVED"
    | "ORDER_APPROVED"
    | "ORDER_REJECTED"
    | "ORDER_REFUNDED"
    | (string & {});
  title: string;
  body: string | null;
  data: {
    order_number?: string;
    course_title?: string;
    course_slug?: string;
    reason?: string | null;
  };
  read_at: string | null;
  created_at: string | null;
}

export function learnNotifications(
  academy: string,
): Promise<{ notifications: LearnNotification[]; unread: number }> {
  return learnFetch(academy, "/notifications");
}

export function learnMarkNotificationsRead(academy: string): Promise<{ ok: boolean }> {
  return learnFetch(academy, "/notifications/read", { method: "POST" });
}

// ── password reset (docs/lms/10 §2) ──────────────────────────────────────────

/**
 * Always resolves for a well-formed address, whether or not it belongs to a learner: the API answers
 * 202 either way so a public course site cannot be used to test who its customers are.
 */
export function learnForgotPassword(
  academy: string,
  email: string,
): Promise<{ ok: boolean; channel?: "EMAIL" | "WHATSAPP" }> {
  return learnFetch(academy, "/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function learnResetPassword(
  academy: string,
  input: { token: string; password: string; password_confirmation: string },
): Promise<{ ok: boolean }> {
  return learnFetch(academy, "/auth/reset-password", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
