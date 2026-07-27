<?php

declare(strict_types=1);

namespace Database\Seeders;

use App\Support\TenantContext;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * Five publishable courses for an LMS client, so the course platform (docs/lms) can be exercised
 * end-to-end against content that behaves like the real thing — a real catalogue, real runtimes, real
 * video that actually plays.
 *
 * The lessons are `YOUTUBE` lessons pointing at Elzero Web School's public Arabic courses, and every
 * cover is that course's own YouTube thumbnail. Nothing here is invented: each video id, title and
 * runtime was read from YouTube's oEmbed endpoint and watch page before being written down, and any
 * video that was private, deleted or non-embeddable was dropped rather than guessed at. That matters
 * because a seeded lesson whose video 404s looks exactly like a broken player.
 *
 * Shape worth having in a fixture, because each one is a distinct code path on the learner site:
 *  - one FREE course (Guess The Word) → the one-click enroll path, no access code;
 *  - four priced courses → the code-redemption path and the "request a code" CTA;
 *  - a TEXT lesson opening every course → the non-video lesson renderer;
 *  - the first two video lessons of each course marked `is_preview` → the public preview modal.
 *
 * Run it against a local academy (resolved by SUBDOMAIN, default `lms`):
 *
 *     php artisan db:seed --class='Database\Seeders\LmsDemoCoursesSeeder'
 *     LMS_DEMO_SUBDOMAIN=noor php artisan db:seed --class='Database\Seeders\LmsDemoCoursesSeeder'
 *
 * Idempotent: ids are derived from a stable seed string, so a re-run updates in place. Sections and
 * lessons are upserted rather than dropped-and-recreated, which keeps `lesson_progress` (FK cascade)
 * intact for anyone already part-way through a course; rows that fall out of the fixture are removed
 * afterwards.
 */
