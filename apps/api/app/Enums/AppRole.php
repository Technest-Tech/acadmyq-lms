<?php

declare(strict_types=1);

namespace App\Enums;

/**
 * Canonical login roles (Master Spec §9 / §4 Actors & Roles).
 *
 * Authorization is capability-based (Laravel Gates) — these role values are
 * data used to seed RBAC, never hardcoded into authorization checks.
 */
enum AppRole: string
{
    case SuperAdmin = 'SUPER_ADMIN';
    case AcademyOwner = 'ACADEMY_OWNER';
    case Teacher = 'TEACHER';
    // Non-teaching staff baseline login. A real, assignable system role with a minimal default
    // capability set; academies layer finer-grained CUSTOM roles on top (academy_roles).
    case Staff = 'STAFF';
}
