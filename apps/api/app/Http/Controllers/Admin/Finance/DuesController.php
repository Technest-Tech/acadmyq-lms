<?php

declare(strict_types=1);

namespace App\Http\Controllers\Admin\Finance;

use App\Http\Controllers\Controller;
use App\Services\AccountReminders;
use App\Services\FinanceLedger;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Super Admin → Accounts → Dues: the owner's money to-do list, the first screen of Accounts.
 *
 *   late        money owed past its date
 *   week        falling due in the next 7 days
 *   month       falling due later this month (to day 31)
 *   proofs      transfer screenshots clients uploaded, waiting for a yes/no
 *   trials      platform trials ending within a week — the moment to agree a price
 *   unagreed    platform clients that run paid modules but have no agreement in the book yet
 *
 * plus the money row (collected this month, owed, monthly run-rate) and whether the WhatsApp
 * reminders are wired. Reading it first rolls every subscription up to today, so the page is
 * right even on a morning the scheduler missed.
 */
final class DuesController extends Controller
{
    public function __construct(
        private readonly FinanceLedger $ledger,
        private readonly AccountReminders $reminders,
    ) {}

    /** GET /api/admin/finance/dues */
    public function index(): JsonResponse
    {
        Gate::authorize('platform.manage');

        $this->ledger->accrueAll();

        $late = [];
        $week = [];
        $month = [];
        foreach ($this->ledger->openDues(31) as $due) {
            if ($due->days_late > 0) {
                $late[] = $due;
            } elseif ($due->days_late >= -7) {
                $week[] = $due;
            } else {
                $month[] = $due;
            }
        }
        // The longest-late first: that is the call to make today.
        usort($late, fn (object $a, object $b): int => $b->days_late <=> $a->days_late);

        $directory = json_decode((string) DB::selectOne('select app.admin_client_directory() as d')->d, true);
        $linked = DB::table('finance_clients as c')
            ->whereNotNull('c.linked_academy_id')
            ->selectRaw("c.linked_academy_id as academy_id, exists (select 1 from finance_deals d where d.client_id = c.id and d.status = 'ACTIVE') as has_deal")
            ->get()
            ->mapWithKeys(fn (object $r): array => [(string) $r->academy_id => (bool) $r->has_deal])
            ->all();

        $today = CarbonImmutable::parse($this->ledger->today());
        $trials = [];
        $unagreed = [];
        foreach ($directory['clients'] ?? [] as $client) {
            if (($client['status'] ?? '') === 'SUSPENDED') {
                continue;
            }
            $paidModules = [];
            foreach ($client['modules'] ?? [] as $m) {
                if (($m['status'] ?? '') !== 'ACTIVE') {
                    continue;
                }
                if ($m['is_trial'] ?? false) {
                    $end = isset($m['trial_end']) ? CarbonImmutable::parse((string) $m['trial_end']) : null;
                    $days = $end === null ? null : (int) $today->diffInDays($end->startOfDay(), false);
                    if ($days !== null && $days <= 7) {
                        $trials[(string) $client['id']] ??= [
                            'academy_id' => $client['id'],
                            'name' => $client['name'],
                            'trial_end' => $m['trial_end'],
                            'days' => $days,
                            'owner_phone' => $client['owner_phone'] ?? null,
                        ];
                    }
                } else {
                    $paidModules[] = $m;
                }
            }
            if ($paidModules !== [] && ! ($linked[(string) $client['id']] ?? false)) {
                $first = $paidModules[0];
                $unagreed[] = [
                    'academy_id' => $client['id'],
                    'name' => $client['name'],
                    'client_type' => $client['client_type'] ?? null,
                    // What the modules were sold at — the agreement form's starting point.
                    'suggested_minor' => array_sum(array_map(fn (array $m): int => (int) ($m['total_cost_minor'] ?? 0), $paidModules)),
                    'currency' => $first['currency'] ?? ($client['default_currency'] ?? 'EGP'),
                    'interval' => $first['billing_interval'] ?? 'MONTHLY',
                ];
            }
        }
        $trials = array_values($trials);
        usort($trials, fn (array $a, array $b): int => $a['days'] <=> $b['days']);

        $settings = $this->reminders->settings();
        $overview = $this->ledger->overview();

        return response()->json([
            'today' => $today->toDateString(),
            'totals' => $overview['totals'],
            'late' => $late,
            'week' => $week,
            'month' => $month,
            'proofs' => $this->ledger->submissions(null, true),
            'trials' => $trials,
            'unagreed' => $unagreed,
            'reminders' => [
                'enabled' => $settings['enabled'],
                'ready' => $settings['enabled'] && $settings['sender_academy_id'] !== null,
                'owner_digest' => $settings['owner_phone'] !== null,
            ],
        ]);
    }

    /** POST /api/admin/finance/reminders/test — one line to the owner's phone from the chosen number. */
    public function testReminder(): JsonResponse
    {
        Gate::authorize('platform.manage');

        $settings = $this->reminders->settings();
        if ($settings['sender_academy_id'] === null || $settings['owner_phone'] === null) {
            abort(422, 'Pick the sending number and type your phone first.');
        }

        return response()->json(['sent' => $this->reminders->sendTest()]);
    }
}
