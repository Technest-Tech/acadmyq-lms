<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\SupportRequests;
use App\Support\Tenancy;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Write one line onto a client's Support page from the server — a fix or a change made for that
 * academy outside the panel (a repair run by hand, a feature switched on, a bug fixed in a deploy),
 * so its page keeps the whole history of what was done for it, not only what it typed in itself.
 *
 * The line shows on the academy's page as raised by the support team (source ADMIN) and lights its
 * badge. Default status DONE: the usual case is "this is done".
 *
 *   php artisan support:log <academy-uuid|subdomain|exact name> "Lessons of 3 Nov restored" \
 *       --kind=PROBLEM --body="The teacher's lessons were put back and the bill recounted."
 *   php artisan support:log lingo "Monthly report shows group lessons" --kind=CHANGE --status=IN_PROGRESS
 */
final class LogSupportRequest extends Command
{
    private const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

    protected $signature = 'support:log
        {academy : The academy id, its subdomain, or its exact name}
        {title : One line the academy will read}
        {--kind=CHANGE : PROBLEM (something broken, fixed) or CHANGE (something asked for, delivered)}
        {--status=DONE : NEW, IN_PROGRESS, WAITING, DONE or REJECTED}
        {--body= : The details, in words the academy understands}
        {--priority=NORMAL : NORMAL or URGENT}';

    protected $description = 'Log a fix or a change made for an academy onto its Support page.';

    public function handle(): int
    {
        $kind = strtoupper((string) $this->option('kind'));
        $status = strtoupper((string) $this->option('status'));
        $priority = strtoupper((string) $this->option('priority'));
        $title = trim((string) $this->argument('title'));
        $body = trim((string) $this->option('body'));

        foreach ([['kind', $kind, SupportRequests::KINDS], ['status', $status, SupportRequests::ADMIN_STATUSES], ['priority', $priority, SupportRequests::PRIORITIES]] as [$name, $value, $allowed]) {
            if (! in_array($value, $allowed, true)) {
                $this->error("--{$name} must be one of: ".implode(', ', $allowed).'.');

                return self::FAILURE;
            }
        }
        if ($title === '' || mb_strlen($title) > SupportRequests::MAX_TITLE) {
            $this->error('The title must be 1–'.SupportRequests::MAX_TITLE.' characters.');

            return self::FAILURE;
        }

        // Find the academy platform-wide (RLS lets a Super Admin see every academy row).
        $academy = DB::transaction(function () {
            DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
            $needle = (string) $this->argument('academy');

            return DB::table('academies')
                ->where(fn ($q) => $q->whereRaw('id::text = ?', [$needle])->orWhere('subdomain', $needle)->orWhere('name', $needle))
                ->first(['id', 'name']);
        });
        if ($academy === null) {
            $this->error("No academy '{$this->argument('academy')}'.");

            return self::FAILURE;
        }

        $ctx = new AuthContext(userId: self::SYSTEM_USER_ID, academyId: (string) $academy->id, role: 'SUPER_ADMIN', permissions: []);
        $number = Tenancy::withContext($ctx, function () use ($academy, $kind, $status, $priority, $title, $body): int {
            $academyId = (string) $academy->id;
            $number = SupportRequests::nextNumber($academyId);
            $id = (string) DB::table('support_requests')->insertGetId([
                'academy_id' => $academyId,
                'number' => $number,
                'kind' => $kind,
                'title' => $title,
                'body' => $body,
                'priority' => $priority,
                'status' => $status,
                'source' => 'ADMIN',
                'created_by_name' => 'support:log',
                'accepted_at' => $status === 'NEW' ? null : DB::raw('now()'),
                'closed_at' => in_array($status, SupportRequests::CLOSED, true) ? DB::raw('now()') : null,
                'unread_by_academy' => true,
            ]);

            Audit::log('support.request_logged', 'support_request', $id, $academyId, Audit::SYSTEM_ACTOR_ID, 'SUPER_ADMIN',
                after: ['number' => $number, 'kind' => $kind, 'title' => $title, 'status' => $status, 'via' => 'support:log']);

            return $number;
        });

        $this->info("Logged #{$number} for {$academy->name}: {$title} [{$kind} · {$status}]");

        return self::SUCCESS;
    }
}
