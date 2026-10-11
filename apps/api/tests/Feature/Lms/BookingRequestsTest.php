<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/**
 * Booking requests on the course site (docs/lms/13) — "احجز استشارة", "احجز كورس", any number of
 * client-named forms feeding one inbox.
 *
 * What these tests are actually protecting:
 *  - **The client names it.** A form's title is what the site prints; the site document carries
 *    every ACTIVE form so the header, home band and course page can link to it on the first frame.
 *  - **Only the questions a form asks are kept.** A crafted request cannot smuggle a date into a
 *    form without one, pick a choice the client never offered, or book an unpublished course.
 *  - **Anonymous works; a signed-in learner is linked.** No sign-up wall in front of "call me back".
 *  - **Bots and double-taps don't flood the inbox** — honeypot and the same-phone fold.
 *  - **A request outlives its form** — rename or delete it and the inbox still reads right.
 *  - **The inbox is its own capability** and its own tenant.
 */
beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(modules: ['LMS'], overrides: [
        'client_type' => 'LMS',
        'subdomain' => 'bookingsite',
    ]);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER');

    Sanctum::actingAs($this->owner);

    // One published course (bookable) and one draft (not).
    $this->courseId = $this->postJson('/api/courses', ['title' => 'Tajweed Level 1'])->json('courseId');
    $sectionId = $this->postJson("/api/courses/{$this->courseId}/sections", ['title' => 'Unit 1'])->json('sectionId');
    $this->postJson("/api/courses/{$this->courseId}/lessons", [
        'section_id' => $sectionId, 'type' => 'TEXT', 'title' => 'Welcome', 'body' => 'Hello',
    ])->assertCreated();
    $this->postJson("/api/courses/{$this->courseId}/publish", ['status' => 'PUBLISHED'])->assertOk();
    $this->draftCourseId = $this->postJson('/api/courses', ['title' => 'Coming soon'])->json('courseId');
});

function bookingHeaders(?string $token = null, string $sub = 'bookingsite'): array
{
    $h = ['X-Academy' => $sub];
    if ($token !== null) {
        $h['Authorization'] = "Bearer {$token}";
    }

    return $h;
}

/** Create a form as the current staff user and return its JSON. */
function makeBookingForm(mixed $test, array $input): array
{
    return $test->postJson('/api/courses/booking-forms', $input)->assertCreated()->json('form');
}

/** Switch from the staff session to an anonymous visitor (or back with Sanctum::actingAs). */
function asVisitor(): void
{
    app()['auth']->forgetGuards();
}

// ── the client names the form, and the site advertises it ───────────────────

it('publishes a client-named form on the site document and serves its questions', function () {
    $consult = makeBookingForm($this, [
        'title' => 'احجز استشارة',
        'slug' => 'consultation',
        'ask_date' => true,
        'choice_label' => 'نوع الاستشارة',
        'choices' => ['فردية', 'عائلية', '', 'فردية'],
    ]);
    makeBookingForm($this, ['title' => 'Book a course', 'ask_course' => true, 'show_in_nav' => false]);
    makeBookingForm($this, ['title' => 'Old form', 'status' => 'HIDDEN']);

    // Blank and duplicate choices are dropped on write.
    expect($consult['choices'])->toBe(['فردية', 'عائلية']);
    expect($consult['slug'])->toBe('consultation');
    expect($consult['url'])->toContain('/book/consultation');

    asVisitor();
    $site = $this->withHeaders(bookingHeaders())->getJson('/api/learn/site')->assertOk();
    $bookings = $site->json('commerce.bookings');
    // Only ACTIVE forms, in the order the client made them; the hidden one is not advertised.
    expect(array_column($bookings, 'title'))->toBe(['احجز استشارة', 'Book a course']);
    expect($bookings[1]['nav'])->toBeFalse();
    expect($bookings[1]['ask_course'])->toBeTrue();

    $this->withHeaders(bookingHeaders())->getJson('/api/learn/bookings/consultation')
        ->assertOk()
        ->assertJsonPath('form.title', 'احجز استشارة')
        ->assertJsonPath('form.ask_date', true)
        ->assertJsonPath('form.choices', ['فردية', 'عائلية'])
        // It never asked about a course, so none are listed.
        ->assertJsonPath('courses', []);

    $courseForm = $this->withHeaders(bookingHeaders())->getJson("/api/learn/bookings/{$bookings[1]['slug']}")
        ->assertOk();
    // Published courses only — the draft is not bookable.
    expect(array_column($courseForm->json('courses'), 'title'))->toBe(['Tajweed Level 1']);

    $this->withHeaders(bookingHeaders())->getJson('/api/learn/bookings/old-form')->assertNotFound();
});

