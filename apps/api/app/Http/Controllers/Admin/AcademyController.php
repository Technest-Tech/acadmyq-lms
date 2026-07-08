<?php

declare(strict_types=1);

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Services\AcademyBilling;
use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\ModuleSubscriptionBackfill;
use App\Support\Tenancy;
use DateTimeZone;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Throwable;

/**
 * Super Admin academy onboarding & lifecycle (Sprint 3). Every action is a deliberate,
 * audited cross-tenant operation (§3.4): platform reads go through the audited
 * `app.admin_list_academies()` escape hatch, and every tenant-scoped write (report fields,
 * the first-owner user/role) runs inside the NEW academy's context via Tenancy::withContext
 * so RLS's `with check` admits it — never a context-free or wrong-tenant write (TC-3.21).
 *
 * Authorization is two-layer: a capability Gate first (no hardcoded role checks), RLS as the
 * database backstop. Academy creation is one transaction so a partial failure leaves nothing
 * half-built (AC-3.4 / TC-3.5).
 */
final class AcademyController extends Controller
{
    /** GET /api/admin/academies — platform-wide list via the audited function (§7). */
    public function index(): JsonResponse
    {
        Gate::authorize('academy.read');

        $json = DB::selectOne('select app.admin_list_academies() as a')->a;

        return response()->json(['academies' => json_decode($json, true)]);
    }

    /** GET /api/admin/academy-types — the catalog + report-field template for the wizard. */
    public function types(): JsonResponse
    {
        Gate::authorize('academy.read');

        $types = DB::table('academy_types')
            ->orderBy('name')
            ->get(['id', 'code', 'name', 'description', 'report_field_template'])
            ->map(fn ($t) => [
                'id' => $t->id,
                'code' => $t->code,
                'name' => $t->name,
                'description' => $t->description,
                'reportFieldTemplate' => json_decode($t->report_field_template, true),
            ]);

        return response()->json(['academyTypes' => $types]);
    }

    /** GET /api/admin/academies/{id} — academy detail + config (Super Admin sees any row). */
    public function show(string $id): JsonResponse
    {
        Gate::authorize('academy.read');

        $a = DB::table('academies as a')
            ->leftJoin('plans as p', 'p.id', '=', 'a.plan_id')
            ->leftJoin('academy_types as t', 't.id', '=', 'a.academy_type_id')
            ->where('a.id', $id)
            ->first([
                'a.*', 'p.code as plan_code', 'p.name as plan_name',
                't.code as type_code', 't.name as type_name',
            ]);

        if ($a === null) {
            abort(404, 'Academy not found.');
        }

        return response()->json(['academy' => $a]);
    }

