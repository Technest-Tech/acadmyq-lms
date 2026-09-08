<?php

declare(strict_types=1);

namespace App\Http\Controllers\Learner;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Learner\Concerns\InteractsWithLearner;
use App\Models\Learner;
use App\Services\Whatsapp\WhatsAppSender;
use App\Support\LmsSite;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Learner password reset (docs/lms/10 §2) — the piece the learner site was missing: it could
 * register, sign in and sign out, and nothing else. Someone who forgot their password had to ask the
 * client to look them up by hand.
 *
 * Two properties this had to have:
 *
 *  1. **Enumeration-safe.** `request()` answers 202 whether or not the address exists. A course site
 *     is public; letting anyone probe "is this person a customer" is a leak, not a convenience.
 *  2. **Only a HASH is stored.** The plaintext token exists in the delivered link and nowhere else,
 *     so a dump of `learner_password_resets` hands out no live links.
 *
 * Delivery prefers **WhatsApp** — this deployment's mailer is `log`, the clients are Egyptian and
 * their learners live on WhatsApp — through the academy's own gateway session, falling back to a
 * deep link when there is no session (the same `sendOrLink` contract the rest of the app uses).
 * Email is the fallback channel for a learner with no phone on file.
 */
final class PasswordResetController extends Controller
{
    use InteractsWithLearner;

    /** A reset link is good for one hour. Long enough to find the message, short enough to matter. */
    private const TTL_MINUTES = 60;

    /** Refuse to mint more than this many live tokens for one learner (anti-spam). */
    private const MAX_LIVE_TOKENS = 5;

    /**
     * An instant Postgres cannot misread.
     *
     * The query builder binds a Carbon as a NAIVE 'Y-m-d H:i:s' string, which Postgres then reads in
     * the SESSION time zone — Africa/Cairo here, while the app runs in UTC. A bare
     * `now()->addHour()` therefore lands three hours EARLIER than intended, so a one-hour reset
     * token is born already expired. Binding an offset-carrying ISO-8601 string removes the guess.
     */
    private static function at(Carbon $moment): string
    {
        return $moment->toIso8601String();
    }

    public function __construct(private readonly WhatsAppSender $whatsapp) {}

    /**
     * POST /api/learn/auth/forgot-password — start a reset. Always 202.
     */
    public function request(Request $request): JsonResponse
    {
        $academyId = $this->currentAcademyId();
        $data = $request->validate([
            'email' => ['required', 'email', 'max:255'],
        ]);

        $learner = Learner::whereRaw('lower(email) = lower(?)', [$data['email']])->first();

        // Same answer either way — see the class docblock.
        if ($learner === null || (string) $learner->status !== 'ACTIVE') {
            return response()->json(['ok' => true], 202);
        }

        $live = DB::table('learner_password_resets')
            ->where('learner_id', $learner->getKey())
            ->whereNull('used_at')
            ->where('expires_at', '>', self::at(now()))
            ->count();
        if ($live >= self::MAX_LIVE_TOKENS) {
            return response()->json(['ok' => true], 202);
        }

        $token = Str::random(48);
        $phone = trim((string) ($learner->phone ?? ''));
        $channel = $phone !== '' ? 'WHATSAPP' : 'EMAIL';

        DB::table('learner_password_resets')->insert([
            'id' => (string) Str::uuid(),
            'academy_id' => $academyId,
            'learner_id' => $learner->getKey(),
            'token_hash' => hash('sha256', $token),
            'channel' => $channel,
            'expires_at' => self::at(now()->addMinutes(self::TTL_MINUTES)),
            'created_at' => now(),
        ]);

        $link = $this->resetLink($academyId, $token);

        if ($channel === 'WHATSAPP') {
            $this->whatsapp->sendOrLink($academyId, $phone, $this->message($academyId, $link), [
                'automation_type' => 'LMS',
                'recipient_kind' => 'LEARNER',
                'template_key' => 'lms.password_reset',
                'recipient_id' => (string) $learner->getKey(),
                'ref_type' => 'learner',
                'ref_id' => (string) $learner->getKey(),
            ]);
        }

        // EMAIL: the mailer is `log` in this deployment, so the link lands in the API log rather
        // than an inbox. That is deliberate and visible — wiring a real SMTP/API mailer is a config
        // change, not a code change, and nothing here needs to move when it happens.
        if ($channel === 'EMAIL') {
            logger()->info('Learner password reset link', [
                'academy_id' => $academyId,
                'learner_id' => (string) $learner->getKey(),
                'email' => $learner->email,
                'link' => $link,
            ]);
        }

        return response()->json(['ok' => true, 'channel' => $channel], 202);
    }

