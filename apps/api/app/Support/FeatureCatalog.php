<?php

declare(strict_types=1);

namespace App\Support;

/**
 * The canonical catalog of PLAN-gated features (Sprint 9 §3) — the entitlement counterpart of
 * PermissionCatalog. Where PermissionCatalog lists RBAC capabilities ("is this ROLE allowed?"),
 * this lists the feature keys and numeric limits a plan/add-on can grant or cap ("does this
 * ACADEMY's PLAN include it?"). Resolution lives in App\Support\Entitlement.
 *
 * This is the source the admin catalog UI reads so plan/add-on forms offer known keys instead
 * of free text. Adding a feature is a two-line change here PLUS the code that gates on it
 * (an `entitled:` route or an Entitlement::check call) — capabilities fail closed, so a key
 * with no gate simply does nothing until something checks it.
 */
final class FeatureCatalog
{
    /**
     * Capability keys a plan's `features.capabilities` (or an add-on's `feature_key`) can grant.
     *
     * @return array<string, string> key => human label
     */
    public const CAPABILITIES = [
        'invoicing' => 'Invoice management & billing',
        'payroll' => 'Teacher payout calculation',
        'certificates' => 'Student certificates',
        'whatsapp.automation' => 'WhatsApp automation & notifications',
        'staff' => 'Non-teaching staff management',
        'custom_roles' => 'Custom roles & permissions builder',
        'trials' => 'Free trials pipeline & availability matcher',
        'crm' => 'CRM — leads pipeline & follow-ups',
        'student_reports' => 'Student progress reports (teacher→owner review)',
        'audit.full' => 'Full audit history (beyond 30 days)',
        'report_field.custom' => 'Custom report fields',
        'video.conferencing' => 'Video classroom (self-hosted rooms & recordings)',
        'video.only' => 'Video-only workspace (the panel shows the video classroom only)',
        'lms' => 'LMS — online courses (course builder & learner site)',
        'lms.only' => 'LMS-only workspace (the panel shows the course platform only)',
    ];

    /**
     * Numeric limit keys a plan's `features.limits` can cap (null/absent ⇒ unlimited / fail open).
     * `recordingRetentionDays` is a cap of a different shape — null/absent falls back to the global
     * LIVEKIT_RECORDING_RETENTION_DAYS default rather than "forever".
     *
     * @return array<string, string> key => human label
     */
    public const LIMITS = [
        'maxStudents' => 'Max students',
        'maxTeachers' => 'Max teachers',
        'maxRooms' => 'Video — max rooms',
        'maxRoomParticipants' => 'Video — max participants per room',
        'recordingRetentionDays' => 'Video — recording retention (days)',
        'maxCourses' => 'LMS — max published courses',
        'maxLearners' => 'LMS — max learners',
        'maxStorageGb' => 'LMS — media storage (GB)',
    ];

    /**
     * Boolean plan flags, also stored in `features.limits` (as 1/0). They FAIL OPEN — an absent flag
     * means "allowed", so legacy/uncapped plans keep working and a plan only ever RESTRICTS a feature
     * by explicitly setting it to 0. Rendered as checkboxes (not number inputs) in the plan form.
     *
     * @return array<string, string> key => human label
     */
    public const FLAGS = [
        'recordingAllowed' => 'Video — recording allowed',
        'monitorAllowed' => 'Video — supervisor (monitor) mode allowed',
    ];

    /**
     * The video-specific limit + flag keys (a subset of LIMITS ∪ FLAGS). When a Super Admin assigns
     * an academy a per-academy video TIER (academies.video_plan_id), only THESE keys are taken from
     * that tier's `features.limits` — every other limit (maxStudents, …) still comes from the
     * academy's own plan. Keeps the per-academy video override scoped to video.
     *
     * @var list<string>
     */
    public const VIDEO_LIMIT_KEYS = [
        'maxRooms',
        'maxRoomParticipants',
        'recordingRetentionDays',
        'recordingAllowed',
        'monitorAllowed',
    ];

    /**
     * The LMS-specific limit keys (a subset of LIMITS) — the course-platform twin of
     * VIDEO_LIMIT_KEYS. They are the only keys taken from the LMS module subscription: its plan
     * contributes them as the client's course-platform TIER, and a Super Admin can override any of
     * them per academy from /admin/lms (stored in the LMS sub's `overrides.limits`). Every other
     * limit (maxStudents, …) still comes from the academy's primary plan, so an LMS grant never
     * alters the school side of a multi-module client.
     *
     * @var list<string>
     */
    public const LMS_LIMIT_KEYS = [
        'maxCourses',
        'maxLearners',
        'maxStorageGb',
    ];