class LmsDemoCoursesSeeder extends Seeder
{
    /** Courses in catalogue order (newest published first — see the stagger in run()). */
    private const COURSES = [
        [
            'key' => 'typescript',
            'slug' => 'learn-typescript-arabic',
            'title' => 'تعلّم TypeScript من الصفر',
            'subtitle' => 'من تثبيت المترجم إلى الأنواع والدوال — بالعربي وبأمثلة عملية',
            'description' => "دورة عملية تبدأ من الصفر: تثبّت TypeScript، تضبط ملف الإعدادات، ثم تتعلّم كيف تكتب كوداً آمناً بالأنواع بدل الاعتماد على JavaScript وحدها.\n\nستتعلّم الفرق بين اللغات ذات الأنواع الساكنة والديناميكية، وكيف تكتب Type Annotations للمتغيرات والمصفوفات والدوال، وكيف تتعامل مع الـ Optional والـ Default والـ Rest Parameters، وتنتهي بالـ Type Alias.\n\nالدورة مناسبة لمن يعرف أساسيات JavaScript ويريد الانتقال إلى TypeScript في مشاريع حقيقية.",
            'price_minor' => 40000,
            'sections' => [
                ['البداية والإعداد', 3],
                ['الأنواع و Type Annotations', 4],
                ['الدوال والأنواع المتقدمة', 5],
            ],
        ],
        [
            'key' => 'template-four',
            'slug' => 'html-css-dashboard-template',
            'title' => 'تصميم لوحة تحكم كاملة بـ HTML و CSS',
            'subtitle' => 'مشروع Template Four — Sidebar وصفحة Dashboard متجاوبة بالكامل',
            'description' => "مشروع تطبيقي من أوله لآخره: تبني لوحة تحكم (Dashboard) حقيقية بـ HTML و CSS فقط، بدون أي إطار عمل.\n\nتبدأ بإنشاء الـ Framework الخاص بك والـ Sidebar، ثم منطقة المحتوى وشريط التمرير المخصص، وبعدها تبني ويدجت الصفحة الرئيسية واحدة تلو الأخرى: Welcome، Quick Draft، Yearly Targets، Tickets، Latest News والمهام.\n\nالهدف أن تخرج بمشروع كامل تضعه في معرض أعمالك، وأنت فاهم كل سطر CSS كتبته.",
            'price_minor' => 45000,
            'sections' => [
                ['الأساسيات و Sidebar', 4],
                ['هيكل الصفحة', 2],
                ['صفحة Dashboard', 6],
            ],
        ],
        [
            'key' => 'guess-word',
            'slug' => 'guess-the-word-game',
            'title' => 'اصنع لعبة Guess The Word بـ JavaScript',
            'subtitle' => 'دورة مجانية — لعبة تخمين الكلمات من الصفر حتى النهاية',
            'description' => "دورة مجانية بالكامل تبني فيها لعبة «خمّن الكلمة» بـ HTML و CSS و JavaScript.\n\nتبدأ من فكرة اللعبة وبناء الـ HTML، ثم توليد خانات الإدخال تلقائياً، وإدارة التنقل بين الحروف، ثم منطق اللعبة نفسه: حالة الفوز، حالة الخسارة، نظام التلميحات (Hints)، والتعامل مع زر المسح.\n\nابدأ بها إن كنت تريد تجربة المنصة قبل شراء أي دورة أخرى — لا تحتاج رمز وصول.",
            'price_minor' => 0,
            'sections' => [
                ['الإعداد والواجهة', 3],
                ['منطق اللعبة', 5],
            ],
        ],
        [
            'key' => 'memory',
            'slug' => 'memory-blocks-game',
            'title' => 'اصنع لعبة Memory Blocks بـ JavaScript',
            'subtitle' => 'لعبة الذاكرة الشهيرة: خلط البطاقات، قلبها، ومطابقتها',
            'description' => "تبني في هذه الدورة لعبة الذاكرة (Memory Blocks) خطوة بخطوة.\n\nتبدأ بالـ HTML وتنسيق البطاقات، ثم شاشة البداية (Splash Screen)، وبعدها المتغيرات الأساسية وخاصية order في CSS، ثم دالة الخلط (Shuffle)، ودالة قلب البطاقة، ومنع الضغط أثناء المقارنة، ومنطق البطاقات المتطابقة، وتنتهي بإضافة المؤثرات الصوتية.\n\nمشروع صغير الحجم وغني بالمفاهيم: DOM، الأحداث، المؤقتات، ومعالجة المصفوفات.",
            'price_minor' => 30000,
            'sections' => [
                ['بناء الواجهة', 3],
                ['منطق اللعبة', 5],
                ['اللمسات الأخيرة', 2],
            ],
        ],
        [
            'key' => 'hangman',
            'slug' => 'hangman-game-javascript',
            'title' => 'اصنع لعبة Hangman بـ HTML و CSS و JavaScript',
            'subtitle' => 'مشروع كامل: من التصميم حتى منطق الرسم والفوز والخسارة',
            'description' => "مشروع عملي تبني فيه لعبة Hangman المعروفة من الصفر.\n\nالجزء الأول تصميم كامل بالـ HTML و CSS، ثم توليد الحروف برمجياً، واختيار كلمة عشوائية من كائن (Object)، وتوليد خانات التخمين، ومقارنة الحروف على مرحلتين، ثم منطق الرسم مع كل محاولة خاطئة، وأخيراً إنهاء اللعبة وحالات الفوز والخسارة.\n\nمناسبة لمن أنهى أساسيات JavaScript ويريد أول مشروع حقيقي يطبّق فيه ما تعلّمه.",
            'price_minor' => 35000,
            'sections' => [
                ['التصميم والواجهة', 3],
                ['منطق اللعبة', 6],
            ],
        ],
    ];

