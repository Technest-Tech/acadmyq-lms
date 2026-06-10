<?php

declare(strict_types=1);

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;

/*
| Public health check (Master Spec / Sprint 0 §5). No auth.
| Returns 200 with a degraded payload (db: "error") rather than crashing
| when the database is unreachable — TC-0.9 / TC-0.10 / TC-0.11.
*/
Route::get('/health', function (): JsonResponse {
    $db = 'ok';

    try {
        DB::select('select 1');
    } catch (Throwable) {
        $db = 'error';
    }

    return response()->json([
        'app' => 'ok',
        'db' => $db,
        'version' => config('app.version'),
        'time' => now()->utc()->toIso8601String(),
    ]);
});

// Sanctum-authenticated user (wired in Sprint 2; present here per install:api scaffold).
Route::get('/user', fn (Request $request) => $request->user())
    ->middleware('auth:sanctum');
