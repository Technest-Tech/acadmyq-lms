<?php

declare(strict_types=1);

namespace App\Http\Controllers\Learner;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Learner\Concerns\InteractsWithLearner;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/**
 * The learner's own notification feed (docs/lms/10 §5) — "we got your transfer", "your course is
 * unlocked", "we could not confirm your payment, here is why".
 *
 * A separate table from the staff `notifications` because a learner is not a `user` (its
 * `recipient_user_id` FKs users). Everything is scoped to the subdomain's academy by RLS and, within
 * that, to the signed-in learner by the explicit predicate below.
 */
final class NotificationController extends Controller
{
    use InteractsWithLearner;

    /** GET /api/learn/notifications — the feed + the unread count the header bell renders. */
    public function index(): JsonResponse
    {
        $this->currentAcademyId();
        $learnerId = $this->learner()->getKey();

        $rows = DB::table('learner_notifications')
            ->where('learner_id', $learnerId)
            ->orderByDesc('created_at')
            ->limit(50)
            ->get(['id', 'type', 'title', 'body', 'data', 'read_at', 'created_at'])
            ->map(fn (object $n): array => [
                'id' => (string) $n->id,
                'type' => (string) $n->type,
                'title' => (string) $n->title,
                'body' => $n->body,
                'data' => is_string($n->data) ? json_decode($n->data, true) : ($n->data ?? []),
                'read_at' => $this->iso($n->read_at),
                'created_at' => $this->iso($n->created_at),
            ]);

        $unread = (int) DB::table('learner_notifications')
            ->where('learner_id', $learnerId)
            ->whereNull('read_at')
            ->count();

        return response()->json(['notifications' => $rows, 'unread' => $unread]);
    }

    /** POST /api/learn/notifications/read — mark everything read (the bell has no per-row UI). */
    public function markAllRead(): JsonResponse
    {
        $this->currentAcademyId();

        DB::table('learner_notifications')
            ->where('learner_id', $this->learner()->getKey())
            ->whereNull('read_at')
            ->update(['read_at' => now()]);

        return response()->json(['ok' => true]);
    }
}
