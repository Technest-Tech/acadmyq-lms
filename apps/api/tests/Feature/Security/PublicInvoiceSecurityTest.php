<?php

declare(strict_types=1);

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class);

/**
 * Sprint 9 §6.2 — adversarial pen tests on the public invoice page (TC-9.15–9.18). The page
 * is the one anonymous, unauthenticated surface, so it is the highest-value attack target:
 * the tests deliberately ATTEMPT enumeration, cross-tenant leakage, mutation and indexing,
 * and assert each fails.
 */
beforeEach(function () {
    $this->A = $this->createAcademy(overrides: ['name' => 'Alpha Academy']);
    $this->B = $this->createAcademy(overrides: ['name' => 'Beta Academy']);

    $gA = $this->createGuardian($this->A, ['full_name' => 'Guardian Alpha']);
    [$this->invA, $this->tokenA] = $this->createInvoice($this->A, $gA, ['total_minor' => 50000, 'subtotal_minor' => 50000]);

    $gB = $this->createGuardian($this->B, ['full_name' => 'Guardian Beta']);
    [$this->invB, $this->tokenB] = $this->createInvoice($this->B, $gB);

    $this->clearTenantContext();
});

// ── TC-9.15: enumeration yields 404 with no exists/doesn't-exist signal ──────────
it('returns an identical 404 for every guessed or sequential token', function () {
    $bodies = [];
    foreach (['0', '1', 'aaaaaaaa', str_repeat('z', 40), (string) Str::uuid(), 'abc123'] as $guess) {
        $res = $this->getJson("/api/i/{$guess}");
        $res->assertStatus(404);
        $bodies[] = $res->json('message');
    }
    // Every miss returns the SAME message — nothing distinguishes "exists" from "doesn't".
    expect(array_unique($bodies))->toHaveCount(1);
});

// ── TC-9.16: a valid token renders only its own invoice, no other tenant's data ──
it('renders only the matching invoice and leaks no other tenant data', function () {
    $res = $this->getJson("/api/i/{$this->tokenA}")->assertOk();

    expect($res->json('academy_name'))->toBe('Alpha Academy');
    expect($res->json('payer_name'))->toBe('Guardian Alpha');

    // No trace of academy B anywhere in the serialized response.
    $body = $res->getContent();
    expect($body)->not->toContain('Beta Academy');
    expect($body)->not->toContain('Guardian Beta');
    expect($body)->not->toContain($this->invB);
    expect($body)->not->toContain($this->B);
    // No raw tenant identifiers are exposed — only the curated display payload.
    expect($res->json('academy_id'))->toBeNull();
});

// ── TC-9.17: mutation rejected, noindex set, rate-limit triggers ─────────────────
it('rejects mutation, sets noindex, and is rate-limited', function () {
    // The public route is GET-only — any mutation verb is 405.
    $this->postJson("/api/i/{$this->tokenA}")->assertStatus(405);
    $this->patchJson("/api/i/{$this->tokenA}")->assertStatus(405);
    $this->deleteJson("/api/i/{$this->tokenA}")->assertStatus(405);

    // noindex + no-store on the rendered page.
    $res = $this->get("/api/i/{$this->tokenA}");
    $res->assertOk();
    expect($res->headers->get('X-Robots-Tag'))->toContain('noindex');
    expect($res->headers->get('Cache-Control'))->toContain('no-store');

    // Rate limited at 60/min/IP — the 61st request in a window is throttled (429).
    $throttled = false;
    for ($i = 0; $i < 65; $i++) {
        if ($this->get("/api/i/{$this->tokenA}")->getStatusCode() === 429) {
            $throttled = true;
            break;
        }
    }
    expect($throttled)->toBeTrue();
});

// ── TC-9.18: token entropy ≥ 128 bits ────────────────────────────────────────────
it('issues public tokens with at least 128 bits of entropy', function () {
    $this->asAcademy($this->A);
    $token = DB::table('invoices')->where('id', $this->invA)->value('public_token');
    // base62 (a–z A–Z 0–9) → log2(62) ≈ 5.954 bits/char. Production issues 48-char tokens
    // (~285 bits); even the 40-char test fixtures clear 128 bits (~238 bits).
    $bits = strlen((string) $token) * log(62, 2);
    expect($bits)->toBeGreaterThanOrEqual(128.0);
    expect((string) $token)->toMatch('/^[A-Za-z0-9]+$/');
});