    /**
     * POST /api/admin/academies — create academy + seed report fields + first owner, in ONE
     * transaction, in the new academy's context (§4.1). On success the owner receives a
     * set-password link (post-commit, retriable side effect). AC-3.1/3.2/3.3/3.4.
     */
    public function store(Request $request): JsonResponse
    {
        Gate::authorize('academy.create');

        $data = $this->validateAcademy($request, creating: true);
        $ctx = app(AuthContext::class);

        $academyId = (string) Str::uuid();
        $ownerEmail = strtolower((string) $data['email']);
        // No name is collected at creation — default a display name from the email's local part
        // (the owner can edit their profile later).
        $ownerName = (string) Str::of($ownerEmail)->before('@')->trim() ?: $ownerEmail;
        $ownerId = (string) Str::uuid();

        // Seed-source template is read from the chosen type (data, not code: a new type seeds
        // its own fields with zero engine change — R-CRF, TC-3.27/3.28).
        $template = json_decode(
            (string) DB::table('academy_types')->where('id', $data['academy_type_id'])->value('report_field_template'),
            true
        ) ?: [];

        try {
            // Everything below shares one transaction in the NEW academy's context: a failure
            // anywhere (e.g. a duplicate owner email) rolls the whole thing back (TC-3.5).
            $this->inAcademyContext($academyId, function () use ($academyId, $data, $template, $ownerId, $ownerEmail, $ownerName, $ctx) {
                DB::table('academies')->insert([
                    'id' => $academyId,
                    'name' => $data['name'],
                    'academy_type_id' => $data['academy_type_id'],
                    'status' => $data['status'] ?? 'ACTIVE',
                    'plan_id' => $data['plan_id'] ?? null,
                    'default_currency' => $data['default_currency'],
                    'timezone' => $data['timezone'],
                    'invoice_grouping' => $data['invoice_grouping'] ?? 'PER_GUARDIAN',
                    'billing_day' => $data['billing_day'] ?? 1,
                    'brand_display_name' => $data['brand_display_name'] ?? null,
                    'brand_logo_url' => $data['brand_logo_url'] ?? null,
                    'subdomain' => $data['subdomain'] ?? null,
                ]);
                Audit::log('academy.create', 'academy', $academyId, $academyId, $ctx->userId, 'SUPER_ADMIN', after: [
                    'name' => $data['name'],
                    'academy_type_id' => $data['academy_type_id'],
                    'plan_id' => $data['plan_id'] ?? null,
                    'default_currency' => $data['default_currency'],
                    'timezone' => $data['timezone'],
                ]);

                $this->seedReportFields($academyId, $template);
                Audit::log('report_field.manage', 'report_field_definition', null, $academyId, $ctx->userId, 'SUPER_ADMIN', after: [
                    'seeded' => count($template),
                    'source' => 'academy_type_template',
                ]);

                // First Owner: a real users row with a placeholder password (set later via the
                // set-password link) + the ACADEMY_OWNER assignment (§3.4).
                DB::table('users')->insert([
                    'id' => $ownerId,
                    'academy_id' => $academyId,
                    'full_name' => $ownerName,
                    'email' => $ownerEmail,
                    'password' => Hash::make((string) $data['password']),
                    'is_active' => true,
                    'invited_at' => now(),
                ]);
                Audit::log('user.invite', 'user', $ownerId, $academyId, $ctx->userId, 'SUPER_ADMIN', after: [
                    'email' => $ownerEmail,
                    'full_name' => $ownerName,
                ]);

                DB::table('user_roles')->insert([
                    'id' => (string) Str::uuid(),
                    'user_id' => $ownerId,
                    'academy_id' => $academyId,
                    'role' => 'ACADEMY_OWNER',
                ]);
                Audit::log('role.assign', 'user_role', $ownerId, $academyId, $ctx->userId, 'SUPER_ADMIN', after: [
                    'role' => 'ACADEMY_OWNER',
                ]);

                // Open the subscription now (mirrored from the just-set status/plan) so a paid tier's
                // 5-day trial has real start/end dates from minute one, rather than being lazily
                // backfilled on first read or by the nightly expiry job. Idempotent (TC-3.x).
                app(AcademyBilling::class)->ensureSubscription($academyId);
                // Phase 2b: derive the new academy's per-module subscriptions from its plan so the
                // module-subscription resolver reads current state (docs/superadmin-modules).
                ModuleSubscriptionBackfill::reconcile($academyId);
            });
        } catch (Throwable $e) {
            // A unique violation (owner email / subdomain) surfaces as a clean 422; the
            // transaction has already rolled back, so no academy/fields/user remain (AC-3.4).
            if ($this->isUniqueViolation($e)) {
                throw ValidationException::withMessages([
                    'email' => ['Could not create the academy: that email or subdomain is already taken.'],
                ]);
            }
            throw $e;
        }

        // The owner can sign in immediately with the email + password set above — no set-password
        // link is sent for the create flow.

        return response()->json([
            'academyId' => $academyId,
            'ownerId' => $ownerId,
            'reportFields' => count($template),
        ], 201);
    }

