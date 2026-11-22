<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/*
| POST /api/notifications/read-all with `ids`: the page is split by what an alert asks of the owner
| (a decision, a follow-up, a log), so "mark all read" on one section marks only that section's
| alerts and leaves the rest of the inbox as it was.
*/

beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();
    $this->academy = $this->createAcademy();
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-ids@test.local']);
    $this->other = $this->createAcademy();

    $this->alert = function (string $academy, string $type, string $category): string {
        $id = (string) Str::uuid();
        $this->asAcademy($academy);
        DB::table('notifications')->insert([
            'id' => $id, 'academy_id' => $academy, 'type' => $type, 'category' => $category,
            'audience_role' => 'ACADEMY_OWNER', 'subject_id' => (string) Str::uuid(), 'data' => '{}',
        ]);
        $this->clearTenantContext();

        return $id;
    };
    $this->readAt = function (string $id, ?string $academy = null): ?string {
        $this->asAcademy($academy ?? $this->academy);
        expect(DB::table('notifications')->where('id', $id)->exists())->toBeTrue();
        $at = DB::table('notifications')->where('id', $id)->value('read_at');
        $this->clearTenantContext();

        return $at;
    };
});

it('marks only the alerts named, leaving the rest of the inbox unread', function () {
    $unpaid = ($this->alert)($this->academy, 'PACKAGE_UNPAID', 'PACKAGES');
    $low = ($this->alert)($this->academy, 'PACKAGE_LOW', 'PACKAGES');
    $report = ($this->alert)($this->academy, 'REPORT_OVERDUE', 'REPORTS');

    Sanctum::actingAs($this->owner);
    $this->postJson('/api/notifications/read-all', ['ids' => [$low, $report]])
        ->assertOk()
        ->assertJsonPath('marked', 2);

    expect(($this->readAt)($low))->not->toBeNull()
        ->and(($this->readAt)($report))->not->toBeNull()
        ->and(($this->readAt)($unpaid))->toBeNull();
});

it('never reaches another academy\'s alert, even by its id', function () {
    $theirs = ($this->alert)($this->other, 'PACKAGE_LOW', 'PACKAGES');

    Sanctum::actingAs($this->owner);
    $this->postJson('/api/notifications/read-all', ['ids' => [$theirs]])
        ->assertOk()
        ->assertJsonPath('marked', 0);

    expect(($this->readAt)($theirs, $this->other))->toBeNull();
});

it('marks nothing for an empty list, rather than everything', function () {
    $low = ($this->alert)($this->academy, 'PACKAGE_LOW', 'PACKAGES');

    Sanctum::actingAs($this->owner);
    $this->postJson('/api/notifications/read-all', ['ids' => []])->assertOk()->assertJsonPath('marked', 0);

    expect(($this->readAt)($low))->toBeNull();
});

it('refuses ids that are not ids', function () {
    Sanctum::actingAs($this->owner);
    $this->postJson('/api/notifications/read-all', ['ids' => ['nope']])->assertUnprocessable();
});

it('marks a whole section by type, past the rows the page loaded, and never the logs', function () {
    // More than the 200 the list returns: a section's "mark all read" must still clear every one.
    $reports = [];
    for ($i = 0; $i < 205; $i++) {
        $reports[] = ($this->alert)($this->academy, 'REPORT_OVERDUE', 'REPORTS');
    }
    $unpaid = ($this->alert)($this->academy, 'PACKAGE_UNPAID', 'PACKAGES');
    $attended = ($this->alert)($this->academy, 'LESSON_ATTENDED', 'ATTENDED');
    $theirs = ($this->alert)($this->other, 'REPORT_OVERDUE', 'REPORTS');

    Sanctum::actingAs($this->owner);
    $this->postJson('/api/notifications/read-all', ['types' => ['REPORT_OVERDUE', 'PACKAGE_LOW', 'LESSON_ATTENDED']])
        ->assertOk()
        ->assertJsonPath('marked', 205);

    expect(($this->readAt)($reports[0]))->not->toBeNull()
        ->and(($this->readAt)($reports[204]))->not->toBeNull()
        // Another section, the log and another academy are left alone.
        ->and(($this->readAt)($unpaid))->toBeNull()
        ->and(($this->readAt)($attended))->toBeNull()
        ->and(($this->readAt)($theirs, $this->other))->toBeNull();
});
