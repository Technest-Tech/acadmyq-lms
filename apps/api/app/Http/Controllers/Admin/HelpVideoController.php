<?php

declare(strict_types=1);

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\LmsMedia;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * The Super Admin side of the in-app help videos (`help_videos`, platform.manage).
 *
 * A slot takes its video one of two ways:
 *
 *   LINK    PUT /admin/help-videos/{slot} {url}            — YouTube, Vimeo or a direct file url.
 *   UPLOAD  POST /admin/help-videos/upload-url             — reserve a key, get where to PUT the file
 *           (the browser sends the file straight to storage, never through PHP — a screen recording
 *            is far past the 20 MB PHP takes), then
 *           PUT /admin/help-videos/{slot} {storage_key}    — attach it once it landed.
 *
 * Replacing or removing a video deletes the file it replaces, so a slot never holds two. The slot
 * names themselves belong to the web app (its help content); the server only checks their shape, so
 * a new help page needs no deploy here.
 */
final class HelpVideoController extends Controller
{
    /** A slot: lowercase words joined by dots / dashes ("students", "students.add"). */
    public const SLOT_PATTERN = '/^[a-z0-9][a-z0-9._-]{0,79}$/';

    /** Hard ceiling for one help clip — these are one-minute screen recordings. 500 MiB. */
    private const MAX_UPLOAD_BYTES = 524288000;

    /** Where every uploaded help video lives on the media disk. */
    private const DIR = 'help/videos';

    /** POST /api/admin/help-videos/upload-url — reserve a key and return the upload target. */
    public function createUpload(Request $request): JsonResponse
    {
        Gate::authorize('platform.manage');

        $data = $request->validate([
            'slot' => ['required', 'string', 'regex:'.self::SLOT_PATTERN],
            'filename' => ['required', 'string', 'max:255'],
            'content_type' => ['required', 'string', 'max:255', 'starts_with:video/'],
            'size_bytes' => ['required', 'integer', 'min:1', 'max:'.self::MAX_UPLOAD_BYTES],
        ]);

        $ext = strtolower(pathinfo($data['filename'], PATHINFO_EXTENSION));
        $ext = preg_match('/^[a-z0-9]{1,5}$/', $ext) === 1 ? $ext : 'mp4';
        $key = self::DIR.'/'.$data['slot'].'/'.((string) Str::uuid()).'.'.$ext;

        return response()->json([
            'key' => $key,
            'upload' => LmsMedia::uploadTarget($key, $data['content_type']),
        ], 201);
    }

    /** PUT /api/admin/help-videos/{slot} — point the slot at a link or at an uploaded file. */
    public function update(Request $request, string $slot): JsonResponse
    {
        Gate::authorize('platform.manage');
        $this->assertSlot($slot);

        $data = $request->validate([
            'url' => ['required_without:storage_key', 'prohibits:storage_key', 'nullable', 'string', 'max:2048', 'url:http,https'],
            'storage_key' => ['required_without:url', 'nullable', 'string', 'max:512'],
            'filename' => ['sometimes', 'nullable', 'string', 'max:255'],
        ]);

        $ctx = app(AuthContext::class);
        $before = DB::table('help_videos')->where('slot', $slot)->first();
        $disk = Storage::disk(LmsMedia::disk());

        $key = $data['storage_key'] ?? null;
        if ($key !== null) {
            // Only a key this slot reserved, and only once the file is really there.
            $own = str_starts_with($key, self::DIR.'/'.$slot.'/') && ! str_contains($key, '..');
            if (! $own || ! $disk->exists($key)) {
                throw ValidationException::withMessages([
                    'storage_key' => ['We could not find the uploaded video — please upload it again.'],
                ]);
            }
        }

        $row = [
            'source' => $key !== null ? 'UPLOAD' : 'LINK',
            'url' => $key !== null ? null : $data['url'],
            'storage_key' => $key,
            'original_filename' => $key !== null ? ($data['filename'] ?? null) : null,
            'size_bytes' => $key !== null ? (int) $disk->size($key) : null,
            'updated_by' => $ctx->userId,
            'updated_at' => now(),
        ];

        DB::table('help_videos')->updateOrInsert(['slot' => $slot], $row);

        // The file this one replaces is nobody's now.
        $stale = $before->storage_key ?? null;
        if ($stale !== null && $stale !== $key) {
            $disk->delete((string) $stale);
        }

        Audit::log('platform.help_video', 'help_video', null, null, $ctx->userId, $ctx->role,
            after: ['slot' => $slot, 'source' => $row['source'], 'url' => $row['url'], 'filename' => $row['original_filename']],
            before: $before !== null ? ['source' => $before->source, 'url' => $before->url, 'filename' => $before->original_filename] : null);

        return response()->json(['ok' => true]);
    }

    /** DELETE /api/admin/help-videos/{slot} — back to "not recorded yet". */
    public function destroy(string $slot): JsonResponse
    {
        Gate::authorize('platform.manage');
        $this->assertSlot($slot);

        $before = DB::table('help_videos')->where('slot', $slot)->first();
        if ($before === null) {
            return response()->json(['ok' => true]);
        }

        DB::table('help_videos')->where('slot', $slot)->delete();
        if ($before->storage_key !== null) {
            Storage::disk(LmsMedia::disk())->delete((string) $before->storage_key);
        }

        $ctx = app(AuthContext::class);
        Audit::log('platform.help_video', 'help_video', null, null, $ctx->userId, $ctx->role,
            after: ['slot' => $slot, 'removed' => true],
            before: ['source' => $before->source, 'url' => $before->url, 'filename' => $before->original_filename]);

        return response()->json(['ok' => true]);
    }

    private function assertSlot(string $slot): void
    {
        abort_unless(preg_match(self::SLOT_PATTERN, $slot) === 1, 404, 'Unknown help video.');
    }
}
