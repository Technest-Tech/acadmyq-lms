<?php

declare(strict_types=1);

/*
| Platform↔Academy subscription billing knobs. These tune the academy's SaaS subscription
| (free trial length, what happens at trial expiry, bill due window) — NOT the per-student
| invoicing engine.
*/
return [

    // Default free-trial length for a new academy subscription (days).
    'trial_days' => (int) env('BILLING_TRIAL_DAYS', 14),

    // On trial expiry, also SUSPEND the academy (blocks login until they convert/pay). When
    // false, the trial is only flagged (subscription PAUSED) and the academy keeps access.
    'trial_expiry_suspends' => filter_var(env('BILLING_TRIAL_EXPIRY_SUSPENDS', true), FILTER_VALIDATE_BOOL),

    // Days from issue to due date on a generated academy bill.
    'due_days' => (int) env('BILLING_DUE_DAYS', 7),

    // Default billing interval for a newly activated subscription.
    'default_interval' => env('BILLING_DEFAULT_INTERVAL', 'MONTHLY'),

];
