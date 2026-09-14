<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Certificates grew from two designs to a catalogue. `template_number` was pinned to `in (1, 2)`,
 * so every new design would have needed its own migration just to be saveable.
 *
 * The check becomes a CEILING rather than the list: `CertificateTemplateController::DESIGNS` is the
 * catalogue (it 404s a number it does not know), and the database only refuses numbers no design
 * could ever carry. Existing rows are 1 and 2, so nothing is rewritten.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table certificate_templates drop constraint if exists certificate_templates_template_number_check;
            alter table certificate_templates add constraint certificate_templates_template_number_check
              check (template_number between 1 and 32);
        SQL);
    }

    /**
     * The delete runs under the table's forced RLS, so a non-superuser migrator may not see the rows
     * it is meant to remove — `not valid` keeps the rollback from failing on a survivor.
     */
    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            delete from certificate_templates where template_number not in (1, 2);
            alter table certificate_templates drop constraint if exists certificate_templates_template_number_check;
            alter table certificate_templates add constraint certificate_templates_template_number_check
              check (template_number in (1, 2)) not valid;
        SQL);
    }
};
