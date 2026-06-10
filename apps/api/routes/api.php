<?php

declare(strict_types=1);

use App\Http\Controllers\Admin\AcademyController;
use App\Http\Controllers\Admin\PlanController;
use App\Http\Controllers\Auth\AuthController;
use App\Http\Controllers\InvoiceController;
use App\Http\Controllers\People\GuardianController;
use App\Http\Controllers\People\StudentController;
use App\Http\Controllers\People\TeacherController;
use App\Http\Controllers\ReportFieldController;
use App\Http\Controllers\Scheduling\AttendanceController;
use App\Http\Controllers\Scheduling\CalendarController;
use App\Http\Controllers\Scheduling\GenerateSessionsController;
use App\Http\Controllers\Scheduling\ScheduleController;
use App\Http\Controllers\Scheduling\SessionController;
use App\Http\Controllers\SessionReportController;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;

/*
| Public health check (Master Spec / Sprint 0 §5). No auth.
| Returns 200 with a degraded payload (db: "error") rather than crashing
| when the database is unreachable — TC-0.9 / TC-0.10 / TC-0.11.
*/
Route::get('/health', function (): JsonResponse {
    $db = 'ok';

    try {
        DB::select('select 1');
    } catch (Throwable) {
        $db = 'error';
    }

    return response()->json([
        'app' => 'ok',
        'db' => $db,
        'version' => config('app.version'),
        'time' => now()->utc()->toIso8601String(),
    ]);
});

/*
| Public auth entry point. Login runs OUTSIDE the tenant context (the user is not yet
| known); the RlsBypassUserProvider performs the credential lookup under RLS. The SPA
| primes the CSRF cookie via GET /sanctum/csrf-cookie (registered by Sanctum) first.
*/
Route::post('/auth/login', [AuthController::class, 'login']);

