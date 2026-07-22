# 01 — Data model

All tables follow the house conventions proven by `crm_leads`:

- PK `uuid primary key default uuid_generate_v7()`.
- `academy_id uuid not null references academies(id) on delete cascade` on **every** row (even child
  rows) so RLS can scope by tenant with a single predicate.
- RLS: `enable row level security; force row level security;` + a `tenant_isolation` policy
  `using (academy_id = app.current_academy_id()) with check (academy_id = app.current_academy_id())`.
- `created_at / updated_at timestamptz not null default now()`; soft-delete via `deleted_at` only
  where history must outlive a delete.

Tables are grouped by the phase that introduces them. Phase 1 is the only set built now; the rest are
specified here so the phase-1 tables are shaped to receive them (e.g. `lessons.quiz_id` FK exists as
a nullable column from day one, wired when quizzes land).

---

## Phase 1 — course content

### `courses`
The publishable unit. `slug` is the last path segment on the learner site (`/c/<slug>`).

```
id             uuid pk
academy_id     uuid not null → academies (cascade)
title          text not null
slug           text not null                       -- unique per academy
subtitle       text
description     text
cover_image_path text                              -- object-storage key
status         text not null default 'DRAFT'       -- DRAFT | PUBLISHED | ARCHIVED
created_by     uuid                                 -- staff users.id (no FK: RLS-crossing)
published_at   timestamptz
created_at / updated_at / deleted_at
unique (academy_id, slug)
index (academy_id, status, created_at desc)
```

### `course_sections`
Ordered chapters within a course.

```
id          uuid pk
academy_id  uuid not null → academies (cascade)
course_id   uuid not null → courses (cascade)
title       text not null
position    int not null default 0
created_at / updated_at
index (course_id, position)
```

### `lessons`
One item. `type` selects which payload column is meaningful (app-enforced, not a DB partial
constraint — keeps the migration simple and the builder flexible).

```
id             uuid pk
academy_id     uuid not null → academies (cascade)
course_id      uuid not null → courses (cascade)          -- denormalized for RLS + flat queries
section_id     uuid not null → course_sections (cascade)
title          text not null
type           text not null                              -- VIDEO_UPLOAD | YOUTUBE | AUDIO | PDF | TEXT | QUIZ
position       int not null default 0
is_preview     boolean not null default false             -- watchable without enrollment (marketing)
duration_seconds int                                       -- video/audio, for display + progress %
-- type payloads (exactly one is used per row):
media_asset_id uuid → media_assets (set null)             -- VIDEO_UPLOAD, AUDIO
youtube_video_id text                                      -- YOUTUBE (parsed 11-char id, not the URL)
attachment_path  text                                      -- PDF (object-storage key)
body           text                                        -- TEXT (markdown/rich text)
quiz_id        uuid → quizzes (set null)                   -- QUIZ (FK wired in phase 4)
created_at / updated_at
index (course_id, section_id, position)
```

### `lesson_attachments`
Supplementary downloadable resources hung off any lesson (worksheets, slides).

```
id          uuid pk
academy_id  uuid not null → academies (cascade)
lesson_id   uuid not null → lessons (cascade)
title       text
file_path   text not null                                  -- object-storage key
size_bytes  bigint
created_at
index (lesson_id)
```

### `media_assets`
An uploaded video or audio file and its transcode lifecycle. A row is created when the dashboard
requests an upload URL; the transcode worker walks it `PENDING → PROCESSING → READY`. In phase 1 the
table exists and the builder can reference it, but real upload/transcode is **phase 3** — until then
only `YOUTUBE`, `AUDIO` (direct file, no HLS), `PDF`, and `TEXT` lessons are offered.

```
id                uuid pk
academy_id        uuid not null → academies (cascade)
kind              text not null                            -- VIDEO | AUDIO
original_filename text
storage_key       text                                     -- source upload key
hls_manifest_key  text                                     -- .m3u8 key once transcoded (video)
playback_path     text                                     -- audio: direct object key
duration_seconds  int
size_bytes        bigint
status            text not null default 'PENDING'          -- PENDING | UPLOADING | PROCESSING | READY | FAILED
error             text
created_by        uuid
created_at / updated_at
index (academy_id, status)
```

---

## Phase 2 — learners, codes, enrollment, progress

### `learners`  — the new actor (see [02](02-LEARNER-AUTH-AND-SUBDOMAINS.md))
```
id                uuid pk
academy_id        uuid not null → academies (cascade)
email             text not null
password          text not null                            -- bcrypt/argon hash
full_name         text not null
phone             text
email_verified_at timestamptz
status            text not null default 'ACTIVE'           -- ACTIVE | BLOCKED
last_login_at     timestamptz
created_at / updated_at
unique (academy_id, lower(email))                          -- email unique PER academy, not globally
```

