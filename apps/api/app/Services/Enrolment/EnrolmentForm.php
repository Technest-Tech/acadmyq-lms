<?php

declare(strict_types=1);

namespace App\Services\Enrolment;

use App\Support\AcademyUrl;
use App\Support\Audit;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * The centre's public enrolment form (`/e/{token}`) — the one writer for `enrolment_forms`.
 *
 * An academy has exactly one form, and it comes into being the first time the staff open the card:
 * there is no "create" step, because the link is the whole point and a centre that never looks at
 * the card never needs one. The token is the credential, so it is long (32 base62 chars, ~190
 * bits), one per academy, and replaceable — the old link stops working the moment a new one is cut.
 *
 * Reads and writes run under the caller's tenant context (RLS scopes the row); the public side
 * resolves the token first through app.enrolment_form_lookup and then enters that academy's context.
 */
final class EnrolmentForm
{
    private const TOKEN_LENGTH = 32;

    public const STATUSES = ['NEW', 'CONTACTED', 'PLACEMENT_BOOKED', 'ENROLLED', 'CLOSED'];

    /** The academy's form, made on first read. */
    public function ensure(string $academyId, ?string $userId, ?string $role): object
    {
        $form = DB::table('enrolment_forms')->where('academy_id', $academyId)->first();
        if ($form !== null) {
            return $form;
        }

        $id = (string) Str::uuid();
        try {
            DB::table('enrolment_forms')->insert([
                'id' => $id,
                'academy_id' => $academyId,
                'public_token' => $this->token(),
            ]);
        } catch (UniqueConstraintViolationException) {
            // Two staff opened the card at the same moment: the first insert won, this one reads it.
            return DB::table('enrolment_forms')->where('academy_id', $academyId)->first();
        }
        Audit::log('enrolment.form_created', 'enrolment_form', $id, $academyId, $userId, $role);

        return DB::table('enrolment_forms')->where('id', $id)->first();
    }

    /**
     * Change what the form says and asks. Only the keys present are written, so a switch flipped
     * on the card never blanks the intro typed beside it.
     *
     * @param  array<string,mixed>  $changes
     */
    public function update(object $form, array $changes, ?string $userId, ?string $role): object
    {
        $allowed = ['title', 'intro', 'is_open', 'ask_subject', 'ask_level', 'ask_schedule', 'success_message'];
        $after = [];
        $before = [];
        foreach ($allowed as $key) {
            if (! array_key_exists($key, $changes)) {
                continue;
            }
            $value = $changes[$key];
            if (is_string($value)) {
                $value = trim($value);
                $value = $value === '' ? null : $value;
            }
            // The title is what the page is headed with; an empty one falls back to the default.
            if ($key === 'title' && $value === null) {
                $value = 'التسجيل في المركز';
            }
            $current = $form->{$key};
            $same = is_bool($value) ? (bool) $current === $value : $current === $value;
            if (! $same) {
                $before[$key] = $current;
                $after[$key] = $value;
            }
        }

        if ($after === []) {
            return $form;
        }

        DB::table('enrolment_forms')->where('id', $form->id)->update($after + ['updated_at' => now()]);
        Audit::log('enrolment.form_updated', 'enrolment_form', (string) $form->id, (string) $form->academy_id, $userId, $role, after: $after, before: $before);

        return DB::table('enrolment_forms')->where('id', $form->id)->first();
    }

    /** A fresh token: the old link dies at once (an advert ran its course, a link went where it should not). */
    public function rotate(object $form, ?string $userId, ?string $role): object
    {
        DB::table('enrolment_forms')->where('id', $form->id)->update([
            'public_token' => $this->token(),
            'updated_at' => now(),
        ]);
        Audit::log('enrolment.form_rotated', 'enrolment_form', (string) $form->id, (string) $form->academy_id, $userId, $role);

        return DB::table('enrolment_forms')->where('id', $form->id)->first();
    }

    /** The link, on the academy's own address (AcademyUrl) like every link a family is handed. */
    public function url(object $form): string
    {
        return AcademyUrl::origin((string) $form->academy_id).'/e/'.$form->public_token;
    }

    /** The staff card's view of the form. */
    public function staffDto(object $form): array
    {
        return $this->settings($form) + [
            'id' => $form->id,
            'url' => $this->url($form),
            'created_at' => $form->created_at,
            'updated_at' => $form->updated_at,
        ];
    }

    /** What the public page needs — no ids, no token. */
    public function publicDto(object $form): array
    {
        return $this->settings($form);
    }

    private function settings(object $form): array
    {
        return [
            'title' => (string) $form->title,
            'intro' => $form->intro,
            'is_open' => (bool) $form->is_open,
            'ask_subject' => (bool) $form->ask_subject,
            'ask_level' => (bool) $form->ask_level,
            'ask_schedule' => (bool) $form->ask_schedule,
            'success_message' => $form->success_message,
        ];
    }

    private function token(): string
    {
        return Str::random(self::TOKEN_LENGTH);
    }
}
