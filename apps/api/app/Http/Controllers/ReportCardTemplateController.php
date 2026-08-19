<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Support\Audit;
use App\Support\AuthContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;

/**
 * The per-academy REPORT CARD template — the academy's own voice on the shareable session/trial
 * report image (the design itself is rendered by the web client, like certificates).
 *
 * Only the wording that repeats on EVERY card lives here: the headline, the opening line, the note
 * to the child, the du'a, the closing tagline, and the accent colour. The per-session facts come
 * from `session_reports`. Every text field supports three placeholders the client substitutes at
 * render time — `{academy}`, `{student}`, `{teacher}` — so one saved sentence greets every child
 * by name.
 *
 * Reading is gated on `session.read` (anyone who can open a session can preview its card) and
 * editing on `report_field.manage` — the same capability that shapes what a session report asks
 * for, held by the Owner and by a Super Admin acting inside the academy. A row is created lazily
 * on first save: a GET for an academy that has never edited returns polished defaults with the
 * academy's real name pre-filled, without persisting anything.
 */
final class ReportCardTemplateController extends Controller
{
    /** The editable text fields (bilingual pairs), each free text with {placeholder} support. */
    private const TEXT_FIELDS = [
        'headlineAr', 'headlineEn',
        'introAr', 'introEn',
        'championMessageAr', 'championMessageEn',
        'duaAr', 'duaEn',
        'taglineAr', 'taglineEn',
    ];

    /** GET /api/report-card-template — the academy's card wording (defaults where unsaved). */
    public function show(): JsonResponse
    {
        Gate::authorize('session.read');

        $academyId = $this->academyId(app(AuthContext::class));

        $row = DB::table('report_card_templates')->where('academy_id', $academyId)->first();

        $content = self::defaults();
        if ($row !== null) {
            $saved = json_decode((string) $row->content, true);
            if (is_array($saved)) {
                $content = array_merge($content, $saved);
            }
        }

        return response()->json(['content' => $content]);
    }

    /** PUT /api/report-card-template — upsert the editable content (merged over what exists). */
    public function update(Request $request): JsonResponse
    {
        Gate::authorize('report_field.manage');

        $rules = [
            'accentColor' => ['sometimes', 'nullable', 'string', 'regex:/^#[0-9A-Fa-f]{6}$/'],
            'cardStyle' => ['sometimes', 'string', 'in:joyful,classic'],
        ];
        foreach (self::TEXT_FIELDS as $field) {
            $rules[$field] = ['sometimes', 'nullable', 'string', 'max:1000'];
        }
        $data = $request->validate($rules);

        $ctx = app(AuthContext::class);
        $academyId = $this->academyId($ctx);

        $existing = DB::table('report_card_templates')->where('academy_id', $academyId)->first();
        $before = $existing !== null ? (json_decode((string) $existing->content, true) ?: []) : null;
        $content = array_merge(is_array($before) ? $before : [], $data);

        if ($existing !== null) {
            $rowId = (string) $existing->id;
            DB::table('report_card_templates')->where('id', $rowId)->update([
                'content' => json_encode($content, JSON_UNESCAPED_UNICODE),
                'updated_at' => now(),
            ]);
        } else {
            $rowId = (string) Str::uuid();
            DB::table('report_card_templates')->insert([
                'id' => $rowId,
                'academy_id' => $academyId,
                'content' => json_encode($content, JSON_UNESCAPED_UNICODE),
            ]);
        }

        Audit::log('report_card.manage', 'report_card_template', $rowId, $academyId, $ctx->userId, $ctx->role, after: $content, before: $before);

        return response()->json(['ok' => true, 'content' => $content]);
    }

    private function academyId(AuthContext $ctx): string
    {
        if ($ctx->academyId === null) {
            abort(403, 'Enter an academy to manage its report card.');
        }

        return $ctx->academyId;
    }

    /**
     * Default wording. Kept here (not in the DB) so a fresh academy gets a card worth sending on
     * day one with zero rows written. Written in the warm, congratulatory register Egyptian Qur'an
     * academies actually use with parents — every word of it editable, because a language school
     * or a coding academy will want its own. `{academy}` resolves client-side from the session's
     * brand display name, so the header stays correct even after the academy is renamed.
     *
     * @return array<string,string>
     */
    private static function defaults(): array
    {
        return [
            // No `{academy}` here on purpose: the card already carries the academy's name and logo
            // in the header directly above the headline, so the default would read it twice. The
            // placeholder still works for an academy that wants it.
            'headlineAr' => 'تقرير إنجاز بطلنا اليوم',
            'headlineEn' => "Today's Champion Report",

            'introAr' => 'يسعدنا أن نشارككم تفاصيل حلقة بطلنا اليوم، سائلين الله أن يبارك في خطواته ويجعله من أهل القرآن وخاصته.',
            'introEn' => "We're delighted to share how {student}'s lesson went today, and we pray these steps are always blessed.",

            'championMessageAr' => 'أحسنت يا بطل 👏 كل آية تحفظها هي خطوة جديدة نحو قلبٍ عامر بالقرآن، فاستمر ولا تتوقف… فمع كل تكرار يزداد حفظك، ومع كل آية يزداد نور قلبك.',
            'championMessageEn' => 'Well done, champion 👏 Every verse you memorise is another step towards a heart filled with the Qur’an. Keep going — with every repetition your memory grows, and with every verse your heart grows brighter.',

            'duaAr' => 'اللهم اجعل القرآن ربيع قلبه، ونور صدره، ورفيق دربه، وارزقه حفظه وفهمه والعمل به، واجعله من أهل القرآن وخاصتك.',
            'duaEn' => 'O Allah, make the Qur’an the delight of their heart, the light of their chest and the companion of their path; grant them its memorisation, its understanding, and the practice of it.',

            'taglineAr' => 'نزرع حب القرآن… ونبني جيلًا من أهله',
            'taglineEn' => 'Planting a love of the Qur’an — raising a generation of its people',

            'accentColor' => '#0E7C5A',

            // The card's whole point is that a child WANTS to look at it, so the illustrated style
            // is the default; an academy teaching adults switches to 'classic' in Settings.
            'cardStyle' => 'joyful',
        ];
    }
}
