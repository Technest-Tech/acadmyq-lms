<?php

declare(strict_types=1);

namespace App\Jobs;

use App\Services\PrepaidMonthly;
use App\Services\Whatsapp\WhatsAppSender;
use App\Support\AcademyUrl;
use App\Support\AuthContext;
use App\Support\Tenancy;
use Carbon\CarbonImmutable;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;

/**
 * Sends one prepaid monthly bill to its payer on WhatsApp ({@see PrepaidMonthly}) — only for an
 * academy that ticked "send the bill on WhatsApp" in Settings → طريقة التحصيل.
 *
 * One job per bill, spaced out ({@see queueFor()}): a few hundred messages leaving one number in the
 * same minute is how a WhatsApp number gets banned. Idempotent per (bill, month) through the send
 * log's dedupe key, and a bill paid in the meantime is not chased.
 */
final class SendPrepaidBillJob implements ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    private const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

    /** Seconds between two bills leaving the same number. */
    public const SPACING_SECONDS = 45;

    public function __construct(
        public readonly string $academyId,
        public readonly string $invoiceId,
        public readonly string $period,
    ) {}

    /**
     * Queue the bills of one run, spaced out. A no-op unless the academy asked for it. Called inside
     * the academy's tenant context.
     *
     * @param  list<string>  $invoiceIds
     */
    public static function queueFor(string $academyId, string $period, array $invoiceIds): int
    {
        if ($invoiceIds === [] || ! PrepaidMonthly::settings($academyId)['whatsapp']) {
            return 0;
        }

        foreach (array_values($invoiceIds) as $i => $invoiceId) {
            self::dispatch($academyId, $invoiceId, $period)
                ->delay(now()->addSeconds(30 + $i * self::SPACING_SECONDS));
        }

        return count($invoiceIds);
    }

    public function handle(WhatsAppSender $sender): void
    {
        $ctx = new AuthContext(userId: self::SYSTEM_USER_ID, academyId: $this->academyId, role: 'SUPER_ADMIN', permissions: []);

        Tenancy::withContext($ctx, function () use ($sender): void {
            $inv = DB::table('invoices as inv')
                ->leftJoin('guardians as g', 'g.id', '=', 'inv.guardian_id')
                ->leftJoin('students as s', 's.id', '=', 'inv.student_id')
                ->where('inv.id', $this->invoiceId)
                ->first([
                    'inv.id', 'inv.public_token', 'inv.total_minor', 'inv.amount_paid_minor', 'inv.currency', 'inv.status', 'inv.due_on',
                    'inv.guardian_id', 'inv.student_id',
                    DB::raw('coalesce(g.full_name, s.full_name) as payer_name'),
                    DB::raw('coalesce(g.whatsapp_phone, s.whatsapp_phone) as payer_phone'),
                ]);

            if ($inv === null || ! in_array((string) $inv->status, ['OPEN', 'CLOSED', 'PARTIALLY_PAID'], true)
                || (int) $inv->total_minor <= (int) $inv->amount_paid_minor) {
                return; // gone, paid, or nothing owed
            }

            $message = $this->message($inv);
            $sender->sendOrLink($this->academyId, (string) ($inv->payer_phone ?? ''), $message, [
                'automation_type' => 'TYPE1_BILLING',
                'recipient_kind' => $inv->guardian_id !== null ? 'GUARDIAN' : 'STUDENT',
                'recipient_id' => (string) ($inv->guardian_id ?? $inv->student_id),
                'template_key' => 'PREPAID_BILL',
                'ref_type' => 'invoice',
                'ref_id' => (string) $inv->id,
                'dedupe_key' => "prepaid:{$inv->id}:{$this->period}",
            ]);
        });
    }

    /** The reminder, the way the academy wrote it by hand: the month, what came off, the total, the date. */
    public function message(object $inv): string
    {
        $prepaid = app(PrepaidMonthly::class);
        $currency = (string) $inv->currency;
        $lines = DB::table('invoice_line_items as li')
            ->leftJoin('students as st', 'st.id', '=', 'li.student_id')
            ->where('li.invoice_id', (string) $inv->id)
            ->whereNotNull('li.prepaid_charge')
            ->orderBy('st.full_name')
            ->get(['li.prepaid_charge', 'li.amount_minor', 'st.full_name']);

        $fees = $lines->where('prepaid_charge', PrepaidMonthly::FEE);
        $credits = $lines->where('prepaid_charge', PrepaidMonthly::LESSON)->filter(fn ($l) => (int) $l->amount_minor < 0);
        $charges = $lines->where('prepaid_charge', PrepaidMonthly::LESSON)->filter(fn ($l) => (int) $l->amount_minor > 0);
        $names = $fees->pluck('full_name')->filter()->unique()->implode('، ');

        $out = [];
        $out[] = 'السلام عليكم ورحمة الله'.(trim((string) $inv->payer_name) !== '' ? ' '.trim((string) $inv->payer_name) : '');
        $out[] = 'تذكير بدفع اشتراك شهر '.$prepaid->monthLabel($this->period).($names !== '' ? ' — '.$names : '');
        $out[] = '';
        $out[] = '• الاشتراك: '.$this->money((int) $fees->sum('amount_minor'), $currency);
        if ($credits->isNotEmpty()) {
            $out[] = '• خصم '.$credits->count().' حصة (إجازات): -'.$this->money(-(int) $credits->sum('amount_minor'), $currency);
        }
        if ($charges->isNotEmpty()) {
            $out[] = '• حصص سابقة: '.$this->money((int) $charges->sum('amount_minor'), $currency);
        }
        $out[] = '*الإجمالي: '.$this->money((int) $inv->total_minor - (int) $inv->amount_paid_minor, $currency).'*';
        if ($inv->due_on !== null) {
            $due = CarbonImmutable::parse((string) $inv->due_on);
            $out[] = 'السداد حتى '.$due->day.' '.explode(' ', $prepaid->monthLabel($due->format('Y-m-01')))[0];
        }
        $out[] = '';
        $out[] = 'الفاتورة والدفع: '.AcademyUrl::origin($this->academyId).'/i/'.$inv->public_token;

        return implode("\n", $out);
    }

    private function money(int $minor, string $currency): string
    {
        $amount = $minor % 100 === 0 ? number_format(intdiv($minor, 100)) : number_format($minor / 100, 2);

        return $amount.' '.$currency;
    }
}
