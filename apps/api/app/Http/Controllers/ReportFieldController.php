<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\Tenancy;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Per-academy custom report-field configuration (Sprint 3 §4.2). These are tenant-scoped
 * data: a Super Admin manages any academy's fields cross-tenant (entering that academy's
 * context), while an Academy Owner is locked to their own academy by RLS *and* by an
 * explicit guard here (TC-3.22). Editing one academy's fields never touches another
 * (AC-3.5/3.9). Fields are deactivated, not deleted, once Sprint 6 has written values
 * against them (AC-3.5 / TC-3.14) — the deactivate-not-delete contract Sprint 6 relies on.
 */
final class ReportFieldController extends Controller
{
    private const TYPES = ['TEXT', 'TEXTAREA', 'NUMBER', 'SELECT', 'RATING'];

    /** GET /api/academies/{id}/report-fields — list (sortable by sort_order). */
    public function index(Request $request, string $id): JsonResponse
    {
        Gate::authorize('report_field.manage');

        $fields = $this->forAcademy($request, $id, fn () => DB::table('report_field_definitions')
            ->where('academy_id', $id)
            ->orderBy('sort_order')
            ->get());

        return response()->json(['reportFields' => $fields]);
    }

    /** POST /api/academies/{id}/report-fields — add a field (key unique per academy). */
    public function store(Request $request, string $id): JsonResponse
    {
        Gate::authorize('report_field.manage');

        $data = $this->validatePayload($request, creating: true);
        $ctx = app(AuthContext::class);

        $fieldId = $this->forAcademy($request, $id, function () use ($id, $data, $ctx) {
            // key uniqueness is checked INSIDE the academy context so RLS scopes the lookup
            // to this academy only (a context-free validation rule would see nothing) — TC-3.11.
            $dupe = DB::table('report_field_definitions')->where('academy_id', $id)->where('key', $data['key'])->exists();
            if ($dupe) {
                throw ValidationException::withMessages(['key' => ['That field key already exists for this academy.']]);
            }

            $fieldId = (string) Str::uuid();
            DB::table('report_field_definitions')->insert([
                'id' => $fieldId,
                'academy_id' => $id,
                'key' => $data['key'],
                'label_ar' => $data['label_ar'],
                'label_en' => $data['label_en'],
                'field_type' => $data['field_type'],
                'options' => isset($data['options']) ? json_encode($data['options']) : null,
                'sort_order' => $data['sort_order'] ?? 0,
                'is_required' => $data['is_required'] ?? false,
                'is_active' => true,
            ]);

            Audit::log('report_field.manage', 'report_field_definition', $fieldId, $id, $ctx->userId, $ctx->role, after: $data);

            return $fieldId;
        });

        return response()->json(['reportFieldId' => $fieldId], 201);
    }

    /** PATCH /api/academies/{id}/report-fields/{fieldId} — edit / reorder / deactivate. */
    public function update(Request $request, string $id, string $fieldId): JsonResponse
    {
        Gate::authorize('report_field.manage');

        $data = $this->validatePayload($request, creating: false);
        $ctx = app(AuthContext::class);

        $this->forAcademy($request, $id, function () use ($id, $fieldId, $data, $ctx) {
            $existing = DB::table('report_field_definitions')->where('academy_id', $id)->where('id', $fieldId)->first();
            if ($existing === null) {
                abort(404, 'Report field not found.');
            }

            $update = [];
            $before = [];
            foreach (['label_ar', 'label_en', 'field_type', 'sort_order', 'is_required', 'is_active'] as $col) {
                if (array_key_exists($col, $data)) {
                    $before[$col] = $existing->{$col};
                    $update[$col] = $data[$col];
                }
            }
            if (array_key_exists('options', $data)) {
                $before['options'] = $existing->options;
                $update['options'] = $data['options'] !== null ? json_encode($data['options']) : null;
            }

            if ($update === []) {
                return;
            }

            DB::table('report_field_definitions')->where('id', $fieldId)
                ->update($update + ['updated_at' => now()]);

            Audit::log('report_field.manage', 'report_field_definition', $fieldId, $id, $ctx->userId, $ctx->role, after: $update, before: $before);
        });

        return response()->json(['ok' => true]);
    }

