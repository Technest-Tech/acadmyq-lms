<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Support\Facades\DB;

/**
 * The address an academy's own people see in links WE hand them — a payment link in a WhatsApp
 * message above all. It is the academy's address, not the platform's: a parent paying a bill
 * should land on `<handle>.<root>` (or the client's own domain), the same place the academy
 * already sends them, never on a platform URL they have no reason to trust.
 *
 * Preference, most specific first:
 *   1. a live custom domain (MANAGEMENT first, then LMS — both serve `/i/{token}`),
 *   2. `<subdomain>.<root>` when subdomain routing is configured and the academy has a handle,
 *   3. the platform frontend — the fallback that works in every environment.
 *
 * Reads `academies` and `academy_domains` under the CALLER's tenant context (both are readable by
 * the academy itself), so call it inside `Tenancy::withContext` from a job.
 */
final class AcademyUrl
{
    /** The platform frontend origin, no trailing slash. */
    public static function platform(): string
    {
        return rtrim((string) (config('app.frontend_url') ?: config('app.url')), '/');
    }

    /** This academy's public origin, no trailing slash. */
    public static function origin(?string $academyId): string
    {
        if ($academyId === null || $academyId === '') {
            return self::platform();
        }

        $custom = CustomDomain::primaryOrigin($academyId, 'MANAGEMENT')
            ?? CustomDomain::primaryOrigin($academyId, 'LMS');
        if ($custom !== null) {
            return rtrim($custom, '/');
        }

        if (LmsSite::configured()) {
            $sub = DB::table('academies')->where('id', $academyId)->value('subdomain');
            if (is_string($sub) && $sub !== '') {
                return LmsSite::scheme().'://'.$sub.'.'.LmsSite::rootDomain();
            }
        }

        return self::platform();
    }

    /** The public invoice / payment page for a token, on the academy's own address. */
    public static function invoice(?string $academyId, string $token): string
    {
        return self::origin($academyId).'/i/'.$token;
    }
}
