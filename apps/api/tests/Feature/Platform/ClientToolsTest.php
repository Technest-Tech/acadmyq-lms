<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

// Super Admin → client page → Maintenance: the repair commands for one client, from its own page —
// look first, then apply — instead of an SSH session.

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();
    $this->admin = $this->makeUser(null, 'SUPER_ADMIN');
    $this->asSuperAdmin();
    $this->academy = $this->createAcademy(overrides: ['name' => 'Tools Academy']);

    // A student removed the old way: flagged deleted, with a lesson still waiting to be marked.
    $this->removedStudent = function (string $academyId): array {
        $student = $this->createStudent($academyId, overrides: ['full_name' => 'Long Gone']);
        $teacher = $this->createTeacher($academyId);
        $session = $this->createSession($academyId, $student, $teacher, [
            'status' => 'SCHEDULED', 'scheduled_at_utc' => now()->subDays(6),
        ]);
        $this->asAcademy($academyId);
        DB::table('students')->where('id', $student)->update(['deleted_at' => now()->subDays(10)]);
        $this->asSuperAdmin();

        return [$student, $session];
    };
});

it('is closed to everyone but the platform', function () {
    Sanctum::actingAs($this->makeUser($this->academy, 'ACADEMY_OWNER'));

    $this->getJson("/api/admin/clients/{$this->academy}/tools")->assertForbidden();
    $this->postJson("/api/admin/clients/{$this->academy}/tools/finish_removals", ['apply' => true])->assertForbidden();
});

it('offers a Quran academy the general tools, and a centre its own as well', function () {
    Sanctum::actingAs($this->admin);

    $res = $this->getJson("/api/admin/clients/{$this->academy}/tools")->assertOk()->assertJsonPath('runnable', true);
    expect(array_column($res->json('tools'), 'key'))->toBe(['generate_lessons', 'finish_removals', 'restore_half_undone']);
    expect(collect($res->json('tools'))->firstWhere('key', 'generate_lessons')['preview'])->toBeFalse()
        ->and(collect($res->json('tools'))->firstWhere('key', 'finish_removals')['preview'])->toBeTrue();

    $this->asSuperAdmin();
    $centre = $this->createAcademy();
    $this->asAcademy($centre);
    DB::table('module_subscriptions')->where('academy_id', $centre)->where('module', 'MANAGEMENT')
        ->update(['overrides' => json_encode(['enabled' => ['centre']])]);
    $this->asSuperAdmin();

    $keys = array_column($this->getJson("/api/admin/clients/{$centre}/tools")->assertOk()->json('tools'), 'key');
    expect($keys)->toBe(['generate_lessons', 'finish_removals', 'restore_half_undone', 'clear_deleted_dues']);
    $this->postJson("/api/admin/clients/{$centre}/tools/clear_deleted_dues", ['apply' => false])
        ->assertOk()->assertJsonPath('applied', false);

    // A centre-only tool is not runnable against anyone else, even by name.
    $this->postJson("/api/admin/clients/{$this->academy}/tools/clear_deleted_dues", ['apply' => false])->assertNotFound();
});

it('lists what a tool would do without changing anything, then applies it', function () {
    [, $session] = ($this->removedStudent)($this->academy);
    Sanctum::actingAs($this->admin);

    // Look first.
    $preview = $this->postJson("/api/admin/clients/{$this->academy}/tools/finish_removals", ['apply' => false])
        ->assertOk()->assertJsonPath('ok', true)->assertJsonPath('applied', false);
    expect($preview->json('output'))->toContain('Long Gone')->toContain('run again with --apply');

    $this->asAcademy($this->academy);
    expect(DB::table('sessions')->where('id', $session)->value('status'))->toBe('SCHEDULED');
    $this->asSuperAdmin();
    expect(DB::table('audit_log')->where('action', 'client.tool_run')->exists())->toBeFalse();

    // Then apply.
    $applied = $this->postJson("/api/admin/clients/{$this->academy}/tools/finish_removals", ['apply' => true])
        ->assertOk()->assertJsonPath('ok', true)->assertJsonPath('applied', true);
    expect($applied->json('output'))->toContain('wound down');

    $this->asAcademy($this->academy);
    $row = DB::table('sessions')->where('id', $session)->first();
    expect($row->status)->not->toBe('SCHEDULED')
        ->and($row->hidden_at)->not->toBeNull();

    // Recorded under the admin who pressed it, on this client.
    $audit = DB::table('audit_log')->where('action', 'client.tool_run')->where('academy_id', $this->academy)->first();
    expect($audit)->not->toBeNull()
        ->and((string) $audit->actor_user_id)->toBe((string) $this->admin->id)
        ->and(json_decode((string) $audit->after, true)['tool'])->toBe('finish_removals');
});

it('touches only the client it was run for', function () {
    $other = $this->createAcademy(overrides: ['name' => 'Other Academy']);
    [, $otherSession] = ($this->removedStudent)($other);
    ($this->removedStudent)($this->academy);
    Sanctum::actingAs($this->admin);

    $res = $this->postJson("/api/admin/clients/{$this->academy}/tools/finish_removals", ['apply' => true])->assertOk();
    expect($res->json('output'))->toContain('Tools Academy')->not->toContain('Other Academy');

    $this->asAcademy($other);
    expect(DB::table('sessions')->where('id', $otherSession)->value('status'))->toBe('SCHEDULED');
});

it('rolls the lessons forward for one client without passing for the nightly roll', function () {
    Cache::put('scheduler.last_roll_at', '2026-11-01T00:30:00+00:00');
    Sanctum::actingAs($this->admin);

    // Nothing to preview: asking it to "only list" is refused rather than run for real.
    $this->postJson("/api/admin/clients/{$this->academy}/tools/generate_lessons", ['apply' => false])->assertStatus(422);

    $res = $this->postJson("/api/admin/clients/{$this->academy}/tools/generate_lessons", ['apply' => true])
        ->assertOk()->assertJsonPath('ok', true);
    expect($res->json('output'))->toContain($this->academy)->toContain('Done (1 academy');

    // System health still reads the real nightly roll, not this manual run.
    expect(Cache::get('scheduler.last_roll_at'))->toBe('2026-11-01T00:30:00+00:00');
});

it('refuses an unknown tool, an unknown client, and a client that is not active', function () {
    Sanctum::actingAs($this->admin);

    $this->postJson("/api/admin/clients/{$this->academy}/tools/drop_everything", ['apply' => true])->assertNotFound();
    $this->postJson('/api/admin/clients/'.Str::uuid().'/tools/finish_removals', ['apply' => false])->assertNotFound();

    $this->asSuperAdmin();
    $suspended = $this->createAcademy(overrides: ['status' => 'SUSPENDED']);
    $this->getJson("/api/admin/clients/{$suspended}/tools")->assertOk()->assertJsonPath('runnable', false);
    $this->postJson("/api/admin/clients/{$suspended}/tools/finish_removals", ['apply' => false])->assertStatus(409);
});
