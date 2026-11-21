<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * `invoices.hand_made`: the bill was typed by someone at the desk (quick bill, itemized, advance).
 *
 * `kind = 'MANUAL'` never meant that: a package's bill, its overdraft bill, a centre subscription's
 * bill, a lesson bill re-issued without the package lessons and an AUTO bill moved with a child to a
 * family that already had one are all MANUAL too — so "Custom bills" listed every finished
 * package's bill beside the ones the desk made (Ahmed, 2026-11-22: "that page is only for the bills I
 * make by hand"). The list, its counts and its follow-up badge now read this flag.
 *
 * Backfill, by elimination ({@see fill()}): a MANUAL bill is hand-made unless something else raised
 * it — a package (its bill or its overdraft bill; a hand-made bill a first package was opened on
 * stays hand-made), a centre subscription, a package / subscription / re-issue audit — or it carries
 * lesson or group lines without being an advance bill (those are AUTO bills that changed kind).
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared('alter table invoices add column if not exists hand_made boolean not null default false;');

        $this->fill();
    }

    public function down(): void
    {
        DB::unprepared('alter table invoices drop column if exists hand_made;');
    }

    /** Public so the test suite can run it against fixtures. Returns how many bills were marked. */
    public function fill(): int
    {
        // One unit, so the tenant settings below hold for every statement (they are transaction-local).
        return DB::transaction(function (): int {
            DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");

            $marked = 0;
            // invoices, their lines, packages, subscriptions and audit_log are all under FORCE
            // row-level security: academy by academy, or the update sees no rows at all.
            foreach (DB::table('academies')->pluck('id')->all() as $id) {
                DB::statement("select set_config('app.current_academy_id', ?, true)", [(string) $id]);

                $marked += DB::update(<<<'SQL'
                    update invoices inv
                       set hand_made = true
                     where inv.kind = 'MANUAL'
                       and not inv.hand_made
                       and (not exists (select 1 from lesson_packages lp
                                         where lp.invoice_id = inv.id or lp.overdraft_invoice_id = inv.id)
                            or exists (select 1 from audit_log a
                                        where a.entity_id = inv.id and a.action = 'invoice.adopted_by_package'))
                       and not exists (select 1 from centre_subscriptions cs where cs.invoice_id = inv.id)
                       and not exists (select 1 from audit_log a
                                        where a.entity_id = inv.id and a.action = 'invoice.created'
                                          and a.after->>'mode' in ('PACKAGE', 'SUBSCRIPTION', 'REISSUED_WITHOUT_PACKAGE_LESSONS'))
                       and (not exists (select 1 from invoice_line_items li
                                         where li.invoice_id = inv.id
                                           and (li.session_id is not null or li.class_group_id is not null
                                                or li.class_group_lesson_id is not null or li.group_cycle is not null))
                            or exists (select 1 from audit_log a
                                        where a.entity_id = inv.id and a.action = 'invoice.created' and a.after->>'mode' = 'ADVANCE'))
                SQL);
            }
            DB::statement("select set_config('app.current_academy_id', '', true)");

            return $marked;
        });
    }
};
