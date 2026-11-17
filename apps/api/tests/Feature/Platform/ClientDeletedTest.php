<?php

declare(strict_types=1);

use App\Services\SubscriptionBilling;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

// Super Admin → client page → Deleted: everything a client deleted, and restoring it as it was —
// the SpeakUp case of 2026-11-16 (an owner deleted 13 families by mistake) without a hand-written script.

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();
    $this->admin = $this->makeUser(null, 'SUPER_ADMIN');
    $this->academy = $this->createAcademy(overrides: ['name' => 'Bin Academy', 'default_currency' => 'EGP']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-bin-'.uniqid().'@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'Ms Fatima']);

    // A family whose child has a teacher, a monthly subscription, a group place, a centre block with
    // its bill, a past lesson nobody marked and an attended one.
    $this->guardian = $this->createGuardian($this->academy, ['full_name' => 'Waleed Arafat']);
    $this->student = $this->createStudent($this->academy, $this->guardian, ['full_name' => 'Jawad']);
    $this->asAcademy($this->academy);
    DB::table('student_teacher_assignments')->insert(['id' => (string) Str::uuid(), 'academy_id' => $this->academy,
        'student_id' => $this->student, 'teacher_id' => $this->teacher, 'started_at' => now()->subMonth()]);
    $this->subscription = (string) Str::uuid();
    DB::table('subscriptions')->insert(['id' => $this->subscription, 'academy_id' => $this->academy, 'student_id' => $this->student,
        'plan_label' => 'Monthly', 'price_minor' => 20000, 'currency' => 'EGP', 'price_basis' => 'PER_SESSION', 'status' => 'ACTIVE', 'start_date' => '2026-01-01']);
    $this->group = (string) Str::uuid();
    DB::table('class_groups')->insert(['id' => $this->group, 'academy_id' => $this->academy, 'name' => 'English.6',
        'teacher_id' => $this->teacher, 'timezone' => 'Africa/Cairo', 'start_date' => '2026-05-01']);
    DB::table('class_group_members')->insert(['id' => (string) Str::uuid(), 'academy_id' => $this->academy, 'group_id' => $this->group,
        'student_id' => $this->student, 'joined_on' => '2026-05-01', 'status' => 'ACTIVE']);
    $this->block = (string) Str::uuid();
    DB::table('centre_subscriptions')->insert(['id' => $this->block, 'academy_id' => $this->academy, 'student_id' => $this->student,
        'teacher_id' => $this->teacher, 'course' => 'English', 'label' => 'Jawad private class', 'lessons_sold' => 8, 'lesson_price_minor' => 2500,
        'price_minor' => 20000, 'currency' => 'EGP', 'starts_on' => now()->toDateString(), 'status' => 'OPEN', 'sequence_no' => 1]);
    app(SubscriptionBilling::class)->raise(DB::table('centre_subscriptions')->where('id', $this->block)->first(),
        DB::table('academies')->where('id', $this->academy)->first(), null, 'ACADEMY_OWNER');
    $this->firstBill = (string) DB::table('centre_subscriptions')->where('id', $this->block)->value('invoice_id');
    $this->unmarked = $this->createSession($this->academy, $this->student, $this->teacher, ['status' => 'SCHEDULED', 'scheduled_at_utc' => now()->subDays(2)]);
    $this->attended = $this->createSession($this->academy, $this->student, $this->teacher, ['status' => 'ATTENDED', 'scheduled_at_utc' => now()->subDays(5)]);
    $this->clearTenantContext();

    $this->deleteFamily = function (): void {
        Sanctum::actingAs($this->owner);
        $this->deleteJson("/api/guardians/{$this->guardian}", ['with_children' => true])->assertOk();
        $this->clearTenantContext();
    };
});

it('is closed to everyone but the platform', function () {
    Sanctum::actingAs($this->owner);

    $this->getJson("/api/admin/clients/{$this->academy}/deleted")->assertForbidden();
    $this->postJson("/api/admin/clients/{$this->academy}/deleted/family/{$this->guardian}/restore", ['apply' => true])->assertForbidden();
});

it('lists a deleted family with its children and who deleted it, and keeps other clients out', function () {
    ($this->deleteFamily)();
    Sanctum::actingAs($this->admin);

    $res = $this->getJson("/api/admin/clients/{$this->academy}/deleted")->assertOk();
    $family = collect($res->json('items'))->firstWhere('kind', 'family');
    expect($family['id'])->toBe($this->guardian)
        ->and($family['label'])->toBe('Waleed Arafat')
        ->and($family['detail']['children'])->toBe(['Jawad'])
        ->and($family['deleted_by'])->not->toBeNull()
        // The child is restored with the family, not listed twice.
        ->and(collect($res->json('items'))->where('kind', 'student')->pluck('id'))->not->toContain($this->student);

    $this->asSuperAdmin();
    $other = $this->createAcademy();
    $this->clearTenantContext();
    expect($this->getJson("/api/admin/clients/{$other}/deleted")->assertOk()->json('items'))->toBe([]);
    $this->postJson("/api/admin/clients/{$other}/deleted/family/{$this->guardian}/restore", ['apply' => true])->assertNotFound();
});

