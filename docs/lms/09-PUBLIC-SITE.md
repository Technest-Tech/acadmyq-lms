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
`instructors` · `testimonials` · `faq` · `cta` · `contact` · `footer` · `seo` · `pages` · `legal`.
Every optional block carries a `show` flag; `instructors`/`testimonials` render nothing when empty (a
site never invents teachers or reviews), while `features`/`steps`/`faq` fall back to translated
default copy. Images are **URLs, not uploads** — same as `courses.cover_image_path`; no new upload
infrastructure.

Storefront fields worth calling out because they exist to prevent a specific kind of unfinished-
looking page:

| Field | Why |
|---|---|
| `brand.logo_mark_url` | The square mark for the header and small spaces. Falls back to the full logo, then a monogram — one uploaded file is enough. |
| `brand.favicon_url` | The browser tab. Falls back to the mark, then the logo. |
| `hero.cta_label` | Overrides the primary button's words without changing which action it is. |
| `about.mission`, `about.approach` | Rendered **only on the About page**, which is what stops that page being a second copy of the home page. |
| `instructors[].expertise`, `instructors[].link_url` | Comma-separated topics (chips) and one profile link. |
| `contact.hours` | When someone actually answers — the cheapest trust signal on a contact page. |

## The identity rule

An academy created for the course platform is normally seeded with its **subdomain as its name**, so
"lms" or "academy-2" is the DEFAULT state of a new client — and putting it in 48px type at the top of
a public page ("تعلّم مع lms") is the single most amateur thing this template can do.

`apps/web/src/lib/learn-brand.ts` is the one place that decides: the client's brand name wins, then
the academy's own name, and a "name" that is merely the URL handle (compared folded — case,
spacing and punctuation ignored) counts as **no name at all**. The template then renders translated
neutral copy — "المنصة التعليمية" / "The learning platform" — in the header, the headline, the page
title and the footer. The moment the client types a real name it wins everywhere, with no other
logic. The outage fallback in `learn-server.ts` follows the same rule: it never fills the brand name
with the handle.

## What the storefront adapts to — `commerce`

One template serves a Qur'an teacher who hands out access codes by hand and a training company
running full checkout. The difference is not styling; it is **which buttons the page is allowed to
draw**, and that is decided server-side from real rows and shipped with the site document:

```
commerce: { free, free_course: {slug,title}|null, checkout, codes, paid }
```

- `checkout` is **not** just "a course has checkout switched on" — it also requires a live
  `lms_payment_methods` row, because a Buy button with nowhere to send the money strands the buyer.
- `free_course` is the newest free course **that has lessons in it**; an empty one is a dead end.
- `codes` is false when every published course has code redemption switched off.

`components/learn/storefront.tsx` turns that into behaviour: the hero's CTAs (`useHeroCta`), the
starter FAQ (`useDefaultFaq` — never explains a checkout that is off, never leads with access codes
on a shop that sells online), the closing CTA's label, and a course's single primary action
(`courseAction`, shared by the sales card and the sticky mobile bar so they cannot disagree).

**The access code is demoted, not removed.** Where checkout or a free course exists it is a text
link under the hero buttons and a footer entry; on a code-only site it is promoted back to the
primary button. Nothing invents a channel that is not open.

## A course's sales page

Migration `2026_09_08_000003_lms_course_sales_fields` adds the half of a course that the curriculum
cannot say: `level` (closed enum — it drives a catalogue facet), `category` (free text: a Qur'an
academy and a coding school do not share a taxonomy, and the catalogue derives its filter options
from the values actually in use), and three jsonb string lists — `outcomes` ("what you'll learn"),
`requirements` ("before you start") and `audience` ("this course is for you if…").

All optional, all defaulting to empty, and the public page **hides what is unset** rather than
inventing filler. Edited in the course editor's "Sales page" block; served on both the card (level +
category chips) and the sales page.

## API

**Public** — `GET /api/learn/site` (`Learner\SiteController`), inside the existing subdomain-resolved
`learn` group. Returns `{ site: <merged content>, stats: {courses,lessons,learners,certificates},
commerce, academy: {name, subdomain, url} }`. The stats are live catalogue counters, so the stats
band says something true even for an unconfigured site; `commerce` is the block above; `academy.url`
is this tenant's own canonical origin, so each client emits its own canonical link and OG URL and no
tenant's SEO can leak into another's.

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
  `PageHero`) and the one button (`CtaButton`: two sizes, four surfaces, one focus ring). Pure
  presentational, content in props.
- `components/learn/storefront.tsx` — the adaptive layer (see `commerce` above): CTAs, the starter
  FAQ, the shop-style price (`useCoursePrice` — "400 ج.م", not "400.00 ج.م") and `courseAction`.
- `components/learn/site-chrome.tsx` — header (logo, nav, language toggle, redeem CTA, account
  menu) and footer. Hidden on `/watch/*` so the player stays focus-mode. `useBottomBarInset`
  publishes the sales page's sticky bar height so the floating WhatsApp button lifts clear of it.
- `components/learn/site-modal.tsx` — every storefront dialog. `Modal` portals into `document.body`,
  escaping the `.learn-site` wrapper; this carries the light palette and the brand variables across
  the portal, so a visitor in OS dark mode does not get black fields on a white sign-in card.
- `components/learn/auth-forms.tsx` — sign-in / register / redeem, shared by the header modals and
  the standalone `/login`, `/register`, `/redeem` pages. Persistent labels (never placeholders
  alone), a show/hide password toggle, localized validation, and errors mapped by HTTP status so no
  raw framework message reaches a student.

Two template-wide rules that only show up when they are missing:

- **`dir="auto"` on every piece of tenant-authored text** — titles, subtitles, section and lesson
  names, bios, quotes, policies. The paragraph direction is the *visitor's* language; a course title
  is the *academy's*, and an Arabic title in an English page reorders its Latin words without it.
- **The site has one closing CTA.** The footer used to open with a panel rendering `cta.title` /
  `cta.subtitle` — the same words `CtaBand` had just printed, one block above. The footer no longer
  carries a CTA of its own.

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

`apps/api/tests/Feature/Lms/LmsStorefrontTest.php` — the adaptive half: every door reported shut for
an empty catalogue; no `checkout` without a live payment method; the free-course CTA skips a
lesson-less course; drafts ignored; the canonical URL; the new profile fields round-tripping and
still rejecting `javascript:`; the course sales fields from editor → card → sales page, with blank
rows dropped, the level enum enforced, list caps enforced, and a partial PATCH not blanking them.

Web (`apps/web`): `lib/learn-brand.test.ts` (the identity rule), `lib/money.test.ts`
(`trimZeroDecimals`), `components/learn/storefront.test.tsx` (the CTA/FAQ/action matrix),
`components/learn/site-chrome.test.tsx` (the footer never announces missing configuration) and
`i18n/messages.test.ts` (ar/en parity — next-intl prints the key path when a message is missing, and
on this site that is visible to a client's customers). `src/test/learn-site.tsx` builds fixtures on
top of `emptySiteContent()`, so they cannot drift from the schema.