    /**
     * PATCH /api/admin/academies/{id} — edit name, currency, timezone, grouping, billing_day,
     * branding. Records a before/after audit of exactly the changed fields (TC-3.30). Changing
     * default_currency after subscriptions exist returns a warning and never retroactively
     * alters existing per-student currencies or closed invoices (AC-3.11 / TC-3.25).
     */
    public function update(Request $request, string $id): JsonResponse
    {
        Gate::authorize('academy.configure');

        $existing = DB::table('academies')->where('id', $id)->first();
        if ($existing === null) {
            abort(404, 'Academy not found.');
        }

        $data = $this->validateAcademy($request, creating: false, ignoreId: $id);
        $ctx = app(AuthContext::class);

        $editable = ['name', 'default_currency', 'timezone', 'invoice_grouping', 'billing_day',
            'brand_display_name', 'brand_logo_url', 'subdomain'];

        $before = [];
        $after = [];
        foreach ($editable as $col) {
            if (array_key_exists($col, $data) && (string) $data[$col] !== (string) $existing->{$col}) {
                $before[$col] = $existing->{$col};
                $after[$col] = $data[$col];
            }
        }

        if ($after === []) {
            return response()->json(['ok' => true, 'changed' => [], 'warning' => null]);
        }

        $warning = null;

        $this->inAcademyContext($id, function () use ($id, $after, $before, $ctx, &$warning) {
            // Currency is only a *default* for new entities; existing subscriptions/invoices
            // snapshot their own currency and are never touched (R-INV, AC-3.11).
            if (array_key_exists('default_currency', $after)) {
                $hasSubs = DB::table('subscriptions')->where('academy_id', $id)->exists();
                if ($hasSubs) {
                    $warning = 'Changing the default currency does not affect existing subscriptions or closed invoices.';
                }
            }

            DB::table('academies')->where('id', $id)->update($after + ['updated_at' => now()]);

            Audit::log('academy.configure', 'academy', $id, $id, $ctx->userId, 'SUPER_ADMIN', after: $after, before: $before);
        });

        return response()->json(['ok' => true, 'changed' => array_keys($after), 'warning' => $warning]);
    }

    /** POST /api/admin/academies/{id}/suspend — status=SUSPENDED, audit; logins blocked (§4.3). */
    public function suspend(Request $request, string $id): JsonResponse
    {
        Gate::authorize('academy.suspend');

        $data = $request->validate(['reason' => ['nullable', 'string', 'max:1000']]);

        return $this->setStatus($id, 'SUSPENDED', $data['reason'] ?? null);
    }

    /** POST /api/admin/academies/{id}/reactivate — status=ACTIVE, audit; logins restored. */
    public function reactivate(string $id): JsonResponse
    {
        Gate::authorize('academy.suspend');

        return $this->setStatus($id, 'ACTIVE', null);
    }

