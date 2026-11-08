<?php

declare(strict_types=1);

namespace App\Services;

use App\Services\Whatsapp\WhatsAppSender;
use App\Support\AuthContext;
use App\Support\Tenancy;
use Illuminate\Support\Facades\DB;

/**
 * The money reminders (Ahmed, 2026-11-08: "remind me of all of this" — and the client too).
 *
 * Every morning, for every open due on an active deal:
 *   - a week out (2–7 days before), the client hears once;
 *   - the day before / on the day, once more;
 *   - once it is late, on day 1 and then every 7 days (five times at most).
 * A client gets ONE message per run listing everything it owes soon, with its pay link. The owner
 * gets one morning digest: who is late, what falls due this week, which proofs wait for him.
 * Nothing is ever paused or suspended for being late — that stays the owner's call.
 *
 * Messages go out from one WhatsApp number the owner picks in Accounts → Settings: any client
 * of ours with a connected WhatsApp (in practice the owner's own WhatsApp-only client). With no
 * number picked nothing is sent; the Dues screen still lists everything with a manual send button.
 * Each step is logged in `finance_reminder_log`, so a step is never sent twice.
 */
final class AccountReminders
{
    public const SETTINGS_KEY = 'accounts_reminders';

    private const SYSTEM_USER = '00000000-0000-0000-0000-000000000000';

    /** How many "still late" messages one due gets (day 1, 8, 15, 22, 29). */
    private const LATE_STEPS = 5;

    public function __construct(
        private readonly FinanceLedger $ledger,
        private readonly PlatformAccounts $accounts,
        private readonly WhatsAppSender $sender,
    ) {}

    /** @return array{enabled:bool, sender_academy_id:?string, owner_phone:?string} */
    public function settings(): array
    {
        $raw = DB::table('platform_settings')->where('key', self::SETTINGS_KEY)->value('value');
        $value = is_string($raw) ? (array) json_decode($raw, true) : [];

        return [
            'enabled' => (bool) ($value['enabled'] ?? true),
            'sender_academy_id' => isset($value['sender_academy_id']) && $value['sender_academy_id'] !== '' ? (string) $value['sender_academy_id'] : null,
            'owner_phone' => isset($value['owner_phone']) && trim((string) $value['owner_phone']) !== '' ? trim((string) $value['owner_phone']) : null,
        ];
    }

    /**
     * The step a due is at today, or null when it needs no message. `days_late` is negative before
     * the due date.
     */
    public static function stepFor(int $daysLate): ?string
    {
        if ($daysLate >= -7 && $daysLate <= -2) {
            return 'before7';
        }
        if ($daysLate >= -1 && $daysLate <= 0) {
            return 'before1';
        }
        if ($daysLate >= 1) {
            $n = intdiv($daysLate - 1, 7);

            return $n < self::LATE_STEPS ? "late{$n}" : null;
        }

        return null;
    }

    /**
     * Run the morning sweep. Call inside a SUPER_ADMIN context (the job does).
     *
     * @return array{clients:int, sent:int, failed:int, digest:bool, reason:?string}
     */
    public function run(): array
    {
        $settings = $this->settings();
        $result = ['clients' => 0, 'sent' => 0, 'failed' => 0, 'digest' => false, 'reason' => null];
        if (! $settings['enabled']) {
            return ['reason' => 'disabled'] + $result;
        }
        if ($settings['sender_academy_id'] === null) {
            return ['reason' => 'no_sender'] + $result;
        }

        $today = $this->ledger->today();
        $dues = $this->ledger->openDues(7);
        $byClient = [];
        foreach ($dues as $due) {
            $byClient[$due->client_id][] = $due;
        }

        foreach ($byClient as $clientId => $clientDues) {
            $keys = [];
            foreach ($clientDues as $due) {
                $step = self::stepFor($due->days_late);
                if ($step !== null) {
                    $keys[] = "due:{$due->id}:{$step}";
                }
            }
            if ($keys === []) {
                continue;
            }
            $sent = DB::table('finance_reminder_log')->whereIn('key', $keys)->where('status', 'SENT')->pluck('key')->all();
            $fresh = array_values(array_diff($keys, $sent));
            if ($fresh === []) {
                continue;
            }

            $first = $clientDues[0];
            $phone = $this->clientPhone($first);
            if ($phone === null) {
                continue;
            }
            $result['clients']++;

            $token = $first->pay_token ?? $this->accounts->ensurePayToken((string) $clientId);
            $message = $this->clientMessage($first->academy_name ?? $first->client_name, $clientDues, $this->accounts->payUrl((string) $token));
            $ok = $this->send($settings['sender_academy_id'], $phone, $message, "acct:{$clientId}:{$today}");

            foreach ($fresh as $key) {
                DB::table('finance_reminder_log')->insert([
                    'id' => DB::raw('uuid_generate_v7()'),
                    'client_id' => $clientId,
                    'key' => $key,
                    'status' => $ok ? 'SENT' : 'FAILED',
                ]);
            }
            $ok ? $result['sent']++ : $result['failed']++;
        }

        if ($settings['owner_phone'] !== null) {
            $result['digest'] = $this->digest($settings['sender_academy_id'], $settings['owner_phone'], $dues, $today);
        }

        return $result;
    }

    /** One test line to the owner, so the settings can be proven before tomorrow morning. */
    public function sendTest(): bool
    {
        $settings = $this->settings();
        if ($settings['sender_academy_id'] === null || $settings['owner_phone'] === null) {
            return false;
        }

        return $this->send(
            $settings['sender_academy_id'],
            $settings['owner_phone'],
            "✅ تذكيرات الحسابات شغالة. هتوصلك رسالة كل صبح بالمستحقات.\n✅ Account reminders are on.",
            'acct-test:'.now()->format('YmdHis'),
        );
    }