it('refuses a slug another form already uses', function () {
    makeBookingForm($this, ['title' => 'Consultation', 'slug' => 'consult']);
    $this->postJson('/api/courses/booking-forms', ['title' => 'Other', 'slug' => 'consult'])
        ->assertUnprocessable()->assertJsonValidationErrors('slug');
    // A derived slug steps aside instead.
    $second = makeBookingForm($this, ['title' => 'Consult']);
    expect($second['slug'])->toBe('consult-2');
});

// ── a visitor books ─────────────────────────────────────────────────────────

it('takes an anonymous request and keeps only the questions the form asks', function () {
    makeBookingForm($this, [
        'title' => 'Book a course', 'slug' => 'book', 'ask_course' => true, 'ask_date' => false,
        'ask_email' => false,
    ]);

    asVisitor();
    $this->withHeaders(bookingHeaders())->postJson('/api/learn/bookings/book', [
        'full_name' => 'Omar Khaled',
        'phone' => '+20 100 123 4567',
        'email' => 'omar@example.com',
        'course_id' => $this->courseId,
        // Not asked by this form — must not reach the inbox.
        'preferred_date' => now()->addDay()->format('Y-m-d'),
        'preferred_time' => '19:30',
        'message' => 'Evenings are best',
    ])->assertCreated();

    Sanctum::actingAs($this->owner);
    $row = $this->getJson('/api/courses/bookings')->assertOk()->json('rows.0');

    expect($row['form_title'])->toBe('Book a course')
        ->and($row['full_name'])->toBe('Omar Khaled')
        ->and($row['status'])->toBe('NEW')
        ->and($row['course_title'])->toBe('Tajweed Level 1')
        ->and($row['email'])->toBeNull()
        ->and($row['preferred_date'])->toBeNull()
        ->and($row['preferred_time'])->toBeNull()
        ->and($row['message'])->toBe('Evenings are best')
        ->and($row['learner_id'])->toBeNull();

    $this->getJson('/api/courses/bookings/summary')
        ->assertOk()
        ->assertJsonPath('stats.new', 1)
        ->assertJsonPath('stats.open', 1);
});

it('validates the choice, the course and the phone against what the form offers', function () {
    makeBookingForm($this, [
        'title' => 'Consultation', 'slug' => 'consult', 'ask_course' => true, 'ask_date' => true,
        'choice_label' => 'Kind', 'choices' => ['Individual', 'Family'],
    ]);
    asVisitor();
    $base = ['full_name' => 'Mona', 'phone' => '01001234567'];

    // The client offered a choice, so one of THEIRS is required.
    $this->withHeaders(bookingHeaders())->postJson('/api/learn/bookings/consult', $base)
        ->assertUnprocessable()->assertJsonValidationErrors('choice');
    $this->withHeaders(bookingHeaders())->postJson('/api/learn/bookings/consult', $base + ['choice' => 'Corporate'])
        ->assertUnprocessable()->assertJsonValidationErrors('choice');
    // An unpublished course is not bookable, even by id.
    $this->withHeaders(bookingHeaders())->postJson('/api/learn/bookings/consult', $base + [
        'choice' => 'Family', 'course_id' => $this->draftCourseId,
    ])->assertUnprocessable()->assertJsonValidationErrors('course_id');
    // Punctuation is not a phone number.
    $this->withHeaders(bookingHeaders())->postJson('/api/learn/bookings/consult', [
        'full_name' => 'Mona', 'phone' => '(--) 12', 'choice' => 'Family',
    ])->assertUnprocessable()->assertJsonValidationErrors('phone');

    $this->withHeaders(bookingHeaders())->postJson('/api/learn/bookings/consult', $base + [
        'choice' => 'Family', 'preferred_date' => now()->addDays(2)->format('Y-m-d'), 'preferred_time' => '18:00',
    ])->assertCreated();

    Sanctum::actingAs($this->owner);
    $row = $this->getJson('/api/courses/bookings')->json('rows.0');
    expect($row['choice'])->toBe('Family')
        ->and($row['preferred_time'])->toBe('18:00')
        ->and($row['preferred_date'])->toBe(now()->addDays(2)->format('Y-m-d'));
});

it('swallows a honeypot hit and folds a double submit into one request', function () {
    makeBookingForm($this, ['title' => 'Consultation', 'slug' => 'consult']);
    asVisitor();

    // A bot fills the hidden field: same answer as success, nothing stored.
    $this->withHeaders(bookingHeaders())->postJson('/api/learn/bookings/consult', [
        'full_name' => 'Spam Bot', 'phone' => '0100000000', 'website' => 'http://spam.example',
    ])->assertCreated();

    // A person taps twice, adding a detail the second time.
    $this->withHeaders(bookingHeaders())->postJson('/api/learn/bookings/consult', [
        'full_name' => 'Hala', 'phone' => '01112223334',
    ])->assertCreated();
    $this->withHeaders(bookingHeaders())->postJson('/api/learn/bookings/consult', [
        'full_name' => 'Hala', 'phone' => '01112223334', 'message' => 'After 6pm please',
    ])->assertOk();

    Sanctum::actingAs($this->owner);
    $rows = $this->getJson('/api/courses/bookings')->json('rows');
    expect($rows)->toHaveCount(1);
    expect($rows[0]['full_name'])->toBe('Hala')
        ->and($rows[0]['message'])->toBe('After 6pm please');
});

