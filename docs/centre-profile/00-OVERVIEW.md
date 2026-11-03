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
| The preset | `AcademyProfile::PRESETS` — CENTRE switches ON `centre` + `accounting`, OFF `supervision`, `teacher_quality`, `report_card`, `student_reports`; QURAN is empty |
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

## What comes next (Phase 2, in order)

1. Levels / grades as an academy-defined list; student level + promotion history.
2. A group as a course with a start, an end and a lesson count; renew / promote / close; a waiting
   list when it is full.
3. Centre holidays that pause lesson generation; make-up lessons; a substitute teacher for one lesson.
4. The parent portal for a centre: group attendance, dues, an absence alert.
5. Exams and grades, a term report, a certificate on completing a level.
6. A public enrolment form → placement lesson → group.
