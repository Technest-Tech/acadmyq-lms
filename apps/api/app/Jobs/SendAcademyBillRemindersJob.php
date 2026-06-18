<?php

declare(strict_types=1);

namespace App\Jobs;

use App\Services\AcademyBilling;
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
 * Daily reminder sweep for unpaid platform bills (Platform↔Academy billing). For every academy it
 * flips lapsed OPEN bills to OVERDUE, then nudges the owner over WhatsApp (via the seam: Wasender
 * when a token is configured, otherwise a wa.me deep link logged for manual follow-up) for any bill
 * that is overdue or due within the reminder lead. Idempotent per bill per day via the send log's
 * dedupe key; per-academy tenant-isolated.
 */
final class SendAcademyBillRemindersJob implements ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    private const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

    /** Remind when a bill is overdue or falls due within this many days. */
    private const LEAD_DAYS = 3;

    public function __construct(private readonly ?string $onlyAcademyId = null) {}

    /**
     * @return array<string, int> academyId → number of reminders dispatched
     */
    public function handle(AcademyBilling $billing, WhatsAppSender $sender): array
    {
        $results = [];
        foreach ($this->targetAcademyIds() as $academyId) {
            $ctx = new AuthContext(
                userId: self::SYSTEM_USER_ID,
                academyId: $academyId,
                role: 'SUPER_ADMIN',
                permissions: [],
            );

            $results[$academyId] = Tenancy::withContext($ctx, fn () => $this->remindForAcademy($academyId, $billing, $sender));
        }

        return $results;
    }

    private function remindForAcademy(string $academyId, AcademyBilling $billing, WhatsAppSender $sender): int
    {
        $billing->markOverdue($academyId);

        $today = now()->toDateString();
        $cutoff = now()->addDays(self::LEAD_DAYS)->toDateString();

        $bills = DB::table('academy_invoices')
            ->where('academy_id', $academyId)
            ->whereIn('status', ['OPEN', 'OVERDUE'])
            ->whereDate('due_date', '<=', $cutoff)
            ->get(['id', 'period_start', 'period_end', 'total_minor', 'currency', 'due_date', 'public_token']);

        if ($bills->isEmpty()) {
            return 0;
        }

        $academyName = (string) DB::table('academies')->where('id', $academyId)->value('name');
        $phone = $billing->ownerPhone($academyId) ?? '';
        $frontendUrl = rtrim((string) (config('app.frontend_url') ?: config('app.url')), '/');

        $count = 0;
        foreach ($bills as $bill) {
            $url = $frontendUrl.'/a/'.$bill->public_token;
            $message = implode("\n\n", [
                "تذكير: فاتورة اشتراك {$academyName} مستحقة بتاريخ {$bill->due_date}. للدفع: {$url}",
                "Reminder: {$academyName}'s subscription invoice is due {$bill->due_date}. Pay: {$url}",
            ]);

            $send = $sender->sendOrLink($academyId, $phone, $message, [
                'automation_type' => 'MANUAL',
                'recipient_kind' => 'ACADEMY_OWNER',
                'ref_type' => 'academy_invoice',
                'ref_id' => $bill->id,
                'dedupe_key' => "acadbill:{$bill->id}:{$today}",
            ]);

            if ($send['duplicate']) {
                continue;
            }

            DB::table('academy_invoices')->where('id', $bill->id)->update([
                'sent_at' => now(),
                'sent_channel' => 'WHATSAPP',
                'reminder_count' => DB::raw('reminder_count + 1'),
                'updated_at' => now(),
            ]);
            $count++;
        }

        if ($count > 0) {
            Audit::log('academy_invoice.reminder_sent', 'academy', $academyId, $academyId, null, 'SUPER_ADMIN', after: [
                'reminders' => $count,
                'trigger' => 'scheduled',
            ]);
        }

        return $count;
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
                ->whereIn('status', ['ACTIVE', 'TRIAL', 'SUSPENDED'])
                ->pluck('id')
                ->map(fn ($id) => (string) $id)
                ->all();
        } finally {
            TenantContext::clear();
        }
    }
}
