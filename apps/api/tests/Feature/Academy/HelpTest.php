<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

/**
 * The in-app help's server half: the videos a Super Admin attaches to help slots (read by every
 * signed-in user of every client), and the first-steps state behind a new academy's "start here" card.
 */
uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();
    Storage::fake('local');
    config(['lms.media.disk' => 'local']);

    $this->admin = $this->makeUser(null, 'SUPER_ADMIN');
    $this->academy = $this->createAcademy();
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-help@test.local']);
    $this->teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-help@test.local']);
    $this->clearTenantContext();
});

afterEach(fn () => Carbon::setTestNow());

it('starts with no videos: every slot is "not recorded yet"', function () {
    Sanctum::actingAs($this->teacherUser);

    $this->getJson('/api/help/videos')->assertOk()->assertExactJson(['videos' => []]);
});

it('lets a Super Admin attach a link, and everyone at every client then reads it', function () {
    Sanctum::actingAs($this->admin);
    $this->putJson('/api/admin/help-videos/students.add', ['url' => 'https://youtu.be/dQw4w9WgXcQ'])->assertOk();

    Sanctum::actingAs($this->teacherUser);
    $this->getJson('/api/help/videos')
        ->assertOk()
        ->assertJsonCount(1, 'videos')
        ->assertJsonPath('videos.0.slot', 'students.add')
        ->assertJsonPath('videos.0.source', 'LINK')
        ->assertJsonPath('videos.0.url', 'https://youtu.be/dQw4w9WgXcQ');
});

it('refuses a client — even its owner — who tries to attach or remove a video', function () {
    Sanctum::actingAs($this->owner);

    $this->putJson('/api/admin/help-videos/students', ['url' => 'https://youtu.be/x'])->assertForbidden();
    $this->postJson('/api/admin/help-videos/upload-url', [
        'slot' => 'students', 'filename' => 'a.mp4', 'content_type' => 'video/mp4', 'size_bytes' => 10,
    ])->assertForbidden();
    $this->deleteJson('/api/admin/help-videos/students')->assertForbidden();
});

it('rejects a link that is not a web address, and a slot that is not a slot', function () {
    Sanctum::actingAs($this->admin);

    $this->putJson('/api/admin/help-videos/students', ['url' => 'javascript:alert(1)'])->assertUnprocessable();
    $this->putJson('/api/admin/help-videos/students', [])->assertUnprocessable();
    $this->putJson('/api/admin/help-videos/Students!', ['url' => 'https://youtu.be/x'])->assertNotFound();
});

it('takes an uploaded file: reserve, put, attach — then serves it as a signed url', function () {
    Sanctum::actingAs($this->admin);

    $reserved = $this->postJson('/api/admin/help-videos/upload-url', [
        'slot' => 'attendance', 'filename' => 'Attendance tour.MP4', 'content_type' => 'video/mp4', 'size_bytes' => 2048,
    ])->assertCreated()->json();

    expect($reserved['key'])->toStartWith('help/videos/attendance/')->toEndWith('.mp4');
    expect($reserved['upload']['method'])->toBe('PUT');

    // Attaching before the file landed is refused.
    $this->putJson('/api/admin/help-videos/attendance', ['storage_key' => $reserved['key']])->assertUnprocessable();

    Storage::disk('local')->put($reserved['key'], 'video-bytes');
    $this->putJson('/api/admin/help-videos/attendance', ['storage_key' => $reserved['key'], 'filename' => 'Attendance tour.MP4'])
        ->assertOk();

    Sanctum::actingAs($this->owner);
    $video = $this->getJson('/api/help/videos')->assertOk()->json('videos.0');
    expect($video['source'])->toBe('UPLOAD');
    expect($video['filename'])->toBe('Attendance tour.MP4');
    expect($video['sizeBytes'])->toBe(11);
    expect($video['url'])->toContain('/lms/media/stream')->toContain('signature=');

    // The signed url really plays, with no session at all.
    app('auth')->forgetGuards();
    $this->get($video['url'])->assertOk();
});

it('never attaches a key reserved for another slot', function () {
    Sanctum::actingAs($this->admin);
    Storage::disk('local')->put('help/videos/students/clip.mp4', 'x');
    Storage::disk('local')->put('lms/some-academy/asset/source.mp4', 'x');

    $this->putJson('/api/admin/help-videos/attendance', ['storage_key' => 'help/videos/students/clip.mp4'])->assertUnprocessable();
    $this->putJson('/api/admin/help-videos/attendance', ['storage_key' => 'lms/some-academy/asset/source.mp4'])->assertUnprocessable();
});

