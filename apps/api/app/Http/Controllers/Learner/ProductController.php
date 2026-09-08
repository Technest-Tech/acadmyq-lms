<?php

declare(strict_types=1);

namespace App\Http\Controllers\Learner;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Learner\Concerns\InteractsWithLearner;
use App\Support\LmsMedia;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/**
 * The bookshop on the LMS learner site (docs/lms/11) — the public half plus the buyer's library.
 *
 * The rule the whole file turns on: **a file's bytes leave this API only when it is a free preview,
 * or when the caller holds an ACTIVE entitlement to the product.** The public catalogue and the
 * product page therefore ship a signed URL for preview files and NOTHING resolvable for the rest —
 * not a key, not a filename that hints at one — while {@see access} is the single gated door that
 * mints download links for an owner.
 *
 * `index` / `show` / `preview` are public (this IS the shop window). `library`, `access` and `claim`
 * sit behind `learner.auth`. RLS scopes every row to the subdomain's academy either way.
 */
final class ProductController extends Controller
{
    use InteractsWithLearner;

    /** GET /api/learn/products — the published bookshelf. */
    public function index(): JsonResponse
    {
        $academyId = $this->currentAcademyId();
        $currency = $this->academyCurrency($academyId);
        $acceptsPayments = $this->siteAcceptsPayments();

        $products = DB::table('digital_products as p')
            ->where('p.status', 'PUBLISHED')
            ->whereNull('p.deleted_at')
            ->orderByDesc('p.published_at')
            ->get([
                'p.id', 'p.title', 'p.slug', 'p.cover_image_path', 'p.price_minor',
                'p.checkout_enabled', 'p.published_at', 'p.updated_at',
                DB::raw('(select count(*) from digital_product_files f where f.product_id = p.id) as file_count'),
                DB::raw('(select count(*) from digital_product_files f where f.product_id = p.id and f.is_preview) as preview_count'),
                DB::raw("(select count(*) from product_entitlements e where e.product_id = p.id and e.status = 'ACTIVE') as owner_count"),
            ])
            ->map(fn (object $p): array => $this->card($p, $currency, $acceptsPayments));

        return response()->json(['products' => $products]);
    }

    /** GET /api/learn/products/{slug} — the sales page: the pitch, the contents, the free sample. */
    public function show(string $slug): JsonResponse
    {
        $academyId = $this->currentAcademyId();
        $product = $this->publishedProduct($slug);

        $owners = (int) DB::table('product_entitlements')
            ->where('product_id', $product->id)->where('status', 'ACTIVE')->count();

        $files = DB::table('digital_product_files as f')
            ->leftJoin('media_assets as m', 'm.id', '=', 'f.media_asset_id')
            ->where('f.product_id', $product->id)
            ->orderBy('f.position')
            ->orderBy('f.created_at')
            ->get(['f.id', 'f.title', 'f.format', 'f.size_bytes', 'f.is_preview',
                'f.external_url', 'm.storage_key'])
            // The table of contents a visitor may read: every file's NAME (so they know what they
            // are buying) but a URL only for the sample.
            ->map(fn (object $f): array => [
                'id' => (string) $f->id,
                'title' => (string) $f->title,
                'format' => $f->format,
                'size_bytes' => $f->size_bytes === null ? null : (int) $f->size_bytes,
                'is_preview' => (bool) $f->is_preview,
                'url' => $f->is_preview ? $this->fileUrl($f) : null,
            ]);

        return response()->json([
            'product' => $this->card($product, $this->academyCurrency($academyId), $this->siteAcceptsPayments()) + [
                'description' => $product->description,
                'owner_count' => $owners,
            ],
            'files' => $files,
        ]);
    }

    /**
     * GET /api/learn/products/{slug}/preview/{fileId} — a signed URL for the free sample.
     *
     * Public on purpose: the sample chapter is the shop's best salesperson and asking someone to
     * register before they can read it is exactly the friction that loses the sale. The `is_preview`
     * filter in the query — not a check afterwards — is what keeps the rest of the book private.
     */
    public function preview(string $slug, string $fileId): JsonResponse
    {
        $this->currentAcademyId();
        $product = $this->publishedProduct($slug);

        $file = DB::table('digital_product_files as f')
            ->leftJoin('media_assets as m', 'm.id', '=', 'f.media_asset_id')
            ->where('f.product_id', $product->id)
            ->where('f.id', $fileId)
            ->where('f.is_preview', true)
            ->first(['f.id', 'f.title', 'f.format', 'f.external_url', 'm.storage_key']);

        if ($file === null) {
            abort(404, 'Preview not found.');
        }

        return response()->json([
            'id' => (string) $file->id,
            'title' => (string) $file->title,
            'format' => $file->format,
            'url' => $this->fileUrl($file),
        ]);
    }

    /** GET /api/learn/library — everything this learner owns. */
    public function library(): JsonResponse
    {
        $academyId = $this->currentAcademyId();
        $currency = $this->academyCurrency($academyId);

        $rows = DB::table('product_entitlements as e')
            ->join('digital_products as p', 'p.id', '=', 'e.product_id')
            ->where('e.learner_id', $this->learner()->getKey())
            ->where('e.status', 'ACTIVE')
            ->whereNull('p.deleted_at')
            ->orderByDesc('e.granted_at')
            ->get([
                'p.id', 'p.title', 'p.slug', 'p.cover_image_path', 'p.price_minor',
                'p.checkout_enabled', 'p.published_at', 'p.updated_at',
                'e.granted_at', 'e.download_count',
                DB::raw('(select count(*) from digital_product_files f where f.product_id = p.id) as file_count'),
            ])
            ->map(fn (object $p): array => $this->card($p, $currency, false) + [
                'granted_at' => $this->iso($p->granted_at),
                'download_count' => (int) $p->download_count,
            ]);

        return response()->json(['products' => $rows]);
    }

