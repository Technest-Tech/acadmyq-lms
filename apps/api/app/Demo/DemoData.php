<?php

declare(strict_types=1);

namespace App\Demo;

/**
 * The words the demo academies are written in: Arabic names, phone numbers that reach nobody, the
 * sentences a teacher writes in a report. Pure data — nothing here touches the database.
 */
final class DemoData
{
    /** Fathers' first names; a family's children carry theirs as a middle name. */
    public const FATHERS = [
        'أحمد', 'محمود', 'مصطفى', 'خالد', 'إبراهيم', 'حسن', 'عمرو', 'طارق', 'ياسر', 'هشام',
        'وليد', 'سامح', 'أشرف', 'شريف', 'إيهاب', 'عادل', 'ماجد', 'حسام', 'تامر', 'رامي',
        'نبيل', 'سعيد', 'جمال', 'عماد', 'هاني', 'أيمن', 'وائل', 'مدحت', 'علاء', 'صلاح',
        'فتحي', 'رضا', 'ناصر', 'مجدي',
    ];

    public const FAMILIES = [
        'السيد', 'عبد الله', 'الشريف', 'منصور', 'عبد الرحمن', 'النجار', 'سليمان', 'فاروق', 'الجمال', 'عثمان',
        'الصاوي', 'البنا', 'رضوان', 'زكي', 'حمدي', 'الشافعي', 'عبد العزيز', 'مرسي', 'فهمي', 'صالح',
        'غانم', 'الدسوقي', 'بدوي', 'شاهين', 'عطية', 'خليل', 'الطحان', 'نصار', 'حجازي', 'العدوي',
        'الشناوي', 'أبو زيد', 'الحسيني', 'عبد الفتاح',
    ];

    public const BOYS = [
        'عمر', 'يوسف', 'آدم', 'حمزة', 'زياد', 'مالك', 'ياسين', 'أنس', 'سيف', 'عبد الله',
        'إياد', 'كريم', 'تميم', 'بلال', 'مروان', 'معاذ', 'سليم', 'علي', 'يحيى', 'عبد الرحمن',
        'مازن', 'باسل', 'فارس', 'نور الدين',
    ];

    public const GIRLS = [
        'مريم', 'جنى', 'ملك', 'فريدة', 'سلمى', 'لينا', 'حبيبة', 'رقية', 'نور', 'ليلى',
        'جودي', 'تاليا', 'سارة', 'فاطمة', 'عائشة', 'هنا', 'ريم', 'يارا', 'روان', 'خديجة',
        'بسملة', 'آية', 'شهد', 'جميلة',
    ];

    /**
     * A phone number that cannot ring anywhere. Egyptian mobiles start 10, 11, 12 or 15; nothing was
     * ever issued under 19, so `+20 19 0000 xxxx` has the country's shape and no subscriber behind it.
     */
    public static function phone(int $n): string
    {
        return '+20190000'.str_pad((string) ($n % 10000), 4, '0', STR_PAD_LEFT);
    }

    /**
     * Families as `[guardian name, [child names…]]`. A child is `first father family`, the way an
     * Egyptian name is written. `$sizes` is how many children each family has, in order.
     *
     * @param  list<int>  $sizes
     * @return list<array{guardian: string, children: list<string>}>
     */
    public static function families(array $sizes, int $offset = 0): array
    {
        $families = [];
        $boy = $offset;
        $girl = $offset * 3;
        foreach ($sizes as $i => $size) {
            $father = self::FATHERS[($i + $offset) % count(self::FATHERS)];
            $grandfather = self::FATHERS[($i * 7 + 3 + $offset) % count(self::FATHERS)];
            $family = self::FAMILIES[($i + $offset * 5) % count(self::FAMILIES)];
            $children = [];
            for ($c = 0; $c < $size; $c++) {
                // Brothers and sisters, roughly half and half across the academy.
                $first = ($i + $c) % 2 === 0
                    ? self::BOYS[$boy++ % count(self::BOYS)]
                    : self::GIRLS[$girl++ % count(self::GIRLS)];
                $children[] = "{$first} {$father} {$family}";
            }
            $families[] = ['guardian' => "{$father} {$grandfather} {$family}", 'children' => $children];
        }

        return $families;
    }

    // ── Quran: what a lesson report says ─────────────────────────────────────

