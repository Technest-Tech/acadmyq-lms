<?php

declare(strict_types=1);

namespace App\Http\Controllers\Lms;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Lms\Concerns\InteractsWithLms;
use App\Support\Audit;
use App\Support\DataTable;
use App\Support\LmsMedia;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Digital products — books, PDFs, workbooks and audiobooks a course-platform client sells alongside
 * its courses (docs/lms/11). The authoring side: staff write the product's sales page, attach the
 * files that make it up, mark which of those files is the FREE PREVIEW, and publish it.
 *
 * Reuses the course capabilities on purpose. `course.read` / `course.manage` are already "runs this
 * client's catalogue", and a client who lets someone publish courses is not meaningfully protected
 * by withholding books from them — a third pair of capabilities would be delegation theatre.
 *
 * RLS scopes every query to the current academy; the storage cap and the signed-URL delivery come
 * free because a product file is an ordinary `media_assets` upload.
 */
final class ProductController extends Controller
{
    use InteractsWithLms;

    private const STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'];

    /** What the buyer downloads. Presentational + a catalogue facet, so it is a closed set. */
    private const KINDS = ['EBOOK', 'PDF', 'AUDIOBOOK', 'WORKBOOK', 'BUNDLE'];

    /** Same ceiling as a course price: 10,000,000 major units in minor. */
    private const MAX_PRICE_MINOR = 1_000_000_000;

    /** The two sales lists on a product's page, and how many bullets each may hold. */
    private const SALES_LISTS = ['highlights' => 12, 'audience' => 8];

    /** GET /api/courses/products — the server-driven list view. */
    public function index(Request $request): JsonResponse
    {
        Gate::authorize('course.read');

        $query = DB::table('digital_products as p')
            ->whereNull('p.deleted_at')
            ->select([
                'p.id', 'p.title', 'p.slug', 'p.subtitle', 'p.status', 'p.kind', 'p.author',
                'p.cover_image_path', 'p.price_minor', 'p.checkout_enabled', 'p.category',
                'p.published_at', 'p.created_at',
                DB::raw('(select count(*) from digital_product_files f where f.product_id = p.id) as file_count'),
                DB::raw('(select count(*) from digital_product_files f where f.product_id = p.id and f.is_preview) as preview_count'),
                DB::raw("(select count(*) from product_entitlements e where e.product_id = p.id and e.status = 'ACTIVE') as owner_count"),
            ]);

        $result = DataTable::paginate($query, $request, [
            'idColumn' => 'p.id',
            'searchable' => ['p.title', 'p.subtitle', 'p.author'],
            'sortable' => [
                'created_at' => 'p.created_at',
                'title' => 'p.title',
                'status' => 'p.status',
                'price_minor' => 'p.price_minor',
            ],
            'filters' => [
                'status' => fn ($q, $value) => $q->where('p.status', strtoupper((string) $value)),
                'kind' => fn ($q, $value) => $q->where('p.kind', strtoupper((string) $value)),
            ],
            'defaultSort' => '-created_at',
        ]);

        // One query for the whole page, not one per row — the same shape CourseController uses.
        $acceptsPayments = $this->hasActivePaymentMethod();
        $result['rows'] = $result['rows']
            ->map(fn (object $r): object => $this->present($r, $acceptsPayments));

        return response()->json($result);
    }

    /** GET /api/courses/products/summary — headline counts for the page header. */
    public function summary(): JsonResponse
    {
        Gate::authorize('course.read');

        $byStatus = DB::table('digital_products')
            ->whereNull('deleted_at')
            ->select('status', DB::raw('count(*) as c'))
            ->groupBy('status')
            ->pluck('c', 'status');

        $counts = [];
        foreach (self::STATUSES as $status) {
            $counts[strtolower($status)] = (int) ($byStatus[$status] ?? 0);
        }

        return response()->json($counts + [
            'total' => array_sum($counts),
            // Sales, not just inventory: the page's second line is "how many books have I sold".
            'owners' => (int) DB::table('product_entitlements')->where('status', 'ACTIVE')->count(),
            'currency' => $this->academyCurrency(),
            'accepts_payments' => $this->hasActivePaymentMethod(),
        ]);
    }