    /**
     * GET /api/learn/products/{slug}/access — the owner's download links.
     *
     * The one door that hands out URLs for paid files, and it answers `owned: false` rather than
     * 403 for a visitor who does not have it yet: the product page calls this to decide between
     * "Download" and "Buy", and a thrown error would make the normal case look like a failure.
     */
    public function access(string $slug): JsonResponse
    {
        $this->currentAcademyId();
        $product = $this->publishedProduct($slug);
        $learnerId = (string) $this->learner()->getKey();

        $owned = DB::table('product_entitlements')
            ->where('learner_id', $learnerId)
            ->where('product_id', $product->id)
            ->where('status', 'ACTIVE')
            ->exists();

        if (! $owned) {
            return response()->json(['owned' => false, 'files' => []]);
        }

        $files = DB::table('digital_product_files as f')
            ->leftJoin('media_assets as m', 'm.id', '=', 'f.media_asset_id')
            ->where('f.product_id', $product->id)
            ->orderBy('f.position')
            ->orderBy('f.created_at')
            ->get(['f.id', 'f.title', 'f.format', 'f.size_bytes', 'f.is_preview',
                'f.external_url', 'm.storage_key'])
            ->map(fn (object $f): array => [
                'id' => (string) $f->id,
                'title' => (string) $f->title,
                'format' => $f->format,
                'size_bytes' => $f->size_bytes === null ? null : (int) $f->size_bytes,
                'is_preview' => (bool) $f->is_preview,
                'url' => $this->fileUrl($f),
            ]);

        // A soft counter for the client's own curiosity ("has anyone actually opened it?"), not a
        // limit: nothing is refused when it grows, so a failed download costing a "use" cannot
        // happen. Bumped once per opening of the library, not once per file.
        DB::table('product_entitlements')
            ->where('learner_id', $learnerId)
            ->where('product_id', $product->id)
            ->update([
                'download_count' => DB::raw('download_count + 1'),
                'last_download_at' => now(),
            ]);

        return response()->json(['owned' => true, 'files' => $files]);
    }

    /**
     * POST /api/learn/products/{slug}/claim — take a FREE product.
     *
     * The book twin of `RedemptionController::enrollFree`: no order, no receipt, no code — a signed-in
     * learner clicks once and owns it. Idempotent, so a double-click is not an error.
     */
    public function claim(string $slug): JsonResponse
    {
        $academyId = $this->currentAcademyId();
        $product = $this->publishedProduct($slug);
        $learnerId = (string) $this->learner()->getKey();

        if ((int) $product->price_minor !== 0) {
            abort(422, 'This item is not free.');
        }
        if (DB::table('digital_product_files')->where('product_id', $product->id)->doesntExist()) {
            abort(422, 'This item has nothing to download yet.');
        }

        DB::table('product_entitlements')->updateOrInsert(
            ['learner_id' => $learnerId, 'product_id' => $product->id],
            [
                'academy_id' => $academyId,
                'status' => 'ACTIVE',
                'granted_at' => now(),
            ],
        );

        return response()->json(['ok' => true, 'slug' => (string) $product->slug], 201);
    }

    // ── helpers ─────────────────────────────────────────────────────────────────────────────────

    private function publishedProduct(string $slug): object
    {
        $product = DB::table('digital_products')
            ->where('slug', $slug)
            ->where('status', 'PUBLISHED')
            ->whereNull('deleted_at')
            ->first();

        if ($product === null) {
            abort(404, 'Item not found.');
        }

        return $product;
    }

    /**
     * The card every surface renders — catalogue, sales page, library — so a book looks the same
     * wherever it appears and one change reaches all three.
     *
     * @return array<string,mixed>
     */
    private function card(object $p, string $currency, bool $acceptsPayments): array
    {
        $free = (int) $p->price_minor === 0;

        return [
            'id' => (string) $p->id,
            'title' => (string) $p->title,
            'slug' => (string) $p->slug,
            'cover_image_path' => LmsMedia::coverUrl($p->cover_image_path),
            'file_count' => isset($p->file_count) ? (int) $p->file_count : null,
            'preview_count' => isset($p->preview_count) ? (int) $p->preview_count : null,
            'owner_count' => isset($p->owner_count) ? (int) $p->owner_count : null,
            'price_minor' => (int) $p->price_minor,
            'currency' => $currency,
            'is_free' => $free,
            'checkout_enabled' => (bool) $p->checkout_enabled,
            // Same honesty rule as a course (docs/lms/10 §1): a Buy button needs the switch AND a
            // live receiving account, or the buyer lands on a checkout with nowhere to pay.
            'sells_online' => ! $free && (bool) $p->checkout_enabled && $acceptsPayments,
            'published_at' => $this->iso($p->published_at),
            'updated_at' => $this->iso($p->updated_at ?? null),
        ];
    }

    /** A loadable URL for a file: the pasted link, or a short-lived signed URL for the upload. */
    private function fileUrl(object $f): ?string
    {
        $external = (string) ($f->external_url ?? '');
        if (trim($external) !== '') {
            return $external;
        }
        $key = (string) ($f->storage_key ?? '');

        return $key === '' ? null : LmsMedia::objectUrl($key);
    }

    /**
     * Does this client have any active receiving account? Deliberately NOT memoised on the instance:
     * Laravel caches the controller object on the Route, so an instance property survives between
     * requests and would serve a stale "yes" after the client switched their last method off.
     */
    private function siteAcceptsPayments(): bool
    {
        return DB::table('lms_payment_methods')->where('is_active', true)->exists();
    }
}