    /** Juz' Amma and Tabarak in the order a child memorises them, with each surah's ayah count. */
    public const SURAHS = [
        ['الناس', 6], ['الفلق', 5], ['الإخلاص', 4], ['المسد', 5], ['النصر', 3], ['الكافرون', 6], ['الكوثر', 3],
        ['الماعون', 7], ['قريش', 4], ['الفيل', 5], ['الهمزة', 9], ['العصر', 3], ['التكاثر', 8], ['القارعة', 11],
        ['العاديات', 11], ['الزلزلة', 8], ['البينة', 8], ['القدر', 5], ['العلق', 19], ['التين', 8], ['الشرح', 8],
        ['الضحى', 11], ['الليل', 21], ['الشمس', 15], ['البلد', 20], ['الفجر', 30], ['الغاشية', 26], ['الأعلى', 19],
        ['الطارق', 17], ['البروج', 22], ['الانشقاق', 25], ['المطففين', 36], ['الانفطار', 19], ['التكوير', 29],
        ['عبس', 42], ['النازعات', 46], ['النبأ', 40], ['المرسلات', 50], ['الإنسان', 31], ['القيامة', 40],
        ['المدثر', 56], ['المزمل', 20], ['الجن', 28], ['نوح', 28], ['المعارج', 44], ['الحاقة', 52], ['القلم', 52],
        ['الملك', 30],
    ];

    public const NOOR_AL_BAYAN = [
        'الحروف المفردة بالفتحة', 'الحروف المفردة بالكسرة', 'الحروف المفردة بالضمة', 'تمييز الحركات الثلاث',
        'المد بالألف', 'المد بالواو', 'المد بالياء', 'السكون وتركيب المقاطع', 'التنوين بأنواعه', 'الشدة مع الحركات',
        'اللام الشمسية واللام القمرية', 'قراءة كلمات من ثلاثة أحرف', 'قراءة كلمات من المصحف', 'قراءة آيات قصيرة',
    ];

    public const TAJWEED_TOPICS = [
        'أحكام النون الساكنة والتنوين: الإظهار', 'أحكام النون الساكنة والتنوين: الإدغام', 'الإقلاب والإخفاء الحقيقي',
        'أحكام الميم الساكنة', 'المد الطبيعي والمد المتصل', 'المد المنفصل والمد اللازم', 'القلقلة ومراتبها',
        'التفخيم والترقيق في الراء', 'مخارج الحروف: الحلق واللسان', 'صفات الحروف: الهمس والجهر', 'الوقف والابتداء',
    ];

    public const REPORT_NOTES = [
        'حفظ متقن ما شاء الله، مع مراجعة يومية لما سبق.',
        'يحتاج إلى التركيز على مخارج الحروف، خاصة الضاد والظاء.',
        'تحسّن واضح في أحكام المد هذا الأسبوع، بارك الله فيه.',
        'الرجاء مراجعة المقطع السابق مرتين يوميًا قبل الحصة القادمة.',
        'تفاعل ممتاز وتركيز طوال الحصة، جزاكم الله خيرًا على المتابعة.',
        'القراءة جيدة لكن مع بعض التردد؛ نكرر المقطع في الحصة القادمة.',
        'أتم التسميع بدون أخطاء، وننتقل إلى السورة التالية بإذن الله.',
        'نرجو الالتزام بالورد اليومي حتى يثبت الحفظ.',
        'مستوى التجويد في تحسّن مستمر، مع ملاحظة بسيطة في الغنة.',
        'تأخر خمس دقائق عن بداية الحصة، وأنهينا المقرر كاملًا.',
    ];

    public const STUDENT_CANCEL_REASONS = [
        'اعتذار بسبب السفر مع الأسرة', 'ظرف صحي للطالب', 'امتحانات المدرسة هذا الأسبوع',
        'انقطاع الإنترنت عند الطالب', 'مناسبة عائلية',
    ];

    public const TEACHER_CANCEL_REASONS = [
        'ظرف طارئ للمعلم، وتُعوَّض الحصة لاحقًا', 'عطل فني عند المعلم', 'إجازة مرضية للمعلم',
    ];

    // ── Centre: what a group lesson's sheet says ─────────────────────────────

