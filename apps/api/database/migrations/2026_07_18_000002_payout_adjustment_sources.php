<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Where a reward/deduction CAME FROM. Until now every `payout_adjustments` row was typed by a human
 * on the payout statement; three things now write them, and the statement must say which:
 *
 *   • MANUAL          — the owner/support typed it (the pre-existing behaviour; the default, so
 *                       every historical row keeps its meaning).
 *   • QUALITY         — derived from a `teacher_quality_reports` row. Recomputed by
 *                       {@see \App\Services\TeacherQuality::syncPayout} while the payout is OPEN,
 *                       because a MONTHLY report docks a PERCENT of a total that grows all month.
 *   • AUTO_UNREPORTED — written by AutoDeductUnreportedSessionsJob: the teacher never marked a
 *                       delivered session, so the system docked them with a stated reason.
 *
 * Two partial unique indexes carry the idempotency guarantees that make the derived rows safe:
 *   • one AUTO_UNREPORTED row per session — the hourly sweep can re-run forever without stacking
 *     deductions (`insertOrIgnore` turns the re-run into a no-op, mirroring how the overdue-report
 *     sweep dedupes on notifications(session_id, type));
 *   • one adjustment per quality report — a report costs exactly one deduction, and deleting the
 *     report cascades the money away with it.
 *
 * A derived row must never rewrite a FINALIZED statement, so the open-only rule that already
 * covered INSERT and DELETE is extended to UPDATE — the refresh path can only touch OPEN payouts.
 */
return new class extends Migration
{
    public function up(): void
    {
        // ------------------------------------------------------------------
        // 1 – Provenance + the links that make a derived row traceable back to
        //     the session or the quality report that caused it.
        // ------------------------------------------------------------------
        DB::unprepared(<<<'SQL'
            alter table payout_adjustments
                add column if not exists source            text not null default 'MANUAL',
                add column if not exists session_id        uuid references sessions(id) on delete set null,
                add column if not exists quality_report_id uuid references teacher_quality_reports(id) on delete cascade;

            alter table payout_adjustments
                add constraint payout_adjustments_source_chk
                check (source in ('MANUAL','QUALITY','AUTO_UNREPORTED'));
        SQL);

        // ------------------------------------------------------------------
        // 2 – Idempotency for the two automatic writers.
        // ------------------------------------------------------------------
        DB::unprepared(<<<'SQL'
            create unique index payout_adjustments_auto_session_uniq
              on payout_adjustments (session_id) where source = 'AUTO_UNREPORTED';

            create unique index payout_adjustments_quality_report_uniq
              on payout_adjustments (quality_report_id) where quality_report_id is not null;

            create index payout_adjustments_source_idx on payout_adjustments (academy_id, source);
        SQL);

        // ------------------------------------------------------------------
        // 3 – Extend open-only immutability to UPDATE. The QUALITY refresh rewrites
        //     `amount_minor` in place as the month accrues; once the statement is
        //     finalized that money is real and the row must stop moving.
        // ------------------------------------------------------------------
        DB::unprepared(<<<'SQL'
            create or replace function forbid_adjustment_update_on_finalized_payout() returns trigger
            language plpgsql as $$
            declare f timestamptz;
            begin
              select finalized_at into f from payouts where id = new.payout_id;
              if f is not null then
                raise exception 'cannot modify an adjustment on a finalized payout';
              end if;
              return new;
            end;
            $$;

            create trigger trg_adjustment_no_update_finalized before update on payout_adjustments
              for each row execute function forbid_adjustment_update_on_finalized_payout();
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop trigger if exists trg_adjustment_no_update_finalized on payout_adjustments;
            drop function if exists forbid_adjustment_update_on_finalized_payout();

            drop index if exists payout_adjustments_source_idx;
            drop index if exists payout_adjustments_quality_report_uniq;
            drop index if exists payout_adjustments_auto_session_uniq;

            alter table payout_adjustments drop constraint if exists payout_adjustments_source_chk;
            alter table payout_adjustments
                drop column if exists quality_report_id,
                drop column if exists session_id,
                drop column if exists source;
        SQL);
    }
};
