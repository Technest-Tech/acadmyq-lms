<?php

declare(strict_types=1);

namespace App\Demo;

use App\Services\ClientPurge;
use App\Support\Audit;
use App\Support\AuthContext;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use InvalidArgumentException;

/**
 * The two demo academies handed to a sales lead: a one-to-one Quran academy and a learning centre,
 * each already alive with three months of lessons, bills and salaries (see {@see DemoBuilder}).
 *
 * They are the ONLY academies this code may touch. Both carry a fixed id, every write runs inside
 * that academy's own tenant context, and {@see assertOwn()} refuses any other id before a single
 * statement is sent — so running this on a database full of real clients can change nothing of
 * theirs.
 */
final class DemoAcademies
{
    public const QURAN = 'quran';

    public const CENTRE = 'centre';

    /** Fixed ids: what makes a re-run find its own academies, and nothing else. */
    public const IDS = [
        self::QURAN => 'de300000-0000-7000-8000-00000000000a',
        self::CENTRE => 'de300000-0000-7000-8000-00000000000c',
    ];

    /** One password for every demo login. Not a secret: it is handed to every lead. */
    public const PASSWORD = 'Acadmyq-Demo#2026';

    /** Fewer lessons than this in the whole database: a test or development one. */
    public const SMALL_DATABASE_LESSONS = 5000;

    private const BUILDERS = [
        self::QURAN => QuranDemo::class,
        self::CENTRE => CentreDemo::class,
    ];

    public function __construct(private readonly ClientPurge $purge) {}

    /** Refuse an academy that is not one of the two. Every entry point calls this first. */
    public static function assertOwn(string $academyId): void
    {
        if (! in_array($academyId, self::IDS, true)) {
            throw new InvalidArgumentException("Refusing to touch academy {$academyId}: it is not a demo academy.");
        }
    }

    /** @return list<string> */
    public static function keys(): array
    {
        return array_keys(self::IDS);
    }

    /**
     * The logins printed for a lead.
     *
     * @return list<array{role: string, email: string}>
     */
    public static function logins(string $key): array
    {
        return self::BUILDERS[$key]::LOGINS;
    }

    /** @return array{name: string, subdomain: string} */
    public static function describe(string $key): array
    {
        return ['name' => self::BUILDERS[$key]::NAME, 'subdomain' => self::BUILDERS[$key]::SUBDOMAIN];
    }

    public function exists(string $key): bool
    {
        $id = self::IDS[$key];

        return $this->asPlatform(fn (): bool => DB::table('academies')->where('id', $id)->exists());
    }

    /**
     * What would stop a build before it starts: a demo email or address already used by a real client.
     *
     * @return list<string>
     */
    public function conflicts(string $key): array
    {
        $id = self::IDS[$key];
        $emails = self::BUILDERS[$key]::emails();
        $subdomain = self::BUILDERS[$key]::SUBDOMAIN;

        return $this->asPlatform(function () use ($id, $emails, $subdomain): array {
            $problems = [];
            if (DB::table('academies')->where('subdomain', $subdomain)->where('id', '<>', $id)->exists()) {
                $problems[] = "The address \"{$subdomain}\" already belongs to another academy.";
            }
            // `users` is tenant-scoped: read it through the login lookup, which sees every academy.
            foreach ($emails as $email) {
                $owner = DB::selectOne('select academy_id from app.auth_find_by_email(?)', [$email]);
                if ($owner !== null && (string) $owner->academy_id !== $id) {
                    $problems[] = "The email {$email} already belongs to a user outside the demo academy.";
                }
            }

            return $problems;
        });
    }

    /**
     * Delete one demo academy and everything it owns, through the same purge a Super Admin's
     * "delete client" uses.
     *
     * @return array<string, int> rows removed per table
     */
    public function purge(string $key): array
    {
        $id = self::IDS[$key];
        self::assertOwn($id);

        // On a small database the planner may still believe these tables are empty (above all when
        // the academy was built on this same connection, as a test does), and then checks every
        // foreign key of every deleted row by reading whole tables.
        if (self::smallDatabase()) {
            DB::statement('analyze');
        }

        return $this->purge->purge($id, new AuthContext(
            userId: Audit::SYSTEM_ACTOR_ID,
            academyId: $id,
            role: 'SUPER_ADMIN',
            permissions: [],
        ));
    }

    /**
     * Build one demo academy around `$now`.
     *
     * @return array{counts: array<string, int>, warnings: list<string>}
     */
    public function build(string $key, CarbonImmutable $now, int $months = 3): array
    {
        $id = self::IDS[$key];
        self::assertOwn($id);

        $class = self::BUILDERS[$key];

        return (new $class($id, $now, $months))->build();
    }

    /**
     * Put the printed logins back the way they are handed out — the shared password, switched on —
     * in case a lead changed one. Returns how many logins it found.
     */
    public function restoreLogins(string $key): int
    {
        $id = self::IDS[$key];
        self::assertOwn($id);
        $emails = array_column(self::logins($key), 'email');

        return DB::transaction(function () use ($id, $emails): int {
            DB::statement("select set_config('app.current_academy_id', ?, true)", [$id]);
            DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");

            return DB::table('users')
                ->where('academy_id', $id)
                ->whereIn('email', $emails)
                ->update(['password' => Hash::make(self::PASSWORD), 'is_active' => true, 'updated_at' => now()]);
        });
    }

    /**
     * Is this a test or development database — one whose lessons table is still small enough that
     * its statistics cannot be trusted? Where real clients' lessons run to the thousands this is
     * false, and nothing here ever runs ANALYZE (which would hold its lock on shared tables until
     * the transaction ends).
     */
    public static function smallDatabase(): bool
    {
        return (float) DB::selectOne("select reltuples from pg_class where oid = 'public.sessions'::regclass")->reltuples < self::SMALL_DATABASE_LESSONS;
    }

    /**
     * @template T
     *
     * @param  callable(): T  $fn
     * @return T
     */
    private function asPlatform(callable $fn): mixed
    {
        return DB::transaction(function () use ($fn) {
            DB::statement("select set_config('app.current_academy_id', '', true)");
            DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");

            return $fn();
        });
    }
}
