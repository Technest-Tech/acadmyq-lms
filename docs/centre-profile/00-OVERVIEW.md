# The academy profile — QURAN and CENTRE

One codebase, two kinds of school. The **profile** says which kind an academy is, and decides the
*shape* of its workspace and the *preset* a new client starts from — nothing else.

- **QURAN** — the one-to-one academy the system grew up with: private lessons, hour packages,
  supervision ("Following"), the memorisation report and its picture, the teacher rubric.
- **CENTRE** — the learning centre: English course academies and curriculum "سناتر" alike. Groups
  with a weekly timetable and rooms, subscriptions counted in lessons, numbered receipts and arrears,
  a salary per group lesson. English and curriculum centres are ONE profile: they differ only in
  what their classification is called (a level vs. a grade) and that is an academy setting, not code.

## Where it lives

| Piece | Where |
|---|---|
| The profile itself | `academy_types.code` — `App\Support\AcademyProfile::forAcademy()` maps it (anything but `CENTRE` ⇒ `QURAN`) |
| The preset | `AcademyProfile::PRESETS` — CENTRE switches ON `centre` + `accounting`, OFF `supervision`, `teacher_quality`, `report_card`, `student_reports` and (since the subscription split, `01-PRIVATE-SUBSCRIPTION-SPLIT.md`) `packages`; QURAN is empty |
| Applied when | a Super Admin creates a client with the CENTRE type (`Admin\AcademyController::store`), or `php artisan profile:set <academy> CENTRE` moves an existing one — the preset MERGES onto the client's switches, never replaces them |
| Reaches the web as | `GET /auth/me` → `academy.profile`; `GET /entitlements` → `profile` |
| Web shape | `app-shell.tsx` (`CENTRE_NAV_GROUPS`, `CENTRE_GROUP_OF`, `CENTRE_ORDER`, `CENTRE_HIDDEN_KEYS`, `CENTRE_LABEL_KEYS`), `dashboard-home.tsx` → `centre-dashboard.tsx`, `nav.*Centre` strings |
| Centre numbers | `GET /dashboard/centre` (`CentreDashboardController`, behind `entitled:centre`) |
| Facts before a move | `php artisan profile:survey [--mixed]` — every academy with its profile, switches and the Quran/centre data it holds |

## The rule that keeps it clean

The profile shapes the workspace. **Behaviour never keys on it.** Anything that differs between the
two — how a lesson is counted, how a bill closes, what a discount applies to — keys on the feature
switch that owns it (`centre`, `accounting`, `groups`), exactly as before profiles existed. So:

1. a QURAN academy's code path is byte-for-byte what it was;
2. a Quran academy that is switched onto one centre feature (Al-Furqan takes receipts) keeps its own
   shape and gets just that feature;
3. the sidebar hides, the server refuses: the Quran-only features are OFF for a centre through the
   preset, so `entitled:*` returns 402 on them — a hidden link is never the only guard.

A request from a client goes through one question: is it a **profile** change (every centre wants
it), a **policy** (same thing behaves differently per profile — a class resolved once from the
switch, never an `if ($centre)` inside a shared service), an **opt-in switch** (`OPT_IN_CAPABILITIES`,
off until a Super Admin names it), an academy **setting**, or **custom work** priced and logged.
An academy's name in the code, or a new `if (centre)` in a shared service, is the thing to refuse.

## Moving a live client

```
php artisan profile:survey --mixed          # who holds data that disagrees with their profile
php artisan profile:set "Lingo Academy" CENTRE --dry-run
php artisan profile:set "Lingo Academy" CENTRE
php artisan profile:set "Lingo Academy" QURAN --no-preset   # back, switches untouched
```

Only the type row and (unless `--no-preset`) the MANAGEMENT switches move. No table, row or amount
changes, so moving back is instant. Never hide a page that holds data: the survey says what each
academy actually uses — a mixed academy stays QURAN with its own switches until someone decides by
name.

## Phase 2 — the centre's features (all behind `entitled:centre`)

| # | Feature | Where | State |
|---|---|---|---|
| 1 | **Levels / grades** — academy-defined ordered list on students and groups, promotion with history | `academy_levels`, `students.level_id`, `class_groups.level_id`, `student_level_history`; `App\Services\StudentLevels`; `/levels`, `POST /students/{id}/promote`; Settings → الدورات → المستويات; `components/levels/*` | merged 2026-11-04 |
| 3 | **Holidays + substitute** — closed dates skip generation and cancel pending lessons (reason `HOLIDAY`), delete restores; a colleague covers one lesson and is the one paid | `academy_holidays`, `class_group_lessons.original_teacher_id`; `App\Services\Holidays` (seam in both generators), `HolidayClosures`; `/holidays*`, `POST /group-lessons/{id}/substitute`; Settings → أجازات المركز | merged 2026-11-04 |
| 4 | **Parent portal for a centre** — the child's groups, sheets, attendance; the family's dues on receipts; a WhatsApp absence alert (opt-in) | `App\Services\GuardianPortalCentre`, `Whatsapp\GroupAbsenceAlert` (+ job), `academy_automation_settings.group_absence_alert_*`, template `GROUP_ABSENCE`; `/group-absence-alert`; Settings → واتساب | merged 2026-11-04 |
| 6 | **Public enrolment form → placement** — one stable `/e/{token}` link, an inbox at `/enrolment`, one click books a `trials` row; convert marks the request ENROLLED | `enrolment_forms`, `enrolment_requests`; `Services\Enrolment\*`; `/enrolment/*`, public `/e/{token}`; sidebar "طلبات التسجيل" | merged 2026-11-04 |
| 2 | **Course term** — lessons planned / held / remaining, `ending_soon` (≤14 days or ≤2 lessons), renew / promote / close into a successor group (`continues_group_id`, `closed_reason`), waiting list | `class_group_waitlist`; `App\Services\CourseTerm`, `GroupWaitlist`; `POST /groups/{id}/{renew,promote,close}`, `/groups/{id}/waitlist*`; `components/groups/{course-end-panel,waitlist-panel}.tsx`; dashboard card | merged 2026-11-04 |
| 5 | **Assessments + term report + certificate** — grade sheet per group (own teacher or `group.manage`), per-student report (attendance + weighted grades + comment), publish → parent portal `term_reports`, handoff to the certificate gallery (`/certificates?recipient=…`) | `group_assessments`, `group_assessment_scores`, `group_term_reports`; `App\Services\GroupAssessments`; `/groups/{id}/assessments*`, `/groups/{id}/grades`, `/groups/{id}/reports*`, `/groups/{id}/students/{sid}/report*`; `components/grades/*` | merged 2026-11-04 |

Make-up lessons already existed (`ClassGroupController::addLesson`, `is_extra`) and were not rebuilt.

## Working on it with several agents

Each feature was built on its own branch in its own git worktree, then merged here. Two things bit:
- **A symlinked `apps/api/vendor` in a worktree runs the MAIN checkout's code** — PHP resolves `__DIR__`
  through the symlink, so composer autoloads `App\` from the main `app/` and Pest's root is the main
  checkout. Build `vendor/` as a real directory (copy `autoload.php`, `composer/`, `bin/`, `pestphp/`,
  symlink the other packages) and prove it with a `ReflectionClass(...)->getFileName()`.
- Shared files conflict on merge in predictable places: `routes/api.php` (keep both blocks), the two
  locale files (both append a namespace before the final `}` — keep both, mind the closers), and
  `settings-manager.tsx`. Everything else stayed disjoint because each feature owns its own
  namespace, API client file and component directory.
