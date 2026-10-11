# 13 — Booking forms & the requests inbox

Some clients sell **consultations** ("احجز استشارة"), some take **course bookings** ("احجز كورس"),
some do both. Rather than two features, the course site carries any number of **booking forms**,
each named by the client, and every submission lands in **one inbox** in the dashboard.

## What the client gets

- **Dashboard → Bookings** (`/lms/bookings`, nav key `lmsBookings`)
  - **Requests** tab — every request from every form. Opens on *Open* (New + Contacted +
    Confirmed). Search, filter by form, stat tiles, a phone-friendly card list.
  - A request drawer: one-tap **WhatsApp** (local Egyptian `01…` numbers completed to `201…`),
    call, email; what they asked (course, choice, preferred date/time, message); the status
    pipeline; a staff-only note; delete (for spam — real requests get *Cancelled*).
  - **Forms** tab — create from a preset (consultation / course / blank), edit, hide/show, copy
    link, delete. Deleting a form never deletes its requests.
  - Sidebar badge = count of **NEW** requests (derived: it clears when someone moves the request
    on, not when they look).
- **Course site**
  - `/book/<slug>` — the form page, titled with the client's own name. Server-rendered metadata so
    a shared WhatsApp link previews properly.
  - Header/footer nav link per form flagged *Show in the site menu*, labelled with its title.
  - Home page **booking band** for forms flagged *Show on the home page* — one form gets the whole
    band, several get a card each.
  - Course page: a "{form title}" button (course pre-picked via `?course=<slug>`) when a form asks
    *which course?*; it becomes the primary button on a course that is otherwise not for sale.
  - Hero: `primary_cta = "booking"` in the site editor makes the form the main button; with the
    default `browse`, an advertised form is the hero's second button when there is no free course.

## What a form asks

Name + phone are always asked (a request nobody can call back is not a request). Each form switches
on any of: **email**, **which course** (published courses only), **preferred date + time**,
**message**, and **one client-defined pick-list** (`choice_label` + up to 12 `choices`; non-empty ⇒
required). Optional copy: intro, button label, thank-you message — blank means the template's
translated default.

Configured, not built: a free-form field builder was deliberately skipped — no client has asked for
one, and every free-form answer is a column the inbox cannot filter on.

## Data

`2026_10_12_000001_lms_bookings`

| Table | Notes |
|---|---|
| `booking_forms` | per-academy, `unique(academy_id, slug)`, `status ACTIVE|HIDDEN`, the switches above, `choices jsonb` |
| `booking_requests` | `form_id` + `course_id` + `learner_id` all **ON DELETE SET NULL**; `form_title` / `course_title` are **snapshots** so the inbox reads right after a rename or delete; `preferred_date date` + `preferred_time 'HH:MM'` are wall-clock wishes, never a timestamptz |

Both FORCE-RLS `tenant_isolation`. Status pipeline: `NEW → CONTACTED → CONFIRMED → COMPLETED`, or
`CANCELLED` — deliberately not enforced as a sequence (confirming on the first call skips
CONTACTED; a mis-click has to be undoable).

## API

Public (`/api/learn`, `resolve.academy`, CSRF-exempt with the rest of `api/learn/*`):

| Route | |
|---|---|
| `GET /bookings/{slug}` | the form + the course list when it asks for one; HIDDEN/unknown → 404 |
| `POST /bookings/{slug}` | throttle `learn-booking` (5/min, 20/h per tenant+IP); honeypot `website`; only asked fields are stored; same phone + same form + still NEW within 10 min ⇒ folded into that request |
| `GET /site` | `commerce.bookings[]` = ACTIVE forms `{slug,title,description,ask_course,nav,home}`, oldest first |

Anonymous by design; a valid learner bearer token for this academy links `learner_id`.

Staff (`entitled:lms`):

| Route | Capability |
|---|---|
| `GET /courses/bookings` (DataTable: `status`, `form_id`, `course_id`, `from`, `to`, `open`) | `booking.read` |
| `GET /courses/bookings/summary` · `GET /courses/bookings/{id}` | `booking.read` |
| `PATCH /courses/bookings/{id}` (`status`, `staff_note`) · `DELETE` | `booking.manage` |
| `GET /courses/booking-forms` | `booking.read` |
| `POST` / `PATCH /{id}` / `DELETE /{id}` `/courses/booking-forms` | `booking.manage` |

## Permissions

`booking.read` / `booking.manage` (migration `2026_10_12_000002`), granted to `ACADEMY_OWNER` and
`SUPERVISOR` (not money). Their own pair rather than `course.*`: whoever returns "call me back"
requests is often a receptionist, not the person building courses. Listed under the LMS group in
the role builder; `FEATURE_BY_DOMAIN['booking'] = 'lms'`.

## Deferred on purpose

- Real slot booking (availability calendar, no double-booking). Today the visitor *suggests* a time
  and staff confirm it in the note.
- Notifying the visitor (WhatsApp/email confirmation) — an anonymous form that triggers messages
  from the academy's own number to any typed phone is an abuse vector; needs a design first.
- Staff alerts beyond the sidebar badge (WhatsApp group alert on a new request).

Tests: `apps/api/tests/Feature/Lms/BookingRequestsTest.php` (8),
`apps/web/src/app/learn/[academy]/book/[slug]/booking-screen.test.tsx` (8).
