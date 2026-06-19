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
        'invoicing'           => 'Invoice management & billing',
        'payroll'             => 'Teacher payout calculation',
        'certificates'        => 'Student certificates',
        'whatsapp.automation' => 'WhatsApp automation & notifications',
        'staff'               => 'Non-teaching staff management',
        'student_reports'     => 'Student progress reports (teacher→owner review)',
        'audit.full'          => 'Full audit history (beyond 30 days)',
        'report_field.custom' => 'Custom report fields',
    ];

    /**
     * Numeric limit keys a plan's `features.limits` can cap (null/absent ⇒ unlimited).
     *
     * @return array<string, string> key => human label
     */
    public const LIMITS = [
        'maxStudents' => 'Max students',
        'maxTeachers' => 'Max teachers',
    ];

    /** @return array{capabilities: array<string,string>, limits: array<string,string>} */
    public static function all(): array
    {
        return [
            'capabilities' => self::CAPABILITIES,
            'limits' => self::LIMITS,
        ];
    }
}
