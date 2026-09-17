<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Support\AuthContext;
use App\Support\CustomDomain;
use App\Support\Tenancy;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Move waiting custom domains forward (docs/custom-domains).
 *
 * This is the FIRST of the two halves that make a client's own address work, and the only one that
 * belongs in the application: resolve the host and, if it points at our origin, mark it VERIFIED.
 * The second half — asking Let's Encrypt for a certificate — needs root and runs from its own cron
 * drop-in (`deploy/bin/acadmyq-issue-certs.sh`), which picks up exactly the rows this command sets.
 *
 * Why it is scheduled and not only a button: DNS propagation is measured in minutes to hours and
 * nobody is watching the panel when it finishes. A client sets the record up in the evening and
 * finds their domain live in the morning, with no second phone call.
 *
 * Retry discipline. PENDING_DNS is re-checked every run — it is one cheap resolver call. FAILED is
 * not, except once an hour: FAILED means certbot could not get a certificate, and flipping the row
 * back to VERIFIED is what makes the cron try again. Let's Encrypt allows five failed validations
 * per hostname per hour, so an eager retry would spend that budget and lock the domain out of
 * issuance for exactly as long as the client is waiting for it.
 */
final class VerifyCustomDomains extends Command
{
    protected $signature = 'domains:verify {--host= : check only this host}';

    protected $description = 'Check whether pending custom domains point at this server yet';

    private const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

    public function handle(): int
    {
        if (! CustomDomain::enabled()) {
            $this->info('Custom domains are disabled (CUSTOM_DOMAINS_ENABLED).');

            return self::SUCCESS;
        }

        $rows = $this->waiting();
        if ($rows === []) {
            return self::SUCCESS;
        }

        foreach ($rows as $row) {
            $host = (string) $row->host;
            $check = CustomDomain::dnsCheck($host);

            $this->write((string) $row->academy_id, (string) $row->id, $check);
            CustomDomain::forget($host);

            $this->line(sprintf('%-40s %s', $host, $check['ok'] ? 'VERIFIED' : 'waiting — '.$check['error']));
        }

        return self::SUCCESS;
    }

    /**
     * The rows to look at. The sweep belongs to no academy, so the listing goes through the
     * SECURITY DEFINER hatch rather than a contextless query — which, under the table's tenant
     * policy, would return nothing at all and fail completely silently.
     *
     * @return list<object>
     */
    private function waiting(): array
    {
        $rows = DB::select('select * from app.custom_domains_waiting(?)', [now()->subHour()]);

        $host = CustomDomain::normalize($this->option('host'));
        if ($host !== null) {
            $rows = array_filter($rows, static fn (object $r): bool => strtolower((string) $r->host) === $host);
        }

        return array_values($rows);
    }

    /**
     * Record the outcome inside the owning academy's context so the table's Super-Admin write
     * policy admits it.
     *
     * @param  array{ok: bool, ips: list<string>, error: ?string}  $check
     */
    private function write(string $academyId, string $domainId, array $check): void
    {
        $ctx = new AuthContext(
            userId: self::SYSTEM_USER_ID,
            academyId: $academyId,
            role: 'SUPER_ADMIN',
            permissions: [],
        );

        Tenancy::withContext($ctx, function () use ($domainId, $check): void {
            DB::table('academy_domains')->where('id', $domainId)->update([
                'status' => $check['ok'] ? 'VERIFIED' : 'PENDING_DNS',
                'verified_at' => $check['ok'] ? now() : null,
                'last_error' => $check['error'],
                'last_checked_at' => now(),
                'updated_at' => now(),
            ]);
        });
    }
}
