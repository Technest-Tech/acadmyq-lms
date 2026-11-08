<?php

declare(strict_types=1);

namespace App\Http\Controllers\Public;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * Public, no-auth pay page of a client's ACCOUNT (Super Admin → Accounts). The client opens
 * /a/{token}, sees what it owes now (late + due within a week, from the owner's book) with the
 * platform's InstaPay/Vodafone Cash receiving details, and uploads a transfer screenshot; the
 * owner approves it on Accounts → Dues and it lands in the book as a payment.
 *
 * The token is the account's `pay_token`; a link to an old per-module bill (sent before the book
 * took over) still opens its academy's account. All access goes through SECURITY DEFINER
 * functions (bypass role) so the controller never needs a context; the tables stay Super-Admin
 * only. Sits OUTSIDE auth:sanctum/tenant.context (the public throttle group).
 */
final class AcademyPaymentController extends Controller
{
    /** GET /api/a/{token} — what the account owes now + active receiving methods. no-store + noindex. */
    public function show(string $token): JsonResponse
    {
        $rows = DB::select('select app.public_account_by_token(?) as data', [$token]);
        $raw = $rows[0]->data ?? null;

        if ($raw === null) {
            abort(404, 'Bill not found.');
        }

        $dto = is_string($raw) ? json_decode($raw, true) : (array) $raw;
        if (empty($dto)) {
            abort(404, 'Bill not found.');
        }

        return response()->json($dto)
            ->header('Cache-Control', 'no-store')
            ->header('X-Robots-Tag', 'noindex, nofollow');
    }

    /** POST /api/a/{token}/submit — store a transfer screenshot + record a PENDING submission. */
    public function submit(Request $request, string $token): JsonResponse
    {
        $data = $request->validate([
            'method' => ['required', Rule::in(['INSTAPAY', 'VODAFONE_CASH'])],
            'screenshot' => ['required', 'file', 'image', 'max:20480'], // ≤ 20 MB image — an iPhone PNG screenshot runs past 5 MB
            'amount' => ['nullable', 'integer', 'min:0'],
            'note' => ['nullable', 'string', 'max:1000'],
        ]);

        // Store to the PRIVATE disk under a token-prefixed, randomized path (never the public disk).
        $file = $request->file('screenshot');
        $ext = $file->extension() ?: 'jpg';
        $dir = 'account-payments/'.substr((string) preg_replace('/[^A-Za-z0-9]/', '', $token), 0, 12);
        $path = $file->storeAs($dir, (string) Str::uuid().'.'.$ext, 'local');

        $rows = DB::select('select app.submit_account_payment(?, ?, ?, ?, ?) as data', [
            $token,
            $data['method'],
            $path,
            $data['amount'] ?? null,
            $data['note'] ?? null,
        ]);
        $raw = $rows[0]->data ?? null;
        $res = is_string($raw) ? json_decode($raw, true) : (array) ($raw ?? []);

        if ($raw === null || $res === []) {
            Storage::disk('local')->delete($path);
            abort(404, 'Bill not found.');
        }
        if (($res['ok'] ?? false) !== true) {
            Storage::disk('local')->delete($path);
            abort(422, 'This account can no longer accept payments.');
        }

        return response()->json(['ok' => true])->header('Cache-Control', 'no-store');
    }
}
