<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();
    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-audit@test.local']);
});

function peopleAuditExists(string $action, string $entityId, string $actor): bool
{
    test()->asAcademy(test()->academy);

    return DB::table('audit_log')
        ->where('action', $action)
        ->where('entity_id', $entityId)
        ->where('actor_user_id', $actor)
        ->exists();
}

// ── TC-4.29 / AC-4.4: create/update/deactivate of each entity is audited ─────
it('writes a correctly-attributed audit entry for each people mutation', function () {
    Sanctum::actingAs($this->owner);

    // Guardian: create, update, deactivate.
    $g = $this->postJson('/api/guardians', ['full_name' => 'G', 'whatsapp_phone' => '+201000000029'])->json('guardianId');
    $this->patchJson("/api/guardians/{$g}", ['full_name' => 'G2'])->assertOk();
    expect(peopleAuditExists('guardian.create', $g, $this->owner->id))->toBeTrue();
    expect(peopleAuditExists('guardian.update', $g, $this->owner->id))->toBeTrue();

    // Teacher: create, update, deactivate.
    Sanctum::actingAs($this->owner);
    $t = $this->postJson('/api/teachers', ['full_name' => 'T', 'session_rate_minor' => 5000, 'currency' => 'EGP'])->json('teacherId');
    $this->patchJson("/api/teachers/{$t}", ['specialization' => 'Hifz'])->assertOk();
    $this->postJson("/api/teachers/{$t}/deactivate")->assertOk();
    expect(peopleAuditExists('teacher.create', $t, $this->owner->id))->toBeTrue();
    expect(peopleAuditExists('teacher.update', $t, $this->owner->id))->toBeTrue();
    expect(peopleAuditExists('teacher.deactivate', $t, $this->owner->id))->toBeTrue();

    // Student: create, update, deactivate.
    Sanctum::actingAs($this->owner);
    $s = $this->postJson('/api/students', ['full_name' => 'S', 'guardian_id' => $g])->json('studentId');
    $this->patchJson("/api/students/{$s}", ['status' => 'ADVANCED'])->assertOk();
    $this->postJson("/api/students/{$s}/deactivate")->assertOk();
    expect(peopleAuditExists('student.create', $s, $this->owner->id))->toBeTrue();
    expect(peopleAuditExists('student.update', $s, $this->owner->id))->toBeTrue();
    expect(peopleAuditExists('student.deactivate', $s, $this->owner->id))->toBeTrue();

    // Now the guardian (no active children left) can be deactivated and audited.
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/guardians/{$g}/deactivate")->assertOk();
    expect(peopleAuditExists('guardian.deactivate', $g, $this->owner->id))->toBeTrue();
});

// ── TC-4.30 / AC-4.4: price change and reassignment audits carry before/after ─
it('records before/after detail for a price change and a teacher reassignment', function () {
    Sanctum::actingAs($this->owner);
    $g = $this->postJson('/api/guardians', ['full_name' => 'G', 'whatsapp_phone' => '+201000000030'])->json('guardianId');
    $teacher1 = $this->postJson('/api/teachers', ['full_name' => 'T1', 'session_rate_minor' => 5000, 'currency' => 'EGP'])->json('teacherId');
    $teacher2 = $this->postJson('/api/teachers', ['full_name' => 'T2', 'session_rate_minor' => 5000, 'currency' => 'EGP'])->json('teacherId');
    $s = $this->postJson('/api/students', [
        'full_name' => 'S', 'guardian_id' => $g, 'teacher_id' => $teacher1,
        'subscription' => ['plan_label' => 'p', 'price_minor' => 10000, 'currency' => 'EGP', 'price_basis' => 'PER_SESSION', 'start_date' => '2026-06-01'],
    ])->json('studentId');

    $this->patchJson("/api/students/{$s}/subscription/price", ['price_minor' => 15000])->assertOk();
    $this->postJson("/api/students/{$s}/teacher", ['teacher_id' => $teacher2])->assertOk();

    $this->asAcademy($this->academy);
    $price = DB::table('audit_log')->where('action', 'subscription.price_changed')->latest('created_at')->first();
    expect(json_decode($price->before, true)['price_minor'])->toBe(10000);
    expect(json_decode($price->after, true)['price_minor'])->toBe(15000);

    $reassign = DB::table('audit_log')->where('action', 'student.teacher_reassigned')->where('entity_id', $s)
        ->whereRaw("after->>'teacher_id' = ?", [$teacher2])->first();
    expect(json_decode($reassign->before, true)['teacher_id'])->toBe($teacher1);
    expect(json_decode($reassign->after, true)['teacher_id'])->toBe($teacher2);
});
