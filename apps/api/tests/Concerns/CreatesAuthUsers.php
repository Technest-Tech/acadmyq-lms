<?php

declare(strict_types=1);

namespace Tests\Concerns;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * Creates real login identities (users + user_roles) for the Sprint 2 auth tests, inserted
 * under exactly the tenant context their RLS `with check` requires (a SUPER_ADMIN context
 * for platform admins, the owning academy otherwise). Returns a hydrated User model ready
 * for Sanctum::actingAs(). Requires InteractsWithTenancy.
 */
trait CreatesAuthUsers
{
    /** Default password for every fixture user (Auth::attempt uses this). */
    protected string $userPassword = 'password';

    protected function makeUser(?string $academyId, string $role, array $overrides = []): User
    {
        $id = (string) Str::uuid();
        $email = $overrides['email'] ?? 'u'.substr($id, 0, 8).'@test.local';
        $locale = $overrides['preferred_locale'] ?? 'ar';
        $active = $overrides['is_active'] ?? true;

        // Insert under a context that satisfies the users/user_roles policy.
        if ($role === 'SUPER_ADMIN') {
            $this->asSuperAdmin();
        } else {
            $this->asAcademy($academyId, $role);
        }

        DB::table('users')->insert([
            'id' => $id,
            'academy_id' => $academyId,
            'full_name' => $overrides['full_name'] ?? 'User '.substr($id, 0, 8),
            'email' => $email,
            'password' => Hash::make($this->userPassword),
            'is_active' => $active,
            'preferred_locale' => $locale,
        ]);

        DB::table('user_roles')->insert([
            'id' => (string) Str::uuid(),
            'user_id' => $id,
            'academy_id' => $academyId,
            'role' => $role,
        ]);

        $user = new User;
        $user->forceFill([
            'id' => $id,
            'academy_id' => $academyId,
            'full_name' => $overrides['full_name'] ?? 'User '.substr($id, 0, 8),
            'email' => $email,
            'is_active' => $active,
            'preferred_locale' => $locale,
        ]);
        $user->exists = true;
        $user->syncOriginal();

        return $user;
    }
}
