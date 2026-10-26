<?php

declare(strict_types=1);

namespace App\Http\Controllers\People;

use App\Http\Controllers\Controller;
use App\Services\GuardianPortal;
use App\Services\Whatsapp\WhatsAppSender;
use App\Support\AcademyUrl;
use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\Tenancy;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * The parent's page (`/p/{token}`) — a private link per family, sent over WhatsApp, that opens a
 * read-only view of the children, their lessons, reports and the family's bills. No account and no
 * password: the link IS the credential, exactly like the `/i/` invoice link the academy already
 * sends, so it is long (48 base62 chars, ~285 bits) and the academy can replace it or switch it off.
 *
 * Staff side (on the family page): read / make / replace / switch off / send the link — reading is
 * `guardian.read`, everything that changes or sends it is `guardian.update`.
 *
 * Public side: the token resolves through app.guardian_portal_lookup (the one pre-context read, a
 * SECURITY DEFINER hatch), then the page is built inside that academy's tenant context with a
 * sentinel GUARDIAN role that matches no staff capability — RLS scopes every read just as it does
 * for a learner on the course site (ResolveAcademyContext).
 */
final class GuardianPortalController extends Controller
{
    private const TOKEN_LENGTH = 48;

    /** GET /api/guardians/{id}/portal — the family's link, or `url: null` if none was made yet. */
    public function show(string $id): JsonResponse
    {
        Gate::authorize('guardian.read');

        return response()->json($this->linkPayload($this->guardian($id)));
    }

    /**
     * POST /api/guardians/{id}/portal — make the link if the family has none. `{rotate: true}`
     * replaces an existing one: the old link stops working at once (a phone changed hands, a link
     * was forwarded where it should not have been).
     */
    public function issue(Request $request, string $id): JsonResponse
    {
        Gate::authorize('guardian.update');
        $rotate = (bool) ($request->validate(['rotate' => ['sometimes', 'boolean']])['rotate'] ?? false);

        $guardian = $this->guardian($id);
        if ($guardian->portal_token === null || $rotate) {
            $guardian = $this->mint($guardian, $guardian->portal_token !== null ? 'guardian.portal_rotated' : 'guardian.portal_issued');
        }

        return response()->json($this->linkPayload($guardian));
    }

    /** DELETE /api/guardians/{id}/portal — switch the page off; the link answers 404 from now on. */
    public function revoke(string $id): JsonResponse
    {
        Gate::authorize('guardian.update');
        $guardian = $this->guardian($id);

        if ($guardian->portal_token !== null) {
            DB::table('guardians')->where('id', $id)->update([
                'portal_token' => null,
                'portal_issued_at' => null,
                'updated_at' => now(),
            ]);
            $ctx = app(AuthContext::class);
            Audit::log('guardian.portal_revoked', 'guardian', $id, $ctx->academyId, $ctx->userId, $ctx->role);
        }

        return response()->json(['url' => null, 'issued_at' => null]);
    }

    /**
     * POST /api/guardians/{id}/portal/send — WhatsApp the link to the family (making it first if
     * needed): from the academy's own number when its WhatsApp is connected, otherwise the caller
     * gets the message back to open in wa.me, the same fallback every other send uses.
     */
    public function send(string $id): JsonResponse
    {
        Gate::authorize('guardian.update');

        $guardian = $this->guardian($id);
        if ($guardian->portal_token === null) {
            $guardian = $this->mint($guardian, 'guardian.portal_issued');
        }

        $ctx = app(AuthContext::class);
        $academyId = (string) $ctx->academyId;
        $url = $this->url($guardian->portal_token);
        $phone = (string) ($guardian->whatsapp_phone ?? '');
        $message = $this->message($this->academyName($academyId), (string) $guardian->full_name, $url);

        $send = app(WhatsAppSender::class)->sendOrLink($academyId, $phone, $message, [
            'automation_type' => 'MANUAL',
            'recipient_kind' => 'GUARDIAN',
            'recipient_id' => $id,
            'ref_type' => 'guardian_portal',
            'ref_id' => $id,
        ]);

        Audit::log('guardian.portal_sent', 'guardian', $id, $academyId, $ctx->userId, $ctx->role, after: ['phone' => $phone, 'sent' => $send['sent']]);

        return response()->json([
            'url' => $url,
            'phone' => $phone,
            'message' => $message,
            'transport' => $send['transport'],
            'sent' => $send['sent'],
        ]);
    }