    /**
     * DELETE /api/academies/{id}/report-fields/{fieldId} — hard delete ONLY if no session
     * report has ever carried a value for this field's key; otherwise refuse and tell the
     * caller to deactivate instead (AC-3.5 / TC-3.14). Preserves Sprint 6 history.
     */
    public function destroy(Request $request, string $id, string $fieldId): JsonResponse
    {
        Gate::authorize('report_field.manage');
        $ctx = app(AuthContext::class);

        $this->forAcademy($request, $id, function () use ($id, $fieldId, $ctx) {
            $field = DB::table('report_field_definitions')->where('academy_id', $id)->where('id', $fieldId)->first();
            if ($field === null) {
                abort(404, 'Report field not found.');
            }

            $hasValues = DB::table('session_reports')
                ->where('academy_id', $id)
                ->whereRaw('jsonb_exists(values, ?)', [$field->key])
                ->exists();

            if ($hasValues) {
                throw ValidationException::withMessages([
                    'field' => ['This field already has session-report values and cannot be deleted; deactivate it instead.'],
                ]);
            }

            DB::table('report_field_definitions')->where('id', $fieldId)->delete();
            Audit::log('report_field.manage', 'report_field_definition', $fieldId, $id, $ctx->userId, $ctx->role, after: ['deleted' => true, 'key' => $field->key]);
        });

        return response()->json(['ok' => true]);
    }

    /**
     * Run $fn in the academy whose fields are being managed. A SUPER_ADMIN may manage any
     * academy (re-point the context to {id}); anyone else is confined to their own academy —
     * a mismatch is a 403 before any query, and RLS is the backstop (TC-3.22, AC-3.9).
     *
     * @template T
     *
     * @param  callable():T  $fn
     * @return T
     */
    private function forAcademy(Request $request, string $id, callable $fn): mixed
    {
        $ctx = app(AuthContext::class);

        if ($ctx->role === 'SUPER_ADMIN') {
            $target = new AuthContext($ctx->userId, $id, 'SUPER_ADMIN', $ctx->permissions);

            return Tenancy::withContext($target, $fn);
        }

        if ($ctx->academyId !== $id) {
            abort(403, 'You may only manage your own academy.');
        }

        // Already inside the owner's academy context (set by the middleware).
        return $fn();
    }

    /**
     * @return array<string,mixed>
     */
    private function validatePayload(Request $request, bool $creating): array
    {
        $req = $creating ? 'required' : 'sometimes';

        $rules = [
            'label_ar' => [$req, 'string', 'max:255'],
            'label_en' => [$req, 'string', 'max:255'],
            'field_type' => [$req, Rule::in(self::TYPES)],
            'options' => ['nullable', 'array'],
            'options.*' => ['string', 'max:255'],
            'sort_order' => ['sometimes', 'integer', 'min:0'],
            'is_required' => ['sometimes', 'boolean'],
        ];

        if ($creating) {
            // Machine key: lowercase snake-ish identifier, stable across edits (R-CRF-2).
            $rules['key'] = ['required', 'string', 'max:64', 'regex:/^[a-z][a-z0-9_]*$/'];
        } else {
            $rules['is_active'] = ['sometimes', 'boolean'];
        }

        $data = $request->validate($rules);

        // A SELECT must ship its options (TC-3.10). Applies whenever field_type is present.
        if (($data['field_type'] ?? null) === 'SELECT' && empty($data['options'])) {
            throw ValidationException::withMessages(['options' => ['A SELECT field requires at least one option.']]);
        }

        return $data;
    }
}