    /** POST /api/courses/products — create a draft product. */
    public function store(Request $request): JsonResponse
    {
        Gate::authorize('course.manage');

        $academyId = $this->currentAcademyId();
        $data = $request->validate($this->rules(creating: true));

        $productId = (string) Str::uuid();
        DB::table('digital_products')->insert([
            'id' => $productId,
            'academy_id' => $academyId,
            'title' => trim($data['title']),
            'slug' => $this->uniqueSlugIn('digital_products', $academyId, $data['title'], 'book'),
            'subtitle' => $data['subtitle'] ?? null,
            'description' => $data['description'] ?? null,
            'kind' => $data['kind'] ?? 'EBOOK',
            'price_minor' => $data['price_minor'] ?? 0,
            'checkout_enabled' => $data['checkout_enabled'] ?? true,
            'cover_image_path' => $this->resolveCover($data),
            'status' => 'DRAFT',
            'created_by' => $this->ctx()->userId,
        ] + $this->detailColumns($data));

        Audit::log('lms_product.create', 'digital_product', $productId, $academyId,
            $this->ctx()->userId, $this->ctx()->role, after: ['title' => $data['title']]);

        return response()->json(['productId' => $productId], 201);
    }

    /** GET /api/courses/products/{id} — one product plus its files (the editor payload). */
    public function show(string $id): JsonResponse
    {
        Gate::authorize('course.read');

        $product = $this->findProduct($id);

        return response()->json([
            'product' => $this->present($product),
            'files' => $this->files($id),
        ]);
    }

    /** PATCH /api/courses/products/{id} — edit the product's metadata and sales copy. */
    public function update(Request $request, string $id): JsonResponse
    {
        Gate::authorize('course.manage');

        $academyId = $this->currentAcademyId();
        $product = $this->findProduct($id);
        $data = $request->validate($this->rules(creating: false));

        $update = [];
        foreach (['title', 'subtitle', 'description', 'kind', 'price_minor', 'checkout_enabled'] as $field) {
            if (array_key_exists($field, $data)) {
                $update[$field] = is_string($data[$field]) ? trim($data[$field]) : $data[$field];
            }
        }
        $update += $this->detailColumns($data, partial: true);
        // An uploaded cover wins over a pasted url; either key being present (even as null) is an edit.
        if (array_key_exists('cover_media_asset_id', $data) || array_key_exists('cover_image_path', $data)) {
            $update['cover_image_path'] = $this->resolveCover($data);
        }
        if (array_key_exists('slug', $data)) {
            $update['slug'] = $this->uniqueSlugIn('digital_products', $academyId, $data['slug'], 'book', $id);
        }

        if ($update === []) {
            return response()->json(['ok' => true, 'changed' => []]);
        }

        DB::table('digital_products')->where('id', $id)->update($update + ['updated_at' => now()]);

        Audit::log('lms_product.update', 'digital_product', $id, $academyId,
            $this->ctx()->userId, $this->ctx()->role,
            after: $update, before: ['title' => $product->title]);

        return response()->json(['ok' => true, 'changed' => array_keys($update)]);
    }

    /** POST /api/courses/products/{id}/publish — DRAFT ↔ PUBLISHED ↔ ARCHIVED. */
    public function setStatus(Request $request, string $id): JsonResponse
    {
        Gate::authorize('course.manage');

        $academyId = $this->currentAcademyId();
        $product = $this->findProduct($id);
        $status = $request->validate(['status' => ['required', Rule::in(self::STATUSES)]])['status'];

        // Publishing needs something to actually deliver — a book with no file is a dead Buy button,
        // the same reason a course cannot be published with no lessons.
        if ($status === 'PUBLISHED' && DB::table('digital_product_files')->where('product_id', $id)->doesntExist()) {
            return response()->json([
                'message' => 'Add at least one file before publishing this product.',
                'errors' => ['status' => ['Add at least one file before publishing this product.']],
            ], 422);
        }

        DB::table('digital_products')->where('id', $id)->update([
            'status' => $status,
            'published_at' => $status === 'PUBLISHED' ? ($product->published_at ?? now()) : $product->published_at,
            'updated_at' => now(),
        ]);

        Audit::log('lms_product.set_status', 'digital_product', $id, $academyId,
            $this->ctx()->userId, $this->ctx()->role,
            after: ['status' => $status], before: ['status' => $product->status]);

        return response()->json(['ok' => true, 'status' => $status]);
    }

