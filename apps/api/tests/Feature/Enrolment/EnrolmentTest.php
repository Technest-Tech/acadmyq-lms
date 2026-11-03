<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesSchedules;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class, CreatesSchedules::class);

/**
 * The centre's public enrolment form (docs/centre-profile Phase 2 §6): one link per academy, an
 * inbox of what it collected, and the handoff to a placement lesson. Pinned here:
 *   - the form is made on first read and its link can be replaced (the old one dies);
 *   - the public page is token-scoped: a request lands in the right academy and nowhere else;
 *   - a closed form refuses the submit (410) but still tells the page it is closed;
 *   - the placement is a real `trials` row carrying the lead's name and phone, and converting that
 *     trial marks the request ENROLLED;
 *   - a Quran academy has none of it (402).
 */
beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $proPlan = DB::table('plans')->where('code', 'PRO')->value('id');
    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo', 'plan_id' => $proPlan, 'country' => 'EG']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-enrol@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'Miss Mona']);

    // A second centre, to prove the token names the academy.
    $this->otherAcademy = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo', 'plan_id' => $proPlan]);
    $this->otherOwner = $this->makeUser($this->otherAcademy, 'ACADEMY_OWNER', ['email' => 'owner-enrol-2@test.local']);

    enrolSwitchOn($this->academy);
    enrolSwitchOn($this->otherAcademy);
    $this->clearTenantContext();
});

function enrolInContext(string $academyId, callable $fn): mixed
{
    DB::statement("select set_config('app.current_academy_id', ?, true)", [$academyId]);
    DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
    try {
        return $fn();
    } finally {
        DB::statement("select set_config('app.current_academy_id', '', true)");
        DB::statement("select set_config('app.current_role', '', true)");
    }
}

function enrolSwitchOn(string $academyId): void
{
    enrolInContext($academyId, fn () => DB::table('module_subscriptions')
        ->where('academy_id', $academyId)->where('module', 'MANAGEMENT')
        ->update(['overrides' => json_encode(['enabled' => ['centre']])]));
}

/** The academy's public token, through the staff card (which makes the form on first read). */
function enrolToken($test, $owner): string
{
    Sanctum::actingAs($owner);

    return $test->getJson('/api/enrolment/form')->assertOk()->json('form.url');
}

function enrolTokenOf(string $url): string
{
    return substr($url, strrpos($url, '/e/') + 3);
}

function enrolSubmit($test, string $token, array $over = [])
{
    return $test->postJson('/api/e/'.$token, array_merge([
        'student_name' => 'Adam Hassan',
        'guardian_name' => 'Hassan',
        'phone' => '+20 101 234 5678',
        'age' => 9,
        'level_text' => 'الصف الثالث',
        'preferred_days' => [6, 1, 3],
        'preferred_time' => '17:00',
        'message' => 'يفضّل المساء',
    ], $over));
}

// ── The form and its link ─────────────────────────────────────────────────────

it('makes the form on first read, with a long token on the academy address, and replaces it on rotate', function () {
    Sanctum::actingAs($this->owner);

    $first = $this->getJson('/api/enrolment/form')->assertOk()->json('form');
    expect($first['title'])->toBe('التسجيل في المركز');
    expect($first['is_open'])->toBeTrue();
    expect($first['ask_subject'])->toBeTrue();
    $token = enrolTokenOf($first['url']);
    expect(strlen($token))->toBeGreaterThanOrEqual(24);
    expect($first['url'])->toContain('/e/'.$token);

    // A second read is the same form, not a second one.
    $again = $this->getJson('/api/enrolment/form')->assertOk()->json('form');
    expect($again['id'])->toBe($first['id']);
    expect($again['url'])->toBe($first['url']);
    expect(enrolInContext($this->academy, fn () => DB::table('enrolment_forms')->where('academy_id', $this->academy)->count()))->toBe(1);

    $this->getJson('/api/e/'.$token)->assertOk();

    $rotated = $this->postJson('/api/enrolment/form/rotate-token')->assertOk()->json('form');
    $newToken = enrolTokenOf($rotated['url']);
    expect($newToken)->not->toBe($token);
    $this->getJson('/api/e/'.$token)->assertNotFound();
    $this->getJson('/api/e/'.$newToken)->assertOk();
});

