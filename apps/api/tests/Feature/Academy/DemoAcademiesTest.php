<?php

declare(strict_types=1);

use App\Demo\CentreDemo;
use App\Demo\DemoAcademies;
use App\Demo\QuranDemo;
use App\Models\User;
use App\Services\Treasury;
use App\Support\AcademyProfile;
use App\Support\Entitlement;
use Carbon\CarbonImmutable;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesSchedules;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class, CreatesSchedules::class);

/**
 * `php artisan demo:academies` — the two sales demos (App\Demo). What is pinned here:
 *   - both academies exist, each on its own profile, live and never on a trial;
 *   - they hold what a lead should see: students, lessons marked and still to mark, paid and unpaid
 *     bills, sealed and open salaries — and, for the centre, groups, receipts and a treasury;
 *   - every phone number is a fake, every email is on .demo, nothing is connected to WhatsApp;
 *   - the printed logins work, and the owner's main pages answer;
 *   - a second run changes nothing, --fresh rebuilds, production needs --force;
 *   - no row of any other academy, and no platform row, is touched.
 */
beforeEach(function () {
    // The platform catalog (academy types, permissions) and one real-looking academy next door.
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->neighbour = $this->createAcademy(overrides: ['name' => 'A paying client', 'subdomain' => 'paying-client']);
    $this->neighbourOwner = $this->makeUser($this->neighbour, 'ACADEMY_OWNER', ['email' => 'owner@paying-client.test']);
    $teacher = $this->createTeacher($this->neighbour);
    $student = $this->createStudent($this->neighbour);
    $this->createSession($this->neighbour, $student, $teacher);
    $this->createInvoice($this->neighbour);
    $this->clearTenantContext();
});

/** Read one demo academy's rows, inside its own tenant context. */
function demoRead(string $key, callable $fn): mixed
{
    test()->enterAcademyAsSuperAdmin(DemoAcademies::IDS[$key]);
    try {
        return $fn(DemoAcademies::IDS[$key]);
    } finally {
        test()->clearTenantContext();
    }
}

/** Rows per table for one demo academy — what a second run must leave exactly as it was. */
function demoRowCounts(string $key): array
{
    return demoRead($key, function (string $id): array {
        $counts = [];
        foreach (demoTenantTables() as $table) {
            $counts[$table] = DB::table($table)->where('academy_id', $id)->count();
        }

        return $counts;
    });
}

/** Every table that carries an academy_id. */
function demoTenantTables(): array
{
    return array_map(fn ($r) => (string) $r->table_name, DB::select(
        "select c.table_name from information_schema.columns c
           join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
          where c.table_schema = 'public' and c.column_name = 'academy_id' and t.table_type = 'BASE TABLE'
          order by 1"
    ));
}

/**
 * A fingerprint of everything that is NOT a demo academy: each other academy's rows in every tenant
 * table, and every table that belongs to the platform. Compared before and after a run.
 */
function demoOutsideFingerprint(array $otherAcademies): array
{
    $tenant = demoTenantTables();
    $print = [];
    $hash = fn (string $table, string $where = 'true') => DB::selectOne(
        "select count(*) as n, coalesce(md5(string_agg(md5(t::text), '' order by md5(t::text))), '') as h from {$table} t where {$where}"
    );

    foreach ($otherAcademies as $academyId) {
        test()->enterAcademyAsSuperAdmin($academyId);
        foreach ($tenant as $table) {
            $row = $hash($table, "academy_id = '{$academyId}'");
            $print["{$academyId}:{$table}"] = "{$row->n}:{$row->h}";
        }
    }

    // Platform tables, and platform rows of tenant tables (academy_id null), as the Super Admin sees them.
    test()->asSuperAdmin();
    $all = array_map(fn ($r) => (string) $r->table_name, DB::select(
        "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1"
    ));
    foreach ($all as $table) {
        if (in_array($table, $tenant, true)) {
            $row = $hash($table, 'academy_id is null');
        } elseif ($table === 'academies') {
            $row = $hash($table, "id not in ('".implode("','", DemoAcademies::IDS)."')");
        } else {
            $row = $hash($table);
        }
        $print["platform:{$table}"] = "{$row->n}:{$row->h}";
    }
    test()->clearTenantContext();

    return $print;
}

