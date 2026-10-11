<?php

declare(strict_types=1);

namespace App\Http\Controllers\Lms;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Lms\Concerns\InteractsWithLms;
use App\Support\Audit;
use App\Support\CustomDomain;
use App\Support\Lms\BookingForms;
use App\Support\LmsSite;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * The booking forms on the client's course site (docs/lms/13) — "احجز استشارة", "احجز كورس", any
 * number of them, each named by the client and each asking its own handful of questions.
 *
 * `booking.read` lists them (the inbox filters by form, so a reader needs the names);
 * `booking.manage` creates, edits and deletes. Deleting a form never deletes its requests — they
 * carry the form's title as a snapshot and simply lose the link.
 */
final class BookingFormController extends Controller
{
    use InteractsWithLms;

    /** GET /api/courses/booking-forms — every form, with its inbox counts and public address. */
    public function index(): JsonResponse
    {
        Gate::authorize('booking.read');

        $counts = DB::table('booking_requests')
            ->whereNotNull('form_id')
            ->groupBy('form_id')
            ->get([
                'form_id',
                DB::raw('count(*) as total'),
                DB::raw("count(*) filter (where status = 'NEW') as new"),
            ])
            ->keyBy('form_id');

        $siteUrl = $this->publicSiteUrl();

        $forms = DB::table('booking_forms')
            ->orderBy('created_at')
            ->orderBy('id')
            ->get()
            ->map(fn (object $f): array => $this->present($f, $counts->get($f->id), $siteUrl))
            ->values();

        return response()->json(['forms' => $forms, 'site_url' => $siteUrl]);
    }

    /** POST /api/courses/booking-forms — a new form, live on the site straight away. */
    public function store(Request $request): JsonResponse
    {
        Gate::authorize('booking.manage');

        $academyId = $this->currentAcademyId();
        $data = $request->validate($this->rules(creating: true));

        $id = (string) Str::uuid();
        $slug = isset($data['slug']) && $data['slug'] !== null
            ? $this->assertSlugFree($academyId, (string) $data['slug'])
            : $this->uniqueSlugIn('booking_forms', $academyId, $data['title'], 'booking');

        DB::table('booking_forms')->insert($this->columns($data) + [
            'id' => $id,
            'academy_id' => $academyId,
            'slug' => $slug,
            'created_by' => $this->ctx()->userId,
            // The wall clock, not the transaction's: forms are listed in the order they were made
            // (the first is the site's "main" one), and now() is frozen for a whole transaction.
            'created_at' => DB::raw('clock_timestamp()'),
        ]);

        Audit::log('lms_booking_form.create', 'booking_form', $id, $academyId,
            $this->ctx()->userId, $this->ctx()->role, after: ['title' => trim($data['title'])]);

        $form = DB::table('booking_forms')->where('id', $id)->first();

        return response()->json(['form' => $this->present($form, null, $this->publicSiteUrl())], 201);
    }

    /** PATCH /api/courses/booking-forms/{id} — any subset of the settings. */
    public function update(Request $request, string $id): JsonResponse
    {
        Gate::authorize('booking.manage');

        $academyId = $this->currentAcademyId();
        $form = $this->findForm($id);
        $data = $request->validate($this->rules(creating: false));

        $columns = $this->columns($data);
        if (array_key_exists('slug', $data) && $data['slug'] !== null && $data['slug'] !== $form->slug) {
            $columns['slug'] = $this->assertSlugFree($academyId, (string) $data['slug'], $id);
        }

        if ($columns !== []) {
            DB::table('booking_forms')->where('id', $id)->update($columns + ['updated_at' => DB::raw('now()')]);
            Audit::log('lms_booking_form.update', 'booking_form', $id, $academyId,
                $this->ctx()->userId, $this->ctx()->role, after: array_keys($columns));
        }

        $fresh = DB::table('booking_forms')->where('id', $id)->first();
        $counts = DB::table('booking_requests')
            ->where('form_id', $id)
            ->first([
                DB::raw('count(*) as total'),
                DB::raw("count(*) filter (where status = 'NEW') as new"),
            ]);

        return response()->json(['form' => $this->present($fresh, $counts, $this->publicSiteUrl())]);
    }

    /**
     * DELETE /api/courses/booking-forms/{id} — the form goes; its requests stay in the inbox under
     * the title they were made with (the FK sets null, the snapshot keeps the name).
     */
    public function destroy(string $id): JsonResponse
    {
        Gate::authorize('booking.manage');

        $academyId = $this->currentAcademyId();
        $form = $this->findForm($id);

        DB::table('booking_forms')->where('id', $id)->delete();

        Audit::log('lms_booking_form.delete', 'booking_form', $id, $academyId,
            $this->ctx()->userId, $this->ctx()->role, before: ['title' => $form->title]);

        return response()->json(['ok' => true]);
    }

