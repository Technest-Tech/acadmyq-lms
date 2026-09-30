<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/*
| The showcase academy's teachers were seeded with availability as {weekday, from, to} instead of
| {weekday, start_local, end_local}, and the teachers page crashed on it. These pin the repair
| migration: legacy windows are converted, unusable ones dropped, good rows left alone.
*/

beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();
    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP']);

    $this->availabilityOf = function (string $teacherId): array {
        $this->asAcademy($this->academy);

        return json_decode((string) DB::table('teachers')->where('id', $teacherId)->value('availability'), true);
    };

    $this->repair = function (): void {
        $this->clearTenantContext();
        DB::transaction(function () {
            (require database_path('migrations/2026_09_30_000001_normalize_teacher_availability.php'))->up();
        });
    };
});

it('rewrites from/to windows into start_local/end_local', function () {
    $legacy = $this->createTeacher($this->academy, [
        'availability' => json_encode([
            ['weekday' => 0, 'from' => '16:00', 'to' => '21:00'],
            ['weekday' => 6, 'from' => '10:00', 'to' => '14:00'],
        ]),
    ]);

    ($this->repair)();

    expect(($this->availabilityOf)($legacy))->toEqual([
        ['weekday' => 0, 'start_local' => '16:00', 'end_local' => '21:00'],
        ['weekday' => 6, 'start_local' => '10:00', 'end_local' => '14:00'],
    ]);
});

it('drops a window no screen could draw and leaves good rows untouched', function () {
    $broken = $this->createTeacher($this->academy, [
        'availability' => json_encode([
            ['weekday' => 1, 'from' => '17:00'],                           // no end
            ['weekday' => 2, 'start_local' => '09:00', 'end_local' => '11:00'],
        ]),
    ]);
    $good = [['weekday' => 3, 'start_local' => '08:00', 'end_local' => '12:00']];
    $fine = $this->createTeacher($this->academy, ['availability' => json_encode($good)]);

    ($this->repair)();

    expect(($this->availabilityOf)($broken))->toEqual([
        ['weekday' => 2, 'start_local' => '09:00', 'end_local' => '11:00'],
    ])->and(($this->availabilityOf)($fine))->toEqual($good);
});
