<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Laravel\Sanctum\HasApiTokens;

/**
 * A learner (LMS module, docs/lms) — a self-registered student of ONE academy who signs in on the
 * public course subdomain and is authenticated by a Sanctum bearer token. Deliberately separate from
 * staff `users` and from `students`: a different table, a different guard (`learner`), a different
 * login surface. Every query against it runs under the subdomain's academy context (RLS), so a
 * learner token minted for academy A can never read academy B.
 */
class Learner extends Authenticatable
{
    use HasApiTokens, HasUuids;

    protected $table = 'learners';

    /** @var list<string> */
    protected $fillable = [
        'academy_id',
        'email',
        'password',
        'full_name',
        'phone',
        'status',
        'last_login_at',
    ];

    /** @var list<string> */
    protected $hidden = [
        'password',
        'remember_token',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'last_login_at' => 'datetime',
            'password' => 'hashed',
        ];
    }
}
