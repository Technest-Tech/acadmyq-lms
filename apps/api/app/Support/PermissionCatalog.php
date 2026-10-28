<?php

declare(strict_types=1);

namespace App\Support;

/**
 * The canonical RBAC capability catalog (Sprint 2 §5.3) and the default role → capability
 * mapping (§5.4). This is the *seed source* for the SYSTEM roles only — at runtime
 * authorization is resolved from the tables via PermissionResolver (system roles from
 * `role_permissions`, per-academy custom roles from `academy_role_permissions`), so a new
 * role or a re-mapping is a data change, never a code change (Master Spec §4 design note).
 */
final class PermissionCatalog
{
    /** Every capability code the platform recognises (§5.3). */
    public const PERMISSIONS = [
        'academy.create', 'academy.suspend', 'academy.configure', 'academy.enter', 'academy.read',
        // Permanently wipe a client and all of its data (DELETE /admin/clients/{id}). Kept apart
        // from academy.suspend: suspending is reversible, this is not.
        'academy.delete',
        'plan.manage',
        // Platform↔Academy subscription billing + per-academy WhatsApp automation (Super-Admin only).
        'academy_billing.manage', 'automation.manage',
        'user.invite', 'role.assign', 'user.read_platform',
        // Create/edit/delete an academy's own CUSTOM roles and assign them (academy_roles).
        'role.manage',
        'platform.manage',
        'teacher.read', 'teacher.read_own', 'teacher.create', 'teacher.update', 'teacher.deactivate',
        // See and set what a teacher is PAID (hourly / per-student / fixed salary, per-student
        // rates). Split off teacher.read/update the same way student.set_price was split off
        // student.update: running the teachers is day-to-day work, their pay is money. Without it
        // the rates are redacted from the teacher list and file and every pay field is refused.
        'teacher.set_pay',
        // Give a teacher who has no sign-in yet their FIRST one (on the add-teacher form, or later
        // from their file). Split off user.invite + role.assign so whoever adds teachers can hand
        // them a working login without also holding login authority over everyone: re-issuing an
        // EXISTING teacher's email or password is taking over an account someone already uses,
        // and stays user.invite.
        'teacher.create_login',
        'guardian.read', 'guardian.create', 'guardian.update',
        'student.read', 'student.create', 'student.update', 'student.deactivate',
        // Set or change what a student PAYS. Split off `student.update` deliberately: editing a
        // student's name, status or teacher is day-to-day admin, while repricing them is a money
        // decision that reaches straight into their invoices. Keeping them on one capability made
        // "manage students but not their rates" impossible to express (SUPERVISOR).
        'student.set_price',
        'schedule.read', 'schedule.manage',
        'session.read', 'session.mark_attendance', 'session.write_report',
        // Add a one-off class that no timetable produced (the Attendance page's "create class").
        // Held by TEACHER too — unlike `schedule.manage`, it grants a single ad-hoc occurrence,
        // not the power to rewrite a student's weekly timetable. A TEACHER is confined to their
        // own students and is always recorded as the teacher (enforced in SessionController).
        'session.create',
        'session.reschedule', 'session.cancel',
        'session.cancel_request', 'session.cancel_approve',
        // Undo a recorded outcome and put the lesson back to SCHEDULED — the only way to fix a
        // lesson marked wrongly, and the precondition for rescheduling it (a reschedule requires
        // SCHEDULED). Deliberately NOT held by a TEACHER: reverting reverses the invoice line and
        // the payout accrual, and would let them undo a cancellation the owner had just approved.
        'session.revert_attendance',
        // Delete a lesson outright: it becomes a cancellation that charges and pays nobody (money
        // reversed through the same path as an undo) and disappears from every lesson list. Not a
        // TEACHER's, for the same reason as undoing attendance.
        'session.delete',
        // Mark a lesson FREE. Like a cancellation, the per-academy billing decision (charge the
        // student? pay the teacher?) is made in a popup, and a TEACHER cannot apply it directly —
        // they raise a request (session.free_request) the OWNER approves (session.free_approve).
        'session.free', 'session.free_request', 'session.free_approve',
        // The money half of cancelling / freeing a lesson: "still charge the student?" and "still
        // pay the teacher?". Whoever cancels without it gets the standard verdict (neither) — the
        // override fields are ignored server-side, so recording the outcome stays operational.
        'session.bill_override',
        // Supervision. `session.follow` is the "Following" button on a lesson — a supervisor saying
        // "I am on this one", which also silences the WhatsApp not-marked reminder for it.
        // `supervision.stats` reads the page that measures how promptly each supervisor followed
        // and how promptly outcomes were recorded. Neither goes to a TEACHER: they are the person
        // being waited on, not the one doing the waiting.
        'session.follow', 'supervision.stats',
        'trial.read', 'trial.manage',
        // CRM / Leads (CRM module): see the pipeline vs. add/move/note/convert/delete leads.
        // Owner-only by default; delegated to sales/support staff through a custom role.
        'crm.read', 'crm.manage',
        // LMS / online courses (LMS module, docs/lms): read vs. build courses, manage the access
        // codes learners redeem, and see learners + enrollments. Owner-only by default; delegated to
        // a course-team employee through a custom role (same pattern as CRM).
        'course.read', 'course.manage', 'access_code.manage', 'learner.read',
        // The sales half of the LMS (docs/lms/10): the order queue and the buyers, then the money
        // decisions (approve a transfer receipt, refund, pull access) and the receiving accounts.
        'course_order.read', 'course_order.manage', 'payment_method.manage',
        // Booking requests from the course site (docs/lms/13) — "book a consultation", "book a
        // course": open the inbox vs. work it (status, notes, delete) and configure the forms.
        'booking.read', 'booking.manage',
        'notification.read',
        'invoice.read', 'invoice.create', 'invoice.close', 'invoice.mark_paid', 'invoice.send_link',
        // Receipts (docs/groups/01-ACCOUNTING.md): recording one rides invoice.mark_paid; voiding
        // one — taking money back off the books — is its own, heavier call.
        'receipt.void',
        // The treasury (docs/groups/01-ACCOUNTING.md): record money OUT (expenses, a salary paid),
        // set up the accounts and move money between them; and count / close a day's cash.
        'expense.manage', 'cashbox.close',
        'payout.read', 'payout.read_own', 'payout.finalize', 'payout.adjust',
        // Lesson packages — the hour-based second billing clock (docs/lesson-packages). Seeded
        // straight into `role_permissions` when the module shipped; listed here so the role
        // builder can see them and the SUPERVISOR preset can deliberately leave them out.
        'package.read', 'package.manage',
        // Group classes (docs/groups): see groups, members and their lessons vs. run them (create,
        // edit, archive, members, weekly times, cancel / move / add a lesson). Marking the sheet
        // rides session.mark_attendance. `group.read` is row-scoped for a TEACHER to their groups.
        'group.read', 'group.manage',
        'report_field.manage',
        'specialization.manage',
        // The academy's own switches: Settings → Controls, WhatsApp pairing, the academy's name.
        // Split off specialization.manage, which used to open the whole Settings page — so whoever
        // could edit the course list could also unpair the academy's WhatsApp.
        'settings.manage',
        'payment_settings.manage',
        'teacher_report.manage',
        // Teacher quality: the academy's delivery rubric and the reports written against it, which
        // dock pay through a derived payout deduction. `read_own` is the teacher's window onto the
        // reports about THEMSELVES — a document that costs them money has to be readable by them
        // (same reasoning as payout.read_own). Distinct from `teacher_report.manage`, which is the
        // owner-private free-text log.
        'teacher_quality.read', 'teacher_quality.manage', 'teacher_quality.read_own',
        // The teacher performance dashboard (/teacher-quality): on-time entry, on-time reports and
        // attendance rates per teacher. A statistic, not a quality report — see STATISTICS.
        'teacher_quality.insights',
        'student_report.submit', 'student_report.review',
        'certificate.read', 'certificate.manage',
        'audit.read',
        'staff.read', 'staff.create', 'staff.update', 'staff.deactivate',
        // See and set an employee's salary. Without it the staff list and file never carry one.
        'staff.set_salary',
        'staff_department.manage',
        // Video classroom (archive/video-platform/docs). The academy OWNS the room (V-CTL-1): owners
        // create/manage rooms and recordings; teachers join. Gated by the `video.conferencing`
        // entitlement on top of these RBAC capabilities. `room.monitor` = enter supervisor (ghost)
        // mode to silently observe + record a session for quality & safety (08-ROOM-ACCESS §5).
        'room.read', 'room.create', 'room.join', 'room.manage', 'recording.view', 'room.monitor',
    ];

