<?php

declare(strict_types=1);

namespace App\Http\Controllers\Groups\Concerns;

use Illuminate\Support\Facades\Gate;

/**
 * Who may write on a group's grade sheet and term reports (docs/centre-profile, Phase 2 §5). The
 * same two doors the attendance sheet has: running the group (`group.manage`), or being the group's
 * own teacher with the right to mark lessons (`session.mark_attendance`, row-scoped through
 * {@see InteractsWithClassGroups::findGroup}). A substitute who covered one lesson can read the
 * group but does not grade it. Publishing a report to the parent is `group.manage` alone — the
 * controller asks for that itself.
 */
trait MarksOwnGroup
{
    use InteractsWithClassGroups;

    /** Pass when the caller runs groups, or teaches THIS one and marks lessons; 403 otherwise. */
    protected function authorizeMarking(object $group): void
    {
        if (Gate::allows('group.manage')) {
            return;
        }
        Gate::authorize('session.mark_attendance');
        if (! $this->isTeacher() || (string) $group->teacher_id !== $this->ownTeacherId()) {
            abort(403, 'Only the group\'s teacher may grade it.');
        }
    }

    protected function canMark(object $group): bool
    {
        if (Gate::allows('group.manage')) {
            return true;
        }

        return Gate::allows('session.mark_attendance') && $this->isTeacher() && (string) $group->teacher_id === $this->callerTeacherId();
    }
}
