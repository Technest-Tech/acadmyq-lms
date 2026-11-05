# The centre workspace as one piece — coherence audit

2026-11-04, from the three inventories behind `01-PRIVATE-SUBSCRIPTION-SPLIT.md` plus direct
reads of the suspects. Question asked: does every screen and section a centre sees serve the
centre and connect to the rest, or is it a Quran feature that merely shows up, a page with no job,
or a section nobody needs? Verdicts per surface: **keep**, **fix**, **move**, **hide**, **remove**,
**missing**.

## 1. Quran features that still show up for a centre

| Surface | What a centre sees | Why it is wrong | Verdict |
|---|---|---|---|
| Notifications → "Reports" tab | REPORT_OVERDUE rows: "teacher X has not filed the lesson report" | `FlagOverdueReportsJob` runs for every academy with attended `sessions` and no `session_reports` row; no capability gate found in the job. A centre's private lessons get flagged although the centre never asked teachers for a memorisation-style report | **hide** the tab unless `lesson_report` / `student_reports`; gate the job on the same; same for the REPORT_OVERDUE staff WhatsApp alert |
| Notifications → "Classes" (cancellation requests) and "Attended classes" | sessions only | Group lessons never appear: a cancelled or held group lesson is invisible here. Half a log | **fix**: group lessons feed both, or the page says "private lessons" |
| Notifications → "Packages" tab + sidebar badge | package alerts | replaced by the split | **remove** (split, step 3) |
| Attendance → private tab → "Follow" control | the Supervision "Following" button | `supervision` is OFF in the centre preset but the button is gated by permission only | **hide** when `supervision` is off |
| Attendance → private tab → lesson-report modal, report archive | free-text lesson report per private lesson | the report machinery the Quran academy lives on; for a centre it is optional at best | **hide** unless `lesson_report` (the structured one) — keep the outcome and WhatsApp message |
| Teacher profile fact "Rate" (hourly), student profile fact "Rate", students list "Rate" and "Subscription" columns (monthly plan badge, plan label, since) | hourly rate, monthly plan | a centre has no hourly rate and no monthly plan; the group teacher is paid per lesson, the student holds groups + blocks | **fix**: teacher fact = pay type; student fact/column = groups count + open private blocks |
| Student profile → Subscription tab, under the centre card | hourly terms card, `StudentMonthCard`, monthly-terms form when there is no subscription | Quran billing clock rendered under the centre's own card | **remove** for a centre (split, step 4) |
| Staff WhatsApp alerts — Supervision group: SESSION_STARTED, SESSION_NOT_MARKED, REPORT_OVERDUE, TRIAL_*; Accounting group: PACKAGE_LOW, PACKAGE_ENDED | alert types list | `GroupAlerts` is gated on `whatsapp.automation` only. For a centre: the "not marked" alert fires for private lessons but never for a group sheet left unmarked; REPORT_OVERDUE is noise; PACKAGE_* goes with the split | **fix**: add GROUP_LESSON_NOT_MARKED; drop REPORT_OVERDUE when `lesson_report` is off; PACKAGE_* → SUBSCRIPTION_* |
| Enter button, meeting links, punctuality tab | on every lesson, teacher form, teacher profile | right for an online English centre, pure noise for a room-based centre like lingo (every group OFFLINE) | **fix**: one academy setting "online lessons" (default = any ONLINE group or any teacher meeting URL); hide the three behind it |
| Teacher form "availability" windows | weekly availability editor | used by trial booking and the calendar conflict warning; a centre's teacher time is the group timetable | **keep**, but optional and collapsed for a centre |
| Parent portal → "Reports" tab | monthly progress reports + lesson reports | both are Quran feeds; a centre's term reports already have their own section above the tabs | **fix**: tab hidden when both feeds are empty; term reports stay |

## 2. Things that exist twice or sit in the wrong place