    /**
     * GET /api/p/{token} — the parent's page. Every miss (unknown token, switched-off link, deleted
     * family, suspended academy) is the same 404, so nothing tells a guess apart from a dead link.
     */
    public function publicShow(string $token): JsonResponse
    {
        $row = DB::selectOne('select guardian_id, academy_id from app.guardian_portal_lookup(?)', [$token]);
        if ($row === null) {
            abort(404, 'Page not found.');
        }

        $ctx = new AuthContext(
            userId: '',
            academyId: (string) $row->academy_id,
            role: 'GUARDIAN',
            permissions: [],
        );
        app()->instance(AuthContext::class, $ctx);

        $payload = Tenancy::withContext(
            $ctx,
            fn (): array => app(GuardianPortal::class)->build((string) $row->guardian_id, (string) $row->academy_id),
        );

        // The same shielding as the invoice page: never cached by a proxy or the browser, never
        // indexed, so a forwarded link cannot surface through a crawler.
        return response()
            ->json($payload)
            ->header('Cache-Control', 'no-store')
            ->header('X-Robots-Tag', 'noindex, nofollow');
    }

    private function guardian(string $id): object
    {
        $guardian = DB::table('guardians')->where('id', $id)
            ->first(['id', 'full_name', 'whatsapp_phone', 'deleted_at', 'portal_token', 'portal_issued_at']);
        if ($guardian === null) {
            abort(404, 'Guardian not found.');
        }

        return $guardian;
    }

    /** A fresh token on the family — and an audit line, since it hands out access to their data. */
    private function mint(object $guardian, string $action): object
    {
        if ($guardian->deleted_at !== null) {
            throw ValidationException::withMessages([
                'guardian' => ['This family is inactive — reactivate it first. / هذه العائلة غير نشطة — فعّلها أولاً.'],
            ]);
        }

        $token = Str::random(self::TOKEN_LENGTH);
        $issuedAt = now()->toIso8601String();
        DB::table('guardians')->where('id', $guardian->id)->update([
            'portal_token' => $token,
            'portal_issued_at' => $issuedAt,
            'updated_at' => now(),
        ]);

        $ctx = app(AuthContext::class);
        Audit::log($action, 'guardian', (string) $guardian->id, $ctx->academyId, $ctx->userId, $ctx->role);

        $guardian->portal_token = $token;
        $guardian->portal_issued_at = $issuedAt;

        return $guardian;
    }

    /** @return array{url: ?string, issued_at: ?string} */
    private function linkPayload(object $guardian): array
    {
        return [
            'url' => $guardian->portal_token !== null ? $this->url((string) $guardian->portal_token) : null,
            'issued_at' => $guardian->portal_issued_at,
        ];
    }

    /** On the academy's own address (AcademyUrl), like every link a payer is handed. */
    private function url(string $token): string
    {
        return AcademyUrl::origin(app(AuthContext::class)->academyId).'/p/'.$token;
    }

    private function academyName(string $academyId): string
    {
        $academy = DB::table('academies')->where('id', $academyId)->first(['name', 'brand_display_name']);
        $name = trim((string) ($academy->brand_display_name ?? '')) ?: trim((string) ($academy->name ?? ''));

        return $name !== '' ? $name : 'Academy';
    }

    private function message(string $academy, string $guardian, string $url): string
    {
        $ar = [
            "🏫 *{$academy}*",
            "أهلاً {$guardian} 👋",
            'هذه صفحتكم الخاصة لمتابعة أبنائكم: الحصص القادمة، التقارير، والفواتير — في أي وقت ومن غير كلمة سر.',
            '',
            "🔗 {$url}",
            '',
            '🔒 الرابط خاص بكم، رجاءً لا تشاركوه.',
        ];
        $en = [
            "🏫 *{$academy}*",
            "Hello {$guardian} 👋",
            'Here is your private page to follow your children: upcoming lessons, reports and invoices — any time, no password needed.',
            '',
            "🔗 {$url}",
            '',
            '🔒 This link is personal — please don’t share it.',
        ];

        return implode("\n", $ar)."\n\n———\n\n".implode("\n", $en);
    }
}
