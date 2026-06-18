<?php

declare(strict_types=1);

use App\Jobs\LessonReminderJob;
use App\Jobs\MonthlyStudentBillingJob;
use App\Services\Whatsapp\MessageTemplateRenderer;
use App\Services\Whatsapp\WhatsAppSender;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();
});

function enableAutomation(string $academyId, string $flag): void
{
    DB::statement("select set_config('app.current_academy_id', ?, true)", [$academyId]);
    DB::statement("select set_config('app.current_role', 'ACADEMY_OWNER', true)");
    DB::table('academy_automation_settings')->insert([
        'id' => (string) Str::uuid(),
        'academy_id' => $academyId,
        $flag => true,
        'created_at' => now(),
        'updated_at' => now(),
    ]);
}

it('Type 1 sends last month\'s student bills WITHOUT mutating invoices, and is idempotent', function () {
    $academyId = $this->createAcademy();
    $guardianId = $this->createGuardian($academyId);
    [$invId] = $this->createInvoice($academyId, $guardianId, [
        'period_year' => (int) now()->subMonth()->format('Y'),
        'period_month' => (int) now()->subMonth()->format('n'),
        'status' => 'OPEN',
        'total_minor' => 30000,
    ]);
    enableAutomation($academyId, 'type1_billing_enabled');

    $this->asAcademy($academyId);
    $before = DB::table('invoices')->where('id', $invId)->first();

    $out = (new MonthlyStudentBillingJob($academyId))->handle(app(WhatsAppSender::class), app(MessageTemplateRenderer::class));
    expect($out[$academyId])->toBe(1);

    $this->asAcademy($academyId);
    $after = DB::table('invoices')->where('id', $invId)->first();
    expect($after->status)->toBe($before->status);
    expect((int) $after->total_minor)->toBe((int) $before->total_minor);
    expect(DB::table('automation_send_log')->where('academy_id', $academyId)->where('automation_type', 'TYPE1_BILLING')->exists())->toBeTrue();

    // Idempotent — the same month doesn't re-bill.
    $out2 = (new MonthlyStudentBillingJob($academyId))->handle(app(WhatsAppSender::class), app(MessageTemplateRenderer::class));
    expect($out2[$academyId])->toBe(0);
});

it('Type 1 skips an academy with the toggle off', function () {
    $academyId = $this->createAcademy();
    $guardianId = $this->createGuardian($academyId);
    $this->createInvoice($academyId, $guardianId, [
        'period_year' => (int) now()->subMonth()->format('Y'),
        'period_month' => (int) now()->subMonth()->format('n'),
        'status' => 'OPEN',
        'total_minor' => 10000,
    ]);

    $out = (new MonthlyStudentBillingJob($academyId))->handle(app(WhatsAppSender::class), app(MessageTemplateRenderer::class));
    expect($out[$academyId])->toBe(0);
});

it('Type 2 reminds both the student and the teacher of an upcoming session, idempotent', function () {
    $academyId = $this->createAcademy();
    $teacherId = $this->createTeacher($academyId, ['phone' => '+201111111111']);
    $studentId = $this->createStudent($academyId); // guardian carries a whatsapp_phone
    $this->createSession($academyId, $studentId, $teacherId, [
        'scheduled_at_utc' => now()->addMinutes(60)->format('Y-m-d H:i:sP'),
        'status' => 'SCHEDULED',
    ]);
    enableAutomation($academyId, 'type2_lessons_enabled');

    $out = (new LessonReminderJob($academyId))->handle(app(WhatsAppSender::class));
    expect($out[$academyId])->toBe(2); // student + teacher

    $out2 = (new LessonReminderJob($academyId))->handle(app(WhatsAppSender::class));
    expect($out2[$academyId])->toBe(0);
});

it('Type 2 skips sessions outside the lead window', function () {
    $academyId = $this->createAcademy();
    $teacherId = $this->createTeacher($academyId, ['phone' => '+201111111111']);
    $studentId = $this->createStudent($academyId);
    $this->createSession($academyId, $studentId, $teacherId, [
        'scheduled_at_utc' => now()->addDays(2)->format('Y-m-d H:i:sP'), // too far out
        'status' => 'SCHEDULED',
    ]);
    enableAutomation($academyId, 'type2_lessons_enabled');

    $out = (new LessonReminderJob($academyId))->handle(app(WhatsAppSender::class));
    expect($out[$academyId])->toBe(0);
});
