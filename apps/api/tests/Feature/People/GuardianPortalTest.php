<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesReportFields;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class, CreatesReportFields::class);

/**
 * The parent's page (`/p/{token}`): one private link per family that shows the children, their
 * lessons, their reports and the family's bills. Pinned here:
 *   - the academy makes, replaces, switches off and WhatsApps the link; replacing kills the old one;
 *   - the parent sees their OWN children only — no other family, no other academy, no phone numbers;
 *   - only news: an unmarked, hidden or rescheduled lesson, an unapproved report and a void bill stay out;
 *   - a group lesson reads like a private one, on the dates the child was in the group;
 *   - every miss is the same 404.
 */
beforeEach(function () {
    // Wednesday 17 June 2026, 12:00 Cairo.
    Carbon::setTestNow('2026-06-17 09:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: ['name' => 'Nour Academy', 'default_currency' => 'EGP', 'timezone' => 'Africa/Cairo', 'invoice_grouping' => 'PER_GUARDIAN']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-portal@test.local']);
    $this->teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-portal@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'Miss Mona', 'user_id' => $this->teacherUser->getKey()]);

    $this->parent = $this->createGuardian($this->academy, ['full_name' => 'Umm Adam', 'whatsapp_phone' => '+201001112223']);
    $this->adam = $this->createStudent($this->academy, $this->parent, ['full_name' => 'Adam', 'whatsapp_phone' => '+201009998887']);
    $this->sara = $this->createStudent($this->academy, $this->parent, ['full_name' => 'Sara']);

    // Another family in the same academy, and another academy altogether.
    $this->otherParent = $this->createGuardian($this->academy, ['full_name' => 'Other Family']);
    $this->dina = $this->createStudent($this->academy, $this->otherParent, ['full_name' => 'Dina']);
    $this->otherAcademy = $this->createAcademy(overrides: ['name' => 'Elsewhere Academy']);
    $this->stranger = $this->createGuardian($this->otherAcademy, ['full_name' => 'Stranger Parent']);
    $this->clearTenantContext();
});

afterEach(fn () => Carbon::setTestNow());

/** No tenant context at all (InteractsWithTenancy::clearTenantContext, callable from a helper). */
function portalNoContext(): void
{
    foreach (['app.current_academy_id', 'app.current_role', 'app.current_user_id'] as $guc) {
        DB::statement('select set_config(?, \'\', true)', [$guc]);
    }
}

/** Make the family's link as the owner and return its token. */
function portalToken($test, ?string $guardianId = null): string
{
    Sanctum::actingAs($test->owner);
    $url = $test->postJson('/api/guardians/'.($guardianId ?? $test->parent).'/portal')->assertOk()->json('url');
    portalNoContext();

    return substr((string) $url, strrpos((string) $url, '/p/') + 3);
}

/** The public page, fetched with no tenant context — as a parent's phone would. */
function portalPage($test, string $token)
{
    portalNoContext();

    return $test->getJson("/api/p/{$token}");
}

// ── The link ─────────────────────────────────────────────────────────────────

it('makes one long private link per family, replaces it on demand and switches it off', function () {
    Sanctum::actingAs($this->owner);

    $this->getJson("/api/guardians/{$this->parent}/portal")->assertOk()->assertJsonPath('url', null);

    $first = $this->postJson("/api/guardians/{$this->parent}/portal")->assertOk()->json('url');
    expect($first)->toMatch('#/p/[A-Za-z0-9]{48}$#');
    // Asking again does not change it — the link the family already has keeps working.
    expect($this->postJson("/api/guardians/{$this->parent}/portal")->json('url'))->toBe($first);
    expect($this->getJson("/api/guardians/{$this->parent}/portal")->json('url'))->toBe($first);

    $second = $this->postJson("/api/guardians/{$this->parent}/portal", ['rotate' => true])->assertOk()->json('url');
    expect($second)->not->toBe($first);
    $oldToken = substr($first, strrpos($first, '/p/') + 3);
    $newToken = substr($second, strrpos($second, '/p/') + 3);
    portalPage($this, $oldToken)->assertNotFound();
    portalPage($this, $newToken)->assertOk();

    Sanctum::actingAs($this->owner);
    $this->deleteJson("/api/guardians/{$this->parent}/portal")->assertOk()->assertJsonPath('url', null);
    portalPage($this, $newToken)->assertNotFound();

    // Every change to who can open the family's data is on the record.
    $this->asAcademy($this->academy);
    expect(DB::table('audit_log')->where('entity_id', $this->parent)->orderBy('created_at')->pluck('action')->all())
        ->toContain('guardian.portal_issued', 'guardian.portal_rotated', 'guardian.portal_revoked');
});

