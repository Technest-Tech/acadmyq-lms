<?php

declare(strict_types=1);

namespace App\Http\Controllers\Video;

use App\Http\Controllers\Controller;
use App\Support\AuthContext;
use App\Support\Tenancy;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Throwable;

/**
 * Inbound LiveKit webhooks (signature already verified by `livekit.webhook` middleware). LiveKit
 * carries no tenant context, so we resolve the academy from the `__<academyId>` suffix embedded in
 * the room name (set by VideoRoomController), then write inside Tenancy::withContext — exactly the
 * discipline WhatsAppWebhookController uses. Handlers are idempotent (keyed by egress id / open
 * participant row) and the endpoint NEVER 500s: a failure is logged and 200-acked so LiveKit does
 * not retry-storm us.
 *
 * Events handled: egress_ended (finalise a recording, AC-V1.7), participant_joined / left
 * (attendance history), room_finished (close out). Unknown events are acked and ignored.
 */
final class LivekitWebhookController extends Controller
{
    private const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

    public function handle(Request $request): JsonResponse
    {
        try {
            $event = (string) $request->json('event', '');

            match ($event) {
                'egress_ended', 'egress_updated' => $this->onEgress($request),
                'participant_joined' => $this->onParticipantJoined($request),
                'participant_left' => $this->onParticipantLeft($request),
                'room_finished' => $this->onRoomFinished($request),
                default => null,
            };
        } catch (Throwable $e) {
            // Never fail a webhook back to LiveKit — log and ack so it does not retry-storm.
            Log::warning('livekit.webhook.error', ['error' => $e->getMessage()]);
        }

        return response()->json(['ok' => true]);
    }

    private function onEgress(Request $request): void
    {
        $info = (array) $request->json('egressInfo', []);
        $egressId = (string) ($info['egressId'] ?? $info['egress_id'] ?? '');
        $roomName = (string) ($info['roomName'] ?? $info['room_name'] ?? '');
        $academyId = $this->academyFromRoom($roomName);
        if ($egressId === '' || $academyId === null) {
            return;
        }

        // LiveKit egress status: EGRESS_COMPLETE / EGRESS_FAILED / EGRESS_ABORTED.
        $status = (string) ($info['status'] ?? '');
        $mapped = match ($status) {
            'EGRESS_COMPLETE' => 'COMPLETED',
            'EGRESS_FAILED' => 'FAILED',
            'EGRESS_ABORTED' => 'ABORTED',
            default => 'RECORDING',
        };

        // Real payload (verified 2026-06-27 against a live local egress): `fileResults[]` is the
        // modern shape (legacy `file` kept as a fallback); `size`/`duration` arrive as STRINGS
        // (protobuf int64 → JSON) and `duration` is in NANOSECONDS.
        $file = (array) ($info['fileResults'][0] ?? $info['file'] ?? []);

        $this->inAcademy($academyId, function () use ($egressId, $mapped, $file): void {
            // Idempotent: update-by-egress_id; a duplicate delivery is a harmless re-write.
            DB::table('room_recordings')->where('egress_id', $egressId)->update(array_filter([
                'status' => $mapped,
                // Store the bucket-relative object KEY (`filename`), NOT `location`: the real
                // `location` is a full URL carrying the storage endpoint host (e.g. the internal
                // `minio:9000`), which is useless for a presigned playback URL. `filename` is what
                // Storage::temporaryUrl() needs.
                'storage_key' => $file['filename'] ?? $file['location'] ?? null,
                'bytes' => isset($file['size']) ? (int) $file['size'] : null,
                'duration_s' => isset($file['duration']) ? (int) round(((int) $file['duration']) / 1_000_000_000) : null,
                'ended_at' => now(),
                'updated_at' => now(),
            ], static fn ($v) => $v !== null));
        });
    }

    private function onParticipantJoined(Request $request): void
    {
        $room = (array) $request->json('room', []);
        $participant = (array) $request->json('participant', []);
        $roomName = (string) ($room['name'] ?? '');
        $academyId = $this->academyFromRoom($roomName);
        $identity = (string) ($participant['identity'] ?? '');
        if ($academyId === null || $identity === '') {
            return;
        }

        $this->inAcademy($academyId, function () use ($roomName, $identity, $participant): void {
            $roomId = DB::table('video_rooms')->where('livekit_name', $roomName)->value('id');
            if ($roomId === null) {
                return;
            }
            // One open row per (room, identity): don't duplicate on a reconnect.
            $open = DB::table('room_participants')
                ->where('room_id', $roomId)->where('identity', $identity)->whereNull('left_at')->exists();
            if ($open) {
                return;
            }
            DB::table('room_participants')->insert([
                'id' => (string) Str::uuid(),
                'academy_id' => DB::table('video_rooms')->where('id', $roomId)->value('academy_id'),
                'room_id' => $roomId,
                'identity' => $identity,
                'display_name' => $participant['name'] ?? null,
                'joined_at' => now(),
            ]);
        });
    }

    private function onParticipantLeft(Request $request): void
    {
        $room = (array) $request->json('room', []);
        $participant = (array) $request->json('participant', []);
        $roomName = (string) ($room['name'] ?? '');
        $academyId = $this->academyFromRoom($roomName);
        $identity = (string) ($participant['identity'] ?? '');
        if ($academyId === null || $identity === '') {
            return;
        }

        $this->inAcademy($academyId, function () use ($roomName, $identity): void {
            $roomId = DB::table('video_rooms')->where('livekit_name', $roomName)->value('id');
            if ($roomId === null) {
                return;
            }
            DB::table('room_participants')
                ->where('room_id', $roomId)->where('identity', $identity)->whereNull('left_at')
                ->update(['left_at' => now(), 'updated_at' => now()]);
        });
    }

    private function onRoomFinished(Request $request): void
    {
        $room = (array) $request->json('room', []);
        $roomName = (string) ($room['name'] ?? '');
        $academyId = $this->academyFromRoom($roomName);
        if ($academyId === null) {
            return;
        }

        // Close any participant rows still marked as present when the room ended.
        $this->inAcademy($academyId, function () use ($roomName): void {
            $roomId = DB::table('video_rooms')->where('livekit_name', $roomName)->value('id');
            if ($roomId === null) {
                return;
            }
            DB::table('room_participants')->where('room_id', $roomId)->whereNull('left_at')
                ->update(['left_at' => now(), 'updated_at' => now()]);
        });
    }

    /** Resolve the academy id from the `__<uuid>` suffix the room name carries. */
    private function academyFromRoom(string $roomName): ?string
    {
        if (! str_contains($roomName, '__')) {
            return null;
        }
        $candidate = Str::afterLast($roomName, '__');

        return Str::isUuid($candidate) ? $candidate : null;
    }

    private function inAcademy(string $academyId, callable $fn): void
    {
        $ctx = new AuthContext(self::SYSTEM_USER_ID, $academyId, 'SUPER_ADMIN', []);
        Tenancy::withContext($ctx, $fn);
    }
}