it('edits the words and the questions, and closing it keeps the link', function () {
    Sanctum::actingAs($this->owner);
    $form = $this->patchJson('/api/enrolment/form', [
        'title' => 'سجّل ابنك في المركز',
        'intro' => 'نتصل بك خلال يوم عمل.',
        'ask_level' => false,
        'success_message' => 'شكرًا، سنتصل بكم.',
        'is_open' => false,
    ])->assertOk()->json('form');

    expect($form['title'])->toBe('سجّل ابنك في المركز');
    expect($form['ask_level'])->toBeFalse();
    expect($form['ask_subject'])->toBeTrue();
    expect($form['is_open'])->toBeFalse();

    $public = $this->getJson('/api/e/'.enrolTokenOf($form['url']))->assertOk()->json();
    expect($public['form']['is_open'])->toBeFalse();
    expect($public['form']['title'])->toBe('سجّل ابنك في المركز');
    expect($public['form'])->not->toHaveKey('id');
});

// ── The public page ───────────────────────────────────────────────────────────

it('shows the academy brand, the form and the active subjects; a bad token is a 404', function () {
    enrolInContext($this->academy, function () {
        DB::table('specializations')->insert([
            ['academy_id' => $this->academy, 'name' => 'English', 'is_active' => true, 'sort_order' => 1],
            ['academy_id' => $this->academy, 'name' => 'Old French', 'is_active' => false, 'sort_order' => 2],
        ]);
        DB::table('academies')->where('id', $this->academy)->update(['brand_display_name' => 'Lingo Centre', 'brand_logo_url' => 'https://cdn.test/logo.png']);
    });
    $token = enrolTokenOf(enrolToken($this, $this->owner));
    $this->flushSession();
    $this->app['auth']->forgetGuards();

    $res = $this->getJson('/api/e/'.$token)->assertOk()->assertHeader('Cache-Control', 'no-store, private');
    expect($res->json('academy.displayName'))->toBe('Lingo Centre');
    expect($res->json('academy.logoUrl'))->toBe('https://cdn.test/logo.png');
    expect($res->json('academy.country'))->toBe('EG');
    expect($res->json('form.is_open'))->toBeTrue();
    expect(collect($res->json('subjects'))->pluck('name')->all())->toBe(['English']);

    $this->getJson('/api/e/'.str_repeat('x', 32))->assertNotFound();
});

it('takes a request into the right academy only, with the phone made canonical', function () {
    $subjectId = enrolInContext($this->academy, function () {
        DB::table('specializations')->insert(['academy_id' => $this->academy, 'name' => 'English', 'is_active' => true]);

        return DB::table('specializations')->where('academy_id', $this->academy)->value('id');
    });
    $token = enrolTokenOf(enrolToken($this, $this->owner));
    enrolToken($this, $this->otherOwner);
    $this->flushSession();
    $this->app['auth']->forgetGuards();

    $res = enrolSubmit($this, $token, ['subject_id' => $subjectId, 'phone' => '+20 101 234 5678'])->assertCreated();
    expect($res->json('ok'))->toBeTrue();

    $row = enrolInContext($this->academy, fn () => DB::table('enrolment_requests')->first());
    expect($row)->not->toBeNull();
    expect($row->academy_id)->toBe($this->academy);
    expect($row->student_name)->toBe('Adam Hassan');
    expect($row->phone)->toBe('+201012345678');
    expect($row->subject_id)->toBe($subjectId);
    expect($row->level_text)->toBe('الصف الثالث');
    expect($row->preferred_days)->toBe('{1,3,6}');
    expect($row->preferred_time)->toBe('17:00');
    expect($row->status)->toBe('NEW');
    expect($row->source)->toBe('LINK');

    // The other centre's inbox is empty — under RLS and through the API alike.
    expect(enrolInContext($this->otherAcademy, fn () => DB::table('enrolment_requests')->count()))->toBe(0);
    Sanctum::actingAs($this->otherOwner);
    expect($this->getJson('/api/enrolment/requests')->assertOk()->json('rows'))->toBe([]);
    Sanctum::actingAs($this->owner);
    expect($this->getJson('/api/enrolment/requests')->assertOk()->json('rows'))->toHaveCount(1);
});

it('refuses a submit on a closed form with a 410, a phone that is not one with a 422, and swallows the honeypot', function () {
    $token = enrolTokenOf(enrolToken($this, $this->owner));
    $this->flushSession();
    $this->app['auth']->forgetGuards();

    enrolSubmit($this, $token, ['phone' => '12'])->assertStatus(422)->assertJsonValidationErrors(['phone']);
    enrolSubmit($this, $token, ['student_name' => 'A'])->assertStatus(422)->assertJsonValidationErrors(['student_name']);

    // The bot fills the field a person never sees: a "success" and no row.
    enrolSubmit($this, $token, ['website' => 'http://spam.example'])->assertCreated();
    expect(enrolInContext($this->academy, fn () => DB::table('enrolment_requests')->count()))->toBe(0);

    enrolInContext($this->academy, fn () => DB::table('enrolment_forms')->where('academy_id', $this->academy)->update(['is_open' => false]));
    enrolSubmit($this, $token)->assertStatus(410);
    expect(enrolInContext($this->academy, fn () => DB::table('enrolment_requests')->count()))->toBe(0);
});

