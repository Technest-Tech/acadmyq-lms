# 03 — Data Model & Migrations (Phase 1)

The database design for the video platform: three new tenant-scoped tables, their migration (following
the house conventions exactly), the RBAC/entitlement seed changes, and the **guest-join** mechanism for
students. This is the blueprint for [05-ROADMAP](05-ROADMAP.md) Phase 1.

Read [01-ARCHITECTURE](01-ARCHITECTURE.md) first. All conventions below mirror existing migrations in
`apps/api/database/migrations/` (uuid v7 PKs, `timestamptz`, `academy_id` + FORCE RLS, `set_updated_at()`
trigger) — rule [V-TEN-1](00-OVERVIEW.md#rules).

---

## 1. Tables at a glance

| Table | Grain | Purpose |
|---|---|---|
| `video_rooms` | one per classroom | Persistent room owned by an academy (and usually a teacher). Maps to a LiveKit room. |
| `room_participants` | one per join | Attendance/history: who joined which room/session, when they left. The "history" value prop. |
| `room_recordings` | one per recording | An Egress recording, linked to room (+ optional session/student), with retention + consent. |

> A separate `room_sessions` table (grouping a single live meeting's participants + recordings) is a
> **possible future addition** if we need per-occurrence grouping beyond the existing `sessions` lesson
> link. v1 deliberately keeps three tables (matches 01-ARCHITECTURE §7).

---

## 2. The migration

One migration file, raw SQL via `DB::unprepared`, exactly like `2026_07_02_000001_custom_roles.php`.

**File:** `apps/api/database/migrations/2026_07_05_000001_video_conferencing.php`

```php
<?php
declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            -- ── enums ───────────────────────────────────────────────────────────────
            create type video_room_status      as enum ('ACTIVE','ARCHIVED');
            create type video_recording_status as enum ('STARTING','RECORDING','COMPLETED','FAILED','ABORTED');

            -- ── video_rooms ─────────────────────────────────────────────────────────
            create table video_rooms (
              id              uuid primary key default uuid_generate_v7(),
              academy_id      uuid not null references academies(id),
              teacher_id      uuid references teachers(id),          -- owner/host; null = academy-level room
              name            text not null,
              livekit_name    text not null unique,                  -- globally-unique LiveKit room name
              status          video_room_status not null default 'ACTIVE',
              record_default  boolean not null default false,        -- V-REC-1: off unless explicitly set
              config          jsonb not null default '{}'::jsonb,    -- per-room settings (max participants, layout…)
              created_at      timestamptz not null default now(),
              updated_at      timestamptz not null default now(),
              deleted_at      timestamptz
            );
            create index video_rooms_academy_idx on video_rooms (academy_id);
            create index video_rooms_teacher_idx on video_rooms (academy_id, teacher_id);

            -- ── room_participants (attendance/history) ──────────────────────────────
            create table room_participants (
              id            uuid primary key default uuid_generate_v7(),
              academy_id    uuid not null references academies(id),
              room_id       uuid not null references video_rooms(id) on delete cascade,
              session_id    uuid references sessions(id),            -- the lesson, when joined for a scheduled session
              identity      text not null,                          -- LiveKit participant identity
              display_name  text,
              user_id       uuid references users(id),               -- set for authenticated joiners (teacher/owner/staff)
              student_id    uuid references students(id),            -- set for guest joiners resolved to a student
              role          text not null default 'PARTICIPANT',
              joined_at     timestamptz not null default now(),
              left_at       timestamptz,
              created_at    timestamptz not null default now(),
              updated_at    timestamptz not null default now(),
              constraint room_participants_role_chk check (role in ('HOST','CO_HOST','PARTICIPANT'))
            );
            create index room_participants_academy_idx on room_participants (academy_id);
            create index room_participants_room_idx on room_participants (academy_id, room_id, joined_at);

            -- ── room_recordings ─────────────────────────────────────────────────────
            create table room_recordings (
              id            uuid primary key default uuid_generate_v7(),
              academy_id    uuid not null references academies(id),
              room_id       uuid not null references video_rooms(id) on delete cascade,
              session_id    uuid references sessions(id),
              student_id    uuid references students(id),
              egress_id     text unique,                            -- LiveKit egress id (idempotent webhooks)
              status        video_recording_status not null default 'STARTING',
              storage_key   text,                                   -- S3 object key (signed-URL access only)
              bytes         bigint,
              duration_s    integer,
              consent       boolean not null default false,         -- V-SEC-2 (minors)
              consent_note  text,
              started_at    timestamptz,
              ended_at      timestamptz,
              expires_at    timestamptz,                            -- V-REC-2 retention; purge job target
              created_at    timestamptz not null default now(),
              updated_at    timestamptz not null default now()
            );
            create index room_recordings_academy_idx on room_recordings (academy_id);
            create index room_recordings_room_idx    on room_recordings (academy_id, room_id);
            create index room_recordings_expiry_idx  on room_recordings (expires_at) where status = 'COMPLETED';

            -- ── updated_at triggers (house convention) ──────────────────────────────
            create trigger video_rooms_set_updated_at       before update on video_rooms       for each row execute function set_updated_at();
            create trigger room_participants_set_updated_at  before update on room_participants  for each row execute function set_updated_at();
            create trigger room_recordings_set_updated_at    before update on room_recordings    for each row execute function set_updated_at();

            -- ── RLS: FORCE + tenant_isolation on every table (V-TEN-1) ──────────────
            alter table video_rooms       enable row level security;
            alter table video_rooms       force  row level security;
            create policy tenant_isolation on video_rooms
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());

            alter table room_participants enable row level security;
            alter table room_participants force  row level security;
            create policy tenant_isolation on room_participants
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());

            alter table room_recordings   enable row level security;
            alter table room_recordings   force  row level security;
            create policy tenant_isolation on room_recordings
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop table if exists room_recordings;
            drop table if exists room_participants;
            drop table if exists video_rooms;
            drop type  if exists video_recording_status;
            drop type  if exists video_room_status;
        SQL);
    }
};
```

> **Grant note:** new tables are owned/used by the `academiq_app` role like every other tenant table —
> no special grant needed beyond what the baseline migration already applies. Verify with an RLS test
> (TC-V1.5) that academy A cannot see academy B's rows.

---

## 3. Guest join for students (design decision)

**Problem:** students/guardians are **not** `users` — they have no login. Only owners/teachers/staff do.
So "log in and join" does not apply to the student side.

**Decision (`V-ACC-2`, extends 01-ARCHITECTURE §3):** students join via a **stateless signed guest
link**, delivered over the **existing WhatsApp gateway** — no account, no new table.

Flow:
```
Near lesson time, a job (sibling of LessonReminderJob) sends the guardian a WhatsApp message:
   "Your lesson starts soon — join: https://app/.../join/<signed-token>"
        token = signed JWT { room_id, session_id?, student_id?, exp (minutes), display_name }
                signed server-side with an app secret (NOT the LiveKit secret)
   │
   ├─ Student opens the link (public route, NO Sanctum):
   │     POST /video/guest/join   { token }      [VerifyGuestToken middleware]
   │        • validates signature + expiry
   │        • loads the room under the token's academy via Tenancy::withContext
   │        • mints a LiveKit access token: roomJoin + canPublish + canSubscribe (NEVER roomAdmin/record)
   │        • writes a room_participants row (student_id from the token, user_id null)
   │     ← { url, token, room, identity }
   │
   └─ Flutter app (or web) connects to the SFU with that token.
```

Why this is the right fit:
- Mirrors the existing **`public_token`** pattern (anonymous invoice pages) and reuses the **WhatsApp
  automation** already in the system — zero new delivery channel.
- **Stateless**: nothing stored until the student actually joins (then a `room_participants` row records
  attendance/history).
- **Scoped + short-lived**: the guest LiveKit token is join+publish only, expires in minutes, and only
  for the one room.

Authenticated joins (teacher/owner/staff) still use the `can:room.join` endpoint from 01-ARCHITECTURE §3.
A new middleware `VerifyGuestToken` (modeled on `VerifyWhatsAppWebhook`) guards the public guest route.

---

## 4. RBAC seed changes (capabilities)

Data-only — no resolver/Gate code changes (rule: capabilities are catalog data).

**`apps/api/app/Support/PermissionCatalog.php`** — add to `PERMISSIONS`:
```php
'room.read'       => 'View video rooms and their details',
'room.create'     => 'Create a video room',
'room.join'       => 'Join a video room as an authenticated host/participant',
'room.manage'     => 'Edit/delete a room, control recording, act as in-call admin',
'recording.view'  => 'View and download room recordings',
```
And map them in `roleMap()`:
| Role | Capabilities granted |
|---|---|
| `ACADEMY_OWNER` | all five |
| `TEACHER` | `room.read`, `room.create`, `room.join`, `room.manage`, `recording.view` |
| (custom roles) | composed by the academy from the same catalog — automatic |

Then seed the new rows in **`apps/api/database/seeders/PermissionSeeder.php`** (`permissions` +
`role_permissions`). Students need **no** capability — they join as guests (§3).

---

## 5. Entitlement & billing seed changes

**Capability:** add `video.conferencing` to **`apps/api/app/Support/FeatureCatalog.php`** `CAPABILITIES`.

**Bundled (PRO):** add `video.conferencing` to the PRO plan's `plans.features.capabilities` JSON
(via the seeders `DemoAcademySeeder`/`ShowcaseAcademySeeder` and the Super-Admin Plan editor).

**Standalone (per-currency add-ons):** seed one `add_ons` row per supported currency, all sharing
`feature_key = 'video.conferencing'` (the no-FX rule means one priced row per currency — see
00-OVERVIEW §5):
```
VIDEO_EGP  feature_key=video.conferencing  price_minor=…  currency=EGP
VIDEO_USD  feature_key=video.conferencing  price_minor=…  currency=USD
VIDEO_GBP  feature_key=video.conferencing  price_minor=…  currency=GBP
VIDEO_SAR / VIDEO_AED / VIDEO_EUR …
```
Granting via `Admin/AcademyController::grantAddOn` inserts an `academy_addons` row and auto-calls
`AcademyBilling::recomputeTotals()`, so the price flows into `academy_subscriptions.total_cost_minor`
and the next `academy_invoices` bill — no new billing code. (Per-room metering is finalised in Phase 5.)

---

## 6. Demo / seed data

Extend **`apps/api/database/seeders/ShowcaseAcademySeeder.php`** (Al-Furqan) with deterministic UUIDs:
- 2–3 `video_rooms` (one per demo teacher).
- A handful of `room_participants` rows across past sessions (so the history view has data).
- 1–2 `room_recordings` (status `COMPLETED`, a fake `storage_key`, an `expires_at`) so the recordings
  library renders.
- Grant the `VIDEO_EGP` add-on to Al-Furqan so the video section is unlocked in the showcase.

Follow the existing deterministic-ID + idempotent pattern (stable UUIDs derived from string seeds).

---

## 7. Phase-1 data checklist (maps to AC-V1.*)

- [ ] Migration `2026_07_05_000001_video_conferencing.php` creates 3 tables + 2 enums + RLS + triggers.
- [ ] `room.*` + `recording.view` added to `PermissionCatalog` + `roleMap()` + seeded.
- [ ] `video.conferencing` added to `FeatureCatalog`; per-currency `add_ons` seeded; PRO bundles it.
- [ ] `VerifyGuestToken` middleware + public guest-join route (§3).
- [ ] RLS test proves cross-tenant isolation on all three tables (TC-V1.5).
- [ ] Showcase seeder renders rooms + recordings for Al-Furqan.

> **Doc coherence:** this introduces guest-join (`V-ACC-2`), which extends the token flow in
> 01-ARCHITECTURE §3. That doc has been cross-referenced accordingly.
