<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Symfony\Component\Console\Output\BufferedOutput;

/**
 * Super Admin → client page → Maintenance: the repair commands that used to need an SSH session,
 * run for ONE client from its own page — look first, then apply.
 *
 * Each tool is an existing Artisan command, unchanged: this class only decides which ones are
 * offered, pins them to the client (`--academy`), and hands back what the command printed. A tool
 * is listed here only when it is safe to repeat and has nothing to decide beyond "yes, do it" —
 * one-off migrations, imports and anything that needs a judgement call about money stay on the
 * command line (students:finish-removal's `--blocks`, sessions:generate's `--floor`).
 *
 *   preview  the command lists what it would do when run without `--apply`
 *   centre   only offered to a curriculum centre (the command does nothing for anyone else)
 *   keeps    cache keys the run must leave as they were (see run())
 */
final class ClientTools
{
    /** @var array<string, array{command: string, preview: bool, centre: bool, keeps: list<string>}> */
    public const TOOLS = [
        // The nightly roll, now, for this client: idempotent, future-only, nothing to preview.
        'generate_lessons' => [
            'command' => 'sessions:generate',
            'preview' => false,
            'centre' => false,
            // A single client's run is not the platform's nightly roll: System health must go on
            // reading the nightly one, or a manual run would hide a roll that has been dead for days.
            'keeps' => ['scheduler.last_roll_at', 'scheduler.last_roll_created'],
        ],
        'finish_removals' => [
            'command' => 'students:finish-removal',
            'preview' => true,
            'centre' => false,
            'keeps' => [],
        ],
        'restore_half_undone' => [
            'command' => 'lessons:restore-half-undone',
            'preview' => true,
            'centre' => false,
            'keeps' => [],
        ],
        'clear_deleted_dues' => [
            'command' => 'subscriptions:clear-deleted-dues',
            'preview' => true,
            'centre' => true,
            'keeps' => [],
        ],
    ];

    /**
     * The tools this client is offered.
     *
     * @return list<array{key: string, preview: bool}>
     */
    public static function for(bool $isCentre): array
    {
        $out = [];
        foreach (self::TOOLS as $key => $tool) {
            if ($tool['centre'] && ! $isCentre) {
                continue;
            }
            $out[] = ['key' => $key, 'preview' => $tool['preview']];
        }

        return $out;
    }

    /**
     * Run one tool for one client and return what it printed.
     *
     * The commands set the tenant context themselves and clear it on the way out, so the caller's
     * own context is put back afterwards — the rest of the request (its audit row) still runs as
     * the Super Admin who pressed the button.
     *
     * @return array{exit_code: int, output: string}
     */
    public static function run(string $key, string $academyId, bool $apply, AuthContext $caller): array
    {
        $tool = self::TOOLS[$key];
        $kept = [];
        foreach ($tool['keeps'] as $cacheKey) {
            $kept[$cacheKey] = Cache::get($cacheKey);
        }

        $arguments = ['--academy' => $academyId];
        if ($tool['preview'] && $apply) {
            $arguments['--apply'] = true;
        }

        $output = new BufferedOutput;
        try {
            $exit = Artisan::call($tool['command'], $arguments, $output);
        } finally {
            TenantContext::apply($caller->userId, $caller->academyId, $caller->role, local: true);
            foreach ($kept as $cacheKey => $value) {
                $value === null ? Cache::forget($cacheKey) : Cache::put($cacheKey, $value, now()->addDays(30));
            }
        }

        return ['exit_code' => $exit, 'output' => trim($output->fetch())];
    }
}