/** An instant with its offset — a bare timestamp is read in the database session's own zone. */
function demoAt(DateTimeInterface $at): string
{
    return $at->format('Y-m-d H:i:sP');
}

function demoUser(string $email): User
{
    $row = DB::selectOne('select * from app.auth_find_by_email(?)', [$email]);
    expect($row)->not->toBeNull();

    $user = new User;
    $user->forceFill(['id' => $row->id, 'academy_id' => $row->academy_id, 'full_name' => $row->full_name, 'email' => $row->email, 'is_active' => $row->is_active]);
    $user->exists = true;
    $user->syncOriginal();

    return $user;
}

/** Sign in with the printed password, then call each page's endpoint as that user. */
function demoSignInAndOpen(string $email, array $paths): void
{
    test()->flushSession();
    test()->withHeader('Origin', 'http://localhost:3000')
        ->postJson('/api/auth/login', ['email' => $email, 'password' => DemoAcademies::PASSWORD])
        ->assertOk();

    $user = demoUser($email);
    foreach ($paths as $path) {
        test()->flushSession();
        Sanctum::actingAs($user);
        $response = test()->getJson($path);
        expect($response->status())->toBe(200, "{$email} → GET {$path} answered {$response->status()}: ".substr((string) $response->getContent(), 0, 300));
    }
}

it('refuses production without --force, and any academy that is not its own', function () {
    $this->app->detectEnvironment(fn () => 'production');
    $this->artisan('demo:academies')->expectsOutputToContain('--force')->assertFailed();
    $this->app->detectEnvironment(fn () => 'testing');

    $this->asSuperAdmin();
    expect(DB::table('academies')->whereIn('id', DemoAcademies::IDS)->count())->toBe(0);
    $this->clearTenantContext();

    expect(fn () => DemoAcademies::assertOwn($this->neighbour))->toThrow(InvalidArgumentException::class)
        ->and(fn () => new QuranDemo($this->neighbour, CarbonImmutable::now(), 3))->toThrow(InvalidArgumentException::class)
        ->and(fn () => new CentreDemo($this->neighbour, CarbonImmutable::now(), 3))->toThrow(InvalidArgumentException::class);

    $this->artisan('demo:academies', ['--only' => 'someone-else'])->assertFailed();
});

it('rebuilds an academy with --fresh — only the one it was asked for, and nothing outside it', function () {
    $this->asSuperAdmin();
    $others = DB::table('academies')->pluck('id')->map(fn ($id) => (string) $id)->all();
    $this->clearTenantContext();
    $outside = demoOutsideFingerprint($others);

    // One month of history and one academy: the same code path, a fraction of the rows.
    $this->artisan('demo:academies', ['--only' => 'centre', '--months' => 1])->assertSuccessful();
    $this->clearTenantContext();
    $first = demoRead(DemoAcademies::CENTRE, fn (string $id) => DB::table('students')->where('academy_id', $id)->pluck('id')->sort()->values()->all());
    expect($first)->toHaveCount(45);

    $this->artisan('demo:academies', ['--fresh' => true, '--only' => 'centre', '--months' => 1])
        ->expectsOutputToContain('Deleted the old one')
        ->assertSuccessful();
    $this->clearTenantContext();

    // Rebuilt, not added to: the same academy id, the same shape, brand-new rows.
    $second = demoRead(DemoAcademies::CENTRE, fn (string $id) => DB::table('students')->where('academy_id', $id)->pluck('id')->sort()->values()->all());
    expect($second)->toHaveCount(45)->and(array_intersect($first, $second))->toBe([]);
    demoRead(DemoAcademies::CENTRE, function (string $id): void {
        expect(DB::table('class_groups')->where('academy_id', $id)->count())->toBe(11)
            ->and(DB::table('users')->where('academy_id', $id)->where('email', 'owner@centre.demo')->count())->toBe(1)
            ->and(DB::table('receipts')->where('academy_id', $id)->count())->toBeGreaterThan(20)
            // One month behind this one: no lesson is older than the first of last month.
            ->and(DB::table('class_group_lessons')->where('academy_id', $id)
                ->where('occurrence_local_date', '<', now('Africa/Cairo')->startOfMonth()->subMonthNoOverflow()->toDateString())->count())->toBe(0);
    });

    // --only=centre never made the other one.
    $this->asSuperAdmin();
    expect(DB::table('academies')->whereIn('id', DemoAcademies::IDS)->pluck('id')->all())->toBe([DemoAcademies::IDS[DemoAcademies::CENTRE]])
        ->and(DB::table('academies')->count())->toBe(count($others) + 1);
    $this->clearTenantContext();

    $after = demoOutsideFingerprint($others);
    expect(array_keys(array_diff_assoc($after, $outside) + array_diff_assoc($outside, $after)))->toBe([]);
});