    /** DELETE /api/courses/products/{id} — soft-delete (orders and owners outlive the listing). */
    public function destroy(string $id): JsonResponse
    {
        Gate::authorize('course.manage');

        $academyId = $this->currentAcademyId();
        $product = $this->findProduct($id);

        DB::table('digital_products')->where('id', $id)->update(['deleted_at' => now(), 'updated_at' => now()]);

        Audit::log('lms_product.delete', 'digital_product', $id, $academyId,
            $this->ctx()->userId, $this->ctx()->role,
            before: ['title' => $product->title, 'status' => $product->status]);

        return response()->json(['ok' => true]);
    }

    // ── files ────────────────────────────────────────────────────────────────

    /** POST /api/courses/products/{product}/files — attach a file (or the free sample). */
    public function storeFile(Request $request, string $productId): JsonResponse
    {
        Gate::authorize('course.manage');

        $academyId = $this->currentAcademyId();
        $this->findProduct($productId);
        $data = $request->validate($this->fileRules());

        $asset = $this->resolveFileAsset($data);
        if ($asset === null && ($data['external_url'] ?? null) === null) {
            throw ValidationException::withMessages([
                'media_asset_id' => ['Upload a file or paste a link to one.'],
            ]);
        }

        $fileId = (string) Str::uuid();
        DB::table('digital_product_files')->insert([
            'id' => $fileId,
            'academy_id' => $academyId,
            'product_id' => $productId,
            'media_asset_id' => $asset?->id,
            'external_url' => $asset !== null ? null : ($data['external_url'] ?? null),
            'title' => trim($data['title']),
            'format' => $this->formatOf($data, $asset),
            'size_bytes' => $asset?->size_bytes,
            'page_count' => $data['page_count'] ?? null,
            'is_preview' => $data['is_preview'] ?? false,
            'position' => $data['position'] ?? $this->nextFilePosition($productId),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Audit::log('lms_product.file_add', 'digital_product', $productId, $academyId,
            $this->ctx()->userId, $this->ctx()->role,
            after: ['file_id' => $fileId, 'title' => $data['title'], 'is_preview' => (bool) ($data['is_preview'] ?? false)]);

        return response()->json(['fileId' => $fileId, 'files' => $this->files($productId)], 201);
    }

    /** PATCH /api/courses/products/{product}/files/{id} — rename, re-flag as preview, re-point. */
    public function updateFile(Request $request, string $productId, string $id): JsonResponse
    {
        Gate::authorize('course.manage');

        $academyId = $this->currentAcademyId();
        $this->findProduct($productId);
        $file = $this->findFile($productId, $id);
        $data = $request->validate($this->fileRules(creating: false));

        $update = [];
        foreach (['title', 'is_preview', 'position', 'page_count'] as $field) {
            if (array_key_exists($field, $data)) {
                $update[$field] = is_string($data[$field]) ? trim($data[$field]) : $data[$field];
            }
        }

        // Repointing the file: an upload wins over a url, exactly as it does for a cover.
        if (array_key_exists('media_asset_id', $data) || array_key_exists('external_url', $data)) {
            $asset = $this->resolveFileAsset($data);
            $update['media_asset_id'] = $asset?->id;
            $update['external_url'] = $asset !== null ? null : ($data['external_url'] ?? null);
            $update['size_bytes'] = $asset?->size_bytes;
            $update['format'] = $this->formatOf($data, $asset) ?? $file->format;
        }

        if ($update !== []) {
            DB::table('digital_product_files')->where('id', $id)->update($update + ['updated_at' => now()]);
            Audit::log('lms_product.file_update', 'digital_product', $productId, $academyId,
                $this->ctx()->userId, $this->ctx()->role, after: ['file_id' => $id] + $update);
        }

        return response()->json(['ok' => true, 'files' => $this->files($productId)]);
    }

    /** DELETE /api/courses/products/{product}/files/{id} — detach a file. */
    public function destroyFile(string $productId, string $id): JsonResponse
    {
        Gate::authorize('course.manage');

        $academyId = $this->currentAcademyId();
        $this->findProduct($productId);
        $file = $this->findFile($productId, $id);

        DB::table('digital_product_files')->where('id', $id)->delete();

        Audit::log('lms_product.file_delete', 'digital_product', $productId, $academyId,
            $this->ctx()->userId, $this->ctx()->role, before: ['file_id' => $id, 'title' => $file->title]);

        return response()->json(['ok' => true, 'files' => $this->files($productId)]);
    }

    /** POST /api/courses/products/{product}/files/reorder — persist a drag-and-drop order. */
    public function reorderFiles(Request $request, string $productId): JsonResponse
    {
        Gate::authorize('course.manage');

        $this->currentAcademyId();
        $this->findProduct($productId);

        $data = $request->validate([
            'ids' => ['required', 'array', 'min:1'],
            'ids.*' => ['required', 'uuid'],
        ]);

        DB::transaction(function () use ($data, $productId): void {
            foreach (array_values($data['ids']) as $index => $fileId) {
                DB::table('digital_product_files')
                    ->where('product_id', $productId)
                    ->where('id', $fileId)
                    ->update(['position' => $index, 'updated_at' => now()]);
            }
        });

        return response()->json(['ok' => true, 'files' => $this->files($productId)]);
    }

    // ── internals ────────────────────────────────────────────────────────────

    /** A product in the current academy (RLS scopes it) or 404. Excludes soft-deleted rows. */
    private function findProduct(string $id): object
    {
        $product = DB::table('digital_products')->where('id', $id)->whereNull('deleted_at')->first();
        if ($product === null) {
            abort(404, 'Product not found.');
        }

        return $product;
    }

    private function findFile(string $productId, string $id): object
    {
        $file = DB::table('digital_product_files')
            ->where('product_id', $productId)->where('id', $id)->first();
        if ($file === null) {
            abort(404, 'File not found.');
        }

        return $file;
    }

    /**
     * The product's files, in author order. Staff get a resolvable URL for every file (they own it);
     * the learner surfaces are the ones that gate on `is_preview` + an entitlement.
     *
     * @return list<array<string,mixed>>
     */
    private function files(string $productId): array
    {
        return DB::table('digital_product_files as f')
            ->leftJoin('media_assets as m', 'm.id', '=', 'f.media_asset_id')
            ->where('f.product_id', $productId)
            ->orderBy('f.position')
            ->orderBy('f.created_at')
            ->get([
                'f.id', 'f.title', 'f.format', 'f.size_bytes', 'f.page_count', 'f.is_preview',
                'f.position', 'f.media_asset_id', 'f.external_url',
                'm.storage_key', 'm.status as asset_status', 'm.original_filename',
            ])
            ->map(fn (object $f): array => [
                'id' => (string) $f->id,
                'title' => (string) $f->title,
                'format' => $f->format,
                'size_bytes' => $f->size_bytes === null ? null : (int) $f->size_bytes,
                'page_count' => $f->page_count === null ? null : (int) $f->page_count,
                'is_preview' => (bool) $f->is_preview,
                'position' => (int) $f->position,
                'media_asset_id' => $f->media_asset_id === null ? null : (string) $f->media_asset_id,
                'external_url' => $f->external_url,
                'original_filename' => $f->original_filename,
                'asset_status' => $f->asset_status,
                // Short-lived and minted per render: staff open the file to check they uploaded the
                // right one, which is exactly what the buyer will get.
                'url' => $this->fileUrl($f),
            ])
            ->all();
    }

    private function fileUrl(object $f): ?string
    {
        if ($f->external_url !== null && trim((string) $f->external_url) !== '') {
            return (string) $f->external_url;
        }
        $key = (string) ($f->storage_key ?? '');

        return $key === '' ? null : LmsMedia::objectUrl($key);
    }

    private function nextFilePosition(string $productId): int
    {
        return (int) DB::table('digital_product_files')
            ->where('product_id', $productId)->max('position') + 1;
    }

    /**
     * The uploaded asset a file points at. Must be a READY DOCUMENT/AUDIO/VIDEO upload of THIS
     * academy — RLS scopes the lookup, so another tenant's id simply fails the check.
     */
    private function resolveFileAsset(array $data): ?object
    {
        $assetId = $data['media_asset_id'] ?? null;
        if ($assetId === null) {
            return null;
        }

        $asset = DB::table('media_assets')->where('id', $assetId)
            ->first(['id', 'kind', 'status', 'size_bytes', 'original_filename']);

        if ($asset === null || (string) $asset->status !== 'READY'
            || ! in_array((string) $asset->kind, ['DOCUMENT', 'AUDIO', 'VIDEO'], true)) {
            throw ValidationException::withMessages([
                'media_asset_id' => ['That file is not ready yet — please re-upload it.'],
            ]);
        }

        return $asset;
    }

    /** A short uppercase badge for the file row — PDF, EPUB, MP3 — from whatever we know of it. */
    private function formatOf(array $data, ?object $asset): ?string
    {
        $explicit = $data['format'] ?? null;
        if (is_string($explicit) && trim($explicit) !== '') {
            return strtoupper(substr(trim($explicit), 0, 12));
        }

        $source = (string) ($asset->original_filename ?? $data['external_url'] ?? '');
        $ext = strtolower((string) pathinfo(parse_url($source, PHP_URL_PATH) ?: $source, PATHINFO_EXTENSION));
        $ext = preg_replace('/[^a-z0-9]/', '', $ext) ?? '';

        return $ext === '' ? null : strtoupper(substr($ext, 0, 12));
    }

    /**
     * Does the client have any live receiving account? Deliberately NOT memoised on the instance:
     * Laravel caches the controller on the Route, so an instance property outlives the request and
     * would serve a stale answer after the client switched their last method off.
     */
    private function hasActivePaymentMethod(): bool
    {
        return DB::table('lms_payment_methods')->where('is_active', true)->exists();
    }

    /** @return array<string, list<mixed>> */
    private function rules(bool $creating): array
    {
        $required = $creating ? 'required' : 'sometimes';

        return [
            'title' => [$required, 'string', 'max:255'],
            'subtitle' => ['sometimes', 'nullable', 'string', 'max:255'],
            'description' => ['sometimes', 'nullable', 'string', 'max:10000'],
            'slug' => $creating ? ['prohibited'] : ['sometimes', 'string', 'max:255', 'regex:/^[a-z0-9-]+$/'],
            'kind' => ['sometimes', Rule::in(self::KINDS)],
            'author' => ['sometimes', 'nullable', 'string', 'max:160'],
            'language' => ['sometimes', 'nullable', 'string', 'max:40'],
            'category' => ['sometimes', 'nullable', 'string', 'max:80'],
            'page_count' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:100000'],
            // Integer minor units in the academy's currency. 0 (or omitted) = free.
            'price_minor' => ['sometimes', 'integer', 'min:0', 'max:'.self::MAX_PRICE_MINOR],
            'checkout_enabled' => ['sometimes', 'boolean'],
            'highlights' => ['sometimes', 'array', 'max:'.self::SALES_LISTS['highlights']],
            // `nullable` because a repeatable form submits the blank row the user left behind and
            // ConvertEmptyStringsToNull turns it into null on the way in — an ordinary edit.
            'highlights.*' => ['nullable', 'string', 'max:300'],
            'audience' => ['sometimes', 'array', 'max:'.self::SALES_LISTS['audience']],
            'audience.*' => ['nullable', 'string', 'max:300'],
            'cover_media_asset_id' => ['sometimes', 'nullable', 'uuid'],
            'cover_image_path' => ['sometimes', 'nullable', 'string', 'max:1024'],
        ];
    }

    /** @return array<string, list<mixed>> */
    private function fileRules(bool $creating = true): array
    {
        $required = $creating ? 'required' : 'sometimes';

        return [
            'title' => [$required, 'string', 'max:200'],
            'media_asset_id' => ['sometimes', 'nullable', 'uuid'],
            'external_url' => ['sometimes', 'nullable', 'url', 'max:2048'],
            'format' => ['sometimes', 'nullable', 'string', 'max:12'],
            'page_count' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:100000'],
            'is_preview' => ['sometimes', 'boolean'],
            'position' => ['sometimes', 'integer', 'min:0', 'max:1000'],
        ];
    }

    /**
     * The validated detail/sales fields as database columns. `$partial` is the PATCH case: only the
     * keys the request actually sent are written, so a form that edits the price alone cannot blank
     * out the highlights it never showed.
     *
     * @param  array<string,mixed>  $data
     * @return array<string,mixed>
     */
    private function detailColumns(array $data, bool $partial = false): array
    {
        $out = [];

        foreach (['author', 'language', 'category', 'page_count'] as $field) {
            if (array_key_exists($field, $data)) {
                $value = is_string($data[$field]) ? trim($data[$field]) : $data[$field];
                $out[$field] = ($value === '' || $value === null) ? null : $value;
            } elseif (! $partial) {
                $out[$field] = null;
            }
        }

        foreach (array_keys(self::SALES_LISTS) as $field) {
            if (array_key_exists($field, $data)) {
                $out[$field] = json_encode($this->cleanList($data[$field]), JSON_UNESCAPED_UNICODE);
            } elseif (! $partial) {
                $out[$field] = '[]';
            }
        }

        return $out;
    }

    /**
     * Trim, drop the blanks a repeatable form leaves behind, and re-index — a stored `[""]` would
     * render as an empty bullet on the sales page.
     *
     * @return list<string>
     */
    private function cleanList(mixed $value): array
    {
        if (! is_array($value)) {
            return [];
        }

        return array_values(array_filter(
            array_map(fn ($v): string => is_string($v) ? trim($v) : '', $value),
            fn (string $v): bool => $v !== '',
        ));
    }

    /** @return list<string> */
    private function decodeList(mixed $value): array
    {
        if (is_array($value)) {
            return array_values(array_filter($value, 'is_string'));
        }
        $decoded = is_string($value) ? json_decode($value, true) : null;

        return is_array($decoded) ? array_values(array_filter($decoded, 'is_string')) : [];
    }

    /**
     * The value to store in `cover_image_path` — an uploaded asset's storage key, else the pasted
     * url, else null. Identical contract to a course cover, so one `LmsMedia::coverUrl()` resolves
     * either on read.
     *
     * @param  array<string,mixed>  $data
     */
    private function resolveCover(array $data): ?string
    {
        $assetId = $data['cover_media_asset_id'] ?? null;
        if ($assetId !== null) {
            $asset = DB::table('media_assets')->where('id', $assetId)->first(['storage_key', 'kind', 'status']);
            if ($asset === null || (string) $asset->kind !== 'IMAGE' || (string) $asset->status !== 'READY') {
                throw ValidationException::withMessages([
                    'cover_media_asset_id' => ['That image is not ready yet — please re-upload it.'],
                ]);
            }

            return (string) $asset->storage_key;
        }

        $url = $data['cover_image_path'] ?? null;

        return is_string($url) && trim($url) !== '' ? trim($url) : null;
    }

    /** Normalise a product row for the client (ISO timestamps, typed counts, priced money). */
    private function present(object $p, ?bool $acceptsPayments = null): object
    {
        $p->created_at = $this->iso($p->created_at ?? null);
        if (property_exists($p, 'published_at')) {
            $p->published_at = $this->iso($p->published_at);
        }
        if (property_exists($p, 'cover_image_path')) {
            $p->cover_image_path = LmsMedia::coverUrl($p->cover_image_path);
        }
        foreach (['file_count', 'preview_count', 'owner_count', 'page_count'] as $count) {
            if (property_exists($p, $count) && $p->{$count} !== null) {
                $p->{$count} = (int) $p->{$count};
            }
        }

        $p->price_minor = (int) ($p->price_minor ?? 0);
        $p->currency = $this->academyCurrency();
        $p->is_free = $p->price_minor === 0;
        // `sells_online` is the honest answer: the Buy button also needs a live receiving account,
        // a site-wide fact the product editor cannot see from the row alone (docs/lms/10 §1).
        if (property_exists($p, 'checkout_enabled')) {
            $p->checkout_enabled = (bool) $p->checkout_enabled;
            $acceptsPayments ??= $this->hasActivePaymentMethod();
            $p->sells_online = $p->checkout_enabled && ! $p->is_free && $acceptsPayments;
        }
        foreach (array_keys(self::SALES_LISTS) as $field) {
            if (property_exists($p, $field)) {
                $p->{$field} = $this->decodeList($p->{$field});
            }
        }

        return $p;
    }
}
