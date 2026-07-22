# 06 — Frontend surfaces

Two surfaces, one Next.js app (`apps/web`), split by route group.

## A. Staff dashboard — `(app)/courses`

Lives beside `(app)/crm`, behind the existing `AppShell`, staff auth, and sidebar gating. The
sidebar item shows only when the academy has the `lms` entitlement (same upgrade-badge gating the
other modules use). Pages:

| Route | Purpose | Gate |
|---|---|---|
| `/courses` | Course list (draft/published/archived), "New course" | `course.read` |
| `/courses/[id]` | Course editor: sections + lessons, drag-reorder, publish toggle | `course.manage` |
| `/courses/[id]/lessons/[lid]` | Lesson editor: pick type, YouTube URL / upload / PDF / text / quiz, attachments, preview flag | `course.manage` |
| `/courses/codes` | Access codes: batch generate, list, redemption counts, expiry, active toggle, CSV export | `access_code.manage` |
| `/courses/learners` | Learners + enrollments, block/unblock, revoke access | `learner.read` |
| `/courses/settings` | Subdomain handle, site branding (logo, colors, landing copy) | `course.manage` |

The course editor is the heart of the dashboard: a sectioned outline where each lesson is added by
type. YouTube = paste a URL; PDF/audio = upload; text = a markdown editor; quiz = the quiz builder
(phase 4). Video upload (phase 3) shows a transcode-progress state driven by `media_assets.status`.

## B. Learner site — `(learn)` route group on `<academy>.<platform>`

Public, tenant-resolved by subdomain (see [02](02-LEARNER-AUTH-AND-SUBDOMAINS.md)). Branded per
academy (logo/colors from `/courses/settings`). Pages:

| Route | Purpose | Auth |
|---|---|---|
| `/` | Landing + catalog of published courses, academy branding, hero | public |
| `/c/[slug]` | Course detail: description, curriculum outline, preview lessons, "enroll with code" CTA | public |
| `/auth/register`, `/auth/login` | Learner signup / login | public |
| `/redeem` | Enter an access code → unlock course(s) | learner |
| `/learn/[slug]` | The player: lesson list + current lesson (video/YouTube/audio/PDF/text/quiz), progress, resume, attachments | learner + enrolled |
| `/me` | Learner's enrolled courses, progress, certificates | learner |

The player is the core learner surface: a lesson sidebar (progress ticks) + a content pane that
switches on lesson type. Progress posts as the learner watches; completing a course surfaces the
certificate.

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