/*
 * The big one, on purpose a single test: a build is three months lived a day at a time — a minute or
 * two — and every question below is asked of the same two academies, so they are built once.
 */
it('builds both academies alive and harmless, changes nothing on a second run, and touches nothing else', function () {
    $this->asSuperAdmin();
    $others = DB::table('academies')->pluck('id')->map(fn ($id) => (string) $id)->all();
    $this->clearTenantContext();
    expect($others)->toContain($this->neighbour)->and(count($others))->toBeGreaterThan(1);
    $outside = demoOutsideFingerprint($others);

    $this->artisan('demo:academies')
        ->expectsOutputToContain(DemoAcademies::PASSWORD)
        ->assertSuccessful();
    $this->clearTenantContext();

    // ── Both exist, each on its profile, live and not a trial ───────────────────────────────────
    foreach ([DemoAcademies::QURAN => AcademyProfile::QURAN, DemoAcademies::CENTRE => AcademyProfile::CENTRE] as $key => $profile) {
        demoRead($key, function (string $id) use ($key, $profile): void {
            $academy = DB::table('academies')->where('id', $id)->first();
            expect($academy)->not->toBeNull()
                ->and($academy->status)->toBe('ACTIVE')
                ->and($academy->subdomain)->toBe(DemoAcademies::describe($key)['subdomain'])
                ->and(trim((string) $academy->default_currency))->toBe('EGP')
                ->and(AcademyProfile::forAcademy($id))->toBe($profile);

            $module = DB::table('module_subscriptions')->where('academy_id', $id)->where('module', 'MANAGEMENT')->first();
            expect($module->status)->toBe('ACTIVE')
                ->and((bool) $module->is_trial)->toBeFalse()
                ->and($module->trial_end)->toBeNull()
                ->and((int) $module->base_price_minor)->toBe(0)
                ->and(strtotime((string) $module->current_period_end))->toBeGreaterThan(strtotime('+5 years'));

            // Harmless: fake numbers only, .demo emails only, no WhatsApp, no card gateway.
            foreach (['guardians' => 'whatsapp_phone', 'students' => 'whatsapp_phone', 'teachers' => 'phone', 'staff' => 'phone', 'trials' => 'lead_whatsapp'] as $table => $column) {
                expect(DB::table($table)->where('academy_id', $id)->whereNotNull($column)->where($column, 'not like', '+20190000%')->count())
                    ->toBe(0, "a real-looking number in {$table}.{$column}");
            }
            expect(DB::table('users')->where('academy_id', $id)->where('email', 'not like', '%.demo')->count())->toBe(0)
                ->and(DB::table('academy_automation_settings')->where('academy_id', $id)->count())->toBe(0)
                ->and(DB::table('whatsapp_groups')->where('academy_id', $id)->count())->toBe(0)
                ->and(DB::table('academy_xpay_credentials')->where('academy_id', $id)->count())->toBe(0)
                ->and(DB::table('automation_send_log')->where('academy_id', $id)->count())->toBe(0);
        });
    }

    // ── The Quran academy: one-to-one lessons, packages and monthly bills, salaries ─────────────
    demoRead(DemoAcademies::QURAN, function (string $id): void {
        $capabilities = Entitlement::resolve($id)['capabilities'];
        expect($capabilities)->toContain('packages', 'invoicing', 'payroll', 'trials', 'supervision')
            ->and(array_intersect($capabilities, ['centre', 'accounting', 'whatsapp.automation', 'whatsapp.group_reminders']))->toBe([]);

        $count = fn (string $table, ?callable $where = null) => tap(DB::table($table)->where('academy_id', $id), $where ?? fn () => null)->count();

        expect($count('students'))->toBeBetween(35, 45)
            ->and($count('guardians'))->toBeBetween(20, 35)
            ->and($count('teachers'))->toBeBetween(6, 8)
            ->and(DB::table('teachers')->where('academy_id', $id)->distinct()->pluck('pay_type')->sort()->values()->all())->toBe(['FIXED', 'HOURLY', 'PER_STUDENT'])
            ->and($count('schedules'))->toBe($count('students'))
            ->and($count('sessions', fn ($q) => $q->where('status', 'ATTENDED')))->toBeBetween(600, 1600)
            ->and($count('sessions', fn ($q) => $q->whereIn('status', ['CANCELLED_BY_STUDENT', 'CANCELLED_BY_TEACHER'])))->toBeGreaterThan(20)
            // Something to do today, something still unmarked, and the weeks ahead on the calendar.
            ->and($count('sessions', fn ($q) => $q->where('occurrence_local_date', now('Africa/Cairo')->toDateString())))->toBeGreaterThan(3)
            ->and($count('sessions', fn ($q) => $q->where('status', 'SCHEDULED')->where('scheduled_at_utc', '<', demoAt(now()->subHours(5)))))->toBeBetween(2, 20)
            ->and($count('sessions', fn ($q) => $q->where('status', 'SCHEDULED')->where('scheduled_at_utc', '>', demoAt(now()->addDays(14)))))->toBeGreaterThan(50)
            ->and($count('sessions', fn ($q) => $q->where('scheduled_at_utc', '<', demoAt(now()->subDays(80)))))->toBeGreaterThan(50)
            ->and($count('session_reports'))->toBeGreaterThan(500)
            ->and($count('lesson_packages', fn ($q) => $q->where('status', 'ACTIVE')))->toBeGreaterThan(8)
            ->and($count('lesson_packages', fn ($q) => $q->where('status', 'COMPLETED')))->toBeGreaterThan(10)
            // The two who used their package up and have not renewed.
            ->and($count('lesson_packages', fn ($q) => $q->where('status', 'COMPLETED')->where('auto_renew', false)))->toBe(2)
            ->and($count('invoices', fn ($q) => $q->where('status', 'PAID')))->toBeGreaterThan(40)
            ->and($count('invoices', fn ($q) => $q->where('status', 'PARTIALLY_PAID')))->toBeGreaterThan(0)
            ->and($count('invoices', fn ($q) => $q->where('status', 'CLOSED')->where('total_minor', '>', 0)))->toBeGreaterThan(0)
            ->and($count('invoices', fn ($q) => $q->where('status', 'OPEN')))->toBeGreaterThan(5)
            // Seven teachers: three months sealed and this one open (one fewer sealed before the 3rd).
            ->and($count('payouts', fn ($q) => $q->whereNotNull('finalized_at')))->toBeGreaterThanOrEqual(14)
            ->and($count('payouts', fn ($q) => $q->whereNull('finalized_at')))->toBeGreaterThanOrEqual(7)
            ->and($count('payouts'))->toBe(28)
            ->and($count('payout_adjustments'))->toBe(3)
            ->and($count('trials'))->toBe(9)
            ->and($count('trials', fn ($q) => $q->where('status', 'CONVERTED')))->toBe(2)
            ->and($count('trials', fn ($q) => $q->where('status', 'SCHEDULED')))->toBe(3)
            ->and($count('notifications', fn ($q) => $q->where('category', '<>', 'ATTENDED')))->toBeGreaterThan(10)
            ->and($count('session_cancellation_requests', fn ($q) => $q->where('status', 'PENDING')))->toBe(2);

        // Every bill adds up, and nothing is dated in the future.
        expect(DB::selectOne(
            'select count(*) as n from invoices i where i.academy_id = ? and i.total_minor <> (select coalesce(sum(amount_minor), 0) from invoice_line_items li where li.invoice_id = i.id)', [$id]
        )->n)->toBe(0);
        expect($count('invoices', fn ($q) => $q->where('created_at', '>', demoAt(now()->addMinute()))))->toBe(0)
            ->and($count('sessions', fn ($q) => $q->where('status', '<>', 'SCHEDULED')->where('scheduled_at_utc', '>', demoAt(now()))))->toBe(0);
    });

    // ── The centre: groups and sheets, subscriptions, receipts and a treasury, salaries ─────────
    demoRead(DemoAcademies::CENTRE, function (string $id): void {
        $capabilities = Entitlement::resolve($id)['capabilities'];
        expect($capabilities)->toContain('centre', 'accounting', 'groups', 'invoicing', 'payroll')
            ->and(array_intersect($capabilities, ['packages', 'supervision', 'whatsapp.automation', 'whatsapp.group_reminders']))->toBe([]);

        $count = fn (string $table, ?callable $where = null) => tap(DB::table($table)->where('academy_id', $id), $where ?? fn () => null)->count();

        expect($count('students'))->toBeBetween(35, 45)
            ->and($count('guardians'))->toBeBetween(25, 40)
            ->and($count('teachers'))->toBeBetween(6, 8)
            ->and($count('academy_rooms'))->toBe(4)
            ->and($count('class_groups'))->toBe(11)
            ->and($count('class_group_members'))->toBeGreaterThan(50)
            ->and($count('class_group_lessons', fn ($q) => $q->where('status', 'HELD')))->toBeBetween(150, 500)
            ->and($count('class_group_lessons', fn ($q) => $q->where('status', 'SCHEDULED')->where('scheduled_at_utc', '>', demoAt(now()))))->toBeGreaterThan(30)
            ->and($count('class_group_attendance', fn ($q) => $q->whereIn('status', ['ABSENT', 'LATE', 'EXCUSED'])))->toBeGreaterThan(50)
            ->and($count('centre_subscriptions'))->toBeGreaterThan(10)
            ->and($count('centre_subscriptions', fn ($q) => $q->where('status', 'OPEN')))->toBeGreaterThan(3)
            ->and($count('centre_subscriptions', fn ($q) => $q->where('status', 'FINISHED')))->toBeGreaterThan(3)
            ->and($count('sessions', fn ($q) => $q->where('status', 'ATTENDED')))->toBeGreaterThan(100)
            ->and($count('receipts'))->toBeGreaterThan(80)
            ->and(DB::table('receipts')->where('academy_id', $id)->distinct()->count('method'))->toBeGreaterThan(2)
            ->and($count('receipts', fn ($q) => $q->where('payer_unknown', true)))->toBe(1)
            ->and($count('cash_accounts'))->toBe(4)
            ->and($count('expenses'))->toBeGreaterThan(30)
            ->and($count('expenses', fn ($q) => $q->whereNotNull('payout_id')))->toBeGreaterThan(8)
            ->and($count('cash_transfers'))->toBeGreaterThan(3)
            ->and($count('payouts', fn ($q) => $q->whereNotNull('finalized_at')))->toBeGreaterThanOrEqual(12)
            ->and($count('payouts', fn ($q) => $q->whereNull('finalized_at')))->toBeGreaterThan(4)
            ->and($count('notifications'))->toBeGreaterThan(5);

        // Arrears: charges nobody has paid yet, and receipts that cover the rest.
        $billed = (int) DB::table('invoice_line_items')->where('academy_id', $id)->sum('amount_minor');
        $paid = (int) DB::table('receipt_allocations')->where('academy_id', $id)->sum('amount_minor');
        expect($paid)->toBeGreaterThan(intdiv($billed, 2))->and($paid)->toBeLessThan($billed);

        // No account ever went below zero — not today, and not at the end of any day before it.
        $lowest = DB::select(
            'with moves as (
                select coalesce(r.cash_account_id, m.cash_account_id) as account, r.received_on as day, r.amount_minor as amount
                  from receipts r
                  left join cash_account_methods m on m.academy_id = r.academy_id and m.method = r.method and m.currency = r.currency
                 where r.academy_id = :a1 and r.voided_at is null
                union all select cash_account_id, spent_on, -amount_minor from expenses where academy_id = :a2 and voided_at is null
                union all select to_account_id, transferred_on, amount_minor from cash_transfers where academy_id = :a3 and voided_at is null
                union all select from_account_id, transferred_on, -amount_minor from cash_transfers where academy_id = :a4 and voided_at is null
             ), daily as (select account, day, sum(amount) as moved from moves group by 1, 2)
             select a.name, min(a.opening_balance_minor + d.running) as lowest
               from (select account, sum(moved) over (partition by account order by day) as running from daily) d
               join cash_accounts a on a.id = d.account
              group by 1',
            ['a1' => $id, 'a2' => $id, 'a3' => $id, 'a4' => $id],
        );
        expect($lowest)->toHaveCount(4);
        foreach ($lowest as $account) {
            expect((int) $account->lowest)->toBeGreaterThanOrEqual(0, "{$account->name} went below zero");
        }
        foreach (DB::table('cash_accounts')->where('academy_id', $id)->get() as $account) {
            expect(app(Treasury::class)->balanceOf($account, now('Africa/Cairo')->toDateString())['balance_minor'])->toBeGreaterThanOrEqual(0);
        }
    });

    // ── The logins that are handed out work, and the pages behind them answer ───────────────────
    $today = now('Africa/Cairo')->toDateString();
    demoSignInAndOpen('owner@quran.demo', [
        '/api/auth/me', '/api/entitlements', '/api/students', '/api/teachers', "/api/sessions/day?from={$today}&to={$today}", '/api/sessions/overdue',
        '/api/sessions/pending-attendance', "/api/calendar?from={$today}&to={$today}", '/api/invoices', '/api/invoices/summary',
        '/api/packages', '/api/packages/summary', '/api/payouts', '/api/trials', '/api/notifications', '/api/notifications/summary',
    ]);
    demoSignInAndOpen('teacher@quran.demo', ['/api/auth/me', "/api/sessions/day?from={$today}&to={$today}", '/api/students', '/api/me/payouts']);
    demoSignInAndOpen('owner@centre.demo', [
        '/api/auth/me', '/api/entitlements', '/api/dashboard/centre', '/api/students', '/api/teachers', '/api/groups', '/api/group-lessons',
        "/api/sessions/day?from={$today}&to={$today}", '/api/sessions/overdue', '/api/subscriptions', '/api/subscriptions/summary', '/api/invoices',
        '/api/receipts', '/api/accounting/overview', '/api/accounting/arrears', '/api/treasury', '/api/expenses', '/api/payouts', '/api/notifications',
    ]);
    demoSignInAndOpen('teacher@centre.demo', ['/api/auth/me', '/api/groups', '/api/group-lessons', '/api/me/payouts']);
    demoSignInAndOpen('desk@centre.demo', ['/api/auth/me', '/api/students', '/api/groups']);
    $this->flushSession();
    $this->clearTenantContext();

    // ── A second run: nothing added, nothing removed, and a changed password put back ───────────
    $before = [DemoAcademies::QURAN => demoRowCounts(DemoAcademies::QURAN), DemoAcademies::CENTRE => demoRowCounts(DemoAcademies::CENTRE)];
    demoRead(DemoAcademies::QURAN, fn (string $id) => DB::table('users')->where('academy_id', $id)->where('email', 'owner@quran.demo')
        ->update(['password' => bcrypt('a lead changed it'), 'is_active' => false]));

    $this->artisan('demo:academies')->expectsOutputToContain('Already there')->assertSuccessful();
    $this->clearTenantContext();

    // The audit log aside (a sign-in is audited), every table holds exactly what it held.
    foreach ($before as $key => $counts) {
        $after = demoRowCounts($key);
        unset($counts['audit_log'], $after['audit_log']);
        expect($after)->toBe($counts);
    }
    $this->flushSession();
    $this->withHeader('Origin', 'http://localhost:3000')
        ->postJson('/api/auth/login', ['email' => 'owner@quran.demo', 'password' => DemoAcademies::PASSWORD])
        ->assertOk();

    $this->asSuperAdmin();
    expect(DB::table('academies')->whereIn('id', DemoAcademies::IDS)->count())->toBe(2)
        ->and(DB::table('academies')->count())->toBe(count($others) + 2);
    $this->clearTenantContext();

    // ── And through all of it, everything that is not a demo academy is byte for byte what it was ─
    // (The sign-ins above are audited inside the demo academies and wrote nothing elsewhere.)
    $after = demoOutsideFingerprint($others);
    expect(array_keys(array_diff_assoc($after, $outside) + array_diff_assoc($outside, $after)))->toBe([]);

    // The neighbour's owner still sees their own academy, and only it.
    $this->flushSession();
    Sanctum::actingAs($this->neighbourOwner);
    $this->getJson('/api/students')->assertOk()->assertJsonPath('total', 1);
});