it('folds a re-send of the same child from the same phone into the waiting request', function () {
    $token = enrolTokenOf(enrolToken($this, $this->owner));
    $this->flushSession();
    $this->app['auth']->forgetGuards();

    enrolSubmit($this, $token)->assertCreated();
    enrolSubmit($this, $token, ['message' => 'وأيضًا يوم الخميس', 'preferred_days' => [4]])->assertOk();

    $rows = enrolInContext($this->academy, fn () => DB::table('enrolment_requests')->get());
    expect($rows)->toHaveCount(1);
    expect($rows[0]->message)->toBe('وأيضًا يوم الخميس');
    expect($rows[0]->preferred_days)->toBe('{4}');

    // A different child from the same phone is a second request.
    enrolSubmit($this, $token, ['student_name' => 'Sara Hassan'])->assertCreated();
    expect(enrolInContext($this->academy, fn () => DB::table('enrolment_requests')->count()))->toBe(2);
});

it('throttles the public submit like the course site booking form', function () {
    $route = collect(Route::getRoutes()->getRoutes())
        ->first(fn ($r) => $r->uri() === 'api/e/{token}' && in_array('POST', $r->methods(), true));
    expect($route)->not->toBeNull();
    expect($route->gatherMiddleware())->toContain('throttle:learn-booking');

    $token = enrolTokenOf(enrolToken($this, $this->owner));
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    for ($i = 0; $i < 5; $i++) {
        enrolSubmit($this, $token, ['student_name' => 'Child '.$i])->assertCreated();
    }
    enrolSubmit($this, $token, ['student_name' => 'Child 6'])->assertStatus(429);
});

// ── The inbox ─────────────────────────────────────────────────────────────────

it('lists, filters and counts the inbox, and the badge reads the NEW ones', function () {
    $token = enrolTokenOf(enrolToken($this, $this->owner));
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    enrolSubmit($this, $token, ['student_name' => 'Adam Hassan'])->assertCreated();
    enrolSubmit($this, $token, ['student_name' => 'Sara Hassan', 'phone' => '+201098765432'])->assertCreated();
    enrolSubmit($this, $token, ['student_name' => 'Youssef Ali', 'phone' => '+201055555555', 'guardian_name' => 'Ali'])->assertCreated();

    Sanctum::actingAs($this->owner);
    $all = $this->getJson('/api/enrolment/requests')->assertOk()->json();
    expect($all['rows'])->toHaveCount(3);
    expect($all['counts'])->toBe(['NEW' => 3, 'CONTACTED' => 0, 'PLACEMENT_BOOKED' => 0, 'ENROLLED' => 0, 'CLOSED' => 0]);
    // Inside the test's one transaction now() stands still, so the rows are found by name, not order.
    $byName = collect($all['rows'])->keyBy('student_name');
    expect($byName['Youssef Ali']['preferred_days'])->toBe([1, 3, 6]);
    expect($byName['Youssef Ali']['phone'])->toBe('+201055555555');
    expect($byName['Youssef Ali']['guardian_name'])->toBe('Ali');

    $youssef = $byName['Youssef Ali']['id'];
    $this->patchJson('/api/enrolment/requests/'.$youssef, ['status' => 'CONTACTED', 'staff_note' => 'اتصلنا؛ يفضّل السبت'])
        ->assertOk()
        ->assertJsonPath('request.status', 'CONTACTED')
        ->assertJsonPath('request.staff_note', 'اتصلنا؛ يفضّل السبت');

    expect($this->getJson('/api/enrolment/requests?status=NEW')->assertOk()->json('rows'))->toHaveCount(2);
    expect($this->getJson('/api/enrolment/requests?status=CONTACTED')->assertOk()->json('rows'))->toHaveCount(1);
    expect($this->getJson('/api/enrolment/requests?q=hassan')->assertOk()->json('rows'))->toHaveCount(2);
    expect($this->getJson('/api/enrolment/requests?q=ali')->assertOk()->json('rows'))->toHaveCount(1);
    expect($this->getJson('/api/enrolment/requests/summary')->assertOk()->json('new'))->toBe(2);

    $this->patchJson('/api/enrolment/requests/'.$youssef, ['status' => 'CLOSED'])->assertOk()->assertJsonPath('request.status', 'CLOSED');
    expect($this->getJson('/api/enrolment/requests/summary')->assertOk()->json('new'))->toBe(2);
    $this->patchJson('/api/enrolment/requests/'.Str::uuid(), ['status' => 'CLOSED'])->assertNotFound();
});

