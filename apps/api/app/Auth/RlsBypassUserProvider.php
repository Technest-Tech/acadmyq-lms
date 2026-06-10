<?php

declare(strict_types=1);

namespace App\Auth;

use Illuminate\Auth\EloquentUserProvider;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Support\Facades\DB;

/**
 * The auth-time half of the login-under-RLS solution (Sprint 2 §4, migration
 * 000002_auth_rls_bypass_functions).
 *
 * Laravel's default EloquentUserProvider runs `User::where('email', …)` (login) and
 * `User::find($id)` (session resumption on every request) — both plain SELECTs on the
 * RLS-protected `users` table, with NO tenant context set yet, so they return zero rows and
 * authentication can never succeed. This provider routes exactly those two reads through
 * the BYPASSRLS SECURITY DEFINER functions instead, the only sanctioned context-free way
 * into the identity table. Password verification (validateCredentials) is unchanged — it
 * still runs Hash::check against the hydrated model.
 *
 * Remember-me is unused under Sanctum SPA cookie auth, so the token methods are inert
 * (a context-free SELECT for a remember token would otherwise fail closed).
 */
final class RlsBypassUserProvider extends EloquentUserProvider
{
    public function retrieveById($identifier): ?Authenticatable
    {
        $row = DB::selectOne('select * from app.auth_find_by_id(?::uuid)', [$identifier]);

        return $row ? $this->hydrate($row) : null;
    }

    public function retrieveByCredentials(array $credentials): ?Authenticatable
    {
        $email = $credentials['email'] ?? null;
        if (! is_string($email) || $email === '') {
            return null;
        }

        $row = DB::selectOne('select * from app.auth_find_by_email(?)', [$email]);

        return $row ? $this->hydrate($row) : null;
    }

    public function retrieveByToken($identifier, $token): ?Authenticatable
    {
        return null; // remember-me not used under SPA cookie auth
    }

    public function updateRememberToken(Authenticatable $user, $token): void
    {
        // no-op: remember tokens are not issued under SPA cookie auth
    }

    /** Build a fully-hydrated, "exists" User model from a bypass-function row. */
    private function hydrate(object $row): Authenticatable
    {
        return $this->createModel()->newFromBuilder((array) $row);
    }
}