    /**
     * POST /api/admin/academies/{id}/owner — (re)provision an owner login (idempotent, §10).
     * Re-sends the set-password link if the owner already exists, else creates the user+role.
     */
    public function provisionOwner(Request $request, string $id): JsonResponse
    {
        Gate::authorize('user.invite');
        Gate::authorize('role.assign');

        if (DB::table('academies')->where('id', $id)->doesntExist()) {
            abort(404, 'Academy not found.');
        }

        $data = $request->validate([
            'owner_full_name' => ['required', 'string', 'max:255'],
            'owner_email' => ['required', 'email', 'max:255'],
        ]);
        $email = strtolower($data['owner_email']);
        $ctx = app(AuthContext::class);

        $ownerId = null;

        try {
            $this->inAcademyContext($id, function () use ($id, $data, $email, $ctx, &$ownerId) {
                $existing = DB::table('users')->where('academy_id', $id)->whereRaw('lower(email) = ?', [$email])->first();

                if ($existing !== null) {
                    $ownerId = $existing->id;
                    DB::table('users')->where('id', $ownerId)->update(['invited_at' => now()]);
                } else {
                    $ownerId = (string) Str::uuid();
                    DB::table('users')->insert([
                        'id' => $ownerId,
                        'academy_id' => $id,
                        'full_name' => $data['owner_full_name'],
                        'email' => $email,
                        'password' => Hash::make(Str::random(40)),
                        'is_active' => true,
                        'invited_at' => now(),
                    ]);
                    Audit::log('user.invite', 'user', $ownerId, $id, $ctx->userId, 'SUPER_ADMIN', after: ['email' => $email]);
                }

                // Ensure the ACADEMY_OWNER assignment exists (idempotent on the unique index).
                $hasRole = DB::table('user_roles')
                    ->where('user_id', $ownerId)->where('academy_id', $id)->where('role', 'ACADEMY_OWNER')->exists();
                if (! $hasRole) {
                    DB::table('user_roles')->insert([
                        'id' => (string) Str::uuid(),
                        'user_id' => $ownerId,
                        'academy_id' => $id,
                        'role' => 'ACADEMY_OWNER',
                    ]);
                    Audit::log('role.assign', 'user_role', $ownerId, $id, $ctx->userId, 'SUPER_ADMIN', after: ['role' => 'ACADEMY_OWNER']);
                }
            });
        } catch (Throwable $e) {
            if ($this->isUniqueViolation($e)) {
                throw ValidationException::withMessages([
                    'owner_email' => ['That email is already in use by another account.'],
                ]);
            }
            throw $e;
        }

        $this->sendSetPasswordLink($email);

        return response()->json(['ownerId' => $ownerId], 201);
    }

    /**
     * GET /api/admin/academies/{id}/owner — the academy's current owner login (email + name) so
     * the admin can manage it. Returns owner: null when none has been provisioned yet.
     */
    public function getOwner(string $id): JsonResponse
    {
        Gate::authorize('academy.configure');

        if (DB::table('academies')->where('id', $id)->doesntExist()) {
            abort(404, 'Academy not found.');
        }

        $owner = $this->inAcademyContext($id, fn () => DB::table('users as u')
            ->join('user_roles as ur', 'ur.user_id', '=', 'u.id')
            ->where('ur.academy_id', $id)
            ->where('ur.role', 'ACADEMY_OWNER')
            ->orderBy('u.created_at')
            ->first(['u.id', 'u.full_name', 'u.email', 'u.is_active']));

        return response()->json([
            'owner' => $owner === null ? null : [
                'id' => $owner->id,
                'full_name' => $owner->full_name,
                'email' => $owner->email,
                'is_active' => (bool) $owner->is_active,
            ],
        ]);
    }

    /**
     * PATCH /api/admin/academies/{id}/owner — manage the current owner's login: change the email
     * and/or reset the password directly (no set-password email). At least one field is required.
     * Gated by user.invite + role.assign (the same authority that provisions an owner).
     */
    public function updateOwner(Request $request, string $id): JsonResponse
    {
        Gate::authorize('academy.configure');

        if (DB::table('academies')->where('id', $id)->doesntExist()) {
            abort(404, 'Academy not found.');
        }

        $data = $request->validate([
            'email' => ['sometimes', 'email', 'max:255'],
            'password' => ['sometimes', 'string', 'min:8', 'max:255'],
        ]);
        if (! array_key_exists('email', $data) && ! array_key_exists('password', $data)) {
            throw ValidationException::withMessages([
                'email' => ['Provide a new email or password to update.'],
            ]);
        }
        $ctx = app(AuthContext::class);

        $owner = $this->inAcademyContext($id, fn () => DB::table('users as u')
            ->join('user_roles as ur', 'ur.user_id', '=', 'u.id')
            ->where('ur.academy_id', $id)
            ->where('ur.role', 'ACADEMY_OWNER')
            ->orderBy('u.created_at')
            ->first(['u.id', 'u.email']));

        if ($owner === null) {
            abort(404, 'This academy has no owner yet — provision one first.');
        }

        $update = [];
        $changed = [];
        if (array_key_exists('email', $data)) {
            $update['email'] = strtolower((string) $data['email']);
            $changed[] = 'email';
        }
        if (array_key_exists('password', $data)) {
            $update['password'] = Hash::make((string) $data['password']);
            $changed[] = 'password';
        }

        try {
            $this->inAcademyContext($id, function () use ($id, $owner, $update, $changed, $ctx) {
                DB::table('users')->where('id', $owner->id)->update($update);
                Audit::log('user.update', 'user', $owner->id, $id, $ctx->userId, 'SUPER_ADMIN', after: [
                    'changed' => $changed,
                    'email' => $update['email'] ?? $owner->email,
                ]);
            });
        } catch (Throwable $e) {
            if ($this->isUniqueViolation($e)) {
                throw ValidationException::withMessages([
                    'email' => ['That email is already in use by another account.'],
                ]);
            }
            throw $e;
        }

        return response()->json(['ok' => true, 'changed' => $changed]);
    }

