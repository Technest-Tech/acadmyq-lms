<?php

declare(strict_types=1);

use App\Services\LessonPackages;
use App\Support\Entitlement;
use App\Support\LessonCount;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * "We agreed: no hours" (lingo, 2026-11-01). What 2026_10_31_100001 left of a centre's old blocks:
 *
 *   1. a block with no lesson and no timetable to go on still had no length: it takes the usual
 *      length that divides it into whole lessons, as the edit form already assumes;
 *   2. an auto-written label still says hours ("8 ساعة — أكتوبر 2026", even on a block of 40-minute
 *      lessons): it becomes "8 × 40 د — أكتوبر 2026"; a label somebody typed is theirs;
 *   3. the bill line on a still-open bill says "Package: … — 8h": it now says lessons.
 *
 * All wording: no balance, price or payment moves. Centres only. Idempotent.
 */
return new class extends Migration
{
    public function up(): void
    {
        $this->fill();
    }

    public function down(): void
    {
        // Wording only, and the code reads a line either way: nothing to take back.
    }

    /** Public so the test suite can run it against fixtures. @return array{lengths:int, labels:int, lines:int} */
    public function fill(): array
    {
        // One unit, so the tenant settings below hold for every statement (they are transaction-local).
        return DB::transaction(function (): array {
            DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
            $done = ['lengths' => 0, 'labels' => 0, 'lines' => 0];
            $writer = app(LessonPackages::class);

            foreach (DB::table('academies')->pluck('id')->all() as $id) {
                DB::statement("select set_config('app.current_academy_id', ?, true)", [(string) $id]);
                if (! Entitlement::hasCapability((string) $id, 'centre')) {
                    continue;
                }

                foreach (DB::table('lesson_packages')->orderBy('created_at')->get() as $block) {
                    $carried = (int) $block->carried_over_minutes;
                    $total = (int) $block->minutes_total;
                    $length = $block->lesson_minutes !== null ? (int) $block->lesson_minutes : $this->lengthOf($total);
                    if ($length === null) {
                        continue;
                    }
                    $label = $this->relabelled((string) $block->label, $total, $length);

                    $changes = [];
                    if ($block->lesson_minutes === null) {
                        $changes['lesson_minutes'] = $length;
                        $done['lengths']++;
                    }
                    if ($label !== (string) $block->label) {
                        $changes['label'] = $label;
                        $done['labels']++;
                    }
                    if ($changes !== []) {
                        DB::table('lesson_packages')->where('id', $block->id)->update($changes + ['updated_at' => now()]);
                    }

                    if ($block->invoice_id === null || DB::table('invoices')->where('id', $block->invoice_id)->value('status') !== 'OPEN') {
                        continue;
                    }
                    // Only the line that still reads exactly as it was written: a reworked one is left.
                    $done['lines'] += DB::table('invoice_line_items')
                        ->where('invoice_id', $block->invoice_id)
                        ->whereNull('session_id')
                        ->where('description', $writer->packageLineDescription((string) $block->label, $total, $carried))
                        ->update(['description' => $writer->packageLineDescription($label, $total, $carried, $length)]);
                }
            }
            DB::statement("select set_config('app.current_academy_id', '', true)");

            return $done;
        });
    }

    private function lengthOf(int $total): ?int
    {
        foreach ([60, 40, 45, 30, 90, 120, 50, 25, 20, 15] as $length) {
            if ($total > 0 && $total % $length === 0) {
                return $length;
            }
        }

        return null;
    }

    private function relabelled(string $label, int $total, int $length): string
    {
        if (preg_match('/^[\d.]+\s*(?:ساعة|ساعات|hours?)\s+—\s+(.+)$/u', $label, $m) !== 1) {
            return $label;
        }

        return LessonCount::whole($total, $length).' × '.$length.' د — '.$m[1];
    }
};