    /**
     * Capabilities that move money or reveal it: invoices and payments, salaries and profit,
     * discounts and awards, the payment gateway's keys, package billing, and what a student pays.
     *
     * This is the line the SUPERVISOR role is drawn against, and the UI marks these in the role
     * builder so an academy can see what it is handing over. Anything added to the catalog later
     * is operational UNLESS it is listed here — the default is deliberately "not money", so a new
     * money capability has to be named rather than silently leaking into every supervisor.
     */
    public const FINANCIAL = [
        'invoice.read', 'invoice.create', 'invoice.close', 'invoice.mark_paid', 'invoice.send_link',
        'receipt.void', 'expense.manage', 'cashbox.close',
        'payout.read', 'payout.read_own', 'payout.finalize', 'payout.adjust',
        'payment_settings.manage',
        'package.read', 'package.manage',
        'student.set_price',
        // What a teacher earns, what an employee earns, and the charge/pay call on a cancellation.
        'teacher.set_pay', 'staff.set_salary', 'session.bill_override',
        // Course sales: the queue prints what every buyer paid, and deciding an order moves money.
        'course_order.read', 'course_order.manage', 'payment_method.manage',
    ];

    /**
     * Capabilities that open a statistics / performance surface: aggregated rates and scores about
     * how the academy and its people are doing, as opposed to the records the work is done on.
     * Withheld from SUPERVISOR alongside {@see FINANCIAL} — the role runs the day, it does not read
     * the academy's scorecard (including its own: supervision.stats measures the supervisors).
     *
     * The financial statistics page needs no entry here: it is gated by invoice.read, already money.
     */
    public const STATISTICS = [
        'supervision.stats',
        'teacher_quality.insights',
    ];

