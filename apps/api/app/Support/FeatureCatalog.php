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
        'student_reports' => 'Student progress reports (teacher→owner review)',
        'audit.full' => 'Full audit history (beyond 30 days)',
        'report_field.custom' => 'Custom report fields',
        'video.conferencing' => 'Video classroom (self-hosted rooms & recordings)',
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
