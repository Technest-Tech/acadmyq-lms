<?php

declare(strict_types=1);

return [
    /*
    |--------------------------------------------------------------------------
    | Attendance timing grace (Sprint 6 §3.7, AC-6.9)
    |--------------------------------------------------------------------------
    |
    | How many minutes BEFORE a session's start time an outcome may be recorded.
    | Default 0 = a session may only be marked once its start time has arrived or
    | passed, preventing future lessons from being marked attended (which would
    | inflate billing). An Owner/Super Admin may still override the gate with an
    | audited correction for genuine real-world cases.
    |
    */
    'grace_minutes' => (int) env('ATTENDANCE_GRACE_MINUTES', 0),
];