    /**
     * POST /api/admin/academies/{id}/plan — change an academy's plan (Sprint 9 §8, plan.manage).
     * Audited (academy.plan_changed, before/after) so a tier move is traceable (AC-9.14). The
     * write runs in the academy's context: academies.update requires is_super_admin (satisfied),
     * and the audit row is academy-scoped so the owner can see "your plan changed".
     */
    public function setPlan(Request $request, string $id): JsonResponse
    {
        Gate::authorize('plan.manage');

        $existing = DB::table('academies')->where('id', $id)->first();
        if ($existing === null) {
            abort(404, 'Academy not found.');
        }

        $data = $request->validate([
            'plan_id' => ['required', 'uuid', Rule::exists('plans', 'id')],
        ]);
        $ctx = app(AuthContext::class);

        if ((string) $existing->plan_id === $data['plan_id']) {
            return response()->json(['ok' => true, 'changed' => false]);
        }

        $this->inAcademyContext($id, function () use ($id, $data, $existing, $ctx) {
            DB::table('academies')->where('id', $id)->update([
                'plan_id' => $data['plan_id'],
                'updated_at' => now(),
            ]);

            Audit::log('academy.plan_changed', 'academy', $id, $id, $ctx->userId, 'SUPER_ADMIN',
                after: ['plan_id' => $data['plan_id']],
                before: ['plan_id' => $existing->plan_id]);

            // Keep the subscription's snapshot cost (base + add-ons) in sync with the new plan.
            app(AcademyBilling::class)->recomputeTotals($id);
            // Phase 2b: keep the per-module subscriptions in sync with the new plan (may add/remove a
            // MANAGEMENT / VIDEO / WHATSAPP sub, e.g. switching to/from the video-only MEET plan).
            ModuleSubscriptionBackfill::reconcile($id);
        });

        return response()->json(['ok' => true, 'changed' => true]);
    }

    /**
     * POST /api/admin/academies/{id}/addons — grant or revoke an add-on (Sprint 9 §8, plan.manage).
     * Idempotent on (academy_id, add_on_id): granting unlocks the add-on's feature_key on top of
     * the plan; revoking (is_active=false) re-locks it (AC-9.3). Audited (academy.addon_changed,
     * AC-9.14). The upsert runs in the academy's context so the tenant `with check` admits it.
     */
    public function setAddOn(Request $request, string $id): JsonResponse
    {
        Gate::authorize('plan.manage');

        if (DB::table('academies')->where('id', $id)->doesntExist()) {
            abort(404, 'Academy not found.');
        }

        $data = $request->validate([
            'add_on_id' => ['required', 'uuid', Rule::exists('add_ons', 'id')],
            'is_active' => ['sometimes', 'boolean'],
        ]);
        $isActive = $data['is_active'] ?? true;
        $ctx = app(AuthContext::class);

        $this->inAcademyContext($id, function () use ($id, $data, $isActive, $ctx) {
            $existing = DB::table('academy_addons')
                ->where('academy_id', $id)->where('add_on_id', $data['add_on_id'])->first();

            if ($existing === null) {
                DB::table('academy_addons')->insert([
                    'id' => (string) Str::uuid(),
                    'academy_id' => $id,
                    'add_on_id' => $data['add_on_id'],
                    'is_active' => $isActive,
                    'granted_at' => now(),
                ]);
            } else {
                DB::table('academy_addons')
                    ->where('academy_id', $id)->where('add_on_id', $data['add_on_id'])
                    ->update(['is_active' => $isActive, 'updated_at' => now()]);
            }

            Audit::log('academy.addon_changed', 'add_on', $data['add_on_id'], $id, $ctx->userId, 'SUPER_ADMIN',
                after: ['add_on_id' => $data['add_on_id'], 'is_active' => $isActive]);

            // Add-on grants/revocations change the subscription's total cost.
            app(AcademyBilling::class)->recomputeTotals($id);
        });

        return response()->json(['ok' => true, 'isActive' => $isActive]);
    }

