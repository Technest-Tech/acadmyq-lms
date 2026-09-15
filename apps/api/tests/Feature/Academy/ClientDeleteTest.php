<?php

declare(strict_types=1);

use App\Support\Audit;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

// DELETE /admin/clients/{id} — the one hard delete: the client and every row it owns, name-confirmed.

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();
    $this->admin = $this->makeUser(null, 'SUPER_ADMIN');

    $this->doomed = $this->createAcademy(overrides: ['name' => 'Doomed Academy']);
    $this->bystander = $this->createAcademy(overrides: ['name' => 'Bystander Academy']);
});

/**
 * The history an academy piles up — including the two things the database guards hardest: a
 * finalized payout (its lines may never be removed) and a closed invoice. Returns the owner.
 */
function cdHistory(object $test, string $aid): object
{
    // Bound to the test case so its protected fixture helpers are reachable.
    return (function () use ($aid): object {
        $owner = $this->makeUser($aid, 'ACADEMY_OWNER');
        $guardian = $this->createGuardian($aid);
        $student = $this->createStudent($aid, $guardian);
        $teacher = $this->createTeacher($aid);

        $this->asAcademy($aid);
        $now = now();
        $scheduleId = (string) Str::uuid();
        DB::table('schedules')->insert(['id' => $scheduleId, 'academy_id' => $aid, 'student_id' => $student, 'teacher_id' => $teacher, 'timezone' => 'Africa/Cairo', 'created_at' => $now, 'updated_at' => $now]);
        $slotId = (string) Str::uuid();
        DB::table('schedule_slots')->insert(['id' => $slotId, 'academy_id' => $aid, 'schedule_id' => $scheduleId, 'weekday' => 1, 'start_time_local' => '17:00', 'created_at' => $now, 'updated_at' => $now]);
        $sessionId = (string) Str::uuid();
        DB::table('sessions')->insert(['id' => $sessionId, 'academy_id' => $aid, 'student_id' => $student, 'teacher_id' => $teacher, 'schedule_id' => $scheduleId, 'slot_id' => $slotId, 'scheduled_at_utc' => $now, 'duration_minutes' => 60, 'created_at' => $now, 'updated_at' => $now]);
        DB::table('session_reports')->insert(['id' => (string) Str::uuid(), 'academy_id' => $aid, 'session_id' => $sessionId, 'created_at' => $now, 'updated_at' => $now]);

        $payoutId = (string) Str::uuid();
        DB::table('payouts')->insert(['id' => $payoutId, 'academy_id' => $aid, 'teacher_id' => $teacher, 'period_year' => 2026, 'period_month' => 6, 'currency' => 'EGP', 'created_at' => $now, 'updated_at' => $now]);
        DB::table('payout_line_items')->insert(['id' => (string) Str::uuid(), 'academy_id' => $aid, 'payout_id' => $payoutId, 'session_id' => $sessionId, 'amount_minor' => 8000, 'currency' => 'EGP', 'created_at' => $now]);
        DB::table('payouts')->where('id', $payoutId)->update(['finalized_at' => $now]);

        [$invoiceId] = $this->createInvoice($aid, $guardian);
        DB::table('invoice_line_items')->insert(['id' => (string) Str::uuid(), 'academy_id' => $aid, 'invoice_id' => $invoiceId, 'session_id' => $sessionId, 'student_id' => $student, 'description' => 'Session', 'amount_minor' => 8000, 'currency' => 'EGP', 'created_at' => $now]);
        DB::table('invoices')->where('id', $invoiceId)->update(['status' => 'CLOSED']);

        DB::table('trials')->insert(['id' => (string) Str::uuid(), 'academy_id' => $aid, 'teacher_id' => $teacher, 'student_id' => $student, 'timezone' => 'Africa/Cairo', 'scheduled_at_utc' => $now, 'duration_minutes' => 30, 'status' => 'SCHEDULED', 'created_at' => $now, 'updated_at' => $now]);

        Audit::log('student.create', 'student', $student, $aid, $owner->id, 'ACADEMY_OWNER');
        $this->clearTenantContext();

        return $owner;
    })->call($test);
}

/** Rows still carrying $aid, table by table — read as super admin inside that academy. */
function cdLeftovers(object $test, string $aid): array
{
    (fn () => $this->enterAcademyAsSuperAdmin($aid))->call($test);
    $tables = DB::select("select c.relname from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attname = 'academy_id' where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'");

    $left = [];
    foreach ($tables as $t) {
        $n = DB::table($t->relname)->where('academy_id', $aid)->count();
        if ($n > 0) {
            $left[$t->relname] = $n;
        }
    }
    (fn () => $this->clearTenantContext())->call($test);

    return $left;
}

