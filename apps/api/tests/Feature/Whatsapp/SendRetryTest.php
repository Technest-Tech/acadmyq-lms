<?php

declare(strict_types=1);

use App\Services\Whatsapp\WhatsAppSender;
use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/*
| A send that failed used to be final: its log row answered "already handled" for ever, so a bill
| that met a gateway restart was never sent. Now a failure that is certain not to have reached
| WhatsApp is tried again by the next call with the same key — and only that kind, because trying
| again after an ambiguous failure is how a parent gets the same bill twice.
*/

beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    $this->academyId = $this->createAcademy();
    $this->asAcademy($this->academyId);
    DB::table('academy_automation_settings')->insert([
        'id' => (string) Str::uuid(),
        'academy_id' => $this->academyId,
        'wasender_token' => Crypt::encryptString('session-token'),
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    // One fake for the whole test (a second Http::fake would be ignored): each test sets what the
    // gateway answers next, and every call is counted.
    $this->calls = 0;
    $this->answer = fn () => Http::response(['data' => ['msgId' => 'MSG-OK']], 200);
    Http::fake(function () {
        $this->calls++;

        return ($this->answer)();
    });

    $this->send = fn (): array => app(WhatsAppSender::class)->sendOrLink($this->academyId, '+201000000001', 'your bill', [
        'automation_type' => 'TYPE1_BILLING',
        'recipient_kind' => 'GUARDIAN',
        'dedupe_key' => 'type1:test:2026-11',
    ]);
    $this->row = fn () => DB::table('automation_send_log')->where('academy_id', $this->academyId)->where('dedupe_key', 'type1:test:2026-11')->get();
});

it('sends again after the gateway refused because the number was not linked', function () {
    $this->answer = fn () => Http::response(['error' => 'not_connected'], 409);
    $first = ($this->send)();
    expect($first['sent'])->toBeFalse();
    expect(($this->row)()->first()->status)->toBe('FAILED');

    $this->answer = fn () => Http::response(['data' => ['msgId' => 'MSG-2']], 200);
    $second = ($this->send)();

    expect($second['duplicate'])->toBeFalse();
    expect($second['sent'])->toBeTrue();
    expect($this->calls)->toBe(2);

    // The outcome is written back onto the same row — one logical send, one line in the log.
    $rows = ($this->row)();
    expect($rows)->toHaveCount(1);
    expect($rows->first()->status)->toBe('SENT');
    expect($rows->first()->error)->toBeNull();
    expect($rows->first()->provider_message_id)->toBe('MSG-2');

    // And once it went out, it is final again.
    expect(($this->send)()['duplicate'])->toBeTrue();
    expect($this->calls)->toBe(2);
});

it('sends again when the gateway could not be reached at all', function () {
    $this->answer = fn () => throw new ConnectionException('cURL error 7: Failed to connect to 127.0.0.1 port 8088');
    ($this->send)();
    expect(($this->row)()->first()->error)->toBe('gateway_unreachable');

    $this->answer = fn () => Http::response(['data' => ['msgId' => 'MSG-2']], 200);
    expect(($this->send)()['sent'])->toBeTrue();
});

it('never sends again after a timeout — the gateway may have taken the message', function () {
    $this->answer = fn () => throw new ConnectionException('cURL error 28: Operation timed out after 15001 milliseconds');
    ($this->send)();
    expect(($this->row)()->first()->error)->toBe('transport_error');

    $this->answer = fn () => Http::response(['data' => ['msgId' => 'MSG-2']], 200);
    expect(($this->send)()['duplicate'])->toBeTrue();
    expect($this->calls)->toBe(1);
});

it('follows what the gateway said later about an accepted message', function (string $error, bool $again) {
    ($this->send)();
    expect(($this->row)()->first()->status)->toBe('SENT');

    // The webhook's verdict on the accepted message.
    DB::table('automation_send_log')->where('provider_message_id', 'MSG-OK')->update(['status' => 'FAILED', 'error' => $error]);

    expect(($this->send)()['duplicate'])->toBe(! $again);
    expect($this->calls)->toBe($again ? 2 : 1);
})->with([
    'dropped from the queue unsent' => ['queue_cleared', true],
    'expired in the queue' => ['expired', true],
    'number is not on WhatsApp' => ['not_on_whatsapp', false],
    'send timed out mid-air' => ['send_timeout', false],
    'refused by WhatsApp' => ['ack_error_463', false],
]);

it('leaves an old failure alone', function () {
    $this->answer = fn () => Http::response(['error' => 'not_connected'], 409);
    ($this->send)();
    DB::table('automation_send_log')->where('academy_id', $this->academyId)->update(['created_at' => now()->subDays(4)]);

    $this->answer = fn () => Http::response(['data' => ['msgId' => 'MSG-2']], 200);
    expect(($this->send)()['duplicate'])->toBeTrue();
    expect($this->calls)->toBe(1);
});