    /**
     * Capabilities that must NEVER be part of a general "all features" plan bundle — each one flips
     * the academy into a single-module WORKSPACE where the web panel collapses its nav to that module
     * alone, so granting one to a full plan (FREE/PRO) would wrongly hide the rest of the academy:
     *
     *  - `video.only` → the Meet Plan workspace (video classroom only).
     *  - `lms.only`   → the course-platform workspace (LMS dashboard/courses/learners/codes only).
     *
     * Only the single-module plans, seeded by their own migrations, carry these.
     *
     * @var list<string>
     */
    public const WORKSPACE_EXCLUSIVE_CAPABILITIES = [
        'video.only',
        'lms.only',
    ];

    /**
     * The four CLIENT TYPES (docs/superadmin-modules/05-MODULES-NOT-PACKAGES §2) and the modules each
     * may hold. The type is a hard constraint, not a hint: a MANAGEMENT client can add Video and
     * WhatsApp but never the course platform, and every single-module client stays single-module.
     *
     * @var array<string, list<string>>
     */
    public const CLIENT_TYPE_MODULES = [
        'MANAGEMENT' => ['MANAGEMENT', 'VIDEO', 'WHATSAPP'],
        'VIDEO' => ['VIDEO'],
        'WHATSAPP' => ['WHATSAPP'],
        'LMS' => ['LMS'],
    ];

    /** The module a client of each type must always hold (its identity module). */
    public const CLIENT_TYPE_PRIMARY = [
        'MANAGEMENT' => 'MANAGEMENT',
        'VIDEO' => 'VIDEO',
        'WHATSAPP' => 'WHATSAPP',
        'LMS' => 'LMS',
    ];

    /**
     * MODULE → the capabilities it owns (§3). This replaces `plans.features.capabilities`: a live,
     * grantable module subscription grants EVERY key listed here for that module, and the only thing
     * that ever takes one away is a per-client switch in the client profile
     * (`module_subscriptions.overrides.disabled`) or the platform kill-switch.
     *
     * A capability belongs to exactly ONE module — that is what makes "disable this feature for this
     * client" unambiguous. The workspace-exclusive keys (video.only / lms.only) are NOT here: they
     * are derived from the client's type, never granted by a subscription.
     *
     * @var array<string, list<string>>
     */
    public const MODULE_CAPABILITIES = [
        'MANAGEMENT' => [
            'invoicing',
            'payroll',
            'certificates',
            'staff',
            'custom_roles',
            'trials',
            'crm',
            'student_reports',
            'audit.full',
            'report_field.custom',
        ],
        'VIDEO' => ['video.conferencing'],
        'WHATSAPP' => ['whatsapp.automation'],
        'LMS' => ['lms'],
    ];

    /**
     * MODULE → the limit/flag keys a Super Admin may cap for that module on a client. Absent ⇒
     * unlimited (limits fail open), so a client is uncapped until someone decides otherwise.
     *
     * @var array<string, list<string>>
     */
    public const MODULE_LIMIT_KEYS = [
        'MANAGEMENT' => ['maxStudents', 'maxTeachers'],
        'VIDEO' => self::VIDEO_LIMIT_KEYS,
        'WHATSAPP' => [],
        'LMS' => self::LMS_LIMIT_KEYS,
    ];

    /** The capabilities $module grants, or [] for an unknown module (fail closed). */
    public static function capabilitiesOfModule(string $module): array
    {
        return self::MODULE_CAPABILITIES[$module] ?? [];
    }

    /** The limit/flag keys $module may cap, or [] for an unknown module. */
    public static function limitKeysOfModule(string $module): array
    {
        return self::MODULE_LIMIT_KEYS[$module] ?? [];
    }

    /** The module that owns $capability, or null when nothing does (add-on keys, unknown keys). */
    public static function moduleOfCapability(string $capability): ?string
    {
        foreach (self::MODULE_CAPABILITIES as $module => $keys) {
            if (in_array($capability, $keys, true)) {
                return $module;
            }
        }

        return null;
    }

    /** May a client of $clientType hold $module? Unknown type ⇒ false (fail closed). */
    public static function moduleAllowedForType(string $clientType, string $module): bool
    {
        return in_array($module, self::CLIENT_TYPE_MODULES[$clientType] ?? [], true);
    }

    /**
     * Every capability a full-featured plan (FREE/PRO) may bundle — the whole catalog MINUS the
     * workspace-exclusive ones. Use this instead of `array_keys(CAPABILITIES)` when granting "all
     * features", so a special-purpose capability never leaks into a general plan.
     *
     * @return list<string>
     */
    public static function bundledCapabilities(): array
    {
        return array_values(array_diff(array_keys(self::CAPABILITIES), self::WORKSPACE_EXCLUSIVE_CAPABILITIES));
    }

    /** @return array{capabilities: array<string,string>, limits: array<string,string>, flags: array<string,string>} */
    public static function all(): array
    {
        return [
            'capabilities' => self::CAPABILITIES,
            'limits' => self::LIMITS,
            'flags' => self::FLAGS,
        ];
    }
}