/*
| Authenticated API. `auth:sanctum` establishes identity; `tenant.context`
| (TenantContextMiddleware) then sets the three app.* GUCs transaction-locally for the
| rest of the request, so RLS scopes every query. Capability checks (Gate::authorize) are
| applied per endpoint on top of the RLS backstop.
*/
Route::middleware(['auth:sanctum', 'tenant.context'])->group(function () {
    Route::post('/auth/logout', [AuthController::class, 'logout']);
    Route::get('/auth/me', [AuthController::class, 'me']);
    Route::patch('/auth/locale', [AuthController::class, 'setLocale']);

    // Super Admin platform actions (§4.4) + academy onboarding/lifecycle (Sprint 3 §7).
    // Capability Gates live in the controllers; RLS is the database backstop. There is
    // deliberately NO academy hard-delete route (decision §3.1 — academies are SUSPENDED).
    Route::get('/admin/academy-types', [AcademyController::class, 'types']);
    Route::get('/admin/academies', [AcademyController::class, 'index']);
    Route::post('/admin/academies', [AcademyController::class, 'store']);
    Route::get('/admin/academies/{id}', [AcademyController::class, 'show']);
    Route::patch('/admin/academies/{id}', [AcademyController::class, 'update']);
    Route::post('/admin/academies/{id}/suspend', [AcademyController::class, 'suspend']);
    Route::post('/admin/academies/{id}/reactivate', [AcademyController::class, 'reactivate']);
    Route::post('/admin/academies/{id}/owner', [AcademyController::class, 'provisionOwner']);
    Route::post('/admin/academies/{id}/enter', [AcademyController::class, 'enter']);
    Route::post('/admin/academies/exit', [AcademyController::class, 'exit']);

    // Plan & add-on catalog CRUD (Super Admin, plan.manage).
    Route::get('/admin/plans', [PlanController::class, 'index']);
    Route::post('/admin/plans', [PlanController::class, 'store']);
    Route::patch('/admin/plans/{id}', [PlanController::class, 'update']);
    Route::post('/admin/add-ons', [PlanController::class, 'storeAddOn']);
    Route::patch('/admin/add-ons/{id}', [PlanController::class, 'updateAddOn']);

    // Per-academy report-field configuration (report_field.manage; Owner or Super Admin).
    Route::get('/academies/{id}/report-fields', [ReportFieldController::class, 'index']);
    Route::post('/academies/{id}/report-fields', [ReportFieldController::class, 'store']);
    Route::patch('/academies/{id}/report-fields/{fieldId}', [ReportFieldController::class, 'update']);
    Route::delete('/academies/{id}/report-fields/{fieldId}', [ReportFieldController::class, 'destroy']);

    // People: Guardians, Students & Teachers (Sprint 4 §8). Every route is capability-gated
    // (Gate::authorize) and tenant-scoped by RLS; lists are server-driven via App\Support\DataTable.
    Route::get('/guardians', [GuardianController::class, 'index']);
    Route::post('/guardians', [GuardianController::class, 'store']);
    Route::get('/guardians/{id}', [GuardianController::class, 'show']);
    Route::patch('/guardians/{id}', [GuardianController::class, 'update']);
    Route::post('/guardians/{id}/deactivate', [GuardianController::class, 'deactivate']);

    Route::get('/students', [StudentController::class, 'index']);
    Route::post('/students', [StudentController::class, 'store']);
    Route::get('/students/{id}', [StudentController::class, 'show']);
    Route::patch('/students/{id}', [StudentController::class, 'update']);
    Route::post('/students/{id}/deactivate', [StudentController::class, 'deactivate']);
    Route::put('/students/{id}/subscription', [StudentController::class, 'setSubscription']);
    Route::patch('/students/{id}/subscription/price', [StudentController::class, 'changePrice']);
    Route::post('/students/{id}/teacher', [StudentController::class, 'reassignTeacher']);
    Route::get('/students/{id}/teacher-history', [StudentController::class, 'teacherHistory']);

    Route::get('/teachers', [TeacherController::class, 'index']);
    Route::post('/teachers', [TeacherController::class, 'store']);
    Route::get('/teachers/{id}', [TeacherController::class, 'show']);
    Route::patch('/teachers/{id}', [TeacherController::class, 'update']);
    Route::post('/teachers/{id}/deactivate', [TeacherController::class, 'deactivate']);

    // Scheduling & sessions (Sprint 5 §8). The weekly schedule is the rule; sessions are the
    // materialised occurrences. Every route is capability-gated and tenant-scoped by RLS;
    // generation is idempotent and audited (generator.run with created/removed counts).
    Route::get('/students/{id}/schedule', [ScheduleController::class, 'show']);
    Route::put('/students/{id}/schedule', [ScheduleController::class, 'put']);
    Route::delete('/students/{id}/schedule', [ScheduleController::class, 'destroy']);

    Route::post('/sessions', [SessionController::class, 'store']);
    Route::post('/sessions/{id}/reschedule', [SessionController::class, 'reschedule']);
    Route::post('/sessions/{id}/cancel', [SessionController::class, 'cancel']);

    Route::get('/calendar', [CalendarController::class, 'index']);

    Route::post('/admin/generate-sessions', GenerateSessionsController::class);

    // Attendance & custom reports (Sprint 6 §8). The attendance outcome fires the billing hook
    // (§5) and sets the billable status Sprint 5 left untouched; the report engine renders the
    // academy's report_field_definitions and stores values keyed by field key. Every route is
    // capability-gated, RLS-scoped, and (for Teachers) row-filtered to their own sessions (§3.6).
    Route::get('/sessions/pending-attendance', [SessionController::class, 'pendingAttendance']);
    Route::get('/sessions/{id}', [SessionController::class, 'show']);
    Route::post('/sessions/{id}/attendance', [AttendanceController::class, 'store']);
    Route::put('/sessions/{id}/report', [SessionReportController::class, 'put']);
    Route::post('/sessions/{id}/report/whatsapp-sent', [SessionReportController::class, 'whatsappSent']);
    Route::get('/students/{id}/reports', [SessionReportController::class, 'archive']);

    // Minimal domain mutations exercising two-layer authorization (full invoicing: Sprint 7).
    Route::post('/invoices/{id}/mark-paid', [InvoiceController::class, 'markPaid']);
});
