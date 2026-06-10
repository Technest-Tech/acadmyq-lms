<?php

declare(strict_types=1);

use App\Support\PermissionResolver;
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
    $this->A = $this->createAcademy();
    $this->owner = $this->makeUser($this->A, 'ACADEMY_OWNER');
    $this->teacherUser = $this->makeUser($this->A, 'TEACHER');
    $this->teacherId = $this->createTeacher($this->A, ['user_id' => $this->teacherUser->id]);

    // A CLOSED invoice ready to be marked paid (OPEN→CLOSED is a legal pre-step).
    [$this->invoiceId] = $this->createInvoice($this->A);
    $this->asAcademy($this->A);
    DB::table('invoices')->where('id', $this->invoiceId)->update(['status' => 'CLOSED']);
});

// ── TC-2.14 / AC-2.5: Teacher forcing mark-paid → 403, no write ──────────────
it('blocks a Teacher from invoice.mark_paid and performs no write', function () {
    Sanctum::actingAs($this->teacherUser);

    $this->postJson("/api/invoices/{$this->invoiceId}/mark-paid")->assertForbidden();

    $this->asAcademy($this->A);
    expect(DB::table('invoices')->where('id', $this->invoiceId)->value('status'))->toBe('CLOSED');
});

// ── TC-2.15 / AC-2.5: Owner is permitted (capability present) ────────────────
it('permits an Owner to invoice.mark_paid', function () {
    Sanctum::actingAs($this->owner);

    $this->postJson("/api/invoices/{$this->invoiceId}/mark-paid")->assertOk();

    $this->asAcademy($this->A);
    expect(DB::table('invoices')->where('id', $this->invoiceId)->value('status'))->toBe('PAID');
});

// ── TC-2.16 / §3.6: Teacher writes own session report; another's is blocked ──
it('lets a Teacher report on their own session but not another teacher\'s', function () {
    $student = $this->createStudent($this->A);
    $ownSession = $this->createSession($this->A, $student, $this->teacherId);

    $otherTeacher = $this->createTeacher($this->A);
    $otherSession = $this->createSession($this->A, $student, $otherTeacher);

    Sanctum::actingAs($this->teacherUser);

    // The report endpoint moved to PUT in Sprint 6 (§8); the teacher-scoping seam is unchanged.
    $this->putJson("/api/sessions/{$ownSession}/report", ['values' => ['notes' => 'ok']])->assertOk();
    $this->putJson("/api/sessions/{$otherSession}/report", ['values' => ['notes' => 'no']])->assertForbidden();
});

// ── TC-2.17 / AC-2.8: revoking a capability takes effect on the next request ─
it('revokes a capability immediately, without re-login', function () {
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/invoices/{$this->invoiceId}/mark-paid")->assertOk();

    // Revoke ACADEMY_OWNER → invoice.mark_paid (a pure data change, super-admin context).
    $this->asSuperAdmin();
    $permId = DB::table('permissions')->where('code', 'invoice.mark_paid')->value('id');
    DB::table('role_permissions')->where('role', 'ACADEMY_OWNER')->where('permission_id', $permId)->delete();

    // Same session, next request → now forbidden.
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/invoices/{$this->invoiceId}/mark-paid")->assertForbidden();
});

// ── TC-2.18 / Master Spec §4: capabilities are data, not code ────────────────
it('grants a newly-mapped capability with no code change', function () {
    // TEACHER does not have student.create by default…
    expect(PermissionResolver::forRole('TEACHER'))->not->toContain('student.create');

    // …map it (data change) and the resolved set reflects it on the next resolution.
    $this->asSuperAdmin();
    $permId = DB::table('permissions')->where('code', 'student.create')->value('id');
    DB::table('role_permissions')->insert(['role' => 'TEACHER', 'permission_id' => $permId]);

    expect(PermissionResolver::forRole('TEACHER'))->toContain('student.create');

    Sanctum::actingAs($this->teacherUser);
    $this->getJson('/api/auth/me')
        ->assertOk()
        ->assertJsonFragment(['role' => 'TEACHER']);
    expect($this->getJson('/api/auth/me')->json('permissions'))->toContain('student.create');
});