### `access_codes` (see [03](03-ACCESS-CODES-AND-ENROLLMENT.md))
```
id                uuid pk
academy_id        uuid not null → academies (cascade)
code              text not null                            -- human-friendly, e.g. "SCIENCE-7F3K"
label             text                                     -- "Grade 10 Batch A" (admin note)
max_redemptions   int                                      -- null = unlimited, 1 = single-use
redemptions_count int not null default 0
expires_at        timestamptz
is_active         boolean not null default true
created_by        uuid
created_at / updated_at
unique (academy_id, code)
index (academy_id, is_active)
```

### `access_code_courses` — which courses a code unlocks (one code → many courses)
```
academy_id  uuid not null → academies (cascade)
code_id     uuid not null → access_codes (cascade)
course_id   uuid not null → courses (cascade)
primary key (code_id, course_id)
```

### `code_redemptions` — audit of who consumed a code
```
id          uuid pk
academy_id  uuid not null → academies (cascade)
code_id     uuid not null → access_codes (cascade)
learner_id  uuid not null → learners (cascade)
redeemed_at timestamptz not null default now()
unique (code_id, learner_id)                               -- a learner redeems a given code once
```

### `enrollments` — the access gate the player checks
```
id             uuid pk
academy_id     uuid not null → academies (cascade)
learner_id     uuid not null → learners (cascade)
course_id      uuid not null → courses (cascade)
source_code_id uuid → access_codes (set null)             -- provenance; survives code deletion
status         text not null default 'ACTIVE'             -- ACTIVE | REVOKED
enrolled_at    timestamptz not null default now()
unique (learner_id, course_id)                             -- one enrollment per course
index (academy_id, course_id)
```

### `lesson_progress` — resume point + completion
```
id               uuid pk
academy_id       uuid not null → academies (cascade)
learner_id       uuid not null → learners (cascade)
course_id        uuid not null → courses (cascade)
lesson_id        uuid not null → lessons (cascade)
status           text not null default 'IN_PROGRESS'      -- IN_PROGRESS | COMPLETED
position_seconds int not null default 0                   -- resume point for video/audio
completed_at     timestamptz
updated_at       timestamptz not null default now()
unique (learner_id, lesson_id)
```

---

## Phase 4 — quizzes & certificates

### `quizzes`
```
id           uuid pk
academy_id   uuid not null → academies (cascade)
course_id    uuid not null → courses (cascade)
title        text
pass_mark    int not null default 60                       -- percent
max_attempts int                                            -- null = unlimited
created_at / updated_at
```

### `quiz_questions`
```
id          uuid pk
academy_id  uuid not null → academies (cascade)
quiz_id     uuid not null → quizzes (cascade)
prompt      text not null
type        text not null                                  -- SINGLE | MULTIPLE | TRUE_FALSE
points      int not null default 1
position    int not null default 0
```

### `quiz_options`
```
id          uuid pk
academy_id  uuid not null → academies (cascade)
question_id uuid not null → quiz_questions (cascade)
text        text not null
is_correct  boolean not null default false
position    int not null default 0
```

### `quiz_attempts`
```
id           uuid pk
academy_id   uuid not null → academies (cascade)
learner_id   uuid not null → learners (cascade)
quiz_id      uuid not null → quizzes (cascade)
score        int                                            -- percent
passed       boolean
started_at   timestamptz not null default now()
submitted_at timestamptz
```

### `quiz_answers`
```
id                 uuid pk
academy_id         uuid not null → academies (cascade)
attempt_id         uuid not null → quiz_attempts (cascade)
question_id        uuid not null → quiz_questions (cascade)
selected_option_ids jsonb                                   -- array of option ids
```

### `course_certificates`
Issued on course completion (all lessons COMPLETED + every quiz passed). Where the existing
`certificate.*` capability + certificate rendering can be reused, prefer that over a parallel system;
this table only records issuance.

```
id           uuid pk
academy_id   uuid not null → academies (cascade)
learner_id   uuid not null → learners (cascade)
course_id    uuid not null → courses (cascade)
serial       text not null                                  -- printable verification code
issued_at    timestamptz not null default now()
unique (learner_id, course_id)
```

---

## RLS note on the learner path

Learner-facing reads run under the **learner's academy context** (`app.current_academy_id()` set from
the resolved subdomain, see [02](02-LEARNER-AUTH-AND-SUBDOMAINS.md)), so the same `tenant_isolation`
policy that protects staff reads also protects learner reads — a learner on `academy-a.<platform>`
can never see `academy-b`'s courses. Row-level "which courses may THIS learner see" (enrollment) is a
**controller** concern layered on top of tenant isolation, exactly as capability checks are for staff.
