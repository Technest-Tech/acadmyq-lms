<?php

declare(strict_types=1);

use Database\Seeders\DemoAcademySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesAuthUsers;
use Tests\Concerns\CreatesTenantData;
use Tests\Concerns\InteractsWithTenancy;

uses(RefreshDatabase::class, InteractsWithTenancy::class, CreatesTenantData::class, CreatesAuthUsers::class);

/**
 * LMS digital products — selling books and PDFs (docs/lms/11).
 *
 * What these tests are actually protecting:
 *  - **A paid file never leaks.** The public catalogue and sales page hand out a URL for a file
 *    marked `is_preview` and nothing resolvable for any other, no matter who asks.
 *  - **PAID is the only state that grants a download**, and it grants it in the same transaction —
 *    the same promise the course side makes, through the same order state machine.
 *  - **One sales desk.** A book order and a course order sit in the same queue, share the same
 *    numbering, and neither hides the other.
 *  - **One open order per learner+item.** A double-click cannot mint two pending purchases.
 *  - **A refund pulls the book back**, unless the client explicitly keeps it.
 *  - **A free book needs no order at all** — one click and it is on the shelf.
 */
beforeEach(function () {
    $this->seed(DemoAcademySeeder::class);
    $this->clearTenantContext();

    // A local media disk → LmsMedia mints signed proxy URLs instead of S3 presigns.
    Storage::fake('lms_media');
    config([
        'lms.media.disk' => 'lms_media',
        'filesystems.disks.lms_media.driver' => 'local',
    ]);

    $this->academy = $this->createAcademy(modules: ['LMS'], overrides: [
        'client_type' => 'LMS',
        'subdomain' => 'books',
        'default_currency' => 'EGP',
    ]);
    $this->owner = $this->makeUser($this->academy, 'ACADEMY_OWNER');

    Sanctum::actingAs($this->owner);

    // One live receiving account — without it nothing on the site sells online at all.
    $this->putJson('/api/courses/payment-methods', [
        'methods' => [[
            'type' => 'INSTAPAY',
            'account_number' => 'shop@instapay',
            'account_name' => 'The Book Shop',
            'is_active' => true,
        ]],
    ])->assertOk();

    app()['auth']->forgetGuards();

    $this->learnerToken = $this->withHeaders(['X-Academy' => 'books'])
        ->postJson('/api/learn/auth/register', [
            'full_name' => 'Yousef Adel',
            'email' => 'yousef@example.com',
            'password' => 'password123',
            'phone' => '+201000000009',
        ])->assertCreated()->json('token');
});

/** Learner request headers: the subdomain handle + (optionally) the bearer token. */
function bookHeaders(?string $token = null, string $sub = 'books'): array
{
    $h = ['X-Academy' => $sub];
    if ($token !== null) {
        $h['Authorization'] = "Bearer {$token}";
    }

    return $h;
}

/** Reserve → put bytes → confirm READY for a DOCUMENT upload. Returns the media_asset id. */
function readyDocument(string $academyId, string $filename = 'book.pdf', int $size = 1024): string
{
    $t = test();
    $assetId = $t->postJson('/api/courses/media/upload-url', [
        'filename' => $filename,
        'content_type' => 'application/pdf',
        'kind' => 'DOCUMENT',
        'size_bytes' => $size,
    ])->assertCreated()->json('mediaAssetId');

    $ext = pathinfo($filename, PATHINFO_EXTENSION);
    Storage::disk('lms_media')->put("lms/{$academyId}/{$assetId}/source.{$ext}", str_repeat('x', $size));
    $t->postJson("/api/courses/media/{$assetId}/uploaded")->assertOk()->assertJsonPath('status', 'READY');

    return $assetId;
}

/**
 * A published product with a sample chapter and the full book. Acts as the current Sanctum user.
 *
 * @return array{0:string,1:string} [productId, slug]
 */