    // ── helpers ─────────────────────────────────────────────────────────────────────────────────

    /** @return array<string,list<mixed>> */
    private function rules(bool $creating): array
    {
        $optional = ['sometimes', 'nullable', 'string'];

        return [
            'title' => [$creating ? 'required' : 'sometimes', 'string', 'min:2', 'max:120'],
            // Lowercase-and-dashes only: it is the last segment of a public URL, and the learner
            // routes constrain {slug} to exactly this shape.
            'slug' => ['sometimes', 'nullable', 'string', 'max:80', 'regex:/^[a-z0-9]+(?:-[a-z0-9]+)*$/'],
            'description' => [...$optional, 'max:2000'],
            'submit_label' => [...$optional, 'max:60'],
            'success_message' => [...$optional, 'max:1000'],
            'ask_email' => ['sometimes', 'boolean'],
            'ask_course' => ['sometimes', 'boolean'],
            'ask_date' => ['sometimes', 'boolean'],
            'ask_message' => ['sometimes', 'boolean'],
            'choice_label' => [...$optional, 'max:80'],
            'choices' => ['sometimes', 'array', 'max:'.BookingForms::MAX_CHOICES],
            // Nullable: ConvertEmptyStringsToNull turns a blank row of the list editor into null,
            // and a normal edit must not 422 over it (BookingForms::choices drops it).
            'choices.*' => ['nullable', 'string', 'max:'.BookingForms::MAX_CHOICE_LENGTH],
            'show_in_nav' => ['sometimes', 'boolean'],
            'show_on_home' => ['sometimes', 'boolean'],
            'status' => ['sometimes', Rule::in(['ACTIVE', 'HIDDEN'])],
        ];
    }

    /**
     * Validated input → columns. Only keys that were sent, so a PATCH of one switch touches one
     * column; blank strings collapse to null ("use the template's default").
     *
     * @param  array<string,mixed>  $data
     * @return array<string,mixed>
     */
    private function columns(array $data): array
    {
        $out = [];
        foreach (['title', 'description', 'submit_label', 'success_message', 'choice_label'] as $key) {
            if (array_key_exists($key, $data)) {
                $value = $data[$key] === null ? null : trim((string) $data[$key]);
                $out[$key] = $value === '' ? null : $value;
            }
        }
        foreach (['ask_email', 'ask_course', 'ask_date', 'ask_message', 'show_in_nav', 'show_on_home'] as $key) {
            if (array_key_exists($key, $data)) {
                $out[$key] = (bool) $data[$key];
            }
        }
        if (array_key_exists('choices', $data)) {
            $out['choices'] = json_encode(BookingForms::choices($data['choices']), JSON_UNESCAPED_UNICODE);
        }
        if (array_key_exists('status', $data)) {
            $out['status'] = $data['status'];
        }

        return $out;
    }

    private function assertSlugFree(string $academyId, string $slug, ?string $ignoreId = null): string
    {
        $taken = DB::table('booking_forms')
            ->where('academy_id', $academyId)
            ->where('slug', $slug)
            ->when($ignoreId !== null, fn ($q) => $q->where('id', '!=', $ignoreId))
            ->exists();

        if ($taken) {
            throw ValidationException::withMessages(['slug' => 'Another form already uses this address.']);
        }

        return $slug;
    }

    private function findForm(string $id): object
    {
        $form = DB::table('booking_forms')->where('id', $id)->first();
        if ($form === null) {
            abort(404, 'Booking form not found.');
        }

        return $form;
    }

    /** The course site's base URL — append `/book/<slug>` for a form. Null until a handle is set. */
    private function publicSiteUrl(): ?string
    {
        $academyId = $this->currentAcademyId();
        $subdomain = DB::table('academies')->where('id', $academyId)->value('subdomain');

        return LmsSite::url(
            $subdomain === null ? null : (string) $subdomain,
            LmsSite::ownsRoot($academyId),
            CustomDomain::primaryOrigin($academyId, 'LMS'),
        );
    }

    /** @return array<string,mixed> */
    private function present(object $f, ?object $counts, ?string $siteUrl): array
    {
        return BookingForms::publicDto($f) + [
            'id' => (string) $f->id,
            'show_in_nav' => (bool) $f->show_in_nav,
            'show_on_home' => (bool) $f->show_on_home,
            'status' => (string) $f->status,
            'created_at' => $this->iso($f->created_at),
            'updated_at' => $this->iso($f->updated_at),
            'requests_total' => (int) ($counts->total ?? 0),
            'requests_new' => (int) ($counts->new ?? 0),
            'url' => $siteUrl === null ? null : rtrim($siteUrl, '/').'/book/'.$f->slug,
        ];
    }
}