// ── The handoff ───────────────────────────────────────────────────────────────

it('books a real placement lesson from a request, then converting it enrols the request', function () {
    $token = enrolTokenOf(enrolToken($this, $this->owner));
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    enrolSubmit($this, $token)->assertCreated();

    Sanctum::actingAs($this->owner);
    $request = $this->getJson('/api/enrolment/requests')->json('rows.0');

    $booked = $this->postJson('/api/enrolment/requests/'.$request['id'].'/placement', [
        'teacher_id' => $this->teacher,
        'local_datetime' => '2027-06-15 17:00',
        'duration_minutes' => 30,
    ])->assertCreated();
    $trialId = $booked->json('trialId');
    expect($booked->json('request.status'))->toBe('PLACEMENT_BOOKED');
    expect($booked->json('request.trial.id'))->toBe($trialId);
    expect($booked->json('request.trial.teacher_name'))->toBe('Miss Mona');

    // The same row the trials board shows, carrying the lead's name and number.
    $trial = enrolInContext($this->academy, fn () => DB::table('trials')->where('id', $trialId)->first());
    expect($trial->status)->toBe('SCHEDULED');
    expect($trial->lead_name)->toBe('Adam Hassan');
    expect($trial->lead_whatsapp)->toBe('+201012345678');
    expect($trial->teacher_id)->toBe($this->teacher);
    expect($trial->student_id)->toBeNull();
    expect($trial->outcome_notes)->toContain('الصف الثالث');
    expect($this->getJson('/api/trials?status=SCHEDULED')->assertOk()->json('rows'))->toHaveCount(1);

    // Twice is a mistake, not a second lesson.
    $this->postJson('/api/enrolment/requests/'.$request['id'].'/placement', [
        'teacher_id' => $this->teacher,
        'local_datetime' => '2027-06-16 17:00',
        'duration_minutes' => 30,
    ])->assertStatus(422);

    // The existing convert path, untouched but for the one call: the request is ENROLLED.
    $student = $this->createStudent($this->academy, null, ['full_name' => 'Adam Hassan']);
    Sanctum::actingAs($this->owner);
    $this->postJson('/api/trials/'.$trialId.'/convert', ['student_id' => $student])->assertOk();

    $row = enrolInContext($this->academy, fn () => DB::table('enrolment_requests')->where('id', $request['id'])->first());
    expect($row->status)->toBe('ENROLLED');
    expect($row->student_id)->toBe($student);
    expect($this->getJson('/api/enrolment/requests?status=ENROLLED')->json('rows.0.student.name'))->toBe('Adam Hassan');
});

it('refuses a placement with no teacher or no slot, and leaves the request as it was', function () {
    $token = enrolTokenOf(enrolToken($this, $this->owner));
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    enrolSubmit($this, $token)->assertCreated();

    Sanctum::actingAs($this->owner);
    $id = $this->getJson('/api/enrolment/requests')->json('rows.0.id');
    $this->postJson('/api/enrolment/requests/'.$id.'/placement', ['local_datetime' => '2027-06-15 17:00', 'duration_minutes' => 30])->assertStatus(422);
    $this->postJson('/api/enrolment/requests/'.$id.'/placement', ['teacher_id' => Str::uuid(), 'local_datetime' => '2027-06-15 17:00', 'duration_minutes' => 30])->assertStatus(422);

    $row = enrolInContext($this->academy, fn () => DB::table('enrolment_requests')->where('id', $id)->first());
    expect($row->status)->toBe('NEW');
    expect($row->trial_id)->toBeNull();
    expect(enrolInContext($this->academy, fn () => DB::table('trials')->count()))->toBe(0);
});

// ── The switch ────────────────────────────────────────────────────────────────

it('is not there for a Quran academy', function () {
    $proPlan = DB::table('plans')->where('code', 'PRO')->value('id');
    $quran = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo', 'plan_id' => $proPlan]);
    $owner = $this->makeUser($quran, 'ACADEMY_OWNER', ['email' => 'owner-quran-enrol@test.local']);
    $this->clearTenantContext();

    Sanctum::actingAs($owner);
    $this->getJson('/api/enrolment/form')->assertStatus(402);
    $this->getJson('/api/enrolment/requests')->assertStatus(402);
    $this->getJson('/api/enrolment/requests/summary')->assertStatus(402);
    $this->postJson('/api/enrolment/form/rotate-token')->assertStatus(402);
    expect(enrolInContext($quran, fn () => DB::table('enrolment_forms')->where('academy_id', $quran)->exists()))->toBeFalse();
});
