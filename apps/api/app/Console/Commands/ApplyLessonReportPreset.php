<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Services\Reports\LessonReportPresets;
use App\Support\AuthContext;
use App\Support\Tenancy;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Set a client's lesson report up for them: replace its form and message with a ready-made one —
 * the same thing the academy's own "start from a template" button in Settings does.
 *
 * Does not switch the `lesson_report` capability on; that stays a Super Admin switch on the client.
 *
 *   php artisan lesson-report:preset <academy-uuid> [quran]
 */
final class ApplyLessonReportPreset extends Command
{
    private const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

    protected $signature = 'lesson-report:preset
        {academy : The academy id}
        {preset=quran : The template to start from}';

    protected $description = "Replace an academy's lesson-report form and message with a ready-made template.";

    public function handle(LessonReportPresets $presets): int
    {
        $academyId = (string) $this->argument('academy');
        $ctx = new AuthContext(userId: self::SYSTEM_USER_ID, academyId: $academyId, role: 'SUPER_ADMIN', permissions: []);

        $name = Tenancy::withContext($ctx, function () use ($presets, $academyId) {
            $name = DB::table('academies')->where('id', $academyId)->value('name');
            if ($name !== null) {
                $presets->apply($academyId, (string) $this->argument('preset'), null, 'SUPER_ADMIN');
            }

            return $name;
        });
        if ($name === null) {
            $this->error("No academy {$academyId}.");

            return self::FAILURE;
        }

        $this->info("{$name}: lesson report set from the '{$this->argument('preset')}' template.");

        return self::SUCCESS;
    }
}
