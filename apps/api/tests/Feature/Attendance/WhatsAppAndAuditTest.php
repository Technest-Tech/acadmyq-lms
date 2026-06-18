<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesReportFields;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class, CreatesReportFields::class);

beforeEach(function () {
    Carbon::setTestNow('2026-06-11 12:00:00');
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academy = $this->createAcademy(overrides: ['default_currency' => 'EGP', 'timezone' => 'Africa/Cairo']);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER', ['email' => 'owner-wa@test.local']);
    $this->teacher = $this->createTeacher($this->academy, ['full_name' => 'WA Teacher']);
    $this->guardian = $this->createGuardian($this->academy, ['whatsapp_phone' => '+201001234567', 'full_name' => 'Abu Abdullah']);
    $this->student = $this->createStudent($this->academy, $this->guardian, ['full_name' => 'Abdullah']);
    $this->seedQuranReportFields($this->academy);

    $this->session = $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-06-01 15:00:00+00', 'status' => 'ATTENDED',
    ]);
});

afterEach(fn () => Carbon::setTestNow());

it('builds a bilingual WhatsApp summary with a deep link to the guardian\'s E.164', function () {
    // TC-6.26 — AC-6.10
    Sanctum::actingAs($this->owner);
    $this->putJson("/api/sessions/{$this->session}/report", ['values' => [
        'surah_from' => 'آل عمران 85', 'surah_to' => 'آل عمران 92', 'tajweed_rating' => 'ممتاز', 'next_assignment' => 'النساء 1-10',
    ]])->assertOk();

    $message = $this->postJson("/api/sessions/{$this->session}/report/whatsapp-sent")->assertOk()->json('message');

    expect($message['text'])->toContain('آل عمران 85')
        ->and($message['text'])->toContain('آل عمران 92')
        ->and($message['text'])->toContain('ممتاز')
        ->and($message['text'])->toContain('النساء 1-10')
        ->and($message['text'])->toContain('Abdullah')          // bilingual: also the English header
        ->and($message['phone'])->toBe('+201001234567')
        ->and($message['deeplink'])->toStartWith('https://wa.me/201001234567?text=');
});

it('marks the report sent (timestamp + channel) without any automated send', function () {
    // TC-6.27 — AC-6.10
    Sanctum::actingAs($this->owner);
    $this->putJson("/api/sessions/{$this->session}/report", ['values' => ['surah_from' => 'A', 'surah_to' => 'B']])->assertOk();

    $res = $this->postJson("/api/sessions/{$this->session}/report/whatsapp-sent")->assertOk();
    expect($res->json('channel'))->toBe('MANUAL_WHATSAPP');

    $this->asAcademy($this->academy);
    $report = DB::table('session_reports')->where('session_id', $this->session)->first();
    expect($report->whatsapp_sent_at)->not->toBeNull()
        ->and($report->whatsapp_channel)->toBe('MANUAL_WHATSAPP');
});

it('blocks a teacher from sending the report to the guardian (academy-admin only)', function () {
    // The Teacher writes the report; dispatching it to the guardian is an academy-admin action.
    $teacherUser = $this->makeUser($this->academy, 'TEACHER', ['email' => 'teacher-wa@test.local']);
    $teacher = $this->createTeacher($this->academy, ['full_name' => 'Own Teacher', 'user_id' => $teacherUser->id]);
    $session = $this->createSession($this->academy, $this->student, $teacher, [
        'scheduled_at_utc' => '2026-06-01 15:00:00+00', 'status' => 'ATTENDED',
    ]);

    Sanctum::actingAs($teacherUser);
    $this->putJson("/api/sessions/{$session}/report", ['values' => ['surah_from' => 'A', 'surah_to' => 'B']])->assertOk();
    $this->postJson("/api/sessions/{$session}/report/whatsapp-sent")
        ->assertStatus(422)->assertJsonValidationErrors('report');

    $this->asAcademy($this->academy);
    expect(DB::table('session_reports')->where('session_id', $session)->value('whatsapp_sent_at'))->toBeNull();
});