it('links the request to a signed-in learner', function () {
    makeBookingForm($this, ['title' => 'Consultation', 'slug' => 'consult']);
    asVisitor();

    $token = $this->withHeaders(bookingHeaders())->postJson('/api/learn/auth/register', [
        'full_name' => 'Sara', 'email' => 'sara@example.com', 'password' => 'password123',
    ])->assertCreated()->json('token');

    $this->withHeaders(bookingHeaders($token))->postJson('/api/learn/bookings/consult', [
        'full_name' => 'Sara', 'phone' => '01234567890',
    ])->assertCreated();

    Sanctum::actingAs($this->owner);
    $id = $this->getJson('/api/courses/bookings')->json('rows.0.id');
    $this->getJson("/api/courses/bookings/{$id}")
        ->assertOk()
        ->assertJsonPath('request.learner.email', 'sara@example.com');
});

// ── staff work the inbox ────────────────────────────────────────────────────

it('moves a request along the pipeline and keeps it after the form is renamed and deleted', function () {
    $form = makeBookingForm($this, ['title' => 'احجز استشارة', 'slug' => 'consult']);
    asVisitor();
    $this->withHeaders(bookingHeaders())->postJson('/api/learn/bookings/consult', [
        'full_name' => 'Yusuf', 'phone' => '01098765432',
    ])->assertCreated();

    Sanctum::actingAs($this->owner);
    $id = $this->getJson('/api/courses/bookings')->json('rows.0.id');

    $this->patchJson("/api/courses/bookings/{$id}", ['status' => 'CONFIRMED', 'staff_note' => 'Tue 7pm'])
        ->assertOk()
        ->assertJsonPath('request.status', 'CONFIRMED')
        ->assertJsonPath('request.staff_note', 'Tue 7pm');

    $this->getJson('/api/courses/bookings/summary')
        ->assertJsonPath('stats.new', 0)
        ->assertJsonPath('stats.confirmed', 1);
    $this->getJson("/api/courses/bookings/{$id}")
        ->assertJsonPath('request.handled_by_name', $this->owner->full_name);

    // The live title follows a rename…
    $this->patchJson("/api/courses/booking-forms/{$form['id']}", ['title' => 'استشارة مجانية'])->assertOk();
    $this->getJson('/api/courses/bookings')->assertJsonPath('rows.0.form_title', 'استشارة مجانية');

    // …and the snapshot survives a delete.
    $this->deleteJson("/api/courses/booking-forms/{$form['id']}")->assertOk();
    $this->getJson('/api/courses/bookings')
        ->assertJsonPath('total', 1)
        ->assertJsonPath('rows.0.form_title', 'احجز استشارة')
        ->assertJsonPath('rows.0.form_id', null);

    $this->deleteJson("/api/courses/bookings/{$id}")->assertOk();
    $this->getJson('/api/courses/bookings')->assertJsonPath('total', 0);
});

it('keeps the inbox behind its own capability and inside its own academy', function () {
    makeBookingForm($this, ['title' => 'Consultation', 'slug' => 'consult']);

    // A baseline STAFF login holds neither booking capability.
    $staff = $this->makeUser($this->academy, 'STAFF');
    asVisitor();
    Sanctum::actingAs($staff);
    $this->getJson('/api/courses/bookings')->assertForbidden();
    $this->postJson('/api/courses/booking-forms', ['title' => 'Mine'])->assertForbidden();

    // Another academy's site cannot see or post to this one's form.
    $other = $this->createAcademy(modules: ['LMS'], overrides: ['client_type' => 'LMS', 'subdomain' => 'elsewhere']);
    $otherOwner = $this->makeUser($other, 'ACADEMY_OWNER');
    asVisitor();
    $this->withHeaders(bookingHeaders(null, 'elsewhere'))->getJson('/api/learn/bookings/consult')->assertNotFound();
    $this->withHeaders(bookingHeaders(null, 'elsewhere'))->postJson('/api/learn/bookings/consult', [
        'full_name' => 'Nope', 'phone' => '01000000000',
    ])->assertNotFound();

    $this->withHeaders(bookingHeaders())->postJson('/api/learn/bookings/consult', [
        'full_name' => 'Real lead', 'phone' => '01000000001',
    ])->assertCreated();

    Sanctum::actingAs($otherOwner);
    $this->getJson('/api/courses/bookings')->assertOk()->assertJsonPath('total', 0);
    $this->getJson('/api/courses/booking-forms')->assertOk()->assertJsonPath('forms', []);
});
