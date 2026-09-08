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
        'plan.manage',
        // Platform↔Academy subscription billing + per-academy WhatsApp automation (Super-Admin only).
        'academy_billing.manage', 'automation.manage',
        'user.invite', 'role.assign', 'user.read_platform',
        // Create/edit/delete an academy's own CUSTOM roles and assign them (academy_roles).
        'role.manage',
        'platform.manage',
        'teacher.read', 'teacher.read_own', 'teacher.create', 'teacher.update', 'teacher.deactivate',
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
        // Mark a lesson FREE. Like a cancellation, the per-academy billing decision (charge the
        // student? pay the teacher?) is made in a popup, and a TEACHER cannot apply it directly —
        // they raise a request (session.free_request) the OWNER approves (session.free_approve).
        'session.free', 'session.free_request', 'session.free_approve',
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
        'notification.read',
        'invoice.read', 'invoice.create', 'invoice.close', 'invoice.mark_paid', 'invoice.send_link',
        'payout.read', 'payout.read_own', 'payout.finalize', 'payout.adjust',
        // Lesson packages — the hour-based second billing clock (docs/lesson-packages). Seeded
        // straight into `role_permissions` when the module shipped; listed here so the role
        // builder can see them and the SUPERVISOR preset can deliberately leave them out.
        'package.read', 'package.manage',
        'report_field.manage',
        'specialization.manage',
        'payment_settings.manage',
        'teacher_report.manage',
        // Teacher quality: the academy's delivery rubric and the reports written against it, which
        // dock pay through a derived payout deduction. `read_own` is the teacher's window onto the
        // reports about THEMSELVES — a document that costs them money has to be readable by them
        // (same reasoning as payout.read_own). Distinct from `teacher_report.manage`, which is the
        // owner-private free-text log.
        'teacher_quality.read', 'teacher_quality.manage', 'teacher_quality.read_own',
        'student_report.submit', 'student_report.review',
        'certificate.read', 'certificate.manage',
        'audit.read',
        'staff.read', 'staff.create', 'staff.update', 'staff.deactivate',
        'staff_department.manage',
        // Video classroom (docs/video-platform). The academy OWNS the room (V-CTL-1): owners
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
        'payout.read', 'payout.read_own', 'payout.finalize', 'payout.adjust',
        'payment_settings.manage',
        'package.read', 'package.manage',
        'student.set_price',
        // Course sales: the queue prints what every buyer paid, and deciding an order moves money.
        'course_order.read', 'course_order.manage', 'payment_method.manage',
    ];

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
    ];

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
            // Mark free directly (with the billing popup) + approve teachers' free requests.
            'session.free', 'session.free_approve',
            'trial.read', 'trial.manage',
            'crm.read', 'crm.manage',
            'course.read', 'course.manage', 'access_code.manage', 'learner.read',
            'course_order.read', 'course_order.manage', 'payment_method.manage',
            'notification.read',
            'invoice.read', 'invoice.create', 'invoice.close', 'invoice.mark_paid', 'invoice.send_link',
            'payout.read', 'payout.finalize', 'payout.adjust',
            'package.read', 'package.manage',
            'report_field.manage',
            'specialization.manage',
            'payment_settings.manage',
            'teacher_report.manage',
            'teacher_quality.read', 'teacher_quality.manage',
            'student_report.review',
            'certificate.read', 'certificate.manage',
            'audit.read',
            'staff.read', 'staff.create', 'staff.update', 'staff.deactivate',
            // Video classroom — the owner provisions/manages rooms and views recordings (V-CTL-1),
            // and may enter supervisor (monitor) mode. Composable into a custom management role.
            'room.read', 'room.create', 'room.join', 'room.manage', 'recording.view', 'room.monitor',
        ];

        return [
            // The whole academy MINUS the money. A supervisor runs students, teachers, schedules,
            // attendance, trials, reports, quality and the classroom — everything the academy does
            // day to day — and never sees an invoice, a salary, the profit, or what a student pays.
            //
            // Subtracted rather than listed, so the promise stays true as the product grows: a new
            // operational capability reaches supervisors the moment an owner gets it, while a new
            // MONEY capability has to be named in FINANCIAL to be withheld. Getting that wrong
            // fails safe in the direction of "the supervisor sees it", so FINANCIAL is the list to
            // update when a money surface ships.
            'SUPERVISOR' => array_values(array_diff(
                $academyScoped,
                self::FINANCIAL,
                self::SUPERVISOR_EXCLUDES,
            )),
            // Platform capabilities + the ability to act within an entered academy.
            // Onboarding (Sprint 3) is Super-Admin-only: provisioning the first owner login
            // (user.invite) and seeding/editing an academy's report fields
            // (report_field.manage) are platform actions the Super Admin performs in the new
            // academy's context (§3.4, §4.2, §7).
            'SUPER_ADMIN' => [
                'academy.create', 'academy.suspend', 'academy.configure', 'academy.enter', 'academy.read',
                'plan.manage', 'academy_billing.manage', 'automation.manage',
                'user.invite', 'role.assign', 'role.manage', 'user.read_platform', 'platform.manage', 'report_field.manage', 'specialization.manage', 'teacher_report.manage', 'audit.read',
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
