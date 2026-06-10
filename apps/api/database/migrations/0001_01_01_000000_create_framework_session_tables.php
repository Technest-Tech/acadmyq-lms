<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Framework-owned tables that are NOT tenant-scoped and carry no academy_id.
 *
 * The domain `users` table is created later (UUID PK + §6.2 columns) in the
 * `academies_and_users` migration, once the `academies` table it references
 * exists. The framework session store is deliberately named `user_sessions`
 * (via SESSION_TABLE) so the domain can own a `sessions` table for concrete
 * lesson occurrences (§6.5).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('password_reset_tokens', function (Blueprint $table) {
            $table->string('email')->primary();
            $table->string('token');
            $table->timestamp('created_at')->nullable();
        });

        Schema::create('user_sessions', function (Blueprint $table) {
            $table->string('id')->primary();
            // users.id is a UUID; the framework writes this opportunistically, no FK.
            $table->uuid('user_id')->nullable()->index();
            $table->string('ip_address', 45)->nullable();
            $table->text('user_agent')->nullable();
            $table->longText('payload');
            $table->integer('last_activity')->index();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('user_sessions');
        Schema::dropIfExists('password_reset_tokens');
    }
};