it('wipes the client and everything it owns, and nothing of anyone else', function () {
    $owner = cdHistory($this, $this->doomed);
    cdHistory($this, $this->bystander);
    $owner->createToken('device');

    // The platform's own record of something this owner did survives, without the name.
    $this->asSuperAdmin();
    Audit::log('auth.login', 'user', $owner->id, null, $owner->id, 'ACADEMY_OWNER');
    $this->clearTenantContext();

    $bystanderBefore = cdLeftovers($this, $this->bystander);

    Storage::fake('local');
    Storage::disk('local')->put("academy-logos/{$this->doomed}/logo.png", 'x');
    Storage::disk('local')->put("academy-logos/{$this->bystander}/logo.png", 'x');

    Sanctum::actingAs($this->admin);
    $res = $this->deleteJson("/api/admin/clients/{$this->doomed}", ['confirm_name' => 'Doomed Academy'])->assertOk();
    expect($res->json('deleted.sessions'))->toBe(1);

    expect(cdLeftovers($this, $this->doomed))->toBe([]);
    // Files go once the rows are committed — only this client's.
    Storage::disk('local')->assertMissing("academy-logos/{$this->doomed}/logo.png");
    Storage::disk('local')->assertExists("academy-logos/{$this->bystander}/logo.png");
    expect(cdLeftovers($this, $this->bystander))->toBe($bystanderBefore);

    $this->asSuperAdmin();
    expect(DB::table('academies')->where('id', $this->doomed)->exists())->toBeFalse();
    expect(DB::table('academies')->where('id', $this->bystander)->exists())->toBeTrue();
    expect(DB::table('personal_access_tokens')->where('tokenable_id', $owner->id)->exists())->toBeFalse();

    $login = DB::table('audit_log')->where('action', 'auth.login')->where('entity_id', $owner->id)->first();
    expect($login)->not->toBeNull();
    expect($login->actor_user_id)->toBeNull();

    // Who deleted what outlives the client.
    $entry = DB::table('audit_log')->where('action', 'client.deleted')->where('entity_id', $this->doomed)->first();
    expect($entry)->not->toBeNull();
    expect($entry->academy_id)->toBeNull();
    expect($entry->actor_user_id)->toBe($this->admin->id);
    expect(json_decode($entry->before, true)['name'])->toBe('Doomed Academy');

    // The client is gone from the directory; the purge guard stood aside only for that academy.
    Sanctum::actingAs($this->admin);
    $this->getJson("/api/admin/clients/{$this->doomed}")->assertNotFound();
});

it('refuses without the exact client name, and deletes nothing', function () {
    cdHistory($this, $this->doomed);
    Sanctum::actingAs($this->admin);

    $this->deleteJson("/api/admin/clients/{$this->doomed}", [])->assertStatus(422);
    $this->deleteJson("/api/admin/clients/{$this->doomed}", ['confirm_name' => 'doomed academy'])
        ->assertStatus(422)
        ->assertJsonValidationErrors('confirm_name');

    $this->asSuperAdmin();
    expect(DB::table('academies')->where('id', $this->doomed)->exists())->toBeTrue();
    expect(cdLeftovers($this, $this->doomed))->not->toBe([]);
});

it('is super-admin only', function () {
    $owner = cdHistory($this, $this->doomed);
    Sanctum::actingAs($owner);

    $this->deleteJson("/api/admin/clients/{$this->doomed}", ['confirm_name' => 'Doomed Academy'])->assertForbidden();

    $this->asSuperAdmin();
    expect(DB::table('academies')->where('id', $this->doomed)->exists())->toBeTrue();
});

it('404s for a client that does not exist', function () {
    Sanctum::actingAs($this->admin);

    $this->deleteJson('/api/admin/clients/'.Str::uuid(), ['confirm_name' => 'x'])->assertNotFound();
});

it('keeps finalized payouts immutable outside a purge', function () {
    cdHistory($this, $this->doomed);
    $this->asAcademy($this->doomed);

    expect(fn () => DB::table('payout_line_items')->where('academy_id', $this->doomed)->delete())
        ->toThrow(QueryException::class, 'finalized payout');
});