it('previews a family restore without keeping anything, then brings everything back', function () {
    ($this->deleteFamily)();
    Sanctum::actingAs($this->admin);
    $url = "/api/admin/clients/{$this->academy}/deleted/family/{$this->guardian}/restore";

    $preview = $this->postJson($url, ['apply' => false])->assertOk()->assertJsonPath('applied', false);
    $keys = collect($preview->json('done'))->pluck('key')->all();
    expect($keys)->toContain('family', 'student', 'subscription', 'teacher', 'group', 'block_rebilled', 'lessons_reopened', 'lessons_shown');

    $this->asAcademy($this->academy);
    expect(DB::table('students')->where('id', $this->student)->value('deleted_at'))->not->toBeNull()
        ->and(DB::table('guardians')->where('id', $this->guardian)->value('deleted_at'))->not->toBeNull();
    $this->clearTenantContext();

    $this->postJson($url, ['apply' => true])->assertOk()->assertJsonPath('applied', true);

    $this->asAcademy($this->academy);
    expect(DB::table('guardians')->where('id', $this->guardian)->value('deleted_at'))->toBeNull()
        ->and(DB::table('students')->where('id', $this->student)->value('deleted_at'))->toBeNull()
        ->and(DB::table('subscriptions')->where('id', $this->subscription)->value('status'))->toBe('ACTIVE')
        ->and(DB::table('student_teacher_assignments')->where('student_id', $this->student)->whereNull('ended_at')->count())->toBe(1)
        ->and(DB::table('class_group_members')->where('student_id', $this->student)->value('status'))->toBe('ACTIVE')
        ->and(DB::table('sessions')->where('id', $this->unmarked)->value('status'))->toBe('SCHEDULED')
        ->and(DB::table('sessions')->where('student_id', $this->student)->whereNotNull('hidden_at')->count())->toBe(0);

    // The block is open again on a NEW bill of the same amount; the voided one stays voided.
    $block = DB::table('centre_subscriptions')->where('id', $this->block)->first();
    expect($block->status)->toBe('OPEN')
        ->and($block->invoice_id)->not->toBe($this->firstBill)
        ->and(DB::table('invoices')->where('id', $this->firstBill)->value('status'))->toBe('VOID')
        ->and((int) DB::table('invoices')->where('id', $block->invoice_id)->value('total_minor'))->toBe(20000)
        ->and(DB::table('invoices')->where('id', $block->invoice_id)->value('status'))->toBe('OPEN');

    // The "former parent" lead the delete made is gone; the restore is on the record.
    expect(DB::table('crm_leads')->where('full_name', 'Waleed Arafat')->whereNull('deleted_at')->count())->toBe(0)
        ->and(DB::table('audit_log')->where('action', 'client.restore')->where('entity_id', $this->academy)->exists())->toBeTrue()
        ->and(DB::table('audit_log')->where('action', 'student.restored')->where('entity_id', $this->student)->exists())->toBeTrue();
    $this->clearTenantContext();

    // Nothing left to restore.
    $this->postJson($url, ['apply' => true])->assertNotFound();
    expect(collect($this->getJson("/api/admin/clients/{$this->academy}/deleted")->json('items'))->pluck('id'))->not->toContain($this->guardian);
});

it('restores a student deleted on their own, and leaves a lesson deleted on its own hidden', function () {
    Sanctum::actingAs($this->owner);
    $this->deleteJson("/api/sessions/{$this->attended}")->assertOk();
    $this->deleteJson("/api/students/{$this->student}")->assertOk();
    $this->clearTenantContext();

    Sanctum::actingAs($this->admin);
    $item = collect($this->getJson("/api/admin/clients/{$this->academy}/deleted")->json('items'))->firstWhere('kind', 'student');
    expect($item['id'])->toBe($this->student)->and($item['detail']['guardian'])->toBe('Waleed Arafat');

    $this->postJson("/api/admin/clients/{$this->academy}/deleted/student/{$this->student}/restore", ['apply' => true])->assertOk();

    $this->asAcademy($this->academy);
    expect(DB::table('students')->where('id', $this->student)->value('deleted_at'))->toBeNull()
        ->and(DB::table('sessions')->where('id', $this->attended)->value('hidden_at'))->not->toBeNull()
        ->and(DB::table('sessions')->where('id', $this->unmarked)->value('hidden_at'))->toBeNull();
});

it('restores a deactivated teacher with their sign-in, and logs a permanent delete it cannot undo', function () {
    $user = $this->makeUser($this->academy, 'TEACHER', ['email' => 'gone-teacher-'.uniqid().'@test.local']);
    $other = $this->createTeacher($this->academy, ['full_name' => 'Ms Noha', 'user_id' => $user->id]);
    $doomed = $this->createTeacher($this->academy, ['full_name' => 'Mr Gone']);

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/teachers/{$other}/deactivate")->assertOk();
    $this->asAcademy($this->academy);
    expect((bool) DB::table('users')->where('id', $user->id)->value('is_active'))->toBeFalse();
    $this->clearTenantContext();
    $this->deleteJson("/api/teachers/{$doomed}")->assertOk();
    $this->clearTenantContext();

    Sanctum::actingAs($this->admin);
    $res = $this->getJson("/api/admin/clients/{$this->academy}/deleted")->assertOk();
    expect(collect($res->json('items'))->firstWhere('kind', 'teacher')['label'])->toBe('Ms Noha')
        ->and(collect($res->json('log'))->firstWhere('action', 'teacher.delete')['label'])->toBe('Mr Gone');

    $this->postJson("/api/admin/clients/{$this->academy}/deleted/teacher/{$other}/restore", ['apply' => true])
        ->assertOk()->assertJsonPath('done.1.key', 'login');

    $this->asAcademy($this->academy);
    expect(DB::table('teachers')->where('id', $other)->value('deleted_at'))->toBeNull()
        ->and((bool) DB::table('users')->where('id', $user->id)->value('is_active'))->toBeTrue();
});

it('refuses a kind it does not know', function () {
    Sanctum::actingAs($this->admin);
    $this->postJson("/api/admin/clients/{$this->academy}/deleted/invoice/{$this->firstBill}/restore", ['apply' => true])->assertNotFound();
});