    /**
     * The role builder's sections: what an academy owner thinks in ("can they see Students? edit
     * them?") mapped onto the capability codes underneath. Each area has a VIEW set and a MANAGE
     * set (manage implies view); the builder offers None / View / Manage per row and can expand a
     * row to its individual codes. `kind` groups the rows into the operational block, the money
     * block and the statistics block.
     *
     * Every academy-scoped capability belongs to exactly one area — tests/Feature/People/
     * TeamRolesTest asserts it, so a new capability that is not filed here fails the build instead
     * of silently vanishing from the builder.
     *
     * @var list<array{key: string, kind: string, view: list<string>, manage: list<string>}>
     */
    public const AREAS = [
        ['key' => 'students', 'kind' => 'operations', 'view' => ['student.read'], 'manage' => ['student.create', 'student.update', 'student.deactivate']],
        ['key' => 'guardians', 'kind' => 'operations', 'view' => ['guardian.read'], 'manage' => ['guardian.create', 'guardian.update']],
        ['key' => 'teachers', 'kind' => 'operations', 'view' => ['teacher.read'], 'manage' => ['teacher.create', 'teacher.update', 'teacher.deactivate', 'teacher.create_login']],
        ['key' => 'schedules', 'kind' => 'operations', 'view' => ['schedule.read'], 'manage' => ['schedule.manage']],
        ['key' => 'lessons', 'kind' => 'operations', 'view' => ['session.read'], 'manage' => [
            'session.mark_attendance', 'session.write_report', 'session.create', 'session.reschedule',
            'session.cancel', 'session.cancel_approve', 'session.revert_attendance', 'session.delete', 'session.free', 'session.free_approve',
        ]],
        ['key' => 'groups', 'kind' => 'operations', 'view' => ['group.read'], 'manage' => ['group.manage']],
        ['key' => 'supervision', 'kind' => 'operations', 'view' => [], 'manage' => ['session.follow']],
        ['key' => 'trials', 'kind' => 'operations', 'view' => ['trial.read'], 'manage' => ['trial.manage']],
        ['key' => 'crm', 'kind' => 'operations', 'view' => ['crm.read'], 'manage' => ['crm.manage']],
        ['key' => 'notifications', 'kind' => 'operations', 'view' => ['notification.read'], 'manage' => []],
        ['key' => 'quality', 'kind' => 'operations', 'view' => ['teacher_quality.read'], 'manage' => ['teacher_quality.manage']],
        ['key' => 'student_reports', 'kind' => 'operations', 'view' => [], 'manage' => ['student_report.review']],
        ['key' => 'teacher_notes', 'kind' => 'operations', 'view' => [], 'manage' => ['teacher_report.manage']],
        ['key' => 'certificates', 'kind' => 'operations', 'view' => ['certificate.read'], 'manage' => ['certificate.manage']],
        ['key' => 'classroom', 'kind' => 'operations', 'view' => ['room.read', 'room.join', 'recording.view'], 'manage' => ['room.create', 'room.manage', 'room.monitor']],
        ['key' => 'courses', 'kind' => 'operations', 'view' => ['course.read', 'learner.read', 'booking.read'], 'manage' => ['course.manage', 'access_code.manage', 'booking.manage']],
        ['key' => 'settings', 'kind' => 'operations', 'view' => [], 'manage' => ['specialization.manage', 'report_field.manage', 'settings.manage']],
        ['key' => 'staff', 'kind' => 'operations', 'view' => ['staff.read'], 'manage' => ['staff.create', 'staff.update', 'staff.deactivate']],
        ['key' => 'access', 'kind' => 'operations', 'view' => [], 'manage' => ['user.invite', 'role.assign', 'role.manage']],
        ['key' => 'audit', 'kind' => 'operations', 'view' => ['audit.read'], 'manage' => []],

        ['key' => 'invoices', 'kind' => 'financial', 'view' => ['invoice.read'], 'manage' => ['invoice.create', 'invoice.close', 'invoice.mark_paid', 'invoice.send_link']],
        ['key' => 'receipts', 'kind' => 'financial', 'view' => [], 'manage' => ['receipt.void']],
        ['key' => 'treasury', 'kind' => 'financial', 'view' => [], 'manage' => ['expense.manage', 'cashbox.close']],
        ['key' => 'packages', 'kind' => 'financial', 'view' => ['package.read'], 'manage' => ['package.manage']],
        ['key' => 'payroll', 'kind' => 'financial', 'view' => ['payout.read'], 'manage' => ['payout.finalize', 'payout.adjust']],
        ['key' => 'student_prices', 'kind' => 'financial', 'view' => [], 'manage' => ['student.set_price']],
        ['key' => 'teacher_pay', 'kind' => 'financial', 'view' => [], 'manage' => ['teacher.set_pay']],
        ['key' => 'staff_salaries', 'kind' => 'financial', 'view' => [], 'manage' => ['staff.set_salary']],
        ['key' => 'lesson_billing', 'kind' => 'financial', 'view' => [], 'manage' => ['session.bill_override']],
        ['key' => 'course_sales', 'kind' => 'financial', 'view' => ['course_order.read'], 'manage' => ['course_order.manage', 'payment_method.manage']],
        ['key' => 'payment_settings', 'kind' => 'financial', 'view' => [], 'manage' => ['payment_settings.manage']],

        ['key' => 'statistics', 'kind' => 'statistics', 'view' => ['supervision.stats', 'teacher_quality.insights'], 'manage' => []],
    ];