| What | Where | Problem | Verdict |
|---|---|---|---|
| Two timetables | nav "الجدول الأسبوعي" → `/calendar` (mixed feed: sessions + trials + group lessons, month/week/day/list); the real centre timetable (day → hour blocks → group/teacher/room rows, the one lingo asked for) lives under Attendance → Groups tab → "timetable" view, and its own page `/groups/lessons` is hidden from the sidebar | the menu item named "timetable" opens the generic calendar; the centre's timetable board has no menu entry | **move**: "الجدول الأسبوعي" → the timetable board page; the calendar becomes "التقويم" (keep, it is the only place private + group + trial sit together) |
| Two money reports | `/financial-statistics` (revenue vs payouts chart, profit by teacher, FX) and Accounting ▸ Reports (daily, income, groups profit) | same question answered twice, from different sources (invoices vs receipts) and with different numbers once bills never close | **hide** financial statistics for a centre on `accounting`; the FX card moves to Accounting ▸ Reports if anyone needs it |
| "Subscriptions" section vs the student's subscriptions card | sidebar section lists private blocks only; the card on the profile lists groups + blocks | the section's name promises both | **fix** (split, step 3): `/subscriptions` with a group-months tab or a one-line pointer to Groups ▸ accounts |
| Groups ▸ "Group statistics" vs Accounting ▸ Reports ▸ Groups | attendance stats per group / collection + profit per group | fine as two pages, but they do not link to each other | **fix**: cross-link |
| Settings → "Courses" tab | specializations (= subjects) + levels | the label says courses; for a curriculum centre these are subjects, for an English centre levels are the courses | **fix**: label "المواد والمستويات" for a centre |
| CRM in "People" | leads pipeline ending in SUBSCRIBED on convert | convert → student form; after the split that is subscription/groups. OK | **keep** |
| Trials → "حصص تحديد المستوى" | needs a teacher + a time, outcome form, convert | a placement is a real appointment, so the shape fits; the convert wizard must land on subscription + groups (split, step 3) | **keep**, wizard fixed in the split |

## 3. What the block is missing to be one piece