function publishBook(mixed $test, int $priceMinor = 25000, string $title = 'Arabic Grammar'): array
{
    $productId = $test->postJson('/api/courses/products', [
        'title' => $title,
        'subtitle' => 'From the alphabet up',
        'price_minor' => $priceMinor,
        'kind' => 'EBOOK',
        'author' => 'Dr. Hana',
        'highlights' => ['200 exercises', 'Answer key included'],
    ])->assertCreated()->json('productId');

    $sample = readyDocument($test->academy, 'sample.pdf', 256);
    $full = readyDocument($test->academy, 'full.pdf', 4096);

    $test->postJson("/api/courses/products/{$productId}/files", [
        'title' => 'Sample chapter',
        'media_asset_id' => $sample,
        'is_preview' => true,
    ])->assertCreated();

    $test->postJson("/api/courses/products/{$productId}/files", [
        'title' => 'The full book',
        'media_asset_id' => $full,
    ])->assertCreated();

    $test->postJson("/api/courses/products/{$productId}/publish", ['status' => 'PUBLISHED'])->assertOk();

    $slug = $test->getJson("/api/courses/products/{$productId}")->json('product.slug');

    return [$productId, $slug];
}

// ── authoring ────────────────────────────────────────────────────────────────

it('will not publish a product that has nothing to deliver', function () {
    Sanctum::actingAs($this->owner);

    $productId = $this->postJson('/api/courses/products', [
        'title' => 'Empty Book', 'price_minor' => 1000,
    ])->assertCreated()->json('productId');

    $this->postJson("/api/courses/products/{$productId}/publish", ['status' => 'PUBLISHED'])
        ->assertStatus(422);

    // …and publishes the moment a file exists.
    $this->postJson("/api/courses/products/{$productId}/files", [
        'title' => 'The book', 'media_asset_id' => readyDocument($this->academy),
    ])->assertCreated();

    $this->postJson("/api/courses/products/{$productId}/publish", ['status' => 'PUBLISHED'])
        ->assertOk()->assertJsonPath('status', 'PUBLISHED');
});

it('advertises a book as sellable only when checkout is on AND a method is live', function () {
    Sanctum::actingAs($this->owner);
    [$productId, $slug] = publishBook($this);
    app()['auth']->forgetGuards();

    $this->withHeaders(bookHeaders())->getJson("/api/learn/products/{$slug}")
        ->assertOk()->assertJsonPath('product.sells_online', true);

    // Every receiving account off ⇒ the Buy button goes, even though the book's own flag is untouched.
    Sanctum::actingAs($this->owner);
    $this->putJson('/api/courses/payment-methods', [
        'methods' => [['type' => 'INSTAPAY', 'account_number' => 'shop@instapay', 'is_active' => false]],
    ])->assertOk();
    app()['auth']->forgetGuards();

    $this->withHeaders(bookHeaders())->getJson("/api/learn/products/{$slug}")
        ->assertJsonPath('product.sells_online', false)
        ->assertJsonPath('product.checkout_enabled', true);
});

// ── the preview is the ONLY thing a stranger may open ────────────────────────

it('hands out a url for the free sample and never for the paid file', function () {
    Sanctum::actingAs($this->owner);
    [, $slug] = publishBook($this);
    app()['auth']->forgetGuards();

    $page = $this->withHeaders(bookHeaders())->getJson("/api/learn/products/{$slug}")->assertOk();

    $files = collect($page->json('files'));
    expect($files)->toHaveCount(2);

    $preview = $files->firstWhere('is_preview', true);
    $paid = $files->firstWhere('is_preview', false);

    // The buyer can see WHAT they'd get (the title) but only reach the sample.
    expect($preview['url'])->toBeString()->not->toBe('');
    expect($paid['title'])->toBe('The full book');
    expect($paid['url'])->toBeNull();

    // The dedicated preview endpoint is public — a sample chapter behind a sign-up is friction that
    // loses the sale — and refuses to serve a file that is not flagged as one.
    $this->withHeaders(bookHeaders())
        ->getJson("/api/learn/products/{$slug}/preview/{$preview['id']}")
        ->assertOk()->assertJsonPath('title', 'Sample chapter');

    $this->withHeaders(bookHeaders())
        ->getJson("/api/learn/products/{$slug}/preview/{$paid['id']}")
        ->assertNotFound();
});

