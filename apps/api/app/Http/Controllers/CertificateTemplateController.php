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
 * Per-academy certificate templates. The web client owns a catalogue of certificate DESIGNS
 * (`certificate-designs.tsx`); an academy owns one row per design it has edited, holding that
 * design's wording/branding in a single `content` JSONB blob.
 *
 * RLS scopes every row to the caller's academy (the standard tenant_isolation policy), and the
 * read is gated on `certificate.read`, edits on `certificate.manage`. A template row is created
 * lazily on first save: a GET for an academy that has never edited a design returns that design's
 * defaults (with the academy's real name pre-filled) without persisting anything.
 *
 * BRAND CARRIES OVER. Who signs, and in whose name, does not change with the paper it is printed
 * on — so a design the academy has never opened inherits the brand fields of the template it saved
 * most recently. Wording (title, body…) stays per design: it is written to suit the artwork.
 */
final class CertificateTemplateController extends Controller
{
    /**
     * The design catalogue, by number. Numbers are permanent — a saved row points at one — so a
     * retired design keeps its number and a new design takes the next one.
     *
     *  1 Al-Noor · 2 Al-Andalus · 3 Mihrab   (heritage)
     *  4 Diwan   · 5 Layl                    (classic)
     *  6 Safa    · 7 Manara                  (modern)
     *  8 Bustan  · 9 Nujoom                  (children)
     */
    public const DESIGNS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

    /** The editable text fields the client may set, each a free-text string (bilingual pairs). */
    private const TEXT_FIELDS = [
        'academyNameEn', 'academyNameAr',
        'titleEn', 'titleAr',
        'presentationEn', 'presentationAr',
        'bodyEn', 'bodyAr',
        'signatoryNameEn', 'signatoryNameAr',
        'signatoryTitleEn', 'signatoryTitleAr',
        'signatory2NameEn', 'signatory2NameAr',
        'signatory2TitleEn', 'signatory2TitleAr',
    ];

    /** The fields that describe the ACADEMY rather than the design — inherited across designs. */
    private const BRAND_FIELDS = [
        'academyNameEn', 'academyNameAr',
        'signatoryNameEn', 'signatoryNameAr',
        'signatoryTitleEn', 'signatoryTitleAr',
        'signatory2NameEn', 'signatory2NameAr',
        'signatory2TitleEn', 'signatory2TitleAr',
        'showLogo',
    ];

    /** GET /api/certificate-templates — every design (defaults filled where unsaved). */
    public function index(): JsonResponse
    {
        Gate::authorize('certificate.read');

        $academyId = $this->academyId(app(AuthContext::class));
        $academyName = (string) (DB::table('academies')->where('id', $academyId)->value('name') ?? '');

        $rows = DB::table('certificate_templates')
            ->where('academy_id', $academyId)
            ->orderByDesc('updated_at')
            ->get();

        // The most recently saved template speaks for the academy's brand.
        $latest = $rows->first();
        $brand = [];
        if ($latest !== null) {
            $saved = json_decode((string) $latest->content, true);
            if (is_array($saved)) {
                $brand = array_intersect_key($saved, array_flip(self::BRAND_FIELDS));
            }
        }

        $byNumber = $rows->keyBy('template_number');

        $templates = [];
        foreach (self::DESIGNS as $number) {
            $row = $byNumber->get($number);
            $defaults = self::defaults($number, $academyName);
            $content = array_merge($defaults, $brand);
            if ($row !== null) {
                $saved = json_decode((string) $row->content, true);
                if (is_array($saved)) {
                    $content = array_merge($defaults, $saved);
                }
            }
            $templates[] = [
                'templateNumber' => $number,
                'content' => $content,
                'defaults' => $defaults,
                'customized' => $row !== null,
                'updatedAt' => $row?->updated_at,
            ];
        }

        return response()->json(['templates' => $templates]);
    }

    /** PUT /api/certificate-templates/{number} — upsert the editable content of one template. */
    public function update(Request $request, string $number): JsonResponse
    {
        Gate::authorize('certificate.manage');

        $n = (int) $number;
        if (! in_array($n, self::DESIGNS, true)) {
            abort(404, 'Unknown certificate template.');
        }

        $rules = [
            'accentColor' => ['sometimes', 'nullable', 'string', 'regex:/^#[0-9A-Fa-f]{6}$/'],
            'showLogo' => ['sometimes', 'boolean'],
        ];
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
     * Default wording for a design, with the academy's real name pre-filled. Kept here (not in the
     * DB) so a fresh academy gets a polished starting point with zero rows written — and so the
     * editor's "restore the design's wording" has something to restore.
     *
     * @return array<string,string|bool>
     */
    private static function defaults(int $number, string $academyName): array
    {
        $common = [
            'academyNameEn' => $academyName,
            'academyNameAr' => $academyName,
            'signatoryNameEn' => '',
            'signatoryNameAr' => '',
            'signatory2NameEn' => '',
            'signatory2NameAr' => '',
            'signatory2TitleEn' => '',
            'signatory2TitleAr' => '',
            'showLogo' => true,
        ];

        return match ($number) {
            1 => $common + [
                'titleEn' => 'Certificate of Achievement',
                'titleAr' => 'شهادة تقدير',
                'presentationEn' => 'This certificate is proudly presented to',
                'presentationAr' => 'تُمنح هذه الشهادة بكل فخر إلى',
                'bodyEn' => 'In recognition of outstanding dedication and excellence in Qur’anic studies and noble character.',
                'bodyAr' => 'تقديرًا للتميّز والاجتهاد المتواصل في دراسة القرآن الكريم وحُسن الخُلق.',
                'signatoryTitleEn' => 'Academy Director',
                'signatoryTitleAr' => 'مدير الأكاديمية',
                'accentColor' => '#C9A227',
            ],
            2 => $common + [
                'titleEn' => 'Certificate of Excellence',
                'titleAr' => 'شهادة امتياز',
                'presentationEn' => 'Awarded with honour to',
                'presentationAr' => 'مُنحت بكل تقدير إلى',
                'bodyEn' => 'For successfully completing the memorization program with distinction and exemplary commitment.',
                'bodyAr' => 'لإتمام برنامج التحفيظ بتفوّق والتزام مثالي يُحتذى به.',
                'signatoryTitleEn' => 'Head of Studies',
                'signatoryTitleAr' => 'المشرف التعليمي',
                'accentColor' => '#0E7C5A',
            ],
            3 => $common + [
                'titleEn' => 'Certificate of Qur’an Memorisation',
                'titleAr' => 'شهادة حفظ القرآن الكريم',
                'presentationEn' => 'This is to certify that',
                'presentationAr' => 'نشهد بأنّ',
                'bodyEn' => 'has memorised the portion stated herein under the supervision of our teachers, reciting it with sound tajweed and steadfast devotion.',
                'bodyAr' => 'قد أتمّ حفظ المقدار المذكور تحت إشراف معلمي الأكاديمية، وتلاه بتجويدٍ متقن وهمّةٍ عالية، نسأل الله له القبول والثبات.',
                'signatoryTitleEn' => 'Supervising Teacher',
                'signatoryTitleAr' => 'المعلم المشرف',
                'accentColor' => '#8C2F39',
            ],
            4 => $common + [
                'titleEn' => 'Certificate of Completion',
                'titleAr' => 'شهادة إتمام',
                'presentationEn' => 'This certificate is awarded to',
                'presentationAr' => 'تُمنح هذه الشهادة إلى',
                'bodyEn' => 'For successfully completing the programme of study with diligence, discipline and distinction.',
                'bodyAr' => 'لإتمامه البرنامج الدراسي بنجاح، بجدٍّ وانضباطٍ وتميّز.',
                'signatoryTitleEn' => 'Academic Director',
                'signatoryTitleAr' => 'المدير الأكاديمي',
                'accentColor' => '#1E3A5F',
            ],
            5 => $common + [
                'titleEn' => 'Certificate of Honour',
                'titleAr' => 'شهادة شرف',
                'presentationEn' => 'Proudly presented to',
                'presentationAr' => 'تُقدَّم بكل فخر إلى',
                'bodyEn' => 'In honour of exceptional achievement and an unwavering commitment to excellence.',
                'bodyAr' => 'تكريمًا لإنجازٍ استثنائي والتزامٍ راسخٍ بالتميّز.',
                'signatoryTitleEn' => 'Founder & Director',
                'signatoryTitleAr' => 'المؤسس والمدير',
                'accentColor' => '#D4AF37',
            ],
            6 => $common + [
                'titleEn' => 'Certificate of Participation',
                'titleAr' => 'شهادة مشاركة',
                'presentationEn' => 'This certifies that',
                'presentationAr' => 'تشهد الأكاديمية بأنّ',
                'bodyEn' => 'has actively participated in and completed the course, meeting all of its requirements.',
                'bodyAr' => 'قد شارك بفاعلية وأتمّ الدورة مستوفيًا جميع متطلباتها.',
                'signatoryTitleEn' => 'Course Instructor',
                'signatoryTitleAr' => 'مدرّب الدورة',
                'accentColor' => '#0F4C81',
            ],
            7 => $common + [
                'titleEn' => 'Certificate of Accomplishment',
                'titleAr' => 'شهادة إنجاز',
                'presentationEn' => 'Is hereby awarded to',
                'presentationAr' => 'تُمنح هذه الشهادة إلى',
                'bodyEn' => 'For outstanding performance and for reaching a new milestone on the learning journey.',
                'bodyAr' => 'للأداء المتميّز وبلوغ مرحلةٍ جديدة في رحلة التعلّم.',
                'signatoryTitleEn' => 'Head of Academy',
                'signatoryTitleAr' => 'رئيس الأكاديمية',
                'accentColor' => '#0D9488',
            ],
            8 => $common + [
                'titleEn' => 'Star Student Award',
                'titleAr' => 'شهادة الطالب المتميّز',
                'presentationEn' => 'Well done! This award goes to',
                'presentationAr' => 'أحسنت! هذه الشهادة لبطلنا',
                'bodyEn' => 'For shining effort, beautiful manners and a real love of learning. Keep reaching for the stars!',
                'bodyAr' => 'لاجتهادك الرائع وأخلاقك الجميلة وحبّك للتعلّم. واصل التألّق يا بطل!',
                'signatoryTitleEn' => 'Your Teacher',
                'signatoryTitleAr' => 'معلّمك',
                'accentColor' => '#EF6C4A',
            ],
            default => $common + [
                'titleEn' => 'Young Hafiz Certificate',
                'titleAr' => 'شهادة الحافظ الصغير',
                'presentationEn' => 'Shining bright, this certificate goes to',
                'presentationAr' => 'بكل فخر تُهدى هذه الشهادة لنجمنا',
                'bodyEn' => 'For memorising with love and dedication. May the Qur’an light your heart and your path.',
                'bodyAr' => 'لحفظه بحبٍّ واجتهاد، جعل الله القرآن نورًا لقلبه ودربه.',
                'signatoryTitleEn' => 'Teacher',
                'signatoryTitleAr' => 'المعلّم',
                'accentColor' => '#F4C542',
            ],
        };
    }
}