    /**
     * The verified content: cover thumbnail + [video id, real runtime in seconds, real title].
     * Regenerating this means re-reading YouTube — do not hand-edit an id into it.
     */
    private const CONTENT = [
        'hangman' => [
            'cover' => 'https://i.ytimg.com/vi/kWhXAtj2M6s/maxresdefault.jpg',
            'videos' => [
                ['kWhXAtj2M6s', 706, '[Arabic] Hangman Game With HTML, CSS, JavaScript - #01 - Markup & Styling Part 1'],
                ['vhjBiFSSeF4', 628, '[Arabic] Hangman Game With HTML, CSS, JavaScript - #02 - Markup & Styling Part 2'],
                ['g5xbLeJYwp8', 445, '[Arabic] Hangman Game With HTML, CSS, JavaScript - #03 - Generate The Letters'],
                ['LBJ8rBiOb8E', 797, '[Arabic] Hangman Game With HTML, CSS, JavaScript - #04 - Random Property & Value From Object'],
                ['lk2KedMtgaI', 602, '[Arabic] Hangman Game With HTML, CSS, JavaScript - #05 - Generate Guess Letters'],
                ['5h5o5h3UgKA', 539, '[Arabic] Hangman Game With HTML, CSS, JavaScript - #06 - Compare The Letters Part 1'],
                ['F0timwiuyrQ', 615, '[Arabic] Hangman Game With HTML, CSS, JavaScript - #07 - Compare The Letters Part 2'],
                ['Bv1f3nHerR0', 522, '[Arabic] Hangman Game With HTML, CSS, JavaScript - #08 - The Draw Logic And Design'],
                ['ss7qFaODfBs', 559, '[Arabic] Hangman Game With HTML, CSS, JavaScript - #09 - Finalizing The Game'],
            ],
        ],
        'memory' => [
            'cover' => 'https://i.ytimg.com/vi/41i0LS9Xy-o/maxresdefault.jpg',
            'videos' => [
                ['41i0LS9Xy-o', 385, '[Arabic] Memory Blocks Game With HTML, CSS, JavaScript - #01 - HTML Markup'],
                ['7M7Z8l22OwM', 660, '[Arabic] Memory Blocks Game With HTML, CSS, JavaScript - #02 - Styling The Blocks'],
                ['YhMG1WMRyFg', 429, '[Arabic] Memory Blocks Game With HTML, CSS, JavaScript - #03 - Splash Screen'],
                ['o4LAgRlNwOM', 531, '[Arabic] Memory Blocks Game With HTML, CSS, JavaScript - #04 - Create The Main Variables'],
                ['cTFlGuSxlRw', 418, '[Arabic] Memory Blocks Game With HTML, CSS, JavaScript - #05 - Add The Order CSS Property'],
                ['xD2s2-GT4Hs', 642, '[Arabic] Memory Blocks Game With HTML, CSS, JavaScript - #06 - Create The Shuffle Function'],
                ['4W1FbDGRyao', 429, '[Arabic] Memory Blocks Game With HTML, CSS, JavaScript - #07 - Flip Block Function'],
                ['BHY8fB0NkWQ', 455, '[Arabic] Memory Blocks Game With HTML, CSS, JavaScript - #08 - Stop Clicking Function'],
                ['BKyf42RgDGQ', 693, '[Arabic] Memory Blocks Game With HTML, CSS, JavaScript - #09 - Matched Blocks Function'],
                ['usnDSgYHSaQ', 319, '[Arabic] Memory Blocks Game With HTML, CSS, JavaScript - #10 - Audio & Tasks & Finalize'],
            ],
        ],
        'guess-word' => [
            'cover' => 'https://i.ytimg.com/vi/3AI_nIuGp4s/maxresdefault.jpg',
            'videos' => [
                ['3AI_nIuGp4s', 1070, '[Arabic] Guess Word Game With HTML, CSS, JS - #01 - HTML Markup And Ideas'],
                ['U6gu4bwM7LA', 1185, '[Arabic] Guess Word Game With HTML, CSS, JS - #02 - Generate Inputs'],
                ['ykJtBGbXtG4', 630, '[Arabic] Guess Word Game With HTML, CSS, JS - #03 - Manage Navigation'],
                ['rhTfFhWdlwA', 894, '[Arabic] Guess Word Game With HTML, CSS, JS - #04 - Game Logic'],
                ['fEBksPO8UHI', 479, '[Arabic] Guess Word Game With HTML, CSS, JS - #05 - Manage Win'],
                ['gIEFcPWYYv8', 834, '[Arabic] Guess Word Game With HTML, CSS, JS - #06 - Manage Lose'],
                ['jOUXZrzH2kE', 969, '[Arabic] Guess Word Game With HTML, CSS, JS - #07 - Manage Hints'],
                ['nU3iY-tySXQ', 580, '[Arabic] Guess Word Game With HTML, CSS, JS - #08 - Handle Backspace and The End'],
            ],
        ],
        'template-four' => [
            'cover' => 'https://i.ytimg.com/vi/4OGWPn-Q__I/maxresdefault.jpg',
            'videos' => [
                ['4OGWPn-Q__I', 710, '[Arabic] HTML & CSS Template Four 2022 #01 - Very Important Intro And How To Work'],
                ['DjLINOE4auA', 896, '[Arabic] HTML & CSS Template Four 2022 #02 - Sidebar Part 1 And Framework Create'],
                ['Rnhv3_tiJhw', 959, '[Arabic] HTML & CSS Template Four 2022 #03 - Sidebar Part 2 And Continue Work'],
                ['Lk0PTNu8ato', 900, '[Arabic] HTML & CSS Template Four 2022 #04 - Create Content Area Head'],
                ['4Qgfg6KTCs0', 246, '[Arabic] HTML & CSS Template Four 2022 #05 - Create Page Heading And Scrollbar'],
                ['NS5orQh7Q5U', 398, '[Arabic] HTML & CSS Template Four 2022 #06 - Create Wrapper And Widgets Boxes'],
                ['ZiTCHy1PMmM', 1006, '[Arabic] HTML & CSS Template Four 2022 #07 - Dashboard Page - Welcome'],
                ['rs6lBcpGAQQ', 517, '[Arabic] HTML & CSS Template Four 2022 #08 - Dashboard Page - Quick Draft'],
                ['QK396xyYr2U', 1365, '[Arabic] HTML & CSS Template Four 2022 #09 - Dashboard Page - Yearly Targets'],
                ['gwo_5f8LMlo', 364, '[Arabic] HTML & CSS Template Four 2022 #10 - Dashboard Page - Tickets'],
                ['tNiqMxZOWUc', 548, '[Arabic] HTML & CSS Template Four 2022 #11 - Dashboard Page - Latest News'],
                ['pLKBYIdJ1GE', 437, '[Arabic] HTML & CSS Template Four 2022 #12 - Dashboard Page - Tasks'],
            ],
        ],
        'typescript' => [
            'cover' => 'https://i.ytimg.com/vi/yUndnE-2osg/maxresdefault.jpg',
            'videos' => [
                ['yUndnE-2osg', 240, 'Learn Typescript In Arabic 2022 - #01 - Introduction And What Is TypeScript'],
                ['pc5IlcEn8vw', 220, 'Learn Typescript In Arabic 2022 - #02 - Install TypeScript And Transpile Files'],
                ['CSll1rsRPOI', 517, 'Learn Typescript In Arabic 2022 - #03 - Create Configuration And Watch Files'],
                ['OgxYA7G9HsM', 426, 'Learn Typescript In Arabic 2022 - #04 - Statically vs Dynamically Typed Languages'],
                ['quwf-YbyHVg', 378, 'Learn Typescript In Arabic 2022 - #05 - Type Annotations And Any Data Type'],
                ['U405xMeS4lM', 244, 'Learn Typescript In Arabic 2022 - #06 - Type Annotations With Arrays'],
                ['n6JBmErg1OY', 286, 'Learn Typescript In Arabic 2022 - #07 - Type Annotations With Multidimensional Arrays'],
                ['ibvt_Ala8wE', 466, 'Learn Typescript In Arabic 2022 - #08 - Type Annotations With Function'],
                ['IS2VuO0IWso', 373, 'Learn Typescript In Arabic 2022 - #09 - Function Optional and Default Parameters'],
                ['RBOpzAQaQos', 263, 'Learn Typescript In Arabic 2022 - #10 - Function Rest Parameter'],
                ['AWg__YvDdvg', 129, 'Learn Typescript In Arabic 2022 - #11 - Type Annotations With Anonymous And Arrow Function'],
                ['TWTt63RJ3ic', 153, 'Learn Typescript In Arabic 2022 - #12 - Data Types - Type Alias'],
            ],
        ],
    ];