    /**
     * The plan feature (Entitlement capability key) a capability only means something with, keyed
     * by the capability's domain — the part before its last dot. These mirror the `entitled:*`
     * route gates: an academy without the video module cannot open a room whatever its roles say,
     * so the role builder has no business offering "Create classrooms" to it. A domain not listed
     * here belongs to the core management product and is always offered.
     */
    private const FEATURE_BY_DOMAIN = [
        'room' => 'video.conferencing', 'recording' => 'video.conferencing',
        'course' => 'lms', 'access_code' => 'lms', 'learner' => 'lms',
        'course_order' => 'lms', 'payment_method' => 'lms', 'booking' => 'lms',
        'crm' => 'crm',
        'invoice' => 'invoicing',
        'receipt' => 'accounting',
        'expense' => 'accounting',
        'cashbox' => 'accounting',
        'payout' => 'payroll',
        'package' => 'packages',
        'group' => 'groups',
        'trial' => 'trials',
        'teacher_quality' => 'teacher_quality',
        'certificate' => 'certificates',
        'student_report' => 'student_reports',
        'staff' => 'staff',
        'supervision' => 'supervision',
    ];

    /** Single capabilities whose feature differs from their domain's. */
    private const FEATURE_BY_CODE = [
        // The "Following" button is the supervision module's, though it acts on a session.
        'session.follow' => 'supervision',
    ];

