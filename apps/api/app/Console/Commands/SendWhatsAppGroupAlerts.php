<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Services\Whatsapp\GroupAlerts;
use Illuminate\Console\Command;

/**
 * One sweep of WhatsApp group alerts (see {@see GroupAlerts}). The scheduler runs it every minute;
 * running it by hand is safe — every alert is recorded once per group, and claims are atomic:
 *
 *   php artisan whatsapp:group-alerts
 *   php artisan whatsapp:group-alerts --academy=<uuid>
 */
final class SendWhatsAppGroupAlerts extends Command
{
    protected $signature = 'whatsapp:group-alerts
        {--academy= : Limit to a single academy id (default: every ACTIVE / TRIAL academy)}';

    protected $description = 'Detect and deliver WhatsApp group alerts (lessons, reports, packages, payments).';

    public function handle(GroupAlerts $alerts): int
    {
        $only = $this->option('academy');
        $results = $alerts->run(is_string($only) && $only !== '' ? $only : null);

        $active = array_filter($results, fn (array $r): bool => $r['detected'] + $r['messages'] + $r['confirmed'] > 0);
        foreach ($active as $academyId => $r) {
            $this->line("{$academyId}: detected {$r['detected']}, messages {$r['messages']}, confirmed {$r['confirmed']}");
        }

        return self::SUCCESS;
    }
}
