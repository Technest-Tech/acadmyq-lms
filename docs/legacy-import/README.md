# Moving a client off the old system

Several clients still run the pre-AcademiQ Laravel app on the Hostinger box
(`technest-agency.com/public_html/<client>`). This is how one of them gets moved here.

Two pieces:

| Piece | Where it runs | What it does |
| --- | --- | --- |
| `tools/legacy-import/export-legacy.php` | inside the OLD app, on the old server | reads that client's database, writes one JSON file |
| `php artisan legacy:import` | here | reads the JSON, lands people + appointments in an academy |

They are separate on purpose: the old databases are reachable only from that box, and the export
boots the old app so it uses that app's own `.env` — no credential ever leaves the server or gets
typed anywhere.

## What moves, and what does not

**Moves.** Teachers. Students, grouped into guardians. Each student's old hourly rate, as a
`PER_HOUR` subscription. Each student's current teacher, plus their earlier teachers as closed
assignments. Every live timetable series, collapsed back into the weekly rule it came from.

**Does not move.** Lesson history and billing history. The export carries the lessons so the file
is a complete archive, and the importer deliberately does not write them — see decision 2 below.
Logins do not move either: the old `users.password` hashes are never read, and the new system
mints its own.

## The four decisions

1. **The timetable becomes a rule again.** The old app pre-generated every weekly occurrence out
   to 2033 — Ehsan alone has 48,964 rows. We store a weekly rule and let the generator roll a
   window forward, so the rows are collapsed to (weekday, start time, duration) and re-expanded
   here. A series whose last date has already passed is history, not an appointment, and is
   skipped.

2. **Nothing is back-dated.** Imported timetables start on the import date, never on the series'
   original first date. Our generator honours a past start date by back-filling, so the original
   date would invent months of lessons nobody taught — each one markable and billable. Override
   with `--schedule-start=` only if you mean it.

3. **The payer is recovered, by the client's own answer where there is one.** Here a guardian owns
   the money and can own several students; the old app mostly has no payer at all and bills the
   student directly. Two routes, in order:
   - **A declared family.** The later apps (tarteel) grew a `families` table — a named household
     with its own WhatsApp number. That is the client's own bookkeeping, so it wins: members land
     under it whatever their own numbers are, and two households that happen to share a number stay
     two households. A family with no number of its own is billed on a member's.
   - **A shared phone**, for the students nobody filed. Sharing a number means siblings on a
     parent's phone. Ehsan has 23 such numbers; tarteel 47.

4. **It is re-runnable.** Every row created is recorded in `legacy_import_map`, so a second run
   updates what the first made instead of creating a second copy of everybody. Useful, because the
   client keeps teaching on the old system while the move is being agreed.

## Running it

**1 — create the client here first.** Super Admin → Clients, with the right type, plan and
modules. The importer will not create an academy; it needs the id of one that exists.

**2 — export, on the old server.**

```bash
ssh -p 65002 u221047993@147.93.101.143
cd ~/domains/technest-agency.com/public_html/<client>
php export-legacy.php --source=<client> --out=/tmp/<client>-export.json
```

Upload `export-legacy.php` next to that app's `artisan` first if it is not already there. It only
ever reads. The summary it prints (teachers / students / schedules / warnings) is worth a glance:
`assignment_orphan` and `lesson_orphan` warnings are rows pointing at users that were deleted years
ago, and are safely skipped.

**3 — fetch it.**

```bash
scp -P 65002 u221047993@147.93.101.143:/tmp/<client>-export.json .
```

**4 — dry run.**

```bash
php artisan legacy:import <client>-export.json --academy=<uuid> --dry-run
```

The dry run is not a simulation: it does the entire import against the real database, so every
foreign key, CHECK and unique index has its say, and then throws it all away. A clean dry run means
the real run will land.

**5 — for real.** Same command without `--dry-run`.

## Options

| Option | Why you'd use it |
| --- | --- |
| `--dry-run` | Always, first. |
| `--schedule-start=YYYY-MM-DD` | Start the imported timetables on a day other than today. A past date **back-fills lessons** — see decision 2. |
| `--fallback-phone=+20…` | Include students who have no WhatsApp number at all. Without it they are skipped, because a guardian's number is where every report and invoice is sent and inventing one is worse than leaving the student out. |
| `--teacher-rate=` / `--teacher-currency=` | Give every imported teacher a payout rate. The old app never stored one, so without this they land at 0. |
| `--timezone=` | The timezone the old wall-clock times are in. Defaults to the academy's. |
| `--max-duration=240` | A slot longer than this is treated as a typo in the old data and imported as 60 minutes. |
| `--no-generate` | Skip the session generator afterwards. |
| `--source=` | Override the name recorded in `legacy_import_map`. Only matters if two legacy systems are merged into one academy. |

## After the import — what still needs a human

The command prints a **Needs a human** list. For Ehsan it was:

- **Teacher rates.** All 32 teachers land at 0 — the old system never stored a rate. Set them
  before the first payroll run.
- **Students with two teachers.** 6 students are taught by more than one teacher in the old
  timetable. Here a student has exactly one, so their whole week went to whichever teacher holds
  more of their slots. No lesson is lost; some are on the wrong teacher's calendar until moved.
- **Students with no teacher at all.** 80 of the 240 have never been taught and have no live
  timetable, so they arrive with no assignment. They are dormant records, not a failure.
- **One skipped student**, having no usable phone number (`XPay Test Student` — a test record).
- **One impossible slot** (`23:50 → 12:00`, which reads as 12 hours) imported as an hour.
- **Mixed currencies inside one family.** The guardian takes the commonest; each student keeps
  their own price.

## The same old app, other clients

`asaneed`, `azhari`, `israa-meraj` and `yaqen` run the same schema, so both pieces work on them
unchanged. The extra tables the later apps grew are detected, not assumed: `families` +
`users.family_id` are read where they exist and ignored where they don't, and the same goes for
`users.student_type` (kept in the student's notes). Apps with a different shape entirely
(`azhary`, `esra`, `tayser`, `alwahy`, `alarabiya`) are not covered.

## Runs so far

### Ehsan — LIVE on prod 2026-09-20

Academy `b308dba3-8256-469a-9816-4f987d5f2d6b` (أكاديميه الاحسان).

```
teachers                      32     guardians                    215
students                     240     timetables                   106
students skipped               1     timetable slots              241
subscriptions                240     lessons generated          1,446
assignments  160 live / 18 past      lessons left in the archive  7,557
```

A before/after diff of `pg_stat_user_tables` showed no table losing a row.

### Tarteel — LIVE on prod 2026-09-20

Academy `a0e623a4-e1fe-4939-be1b-60db7b9e4ab1` (أكاديمية ترتيل), the first run to use the
`families` table: 70 of its 377 guardians are declared households, the rest inferred from shared
numbers.

```
teachers                      53     guardians      377 (70 declared)
students                     542     timetables                   143
students skipped               0     timetable slots              511
subscriptions                542     lessons generated          3,066
assignments 425 live / 319 past      expired series skipped       412
```