    /** The plan feature `$code` needs, or null when it is part of the core product. */
    public static function requiredFeature(string $code): ?string
    {
        if (isset(self::FEATURE_BY_CODE[$code])) {
            return self::FEATURE_BY_CODE[$code];
        }

        $domain = str_contains($code, '.') ? substr($code, 0, (int) strrpos($code, '.')) : $code;

        return self::FEATURE_BY_DOMAIN[$domain] ?? null;
    }

    /**
     * Keep only the capabilities an academy holding `$features` can actually use.
     *
     * @param  list<string>  $codes
     * @param  list<string>  $features  Entitlement capability keys (Entitlement::resolve()['capabilities'])
     * @return list<string>
     */
    public static function usableWith(array $codes, array $features): array
    {
        return array_values(array_filter($codes, static function (string $code) use ($features): bool {
            $feature = self::requiredFeature($code);

            return $feature === null || in_array($feature, $features, true);
        }));
    }

    /**
     * Capabilities a SUPERVISOR is denied on top of {@see FINANCIAL}.
     *
     * Delegation: a supervisor supervises PEOPLE, not permissions. Handing out logins and roles
     * stays with the owner, so a supervisor reads the staff list but cannot grow the staff or
     * rewrite what anyone may do. (The role builder's clamp already stops anyone granting a
     * capability they lack, so this is about who runs the academy, not about escalation.)
     *
     * `audit.read`: the trail prints the money it is a trail OF — `subscription.price_changed`
     * from 500 to 600, `invoice.mark_paid`. Handing it to a supervisor would give back through
     * the audit page exactly the rates and payments the role exists to withhold.
     */
    private const SUPERVISOR_EXCLUDES = [
        'user.invite', 'role.assign', 'role.manage',
        'staff.create', 'staff.update', 'staff.deactivate',
        'audit.read',
        // The academy's own switches and its WhatsApp pairing: owner decisions, not supervision.
        'settings.manage',
    ];

    /**
     * The money a SUPERVISOR handles, handed back on top of the subtraction.
     *
     * The supervisor adds students, families and teachers, and a record without its price is not
     * complete: the student form's whole billing block (monthly price, package, subscriptions)
     * sits behind student.set_price + package.manage, and a teacher's rates behind teacher.set_pay.
     * Academies kept asking for supervisors who set students up end to end (Lingo built a custom
     * role for exactly this, 2026-10-25), so the built-in role now does — and since 2026-10-28 it
     * also collects: sees the bills, raises one, sends the pay link and marks it paid (a receipt
     * rides invoice.mark_paid). Closing a month, voiding a receipt, the treasury, payroll and the
     * gateway keys stay with the money desk. An academy that wants less (or more) edits its own
     * supervisors from the Roles page ({@see PermissionResolver::forRoleIn()}).
     */
    private const SUPERVISOR_MONEY_INCLUDES = [
        'student.set_price',
        'package.read', 'package.manage',
        'teacher.set_pay',
        'invoice.read', 'invoice.create', 'invoice.mark_paid', 'invoice.send_link',
    ];

    /**
     * Built-in roles every academy can hand to an employee from the team page, weakest first —
     * the shared starting points (the owner narrows one into a custom role when none fits).
     * ACADEMY_OWNER and TEACHER are not on it: an owner is the client, a teacher is made on the
     * Teachers page with a teacher record behind the login.
     */
    public const STAFF_ROLES = ['STAFF', 'CUSTOMER_SERVICE', 'SUPERVISOR', 'ACCOUNTANT', 'MANAGER'];

    /**
     * The built-in roles an academy may edit for itself (academy_role_tunings): the shared staff
     * roles. Never the owner (the client itself) or the teacher (row-scoped in code, and the
     * academy's Controls already switch its lesson powers).
     */
    public const TUNABLE_ROLES = self::STAFF_ROLES;