it('deletes the file a new video replaces, and the file of a removed video', function () {
    Sanctum::actingAs($this->admin);
    Storage::disk('local')->put('help/videos/students/one.mp4', 'one');
    Storage::disk('local')->put('help/videos/students/two.mp4', 'two');

    $this->putJson('/api/admin/help-videos/students', ['storage_key' => 'help/videos/students/one.mp4'])->assertOk();
    $this->putJson('/api/admin/help-videos/students', ['storage_key' => 'help/videos/students/two.mp4'])->assertOk();
    Storage::disk('local')->assertMissing('help/videos/students/one.mp4');
    Storage::disk('local')->assertExists('help/videos/students/two.mp4');

    // A link in place of the file drops the file too.
    $this->putJson('/api/admin/help-videos/students', ['url' => 'https://vimeo.com/123456'])->assertOk();
    Storage::disk('local')->assertMissing('help/videos/students/two.mp4');

    $this->deleteJson('/api/admin/help-videos/students')->assertOk();
    $this->getJson('/api/help/videos')->assertOk()->assertExactJson(['videos' => []]);
});

it('shows a brand-new academy its first steps, all still to do', function () {
    Sanctum::actingAs($this->owner);

    $this->getJson('/api/help/onboarding')
        ->assertOk()
        ->assertJsonPath('show', true)
        ->assertJsonPath('done.teacher', false)
        ->assertJsonPath('done.student', false)
        ->assertJsonPath('done.schedule', false)
        ->assertJsonPath('done.attendance', false)
        ->assertJsonPath('done.money', false);
});

it('ticks a step once the academy really did it', function () {
    $teacher = $this->createTeacher($this->academy, ['currency' => 'EGP']);
    $student = $this->createStudent($this->academy);
    $this->createSession($this->academy, $student, $teacher, ['status' => 'ATTENDED']);
    $this->clearTenantContext();

    Sanctum::actingAs($this->owner);
    $this->getJson('/api/help/onboarding')
        ->assertOk()
        ->assertJsonPath('done.teacher', true)
        ->assertJsonPath('done.student', true)
        ->assertJsonPath('done.attendance', true)
        ->assertJsonPath('done.money', false);
});

it('counts money only once some really came in: an open bill is not a payment', function () {
    $this->createInvoice($this->academy);
    $this->clearTenantContext();

    Sanctum::actingAs($this->owner);
    $this->getJson('/api/help/onboarding')->assertOk()->assertJsonPath('done.money', false);

    $this->createInvoice($this->academy, null, ['status' => 'PAID', 'period_month' => 4]);
    $this->clearTenantContext();
    $this->getJson('/api/help/onboarding')->assertOk()->assertJsonPath('done.money', true);
});

it('does not count a lesson nobody marked yet', function () {
    $teacher = $this->createTeacher($this->academy, ['currency' => 'EGP']);
    $student = $this->createStudent($this->academy);
    $this->createSession($this->academy, $student, $teacher, ['status' => 'SCHEDULED']);
    $this->clearTenantContext();

    Sanctum::actingAs($this->owner);
    $this->getJson('/api/help/onboarding')->assertOk()->assertJsonPath('done.attendance', false);
});

it('stops showing the card to an academy that has been working for months', function () {
    $this->createStudent($this->academy);
    $this->clearTenantContext();

    Carbon::setTestNow(now()->addDays(90));
    Sanctum::actingAs($this->owner);
    $this->getJson('/api/help/onboarding')->assertOk()->assertJsonPath('show', false);
});

it('never reads another academy\'s progress', function () {
    $other = $this->createAcademy();
    $this->createTeacher($other, ['currency' => 'EGP']);
    $this->createStudent($other);
    $this->clearTenantContext();

    Sanctum::actingAs($this->owner);
    $this->getJson('/api/help/onboarding')
        ->assertOk()
        ->assertJsonPath('done.teacher', false)
        ->assertJsonPath('done.student', false);
});

it('has nothing to set up for a platform Super Admin outside any academy', function () {
    Sanctum::actingAs($this->admin);

    $this->getJson('/api/help/onboarding')->assertOk()->assertJsonPath('show', false);
});
