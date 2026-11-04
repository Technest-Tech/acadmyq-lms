<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesSchedules;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class, CreatesSchedules::class);

/**
 * Rooms (docs/centre-profile/02-COHERENCE-AUDIT §3). Pinned here:
 *   - the list is a centre's own (402 otherwise), ordered, unique by name case- and space-blind,
 *     and a room a group sits in is switched off, never deleted;
 *   - a group points at a room; its payload says `room` and `location` = the room's name, and a
 *     rename follows into the text;
 *   - the clash check compares rooms by id (and a group still on free text by its text);
 *   - the back-fill turns a centre's location texts into rooms, idempotently, and leaves a Quran
 *     academy's texts alone.
 */
beforeEach(function () {
    // Wednesday 17 June 2026, 12:00 Cairo.
    Carbon::setTestNow('2026-06-17 09:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-rooms@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'Miss Mona']);
    $this->other = $this->createTeacher($this->academy, ['full_name' => 'Mr Karim']);
    $this->clearTenantContext();
});

afterEach(fn () => Carbon::setTestNow());

function roomsInContext(string $academyId, callable $fn): mixed
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

function roomsCentreOn(string $academyId): void
{
    roomsInContext($academyId, fn () => app(\App\Services\ModuleBilling::class)->setDisabledFeatures($academyId, 'MANAGEMENT', [], ['centre']));
}

function roomsAdd($test, string $name, array $over = []): string
{
    Sanctum::actingAs($test->owner);

    return $test->postJson('/api/rooms', ['name' => $name] + $over)->assertCreated()->json('roomId');
}

function roomsGroup($test, array $over = []): string
{
    Sanctum::actingAs($test->owner);

    return $test->postJson('/api/groups', array_merge([
        'name' => 'English A1', 'teacher_id' => $test->teacher, 'start_date' => '2026-06-01', 'mode' => 'OFFLINE',
        'slots' => [['weekday' => 1, 'start_time_local' => '17:00', 'duration_minutes' => 60]],
    ], $over))->assertCreated()->json('group.id');
}

function roomsLesson(string $academyId, string $groupId, string $date): object
{
    return roomsInContext($academyId, fn () => DB::table('class_group_lessons')
        ->where('group_id', $groupId)->where('occurrence_local_date', $date)->first());
}

// ── The switch ───────────────────────────────────────────────────────────────

it('is not there for an academy without the centre switch', function () {
    Sanctum::actingAs($this->owner);
    $id = (string) Str::uuid();
    $this->getJson('/api/rooms')->assertStatus(402);
    $this->postJson('/api/rooms', ['name' => 'Room 1'])->assertStatus(402);
    $this->patchJson("/api/rooms/{$id}", ['name' => 'Room 2'])->assertStatus(402);
    $this->deleteJson("/api/rooms/{$id}")->assertStatus(402);
});

it('leaves a Quran academy\'s group location as free text', function () {
    $groupId = roomsGroup($this, ['location' => 'Branch 2']);

    Sanctum::actingAs($this->owner);
    $this->getJson("/api/groups/{$groupId}")->assertOk()
        ->assertJsonPath('group.location', 'Branch 2')
        ->assertJsonPath('group.room', null);
    $this->patchJson("/api/groups/{$groupId}", ['location' => 'Branch 3'])->assertOk()
        ->assertJsonPath('group.location', 'Branch 3');
    // A room id it does not own is refused, not stored.
    $this->patchJson("/api/groups/{$groupId}", ['room_id' => (string) Str::uuid()])->assertStatus(422)->assertJsonValidationErrors(['room_id']);
    expect(roomsInContext($this->academy, fn () => DB::table('academy_rooms')->count()))->toBe(0);
});

// ── The list ─────────────────────────────────────────────────────────────────

it('keeps an ordered list, unique by name, with a capacity, that renames, reorders and switches off', function () {
    roomsCentreOn($this->academy);
    $r1 = roomsAdd($this, 'Room 1', ['capacity' => 12]);
    $lab = roomsAdd($this, 'Lab');

    Sanctum::actingAs($this->owner);
    $this->postJson('/api/rooms', ['name' => ' room 1 '])->assertStatus(422)->assertJsonValidationErrors(['name']);
    $this->postJson('/api/rooms', ['name' => 'Bad', 'capacity' => 0])->assertStatus(422);

    $rooms = $this->getJson('/api/rooms')->assertOk()->json('rooms');
    expect(array_column($rooms, 'name'))->toBe(['Room 1', 'Lab'])
        ->and($rooms[0]['capacity'])->toBe(12)
        ->and($rooms[1]['capacity'])->toBeNull();

    $this->patchJson("/api/rooms/{$lab}", ['position' => 0])->assertOk();
    $this->patchJson("/api/rooms/{$r1}", ['position' => 1, 'name' => 'Hall', 'capacity' => null])->assertOk();
    $this->patchJson("/api/rooms/{$lab}", ['name' => 'HALL'])->assertStatus(422);
    $this->patchJson("/api/rooms/{$lab}", ['is_active' => false])->assertOk();

    $rooms = $this->getJson('/api/rooms')->assertOk()->json('rooms');
    expect(array_column($rooms, 'name'))->toBe(['Lab', 'Hall'])
        ->and($rooms[0]['is_active'])->toBeFalse()
        ->and($rooms[1]['capacity'])->toBeNull();
});

it('refuses to delete a room a group sits in, and deletes an unused one', function () {
    roomsCentreOn($this->academy);
    $r1 = roomsAdd($this, 'Room 1');
    $spare = roomsAdd($this, 'Spare');
    roomsGroup($this, ['room_id' => $r1]);

    Sanctum::actingAs($this->owner);
    $this->deleteJson("/api/rooms/{$r1}")->assertStatus(422)->assertJsonValidationErrors(['room']);
    $this->getJson('/api/rooms')->assertOk()->assertJsonPath('rooms.0.groups_count', 1);
    $this->deleteJson("/api/rooms/{$spare}")->assertOk();
    expect(array_column($this->getJson('/api/rooms')->json('rooms'), 'name'))->toBe(['Room 1']);
});

// ── A group in a room ────────────────────────────────────────────────────────

it('puts a group in a room by id, names it in the payload, and follows a rename', function () {
    roomsCentreOn($this->academy);
    $r1 = roomsAdd($this, 'Room 1');
    $lab = roomsAdd($this, 'Lab');
    $groupId = roomsGroup($this, ['room_id' => $r1, 'location' => 'ignored text']);

    Sanctum::actingAs($this->owner);
    $this->getJson("/api/groups/{$groupId}")->assertOk()
        ->assertJsonPath('group.room.id', $r1)
        ->assertJsonPath('group.room.name', 'Room 1')
        ->assertJsonPath('group.location', 'Room 1');
    $row = collect($this->getJson('/api/groups')->assertOk()->json('groups'))->firstWhere('id', $groupId);
    expect($row['room'])->toBe(['id' => $r1, 'name' => 'Room 1']);

    // The board lesson carries the room too.
    $lesson = collect($this->getJson('/api/group-lessons?view=week&date=2026-06-15')->assertOk()->json('lessons'))->first();
    expect($lesson['group']['room'])->toBe(['id' => $r1, 'name' => 'Room 1'])
        ->and($lesson['group']['location'])->toBe('Room 1');

    $this->patchJson("/api/rooms/{$r1}", ['name' => 'Room One'])->assertOk();
    $this->getJson("/api/groups/{$groupId}")->assertOk()->assertJsonPath('group.location', 'Room One');
    expect(roomsInContext($this->academy, fn () => DB::table('class_groups')->where('id', $groupId)->value('location')))->toBe('Room One');

    // Moving rooms, then out of every room.
    $this->patchJson("/api/groups/{$groupId}", ['room_id' => $lab])->assertOk()->assertJsonPath('group.room.name', 'Lab');
    $this->patchJson("/api/groups/{$groupId}", ['room_id' => null])->assertOk()
        ->assertJsonPath('group.room', null)
        ->assertJsonPath('group.location', null);
});

it('refuses a switched-off room for a new placement but keeps the groups already in it', function () {
    roomsCentreOn($this->academy);
    $r1 = roomsAdd($this, 'Room 1');
    $groupId = roomsGroup($this, ['room_id' => $r1]);

    Sanctum::actingAs($this->owner);
    $this->patchJson("/api/rooms/{$r1}", ['is_active' => false])->assertOk();

    $this->postJson('/api/groups', [
        'name' => 'Maths G9', 'teacher_id' => $this->other, 'start_date' => '2026-06-01', 'room_id' => $r1,
        'slots' => [['weekday' => 2, 'start_time_local' => '17:00', 'duration_minutes' => 60]],
    ])->assertStatus(422)->assertJsonValidationErrors(['room_id']);
    // Nothing half-written by the refused create.
    expect(roomsInContext($this->academy, fn () => DB::table('class_groups')->where('name', 'Maths G9')->count()))->toBe(0);

    // Re-saving the group that already sits there passes.
    $this->patchJson("/api/groups/{$groupId}", ['room_id' => $r1, 'name' => 'English A1 — evening'])->assertOk()
        ->assertJsonPath('group.room.id', $r1);
});

// ── The clash ────────────────────────────────────────────────────────────────

it('warns of a room clash by room id, and still by text for a group off the list', function () {
    roomsCentreOn($this->academy);
    $r1 = roomsAdd($this, 'Room 3');
    $lab = roomsAdd($this, 'Lab');
    $english = roomsGroup($this, ['room_id' => $r1]);
    $maths = roomsGroup($this, [
        'name' => 'Maths G9', 'teacher_id' => $this->other, 'room_id' => $lab,
        'slots' => [['weekday' => 1, 'start_time_local' => '19:00', 'duration_minutes' => 60]],
    ]);
    $mathsLesson = roomsLesson($this->academy, $maths, '2026-06-22');

    Sanctum::actingAs($this->owner);
    // Different rooms at the same hour: no clash.
    $apart = $this->postJson("/api/group-lessons/{$mathsLesson->id}/reschedule", ['local_datetime' => '2026-06-22 17:30'])->assertOk();
    expect(collect($apart->json('warnings'))->pluck('type'))->not->toContain('room');

    // Same room by id: a clash, whatever the text says.
    $this->patchJson("/api/groups/{$maths}", ['room_id' => $r1])->assertOk();
    roomsInContext($this->academy, fn () => DB::table('class_groups')->where('id', $maths)->update(['location' => 'something else']));
    $same = $this->postJson("/api/group-lessons/{$mathsLesson->id}/reschedule", ['local_datetime' => '2026-06-22 17:15'])->assertOk();
    $warning = collect($same->json('warnings'))->firstWhere('type', 'room');
    expect($warning)->not->toBeNull()
        ->and($warning['detail'][0]['group_name'])->toBe('English A1')
        ->and($warning['message'])->toContain('Room 3');

    // A third group still on free text that spells the room's name clashes with it too.
    $legacy = roomsGroup($this, [
        'name' => 'Science', 'teacher_id' => $this->other,
        'slots' => [['weekday' => 3, 'start_time_local' => '19:00', 'duration_minutes' => 60]],
    ]);
    roomsInContext($this->academy, fn () => DB::table('class_groups')->where('id', $legacy)->update(['location' => ' room 3 ', 'room_id' => null]));
    $legacyLesson = roomsLesson($this->academy, $legacy, '2026-06-24');
    $added = $this->postJson("/api/groups/{$english}/lessons", ['local_datetime' => '2026-06-24 19:15', 'duration_minutes' => 30])->assertCreated();
    expect(collect($added->json('warnings'))->pluck('type'))->toContain('room');
    expect($legacyLesson)->not->toBeNull();
});

// ── Back-fill ────────────────────────────────────────────────────────────────

it('turns a centre\'s location texts into rooms, idempotently, and leaves a Quran academy alone', function () {
    $quran = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo']);
    $quranOwner = $this->makeUser($quran, 'ACADEMY_OWNER', ['email' => 'owner-rooms-q@test.local']);
    $quranTeacher = $this->createTeacher($quran, ['full_name' => 'Sheikh Ali']);
    $this->clearTenantContext();

    $g1 = roomsGroup($this, ['name' => 'G1', 'location' => ' Room 3 ']);
    $g2 = roomsGroup($this, ['name' => 'G2', 'location' => 'Lab']);
    $g3 = roomsGroup($this, ['name' => 'G3', 'location' => 'room 3']);
    $g4 = roomsGroup($this, ['name' => 'G4']);
    roomsInContext($this->academy, function () use ($g1, $g2, $g3): void {
        foreach ([$g1 => '2026-05-01', $g2 => '2026-05-02', $g3 => '2026-05-03'] as $id => $day) {
            DB::table('class_groups')->where('id', $id)->update(['created_at' => $day.' 10:00:00+00']);
        }
    });
    Sanctum::actingAs($quranOwner);
    $q1 = $this->postJson('/api/groups', [
        'name' => 'Hifz', 'teacher_id' => $quranTeacher, 'start_date' => '2026-06-01', 'location' => 'Masjid hall',
        'slots' => [['weekday' => 1, 'start_time_local' => '17:00', 'duration_minutes' => 60]],
    ])->assertCreated()->json('group.id');

    roomsCentreOn($this->academy);

    $migration = require database_path('migrations/2026_11_08_000001_academy_rooms.php');
    expect($migration->fill())->toBe(2);
    expect($migration->fill())->toBe(0);

    roomsInContext($this->academy, function () use ($g1, $g2, $g3, $g4): void {
        $rooms = DB::table('academy_rooms')->orderBy('position')->get();
        expect($rooms->pluck('name')->all())->toBe(['Room 3', 'Lab']);
        $groups = DB::table('class_groups')->whereIn('id', [$g1, $g2, $g3, $g4])->pluck('room_id', 'id');
        expect((string) $groups[$g1])->toBe((string) $rooms[0]->id)
            ->and((string) $groups[$g3])->toBe((string) $rooms[0]->id)
            ->and((string) $groups[$g2])->toBe((string) $rooms[1]->id)
            ->and($groups[$g4])->toBeNull();
    });
    roomsInContext($quran, function () use ($q1): void {
        expect(DB::table('academy_rooms')->count())->toBe(0)
            ->and(DB::table('class_groups')->where('id', $q1)->value('room_id'))->toBeNull()
            ->and(DB::table('class_groups')->where('id', $q1)->value('location'))->toBe('Masjid hall');
    });
});