    /**
     * Default role → capability mapping (§5.4).
     *
     * @return array<string, list<string>>
     */
    public static function roleMap(): array
    {
        $academyScoped = [
            'user.invite', 'role.assign', 'role.manage',
            'teacher.read', 'teacher.create', 'teacher.update', 'teacher.deactivate',
            'teacher.set_pay', 'teacher.create_login',
            'guardian.read', 'guardian.create', 'guardian.update',
            'student.read', 'student.create', 'student.update', 'student.deactivate',
            'student.set_price',
            'schedule.read', 'schedule.manage',
            'session.read', 'session.mark_attendance', 'session.write_report',
            'session.create',
            'session.reschedule', 'session.cancel', 'session.cancel_approve',
            // Undo a recorded outcome, putting the lesson back to SCHEDULED. Operational, not
            // financial: recording the outcome is what MOVES the money and it is already
            // supervisor-held, so undoing a mis-marked lesson stays with the same people.
            'session.revert_attendance',
            // Delete a lesson (money reversed, row hidden) — the same people who can undo one.
            'session.delete',
            // Mark free directly (with the billing popup) + approve teachers' free requests.
            'session.free', 'session.free_approve',
            'session.bill_override',
            'session.follow', 'supervision.stats',
            'trial.read', 'trial.manage',
            'crm.read', 'crm.manage',
            'course.read', 'course.manage', 'access_code.manage', 'learner.read',
            'course_order.read', 'course_order.manage', 'payment_method.manage',
            'booking.read', 'booking.manage',
            'notification.read',
            'invoice.read', 'invoice.create', 'invoice.close', 'invoice.mark_paid', 'invoice.send_link',
            'receipt.void', 'expense.manage', 'cashbox.close',
            'payout.read', 'payout.finalize', 'payout.adjust',
            'package.read', 'package.manage',
            'group.read', 'group.manage',
            'report_field.manage',
            'specialization.manage',
            'settings.manage',
            'payment_settings.manage',
            'teacher_report.manage',
            'teacher_quality.read', 'teacher_quality.manage', 'teacher_quality.insights',
            'student_report.review',
            'certificate.read', 'certificate.manage',
            'audit.read',
            'staff.read', 'staff.create', 'staff.update', 'staff.deactivate',
            'staff.set_salary',
            // Video classroom — the owner provisions/manages rooms and views recordings (V-CTL-1),
            // and may enter supervisor (monitor) mode. Composable into a custom management role.
            'room.read', 'room.create', 'room.join', 'room.manage', 'recording.view', 'room.monitor',
        ];

        return [
            // The whole academy MINUS the money. A supervisor runs students, teachers, schedules,
            // attendance, trials, reports, quality and the classroom — everything the academy does
            // day to day — and never sees an invoice, a payment, a payroll run or the profit.
            //
            // Subtracted rather than listed, so the promise stays true as the product grows: a new
            // operational capability reaches supervisors the moment an owner gets it, while a new
            // MONEY capability has to be named in FINANCIAL to be withheld. Getting that wrong
            // fails safe in the direction of "the supervisor sees it", so FINANCIAL is the list to
            // update when a money surface ships.
            //
            // Statistics are withheld too ({@see STATISTICS}): the performance dashboards are the
            // owner's scorecard of the academy, the supervisors included.
            //
            // The one exception is the price on the people they enrol ({@see
            // SUPERVISOR_MONEY_INCLUDES}): a student's rate and package, a teacher's pay.
            'SUPERVISOR' => array_values(array_merge(
                array_diff($academyScoped, self::FINANCIAL, self::STATISTICS, self::SUPERVISOR_EXCLUDES),
                self::SUPERVISOR_MONEY_INCLUDES,
            )),
            // The owner's right hand: the whole academy, money and statistics included. A second
            // ACADEMY_OWNER would be the client itself; a manager is an employee the owner can
            // switch off from the team page. Only someone holding all of it can hand it out (the
            // assignment clamp), which in practice means the owner.
            'MANAGER' => $academyScoped,
            // The money desk, the mirror image of SUPERVISOR: invoices, packages, payroll and every
            // price, with read-only sight of the people and lessons those numbers are about. Not
            // the gateway keys or the LMS receiving accounts (payment_settings / payment_method
            // are academy configuration, the owner's), and not the cancel-billing call
            // (session.bill_override means nothing without the power to cancel a lesson).
            'ACCOUNTANT' => [
                'student.read', 'guardian.read', 'teacher.read', 'staff.read',
                'schedule.read', 'session.read', 'group.read',
                'invoice.read', 'invoice.create', 'invoice.close', 'invoice.mark_paid', 'invoice.send_link',
                'receipt.void', 'expense.manage', 'cashbox.close',
                'payout.read', 'payout.finalize', 'payout.adjust',
                'package.read', 'package.manage',
                'student.set_price', 'teacher.set_pay', 'staff.set_salary',
                'course_order.read', 'course_order.manage',
            ],
            // The front desk: enrol students and families, book their timetable, move a lesson,
            // run trials, leads and course-site bookings. No attendance, no cancellations (those
            // carry a billing decision), no money.
            'CUSTOMER_SERVICE' => [
                'student.read', 'student.create', 'student.update',
                'guardian.read', 'guardian.create', 'guardian.update',
                'teacher.read',
                'schedule.read', 'schedule.manage',
                'session.read', 'session.create', 'session.reschedule',
                'group.read',
                'trial.read', 'trial.manage',
                'crm.read', 'crm.manage',
                'booking.read', 'booking.manage',
            ],
            // Platform capabilities + the ability to act within an entered academy.
            // Onboarding (Sprint 3) is Super-Admin-only: provisioning the first owner login
            // (user.invite) and seeding/editing an academy's report fields
            // (report_field.manage) are platform actions the Super Admin performs in the new
            // academy's context (§3.4, §4.2, §7).
            'SUPER_ADMIN' => [
                'academy.create', 'academy.suspend', 'academy.configure', 'academy.enter', 'academy.read', 'academy.delete',
                'plan.manage', 'academy_billing.manage', 'automation.manage',
                'user.invite', 'role.assign', 'role.manage', 'user.read_platform', 'platform.manage', 'report_field.manage', 'specialization.manage', 'settings.manage', 'teacher_report.manage', 'audit.read',
                'staff_department.manage',
            ],
            // All academy-scoped capabilities, never the platform ones.
            'ACADEMY_OWNER' => $academyScoped,
            // Own schedule / sessions / students, their own teacher record, and their own
            // payout only. `student.read` is row-filtered to assigned students and
            // `teacher.read_own` to their own teacher row at the controller layer (§3.6).
            // A Teacher no longer cancels a class directly — they raise a cancellation REQUEST
            // (session.cancel_request) the Owner must approve (Notifications page). The
            // Notifications page itself is OWNER-only: a Teacher has no notification.read, so the
            // page, its sidebar link, and every notification/cancellation-queue endpoint are out
            // of reach for them.
            'TEACHER' => [
                'schedule.read',
                'session.read', 'session.mark_attendance', 'session.write_report',
                // Log a one-off class the timetable never produced. Scoped hard server-side: only
                // for a student assigned to them, and always with themselves as the teacher.
                'session.create',
                'session.reschedule', 'session.cancel_request',
                // A teacher cannot mark a lesson free directly (the academy's free-lesson billing
                // logic differs) — they raise a request the Owner approves (like a cancellation).
                'session.free_request',
                'student.read',
                // Their own groups only (row-scoped in ClassGroupController), to mark the sheet.
                'group.read',
                'teacher.read_own',
                'payout.read_own',
                // Read the quality reports written about themselves. Self-scoped in the controller:
                // a quality report docks their pay, so they must be able to see what they were
                // docked for and why — never a window onto a colleague's reports.
                'teacher_quality.read_own',
                // Write monthly progress reports about their own students and submit them for the
                // Owner to review on the Notifications page (the Owner holds student_report.review).
                'student_report.submit',
                // Video classroom — a teacher JOINS their class and views its recordings, but does
                // not create/manage rooms (the academy owns the room, V-CTL-1).
                'room.read', 'room.join', 'recording.view',
            ],
            // Non-teaching staff baseline (reception/admin desk). Deliberately MINIMAL and
            // read-only: enough to see who's enrolled and the day's schedule. Anything beyond
            // this is delegated through a CUSTOM role the academy builds (academy_roles),
            // composed from the Owner's own capability set. Never includes platform caps.
            'STAFF' => [
                'student.read',
                'guardian.read',
                'schedule.read',
                'session.read',
            ],
        ];
    }
}