    /** @var array<string, list<array{0: string, 1: string}>> subject → [topic, homework] */
    public const GROUP_TOPICS = [
        'english' => [
            ['Unit 1 — Present Simple & daily routines', 'Workbook p. 6–7'],
            ['Unit 1 — Adverbs of frequency', 'Write 8 sentences about your week'],
            ['Unit 2 — Present Continuous', 'Workbook p. 12, ex. 1–4'],
            ['Unit 2 — Vocabulary: jobs and workplaces', 'Learn the unit word list'],
            ['Unit 3 — Past Simple (regular verbs)', 'Workbook p. 18–19'],
            ['Unit 3 — Past Simple (irregular verbs)', 'Irregular verbs list 1–30'],
            ['Listening practice + speaking in pairs', 'Record a 1-minute voice note about your weekend'],
            ['Unit 4 — Comparatives and superlatives', 'Workbook p. 24'],
            ['Unit 4 — Reading: “Cities of the world”', 'Answer the comprehension questions'],
            ['Unit 5 — Future: going to / will', 'Workbook p. 30–31'],
            ['Progress test + feedback', 'Review units 1–5'],
            ['Unit 6 — Modal verbs: can, should, must', 'Workbook p. 36'],
            ['Writing workshop: an informal email', 'Write an email to a friend (80 words)'],
            ['Unit 7 — Present Perfect', 'Workbook p. 42–43'],
        ],
        'ielts' => [
            ['Listening Section 1 — form completion', 'Cambridge 17, Test 1 Listening'],
            ['Reading — True / False / Not Given', 'Reading passage 2, timed (20 min)'],
            ['Writing Task 1 — describing line graphs', 'Write one Task 1 answer (150 words)'],
            ['Writing Task 2 — opinion essay structure', 'Essay: “Technology in education”'],
            ['Speaking Part 2 — cue cards', 'Prepare 3 cue cards and record yourself'],
            ['Reading — matching headings', 'Cambridge 17, Test 2 Reading'],
            ['Listening Section 3 — multiple choice', 'Listening test 3, check the transcript'],
            ['Mock test + individual feedback', 'Review your mistakes list'],
        ],
        'maths' => [
            ['حل المعادلات من الدرجة الأولى', 'تمارين الكتاب ص ٢٤ من ١ إلى ١٠'],
            ['التحليل بإخراج العامل المشترك', 'ورقة العمل رقم ٣'],
            ['تحليل المقدار الثلاثي', 'تمارين ص ٣١'],
            ['حل معادلتين من الدرجة الأولى في متغيرين', 'تمارين ص ٣٨ من ١ إلى ٨'],
            ['النسبة والتناسب', 'ورقة العمل رقم ٥'],
            ['حساب المثلثات: النسب الأساسية', 'تمارين ص ٤٦'],
            ['مراجعة عامة + اختبار قصير', 'مراجعة الوحدة الثانية'],
            ['الهندسة: تشابه المثلثات', 'تمارين ص ٥٥ من ١ إلى ٦'],
            ['الإحصاء: الوسط والوسيط والمنوال', 'ورقة العمل رقم ٧'],
        ],
        'science' => [
            ['المادة وتركيبها: الذرة والجزيء', 'أسئلة الكتاب ص ١٢'],
            ['الخواص الفيزيائية والكيميائية للمادة', 'ورقة العمل رقم ٢'],
            ['الطاقة وصورها', 'أسئلة الكتاب ص ٢٣'],
            ['الحرارة وانتقالها', 'تلخيص الدرس في خريطة ذهنية'],
            ['الخلية: وحدة بناء الكائن الحي', 'رسم الخلية النباتية والحيوانية'],
            ['مراجعة الوحدة الأولى + اختبار قصير', 'مراجعة الدروس من ١ إلى ٤'],
            ['القوة والحركة', 'أسئلة الكتاب ص ٣٤'],
        ],
    ];

    public const GROUP_CANCEL_REASONS = [
        'اعتذار المدرس لظرف طارئ — تُعوَّض بحصة إضافية', 'انقطاع الكهرباء في المركز', 'إجازة رسمية',
    ];

    /** @return array{0: string, 1: string} */
    public static function groupTopic(string $subject, int $n): array
    {
        $topics = self::GROUP_TOPICS[$subject] ?? self::GROUP_TOPICS['english'];

        return $topics[$n % count($topics)];
    }
}