| Gap | Evidence | Verdict |
|---|---|---|
| **Rooms are free text** | `class_groups.location` is a string; the room-clash check compares text equality; no `academy_rooms` table; the timetable board groups by that text | **missing**: a rooms list in Settings (name, capacity), `class_groups.room_id`, clash by id, the board's filter by room |
| **What the classification is called** | `00-OVERVIEW.md` says "a level vs a grade … is an academy setting"; `LevelsManager` has no such setting; the UI says "المستوى" everywhere | **missing**: one setting (level / grade / year) used by every label |
| **Group defaults** | lesson length, billing mode, monthly lessons, teacher pay mode are typed per group; the spec's defaults questions were never answered | **missing**: Settings → Groups defaults, pre-filling the group form |
| **Group lesson not marked → nobody told** | overdue sheets exist as an in-app counter only; the WhatsApp staff alert covers private lessons | **missing**: GROUP_LESSON_NOT_MARKED in the Supervision staff group |
| **Group lessons in the activity logs** | notifications "attended" and "classes" are sessions only | **missing** (see §1) |
| **Guardian suspend and group lessons** | suspend pauses `schedules`; group lessons keep generating; the roster drops the children and billing skips them | works by accident; **fix** so the children's memberships are paused explicitly (left with reason SUSPENDED, re-joined on resume) |
| **PER_STUDENT-paid teachers on group lessons** | `GroupPayroll` calls `lessonPayMinor($teacher, null, …)`, so the per-student rate never applies | **fix** |
| **Level card on the live student profile** | rendered only by the legacy `student-detail.tsx`; the route uses `student-profile.tsx` | **fix** (bug) |
| **Teacher ↔ group on the teacher page** | teacher profile tabs are Lessons / Calendar / Punctuality / Salary / Reports; the groups a teacher teaches show only through `PersonGroupCard` on the Profile tab | **fix**: a Groups tab (their groups, this week's sheets owed) |
| **Enrolment request → group** | `/enrolment` books a trial; the placement outcome then converts | fine once the wizard lands on groups; **keep** |

## 4. What is right and should not be touched

- Groups: list, detail (hero, members, lessons, accounts, grades, reports, term, waitlist), timetable
  board, attendance sheet, substitute, holidays, levels, promotion, assessments, term reports,
  certificate handoff, absence alert, parent portal groups section. This is the centre's spine and
  it hangs together.
- Accounting: overview, arrears, treasury, receipts, expenses, daily closing, income, group
  collection + profit, family account with discounts / renewal policy / settlement, quick bills,
  family pay link, XPay. Centre-native, one money model, used by every charge writer.
- Payroll with the blocks view, teacher pay types, corrections after the seal.
- Attendance → Groups tab opening first; overdue private lessons board; calendar with the three feeds.
- Admissions: enrolment form, placement lessons, CRM convert — one funnel into the student form.
- The look (centre-look.css, Almarai, violet, Latin digits), the dashboard, the phone bottom bar.
- Everything the preset switches off (supervision, teacher rubric, memorisation report, report card)
  is both hidden and refused by the server.

## 5. Order (after the split's steps 1–4, before step 5)

1. Hide the Quran feeds: Reports tab + job gate, Follow control, lesson-report modal, financial
   statistics, parent-portal Reports tab. Each pinned by a shell / page test with `centre` on and off.
2. Timetable to the menu; calendar renamed.
3. Rooms list + classification label + group defaults (three small settings cards).
4. Group lessons into the two logs and the staff alert; suspend pauses memberships; PER_STUDENT
   pay on group lessons; teacher Groups tab; level card on the live profile.
5. The "online lessons" setting and the three surfaces behind it.

## 6. As built (2026-11-05, branch `worktree-agent-af7c2f130dc31ccc8` off `e2a945c`)

Order 5.1, 5.2 and 5.4 above, each its own commit. Every change keys on a feature switch
(`lesson_report` / `student_reports`, `supervision`, `centre` + `accounting`, `groups`), never on
the profile, and is pinned with the switch on and off; the Quran path is byte-for-byte what it was.

| # | Surface | What was built | Where |
|---|---|---|---|
| 1a | Reports feed | `FlagOverdueReportsJob::wantsLessonReports(caps)` = `lesson_report` or `student_reports`; the sweep returns 0 for an academy holding neither, the REPORT_OVERDUE staff alert is not detected for it (`GroupAlerts` setup `reports`), the notifications Reports tab is not listed | `app/Jobs/FlagOverdueReportsJob.php`, `Services/Whatsapp/GroupAlerts.php`, `notifications/screen.tsx`; tests `OverdueReportsTest`, `GroupAlertsTest`, `screen.test.tsx` |
| 1b | Attendance, private tab | `FollowControl` and `canFollow` behind `useCapability("supervision")`; in `AttendanceReport` the report editor, its edit/format buttons, the history (archive) button and Save are behind `showReportEditor = lesson_report \|\| !centre`; the outcome strip and the WhatsApp button stay | `attendance-manager.tsx`, `attendance-report.tsx` + both tests |
| 1c | Financial statistics | `NAV_REPLACED_BY` takes a list: `financialStats: ["accounting", "centre"]` (all held ⇒ hidden; page still opens by URL) | `app-shell.tsx`, `app-shell.test.tsx` |
| 1d | Parent portal | Reports tab rendered only when a progress report or a lesson report exists for any child (`anyReports`); term reports untouched | `app/p/[token]/parent-page.tsx`, `parent-page.groups.test.tsx` |
| 2 | Timetable in the menu | For a centre `schedule` links to `/groups/lessons` (`CENTRE_HREF_OF`; the board already opens on the timetable view) and carries the sheets-owed badge; new centre-only item `calendarCentre` → `/calendar` (`CENTRE_ONLY_KEYS`, label `nav.calendarCentre` "التقويم" / "Calendar"); Teaching order groups, timetable, calendar, attendance | `app-shell.tsx`, `ar.json`/`en.json`, `app-shell.test.tsx` |
| 3a | Staff alert | `GROUP_LESSON_NOT_MARKED` (Supervision category, CONDITIONAL, max age 6 h): a SCHEDULED group lesson of an ACTIVE group, `not_marked_after_minutes` after its END, with the expected count in the line; only when the academy holds `groups`; CHECK constraint migration `2026_11_07_000001`; admin card label + shared minutes knob | `GroupAlertCatalog/Message/GroupAlerts.php`, `whatsapp-groups-card.tsx`, `GroupAlertsTest` (2 tests) |
| 3b | Notification logs | Saving a sheet writes one `GROUP_LESSON_ATTENDED` row (category ATTENDED, `subject_id` = lesson, "sheet saved: {group}, {present}/{expected}", updated on re-save, deleted on revert); cancelling from the board writes `GROUP_LESSON_CANCELLED` (category CLASSES — a log listed under the Classes tab, no approval, never on the bell). `NotificationController` treats ATTENDED and CLASSES alike as logs behind `?category=` | `Services/ClassGroups.php`, `NotificationController.php`, `notifications/screen.tsx`, `lib/api.ts`; tests `ClassGroupsTest` (2), `screen.test.tsx` (2) |
| 4 | Guardian suspend | `ClassGroups::pauseForSuspension` closes the children's open memberships today with `left_reason = 'SUSPENDED'` and `paused_by_suspension = true` (migration `2026_11_07_000002`, additive); `resumeAfterSuspension` re-opens exactly those as new memberships from the resume day in groups still running and clears the flag; `GroupBilling::onMemberResumed` bills from today with the moved-in rule against the same group (a month already paid is not raised again) and skips a paid course fee. Both behind `groups`. Responses carry `paused_memberships` / `resumed_memberships` | `GuardianController.php`, `ClassGroups.php`, `GroupBilling.php`; `GuardianSuspendTest` (extended + 1 new) |
| 5 | PER_STUDENT teacher | `GroupPayroll::lessonAmount` default path: a teacher paid PER_STUDENT with no pay mode on the group earns `lessonPayMinor × came`; hourly unchanged | `GroupPayroll.php`, `ClassGroupMoneyTest` (2) |
| 6 | Teacher Groups tab | `components/teachers/teacher-groups.tsx`: active groups via `listGroups({teacher_id, state: ACTIVE})`, sheets owed this week from `listBoardLessons({view: "owed", teacher_id})` (week starts Saturday); tab behind `groups` + `group.read` | `teacher-workspace.tsx`, `teacher-groups.test.tsx`, `teachers.tabs.groups` / `teachers.groups.*` |
| 7 | Level on the live profile | `LevelCard` under `ProfileSection` and the level badge in the hero of `student-profile.tsx`, behind `useCapability("centre")` | `student-profile.tsx`, new `student-profile.test.tsx` |

**Not built:** §5.3 (rooms, classification label, group defaults) was out of this brief; §5.5 the
"online lessons" setting (Enter button, meeting-link fields, punctuality tab) was left for want of
time — it needs an academy setting with a derived default (any ONLINE group or teacher meeting URL)
and touches the teacher form and `settings-manager.tsx`, which other work holds.

**Known pre-existing red:** `GroupAlertsTest` "backs off after a failed send and tries again later"
fails on `e2a945c` before any of this (the `automation_send_log` assertion); unrelated.

## 7. As built — settings (2026-11-05, branch `worktree-agent-a079e3da6a3e51389` off `7534003`)

§5.3 and §5.5, each its own commit. All four key on the `centre` switch and are pinned with it on
and off; an academy without it keeps its DOM and its API payloads, apart from two additive
`/auth/me` fields that nothing of theirs reads differently.

| # | Setting | What was built | Where |
|---|---|---|---|
| 1 | **Rooms list** | `academy_rooms` (name unique per academy, case- and space-blind; capacity, on/off, position; tenant RLS); `class_groups.room_id` (FK, set null). `location` stays and is written as the room's name, a rename follows into it, so every reader of the text is untouched; a non-centre keeps typing it. Back-fill per CENTRE academy: distinct non-empty `location` becomes a room, idempotent. `/rooms` CRUD behind `entitled:centre`; a room groups sit in is refused delete (422) and switched off instead; a switched-off room is refused for a new placement but a group already in it re-saves. Clash: `roomWarnings` compares `room_id`, and a group still on free text by its text; the client's `roomClashes` keys the same way (`roomSlot`: a typed name of a listed room IS that room) | migration `2026_11_08_000001`, `Services/Rooms.php`, `Rooms/RoomController.php`, `InteractsWithClassGroups`, `ClassGroupController`, `GroupBoardController`; `settings/rooms-manager.tsx`, `rooms/room-select.tsx`, `lib/rooms-api.ts`, `group-form.tsx` (centre branch), `board/timetable-board.tsx` (filter + "set the room" from the list); tests `Centre/RoomsTest`, `rooms-manager.test`, `groups.test`, `timetable-board.test` |
| 2 | **What the classification is called** | `academies.level_label` (`LEVEL` / `GRADE` / `YEAR`, null reads LEVEL), written by `PATCH /academy` through `app.update_academy_defaults` (third argument, null = keep). `name` on that PATCH is now optional; the word alone may be set with `specialization.manage` (the supervisor who keeps the levels), everything else stays `settings.manage`. Exposed as `academy.levelLabel` in `/auth/me`, `level_label` in `/levels`, and on the parent page for a centre only. Every message naming it is an ICU `{word, select, GRADE {…} YEAR {…} other {…}}` whose `other` is the text it always had, and the word comes from one place: `lib/levels.ts` (`levelWord(session)`, `useLevelWord()`, `wordOf(value)` for the session-less parent page) | migration `2026_11_08_000002`, `Support/AcademyLevelLabel.php`, `AcademyProfileController`, `AuthController`, `LevelController`, `GuardianPortalCentre`; levels components, student form / list / profile badge, group form / list / detail, course-end panel, teacher Groups tab, term report, parent page; tests `Centre/LevelLabelTest`, `lib/levels.test`, `levels/level-word.test`, `levels-manager.test`, `groups.test`, `grades.test`, `student-profile.test`, `parent-page.groups.test` |
| 3 | **Group defaults** | `academy_group_defaults` (one row per academy, tenant RLS, every column nullable): lesson minutes, billing mode, lessons a month, teacher pay mode + amount or share, mode. `GET`/`PATCH /group-defaults` behind `entitled:centre`; the money halves are read and written behind the group form's own gates. Nothing server-side reads them, so a default never moves a group. The group form's centre branch fills them on create only, per field, skipping anything already touched | migration `2026_11_08_000003`, `Centre/GroupDefaultsController.php`; `settings/group-defaults-manager.tsx`, `lib/group-defaults-api.ts`, `group-form.tsx`; tests `Centre/GroupDefaultsTest`, `group-defaults-manager.test`, `groups.test` |
| 4 | **Online lessons** | `academies.online_lessons` (true / false / null = automatic), written by `PATCH /academy` through `app.update_academy_defaults` (fourth argument `AUTO`/`ON`/`OFF`, null = keep). `Support/OnlineLessons`: the column when set; else true without `centre`; else true when an active group is ONLINE or an active teacher has a meeting link. `academy.onlineLessons` in `/auth/me`. Settings → Academy: automatic / on / off, centre only. `useOnlineLessons()` hides the Enter button (attendance, today's lessons), the meeting-link field (teacher form, detail) and the Punctuality tab for a centre when false; the link is hidden, not cleared | migration `2026_11_08_000004`, `AcademyProfileController`, `AuthController`; `lib/capabilities.ts`, `academy-name-card.tsx`, `attendance-manager.tsx`, `my-lessons-today.tsx`, `teacher-form.tsx`, `teacher-detail.tsx`, `teacher-workspace.tsx`; tests `Centre/OnlineLessonsTest`, `teachers/online-lessons.test`, `attendance-manager.test`, `my-lessons-today.test` |

**Left as they are:**

- The word: the public enrolment form's "المستوى / الصف الحالي" (`enrolment.link.fields.askLevel`) already names both and has no session; server refusal messages (`LevelController`, `StudentLevels`) still say level; `levels.hint` and the placeholders name both on purpose.
- Online lessons off: `TeacherEnteredChip` still shows a press already recorded; the teacher-insights page still reads Enter data; an ONLINE group's own meeting URL stays on the group form and sheet, since it belongs to that group.
- `LessonPriceFields` keeps its own unit length; a default lesson length sets it once on create, and changing a slot's length afterwards does not follow, as before.

**Known pre-existing red:** `Rls/IntrospectionTest` "stores no monetary column as float or numeric" flags `group_assessments.max_score`, `.weight` and `group_assessment_scores.score` from `2026_11_06_000001`, not money and not from this work.