    /** GET /api/admin/academies/{id}/addons — the academy's add-on grants (plan.manage). */
    public function addOns(string $id): JsonResponse
    {
        Gate::authorize('plan.manage');

        if (DB::table('academies')->where('id', $id)->doesntExist()) {
            abort(404, 'Academy not found.');
        }

        $grants = $this->inAcademyContext($id, fn () => DB::table('academy_addons as aa')
            ->join('add_ons as ao', 'ao.id', '=', 'aa.add_on_id')
            ->where('aa.academy_id', $id)
            ->get(['aa.add_on_id', 'aa.is_active', 'aa.granted_at', 'ao.code', 'ao.name', 'ao.feature_key']));

        return response()->json(['addOns' => $grants]);
    }

    /** POST /api/admin/academies/{id}/enter — set entered academy + audit admin.enter_academy. */
    public function enter(Request $request, string $id): JsonResponse
    {
        Gate::authorize('academy.enter');

        $ctx = app(AuthContext::class);

        if (DB::table('academies')->where('id', $id)->doesntExist()) {
            abort(404, 'Academy not found.');
        }

        $request->session()->put('entered_academy_id', $id);

        Audit::log('admin.enter_academy', 'academy', $id, $id, $ctx->userId, $ctx->role);

        return response()->json(['enteredAcademyId' => $id]);
    }

    /** POST /api/admin/academies/exit — return to the platform (no-tenant) view. */
    public function exit(Request $request): JsonResponse
    {
        $request->session()->forget('entered_academy_id');

        return response()->json(['ok' => true]);
    }

    // ── internals ────────────────────────────────────────────────────────────

    /** Update status (+suspend metadata) and audit the lifecycle change. */
    private function setStatus(string $id, string $status, ?string $reason): JsonResponse
    {
        $existing = DB::table('academies')->where('id', $id)->first();
        if ($existing === null) {
            abort(404, 'Academy not found.');
        }

        $ctx = app(AuthContext::class);
        $action = $status === 'SUSPENDED' ? 'academy.suspend' : 'academy.reactivate';

        $this->inAcademyContext($id, function () use ($id, $status, $reason, $existing, $ctx, $action) {
            DB::table('academies')->where('id', $id)->update([
                'status' => $status,
                'suspended_at' => $status === 'SUSPENDED' ? now() : null,
                'suspended_reason' => $status === 'SUSPENDED' ? $reason : null,
                'updated_at' => now(),
            ]);

            Audit::log($action, 'academy', $id, $id, $ctx->userId, 'SUPER_ADMIN',
                after: ['status' => $status, 'reason' => $reason],
                before: ['status' => $existing->status]);
        });

        return response()->json(['ok' => true, 'status' => $status]);
    }

