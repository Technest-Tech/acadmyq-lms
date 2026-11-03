<?php

declare(strict_types=1);

use App\Support\AcademyProfile;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * The CENTRE academy type (App\Support\AcademyProfile): the learning centre — English course
 * academies and curriculum "سناتر" — that teaches groups, sells subscriptions in lessons and keeps
 * receipts. Until now every client on the platform carried the QURAN type, the centre included, so
 * "type" described nothing; from here it names the client's PROFILE, which the Super Admin picks
 * when creating a client and which `profile:set` moves an existing one to.
 *
 * Catalog row only. No academy changes type here: moving a live client is a deliberate, named
 * step (`php artisan profile:set`), never a side effect of a deploy.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");

        $exists = DB::table('academy_types')->where('code', AcademyProfile::CENTRE)->exists();
        if ($exists) {
            return;
        }

        DB::table('academy_types')->insert([
            'id' => (string) Str::uuid(),
            'code' => AcademyProfile::CENTRE,
            'name' => 'Learning centre',
            'description' => 'Group classes, subscriptions in lessons, numbered receipts — English course academies and curriculum centres.',
            // A centre writes no per-lesson memorisation report, so it seeds no report fields.
            'report_field_template' => '[]',
        ]);
    }

    public function down(): void
    {
        // Only while nothing points at it — an academy on the type would otherwise lose its row.
        $used = DB::table('academies as a')
            ->join('academy_types as t', 't.id', '=', 'a.academy_type_id')
            ->where('t.code', AcademyProfile::CENTRE)
            ->exists();
        if (! $used) {
            DB::table('academy_types')->where('code', AcademyProfile::CENTRE)->delete();
        }
    }
};
