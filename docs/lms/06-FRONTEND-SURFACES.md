# 06 — Frontend surfaces

Two surfaces, one Next.js app (`apps/web`), split by route group.

## A. Staff dashboard — the `(app)/lms` workspace

The course platform is its own **workspace**, not a page: a dedicated `lms` sidebar group whose items
are the LMS surfaces. Lives behind the existing `AppShell` + staff auth. Pages:

| Route | Purpose | Gate |
|---|---|---|
| `/lms` | **LMS dashboard** — catalogue/learner/enrolment/certificate stats, media storage vs the plan cap, top courses, recent enrolments, and the client's public site with a "visit site" link | `course.read` |
| `/lms/courses` | Course list (draft/published/archived), "New course" | `course.read` |
| `/lms/courses/[id]` | Course editor: sections + lessons, drag-reorder, publish toggle, quiz builder | `course.manage` |
| `/lms/learners` | Learners + enrollments, block/unblock, revoke access | `learner.read` |
| `/lms/codes` | Access codes: batch generate, list, redemption counts, expiry, active toggle, CSV export | `access_code.manage` |
| `/lms/site` | **Public-site editor** — the per-client content of the shared learner-site template: brand, hero, about, why-us, steps, instructors, testimonials, FAQ, contact, footer, SEO ([09](09-PUBLIC-SITE.md)) | `course.read` view / `course.manage` edit |

The old `/courses/*` routes redirect into `/lms/*`. The lesson editor is a modal on the course editor
(not its own route), and the subdomain is provisioned by the Super Admin on the client's Settings tab
(`/admin/clients/[id]`) rather than by the client.

### Who sees what

- **LMS-only client** (`lms.only` capability — the LMS twin of the Meet Plan's `video.only`): the
  sidebar collapses to the LMS group plus the account screens (`/plan`, `/settings`), and
  `/dashboard` redirects to `/lms`. They never see the school-management panel.
- **School that also sells courses**: keeps its full panel, with the LMS group alongside it.
  `Entitlement::resolveFromModules` strips `lms.only` whenever LMS is not the only granting module,
  so a multi-module client can never be collapsed by it.
- **No LMS module**: a single locked "Courses" item remains as the upsell (upgrade badge → `/plan`);
  the rest of the workspace is hidden entirely.

The course editor is the heart of the dashboard: a sectioned outline where each lesson is added by
type. YouTube = paste a URL; PDF/audio = upload; text = a markdown editor; quiz = the quiz builder
(phase 4). Video upload (phase 3) shows a transcode-progress state driven by `media_assets.status`.

## B. Learner site — `learn/[academy]` route group on `<academy>.<platform>`

Public, tenant-resolved by subdomain (see [02](02-LEARNER-AUTH-AND-SUBDOMAINS.md)). A **shared
template** branded per academy from the client's site profile ([09](09-PUBLIC-SITE.md)) — one design
for every client, only the content differs. Pages:

| Route | Purpose | Auth |
|---|---|---|
| `/` | Landing: hero, stats, featured courses, why-us, how-it-works, teachers, reviews, FAQ, CTA | public |
| `/courses` | Full catalogue: search, "my courses" filter | public |
| `/c/[slug]` | Course detail: promise, curriculum, preview lessons, sticky enrol card, related courses | public |
| `/about`, `/faq`, `/contact` | Client-written pages (each hideable from the nav via the site profile) | public |
| `/login`, `/register`, `/redeem` | Standalone auth + code redemption (also available as header modals anywhere) | public / learner |
| `/watch/[slug]` | The player: lesson list + content pane (video/YouTube/audio/PDF/text/quiz), progress, resume — chrome-free focus mode | learner + enrolled |
| `/me` | "My learning": enrolled courses with progress bars, resume, certificates | learner |
| `/certificate/[slug]` | Printable completion certificate | learner + completed |

The player is the core learner surface: a lesson sidebar (progress ticks) + a content pane that
switches on lesson type. Progress posts as the learner watches; completing a course surfaces the
certificate. The whole site is **light-only** — a student-facing marketing site does not inherit a
staff member's dark-mode preference.

Every client renders identical structure and code; the only per-client data is the site profile
([09](09-PUBLIC-SITE.md)), which the client edits at `/lms/site`. An empty profile still yields a
complete, bilingual site because blank fields fall back to the template's own translated copy.

## Middleware & i18n

- `apps/web/src/middleware.ts` routes by `Host`: apex/`app.` → dashboard; other subdomain → `(learn)`
  group with the tenant resolved and a 404 for unknown/unpublished handles.
- The app already ships `messages/en.json` + `messages/ar.json`; the learner site is RTL-aware from
  the same i18n setup — Arabic-first learner UX comes for free.

## Build order on the frontend

1. **Phase 1** — dashboard `/courses` + course/lesson editors for YouTube/audio/PDF/text. No learner
   site yet.
2. **Phase 2** — the `(learn)` group + subdomain middleware + learner auth + `/redeem` + player for
   the phase-1 lesson types + `/me`. This is the first end-to-end demo: a branded course site with
   code-unlocked courses.
3. **Phase 3** — video upload UI (progress) + `hls.js` player.
4. **Phase 4** — quiz builder + quiz runner + certificate view.
