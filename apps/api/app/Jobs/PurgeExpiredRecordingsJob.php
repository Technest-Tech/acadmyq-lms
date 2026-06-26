<?php

declare(strict_types=1);

namespace App\Jobs;

use App\Support\AuthContext;
use App\Support\Tenancy;
use App\Support\TenantContext;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;

/**
 * Recording retention purge (V-REC-2). For every active academy, delete COMPLETED recordings
 * whose `expires_at` has lapsed. Idempotent and per-academy tenant-isolated (Tenancy::withContext),
 * so a missed or duplicated run is harmless. The matching storage-object deletion is wired with
 * Phase 4 (the S3/egress storage client); this job is the schedule + the DB-row reaper.
 */
final class PurgeExpiredRecordingsJob implements ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    private const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

    public function __construct(private readonly ?string $onlyAcademyId = null) {}

    /** @return array<string, int> academyId → number of recordings purged */
    public function handle(): array
    {
        $results = [];
        foreach ($this->targetAcademyIds() as $academyId) {
            $ctx = new AuthContext(self::SYSTEM_USER_ID, $academyId, 'SUPER_ADMIN', []);
            $results[$academyId] = Tenancy::withContext($ctx, fn () => $this->purgeForAcademy());
        }

        return $results;
    }

    private function purgeForAcademy(): int
    {
        return DB::table('room_recordings')
            ->where('status', 'COMPLETED')
            ->whereNotNull('expires_at')
            ->where('expires_at', '<', now())
            ->delete();
    }

    /** @return list<string> */
    private function targetAcademyIds(): array
    {
        if ($this->onlyAcademyId !== null) {
            return [$this->onlyAcademyId];
        }

        TenantContext::apply(userId: self::SYSTEM_USER_ID, academyId: null, role: 'SUPER_ADMIN', local: false);
        try {
            return DB::table('academies')
                ->whereIn('status', ['ACTIVE', 'TRIAL'])
                ->pluck('id')
                ->map(fn ($id) => (string) $id)
                ->all();
        } finally {
            TenantContext::clear();
        }
    }
}
