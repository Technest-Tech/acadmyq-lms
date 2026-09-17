# Custom domains — a client on an address they own

A client answers on `portal.theirschool.com` as well as on their platform handle
`theirschool.acadmyq.com`. The handle never goes away: a custom domain **resolves to it**, and is
never a replacement for it.

Costs nothing to run. Certificates are Let's Encrypt, issued and renewed by certbot on our own box.

---

## 1. The one idea

`<handle>.<root>` **spells** its handle, so the router reads it off the host. A custom domain spells
nothing — it is just a name someone pointed at our IP — so it is **looked up**, and the lookup
answers with the handle that host belongs to.

That is the entire architectural difference. Past the two resolvers, nothing downstream can tell the
two kinds of address apart: both carry on as `X-Academy: <handle>`, through the same RLS bridge, into
the same `/learn/<handle>` rewrite.

```
noor.acadmyq.com  ──parse──┐
                           ├──▶  handle "noor"  ──▶  everything else, unchanged
portal.noor.edu   ──look up┘
```

Consequence, and it is a hard requirement: **a client must have a subdomain handle before they can
have a custom domain.** Adding one without a handle is refused with that sentence.

## 2. Which product answers

A client's address serves one of two things at `/` — their management sign-in, or their course site.

| Address | What decides |
|---|---|
| `<handle>.acadmyq.com` | the client's PLAN (`LmsSite::ownsRoot` — a course-platform client's site owns `/`) |
| a domain they bought | `academy_domains.kind`, because they bought that address for a purpose |

So one school can run its panel on `portal.school.com` and its course site on `courses.school.com`:
two hosts, two answers, one academy. `GET /api/site` returns whichever applies, and the router and
the links are built from that one answer.

## 3. Data

```sql
academy_domains (
  id, academy_id, host unique, kind,        -- MANAGEMENT | LMS
  status,                                   -- PENDING_DNS | VERIFIED | ISSUING | LIVE | FAILED
  is_primary, last_error, last_checked_at, verified_at, issued_at, …
)
```

Ordinary `tenant_isolation` RLS, like every other `academy_id`-bearing table. Authorisation is the
Gate's job (`platform.manage`), not the policy's — the admin controller enters the target academy's
context for every write. Three SECURITY DEFINER hatches cover what has no tenant context:
`app.academy_by_host()` (resolution, **LIVE only**), `app.live_custom_domains()` (the CORS /
stateful lists), `app.custom_domain_taken()` (uniqueness during validation),
`app.custom_domains_waiting()` (the sweep).

`academy_id` means `app.purge_academy()` discovers the table on its own — a hard-deleted client takes
its domains with it. Certificate files on disk are not reaped; `certbot delete` is an ops step.

## 4. The status machine

Nothing is live because a row exists. A row becomes an address in two steps, each owned by a
different process — and the split is deliberate: **PHP never needs root.**

| Status | Meaning | Who moves it |
|---|---|---|
| `PENDING_DNS` | the record does not point here yet | — |
| `VERIFIED` | DNS is right; waiting for a certificate | `domains:verify` (scheduled, every 10 min) |
| `ISSUING` | certbot is running | the cert cron |
| `LIVE` | the address works, and only now does it resolve | the cert cron |
| `FAILED` | issuance failed; `last_error` says why | the cert cron |

`domains:verify` never walks a LIVE domain backwards — a resolver blip must not take a working client
site down — and retries a FAILED one only once an hour, because Let's Encrypt allows five failed
validations per hostname per hour and an eager retry spends exactly the budget the client is waiting
on.

**Verification is the DNS check itself.** There is no TXT token: "does this host resolve to our
origin IP" cannot be satisfied without control of the domain's DNS, which is what a token proves, one
step shorter — and it is a precondition for the ACME challenge anyway.

## 5. Free TLS, without a vhost per client

nginx 1.15.9+ accepts **variables in `ssl_certificate`**, so the catch-all vhost picks a certificate
by SNI out of a flat directory:

```nginx
ssl_certificate /etc/nginx/certs/$acadmyq_cert_dir/fullchain.pem;
```

Adding a domain is therefore **two symlinks and no reload**. That is the whole reason this costs
nothing to operate — no generated vhost files, no config templating, no `nginx -s reload` in the
request path.

Two tradeoffs, both accepted:

- nginx cannot cache a certificate it resolves through a variable, so it reads the file on every
  handshake — and, crucially, **a worker does the reading, not the master**. Workers run as
  `www-data`, while certbot keeps `/etc/letsencrypt/archive` at `0700 root:root`. So certificates
  are **copied** into `/etc/nginx/certs/<host>/` (key `0640 root:www-data`) by the deploy hook, on
  issuance and on every renewal. Symlinking into certbot's tree does not work, and loosening that
  tree would expose the platform wildcard's key to the web server. This was found the hard way:
  every handshake failed with `BIO_new_file() failed … Permission denied`.
