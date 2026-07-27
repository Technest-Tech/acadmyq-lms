# 08 — Super Admin LMS oversight

The platform-side view of the course platform: **one sidebar item, one roster page, one page per
client**. It is the LMS twin of the video oversight surface
(`docs/video-platform/08-ROOM-ACCESS-AND-MONITORING`) and follows the same two rules:

1. **Every cross-tenant READ goes through an audited SECURITY DEFINER function.** A Super Admin has
   no academy context, so a direct query returns nothing under RLS — the hatches are the only way,
   and each re-asserts `SUPER_ADMIN` in its own body.
2. **One writer per fact (R4).** Starting, trialling, pausing or ending the LMS *module
   subscription* stays on `/admin/clients/{id}`. This surface owns what only makes sense in LMS
   terms: capacity caps, the public site handle, and content/learner moderation.

## Surfaces

| Route | What it is |
|---|---|
| `/admin/lms` | The LMS client roster + platform totals + the LMS activity feed |
| `/admin/lms/[academyId]` | One client: statistics, then the four controls |

Sidebar: `adminLms` ("Course Platform" / "منصة الدورات"), in the `platform` group, right after Video
Ops, gated on `platform.manage`.

### `/admin/lms` — the roster

Six platform tiles (clients, published/total courses, lessons, learners, codes redeemed, media
storage), then one row per client: LMS status, course site handle, published-courses and learners
each drawn as a **usage bar against that client's effective cap**, active enrolments, and storage.
Rows link through to the client page. Below it, the LMS activity feed — course/lesson/learner/code/
enrolment/quiz/media actions across every client, with Super-Admin interventions tinted and badged.

### Which clients count as LMS clients

**Never key this on the module row name.** An LMS client is not reliably a row with `module = 'LMS'`
— the academy-creation flow provisions a single-module client as ONE `MANAGEMENT` row *carrying the
LMS plan*, so a real LMS client often has no `LMS` row at all. The readers originally keyed on the
row name and a live client was invisible until it happened to create a course; the same trap had
already bitten `Entitlement::applyLmsOnlyGuard` in July.

The reliable signal is the **plan**: `plans.module = 'LMS'` marks the LMS tier and nothing else
carries it. So the LMS-bearing subscription resolves as:

```
ms.module = 'LMS'   OR   the sub's plan has plans.module = 'LMS'
```

preferring a dedicated `LMS` row when both exist, so one academy can never yield two rows. The same
order is used by `app.admin_lms_stats`, `app.admin_lms_academy`, `Entitlement::resolveFromModules`
(for the caps override) and `ModuleBilling::container()` (the caps writer) — four places that must
agree about which row governs.

Deliberately **not** keyed on the `lms` capability: FREE and PRO bundle every capability, so that
would list the entire client roster as course-platform clients. A PRO client who actually publishes
courses still appears — through the courses/learners union below.

A client appears on the roster when it has an LMS-bearing subscription **or** any course/learner
data, so neither a brand-new client nor a mid-migration one is ever invisible.

### `/admin/lms/[academyId]` — statistics + controls

Headline tiles (courses published/total, lessons, learners, active enrolments, codes redeemed,
storage vs cap) plus a quieter row (certificates, lessons completed, quiz attempts, failed uploads).

Then the four controls:

| Control | Writes | Audited as |
|---|---|---|
| **Capacity caps** — `maxCourses` / `maxLearners` / `maxStorageGb` | the LMS sub's `overrides.limits`, via `ModuleBilling::setLimitOverrides` | `lms.limits_set` |
| **Public course site** — the subdomain learners reach | `academies.subdomain` (Super-Admin-write, owner-read) | `lms.subdomain_set` |
| **Course moderation** — publish / unpublish / archive | `courses.status` | `lms.course_moderated` |
| **Learner moderation** — block / unblock | `learners.status` | `lms.learner_moderated` |

Every write runs in the target academy's tenant context so its RLS policies admit it, and every
audit row lands in the same feed the roster page shows.

Caps are an **override, not a plan**: a blank field inherits the LMS plan's own limit, and clearing
all three removes the override entirely. This is what lets a single client be raised or lowered
without minting a bespoke plan for them. A client with no live LMS module gets a 422 — enabling the
module is the client page's job.

Course moderation mirrors the client's own publish rule (a published course needs at least one
lesson), and both moderation routes verify the entity belongs to `{academyId}`, so a Super Admin
cannot reach another client's course by guessing an id against the wrong academy.

## Entitlement wiring

`Entitlement::resolveFromModules` now treats the LMS sub the way it treats VIDEO:

- the sub's **plan** contributes only `FeatureCatalog::LMS_LIMIT_KEYS` (the course-platform *tier*),
  so a school's `maxStudents` is never touched by an LMS grant;
- the sub's **`overrides.limits`** then applies over that — the per-academy caps above.

Both apply from any *live* sub, not only a granting one: a paused module stops granting `lms`, but
its caps must stay put so nothing silently becomes unlimited while it is suspended.

## API

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/admin/lms/usage` | roster + totals (`app.admin_lms_stats()`) |
| GET | `/api/admin/lms/academies/{id}` | one client's detail (`app.admin_lms_academy(uuid)`) |
| GET | `/api/admin/lms/activity` | activity feed (`app.admin_lms_audit(uuid,int,int)`) |
| POST | `/api/admin/lms/academies/{id}/limits` | replace/clear the capacity caps |
| PUT | `/api/admin/lms/academies/{id}/subdomain` | set/detach the course site handle |
| POST | `/api/admin/lms/academies/{id}/courses/{courseId}/status` | course moderation |
| POST | `/api/admin/lms/academies/{id}/learners/{learnerId}/status` | learner moderation |

All gated by `platform.manage` in `LmsOversightController`; the readers re-assert `SUPER_ADMIN` in
the database as the second layer.

## Files

| File | Does |
|---|---|
| `2026_07_23_000001_admin_lms_oversight.php` | the three SECURITY DEFINER readers + bypass-role grants |
| `app/Http/Controllers/Admin/LmsOversightController.php` | the three reads + four writes |
| `app/Services/ModuleBilling::setLimitOverrides` | module-agnostic `overrides.limits` writer |
| `app/Support/FeatureCatalog::LMS_LIMIT_KEYS` | the three LMS-scoped limit keys |
| `app/Support/Entitlement::mergeScopedLimits` | key-scoped merge shared by the video tier and LMS |
| `apps/web/src/app/(app)/admin/lms/**` | the two pages, status badges, formatters |
| `tests/Feature/Lms/LmsOversightTest.php` | 11 tests: gate, readers, and each control |