    public function run(): void
    {
        $subdomain = (string) env('LMS_DEMO_SUBDOMAIN', 'lms');

        // Session-scoped context: the seeder is not inside a request, so nothing sets the RLS GUCs
        // for us. The lookup needs one too — `academies` is itself RLS-guarded, and without a role
        // the subdomain query fails closed and returns nothing.
        TenantContext::apply(userId: null, academyId: null, role: 'SUPER_ADMIN', local: false);

        $academy = DB::table('academies')->where('subdomain', $subdomain)->first(['id', 'name']);
        if ($academy === null) {
            TenantContext::clear();
            $this->command?->error("No academy with subdomain '{$subdomain}' — nothing seeded.");

            return;
        }
        $academyId = (string) $academy->id;

        // Now inside the tenant: every insert below has to satisfy its `with check` predicate.
        TenantContext::apply(userId: null, academyId: $academyId, role: 'SUPER_ADMIN', local: false);

        try {
            foreach (array_values(self::COURSES) as $i => $course) {
                // Stagger publication so the catalogue's "newest first" ordering is visible and the
                // "New" ribbon lands on the top of the list rather than on all five at once.
                $publishedAt = now()->subDays($i * 6 + 1);
                $this->seedCourse($academyId, $course, $publishedAt);
                $this->command?->info("  ✓ {$course['slug']}");
            }
        } finally {
            TenantContext::clear();
        }

        $this->command?->info('Seeded '.count(self::COURSES)." courses into '{$academy->name}' ({$subdomain}).");
    }

