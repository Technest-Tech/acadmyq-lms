<?php

declare(strict_types=1);

namespace App\Jobs;

use App\Services\Whatsapp\GroupAbsenceAlert;
use App\Support\AuthContext;
use App\Support\Tenancy;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

/**
 * Message the families of the students a group sheet just marked ABSENT ({@see GroupAbsenceAlert}).
 *
 * Dispatched after the response so the teacher's save never waits on the WhatsApp gateway. It
 * re-enters the academy's tenant context itself: the sheet's request context is gone by the time
 * it runs, and RLS would otherwise hide every row it needs.
 */
final class GroupAbsenceAlertJob implements ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    private const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

    /**
     * @param  list<string>  $studentIds
     */
    public function __construct(
        private readonly string $academyId,
        private readonly string $lessonId,
        private readonly array $studentIds,
    ) {}

    public function handle(GroupAbsenceAlert $alert): int
    {
        $ctx = new AuthContext(
            userId: self::SYSTEM_USER_ID,
            academyId: $this->academyId,
            role: 'SUPER_ADMIN',
            permissions: [],
        );

        return (int) Tenancy::withContext($ctx, fn (): int => $alert->send($this->academyId, $this->lessonId, $this->studentIds));
    }
}
