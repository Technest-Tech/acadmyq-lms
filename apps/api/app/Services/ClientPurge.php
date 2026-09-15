<?php

declare(strict_types=1);

namespace App\Services;

use App\Services\Whatsapp\GatewayAdminClient;
use App\Support\AuthContext;
use App\Support\LmsMedia;
use App\Support\Tenancy;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Throwable;

/**
 * Permanently deletes a client: the academies row, every row of every table that carries its
 * `academy_id`, and what those rows pointed at outside the database.
 *
 * The rows go in one transaction through `app.purge_academy` (see the 2026_09_16_000002 migration
 * for how it orders ~80 tables and why the audit log and finalized payouts needed a way through).
 * Nothing outside Postgres can roll back with it, so the rest waits for the commit and is
 * best-effort: the WhatsApp gateway session is logged out, and the stored files — logo, payment
 * proofs and screenshots, course receipts, LMS media, class recordings — are removed. A failure
 * there is logged, never thrown: the client is already gone, and an orphaned file is a cleanup
 * job, not a reason to tell the admin the delete failed.
 */
final class ClientPurge
{
    public function __construct(private readonly GatewayAdminClient $gateway) {}

    /**
     * @return array<string,int> rows removed, per table (cascaded rows are not itemised)
     */
    public function purge(string $academyId, AuthContext $actor): array
    {
        $target = new AuthContext(
            userId: $actor->userId,
            academyId: $academyId,
            role: 'SUPER_ADMIN',
            permissions: $actor->permissions,
        );

        [$counts, $leftovers] = Tenancy::withContext($target, function () use ($academyId) {
            $leftovers = $this->externalRefs($academyId);

            // Credentials live in tables without an academy_id (and without RLS): sign every one of
            // this client's people out before their rows disappear.
            $userIds = DB::table('users')->where('academy_id', $academyId)->pluck('id')->all();
            $emails = DB::table('users')->where('academy_id', $academyId)->pluck('email')->all();
            $learnerIds = DB::table('learners')->where('academy_id', $academyId)->pluck('id')->all();

            $tokenable = array_merge($userIds, $learnerIds);
            if ($tokenable !== []) {
                DB::table('personal_access_tokens')->whereIn('tokenable_id', $tokenable)->delete();
            }
            if ($userIds !== []) {
                DB::table((string) config('session.table', 'user_sessions'))->whereIn('user_id', $userIds)->delete();
            }
            if ($emails !== []) {
                DB::table('password_reset_tokens')->whereIn('email', $emails)->delete();
            }

            $counts = json_decode((string) DB::selectOne('select app.purge_academy(?::uuid) as c', [$academyId])->c, true);

            return [is_array($counts) ? $counts : [], $leftovers];
        });

        DB::afterCommit(fn () => $this->cleanUp($academyId, $leftovers));

        return $counts;
    }

    /**
     * Everything outside the database this client's rows point at, read before the rows go.
     *
     * @return array{wa_session_id: ?string, local_files: list<string>, recordings: list<string>}
     */
    private function externalRefs(string $academyId): array
    {
        $paths = fn (string $table, string $column) => DB::table($table)
            ->where('academy_id', $academyId)
            ->whereNotNull($column)
            ->pluck($column)
            ->map(fn ($p) => (string) $p)
            ->all();

        return [
            'wa_session_id' => DB::table('academy_automation_settings')->where('academy_id', $academyId)->value('wa_session_id'),
            'local_files' => array_merge(
                $paths('academy_payment_submissions', 'screenshot_path'),
                $paths('course_order_receipts', 'file_path'),
            ),
            'recordings' => $paths('room_recordings', 'storage_key'),
        ];
    }

    /** @param  array{wa_session_id: ?string, local_files: list<string>, recordings: list<string>}  $refs */
    private function cleanUp(string $academyId, array $refs): void
    {
        $attempt = function (string $what, callable $fn) use ($academyId): void {
            try {
                $fn();
            } catch (Throwable $e) {
                Log::warning("client purge: could not remove {$what}", ['academy_id' => $academyId, 'error' => $e->getMessage()]);
            }
        };

        if ($refs['wa_session_id'] !== null && $refs['wa_session_id'] !== '') {
            $attempt('WhatsApp gateway session', function () use ($refs) {
                if (! $this->gateway->deleteSession((string) $refs['wa_session_id'])) {
                    throw new \RuntimeException('gateway refused session delete '.$refs['wa_session_id']);
                }
            });
        }

        $attempt('logo', fn () => Storage::disk('local')->deleteDirectory("academy-logos/{$academyId}"));
        $attempt('invoice payment proofs', fn () => Storage::disk('local')->deleteDirectory("invoice-payment-proofs/{$academyId}"));
        if ($refs['local_files'] !== []) {
            $attempt('payment screenshots / receipts', fn () => Storage::disk('local')->delete($refs['local_files']));
        }
        $attempt('LMS media', fn () => Storage::disk(LmsMedia::disk())->deleteDirectory("lms/{$academyId}"));
        if ($refs['recordings'] !== []) {
            $attempt('class recordings', fn () => Storage::disk('video_recordings')->delete($refs['recordings']));
        }
    }
}