it('refuses to mark sent before a report exists', function () {
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$this->session}/report/whatsapp-sent")
        ->assertStatus(422)->assertJsonValidationErrors('report');
});

it('computes no invoice totals or payout amounts (boundary with Sprints 7/8)', function () {
    // TC-6.29 — AC-6.13
    $pending = $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-06-01 16:00:00+00', 'status' => 'SCHEDULED',
    ]);
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/sessions/{$pending}/attendance", ['status' => 'ATTENDED'])->assertOk();

    $this->asAcademy($this->academy);
    $line = DB::table('invoice_line_items')->where('session_id', $pending)->first();
    $invoice = DB::table('invoices')->where('id', $line->invoice_id)->first();

    // The hook fired and the guard is set, but NO money math happened here.
    expect((int) $line->amount_minor)->toBe(0)
        ->and((int) $invoice->subtotal_minor)->toBe(0)
        ->and((int) $invoice->total_minor)->toBe(0);

    // Sprint 8 now coordinates the teacher payout off the SAME status change: ATTENDED sets
    // the paid_to_teacher guard and accrues a payout line (the payroll engine owns the amount).
    expect((bool) DB::table('sessions')->where('id', $pending)->value('paid_to_teacher'))->toBeTrue();
});

it('audits status set/change with before/after, including the billing action', function () {
    // TC-6.30 — AC-6.12 (status set/change + hook fire/reverse)
    $pending = $this->createSession($this->academy, $this->student, $this->teacher, [
        'scheduled_at_utc' => '2026-06-01 16:00:00+00', 'status' => 'SCHEDULED',
    ]);
    Sanctum::actingAs($this->owner);

    $this->postJson("/api/sessions/{$pending}/attendance", ['status' => 'ATTENDED'])->assertOk();
    $this->postJson("/api/sessions/{$pending}/attendance", ['status' => 'ABSENT_EXCUSED'])->assertOk();

    $this->asAcademy($this->academy);
    $entries = DB::table('audit_log')
        ->where('action', 'session.status_changed')->where('entity_id', $pending)
        ->orderBy('created_at')->get();

    expect($entries)->toHaveCount(2);

    $first = json_decode($entries[0]->before, true);
    $firstAfter = json_decode($entries[0]->after, true);
    expect($first['status'])->toBe('SCHEDULED')
        ->and($firstAfter['status'])->toBe('ATTENDED')
        ->and($firstAfter['billing_action'])->toBe('billed');   // hook fire recorded

    $secondAfter = json_decode($entries[1]->after, true);
    expect($secondAfter['status'])->toBe('ABSENT_EXCUSED')
        ->and($secondAfter['billing_action'])->toBe('unbilled'); // hook reverse recorded
});

it('audits report fill/edit and whatsapp-sent with before/after', function () {
    // TC-6.30 — AC-6.12 (report fill/edit + whatsapp-sent)
    Sanctum::actingAs($this->owner);
    $this->putJson("/api/sessions/{$this->session}/report", ['values' => ['surah_from' => 'A', 'surah_to' => 'B']])->assertOk();
    $this->putJson("/api/sessions/{$this->session}/report", ['values' => ['surah_from' => 'A2', 'surah_to' => 'B2']])->assertOk();
    $this->postJson("/api/sessions/{$this->session}/report/whatsapp-sent")->assertOk();

    $this->asAcademy($this->academy);
    $fills = DB::table('audit_log')->where('action', 'session.report_filled')->where('entity_id', $this->session)->orderBy('created_at')->get();
    expect($fills)->toHaveCount(2);
    // The edit records the prior values as `before`.
    $editBefore = json_decode($fills[1]->before, true);
    expect($editBefore['values'])->toMatchArray(['surah_from' => 'A', 'surah_to' => 'B']);

    $sent = DB::table('audit_log')->where('action', 'session.report_whatsapp_sent')->where('entity_id', $this->session)->first();
    expect($sent)->not->toBeNull()
        ->and(json_decode($sent->after, true)['whatsapp_channel'])->toBe('MANUAL_WHATSAPP');
});