    /** Copy a type's report-field template into the academy's report_field_definitions (§5). */
    private function seedReportFields(string $academyId, array $template): void
    {
        foreach (array_values($template) as $i => $field) {
            DB::table('report_field_definitions')->insert([
                'id' => (string) Str::uuid(),
                'academy_id' => $academyId,
                'key' => $field['key'],
                'label_ar' => $field['label_ar'] ?? $field['key'],
                'label_en' => $field['label_en'] ?? $field['key'],
                'field_type' => $field['field_type'] ?? 'TEXT',
                'options' => isset($field['options']) && $field['options'] !== null ? json_encode($field['options']) : null,
                'sort_order' => $field['sort_order'] ?? ($i + 1),
                'is_required' => $field['is_required'] ?? false,
                'is_active' => true,
            ]);
        }
    }

    /**
     * Run $fn inside the target academy's tenant context as the Super Admin — the audited
     * cross-tenant path (§3.4). Opens a transaction whose RLS GUCs point at $academyId so the
     * tenant `with check` admits the writes, and rolls back atomically on any failure.
     *
     * @template T
     *
     * @param  callable():T  $fn
     * @return T
     */
    private function inAcademyContext(string $academyId, callable $fn): mixed
    {
        $ctx = app(AuthContext::class);
        $target = new AuthContext(
            userId: $ctx->userId,
            academyId: $academyId,
            role: 'SUPER_ADMIN',
            permissions: $ctx->permissions,
        );

        return Tenancy::withContext($target, $fn);
    }

    /**
     * Validate the academy payload. Branding `subdomain` is validated unique + DNS-safe now
     * even though unused (R-BRA-1 / AC-3.7); timezone must be a real IANA name (TC-3.8).
     *
     * @return array<string,mixed>
     */
    private function validateAcademy(Request $request, bool $creating, ?string $ignoreId = null): array
    {
        $req = $creating ? 'required' : 'sometimes';

        $rules = [
            'name' => [$req, 'string', 'max:255'],
            'academy_type_id' => [$creating ? 'required' : 'prohibited', 'uuid', Rule::exists('academy_types', 'id')],
            'plan_id' => ['nullable', 'uuid', Rule::exists('plans', 'id')],
            'default_currency' => [$req, 'string', 'size:3'],
            'timezone' => [$req, 'string', Rule::in(DateTimeZone::listIdentifiers())],
            'invoice_grouping' => ['sometimes', Rule::in(['PER_GUARDIAN', 'PER_STUDENT'])],
            'billing_day' => ['sometimes', 'integer', 'min:1', 'max:28'],
            'status' => ['sometimes', Rule::in(['ACTIVE', 'TRIAL'])],
            'brand_display_name' => ['nullable', 'string', 'max:255'],
            'brand_logo_url' => ['nullable', 'url', 'max:2048'],
            'subdomain' => [
                'nullable', 'string', 'max:63',
                'regex:/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/',
                Rule::unique('academies', 'subdomain')->ignore($ignoreId),
            ],
        ];

        if ($creating) {
            // The first owner's login credentials, set directly by the Super Admin (no emailed
            // set-password link). Email format only — global uniqueness is enforced inside the
            // creation transaction so a collision exercises the atomic rollback (TC-3.5).
            $rules['email'] = ['required', 'email', 'max:255'];
            $rules['password'] = ['required', 'string', 'min:8', 'max:255'];
        }

        $data = $request->validate($rules);

        if (isset($data['default_currency'])) {
            $data['default_currency'] = strtoupper($data['default_currency']);
        }

        return $data;
    }

    /** Best-effort set-password link for a freshly-provisioned owner (post-commit side effect). */
    private function sendSetPasswordLink(string $email): void
    {
        try {
            Password::broker()->sendResetLink(['email' => $email]);
        } catch (Throwable) {
            // Retriable: the owner can be re-provisioned via POST .../owner (§10).
        }
    }

    /** Did this throwable wrap a Postgres unique_violation (SQLSTATE 23505)? */
    private function isUniqueViolation(Throwable $e): bool
    {
        return ($e->getCode() === '23505')
            || ($e->getPrevious() !== null && $e->getPrevious()->getCode() === '23505');
    }
}