it('sends the link on WhatsApp, falling back to a wa.me message when the academy has no connection', function () {
    Sanctum::actingAs($this->owner);

    $res = $this->postJson("/api/guardians/{$this->parent}/portal/send")->assertOk();

    expect($res->json('sent'))->toBeFalse();
    expect($res->json('transport'))->toBe('DEEPLINK');
    expect($res->json('phone'))->toBe('+201001112223');
    expect($res->json('message'))->toContain($res->json('url'))->toContain('Umm Adam')->toContain('Nour Academy');
    // Sending made the link: the family page now shows the same one.
    expect($this->getJson("/api/guardians/{$this->parent}/portal")->json('url'))->toBe($res->json('url'));
});

it('lets only people who can edit the family make or send the link', function () {
    Sanctum::actingAs($this->teacherUser);

    $this->postJson("/api/guardians/{$this->parent}/portal")->assertForbidden();
    $this->postJson("/api/guardians/{$this->parent}/portal/send")->assertForbidden();
    $this->deleteJson("/api/guardians/{$this->parent}/portal")->assertForbidden();
});

it('answers every miss with the same 404 — unknown, inactive family', function () {
    $token = portalToken($this);

    $bodies = [];
    foreach (['0', 'abc', str_repeat('z', 48), (string) Str::uuid()] as $guess) {
        $res = portalPage($this, $guess)->assertNotFound();
        $bodies[] = $res->json('message');
    }
    expect(array_unique($bodies))->toHaveCount(1);

    // A family the academy deactivated loses the page until it is reactivated.
    $this->asAcademy($this->academy);
    DB::table('guardians')->where('id', $this->parent)->update(['deleted_at' => now()->toIso8601String()]);
    expect(portalPage($this, $token)->assertNotFound()->json('message'))->toBe($bodies[0]);

    $this->asAcademy($this->academy);
    DB::table('guardians')->where('id', $this->parent)->update(['deleted_at' => null]);
    portalPage($this, $token)->assertOk();
});

// ── What the parent sees ─────────────────────────────────────────────────────

