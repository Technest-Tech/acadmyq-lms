<?php

declare(strict_types=1);

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\CustomDomain;
use App\Support\LmsSite;
use App\Support\Tenancy;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * Super Admin → client → Domains (docs/custom-domains). THE one writer of `academy_domains`.
 *
 * Kept out of ClientController for the same reason ClientPaymentController is: that controller owns
 * the module/subscription engine, and this owns a different fact about a client — the addresses they
 * answer on. Same conventions though: Super-Admin-only, every write inside the target academy's
 * tenant context, every write audited.
 *
 * What this controller deliberately does NOT do is issue certificates. That needs root, and root is
 * the one thing a PHP-FPM pool must never have — `deploy/bin/acadmyq-issue-certs.sh` runs from a
 * root cron drop-in and is the only thing that moves a domain to LIVE. The panel's job is to get a
 * host to VERIFIED and then show the client an honest status while the cron does its work.
 *
 * The status a row reports is therefore the whole feature:
 *
 *   PENDING_DNS → the record is not pointing here yet (or is behind someone else's proxy)
 *   VERIFIED    → DNS is right; waiting for the certificate
 *   ISSUING     → certbot is running
 *   LIVE        → resolvable, and only now does `app.academy_by_host()` answer for it
 *   FAILED      → issuance failed; `last_error` says why
 */
final class ClientDomainController extends Controller
{
    /** GET /api/admin/clients/{id}/domains — the client's addresses + the DNS records to create. */
    public function index(string $id): JsonResponse
    {
        Gate::authorize('platform.manage');
        $this->assertAcademyExists($id);

        return response()->json($this->payload($id));
    }

    /**
     * POST /api/admin/clients/{id}/domains — claim a host for this client.
     *
     * The host is checked but NOT verified here: DNS propagation takes minutes to hours, so the row
     * is created PENDING_DNS and a first check is attempted immediately as a courtesy (a client who
     * set the record up beforehand sees VERIFIED straight away instead of wondering).
     */
    public function store(Request $request, string $id): JsonResponse
    {
        Gate::authorize('platform.manage');
        $this->assertAcademyExists($id);
        $this->assertEnabled();

        $data = $request->validate([
            'host' => CustomDomain::rules(),
            'kind' => ['required', Rule::in(CustomDomain::KINDS)],
        ]);

        $host = CustomDomain::normalize($data['host']);
        if ($host === null) {
            abort(422, 'Enter a hostname.');
        }

        // A custom domain resolves TO the platform handle — it does not replace it. Without one
        // there is nothing for `app.academy_by_host()` to answer with and nothing for the course
        // site's `/learn/<handle>` rewrite to name, so the host would resolve to a 404 forever.
        $handle = DB::table('academies')->where('id', $id)->value('subdomain');
        if ($handle === null || (string) $handle === '') {
            return response()->json([
                'message' => 'Give this client a subdomain handle first — a custom domain points at it, it does not replace it.',
                'errors' => ['host' => ['This client has no subdomain handle yet.']],
            ], 422);
        }

        $domainId = (string) Str::uuid();

        $this->inAcademyContext($id, function () use ($domainId, $id, $host, $data): void {
            DB::table('academy_domains')->insert([
                'id' => $domainId,
                'academy_id' => $id,
                'host' => $host,
                'kind' => $data['kind'],
                'status' => 'PENDING_DNS',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        });

        $this->audit($id, 'domain.added', $domainId, after: ['host' => $host, 'kind' => $data['kind']], before: []);

        // Courtesy first check — a no-op for the usual case where DNS is not set up yet.
        $this->runCheck($id, $domainId, $host);
        CustomDomain::forget($host);

        return response()->json($this->payload($id), 201);
    }

    /**
     * POST /api/admin/clients/{id}/domains/{domainId}/verify — re-run the DNS check now.
     *
     * The scheduler runs this for every waiting domain anyway (`domains:verify`); this exists so
     * that whoever is on the phone with the client can press a button instead of waiting for the
     * next tick.
     */
    public function verify(string $id, string $domainId): JsonResponse
    {
        Gate::authorize('platform.manage');
        $this->assertAcademyExists($id);
        $this->assertEnabled();

        $row = $this->find($id, $domainId);
        $this->runCheck($id, $domainId, (string) $row->host);
        CustomDomain::forget((string) $row->host);

        return response()->json($this->payload($id));
    }

    /**
     * POST /api/admin/clients/{id}/domains/{domainId}/primary — make this the canonical address.
     *
     * Canonical matters because links are BUILT from it: a password-reset email, a WhatsApp message,
     * a payment return URL. Exactly one per client per product, which the partial unique index
     * enforces — hence clearing the others first, in one transaction.
     */
    public function primary(string $id, string $domainId): JsonResponse
    {
        Gate::authorize('platform.manage');
        $this->assertAcademyExists($id);
        $this->assertEnabled();

        $row = $this->find($id, $domainId);
        if ((string) $row->status !== 'LIVE') {
            return response()->json([
                'message' => 'Only a live domain can be the canonical one — this one has no certificate yet.',
                'errors' => ['domain' => ['This domain is not live yet.']],
            ], 422);
        }

        $this->inAcademyContext($id, function () use ($id, $domainId, $row): void {
            DB::transaction(function () use ($id, $domainId, $row): void {
                DB::table('academy_domains')
                    ->where('academy_id', $id)->where('kind', $row->kind)->where('is_primary', true)
                    ->update(['is_primary' => false, 'updated_at' => now()]);

                DB::table('academy_domains')->where('id', $domainId)
                    ->update(['is_primary' => true, 'updated_at' => now()]);
            });
        });

        $this->audit($id, 'domain.primary_set', $domainId, after: ['host' => $row->host, 'kind' => $row->kind], before: []);
        CustomDomain::forget((string) $row->host);

        return response()->json($this->payload($id));
    }

    /**
     * DELETE /api/admin/clients/{id}/domains/{domainId} — stop answering on this address.
     *
     * The row is the only thing that makes a host resolve, so removing it is immediate and complete.
     * The issued certificate stays on disk: it is inert once nothing resolves, and reaping it is an
     * ops step (`certbot delete`) rather than something a web request should be doing as root.
     */
    public function destroy(string $id, string $domainId): JsonResponse
    {
        Gate::authorize('platform.manage');
        $this->assertAcademyExists($id);

        $row = $this->find($id, $domainId);

        $this->inAcademyContext($id, fn () => DB::table('academy_domains')->where('id', $domainId)->delete());

        $this->audit($id, 'domain.removed', $domainId, after: [], before: ['host' => $row->host, 'kind' => $row->kind]);
        CustomDomain::forget((string) $row->host);

        return response()->json($this->payload($id));
    }

    /**
     * Resolve the host and move the row forward. Never moves a LIVE domain backwards: once a
     * certificate exists the site works, and a transient resolver hiccup must not take it down.
     */
    private function runCheck(string $academyId, string $domainId, string $host): void
    {
        $check = CustomDomain::dnsCheck($host);

        $this->inAcademyContext($academyId, function () use ($domainId, $check): void {
            $row = DB::table('academy_domains')->where('id', $domainId)->first(['status']);
            if ($row === null || in_array((string) $row->status, ['LIVE', 'ISSUING'], true)) {
                DB::table('academy_domains')->where('id', $domainId)
                    ->update(['last_checked_at' => now(), 'updated_at' => now()]);

                return;
            }

            DB::table('academy_domains')->where('id', $domainId)->update([
                'status' => $check['ok'] ? 'VERIFIED' : 'PENDING_DNS',
                'verified_at' => $check['ok'] ? now() : null,
                'last_error' => $check['error'],
                'last_checked_at' => now(),
                'updated_at' => now(),
            ]);
        });
    }

    /** @return array<string,mixed> */
    private function payload(string $id): array
    {
        $handle = DB::table('academies')->where('id', $id)->value('subdomain');

        $rows = $this->inAcademyContext($id, fn () => DB::table('academy_domains')
            ->where('academy_id', $id)
            ->orderBy('kind')->orderByDesc('is_primary')->orderBy('created_at')
            ->get(['id', 'host', 'kind', 'status', 'is_primary', 'last_error', 'last_checked_at', 'verified_at', 'issued_at']));

        return [
            'enabled' => CustomDomain::enabled(),
            'instructions' => CustomDomain::instructions(),
            // What these addresses point AT — shown next to them so the relationship is visible
            // rather than folklore.
            'subdomain' => $handle !== null ? (string) $handle : null,
            'domains' => $rows->map(fn (object $r) => [
                ...(array) $r,
                'is_primary' => (bool) $r->is_primary,
                'url' => LmsSite::scheme().'://'.$r->host,
            ])->all(),
        ];
    }

    private function find(string $id, string $domainId): object
    {
        $row = $this->inAcademyContext($id, fn () => DB::table('academy_domains')
            ->where('id', $domainId)->where('academy_id', $id)->first());

        if ($row === null) {
            abort(404, 'Domain not found.');
        }

        return $row;
    }

    /**
     * Refuse writes while the feature is off. A row created now would be invisible to the resolver
     * and would never reach a cert script that is not installed — i.e. a client promised an address
     * that silently cannot work.
     */
    private function assertEnabled(): void
    {
        if (! CustomDomain::enabled()) {
            abort(422, 'Custom domains are not enabled on this server (CUSTOM_DOMAINS_ENABLED).');
        }
    }

    private function assertAcademyExists(string $id): void
    {
        if (DB::table('academies')->where('id', $id)->doesntExist()) {
            abort(404, 'Academy not found.');
        }
    }

    /** @param array<string,mixed> $after @param array<string,mixed> $before */
    private function audit(string $academyId, string $action, ?string $entityId, array $after, array $before): void
    {
        $ctx = app(AuthContext::class);
        $this->inAcademyContext($academyId, fn () => Audit::log(
            $action, 'academy_domain', $entityId, $academyId, $ctx->userId, 'SUPER_ADMIN',
            after: $after, before: $before,
        ));
    }

    /** Run $fn in the target academy's context as SUPER_ADMIN (mirrors ClientController). */
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
}