    /** @param  array<string,mixed>  $course */
    private function seedCourse(string $academyId, array $course, \DateTimeInterface $publishedAt): void
    {
        $key = (string) $course['key'];
        $content = self::CONTENT[$key];
        $courseId = $this->id("course:{$key}");
        $now = now();

        DB::table('courses')->upsert([[
            'id' => $courseId,
            'academy_id' => $academyId,
            'title' => $course['title'],
            'slug' => $course['slug'],
            'subtitle' => $course['subtitle'],
            'description' => $course['description'],
            'cover_image_path' => $content['cover'],
            'status' => 'PUBLISHED',
            'price_minor' => $course['price_minor'],
            'published_at' => $publishedAt,
            'created_at' => $publishedAt,
            'updated_at' => $now,
        ]], ['id'], [
            'title', 'slug', 'subtitle', 'description', 'cover_image_path',
            'status', 'price_minor', 'published_at', 'updated_at',
        ]);

        $videos = $content['videos'];
        $cursor = 0;
        $keptSections = [];
        $keptLessons = [];

        foreach (array_values($course['sections']) as $sIndex => [$sectionTitle, $take]) {
            $sectionId = $this->id("section:{$key}:{$sIndex}");
            $keptSections[] = $sectionId;

            DB::table('course_sections')->upsert([[
                'id' => $sectionId,
                'academy_id' => $academyId,
                'course_id' => $courseId,
                'title' => $sectionTitle,
                'position' => $sIndex,
                'created_at' => $publishedAt,
                'updated_at' => $now,
            ]], ['id'], ['title', 'position', 'updated_at']);

            $rows = [];
            $position = 0;

            // A TEXT lesson opens the course: it is the only lesson type with no media behind it, so
            // seeding one keeps that renderer exercised on every course.
            if ($sIndex === 0) {
                $lessonId = $this->id("lesson:{$key}:intro");
                $keptLessons[] = $lessonId;
                $rows[] = $this->lessonRow($academyId, $courseId, $sectionId, $lessonId, [
                    'title' => 'نظرة عامة على الدورة',
                    'type' => 'TEXT',
                    'position' => $position++,
                    'is_preview' => true,
                    'duration_seconds' => 120,
                    'body' => $course['description'],
                ], $publishedAt, $now);
            }

            foreach (array_slice($videos, $cursor, $take) as $offset => [$videoId, $seconds, $title]) {
                $lessonId = $this->id("lesson:{$key}:{$videoId}");
                $keptLessons[] = $lessonId;
                $rows[] = $this->lessonRow($academyId, $courseId, $sectionId, $lessonId, [
                    'title' => $title,
                    'type' => 'YOUTUBE',
                    'position' => $position++,
                    // Two free previews per course: enough to judge the teaching, not enough to
                    // make the access code pointless.
                    'is_preview' => $sIndex === 0 && $offset < 2,
                    'duration_seconds' => $seconds,
                    'youtube_video_id' => $videoId,
                ], $publishedAt, $now);
            }
            $cursor += $take;

            DB::table('lessons')->upsert($rows, ['id'], [
                'section_id', 'title', 'type', 'position', 'is_preview',
                'duration_seconds', 'youtube_video_id', 'body', 'updated_at',
            ]);
        }

        // Anything left over from an earlier, longer version of this fixture. Scoped to the course,
        // so a lesson the client added by hand in another course is never touched.
        DB::table('lessons')->where('course_id', $courseId)->whereNotIn('id', $keptLessons)->delete();
        DB::table('course_sections')->where('course_id', $courseId)->whereNotIn('id', $keptSections)->delete();
    }