it('shows the family its own children, lessons, reports and bills — and nothing else', function () {
    $this->seedReportFields($this->academy, [
        ['key' => 'surah', 'label_ar' => 'السورة', 'label_en' => 'Surah', 'field_type' => 'TEXT'],
        ['key' => 'stars', 'label_ar' => 'التقييم', 'label_en' => 'Rating', 'field_type' => 'RATING'],
        ['key' => 'notes', 'label_ar' => 'ملاحظات', 'label_en' => 'Notes', 'field_type' => 'TEXTAREA'],
    ]);

    // Tomorrow 17:00 Cairo — coming up.
    $next = $this->createSession($this->academy, $this->adam, $this->teacher, ['scheduled_at_utc' => '2026-06-18 14:00:00+00', 'status' => 'SCHEDULED', 'duration_minutes' => 45]);
    // Monday — attended, with a report (one answer left empty).
    $taken = $this->createSession($this->academy, $this->adam, $this->teacher, ['scheduled_at_utc' => '2026-06-15 14:00:00+00', 'status' => 'ATTENDED', 'duration_minutes' => 45]);
    DB::table('session_reports')->insert(['id' => (string) Str::uuid(), 'academy_id' => $this->academy, 'session_id' => $taken,
        'values' => json_encode(['surah' => 'Al-Mulk', 'stars' => 5, 'notes' => '  ']), 'filled_at' => '2026-06-15 15:00:00+00']);
    // Sara missed hers; one of Adam's was never marked; one was moved; one belongs to a removed
    // student's hidden history. Only Sara's absence is news.
    $missed = $this->createSession($this->academy, $this->sara, $this->teacher, ['scheduled_at_utc' => '2026-06-14 14:00:00+00', 'status' => 'ABSENT_UNEXCUSED']);
    $unmarked = $this->createSession($this->academy, $this->adam, $this->teacher, ['scheduled_at_utc' => '2026-06-16 14:00:00+00', 'status' => 'SCHEDULED']);
    $moved = $this->createSession($this->academy, $this->adam, $this->teacher, ['scheduled_at_utc' => '2026-06-13 14:00:00+00', 'status' => 'RESCHEDULED']);
    $hidden = $this->createSession($this->academy, $this->adam, $this->teacher, ['scheduled_at_utc' => '2026-06-12 14:00:00+00', 'status' => 'ATTENDED', 'hidden_at' => '2026-06-12 20:00:00+00']);
    // Another family's lesson.
    $theirs = $this->createSession($this->academy, $this->dina, $this->teacher, ['scheduled_at_utc' => '2026-06-18 15:00:00+00', 'status' => 'SCHEDULED']);

    // Monthly reports: an approved one shows, a pending draft does not.
    $this->asAcademy($this->academy);
    foreach ([['APPROVED', 'May progress'], ['PENDING', 'Draft not reviewed']] as [$status, $title]) {
        DB::table('student_progress_reports')->insert(['id' => (string) Str::uuid(), 'academy_id' => $this->academy, 'student_id' => $this->adam,
            'teacher_id' => $this->teacher, 'period_month' => '2026-05-01', 'title' => $title, 'body' => 'Memorised Juz Amma.', 'status' => $status]);
    }

    // Bills: May partly paid on the family; a package bill on Sara herself; a void one.
    $this->createInvoice($this->academy, $this->parent, ['period_month' => 5, 'status' => 'CLOSED', 'total_minor' => 60000, 'subtotal_minor' => 60000, 'amount_paid_minor' => 20000]);
    [$saraBill] = $this->createInvoice($this->academy, null, ['guardian_id' => null, 'student_id' => $this->sara, 'kind' => 'MANUAL', 'period_month' => 6, 'status' => 'OPEN', 'total_minor' => 30000, 'subtotal_minor' => 30000]);
    $this->asAcademy($this->academy);
    DB::table('invoice_line_items')->insert(['id' => (string) Str::uuid(), 'academy_id' => $this->academy, 'invoice_id' => $saraBill,
        'student_id' => $this->sara, 'description' => 'Package — 8 hours', 'amount_minor' => 30000, 'currency' => 'EGP']);
    $this->createInvoice($this->academy, $this->parent, ['period_month' => 4, 'status' => 'VOID', 'total_minor' => 99900, 'subtotal_minor' => 99900]);
    // Another family's bill.
    $this->createInvoice($this->academy, $this->otherParent, ['period_month' => 5, 'status' => 'CLOSED', 'total_minor' => 77700, 'subtotal_minor' => 77700]);

    $res = portalPage($this, portalToken($this))->assertOk();

    expect($res->headers->get('Cache-Control'))->toContain('no-store');
    expect($res->headers->get('X-Robots-Tag'))->toContain('noindex');

    expect($res->json('academy.name'))->toBe('Nour Academy');
    expect($res->json('guardian.name'))->toBe('Umm Adam');
    expect(collect($res->json('children'))->pluck('name')->all())->toBe(['Adam', 'Sara']);

    // Coming up: Adam's lesson tomorrow, never Dina's.
    expect(collect($res->json('upcoming'))->pluck('id')->all())->toBe([$next]);
    $res->assertJsonPath('upcoming.0.child_id', $this->adam)
        ->assertJsonPath('upcoming.0.teacher', 'Miss Mona')
        ->assertJsonPath('upcoming.0.duration_minutes', 45);
    $res->assertJsonPath('children.0.next_lesson.id', $next);

    // History: newest first, only decided lessons.
    $recent = collect($res->json('recent'));
    expect($recent->pluck('id')->all())->toBe([$taken, $missed]);
    expect($recent->pluck('id')->all())->not->toContain($unmarked, $moved, $hidden, $theirs);
    expect($recent[0]['status'])->toBe('ATTENDED');
    expect($recent[1]['status'])->toBe('ABSENT')->and($recent[1]['child_id'])->toBe($this->sara);
    // The report, in form order, the empty answer dropped.
    expect(collect($recent[0]['report'])->pluck('label_en')->all())->toBe(['Surah', 'Rating']);
    expect($recent[0]['report'][1])->toMatchArray(['type' => 'RATING', 'value' => '5']);
    expect($recent[1]['report'])->toBeNull();

    // This month: Adam attended one 45-minute lesson; Sara missed one.
    $res->assertJsonPath('children.0.month', ['attended' => 1, 'absent' => 0, 'minutes' => 45]);
    $res->assertJsonPath('children.1.month', ['attended' => 0, 'absent' => 1, 'minutes' => 0]);

    expect(collect($res->json('progress_reports'))->pluck('title')->all())->toBe(['May progress']);

    // Bills: the family's two live ones (void and other families' left out), newest first.
    $invoices = collect($res->json('invoices'));
    expect($invoices->pluck('total_minor')->all())->toBe([30000, 60000]);
    expect($invoices[0])->toMatchArray(['state' => 'UNPAID', 'due_minor' => 30000, 'title' => 'Package — 8 hours', 'child_name' => 'Sara']);
    expect($invoices[1])->toMatchArray(['state' => 'PARTIAL', 'paid_minor' => 20000, 'due_minor' => 40000]);
    expect($invoices[1]['url'])->toMatch('#/i/[A-Za-z0-9]+$#');
    $res->assertJsonPath('balance', [['currency' => 'EGP', 'due_minor' => 70000]]);

    // Nothing from anyone else, and no phone number of anyone.
    $body = $res->getContent();
    foreach (['Dina', 'Other Family', 'Stranger Parent', 'Elsewhere Academy', 'Draft not reviewed', '77700', '99900',
        '+201001112223', '+201009998887', $this->academy] as $needle) {
        expect($body)->not->toContain($needle);
    }
});

