# 05 — Billing, entitlement & permissions

The LMS becomes a sellable module by touching the same five seams CRM touched two weeks ago. This is
the concrete Phase-1 backend registration.

## 1. Register `LMS` as a module

**Billing engine** — add to the module list:

```php
// app/Services/ModuleBilling.php
public const MODULES = ['MANAGEMENT', 'VIDEO', 'WHATSAPP', 'CRM', 'LMS'];
```

Nothing else in `ModuleBilling` changes — enable / trial / pause / end / suspend / recompute /
syncLegacy are all generic over the module string. (LMS has no add-on feature-key mapping, so it is
absent from `ADDON_MODULE` — its price is entirely the plan price.)

**DB constraint** — widen the `module` check on `plans` and `module_subscriptions`, using the exact
`pg_constraint` replacement pattern from `2026_07_17_000001_crm_module_code.php`:

```
('MANAGEMENT','WHATSAPP','VIDEO','CRM','LMS')
```

Migration: `2026_07_22_000001_lms_module_code.php`.

## 2. The `lms` entitlement capability

**FeatureCatalog** — the module's capability + its numeric limits:

```php
// app/Support/FeatureCatalog.php — CAPABILITIES
'lms' => 'LMS — online courses (course builder & learner site)',

// LIMITS
'maxCourses'   => 'LMS — max published courses',
'maxLearners'  => 'LMS — max learners',
'maxStorageGb' => 'LMS — media storage (GB)',
```

`lms` is a normal bundle-able capability (NOT Meet-exclusive), so `bundledCapabilities()` picks it up.
Limits **fail open** (an uncapped plan is unlimited); the capability **fails closed** (no plan grant →
no LMS). Storage/course caps are enforced in the controllers via `Entitlement::withinLimit`.

**Entitlement resolver** — union the LMS sub's capabilities, exactly like the CRM sub (scoped
suspension applies for free: a PAUSED/lapsed LMS module stops granting while other modules keep
working):

```php
// app/Support/Entitlement.php — resolveFromModules()
$lms = $grantable->firstWhere('module', 'LMS');
...
if ($lms !== null) {
    $capabilities = array_merge(
        $capabilities,
        self::decodeFeatures($lms->features ?? null)['capabilities'],
    );
}
```

## 3. Seed the plan

`2026_07_22_000004_seed_lms_plan.php`, mirroring `seed_crm_plan`:

```php
code       'LMS_BASIC'
name       'LMS'
module     'LMS'
price_minor 49900          // 499 EGP/month placeholder — edit in /admin/plans
currency   'EGP'
features   { "capabilities": ["lms"], "limits": {} }   // uncapped to start
```

Idempotent on `code`, ADDITIVE, under the transaction-local SUPER_ADMIN context. Plans are DATA — the
Super Admin reprices and adds tiers (e.g. an LMS_PRO with a bigger `maxStorageGb`) in `/admin/plans`
with no deploy.

## 4. RBAC permissions

`2026_07_22_000003_seed_lms_permissions.php`, mirroring `seed_crm_permissions` — OWNER-only by
default, delegated to staff through a custom role:

| Code | Grants |
|---|---|
| `course.read` | See courses, lessons, learners, reports |
| `course.manage` | Create/edit/publish/archive courses, sections, lessons, upload media |
| `access_code.manage` | Generate/deactivate/export access codes |
| `learner.read` | See learners + enrollments; block/unblock, revoke access |

**PermissionCatalog** — add the four codes to `PERMISSIONS`, and add them to the `ACADEMY_OWNER`
branch of `roleMap()` (the `$academyScoped` list). Not added to STAFF/TEACHER baselines — an owner
delegates via the custom-roles builder (the whole point of the module pattern, same as CRM).

> RBAC vs. entitlement, both required: a staff member needs the `course.*` **capability** (are they
> allowed?) AND the academy needs the `lms` **entitlement** (does the plan include it?). Routes are
> gated `->middleware(['can:course.manage', 'entitled:lms'])`.

## 5. Route gating

Dashboard (staff) API under `/api/courses/*`, gated by `auth:api` + `entitled:lms` + the relevant
`can:course.*`. Learner API under `/api/learn/*`, gated by `auth:learner` + `resolve.academy` (no
`entitled:` — the learner site is only reachable when the academy's LMS module is live, enforced at
subdomain resolution).

## The LMS-only client

An academy that buys *only* the LMS is a client whose sole live `module_subscriptions` row is `LMS`.
`ModuleBilling::primaryModule` falls through `MANAGEMENT → VIDEO → first module`, landing on `LMS`;
`syncLegacy` mirrors its plan to `academies.plan_id` so legacy reads stay correct. This is the same
shape as the existing WhatsApp-only external client (M-CLI-2) — no new billing code.

## Phase-1 migration set

| File | Does |
|---|---|
| `2026_07_22_000001_lms_module_code.php` | widen `module` check on plans + module_subscriptions to include `LMS` |
| `2026_07_22_000002_lms_courses.php` | `courses, course_sections, lessons, lesson_attachments, media_assets` + RLS |
| `2026_07_22_000003_seed_lms_permissions.php` | `course.read/manage, access_code.manage, learner.read` → OWNER |
| `2026_07_22_000004_seed_lms_plan.php` | `LMS_BASIC` plan |

Plus the code edits: `ModuleBilling::MODULES`, `FeatureCatalog` (capability + limits),
`PermissionCatalog` (codes + roleMap), `Entitlement::resolveFromModules` (LMS union).