it('tells a signed-in visitor who does not own the book so, rather than erroring', function () {
    Sanctum::actingAs($this->owner);
    [, $slug] = publishBook($this);
    app()['auth']->forgetGuards();

    $this->withHeaders(bookHeaders($this->learnerToken))
        ->getJson("/api/learn/products/{$slug}/access")
        ->assertOk()
        ->assertJsonPath('owned', false)
        ->assertJsonPath('files', []);
});

// ── buying one ───────────────────────────────────────────────────────────────

it('grants the download the moment the book order is approved', function () {
    Sanctum::actingAs($this->owner);
    [$productId, $slug] = publishBook($this);
    app()['auth']->forgetGuards();

    $order = $this->withHeaders(bookHeaders($this->learnerToken))
        ->postJson("/api/learn/products/{$slug}/orders", ['accept_terms' => true])
        ->assertCreated();

    $number = $order->json('order.order_number');
    expect($order->json('order.item_type'))->toBe('PRODUCT');
    expect($order->json('order.price_minor'))->toBe(25000);

    $this->withHeaders(bookHeaders($this->learnerToken))
        ->post("/api/learn/orders/{$number}/receipt", [
            'receipt' => UploadedFile::fake()->image('transfer.jpg'),
        ])->assertCreated()->assertJsonPath('order.status', 'UNDER_REVIEW');

    // Nothing is downloadable while the client is still looking at the receipt.
    $this->withHeaders(bookHeaders($this->learnerToken))
        ->getJson("/api/learn/products/{$slug}/access")->assertJsonPath('owned', false);

    Sanctum::actingAs($this->owner);
    $orderId = DB::table('course_orders')->where('order_number', $number)->value('id');
    $this->postJson("/api/courses/orders/{$orderId}/approve")->assertOk();
    app()['auth']->forgetGuards();

    $access = $this->withHeaders(bookHeaders($this->learnerToken))
        ->getJson("/api/learn/products/{$slug}/access")->assertOk()
        ->assertJsonPath('owned', true);

    // Every file now resolves — the sample AND the book they paid for.
    foreach ($access->json('files') as $file) {
        expect($file['url'])->toBeString()->not->toBe('');
    }

    // …and it is on their shelf.
    $this->withHeaders(bookHeaders($this->learnerToken))->getJson('/api/learn/library')
        ->assertOk()->assertJsonPath('products.0.slug', $slug);

    expect(DB::table('product_entitlements')
        ->where('product_id', $productId)->where('status', 'ACTIVE')->count())->toBe(1);
});

it('returns the SAME open order on a second attempt instead of a duplicate', function () {
    Sanctum::actingAs($this->owner);
    [, $slug] = publishBook($this);
    app()['auth']->forgetGuards();

    $first = $this->withHeaders(bookHeaders($this->learnerToken))
        ->postJson("/api/learn/products/{$slug}/orders", ['accept_terms' => true])
        ->assertCreated()->json('order.order_number');

    $second = $this->withHeaders(bookHeaders($this->learnerToken))
        ->postJson("/api/learn/products/{$slug}/orders", ['accept_terms' => true])
        ->assertCreated()->json('order.order_number');

    expect($second)->toBe($first);
    expect(DB::table('course_orders')->where('item_type', 'PRODUCT')->count())->toBe(1);
});