it('shows a group lesson like a private one, only on the dates the child was in the group', function () {
    $this->asAcademy($this->academy);
    $groupId = (string) Str::uuid();
    DB::table('class_groups')->insert(['id' => $groupId, 'academy_id' => $this->academy, 'name' => 'Tajweed Juniors',
        'teacher_id' => $this->teacher, 'timezone' => 'Africa/Cairo', 'start_date' => '2026-05-01']);
    // Sara joined on 10 June.
    DB::table('class_group_members')->insert(['id' => (string) Str::uuid(), 'academy_id' => $this->academy, 'group_id' => $groupId,
        'student_id' => $this->sara, 'joined_on' => '2026-06-10']);

    $lesson = function (string $date, string $at, string $status, array $extra = []) use ($groupId): string {
        $id = (string) Str::uuid();
        DB::table('class_group_lessons')->insert(array_merge(['id' => $id, 'academy_id' => $this->academy, 'group_id' => $groupId,
            'teacher_id' => $this->teacher, 'occurrence_local_date' => $date, 'scheduled_at_utc' => $at,
            'duration_minutes' => 60, 'status' => $status], $extra));

        return $id;
    };
    $beforeSara = $lesson('2026-06-08', '2026-06-08 15:00:00+00', 'HELD');
    $held = $lesson('2026-06-15', '2026-06-15 15:00:00+00', 'HELD', ['topic' => 'Noon sakinah', 'homework' => 'Revise page 4', 'notes' => 'Staff-only remark']);
    DB::table('class_group_attendance')->insert(['id' => (string) Str::uuid(), 'academy_id' => $this->academy, 'lesson_id' => $held,
        'group_id' => $groupId, 'student_id' => $this->sara, 'status' => 'LATE', 'note' => 'Private teacher note']);
    $coming = $lesson('2026-06-22', '2026-06-22 15:00:00+00', 'SCHEDULED');
    $this->clearTenantContext();

    $res = portalPage($this, portalToken($this))->assertOk();

    expect(collect($res->json('upcoming'))->pluck('id')->all())->toBe([$coming]);
    $res->assertJsonPath('upcoming.0.kind', 'GROUP')->assertJsonPath('upcoming.0.group_name', 'Tajweed Juniors');

    $recent = collect($res->json('recent'));
    expect($recent->pluck('id')->all())->toBe([$held])->not->toContain($beforeSara);
    expect($recent[0])->toMatchArray(['kind' => 'GROUP', 'status' => 'LATE', 'child_id' => $this->sara,
        'topic' => 'Noon sakinah', 'homework' => 'Revise page 4']);
    $res->assertJsonPath('children.1.groups.0.name', 'Tajweed Juniors');
    $res->assertJsonPath('children.1.month', ['attended' => 1, 'absent' => 0, 'minutes' => 60]);

    // The lesson's staff notes and the per-child note on the sheet stay inside the academy.
    expect($res->getContent())->not->toContain('Staff-only remark')->not->toContain('Private teacher note');
});

it('shows the hours left on a child’s package', function () {
    $this->asAcademy($this->academy);
    DB::table('lesson_packages')->insert(['id' => (string) Str::uuid(), 'academy_id' => $this->academy, 'student_id' => $this->adam,
        'label' => '10 hours', 'minutes_total' => 600, 'carried_over_minutes' => 30, 'minutes_consumed' => 210,
        'price_minor' => 100000, 'currency' => 'EGP', 'hourly_rate_minor' => 10000, 'bill_timing' => 'ON_START',
        'status' => 'ACTIVE', 'sequence_no' => 1, 'starts_on' => '2026-06-01']);
    $this->clearTenantContext();

    $res = portalPage($this, portalToken($this))->assertOk();

    $res->assertJsonPath('children.0.packages.0.label', '10 hours')
        ->assertJsonPath('children.0.packages.0.total_minutes', 630)
        ->assertJsonPath('children.0.packages.0.remaining_minutes', 420);
    $res->assertJsonPath('children.1.packages', []);
});
