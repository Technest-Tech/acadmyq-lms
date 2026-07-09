# WhatsApp Service — External API

The WhatsApp Service can be consumed by an academy's own systems over a small HTTP API: send text and
image messages, check whether a number is on WhatsApp, and read the connection status. Access is
granted per academy by a Super Admin, who issues API keys and (optionally) a public link the academy
uses to connect its own phone.

This document is the reference for the people integrating against the API.

---

## Concepts

- **Client = academy.** An API key belongs to one academy. Everything the key does is scoped to that
  academy's WhatsApp connection; a key can never act for another academy.
- **Connecting a phone.** Before messages can be delivered, the academy must link a WhatsApp number.
  Either the Super Admin does this from the admin panel, or they share a **public connect link**
  (`/wa-connect/{token}`) that the academy opens and scans from their phone — no login required. The
  link expires and can be regenerated.
- **Two independent secrets.** The **API key** authenticates API calls (this document). The gateway
  session token is internal and never exposed to clients.

---

## Authentication

Send your API key as a Bearer token on every request:

```
Authorization: Bearer wa_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

Keys are created in the Super Admin panel (WhatsApp → API Clients → a client → **Manage access**).
The full key is shown **once** at creation — store it securely. Keys can be revoked at any time.

Requests fail with `401` if the key is missing/invalid/revoked, and `403` if the academy is suspended
or its plan does not include WhatsApp automation.

Base URL (production): `https://api.acadmyq.com`

Rate limit: **120 requests/minute per key** (plus a coarse per-IP limit). Exceeding it returns `429`.

---

## Endpoints

All paths are under `/api/wa/v1`.

### `POST /messages` — send a message

Send **either** a text message **or** an image (by URL). `to` is a phone number in international
format (digits, with or without `+`).

Text:

```http
POST /api/wa/v1/messages
Authorization: Bearer wa_…
Content-Type: application/json

{ "to": "201234567890", "text": "Your invoice is ready." }
```

Image (public https URL, optional caption):

```http
POST /api/wa/v1/messages
Authorization: Bearer wa_…
Content-Type: application/json

{ "to": "201234567890", "image_url": "https://cdn.example.com/promo.jpg", "caption": "New term starts Sunday!" }
```

Provide exactly one of `text` or `image_url`. `image_url` must be a public `https://` URL — the
service fetches it, and rejects private/internal addresses.

**Idempotency (optional).** Send an `Idempotency-Key` header to make retries safe: a repeated request
with the same key for the same academy is not sent again.

```
Idempotency-Key: order-4831-confirmation
```

Responses:

| Status | Body | Meaning |
| --- | --- | --- |
| `202` | `{ "status": "accepted", "message_id": "…" }` | Queued for delivery (sends are paced/anti-ban). |
| `200` | `{ "status": "duplicate", "message_id": null }` | Same `Idempotency-Key` already handled. |
| `409` | `{ "error": "not_connected" }` | The academy has no connected WhatsApp session. |
| `422` | `{ "error": "…", "message": "…" }` | Validation error (bad body / unsafe image URL). |
| `502` | `{ "error": "send_failed", "message": "…" }` | The gateway rejected the send. |

> Delivery is asynchronous and paced to avoid bans, so `202` means *accepted for delivery*, not
> *delivered*.

### `GET /contacts/{phone}` — is a number on WhatsApp?

```http
GET /api/wa/v1/contacts/201234567890
Authorization: Bearer wa_…
```

```json
{ "phone": "201234567890", "exists": true }
```

Returns `409 not_connected` if the academy has no active session.

### `GET /status` — connection status

```http
GET /api/wa/v1/status
Authorization: Bearer wa_…
```

```json
{ "status": "CONNECTED", "connected": true }
```

`status` is one of `CONNECTED`, `DISCONNECTED`, `UNKNOWN`.

---

## Public connect link

The Super Admin generates a link like `https://app.acadmyq.com/wa-connect/{token}` and shares it with
the academy. Opening it starts a session and shows a QR the academy scans from **WhatsApp → Linked
devices → Link a device**. The page polls until the phone links. The link expires (48h) and
regenerating it invalidates the previous one.

---

## Errors

Errors are JSON: `{ "error": "<machine_code>", "message": "<human text>" }`. Common codes:

| Code | Status |
| --- | --- |
| `missing_api_key` / `invalid_api_key` | 401 |
| `account_suspended` / `not_entitled` | 403 |
| `not_connected` | 409 |
| `invalid_phone` / validation | 422 |
| `send_failed` / `gateway_unavailable` | 502 |

---

## Implementation notes (internal)

- API-key auth + tenant bridge: `App\Http\Middleware\AuthenticateWhatsAppApiKey` (alias `wa.apikey`),
  keyed by `whatsapp_api_keys.key_hash` via the BYPASSRLS reader `app.wa_api_key_lookup`.
- Endpoints: `App\Http\Controllers\Api\WhatsAppApiController`; routes under `/api/wa/v1`
  (`routes/api.php`), rate limiter `wa-api` in `AppServiceProvider`.
- Delivery reuses the shared `App\Services\Whatsapp\WhatsAppSender` seam → `WasenderClient` → gateway
  `POST /api/send-message` (text or `imageUrl`+`caption`). Everything is logged to
  `automation_send_log` (`automation_type = API`).
- Public connect: `App\Http\Controllers\Public\WhatsAppConnectController`, token resolved by
  `app.wa_connect_academy_by_token`; web page at `apps/web/src/app/wa-connect/[token]`.
- Admin management: `AcademyAutomationController::listApiKeys/createApiKey/revokeApiKey/createConnectLink`.
- Image support in the gateway: `apps/wa-gateway/src/routes/send.ts` (+ SSRF guard
  `src/util/url-guard.ts`), `src/queue/send-queue.ts`.
