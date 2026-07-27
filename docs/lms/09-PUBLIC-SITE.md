# 09 — The public course site

Every LMS client's learner site (`<academy>.<platform>`, or `/learn/<handle>` until DNS is
configured — see [02](02-LEARNER-AUTH-AND-SUBDOMAINS.md)) is the **same template**: the same pages,
the same sections, the same code. The only thing that differs between two clients is a per-academy
**content profile** — brand, copy, contact details — that the client edits themselves. A brand-new
client with an empty profile still gets a complete, professional, bilingual site, because every
field falls back to translated default copy.

This is deliberately the opposite of a page builder. The client does not arrange sections or write
CSS; they fill in the blanks of a fixed, designed template. That is what keeps all the sites looking
professional and lets a design change land once, for everyone.

## The two halves

| Half | Who owns it | Where |
|---|---|---|
| **Template** (structure, layout, styling) | the platform | `apps/web/src/components/learn/` + `apps/web/src/app/learn/[academy]/` |
| **Content** (words, images, colour, contacts) | the client | edited at `/lms/site`, stored in `lms_site_profiles` |

The subdomain itself stays **Super-Admin-owned** (it is the client's address); the client owns
everything rendered on it.

## Data — `lms_site_profiles`

One JSONB row per academy (migration `2026_07_24_000001_lms_site_profiles`), shaped exactly like
`certificate_templates`: presentation content in a single `content` blob under the standard
`tenant_isolation` RLS policy. Same policy serves both readers — staff editing under a normal tenant
context, and the public site, which runs inside the academy's context via `ResolveAcademyContext`.

`App\Support\LmsSiteProfile` is the **schema of record** — not the migration:

- `defaults($academy)` — a complete, valid document for a client who never opened the editor.
  Structural defaults only (the `show` flags, enums, and the brand name/logo pulled off the
  `academies` row). Default *copy* is intentionally **empty here** — the web template fills blanks
  from its own i18n, so the fallback text is bilingual (a PHP constant could only be one language).
- `merge($stored, $academy)` — what the template renders: the client's content laid over the
  defaults, so a blank field can never produce a blank section.
- `sanitize($input)` — the write gate. Strips unknown keys, clamps every string and list to a size
  the layout can render, validates the brand colour as `#rrggbb`, and rejects any URL that isn't
  `http(s)` (images) or `http(s)`/`mailto:`/`tel:`/in-app path (links). A client editing their own
  marketing copy must not be able to put a `javascript:` href on a page students visit. It never
  throws — a bad value degrades to the default rather than 422-ing a 200-field form.

### Content blocks

`brand` · `hero` · `stats` · `about` · `features` (“why learn here”) · `steps` (“how it works”) ·
`instructors` · `testimonials` · `faq` · `cta` · `contact` · `footer` · `seo` · `pages`. Every
optional block carries a `show` flag; `instructors`/`testimonials` render nothing when empty (a site
never invents teachers or reviews), while `features`/`steps`/`faq` fall back to translated default
copy. Images are **URLs, not uploads** — same as `courses.cover_image_path`; no new upload
infrastructure.

## API

**Public** — `GET /api/learn/site` (`Learner\SiteController`), inside the existing subdomain-resolved
`learn` group. Returns `{ site: <merged content>, stats: {courses,lessons,learners,certificates},
academy }`. The stats are live catalogue counters, so the stats band says something true even for an
unconfigured site.

**Staff** — `GET|PUT /api/courses/site` (`Lms\SiteProfileController`, `entitled:lms`). `GET`
(`course.read`) returns the merged document, the bare defaults and the site URL; `PUT`
(`course.manage`) sanitises and upserts on the unique `academy_id`. Never touches
`academies.subdomain`.

## Web — the template

`apps/web/src/app/learn/[academy]/layout.tsx` is a **server component**: it fetches the profile
server-side (`lib/learn-server.ts`, 60 s revalidate) so `generateMetadata` gives each client a real
per-tenant title / description / OG image, and the branded header paints on the first frame. An
unknown handle 404s.

- `components/learn/theme.tsx` — scopes the client's brand colour onto the site root as CSS
  variables (`--primary`, `--ring`, brand tints via `color-mix`). Because the app is token-driven,
  every shared component recolours per client for free. The site is also pinned **light-only** (the
  `.learn-site` class in `globals.css`): a student-facing site must not inherit a staff member's
  dark-mode preference.
- `components/learn/sections.tsx` — the shared section kit (`Hero`, `StatsBand`, `FeatureGrid`,
  `StepsRail`, `AboutSplit`, `InstructorGrid`, `TestimonialGrid`, `FaqAccordion`, `CtaBand`,
  `PageHero`). Pure presentational, content in props.
- `components/learn/site-chrome.tsx` — header (logo, nav, language toggle, redeem CTA, account
  menu) and footer. Hidden on `/watch/*` so the player stays focus-mode.
- `components/learn/auth-forms.tsx` — sign-in / register / redeem, shared by the header modals and
  the standalone `/login`, `/register`, `/redeem` pages.

Pages: `/` (home) · `/courses` · `/c/[slug]` · `/about` · `/faq` · `/contact` · `/redeem` ·
`/login` · `/register` · `/me` (“my learning”) · `/watch/[slug]` (player) · `/certificate/[slug]`.

## Web — the editor

`/lms/site` (`app/(app)/lms/site/`) — one long form of collapsible blocks in the order they appear
on the page, each with a “show on site” switch and add/remove/reorder for repeatable items, a fixed
save bar, and an “open my site” link. Built from the existing LMS kit (`lms-ui.tsx`, `form-bits.tsx`)
plus `components/courses/site-editor-bits.tsx`. Nav item `lmsSite` (gated on `course.read`; the
editor itself needs `course.manage`), in both `LMS_EXTRA_KEYS` and `LMS_ONLY_KEYS`.

## Tests

`apps/api/tests/Feature/Lms/LmsSiteProfileTest.php` — complete document for a fresh academy; save →
serve on the public site; `javascript:`/`data:` URLs rejected while legitimate links survive; length
and list caps; blank rows dropped; tenant isolation; 404 on an unknown handle; read-only without
`course.manage`. (Academies here need `plan_id => LMS_BASIC`, else `entitled:lms` 402s.)
