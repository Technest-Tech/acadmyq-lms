<?php

declare(strict_types=1);

namespace App\Jobs;

use App\Services\Whatsapp\MessageTemplateRenderer;
use App\Services\Whatsapp\WhatsAppSender;
use App\Support\Audit;
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
 * Type 1 automation — monthly student billing + dunning over WhatsApp. At the start of the month,
 * for every academy with `type1_billing_enabled`, READ last month's unpaid student invoices (the
 * existing per-student `invoices` table — this job NEVER generates or mutates invoices) and send
 * each payer the bill + pay link through the WhatsApp seam (Wasender when the academy has a token,
 * otherwise a deep link logged for manual follow-up).
 *
 * Idempotent per (invoice, month) via the send-log dedupe key; per-academy tenant-isolated.
 */
final class MonthlyStudentBillingJob implements ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    private const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

    public function __construct(private readonly ?string $onlyAcademyId = null) {}

    /**
     * @return array<string, int> academyId → number of bills sent/queued
     */
    public function handle(WhatsAppSender $sender, MessageTemplateRenderer $templates): array
    {
        $last = now()->subMonth();
        $year = (int) $last->format('Y');
        $month = (int) $last->format('n');
        $period = sprintf('%04d-%02d', $year, $month);
        $stamp = now()->format('Y-m');
        $frontendUrl = rtrim((string) (config('app.frontend_url') ?: config('app.url')), '/');

        $results = [];
        foreach ($this->targetAcademyIds() as $academyId) {
            $ctx = new AuthContext(
                userId: self::SYSTEM_USER_ID,
                academyId: $academyId,
                role: 'SUPER_ADMIN',
                permissions: [],
            );

            $results[$academyId] = Tenancy::withContext($ctx, function () use ($academyId, $year, $month, $period, $stamp, $frontendUrl, $sender, $templates) {
                if (! $this->enabled($academyId)) {
                    return 0;
                }

                $invoices = DB::table('invoices as inv')
                    ->leftJoin('guardians as g', 'g.id', '=', 'inv.guardian_id')
                    ->leftJoin('students as s', 's.id', '=', 'inv.student_id')
                    ->where('inv.academy_id', $academyId)
                    ->where('inv.period_year', $year)
                    ->where('inv.period_month', $month)
                    ->whereIn('inv.status', ['OPEN', 'CLOSED', 'PARTIALLY_PAID'])
                    ->get([
                        'inv.id', 'inv.public_token', 'inv.total_minor', 'inv.currency',
                        'inv.guardian_id', 'inv.student_id',
                        DB::raw('coalesce(g.full_name, s.full_name) as payer_name'),
                        DB::raw('coalesce(g.whatsapp_phone, s.whatsapp_phone) as payer_phone'),
                    ]);

                $sent = 0;
                foreach ($invoices as $inv) {
                    $message = $templates->render('TYPE1_BILL', [
                        'name' => (string) ($inv->payer_name ?? ''),
                        'period' => $period,
                        'amount' => $this->money((int) $inv->total_minor, (string) $inv->currency),
                        'url' => $frontendUrl.'/i/'.$inv->public_token,
                    ]);

                    $res = $sender->sendOrLink($academyId, (string) ($inv->payer_phone ?? ''), $message, [
                        'automation_type' => 'TYPE1_BILLING',
                        'recipient_kind' => $inv->guardian_id !== null ? 'GUARDIAN' : 'STUDENT',
                        'recipient_id' => (string) ($inv->guardian_id ?? $inv->student_id),
                        'template_key' => 'TYPE1_BILL',
                        'ref_type' => 'invoice',
                        'ref_id' => $inv->id,
                        'dedupe_key' => "type1:{$inv->id}:{$stamp}",
                    ]);

                    if (! $res['duplicate']) {
                        $sent++;
                    }
                }

                if ($sent > 0) {
                    Audit::log('automation.send', 'academy', $academyId, $academyId, null, 'SUPER_ADMIN', after: [
                        'type' => 'TYPE1_BILLING', 'count' => $sent, 'period' => $period,
                    ]);
                }

                return $sent;
            });
        }

        return $results;
    }

    private function enabled(string $academyId): bool
    {
        return (bool) DB::table('academy_automation_settings')
            ->where('academy_id', $academyId)
            ->where('type1_billing_enabled', true)
            ->exists();
    }

    private function money(int $minor, string $currency): string
    {
        return number_format($minor / 100, 2).' '.$currency;
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
