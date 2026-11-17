<?php

declare(strict_types=1);

namespace App\Support;

use App\Services\GroupLessonGenerator;
use App\Services\StudentRestore;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Super Admin → client page → "Deleted" (2026-11-17): everything an academy has deleted, and the
 * way back for what can come back.
 *
 * Two kinds of delete exist in the app:
 *  - recoverable (a `deleted_at`, or a group ARCHIVED) — listed under {@see KINDS}, each with a
 *    restore that undoes what that delete did (a student's is {@see StudentRestore});
 *  - permanent (the row is gone: a teacher deleted for good, a hand-made bill, a lesson) — only the
 *    audit trail is left, so they are listed in a read-only log ({@see HARD_DELETES}).
 *
 * Every read and write runs inside the client's own tenant context (the caller wraps it).
 */
final class ClientDeleted
{
    /** Recoverable kinds → the audit action their delete writes (for "deleted by"). */
    public const KINDS = [
        'family' => 'guardian.delete',
        'student' => 'student.delete',
        'teacher' => 'teacher.deactivate',
        'staff' => 'staff.deactivate',
        'trial' => 'trial.delete',
        'lead' => 'crm_lead.delete',
        'group' => 'class_group.archived',
        'course' => 'course.delete',
        'post' => 'lms_post.delete',
        'product' => 'lms_product.delete',
    ];

    /** Permanent deletes: listed from the audit trail, never restorable. */
    public const HARD_DELETES = [
        'teacher.delete', 'invoice.deleted', 'class_group.deleted', 'session.deleted', 'payout.deleted',
        'lesson.delete', 'course_section.delete', 'quiz.delete', 'access_code.delete', 'level.deleted',
        'room.deleted', 'role.delete', 'academy_holiday.deleted', 'lms_booking.delete', 'lms_booking_form.delete',
        'group_assessment.deleted',
    ];

    private const PER_KIND = 500;

    private const LOG_LIMIT = 300;

    /**
     * @return array{items: list<array<string, mixed>>, log: list<array<string, mixed>>}
     */
    public static function list(string $academyId): array
    {
        $items = [];

        // Families, with the children who went with them.
        $guardians = DB::table('guardians')->where('academy_id', $academyId)->whereNotNull('deleted_at')
            ->orderByDesc('deleted_at')->limit(self::PER_KIND)->get(['id', 'full_name', 'whatsapp_phone', 'deleted_at']);
        $children = DB::table('students')->whereIn('guardian_id', $guardians->pluck('id'))->whereNotNull('deleted_at')
            ->orderBy('full_name')->get(['id', 'guardian_id', 'full_name'])->groupBy('guardian_id');
        foreach ($guardians as $g) {
            $items[] = self::row('family', $g->id, $g->full_name, $g->deleted_at, [
                'phone' => $g->whatsapp_phone,
                'children' => ($children[$g->id] ?? collect())->pluck('full_name')->values()->all(),
            ]);
        }

        // Students on their own: a child of a deleted family is restored with the family.
        $students = DB::table('students as s')->leftJoin('guardians as g', 'g.id', '=', 's.guardian_id')
            ->where('s.academy_id', $academyId)->whereNotNull('s.deleted_at')
            ->where(fn ($q) => $q->whereNull('s.guardian_id')->orWhereNull('g.deleted_at'))
            ->orderByDesc('s.deleted_at')->limit(self::PER_KIND)
            ->get(['s.id', 's.full_name', 's.whatsapp_phone', 's.deleted_at', 'g.full_name as guardian_name']);
        foreach ($students as $s) {
            $items[] = self::row('student', $s->id, $s->full_name, $s->deleted_at, ['phone' => $s->whatsapp_phone, 'guardian' => $s->guardian_name]);
        }

        foreach (self::simple($academyId, 'teachers', ['phone']) as $t) {
            $items[] = self::row('teacher', $t->id, $t->full_name, $t->deleted_at, ['phone' => $t->phone]);
        }
        foreach (self::simple($academyId, 'staff', ['department']) as $s) {
            $items[] = self::row('staff', $s->id, $s->full_name, $s->deleted_at, ['department' => $s->department]);
        }

        $trials = DB::table('trials as t')->leftJoin('students as s', 's.id', '=', 't.student_id')
            ->where('t.academy_id', $academyId)->whereNotNull('t.deleted_at')->orderByDesc('t.deleted_at')->limit(self::PER_KIND)
            ->get(['t.id', 't.deleted_at', 't.scheduled_at_utc', 't.lead_name', 's.full_name as student_name']);
        foreach ($trials as $t) {
            $items[] = self::row('trial', $t->id, $t->student_name ?? $t->lead_name ?? '—', $t->deleted_at, ['when' => $t->scheduled_at_utc]);
        }

        foreach (self::simple($academyId, 'crm_leads', ['whatsapp_phone', 'status']) as $l) {
            $items[] = self::row('lead', $l->id, $l->full_name, $l->deleted_at, ['phone' => $l->whatsapp_phone, 'status' => $l->status]);
        }

        $groups = DB::table('class_groups')->where('academy_id', $academyId)->where('status', 'ARCHIVED')
            ->orderByDesc('archived_at')->limit(self::PER_KIND)->get(['id', 'name', 'archived_at']);
        foreach ($groups as $g) {
            $items[] = self::row('group', $g->id, $g->name, $g->archived_at, []);
        }

        foreach (['course' => 'courses', 'post' => 'blog_posts', 'product' => 'digital_products'] as $kind => $table) {
            $rows = DB::table($table)->where('academy_id', $academyId)->whereNotNull('deleted_at')
                ->orderByDesc('deleted_at')->limit(self::PER_KIND)->get(['id', 'title', 'status', 'deleted_at']);
            foreach ($rows as $r) {
                $items[] = self::row($kind, $r->id, $r->title, $r->deleted_at, ['status' => $r->status]);
            }
        }

        $items = self::withDeletedBy($academyId, $items);
        usort($items, fn ($a, $b) => strcmp((string) $b['deleted_at'], (string) $a['deleted_at']));

        return ['items' => $items, 'log' => self::log($academyId)];
    }

    /**
     * Restore one item. Runs inside the caller's transaction; the caller rolls it back for a preview.
     *
     * @return array{done: list<array<string, mixed>>, skipped: list<array<string, mixed>>}
     */
    public static function restore(string $kind, string $academyId, string $id, ?string $actorUserId): array
    {
        return match ($kind) {
            'family' => self::restoreFamily($academyId, $id, $actorUserId),
            'student' => app(StudentRestore::class)->run(self::deletedOrFail('students', $academyId, $id)->id, $actorUserId),
            'teacher' => self::restorePerson('teachers', 'teacher', $academyId, $id, $actorUserId),
            'staff' => self::restorePerson('staff', 'staff', $academyId, $id, $actorUserId),
            'trial' => self::restoreRow('trials', 'trial', $academyId, $id, $actorUserId, fn ($r) => $r->lead_name),
            'lead' => self::restoreRow('crm_leads', 'lead', $academyId, $id, $actorUserId, fn ($r) => $r->full_name),
            'course' => self::restoreRow('courses', 'course', $academyId, $id, $actorUserId, fn ($r) => $r->title),
            'post' => self::restoreRow('blog_posts', 'post', $academyId, $id, $actorUserId, fn ($r) => $r->title),
            'product' => self::restoreRow('digital_products', 'product', $academyId, $id, $actorUserId, fn ($r) => $r->title),
            'group' => self::restoreGroup($academyId, $id, $actorUserId),
            default => abort(404, 'Nothing of that kind can be restored.'),
        };
    }

    // ── Restores ────────────────────────────────────────────────────────

    private static function restoreFamily(string $academyId, string $id, ?string $actorUserId): array
    {
        $guardian = self::deletedOrFail('guardians', $academyId, $id);
        DB::table('guardians')->where('id', $id)->update(['deleted_at' => null, 'updated_at' => now()]);
        $done = [['key' => 'family', 'label' => (string) $guardian->full_name]];
        $skipped = [];

        // The children this delete took: named in its audit row, else deleted around the same moment.
        $audit = DB::table('audit_log')->where('academy_id', $academyId)->where('action', 'guardian.delete')
            ->where('entity_id', $id)->orderByDesc('created_at')->value('after');
        $named = (array) (json_decode((string) $audit, true)['removed_children'] ?? []);
        $at = Carbon::parse((string) $guardian->deleted_at);
        $around = DB::table('students')->where('guardian_id', $id)->whereNotNull('deleted_at')
            ->whereBetween('deleted_at', [$at->copy()->subHours(StudentRestore::WINDOW_HOURS), $at->copy()->addHours(StudentRestore::WINDOW_HOURS)])
            ->pluck('id')->map(fn ($c) => (string) $c)->all();
        $childIds = DB::table('students')->where('guardian_id', $id)->whereNotNull('deleted_at')
            ->whereIn('id', array_values(array_unique([...$named, ...$around])))->pluck('id');

        foreach ($childIds as $childId) {
            $report = app(StudentRestore::class)->run((string) $childId, $actorUserId);
            // The family line is already said once.
            $done = [...$done, ...array_values(array_filter($report['done'], fn ($d) => $d['key'] !== 'family'))];
            $skipped = [...$skipped, ...$report['skipped']];
        }

        // The "former parent" lead the delete dropped into the CRM, if nobody has touched it since.
        $leadIds = DB::table('audit_log')->where('academy_id', $academyId)->where('action', 'crm.lead_created')
            ->whereRaw("after->>'from_guardian' = ?", [$id])->pluck('entity_id')->map(fn ($l) => (string) $l)->all();
        if ($leadIds !== []) {
            $leads = DB::table('crm_leads')->whereIn('id', $leadIds)->whereNull('deleted_at')->where('status', 'LOST')
                ->whereNull('converted_student_id')->whereColumn('updated_at', 'created_at')
                ->update(['deleted_at' => now()]);
            if ($leads > 0) {
                $done[] = ['key' => 'lead_removed', 'n' => $leads];
            }
        }

        Audit::log('guardian.restored', 'guardian', $id, $academyId, $actorUserId, 'SUPER_ADMIN',
            after: ['children' => $childIds->map(fn ($c) => (string) $c)->all()], before: ['deleted_at' => (string) $guardian->deleted_at]);

        return ['done' => $done, 'skipped' => $skipped];
    }

    /** A deactivated teacher or employee: back on the roster, sign-in back on. */
    private static function restorePerson(string $table, string $key, string $academyId, string $id, ?string $actorUserId): array
    {
        $row = self::deletedOrFail($table, $academyId, $id);
        DB::table($table)->where('id', $id)->update(['is_active' => true, 'deleted_at' => null, 'updated_at' => now()]);
        $done = [['key' => $key, 'label' => (string) $row->full_name]];
        if ($row->user_id !== null) {
            DB::table('users')->where('id', $row->user_id)->update(['is_active' => true, 'updated_at' => now()]);
            $done[] = ['key' => 'login'];
        }
        Audit::log($key.'.reactivate', $key, $id, $academyId, $actorUserId, 'SUPER_ADMIN', after: ['is_active' => true, 'login_restored' => $row->user_id !== null]);

        return ['done' => $done, 'skipped' => []];
    }

    private static function restoreRow(string $table, string $key, string $academyId, string $id, ?string $actorUserId, callable $label): array
    {
        $row = self::deletedOrFail($table, $academyId, $id);
        DB::table($table)->where('id', $id)->update(['deleted_at' => null, 'updated_at' => now()]);
        Audit::log($key.'.restored', $key, $id, $academyId, $actorUserId, 'SUPER_ADMIN', before: ['deleted_at' => (string) $row->deleted_at]);

        return ['done' => [['key' => $key, 'label' => $label($row)]], 'skipped' => []];
    }

    /** An archived group: active again, its lessons generated forward (as the academy's own restore). */
    private static function restoreGroup(string $academyId, string $id, ?string $actorUserId): array
    {
        $group = DB::table('class_groups')->where('academy_id', $academyId)->where('id', $id)->where('status', 'ARCHIVED')->first();
        abort_if($group === null, 404, 'Archived group not found.');
        DB::table('class_groups')->where('id', $id)->update(['status' => 'ACTIVE', 'archived_at' => null, 'updated_at' => now()]);
        $counts = app(GroupLessonGenerator::class)->regenerate($id);
        Audit::log('class_group.restored', 'class_group', $id, $academyId, $actorUserId, 'SUPER_ADMIN',
            after: ['status' => 'ACTIVE', 'generated' => $counts], before: ['status' => 'ARCHIVED']);

        return ['done' => [['key' => 'group', 'label' => (string) $group->name], ['key' => 'group_lessons', 'n' => (int) ($counts['created'] ?? 0)]], 'skipped' => []];
    }

    // ── Reading ─────────────────────────────────────────────────────────

    private static function deletedOrFail(string $table, string $academyId, string $id): object
    {
        $row = DB::table($table)->where('academy_id', $academyId)->where('id', $id)->whereNotNull('deleted_at')->first();
        abort_if($row === null, 404, 'Not found among this client\'s deleted records.');

        return $row;
    }

    /** @param list<string> $extra */
    private static function simple(string $academyId, string $table, array $extra): Collection
    {
        return DB::table($table)->where('academy_id', $academyId)->whereNotNull('deleted_at')
            ->orderByDesc('deleted_at')->limit(self::PER_KIND)->get(['id', 'full_name', 'deleted_at', ...$extra]);
    }

    /** @param array<string, mixed> $detail */
    private static function row(string $kind, string $id, ?string $label, mixed $deletedAt, array $detail): array
    {
        return [
            'kind' => $kind, 'id' => $id, 'label' => (string) ($label ?? '—'),
            'deleted_at' => $deletedAt !== null ? Carbon::parse((string) $deletedAt)->toIso8601String() : null,
            'deleted_by' => null, 'detail' => $detail,
        ];
    }

    /**
     * Who deleted each item, from its delete's audit row (the latest one, when deleted twice).
     *
     * @param  list<array<string, mixed>>  $items
     * @return list<array<string, mixed>>
     */
    private static function withDeletedBy(string $academyId, array $items): array
    {
        if ($items === []) {
            return [];
        }
        $rows = DB::table('audit_log as l')->leftJoin('users as u', 'u.id', '=', 'l.actor_user_id')
            ->where('l.academy_id', $academyId)->whereIn('l.action', array_values(self::KINDS))
            ->whereIn('l.entity_id', array_column($items, 'id'))
            ->orderBy('l.created_at')
            ->get(['l.action', 'l.entity_id', 'l.actor_role', 'u.full_name']);
        $by = [];
        foreach ($rows as $r) {
            $by[$r->action.'|'.$r->entity_id] = $r->full_name ?? ($r->actor_role === 'SUPER_ADMIN' ? 'Super Admin' : null);
        }
        foreach ($items as &$item) {
            $item['deleted_by'] = $by[self::KINDS[$item['kind']].'|'.$item['id']] ?? null;
        }

        return $items;
    }

    /** @return list<array<string, mixed>> */
    private static function log(string $academyId): array
    {
        $rows = DB::table('audit_log as l')->leftJoin('users as u', 'u.id', '=', 'l.actor_user_id')
            ->where('l.academy_id', $academyId)->whereIn('l.action', self::HARD_DELETES)
            ->orderByDesc('l.created_at')->limit(self::LOG_LIMIT)
            ->get(['l.id', 'l.action', 'l.entity_id', 'l.before', 'l.created_at', 'l.actor_role', 'u.full_name']);

        // A deleted lesson keeps its row (hidden): name it by its student and date.
        $sessionIds = $rows->where('action', 'session.deleted')->pluck('entity_id')->filter()->all();
        $sessions = $sessionIds === [] ? collect() : DB::table('sessions as se')->leftJoin('students as s', 's.id', '=', 'se.student_id')
            ->whereIn('se.id', $sessionIds)->get(['se.id', 'se.scheduled_at_utc', 's.full_name'])->keyBy('id');

        return $rows->map(function ($r) use ($sessions) {
            $before = json_decode((string) $r->before, true) ?: [];
            $label = $before['full_name'] ?? $before['name'] ?? $before['title'] ?? $before['code'] ?? null;
            $when = null;
            if ($r->action === 'session.deleted' && ($s = $sessions[$r->entity_id] ?? null) !== null) {
                $label = $s->full_name;
                $when = $s->scheduled_at_utc !== null ? Carbon::parse((string) $s->scheduled_at_utc)->toIso8601String() : null;
            }

            return [
                'id' => (string) $r->id,
                'action' => (string) $r->action,
                'label' => $label !== null ? (string) $label : null,
                'amount_minor' => isset($before['total_minor']) ? (int) $before['total_minor'] : null,
                'currency' => $before['currency'] ?? null,
                'when' => $when,
                'deleted_at' => Carbon::parse((string) $r->created_at)->toIso8601String(),
                'deleted_by' => $r->full_name ?? ($r->actor_role === 'SUPER_ADMIN' ? 'Super Admin' : null),
            ];
        })->values()->all();
    }
}