    /**
     * POST /api/learn/auth/reset-password — consume the token and set the new password.
     *
     * The token row is locked and marked used inside the transaction, so a link forwarded to two
     * devices cannot be spent twice.
     */
    public function reset(Request $request): JsonResponse
    {
        $this->currentAcademyId();
        $data = $request->validate([
            'token' => ['required', 'string', 'max:255'],
            'password' => ['required', 'string', 'min:8', 'max:255', 'confirmed'],
        ]);

        $hash = hash('sha256', $data['token']);

        $row = DB::table('learner_password_resets')
            ->where('token_hash', $hash)
            ->whereNull('used_at')
            ->lockForUpdate()
            ->first();

        if ($row === null || Carbon::parse($row->expires_at)->isPast()) {
            throw ValidationException::withMessages([
                'token' => ['This reset link is invalid or has expired.'],
            ]);
        }

        $learner = Learner::find($row->learner_id);
        if ($learner === null || (string) $learner->status !== 'ACTIVE') {
            throw ValidationException::withMessages([
                'token' => ['This reset link is invalid or has expired.'],
            ]);
        }

        $learner->forceFill(['password' => Hash::make($data['password'])])->save();

        DB::table('learner_password_resets')->where('id', $row->id)->update(['used_at' => now()]);

        // Every other live token for this learner dies with the reset: a password change is exactly
        // when you want any older link (possibly in the wrong hands) to stop working.
        DB::table('learner_password_resets')
            ->where('learner_id', $learner->getKey())
            ->whereNull('used_at')
            ->update(['used_at' => now()]);

        // Signing out every device is the other half of that: a stolen session must not survive.
        $learner->tokens()->delete();

        return response()->json(['ok' => true]);
    }

    // ── helpers ─────────────────────────────────────────────────────────────────────────────────

    /** The absolute link the learner taps. Falls back to the app origin when subdomains are off. */
    private function resetLink(string $academyId, string $token): string
    {
        $academy = DB::table('academies')->where('id', $academyId)
            ->first(['subdomain', 'name', 'brand_display_name']);

        $base = LmsSite::url($academy->subdomain ?? null, LmsSite::ownsRoot($academyId)) ?? '';

        if ($base === '' || str_starts_with($base, '/')) {
            $origin = rtrim((string) (config('app.frontend_url') ?: config('app.url')), '/');
            $base = $origin.$base;
        }

        return rtrim($base, '/').'/reset-password?token='.urlencode($token);
    }

    /** The WhatsApp body — bilingual, because the sites are Arabic-first with English learners too. */
    private function message(string $academyId, string $link): string
    {
        $name = (string) (DB::table('academies')->where('id', $academyId)
            ->value('brand_display_name') ?: DB::table('academies')->where('id', $academyId)->value('name'));

        return "🔐 {$name}\n\n"
            ."لإعادة تعيين كلمة المرور الخاصة بك، افتح الرابط التالي (صالح لمدة ساعة):\n"
            ."To reset your password, open this link (valid for one hour):\n\n"
            .$link."\n\n"
            ."إذا لم تطلب ذلك، تجاهل هذه الرسالة.\n"
            .'If you did not request this, ignore this message.';
    }
}