    /** @param list<object> $dues */
    private function digest(string $senderAcademyId, string $ownerPhone, array $dues, string $today): bool
    {
        $key = "digest:{$today}";
        if (DB::table('finance_reminder_log')->where('key', $key)->where('status', 'SENT')->exists()) {
            return false;
        }

        $late = array_values(array_filter($dues, fn (object $d): bool => $d->days_late > 0));
        $soon = array_values(array_filter($dues, fn (object $d): bool => $d->days_late <= 0));
        $proofs = DB::table('finance_payment_submissions')->where('status', 'PENDING')->count();
        if ($late === [] && $soon === [] && $proofs === 0) {
            return false;
        }

        $lines = ['☀️ الحسابات النهارده'];
        if ($late !== []) {
            $lines[] = '';
            $lines[] = '🔴 متأخر ('.count(array_unique(array_column($late, 'client_id'))).'):';
            foreach (array_slice($late, 0, 12) as $d) {
                $lines[] = '• '.($d->academy_name ?? $d->client_name).' — '.self::money($d->remaining_minor, $d->currency)." (متأخر {$d->days_late} يوم)";
            }
        }
        if ($soon !== []) {
            $lines[] = '';
            $lines[] = '🟡 مستحق خلال أسبوع:';
            foreach (array_slice($soon, 0, 12) as $d) {
                $lines[] = '• '.($d->academy_name ?? $d->client_name).' — '.self::money($d->remaining_minor, $d->currency).' يوم '.$d->due_on;
            }
        }
        if ($proofs > 0) {
            $lines[] = '';
            $lines[] = "🧾 إثباتات دفع مستنية موافقتك: {$proofs}";
        }
        $base = rtrim((string) (config('app.frontend_url') ?: config('app.url')), '/');
        $lines[] = '';
        $lines[] = "{$base}/admin/accounts";

        $ok = $this->send($senderAcademyId, $ownerPhone, implode("\n", $lines), "acct-digest:{$today}");
        DB::table('finance_reminder_log')->insert([
            'id' => DB::raw('uuid_generate_v7()'),
            'client_id' => null,
            'key' => $key,
            'status' => $ok ? 'SENT' : 'FAILED',
        ]);

        return $ok;
    }

    /**
     * The message one client gets: what it owes soon, the total, the link.
     *
     * @param  list<object>  $dues
     */
    public static function clientMessage(string $name, array $dues, string $url): string
    {
        $ar = [];
        $en = [];
        $totals = [];
        foreach ($dues as $d) {
            $amount = self::money($d->remaining_minor, $d->currency);
            $ar[] = $d->days_late > 0
                ? "• {$d->title}: {$amount} — متأخر من {$d->due_on}"
                : "• {$d->title}: {$amount} — مستحق {$d->due_on}";
            $en[] = $d->days_late > 0
                ? "• {$d->title}: {$amount} — overdue since {$d->due_on}"
                : "• {$d->title}: {$amount} — due {$d->due_on}";
            $totals[$d->currency] = ($totals[$d->currency] ?? 0) + $d->remaining_minor;
        }
        $total = implode(' + ', array_map(fn (string $c, int $m): string => self::money($m, $c), array_keys($totals), $totals));

        return implode("\n", [
            "السلام عليكم {$name} 👋",
            'تذكير بمستحقات اشتراككم:',
            ...$ar,
            "الإجمالي: {$total}",
            "للدفع ورفع إثبات التحويل: {$url}",
            '',
            "Hello {$name}, a reminder of your subscription dues:",
            ...$en,
            "Total: {$total} — pay here: {$url}",
        ]);
    }

    public static function money(int $minor, string $currency): string
    {
        $decimals = $minor % 100 === 0 ? 0 : 2;

        return trim(number_format($minor / 100, $decimals).' '.trim($currency));
    }

    /** The account's own phone, else the platform client's owner. */
    private function clientPhone(object $due): ?string
    {
        $phone = trim((string) ($due->phone ?? ''));
        if ($phone !== '') {
            return $phone;
        }
        if ($due->academy_id === null) {
            return null;
        }

        $owner = $this->asSuperAdmin((string) $due->academy_id, fn () => DB::table('users as u')
            ->join('user_roles as ur', 'ur.user_id', '=', 'u.id')
            ->where('ur.academy_id', $due->academy_id)
            ->where('ur.role', 'ACADEMY_OWNER')
            ->whereNotNull('u.phone')
            ->orderBy('u.created_at')
            ->value('u.phone'));

        return $owner === null || trim((string) $owner) === '' ? null : trim((string) $owner);
    }

    private function send(string $senderAcademyId, string $phone, string $message, string $dedupeKey): bool
    {
        $res = $this->asSuperAdmin($senderAcademyId, fn () => $this->sender->sendOrLink($senderAcademyId, $phone, $message, [
            'dedupe_key' => $dedupeKey,
            'template_key' => 'account_reminder',
            'recipient_kind' => 'ACADEMY_OWNER',
        ]));

        return (bool) ($res['sent'] ?? false);
    }

    private function asSuperAdmin(string $academyId, callable $fn): mixed
    {
        return Tenancy::withContext(new AuthContext(
            userId: self::SYSTEM_USER,
            academyId: $academyId,
            role: 'SUPER_ADMIN',
            permissions: [],
        ), $fn);
    }
}
