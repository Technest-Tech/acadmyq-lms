<?php

declare(strict_types=1);

use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/*
|--------------------------------------------------------------------------
| Test Case
|--------------------------------------------------------------------------
|
| The closure you provide to your test functions is always bound to a specific PHPUnit test
| case class. By default, that class is "PHPUnit\Framework\TestCase". Of course, you may
| need to change it using the "pest()" function to bind a different classes or traits.
|
*/

pest()->extend(TestCase::class)
 // ->use(Illuminate\Foundation\Testing\RefreshDatabase::class)
    ->in('Feature');

/*
|--------------------------------------------------------------------------
| Expectations
|--------------------------------------------------------------------------
|
| When you're writing tests, you often need to check that values meet certain conditions. The
| "expect()" function gives you access to a set of "expectations" methods that you can use
| to assert different things. Of course, you may extend the Expectation API at any time.
|
*/

expect()->extend('toBeOne', function () {
    return $this->toBe(1);
});

/*
|--------------------------------------------------------------------------
| Functions
|--------------------------------------------------------------------------
|
| While Pest is very powerful out-of-the-box, you may have some testing code specific to your
| project that you don't want to repeat in every file. Here you can also expose helpers as
| global functions to help you to reduce the number of lines of code in your test files.
|
*/

function something()
{
    // ..
}

/**
 * Insert a WhatsApp external API key for an academy (in its RLS context) and return the plaintext.
 * Requires the calling test to use InteractsWithTenancy. See docs/whatsapp-api.
 */
function makeWhatsAppApiKey(string $academyId, array $overrides = []): string
{
    $plain = 'wa_'.Str::random(48);
    test()->enterAcademyAsSuperAdmin($academyId);
    DB::table('whatsapp_api_keys')->insert(array_merge([
        'id' => (string) Str::uuid(),
        'academy_id' => $academyId,
        'name' => 'Test key',
        'key_prefix' => substr($plain, 0, 11),
        'key_hash' => hash('sha256', $plain),
        'created_at' => now(),
        'updated_at' => now(),
    ], $overrides));
    test()->clearTenantContext();

    return $plain;
}

/** Give an academy a connected gateway token (encrypted) so the WhatsAppSender uses the WASENDER path. */
function giveWhatsAppToken(string $academyId, string $token = 'gw-token'): void
{
    test()->enterAcademyAsSuperAdmin($academyId);
    DB::table('academy_automation_settings')->updateOrInsert(
        ['academy_id' => $academyId],
        [
            'id' => (string) Str::uuid(),
            'wasender_token' => Crypt::encryptString($token),
            'wa_session_id' => 'sess-'.substr($academyId, 0, 8),
            'wasender_session_status' => 'connected',
            'updated_at' => now(),
        ],
    );
    test()->clearTenantContext();
}