- `_fallback` is a **self-signed** certificate, answering for a client that sends no SNI and for a
  host whose own certificate has not been issued yet — both of which are getting a browser warning
  regardless, which is why it is not worth pointing at the real wildcard.

**A host that is in no `academy_domains` row refuses the TLS handshake outright** (no per-host
directory exists, and a `map` cannot test for one). That is deliberate: we have no business
presenting a certificate for a domain we do not serve. The consequence to know is the ORDER of
operations — add the client's domain in the panel *before* telling them to point DNS, or their first
visit is a hard TLS error rather than a warning page. Once the row exists the cert cron gives that
host the fallback within five minutes.

## 6. The session problem, and why the API moves

`portal.theirschool.com` and `api.acadmyq.com` share no registrable parent. A session cookie set by
the second is a **third-party cookie** on the first — dropped outright by Safari, on borrowed time
everywhere else. Cookie auth simply cannot work across them.

So on a custom domain the API is served from the client's **own origin**: nginx routes `/api` and
`/sanctum` on the catch-all vhost straight to PHP-FPM, `lib/api-base` returns `window.location.origin`
in the browser there, and every call is same-origin again.

Three settings then have to follow the host, which `AppServiceProvider::bootCustomDomainOrigin()`
re-decides per request (providers boot before any middleware, so nothing has started yet):

| Setting | Configured for | On a custom domain |
|---|---|---|
| `session.domain` | `.acadmyq.com` | **null** — or the browser discards the cookie and sign-in silently never completes |
| `sanctum.stateful` | `*.acadmyq.com` | + this host, or no session is started at all |
| `cors.allowed_origins` | the roots | + this origin |

**One session per origin.** Signed in on `app.acadmyq.com` is *not* signed in on
`portal.theirschool.com`. That is correct, and worth telling clients.

## 7. The security detail that is easy to miss

`LmsSite::handleFromHost()` is what binds a sign-in to the client whose door it came through. Without
the custom-domain lookup in it, a login on a client's own domain falls through to the **platform
login**, where a user of any academy can sign in on that client's branded page. It is covered by a
test that says so.

## 8. What a client actually does

One record, and it must be **DNS-only**:

| Type | Name | Value |
|---|---|---|
| A | `portal` | `169.58.59.194` |
| *or* CNAME | `portal` | `connect.acadmyq.com` |

`connect.acadmyq.com` is itself a grey-cloud A record — the same trick as `media`/`turn`, which
override the proxied wildcard. If the client's record is **proxied** (Cloudflare's orange cloud, or
any CDN), the ACME challenge never reaches us, no certificate is issued, and the address does not
work. It is the single most common failure, so the panel says it before it happens.

Custom domains therefore **bypass Cloudflare**: no CDN, no DDoS shielding, no caching, and the origin
IP becomes public. Fine for a staff panel; worth revisiting if a course site ever serves real volume.

## 9. Switches

Off by default, on both sides, and they must agree:

- API — `CUSTOM_DOMAINS_ENABLED`, plus `CUSTOM_DOMAINS_ORIGIN_IP` and `CUSTOM_DOMAINS_CNAME_TARGET`
- Web — `NEXT_PUBLIC_CUSTOM_DOMAINS=1` (inlined at **build** time)

With it off, a host under no configured root is not a client address and the router passes it through
exactly as it did before this feature existed.

**Do not turn it on before the nginx vhost and the cert cron are installed** — a domain marked live
with nowhere to terminate TLS is a client promised an address that cannot work. Install steps are in
`DEPLOYMENT.md §Custom domains`.

## 10. Where the code is

| Concern | File |
|---|---|
| Resolution, validation, DNS check, origins | `apps/api/app/Support/CustomDomain.php` |
| Handle from a host (incl. the sign-in binding) | `apps/api/app/Support/LmsSite.php` |
| Host → tenant context | `apps/api/app/Http/Middleware/ResolveAcademyContext.php` |
| Which product answers | `apps/api/app/Http/Controllers/Public/TenantSiteController.php` |
| Per-request session / stateful / CORS | `apps/api/app/Providers/AppServiceProvider.php` |
| Provisioning API | `apps/api/app/Http/Controllers/Admin/ClientDomainController.php` |
| The DNS sweep | `apps/api/app/Console/Commands/VerifyCustomDomains.php` |
| Routing | `apps/web/src/middleware.ts`, `apps/web/src/lib/root-domains.ts` |
| Lookup + cache | `apps/web/src/lib/tenant-site.ts` |
| Same-origin API | `apps/web/src/lib/api-base.ts` |
| Panel | `apps/web/src/components/clients/client-domains-card.tsx` |
| nginx / certs / cron | `deploy/nginx/custom-domains.conf`, `deploy/bin/*`, `deploy/cron/acadmyq-certs` |
| Tests | `apps/api/tests/Feature/Lms/CustomDomainsTest.php`, `apps/web/src/middleware.test.ts` |