    /**
     * One lesson row with EVERY column present, nulls included.
     *
     * Not cosmetic: Laravel's upsert() takes its column list from the first row and binds the rest
     * positionally, so a TEXT lesson (body, no video) followed by a YOUTUBE lesson (video, no body)
     * silently shifts every value one column left. Uniform keys are what keeps the two types in one
     * batch.
     *
     * @param  array<string,mixed>  $lesson
     * @return array<string,mixed>
     */
    private function lessonRow(
        string $academyId,
        string $courseId,
        string $sectionId,
        string $lessonId,
        array $lesson,
        \DateTimeInterface $createdAt,
        \DateTimeInterface $updatedAt,
    ): array {
        return [
            'id' => $lessonId,
            'academy_id' => $academyId,
            'course_id' => $courseId,
            'section_id' => $sectionId,
            'title' => $lesson['title'],
            'type' => $lesson['type'],
            'position' => $lesson['position'],
            'is_preview' => $lesson['is_preview'],
            'duration_seconds' => $lesson['duration_seconds'],
            'youtube_video_id' => $lesson['youtube_video_id'] ?? null,
            'body' => $lesson['body'] ?? null,
            'created_at' => $createdAt,
            'updated_at' => $updatedAt,
        ];
    }

    /** A stable uuid-v7-shaped id from a seed string, so re-runs update rather than duplicate. */
    private function id(string $seed): string
    {
        $h = md5('lms-demo:'.$seed);

        return substr($h, 0, 8).'-'.substr($h, 8, 4).'-7'.substr($h, 13, 3)
            .'-8'.substr($h, 17, 3).'-'.substr($h, 20, 12);
    }
}
