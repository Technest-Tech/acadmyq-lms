<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The sales half of a course (docs/lms/09 §4). Everything a buyer weighs before paying that the
 * curriculum itself cannot say: what they will be able to DO afterwards, what they need first, who
 * the course is for, how hard it is and what shelf it belongs on.
 *
 * Stored on `courses` rather than in the site profile because these are per-course facts, not
 * per-site branding — two courses from the same academy have different outcomes.
 *
 * The three lists are jsonb arrays of short strings (the sales page renders each as a bullet). They
 * default to `[]`, so every existing course keeps rendering exactly as it does today and the new
 * blocks simply do not appear until their owner writes them — nothing is invented on their behalf.
 *
 * `level` is a closed enum because it drives a catalogue facet; `category` is free text because the
 * subject of a course is the client's vocabulary, not ours (a Qur'an academy and a coding school do
 * not share a taxonomy), and the catalogue derives its filter options from the values in use.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table courses
              add column level        text
                check (level is null or level in ('BEGINNER','INTERMEDIATE','ADVANCED','ALL_LEVELS')),
              add column category     text,
              add column outcomes     jsonb not null default '[]'::jsonb,
              add column requirements jsonb not null default '[]'::jsonb,
              add column audience     jsonb not null default '[]'::jsonb;
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            alter table courses
              drop column if exists level,
              drop column if exists category,
              drop column if exists outcomes,
              drop column if exists requirements,
              drop column if exists audience;
        SQL);
    }
};