it('refuses checkout for a free book and for one not sold online', function () {
    Sanctum::actingAs($this->owner);
    [$freeId, $freeSlug] = publishBook($this, priceMinor: 0, title: 'Free Primer');
    [$offId, $offSlug] = publishBook($this, priceMinor: 5000, title: 'Not Online');
    $this->patchJson("/api/courses/products/{$offId}", ['checkout_enabled' => false])->assertOk();
    app()['auth']->forgetGuards();

    $this->withHeaders(bookHeaders($this->learnerToken))
        ->getJson("/api/learn/checkout/book/{$freeSlug}")->assertStatus(422);

    $this->withHeaders(bookHeaders($this->learnerToken))
        ->getJson("/api/learn/checkout/book/{$offSlug}")->assertStatus(422);
});

it('pulls the book back on a refund unless the client keeps it', function () {
    Sanctum::actingAs($this->owner);
    [$refundedId, $refundedSlug] = publishBook($this, title: 'Arabic Grammar');
    [$keptId, $keptSlug] = publishBook($this, title: 'Tajweed Handbook');
    app()['auth']->forgetGuards();

    // Two books, bought the same way; only the refund differs.
    $buy = function (string $slug) {
        $number = $this->withHeaders(bookHeaders($this->learnerToken))
            ->postJson("/api/learn/products/{$slug}/orders", ['accept_terms' => true])
            ->assertCreated()->json('order.order_number');

        return DB::table('course_orders')->where('order_number', $number)->value('id');
    };

    $refundedOrder = $buy($refundedSlug);
    $keptOrder = $buy($keptSlug);

    Sanctum::actingAs($this->owner);
    $this->postJson("/api/courses/orders/{$refundedOrder}/approve")->assertOk();
    $this->postJson("/api/courses/orders/{$keptOrder}/approve")->assertOk();

    // A refund that leaves the book downloadable is a giveaway…
    $this->postJson("/api/courses/orders/{$refundedOrder}/refund", ['reason' => 'Wrong book'])->assertOk();
    expect(DB::table('product_entitlements')->where('product_id', $refundedId)->value('status'))
        ->toBe('REVOKED');

    // …unless the client says so, which is a real goodwill decision and stays theirs.
    $this->postJson("/api/courses/orders/{$keptOrder}/refund", [
        'reason' => 'Goodwill', 'keep_access' => true,
    ])->assertOk();
    expect(DB::table('product_entitlements')->where('product_id', $keptId)->value('status'))
        ->toBe('ACTIVE');

    app()['auth']->forgetGuards();

    // The shelf agrees with the entitlements: the kept book is still there, the refunded one is not.
    $shelf = collect($this->withHeaders(bookHeaders($this->learnerToken))
        ->getJson('/api/learn/library')->assertOk()->json('products'))->pluck('slug')->all();
    expect($shelf)->toBe([$keptSlug]);
});

// ── free books skip the whole thing ──────────────────────────────────────────

it('puts a free book on the shelf with one click and no order', function () {
    Sanctum::actingAs($this->owner);
    [$productId, $slug] = publishBook($this, priceMinor: 0, title: 'Free Primer');
    app()['auth']->forgetGuards();

    $this->withHeaders(bookHeaders($this->learnerToken))
        ->postJson("/api/learn/products/{$slug}/claim")->assertCreated();

    // Idempotent: a double-click is not an error.
    $this->withHeaders(bookHeaders($this->learnerToken))
        ->postJson("/api/learn/products/{$slug}/claim")->assertCreated();

    expect(DB::table('course_orders')->count())->toBe(0);
    expect(DB::table('product_entitlements')
        ->where('product_id', $productId)->where('status', 'ACTIVE')->count())->toBe(1);

    $this->withHeaders(bookHeaders($this->learnerToken))
        ->getJson("/api/learn/products/{$slug}/access")->assertJsonPath('owned', true);
});

// ── one sales desk ───────────────────────────────────────────────────────────

