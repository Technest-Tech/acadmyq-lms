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
 * Per-academy certificate templates. An academy owns exactly two templates — number 1
 * ("Royal Gold") and number 2 ("Geometric Mosaic") — whose editable wording/branding lives
 * in a single `content` JSONB blob; the visual design itself is rendered by the web client.
 *
 * RLS scopes every row to the caller's academy (the standard tenant_isolation policy), and the
 * read is gated on `certificate.read`, edits on `certificate.manage`. A template row is created
 * lazily on first save: a GET for an academy that has never edited a template returns sensible
 * defaults (with the academy's real name pre-filled) without persisting anything.
 */
final class CertificateTemplateController extends Controller
{
    /** The editable text fields the client may set, each a free-text string (bilingual pairs). */
    private const TEXT_FIELDS = [
        'academyNameEn', 'academyNameAr',
        'titleEn', 'titleAr',
        'presentationEn', 'presentationAr',
        'bodyEn', 'bodyAr',
        'signatoryNameEn', 'signatoryNameAr',
        'signatoryTitleEn', 'signatoryTitleAr',
    ];

    /** GET /api/certificate-templates — both templates (defaults filled where unsaved). */
    public function index(): JsonResponse
    {
        Gate::authorize('certificate.read');

        $academyId = $this->academyId(app(AuthContext::class));
        $academyName = (string) (DB::table('academies')->where('id', $academyId)->value('name') ?? '');

        $rows = DB::table('certificate_templates')
            ->where('academy_id', $academyId)
            ->get()
            ->keyBy('template_number');

        $templates = [];
        foreach ([1, 2] as $number) {
            $row = $rows->get($number);
            $content = self::defaults($number, $academyName);
            if ($row !== null) {
                $saved = json_decode((string) $row->content, true);
                if (is_array($saved)) {
                    $content = array_merge($content, $saved);
                }
            }
            $templates[] = [
                'templateNumber' => $number,
                'content' => $content,
            ];
        }

        return response()->json(['templates' => $templates]);
    }

    /** PUT /api/certificate-templates/{number} — upsert the editable content of one template. */
    public function update(Request $request, string $number): JsonResponse
    {
        Gate::authorize('certificate.manage');

        $n = (int) $number;
        if (! in_array($n, [1, 2], true)) {
            abort(404, 'Unknown certificate template.');
        }

        $rules = ['accentColor' => ['sometimes', 'nullable', 'string', 'regex:/^#[0-9A-Fa-f]{6}$/']];
        foreach (self::TEXT_FIELDS as $field) {
            $rules[$field] = ['sometimes', 'nullable', 'string', 'max:1000'];
        }
        $data = $request->validate($rules);

        $ctx = app(AuthContext::class);
        $academyId = $this->academyId($ctx);

        $existing = DB::table('certificate_templates')
            ->where('academy_id', $academyId)
            ->where('template_number', $n)
            ->first();

        $before = $existing !== null ? (json_decode((string) $existing->content, true) ?: []) : null;
        $content = array_merge(is_array($before) ? $before : [], $data);

        if ($existing !== null) {
            $rowId = (string) $existing->id;
            DB::table('certificate_templates')
                ->where('id', $rowId)
                ->update(['content' => json_encode($content), 'updated_at' => now()]);
        } else {
            $rowId = (string) Str::uuid();
            DB::table('certificate_templates')->insert([
                'id' => $rowId,
                'academy_id' => $academyId,
                'template_number' => $n,
                'content' => json_encode($content),
            ]);
        }

        Audit::log('certificate.manage', 'certificate_template', $rowId, $academyId, $ctx->userId, $ctx->role, after: $content, before: $before);

        return response()->json(['ok' => true, 'content' => $content]);
    }

    private function academyId(AuthContext $ctx): string
    {
        if ($ctx->academyId === null) {
            abort(403, 'Enter an academy to manage its certificate templates.');
        }

        return $ctx->academyId;
    }

    /**
     * Default wording for a template, with the academy's real name pre-filled. Kept here (not in
     * the DB) so a fresh academy gets a polished starting point with zero rows written.
     *
     * @return array<string,string>
     */
    private static function defaults(int $number, string $academyName): array
    {
        $common = [
            'academyNameEn' => $academyName,
            'academyNameAr' => $academyName,
            'signatoryNameEn' => '',
            'signatoryNameAr' => '',
        ];

        if ($number === 1) {
            return $common + [
                'titleEn' => 'Certificate of Achievement',
                'titleAr' => 'شهادة تقدير',
                'presentationEn' => 'This certificate is proudly presented to',
                'presentationAr' => 'تُمنح هذه الشهادة بكل فخر إلى',
                'bodyEn' => 'In recognition of outstanding dedication and excellence in Qur’anic studies and noble character.',
                'bodyAr' => 'تقديرًا للتميّز والاجتهاد المتواصل في دراسة القرآن الكريم وحُسن الخُلق.',
                'signatoryTitleEn' => 'Academy Director',
                'signatoryTitleAr' => 'مدير الأكاديمية',
                'accentColor' => '#C9A227',
            ];
        }

        return $common + [
            'titleEn' => 'Certificate of Excellence',
            'titleAr' => 'شهادة امتياز',
            'presentationEn' => 'Awarded with honour to',
            'presentationAr' => 'مُنحت بكل تقدير إلى',
            'bodyEn' => 'For successfully completing the memorization program with distinction and exemplary commitment.',
            'bodyAr' => 'لإتمام برنامج التحفيظ بتفوّق والتزام مثالي يُحتذى به.',
            'signatoryTitleEn' => 'Head of Studies',
            'signatoryTitleAr' => 'المشرف التعليمي',
            'accentColor' => '#0E7C5A',
        ];
    }
}
