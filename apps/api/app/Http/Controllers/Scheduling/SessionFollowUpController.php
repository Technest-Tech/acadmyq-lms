<?php

declare(strict_types=1);

namespace App\Http\Controllers\Scheduling;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Scheduling\Concerns\InteractsWithScheduling;
use App\Support\Audit;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * The "Following" button on a lesson (gate `session.follow`).
 *
 * A supervisor presses it to say "I am on this one" — the lesson has started (or is about to) and
 * someone is watching it. The click is recorded with its instant; it is what the Supervision page
 * measures, and it is what keeps the WhatsApp "attendance not marked" reminder quiet for that
 * lesson. A click is a click: it cannot be taken back, and pressing again changes nothing.
 */
final class SessionFollowUpController extends Controller
{
    use InteractsWithScheduling;

    /**
     * How early a lesson may be followed. Following tomorrow's lesson today would make every click
     * "on time" and the measurement meaningless; an hour is enough to be waiting at the door.
     */
    private const EARLIEST_MINUTES_BEFORE_START = 60;

    private const TS = 'Y-m-d\TH:i:s.uP';

    /** POST /api/sessions/{id}/follow — record that the caller is following this lesson. */
    public function store(string $sessionId): JsonResponse
    {
        Gate::authorize('session.follow');

        $session = $this->findOwnedSession($sessionId);
        $now = CarbonImmutable::now();
        $start = CarbonImmutable::parse($session->scheduled_at_utc);

        if ((string) $session->status !== 'SCHEDULED') {
            throw ValidationException::withMessages([
                'session' => ['This lesson already has an outcome recorded. / تم تسجيل نتيجة هذه الحصة بالفعل.'],
            ]);
        }
        if ($start->subMinutes(self::EARLIEST_MINUTES_BEFORE_START)->greaterThan($now)) {
            throw ValidationException::withMessages([
                'session' => ['This lesson has not started yet. / لم تبدأ هذه الحصة بعد.'],
            ]);
        }

        $ctx = $this->ctx();
        $exists = DB::table('session_follow_ups')
            ->where('session_id', $sessionId)
            ->where('user_id', $ctx->userId)
            ->exists();

        if (! $exists) {
            DB::table('session_follow_ups')->insert([
                'id' => (string) Str::uuid(),
                'academy_id' => $session->academy_id,
                'session_id' => $sessionId,
                'user_id' => $ctx->userId,
                'followed_at' => $now->format(self::TS),
                'created_at' => $now->format(self::TS),
            ]);

            Audit::log('session.followed', 'session', $sessionId, (string) $session->academy_id, $ctx->userId, $ctx->role, after: [
                'followed_at' => $now->toIso8601String(),
                'minutes_after_start' => (int) round(($now->getTimestamp() - $start->getTimestamp()) / 60),
            ]);
        }

        return response()->json(['follow' => $this->followState($sessionId)], $exists ? 200 : 201);
    }

    /**
     * Who followed this lesson and when — the FIRST click is what the row shows, every click is
     * listed. Shared with the session rows so the button and the badge read the same fact.
     *
     * @return array{followed_at: ?string, followed_by_user_id: ?string, followed_by_name: ?string, follow_ups: list<array{user_id: string, name: ?string, followed_at: string}>}
     */
    private function followState(string $sessionId): array
    {
        $rows = DB::table('session_follow_ups as f')
            ->leftJoin('users as u', 'u.id', '=', 'f.user_id')
            ->where('f.session_id', $sessionId)
            ->orderBy('f.followed_at')
            ->get(['f.user_id', 'f.followed_at', 'u.full_name']);

        $first = $rows->first();

        return [
            'followed_at' => $first !== null ? CarbonImmutable::parse($first->followed_at)->utc()->toIso8601String() : null,
            'followed_by_user_id' => $first !== null ? (string) $first->user_id : null,
            'followed_by_name' => $first?->full_name,
            'follow_ups' => $rows->map(fn (object $r): array => [
                'user_id' => (string) $r->user_id,
                'name' => $r->full_name,
                'followed_at' => CarbonImmutable::parse($r->followed_at)->utc()->toIso8601String(),
            ])->all(),
        ];
    }
}