it('shows book orders and course orders in the same queue', function () {
    Sanctum::actingAs($this->owner);

    // A priced, published course alongside the book.
    $courseId = $this->postJson('/api/courses', ['title' => 'Tajweed', 'price_minor' => 40000])
        ->assertCreated()->json('courseId');
    $sectionId = $this->postJson("/api/courses/{$courseId}/sections", ['title' => 'Unit 1'])->json('sectionId');
    $this->postJson("/api/courses/{$courseId}/lessons", [
        'section_id' => $sectionId, 'type' => 'TEXT', 'title' => 'Lesson', 'body' => 'Body',
    ])->assertCreated();
    $this->postJson("/api/courses/{$courseId}/publish", ['status' => 'PUBLISHED'])->assertOk();
    $courseSlug = $this->getJson("/api/courses/{$courseId}")->json('course.slug');

    [, $bookSlug] = publishBook($this);
    app()['auth']->forgetGuards();

    $this->withHeaders(bookHeaders($this->learnerToken))
        ->postJson("/api/learn/courses/{$courseSlug}/orders", ['accept_terms' => true])->assertCreated();
    $this->withHeaders(bookHeaders($this->learnerToken))
        ->postJson("/api/learn/products/{$bookSlug}/orders", ['accept_terms' => true])->assertCreated();

    Sanctum::actingAs($this->owner);

    $queue = $this->getJson('/api/courses/orders')->assertOk();
    expect($queue->json('total'))->toBe(2);

    $types = collect($queue->json('rows'))->pluck('item_type')->sort()->values()->all();
    expect($types)->toBe(['COURSE', 'PRODUCT']);

    // Every row prints a title — a book order that rendered as a blank cell would be the regression
    // an inner join to `courses` quietly causes.
    foreach ($queue->json('rows') as $row) {
        expect($row['item_title'])->toBeString()->not->toBe('');
    }

    // The facet that separates them, and the money split the client actually asks about.
    $books = $this->getJson('/api/courses/orders?filter[item_type]=PRODUCT')->assertOk();
    expect($books->json('total'))->toBe(1);

    $this->getJson('/api/courses/orders/summary')->assertOk()
        ->assertJsonPath('stats.orders', 2)
        ->assertJsonPath('stats.product_orders', 1);

    // The leaderboard covers both shelves.
    $titles = collect($this->getJson('/api/courses/orders/summary')->json('by_course'))
        ->pluck('title')->sort()->values()->all();
    expect($titles)->toBe(['Arabic Grammar', 'Tajweed']);
});

// ── the site document ────────────────────────────────────────────────────────

it('tells the storefront whether this client sells books at all', function () {
    Sanctum::actingAs($this->owner);
    app()['auth']->forgetGuards();

    // Nothing published yet: the header must not offer a Books link.
    $this->withHeaders(bookHeaders())->getJson('/api/learn/site')->assertOk()
        ->assertJsonPath('commerce.books.any', false)
        ->assertJsonPath('commerce.books.preview', false);

    Sanctum::actingAs($this->owner);
    publishBook($this);
    app()['auth']->forgetGuards();

    $this->withHeaders(bookHeaders())->getJson('/api/learn/site')->assertOk()
        ->assertJsonPath('commerce.books.any', true)
        ->assertJsonPath('commerce.books.paid', true)
        ->assertJsonPath('commerce.books.checkout', true)
        ->assertJsonPath('commerce.books.preview', true)
        ->assertJsonPath('stats.books', 1);
});

// ── isolation ────────────────────────────────────────────────────────────────

it('cannot see another academy\'s products', function () {
    Sanctum::actingAs($this->owner);
    publishBook($this);

    $other = $this->createAcademy(modules: ['LMS'], overrides: ['client_type' => 'LMS', 'subdomain' => 'rival']);
    $otherOwner = $this->makeUser($other, 'ACADEMY_OWNER');
    Sanctum::actingAs($otherOwner);

    expect($this->getJson('/api/courses/products')->assertOk()->json('total'))->toBe(0);
});

it('refuses a staff member without the course capabilities', function () {
    $teacher = $this->makeUser($this->academy, 'TEACHER');
    Sanctum::actingAs($teacher);

    $this->getJson('/api/courses/products')->assertForbidden();
    $this->postJson('/api/courses/products', ['title' => 'Nope'])->assertForbidden();
});
