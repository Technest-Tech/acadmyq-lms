<?php

declare(strict_types=1);

use App\Http\Controllers\AcademyProfileController;
use App\Http\Controllers\AcademyRoleController;
use App\Http\Controllers\Admin\AcademyAutomationController;
use App\Http\Controllers\Admin\AcademyController;
use App\Http\Controllers\Admin\AcademyLogoController;
use App\Http\Controllers\Admin\AcademySubscriptionController;
use App\Http\Controllers\Admin\BillingController;
use App\Http\Controllers\Admin\ClientController;
use App\Http\Controllers\Admin\ClientPaymentController;
use App\Http\Controllers\Admin\DashboardController;
use App\Http\Controllers\Admin\DemoRequestController as AdminDemoRequestController;
use App\Http\Controllers\Admin\Finance\ClientController as FinanceClientController;
use App\Http\Controllers\Admin\Finance\DealController as FinanceDealController;
use App\Http\Controllers\Admin\Finance\OverviewController as FinanceOverviewController;
use App\Http\Controllers\Admin\Finance\PaymentController as FinancePaymentController;
use App\Http\Controllers\Admin\LmsOversightController;
use App\Http\Controllers\Admin\PlanController;
use App\Http\Controllers\Admin\RoleController;
use App\Http\Controllers\Admin\SettingsController;
use App\Http\Controllers\Admin\UserController;
use App\Http\Controllers\Admin\VideoOversightController;
use App\Http\Controllers\Api\WhatsAppApiController;
use App\Http\Controllers\AuditController;
use App\Http\Controllers\Auth\AuthController;
use App\Http\Controllers\CertificateTemplateController;
use App\Http\Controllers\Crm\LeadController;
use App\Http\Controllers\EntitlementController;
use App\Http\Controllers\ExchangeRateController;
use App\Http\Controllers\InvoiceController;
use App\Http\Controllers\Learner\AuthController as LearnerAuthController;
use App\Http\Controllers\Learner\CatalogController as LearnerCatalogController;
use App\Http\Controllers\Learner\CheckoutController as LearnerCheckoutController;
use App\Http\Controllers\Learner\NotificationController as LearnerNotificationController;
use App\Http\Controllers\Learner\PasswordResetController as LearnerPasswordResetController;
use App\Http\Controllers\Learner\PlayerController as LearnerPlayerController;
use App\Http\Controllers\Learner\ProductController as LearnerProductController;
use App\Http\Controllers\Learner\QuizController as LearnerQuizController;
use App\Http\Controllers\Learner\RedemptionController as LearnerRedemptionController;
use App\Http\Controllers\Learner\SiteController as LearnerSiteController;
use App\Http\Controllers\LessonPackageController;
use App\Http\Controllers\Lms\CodeController;
use App\Http\Controllers\Lms\CourseController;
use App\Http\Controllers\Lms\DashboardController as LmsDashboardController;
use App\Http\Controllers\Lms\LearnerAdminController;
use App\Http\Controllers\Lms\LessonController;
use App\Http\Controllers\Lms\MediaController;
use App\Http\Controllers\Lms\MediaDeliveryController;
use App\Http\Controllers\Lms\OrderController as LmsOrderController;
use App\Http\Controllers\Lms\PaymentMethodController as LmsPaymentMethodController;
use App\Http\Controllers\Lms\ProductController as LmsProductController;
use App\Http\Controllers\Lms\QuizController;
use App\Http\Controllers\Lms\SectionController;
use App\Http\Controllers\Lms\SiteProfileController as LmsSiteProfileController;
use App\Http\Controllers\NotificationController;
use App\Http\Controllers\PaymentSettingsController;
use App\Http\Controllers\PayoutController;
use App\Http\Controllers\PaypalOrderController;
use App\Http\Controllers\People\GuardianController;
use App\Http\Controllers\People\StaffController;
use App\Http\Controllers\People\StudentController;
use App\Http\Controllers\People\TeacherController;
use App\Http\Controllers\Public\AcademyPaymentController;
use App\Http\Controllers\Public\BrandAssetController;
use App\Http\Controllers\Public\DemoRequestController as PublicDemoRequestController;
use App\Http\Controllers\Public\TenantSiteController;
use App\Http\Controllers\Public\WhatsAppConnectController;
use App\Http\Controllers\Quality\QualityReportController;
use App\Http\Controllers\Quality\QualityRubricController;
use App\Http\Controllers\Quality\TeacherAdjustmentController;
use App\Http\Controllers\ReportCardTemplateController;
use App\Http\Controllers\ReportFieldController;
use App\Http\Controllers\Scheduling\AttendanceController;
use App\Http\Controllers\Scheduling\CalendarController;
use App\Http\Controllers\Scheduling\CancellationRequestController;
use App\Http\Controllers\Scheduling\GenerateSessionsController;
use App\Http\Controllers\Scheduling\ScheduleController;
use App\Http\Controllers\Scheduling\SessionController;
use App\Http\Controllers\SessionReportController;
use App\Http\Controllers\SpecializationController;
use App\Http\Controllers\StaffDepartmentController;
use App\Http\Controllers\StudentProgressReportController;
use App\Http\Controllers\TeacherReportController;
use App\Http\Controllers\Trials\TrialController;
use App\Http\Controllers\Video\LivekitWebhookController;
use App\Http\Controllers\Video\VideoJoinController;
use App\Http\Controllers\Video\VideoModerationController;
use App\Http\Controllers\Video\VideoRecordingController;
use App\Http\Controllers\Video\VideoRoomController;
use App\Http\Controllers\WhatsAppWebhookController;
use App\Http\Controllers\XpayCheckoutController;
use App\Http\Controllers\XpayWebhookController;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;

/*
| Public health check (Master Spec / Sprint 0 §5). No auth.
| Returns 200 with a degraded payload (db: "error") rather than crashing
| when the database is unreachable — TC-0.9 / TC-0.10 / TC-0.11.
*/
Route::get('/health', function (): JsonResponse {
    $db = 'ok';

    try {
        DB::select('select 1');
    } catch (Throwable) {
        $db = 'error';
    }

    // Is the scheduler alive, and is it doing its job? Two ages, no tenant data. The cron that
    // drives every recurring job was missing from the production box for two months and nothing
    // noticed, because nothing anywhere reported on it. `scheduler_age_seconds` goes stale within
    // minutes of cron dying; `last_roll_age_hours` goes stale if cron lives but the daily session
    // roll-forward is failing — the pair that would have caught this in a day instead of a
    // quarter. Both null until the first run after deploy.
    $scheduler = ['age_seconds' => null, 'last_roll_age_hours' => null];
    try {
        $beat = Cache::get('scheduler.heartbeat_at');
        $roll = Cache::get('scheduler.last_roll_at');
        $scheduler['age_seconds'] = $beat !== null ? now()->diffInSeconds(Carbon::parse($beat), true) : null;
        $scheduler['last_roll_age_hours'] = $roll !== null ? now()->diffInHours(Carbon::parse($roll), true) : null;
    } catch (Throwable) {
        // A health check never fails on its own instrumentation.
    }

    return response()->json([
        'app' => 'ok',
        'db' => $db,
        'scheduler' => $scheduler,
        'version' => config('app.version'),
        'time' => now()->utc()->toIso8601String(),
    ]);
});

/*
| Public auth entry point. Login runs OUTSIDE the tenant context (the user is not yet
| known); the RlsBypassUserProvider performs the credential lookup under RLS. The SPA
| primes the CSRF cookie via GET /sanctum/csrf-cookie (registered by Sanctum) first.
*/
Route::post('/auth/login', [AuthController::class, 'login']);

/*
| Public invoice view (Sprint 7 §6). Token-authenticated — no Sanctum session required.
| Rate-limited to 60 req/min per IP to prevent enumeration of invoice tokens.
| Registered BEFORE the authenticated group to avoid the auth:sanctum middleware.
*/
Route::middleware(['throttle:60,1'])->group(function () {
    Route::get('/i/{token}', [InvoiceController::class, 'publicShow']);

    // Public video join-by-link (docs/video-platform/06 + 08-ROOM-ACCESS §2/§3). Role-separated
    // links: a guest/host/monitor token (/r/{token}) OR a readable per-academy slug
    // (/r/{academy}/{room}). NOT Sanctum-gated; the room + link role are resolved via SECURITY
    // DEFINER readers, and an authenticated host is still detected in the controller.
    // The token is now an auto-generated SHORT link (`{kebab-name}-{code}`, 08-ROOM-ACCESS §14), so the
    // pattern allows the `-` separator; legacy [A-Za-z0-9] tokens still match.
    Route::post('/video/join/{token}', [VideoJoinController::class, 'join'])->where('token', '[A-Za-z0-9][A-Za-z0-9-]*');
    Route::post('/video/join-slug/{academy}/{room}', [VideoJoinController::class, 'joinBySlug'])
        ->where('academy', '[a-z0-9][a-z0-9-]*')
        ->where('room', '[a-z0-9][a-z0-9-]*');

    // Waiting room (08-ROOM-ACCESS §13). The waiting guest short-polls knockStatus(); a host runs the
    // queue via the manage credential (= the room's host_token), so the no-login host link works too.
    // The `manageToken` is the room's host_token — now a SHORT link (`{kebab-name}-{code}`, §14), so its
    // pattern must allow the `-` like /video/join above; legacy [A-Za-z0-9] host_tokens still match. The
    // `knockToken` is a separate bearer secret (generateSecret(), strictly [A-Za-z0-9]) — no `-`.
    Route::post('/video/knock/{knockToken}', [VideoJoinController::class, 'knockStatus'])
        ->where('knockToken', '[A-Za-z0-9]+');
    Route::get('/video/manage/{manageToken}/knocks', [VideoJoinController::class, 'listKnocks'])
        ->where('manageToken', '[A-Za-z0-9][A-Za-z0-9-]*');
    Route::post('/video/manage/{manageToken}/knocks/{knockId}', [VideoJoinController::class, 'decideKnock'])
        ->where('manageToken', '[A-Za-z0-9][A-Za-z0-9-]*')
        ->where('knockId', '[0-9a-fA-F-]{36}');

    // No-login host actions (08-ROOM-ACCESS §13.5): moderation + recording driven by the manage
    // credential (= the room's host_token), so an unregistered teacher controls the class from the
    // host link alone — no account, no login. Possession of the secret IS the authority.
    Route::post('/video/manage/{manageToken}/participants/{identity}/mute', [VideoModerationController::class, 'muteByManage'])
        ->where('manageToken', '[A-Za-z0-9][A-Za-z0-9-]*');
    Route::post('/video/manage/{manageToken}/participants/{identity}/mute-video', [VideoModerationController::class, 'muteVideoByManage'])
        ->where('manageToken', '[A-Za-z0-9][A-Za-z0-9-]*');
    Route::post('/video/manage/{manageToken}/participants/{identity}/remove', [VideoModerationController::class, 'removeByManage'])
        ->where('manageToken', '[A-Za-z0-9][A-Za-z0-9-]*');
    Route::post('/video/manage/{manageToken}/end', [VideoModerationController::class, 'endByManage'])
        ->where('manageToken', '[A-Za-z0-9][A-Za-z0-9-]*');
    Route::post('/video/manage/{manageToken}/recording', [VideoRecordingController::class, 'startByManage'])
        ->where('manageToken', '[A-Za-z0-9][A-Za-z0-9-]*');
    Route::delete('/video/manage/{manageToken}/recording', [VideoRecordingController::class, 'stopByManage'])
        ->where('manageToken', '[A-Za-z0-9][A-Za-z0-9-]*');

    // PayPal Checkout (public, token-authenticated). The token identifies the invoice;
    // credentials are fetched server-side via app.paypal_config_by_token (SECURITY DEFINER).
    // Rate-limited at the same 60 req/min tier as the invoice view to prevent abuse.
    Route::post('/i/{token}/paypal/create-order', [PaypalOrderController::class, 'createOrder']);
    Route::post('/i/{token}/paypal/capture/{orderId}', [PaypalOrderController::class, 'captureOrder']);

    // XPay hosted checkout (public, token-authenticated). `session` opens the hosted page the payer
    // is redirected to; `session/{id}` is the return page's confirmation fallback for a client whose
    // webhook endpoint is missing or slow — the webhook at /webhooks/xpay/{academy} remains the
    // source of truth, and both paths settle through the same XpayFulfillment rule.
    Route::post('/i/{token}/xpay/session', [XpayCheckoutController::class, 'createSession']);
    Route::get('/i/{token}/xpay/session/{id}', [XpayCheckoutController::class, 'syncSession'])
        ->where('id', '[A-Za-z0-9_]+');

    // Public academy pay page (Platform↔Academy billing). An academy views its bill + the platform's
    // InstaPay/Vodafone Cash details and uploads a transfer screenshot. Token-authenticated, no
    // Sanctum; `/a/` prefix avoids clashing with the student `/i/` invoice page.
    Route::get('/a/{token}', [AcademyPaymentController::class, 'show']);
    Route::post('/a/{token}/submit', [AcademyPaymentController::class, 'submit']);

    // Public "connect your WhatsApp" page (docs/whatsapp-api). The Super Admin generates a link for
    // an academy and hands it to the client; the client opens /wa-connect/{token} (no login), starts a
    // gateway session, and scans the QR. The token → academy resolution is a SECURITY DEFINER reader.
    Route::post('/wa/connect/{token}/start', [WhatsAppConnectController::class, 'start'])->where('token', '[A-Za-z0-9_-]+');
    Route::get('/wa/connect/{token}/qr', [WhatsAppConnectController::class, 'qr'])->where('token', '[A-Za-z0-9_-]+');
    Route::get('/wa/connect/{token}/status', [WhatsAppConnectController::class, 'status'])->where('token', '[A-Za-z0-9_-]+');
});

/*
| Marketing-site demo requests (the public site's one conversion action). Anonymous by definition —
| the person filling the form has no account — so it sits outside Sanctum with the other token-less
| public endpoints, and writes through the one `demo_requests` RLS policy that is not super-admin.
|
| Its own tight named limiter ON TOP of the 60/min group: 6 an hour per IP. A prospect fills this in
| once, so a ceiling that low costs a real visitor nothing and makes the endpoint useless as a spam
| target. The controller adds a honeypot; between them there is no captcha to fail on a slow phone.
*/
Route::middleware(['throttle:60,1', 'throttle:demo-requests'])
    ->post('/public/demo-requests', [PublicDemoRequestController::class, 'store']);

/*
| A client's uploaded logo (Super Admin → client page). PUBLIC because every surface that paints it —
| the branded sign-in, the subdomain front door, the learner site — is seen before anyone logs in.
| Its own, looser throttle rather than the 60/min public group: this is an <img> on pages a whole
| office may open at once, and it must never compete with the pay/invoice pages for that budget. The
| filename is a per-upload UUID, so the response is immutable and a replaced logo is a NEW url.
*/
Route::middleware(['throttle:300,1'])->group(function () {
    Route::get('/brand/{academy}/logo/{file}', [BrandAssetController::class, 'logo'])
        ->whereUuid('academy')->where('file', '[A-Za-z0-9._-]+');
});

/*
| External WhatsApp API (docs/whatsapp-api). Per-academy API-key auth (Authorization: Bearer <key>),
| resolved to a tenant context by `wa.apikey` — NOT Sanctum. Registered BEFORE the authenticated group
| so it never picks up the session/CSRF stack. A coarse per-IP throttle blunts invalid-key floods; the
| inner `wa-api` limiter is keyed per resolved API key (AppServiceProvider).
*/
Route::middleware(['throttle:120,1', 'wa.apikey', 'throttle:wa-api'])->prefix('wa/v1')->group(function () {
    Route::post('/messages', [WhatsAppApiController::class, 'send']);
    Route::get('/contacts/{phone}', [WhatsAppApiController::class, 'checkNumber'])->where('phone', '[0-9+ ]+');
    Route::get('/status', [WhatsAppApiController::class, 'status']);
});

/*
| Internal webhook from the self-hosted WhatsApp gateway (apps/wa-gateway). NOT a Sanctum route —
| the gateway authenticates with an HMAC signature verified by the `wa.webhook` middleware. Carries
| connection/QR/message events; the controller maps each to its academy via the signed payload.
*/
Route::post('/internal/wa/webhook', [WhatsAppWebhookController::class, 'handle'])->middleware('wa.webhook');

/*
| Internal webhook from the self-hosted LiveKit server (docs/video-platform). NOT a Sanctum route —
| LiveKit signs each webhook with a JWT (verified by the `livekit.webhook` middleware) whose sha256
| claim must match the body. Carries egress/participant/room events; the controller resolves the
| academy from the room-name suffix and writes inside Tenancy::withContext.
*/
Route::post('/internal/livekit/webhook', [LivekitWebhookController::class, 'handle'])->middleware('livekit.webhook');

/*
| Inbound webhook from XPay (docs.xpay.app) — how a card payment on a student invoice becomes a PAID
| invoice. NOT a Sanctum route: the `xpay.webhook` middleware verifies XPay's HMAC-SHA256 signature
| over the raw body within a 5-minute replay window.
|
| The URL is PER ACADEMY because the signing secret is: every client has its own XPay merchant
| account and its own `whsec_*`. The academy id here only selects which secret to verify against —
| it is an identifier, not a credential, and the signature is the sole authority. Throttled well
| above the WhatsApp tier since all of a client's deliveries arrive from XPay's shared egress.
*/
Route::post('/webhooks/xpay/{academy}', [XpayWebhookController::class, 'handle'])
    ->middleware(['throttle:300,1', 'xpay.webhook'])
    ->where('academy', '[0-9a-fA-F-]{36}');

/*
| Which product answers on a client's subdomain (docs/lms/02 §"one address space, two products").
| `<handle>.<root>` serves the course site for a course-platform client and the management system's
| branded sign-in for everyone else; the web middleware asks this before it routes, and the sign-in
| page asks it again for the client's name + logo. Same `resolve.academy` bridge as the learner site
| below — the handle IS the tenant, and an unknown handle 404s.
*/
Route::middleware(['throttle:120,1', 'resolve.academy'])->get('/site', [TenantSiteController::class, 'show']);

/*
| LMS public course site (docs/lms). NOT Sanctum-gated: the tenant is resolved from the SUBDOMAIN
| (the web layer forwards it as the `X-Academy` header) by `resolve.academy`, which sets the RLS
| context for the whole request. Learners authenticate with a Sanctum BEARER token on the `learner`
| guard; `learner.auth` asserts the token belongs to an ACTIVE learner of this academy. The public
| leg (register/login/catalog) needs only the academy; the protected leg (me/redeem/player/progress)
| additionally needs the learner. `{slug}` is constrained so it never captures a literal path segment.
*/
Route::middleware(['throttle:120,1', 'resolve.academy'])->prefix('learn')->group(function () {
    Route::post('/auth/register', [LearnerAuthController::class, 'register']);
    Route::post('/auth/login', [LearnerAuthController::class, 'login']);
    // Password reset (docs/lms/10 §2). Deliberately NOT learner.auth — someone who cannot sign in is
    // exactly who needs it. `forgot-password` always answers 202, so the site cannot be used to test
    // whether an address is a customer; the token is delivered over the academy's own WhatsApp
    // session (mail is the fallback), and only its sha256 is ever stored.
    Route::post('/auth/forgot-password', [LearnerPasswordResetController::class, 'request']);
    Route::post('/auth/reset-password', [LearnerPasswordResetController::class, 'reset']);
    // The site's own content (docs/lms/09) — brand + section copy the shared template renders. The
    // layout fetches it server-side on every page, so it precedes everything learner-specific.
    Route::get('/site', [LearnerSiteController::class, 'show']);
    Route::get('/courses', [LearnerCatalogController::class, 'index']);
    Route::get('/courses/{slug}', [LearnerCatalogController::class, 'show'])->where('slug', '[a-z0-9-]+');
    // The bookshop (docs/lms/11). Public, like the course catalogue — and so is the free sample,
    // deliberately: asking someone to register before they can read a sample chapter is exactly the
    // friction that loses the sale. Paid files are never resolvable from here.
    Route::get('/products', [LearnerProductController::class, 'index']);
    Route::get('/products/{slug}', [LearnerProductController::class, 'show'])->where('slug', '[a-z0-9-]+');
    Route::get('/products/{slug}/preview/{fileId}', [LearnerProductController::class, 'preview'])
        ->where('slug', '[a-z0-9-]+')->whereUuid('fileId');

    Route::middleware('learner.auth')->group(function () {
        Route::get('/me', [LearnerAuthController::class, 'me']);
        Route::post('/auth/logout', [LearnerAuthController::class, 'logout']);
        Route::post('/redeem', [LearnerRedemptionController::class, 'redeem']);
        // Free courses skip the code entirely — one click enrolls the signed-in learner.
        Route::post('/courses/{slug}/enroll', [LearnerRedemptionController::class, 'enrollFree'])->where('slug', '[a-z0-9-]+');
        Route::get('/courses/{slug}/content', [LearnerPlayerController::class, 'content'])->where('slug', '[a-z0-9-]+');
        Route::get('/courses/{slug}/certificate', [LearnerPlayerController::class, 'certificate'])->where('slug', '[a-z0-9-]+');
        Route::get('/lessons/{id}/playback', [LearnerPlayerController::class, 'playback']);
        Route::get('/lessons/{id}/quiz', [LearnerQuizController::class, 'show']);
        Route::post('/lessons/{id}/quiz/submit', [LearnerQuizController::class, 'submit']);
        Route::post('/lessons/{id}/progress', [LearnerPlayerController::class, 'progress']);

        // Checkout & orders (docs/lms/10). The main way a paid course is bought: place an order,
        // transfer the money outside the app, upload the receipt, watch the status page. Codes are
        // untouched above — a course can offer either door, or both.
        Route::get('/checkout/{slug}', [LearnerCheckoutController::class, 'show'])->where('slug', '[a-z0-9-]+');
        Route::post('/courses/{slug}/orders', [LearnerCheckoutController::class, 'store'])->where('slug', '[a-z0-9-]+');

        // The buyer's bookshelf (docs/lms/11): what they own, the download links for it, the
        // one-click claim on a free book, and the book twin of the course checkout. `/checkout/book`
        // is a literal segment and precedes nothing — the course checkout's {slug} is constrained to
        // lowercase-and-dashes, which 'book/xyz' cannot match anyway.
        Route::get('/library', [LearnerProductController::class, 'library']);
        Route::get('/products/{slug}/access', [LearnerProductController::class, 'access'])->where('slug', '[a-z0-9-]+');
        Route::post('/products/{slug}/claim', [LearnerProductController::class, 'claim'])->where('slug', '[a-z0-9-]+');
        Route::get('/checkout/book/{slug}', [LearnerCheckoutController::class, 'showProduct'])->where('slug', '[a-z0-9-]+');
        Route::post('/products/{slug}/orders', [LearnerCheckoutController::class, 'storeProduct'])->where('slug', '[a-z0-9-]+');
        // Orders are addressed by their human-quotable number (ORD-000123), not their uuid: it is
        // what the learner sees, screenshots and reads out on the phone.
        Route::get('/orders', [LearnerCheckoutController::class, 'index']);
        Route::get('/orders/{number}', [LearnerCheckoutController::class, 'showOrder'])->where('number', '[A-Za-z0-9-]+');
        Route::post('/orders/{number}/method', [LearnerCheckoutController::class, 'chooseMethod'])->where('number', '[A-Za-z0-9-]+');
        Route::post('/orders/{number}/receipt', [LearnerCheckoutController::class, 'uploadReceipt'])->where('number', '[A-Za-z0-9-]+');
        Route::post('/orders/{number}/cancel', [LearnerCheckoutController::class, 'cancel'])->where('number', '[A-Za-z0-9-]+');

        // The learner's own alert feed — receipt received / approved / rejected with the reason.
        Route::get('/notifications', [LearnerNotificationController::class, 'index']);
        Route::post('/notifications/read', [LearnerNotificationController::class, 'markAllRead']);
    });
});

/*
| LMS media delivery (docs/lms/04). PUBLIC but gated by Laravel's `signed` middleware: the url is
| minted only after the API authorised the caller (upload = course.manage, playback = an enrollment
| check), so the signature is the authorisation. On an S3 disk `raw`/`stream` are never used (the
| client talks to object storage directly); `hls` rewrites a playlist's segment URIs to signed urls
| server-side and IS used on both drivers. Named for URL::signedRoute.
*/
Route::middleware('signed')->group(function () {
    Route::put('/lms/media/raw', [MediaDeliveryController::class, 'raw'])->name('lms.media.raw');
    Route::get('/lms/media/stream', [MediaDeliveryController::class, 'stream'])->name('lms.media.stream');
    Route::get('/lms/media/hls', [MediaDeliveryController::class, 'hls'])->name('lms.media.hls');
});

/*
| Authenticated API. `auth:sanctum` establishes identity; `tenant.context`
| (TenantContextMiddleware) then sets the three app.* GUCs transaction-locally for the
| rest of the request, so RLS scopes every query. Capability checks (Gate::authorize) are
| applied per endpoint on top of the RLS backstop.
*/
Route::middleware(['auth:sanctum', 'tenant.context'])->group(function () {
    Route::post('/auth/logout', [AuthController::class, 'logout']);
    Route::get('/auth/me', [AuthController::class, 'me']);
    Route::patch('/auth/locale', [AuthController::class, 'setLocale']);

    // Super Admin platform actions (§4.4) + academy onboarding/lifecycle (Sprint 3 §7).
    // Capability Gates live in the controllers; RLS is the database backstop. There is
    // deliberately NO academy hard-delete route (decision §3.1 — academies are SUSPENDED).
    // Platform dashboard — Super Admin landing KPIs + recent activity (academy.read).
    Route::get('/admin/dashboard', [DashboardController::class, 'index']);

    Route::get('/admin/academy-types', [AcademyController::class, 'types']);
    Route::get('/admin/academies', [AcademyController::class, 'index']);
    Route::post('/admin/academies', [AcademyController::class, 'store']);
    Route::get('/admin/academies/{id}', [AcademyController::class, 'show']);
    Route::patch('/admin/academies/{id}', [AcademyController::class, 'update']);
    Route::post('/admin/academies/{id}/suspend', [AcademyController::class, 'suspend']);
    Route::post('/admin/academies/{id}/reactivate', [AcademyController::class, 'reactivate']);
    Route::get('/admin/academies/{id}/owner', [AcademyController::class, 'getOwner']);
    Route::patch('/admin/academies/{id}/owner', [AcademyController::class, 'updateOwner']);
    Route::post('/admin/academies/{id}/owner', [AcademyController::class, 'provisionOwner']);
    Route::post('/admin/academies/{id}/enter', [AcademyController::class, 'enter']);
    Route::post('/admin/academies/exit', [AcademyController::class, 'exit']);

    // Per-academy plan & add-on assignment (Sprint 9 §8, plan.manage — Super Admin). Changing
    // a plan or granting/revoking an add-on is audited; gating from it is enforced by
    // App\Support\Entitlement / the `entitled:` middleware.
    Route::get('/admin/academies/{id}/addons', [AcademyController::class, 'addOns']);
    Route::post('/admin/academies/{id}/plan', [AcademyController::class, 'setPlan']);
    Route::post('/admin/academies/{id}/addons', [AcademyController::class, 'setAddOn']);

    // Per-academy SaaS subscription lifecycle (Platform↔Academy billing, academy_billing.manage —
    // Super Admin). Trial window, activation/period, snapshot total cost. The owner reads their
    // OWN subscription for the dashboard via GET /my-subscription (no special capability).
    Route::get('/admin/academies/{id}/subscription', [AcademySubscriptionController::class, 'show']);
    Route::put('/admin/academies/{id}/subscription', [AcademySubscriptionController::class, 'update']);
    Route::post('/admin/academies/{id}/subscription/trial/extend', [AcademySubscriptionController::class, 'extendTrial']);
    Route::post('/admin/academies/{id}/subscription/activate', [AcademySubscriptionController::class, 'activate']);
    Route::get('/my-subscription', [AcademySubscriptionController::class, 'mySummary']);

    // Client-first Super Admin surface (R1, docs/superadmin-modules/04-CLIENT-FIRST-REDESIGN):
    // the cross-tenant client directory (module chips per client) and the per-module subscription
    // lifecycle — THE one writer for module on/off / plan / trial / activate / pause. The legacy
    // /admin/academies/* endpoints above stay as aliases and write through the same engine.
    Route::get('/admin/clients', [ClientController::class, 'index']);
    Route::post('/admin/clients', [ClientController::class, 'store']); // WhatsApp-only external client (M-CLI-2)
    Route::get('/admin/clients/{id}', [ClientController::class, 'show']);
    Route::post('/admin/clients/{id}/modules/{module}/subscription', [ClientController::class, 'enableModule']);
    Route::put('/admin/clients/{id}/modules/{module}/subscription', [ClientController::class, 'updateModule']);
    Route::put('/admin/clients/{id}/modules/{module}/features', [ClientController::class, 'updateModuleFeatures']);
    Route::post('/admin/clients/{id}/modules/{module}/subscription/trial', [ClientController::class, 'extendTrial']);
    Route::post('/admin/clients/{id}/modules/{module}/subscription/activate', [ClientController::class, 'activateModule']);
    Route::post('/admin/clients/{id}/modules/{module}/subscription/pause', [ClientController::class, 'pauseModule']);
    Route::post('/admin/clients/{id}/modules/{module}/subscription/end', [ClientController::class, 'endModule']);

    // Payments → XPay provisioning. The Super Admin holds the client's card-gateway keys; the client
    // never sees them (reads return last-4 tails only). Activating here is what puts the "Pay by
    // card" option on that client's public invoices.
    Route::get('/admin/clients/{id}/payments/xpay', [ClientPaymentController::class, 'showXpay']);
    Route::put('/admin/clients/{id}/payments/xpay', [ClientPaymentController::class, 'updateXpay']);
    Route::post('/admin/clients/{id}/payments/xpay/test', [ClientPaymentController::class, 'testXpay']);

    // Platform → Academy bills (academy_billing.manage). Academy-scoped so the Super Admin write
    // runs in the academy's context (no cross-tenant lookup); send delivers the bill over WhatsApp.
    Route::get('/admin/academies/{id}/bills', [AcademySubscriptionController::class, 'bills']);
    Route::post('/admin/academies/{id}/bills/generate', [AcademySubscriptionController::class, 'generateBill']);
    Route::post('/admin/academies/{id}/bills/{billId}/mark-paid', [AcademySubscriptionController::class, 'markBillPaid']);
    Route::post('/admin/academies/{id}/bills/{billId}/status', [AcademySubscriptionController::class, 'setBillStatus']);
    Route::post('/admin/academies/{id}/bills/{billId}/send', [AcademySubscriptionController::class, 'sendBill']);
    Route::get('/admin/academies/{id}/bills/{billId}/submissions', [AcademySubscriptionController::class, 'billSubmissions']);
    Route::get('/admin/academies/{id}/payment-submissions/{subId}/screenshot', [AcademySubscriptionController::class, 'screenshot']);
    Route::post('/admin/academies/{id}/payment-submissions/{subId}/review', [AcademySubscriptionController::class, 'reviewSubmission']);

    // The client's logo (academy.configure). Upload replaces the file AND rewrites
    // academies.brand_logo_url, which is the one column every branded surface already reads — the
    // client's sign-in page, their subdomain and their learner site all follow from this write.
    Route::post('/admin/academies/{id}/logo', [AcademyLogoController::class, 'upload']);
    Route::delete('/admin/academies/{id}/logo', [AcademyLogoController::class, 'remove']);

    // Per-academy WhatsApp automation config (automation.manage — Super Admin). The Wasender token
    // is stored encrypted and never returned; toggles gate the scheduled automation jobs.
    Route::get('/admin/academies/{id}/automation', [AcademyAutomationController::class, 'show']);
    Route::put('/admin/academies/{id}/automation', [AcademyAutomationController::class, 'update']);
    Route::post('/admin/academies/{id}/automation/token', [AcademyAutomationController::class, 'setToken']);
    Route::delete('/admin/academies/{id}/automation/token', [AcademyAutomationController::class, 'clearToken']);
    Route::post('/admin/academies/{id}/automation/test', [AcademyAutomationController::class, 'test']);
    Route::get('/admin/academies/{id}/automation/log', [AcademyAutomationController::class, 'log']);

    // Self-hosted WhatsApp gateway session lifecycle (automation.manage — Super Admin). Connect mints
    // a gateway session + returns the first QR; the panel polls /qr until /status flips to connected.
    Route::post('/admin/academies/{id}/whatsapp/connect', [AcademyAutomationController::class, 'whatsappConnect']);
    Route::get('/admin/academies/{id}/whatsapp/qr', [AcademyAutomationController::class, 'whatsappQr']);
    Route::get('/admin/academies/{id}/whatsapp/status', [AcademyAutomationController::class, 'whatsappStatus']);
    Route::post('/admin/academies/{id}/whatsapp/logout', [AcademyAutomationController::class, 'whatsappLogout']);
    // Manual test send + number-on-WhatsApp check (Super Admin sanity tools).
    Route::post('/admin/academies/{id}/whatsapp/send-test', [AcademyAutomationController::class, 'whatsappSendTest']);
    Route::post('/admin/academies/{id}/whatsapp/check', [AcademyAutomationController::class, 'whatsappCheck']);

    // External WhatsApp API access (docs/whatsapp-api): per-academy API keys + a shareable, expiring
    // public QR-connect link the admin hands to the client. Keys are shown in plaintext once, at create.
    Route::get('/admin/academies/{id}/api-keys', [AcademyAutomationController::class, 'listApiKeys']);
    Route::post('/admin/academies/{id}/api-keys', [AcademyAutomationController::class, 'createApiKey']);
    Route::delete('/admin/academies/{id}/api-keys/{keyId}', [AcademyAutomationController::class, 'revokeApiKey']);
    Route::post('/admin/academies/{id}/connect-link', [AcademyAutomationController::class, 'createConnectLink']);

    // Plan gating surface for the UI (Sprint 9 §8). Resolved capabilities + limits for the
    // current academy; authenticated, no special capability.
    Route::get('/entitlements', [EntitlementController::class, 'index']);

    // Audit log read UI (Sprint 9 §5). audit.read required; `audit.full` (PRO/add-on) unlocks
    // full history, BASIC is depth-limited to 30 days inside the controller.
    Route::get('/audit', [AuditController::class, 'index']);

    // Cross-tenant user management (Super Admin, user.read_platform). Reads go through audited
    // SECURITY DEFINER functions; writes run inside the target user's academy context. Role
    // changes additionally require role.assign (checked in the controller).
    Route::get('/admin/users', [UserController::class, 'index']);
    Route::get('/admin/users/{id}', [UserController::class, 'show']);
    Route::post('/admin/users/{id}/deactivate', [UserController::class, 'deactivate']);
    Route::post('/admin/users/{id}/reactivate', [UserController::class, 'reactivate']);
    Route::post('/admin/users/{id}/reset-password', [UserController::class, 'resetPassword']);
    Route::post('/admin/users/{id}/roles', [UserController::class, 'setRole']);

    // Billing & revenue overview (Super Admin, plan.manage) — MRR by currency, per-academy rows.
    Route::get('/admin/billing/overview', [BillingController::class, 'overview']);

    // Cross-academy Super Admin overview pages (sidebar). Subscriptions + payment-proof queue
    // (academy_billing.manage); automation status (automation.manage). Inline actions reuse the
    // per-academy endpoints above.
    Route::get('/admin/subscriptions', [AcademySubscriptionController::class, 'overview']);
    Route::get('/admin/automation', [AcademyAutomationController::class, 'overview']);
    Route::get('/admin/automation/activity', [AcademyAutomationController::class, 'activity']);
    // Self-hosted gateway health + live rate-limit settings (System tab).
    Route::get('/admin/automation/gateway/health', [AcademyAutomationController::class, 'gatewayHealth']);
    Route::get('/admin/automation/gateway/settings', [AcademyAutomationController::class, 'gatewaySettings']);
    Route::put('/admin/automation/gateway/settings', [AcademyAutomationController::class, 'updateGatewaySettings']);

    // Super Admin video oversight — Tier 1 (read-only governance for the self-hosted video
    // platform; docs/video-platform/08-ROOM-ACCESS-AND-MONITORING). Each route is gated by
    // platform.manage in the controller; the cross-tenant reads go through the audited
    // SECURITY DEFINER hatches (app.admin_video_stats / app.admin_video_audit).
    Route::get('/admin/video/usage', [VideoOversightController::class, 'usage']);
    Route::get('/admin/video/compliance', [VideoOversightController::class, 'compliance']);
    Route::get('/admin/video/health', [VideoOversightController::class, 'health']);
    Route::get('/admin/video/plans', [VideoOversightController::class, 'plans']);
    // Per-academy video governance (Tier 2): detail, per-room logs, and the access write
    // (activate/deactivate/trial/tier) — the academies.video_access override.
    Route::get('/admin/video/academies/{id}', [VideoOversightController::class, 'academy']);
    Route::get('/admin/video/academies/{id}/rooms/{roomId}/logs', [VideoOversightController::class, 'roomLogs']);
    Route::post('/admin/video/academies/{id}/access', [VideoOversightController::class, 'setAccess']);

    // Super Admin LMS oversight (docs/lms) — the course-platform twin of the video block above.
    // Reads go through the audited SECURITY DEFINER hatches (app.admin_lms_stats / _academy / _audit);
    // the writes are the LMS-only control surface (caps, public site handle, course & learner
    // moderation) — module subscriptions stay the client page's job. All gated by platform.manage.
    Route::get('/admin/lms/usage', [LmsOversightController::class, 'usage']);
    Route::get('/admin/lms/activity', [LmsOversightController::class, 'activity']);
    Route::get('/admin/lms/academies/{id}', [LmsOversightController::class, 'academy']);
    Route::post('/admin/lms/academies/{id}/limits', [LmsOversightController::class, 'setLimits']);
    Route::put('/admin/lms/academies/{id}/subdomain', [LmsOversightController::class, 'setSubdomain']);
    Route::post('/admin/lms/academies/{id}/courses/{courseId}/status', [LmsOversightController::class, 'setCourseStatus']);
    Route::post('/admin/lms/academies/{id}/learners/{learnerId}/status', [LmsOversightController::class, 'setLearnerStatus']);

    // Platform settings + feature flags (Super Admin, platform.manage). A disabled flag is a
    // kill-switch consulted by Entitlement::resolve — it removes a capability platform-wide.
    Route::get('/admin/feature-flags', [SettingsController::class, 'flags']);
    Route::patch('/admin/feature-flags/{key}', [SettingsController::class, 'updateFlag']);
    Route::get('/admin/settings', [SettingsController::class, 'settings']);
    Route::patch('/admin/settings', [SettingsController::class, 'updateSettings']);

    // Marketing demo requests (Super Admin, platform.manage) — the inbox behind the public form on
    // acadmyq.com. Platform-scoped: these prospects belong to no academy, which is exactly why they
    // cannot live in an academy's own `crm_leads` pipeline.
    Route::get('/admin/demo-requests', [AdminDemoRequestController::class, 'index']);
    Route::patch('/admin/demo-requests/{id}', [AdminDemoRequestController::class, 'update'])->whereUuid('id');

    // Finance ledger (Super Admin, platform.manage) — the platform owner's OWN income book:
    // the clients who pay the owner, their deals (a one-time sale in installments, or a
    // subscription) and the money actually received. An island by design: no link to academies,
    // module subscriptions or academy invoices in either direction (see FinanceLedger).
    Route::get('/admin/finance/overview', FinanceOverviewController::class);
    Route::get('/admin/finance/clients', [FinanceClientController::class, 'index']);
    Route::get('/admin/finance/clients/all', [FinanceClientController::class, 'all']);
    Route::post('/admin/finance/clients', [FinanceClientController::class, 'store']);
    Route::patch('/admin/finance/clients/{id}', [FinanceClientController::class, 'update'])->whereUuid('id');
    Route::delete('/admin/finance/clients/{id}', [FinanceClientController::class, 'destroy'])->whereUuid('id');
    Route::get('/admin/finance/deals', [FinanceDealController::class, 'index']);
    Route::post('/admin/finance/deals', [FinanceDealController::class, 'store']);
    Route::get('/admin/finance/deals/{id}', [FinanceDealController::class, 'show'])->whereUuid('id');
    Route::patch('/admin/finance/deals/{id}', [FinanceDealController::class, 'update'])->whereUuid('id');
    Route::delete('/admin/finance/deals/{id}', [FinanceDealController::class, 'destroy'])->whereUuid('id');
    Route::put('/admin/finance/deals/{id}/schedule', [FinanceDealController::class, 'replaceSchedule'])->whereUuid('id');
    Route::post('/admin/finance/deals/{id}/payments', [FinanceDealController::class, 'storePayment'])->whereUuid('id');
    Route::get('/admin/finance/payments', [FinancePaymentController::class, 'index']);
    Route::delete('/admin/finance/payments/{id}', [FinancePaymentController::class, 'destroy'])->whereUuid('id');

    // Role ⇄ capability editor (Super Admin, platform.manage). Rewrites the role_permissions
    // catalog; a SUPER_ADMIN lockout guard + full before/after audit protect the blast radius.
    Route::get('/admin/roles', [RoleController::class, 'index']);
    Route::patch('/admin/roles/{role}/permissions', [RoleController::class, 'setPermissions']);

    // Plan & add-on catalog CRUD (Super Admin, plan.manage).
    Route::get('/admin/capabilities', [PlanController::class, 'capabilities']);
    Route::get('/admin/plans', [PlanController::class, 'index']);
    Route::post('/admin/plans', [PlanController::class, 'store']);
    Route::patch('/admin/plans/{id}', [PlanController::class, 'update']);
    Route::post('/admin/add-ons', [PlanController::class, 'storeAddOn']);
    Route::patch('/admin/add-ons/{id}', [PlanController::class, 'updateAddOn']);

    // Per-academy report-field configuration (report_field.manage; Owner or Super Admin).
    // Reading the academy's fields is always available; CREATING or EDITING a custom field is
    // a PRO capability (`report_field.custom`) — BASIC academies keep the core seeded set but
    // get a 402-upgrade (not a 403) when they try to add/customise one (Sprint 9 §4, AC-9.1).
    Route::get('/academies/{id}/report-fields', [ReportFieldController::class, 'index']);
    // Permission (`can:`) is checked BEFORE entitlement (`entitled:`) so the layers stay
    // ordered: a not-permitted caller gets 403 forbidden, and only a permitted-but-not-entitled
    // one falls through to the 402 upgrade (AC-9.5 / TC-9.6).
    Route::middleware(['can:report_field.manage', 'entitled:report_field.custom'])->group(function () {
        Route::post('/academies/{id}/report-fields', [ReportFieldController::class, 'store']);
        Route::patch('/academies/{id}/report-fields/{fieldId}', [ReportFieldController::class, 'update']);
    });
    Route::delete('/academies/{id}/report-fields/{fieldId}', [ReportFieldController::class, 'destroy']);

    // People: Guardians, Students & Teachers (Sprint 4 §8). Every route is capability-gated
    // (Gate::authorize) and tenant-scoped by RLS; lists are server-driven via App\Support\DataTable.
    Route::get('/guardians', [GuardianController::class, 'index']);
    Route::post('/guardians', [GuardianController::class, 'store']);
    Route::get('/guardians/{id}', [GuardianController::class, 'show']);
    Route::patch('/guardians/{id}', [GuardianController::class, 'update']);
    Route::post('/guardians/{id}/deactivate', [GuardianController::class, 'deactivate']);

    Route::get('/students', [StudentController::class, 'index']);
    Route::post('/students', [StudentController::class, 'store']);
    Route::get('/students/{id}', [StudentController::class, 'show']);
    Route::patch('/students/{id}', [StudentController::class, 'update']);
    Route::post('/students/{id}/deactivate', [StudentController::class, 'deactivate']);
    Route::post('/students/{id}/reactivate', [StudentController::class, 'reactivate']);
    // Owner-facing "remove from the system" — a recoverable soft-delete (design §3.7); the row
    // and its history are retained and restorable via reactivate.
    Route::delete('/students/{id}', [StudentController::class, 'destroy']);
    Route::put('/students/{id}/subscription', [StudentController::class, 'setSubscription']);
    Route::patch('/students/{id}/subscription/price', [StudentController::class, 'changePrice']);
    Route::get('/students/{id}/subscription/reprice-preview', [StudentController::class, 'repricePreview']);
    Route::post('/students/{id}/teacher', [StudentController::class, 'reassignTeacher']);
    Route::get('/students/{id}/teacher-history', [StudentController::class, 'teacherHistory']);

    // Staff department catalog — platform-level, managed by Super Admin, readable by all.
    // GET is open to any authenticated user (dropdown); writes are Super Admin only.
    Route::get('/staff-departments', [StaffDepartmentController::class, 'index']);
    Route::post('/admin/staff-departments', [StaffDepartmentController::class, 'store']);
    Route::patch('/admin/staff-departments/{id}', [StaffDepartmentController::class, 'update']);
    Route::delete('/admin/staff-departments/{id}', [StaffDepartmentController::class, 'destroy']);

    // Academy custom roles — the academy composes its own roles from the capability catalog
    // and assigns them to staff. role.manage (RBAC) gates everything; tenant-scoped by RLS
    // (academy_roles / academy_role_permissions).
    //
    // Plan-gated (entitled:custom_roles — a FREE-trial & PRO feature, not BASIC); role.manage
    // (RBAC) still guards each operation.
    Route::middleware('entitled:custom_roles')->group(function () {
        Route::get('/roles', [AcademyRoleController::class, 'index']);
        Route::post('/roles', [AcademyRoleController::class, 'store']);
        Route::patch('/roles/{id}', [AcademyRoleController::class, 'update']);
        Route::delete('/roles/{id}', [AcademyRoleController::class, 'destroy']);
    });

    // Staff — non-teaching academy staff (support, accounting, reception, HR, IT, etc.).
    // Capability-gated (staff.read / staff.create / staff.update / staff.deactivate),
    // plan-gated (entitled:staff), and tenant-scoped by RLS.
    Route::middleware('entitled:staff')->group(function () {
        Route::get('/staff', [StaffController::class, 'index']);
        Route::post('/staff', [StaffController::class, 'store']);
        Route::get('/staff/{id}', [StaffController::class, 'show']);
        Route::patch('/staff/{id}', [StaffController::class, 'update']);
        Route::post('/staff/{id}/deactivate', [StaffController::class, 'deactivate']);
        Route::post('/staff/{id}/reactivate', [StaffController::class, 'reactivate']);
    });

    Route::get('/teachers', [TeacherController::class, 'index']);
    Route::post('/teachers', [TeacherController::class, 'store']);
    Route::get('/teachers/{id}', [TeacherController::class, 'show']);
    Route::patch('/teachers/{id}', [TeacherController::class, 'update']);
    // Set or change a teacher's sign-in login (email + password). Creates one if absent.
    Route::patch('/teachers/{id}/login', [TeacherController::class, 'updateLogin']);
    Route::post('/teachers/{id}/deactivate', [TeacherController::class, 'deactivate']);
    Route::delete('/teachers/{id}', [TeacherController::class, 'destroy']);

    // Internal performance reports written ABOUT a teacher (owner/support; teacher_report.manage).
    Route::get('/teachers/{id}/reports', [TeacherReportController::class, 'index']);
    Route::post('/teachers/{id}/reports', [TeacherReportController::class, 'store']);
    Route::delete('/teachers/{id}/reports/{reportId}', [TeacherReportController::class, 'destroy']);

    // Academy profile settings — name and timezone. Read: invoice.read (all owners).
    // Write: specialization.manage (the "settings" capability). The UPDATE uses a
    // SECURITY DEFINER function because the academies table restricts direct writes
    // to Super Admin only (§10).
    Route::get('/academy', [AcademyProfileController::class, 'show']);
    Route::patch('/academy', [AcademyProfileController::class, 'update']);

    // Per-academy teacher specializations (Settings). Read for the teacher-form dropdown;
    // create/edit/delete require specialization.manage.
    Route::get('/specializations', [SpecializationController::class, 'index']);
    Route::post('/specializations', [SpecializationController::class, 'store']);
    Route::patch('/specializations/{id}', [SpecializationController::class, 'update']);
    Route::delete('/specializations/{id}', [SpecializationController::class, 'destroy']);

    // Per-academy payment channel settings (Settings → Payment). Read requires invoice.read;
    // writes require payment_settings.manage. Three fixed channels: BANK_TRANSFER, PAYPAL, XPAY.
    Route::get('/payment-settings', [PaymentSettingsController::class, 'index']);
    Route::put('/payment-settings/{method}', [PaymentSettingsController::class, 'upsert']);

    // Per-academy certificate templates (Certificates). Plan-gated (entitled:certificates);
    // certificate.read / certificate.manage guard individual operations.
    Route::middleware('entitled:certificates')->group(function () {
        Route::get('/certificate-templates', [CertificateTemplateController::class, 'index']);
        Route::put('/certificate-templates/{number}', [CertificateTemplateController::class, 'update']);
    });

    // The academy's REPORT CARD wording — the voice behind the shareable session/trial report
    // image (the design lives in the web client). NOT plan-gated: every academy that can write a
    // session report can send its guardian a branded card. `session.read` guards the preview,
    // `report_field.manage` the edit (see ReportCardTemplateController).
    Route::get('/report-card-template', [ReportCardTemplateController::class, 'show']);
    Route::put('/report-card-template', [ReportCardTemplateController::class, 'update']);

    // Scheduling & sessions (Sprint 5 §8). The weekly schedule is the rule; sessions are the
    // materialised occurrences. Every route is capability-gated and tenant-scoped by RLS;
    // generation is idempotent and audited (generator.run with created/removed counts).
    Route::get('/timetables', [ScheduleController::class, 'index']);
    Route::get('/students/{id}/schedule', [ScheduleController::class, 'show']);
    Route::put('/students/{id}/schedule', [ScheduleController::class, 'put']);
    Route::delete('/students/{id}/schedule', [ScheduleController::class, 'destroy']);

    Route::post('/sessions', [SessionController::class, 'store']);
    Route::post('/sessions/{id}/reschedule', [SessionController::class, 'reschedule']);
    Route::post('/sessions/{id}/cancel', [SessionController::class, 'cancel']);

    Route::get('/calendar', [CalendarController::class, 'index']);

    // Free Trials (Free-Trials module) — the trials OVERVIEW: every trial the academy has run,
    // its outcome, and the statistics over them. Booking a trial is the CRM's job (a trial exists
    // because a lead reached the TRIAL stage), so what lives here is read, outcome, cancel and
    // convert; POST /trials remains for a trial with no lead behind it. Owner-only: `trial.read`
    // (list/stats) and `trial.manage` (book/update/cancel/convert). Plan-gated
    // (entitled:trials — a FREE-trial & PRO feature, not BASIC). The literal `summary` is
    // declared before `{id}` so it isn't captured as an id.
    Route::middleware('entitled:trials')->group(function () {
        Route::get('/trials', [TrialController::class, 'index']);
        Route::get('/trials/summary', [TrialController::class, 'summary']);
        Route::post('/trials', [TrialController::class, 'store']);
        Route::patch('/trials/{id}', [TrialController::class, 'update']);
        Route::post('/trials/{id}/convert', [TrialController::class, 'convert']);
        Route::delete('/trials/{id}', [TrialController::class, 'destroy']);
    });

    // CRM / Leads (CRM module). Sales/support staff capture prospective students as leads and
    // walk them through one pipeline board (NEW → CONTACTED → INTERESTED → TRIAL → SUBSCRIBED,
    // + LOST), keeping a per-lead activity timeline. The last two stages write real records:
    // `/trial` books the taster lesson (which is what puts it on the calendar) and `/convert`
    // links the student the lead became (which is what puts them on the Students page). Owner-only
    // by default (`crm.read` / `crm.manage`), meant to be delegated via a custom "Sales" role.
    // Plan-gated by its own billable module (entitled:crm) — including the trial booking, so a
    // sales desk never needs the trials capability to sell with one. Literal segments (`board`,
    // `summary`, and the sibling `/crm/teachers`) are declared before `{id}` so they aren't
    // captured as an id.
    Route::middleware('entitled:crm')->group(function () {
        Route::get('/crm/leads', [LeadController::class, 'index']);
        Route::get('/crm/leads/board', [LeadController::class, 'board']);
        Route::get('/crm/leads/summary', [LeadController::class, 'summary']);
        Route::get('/crm/teachers', [LeadController::class, 'teachers']);
        Route::post('/crm/leads', [LeadController::class, 'store']);
        Route::get('/crm/leads/{id}', [LeadController::class, 'show']);
        Route::patch('/crm/leads/{id}', [LeadController::class, 'update']);
        Route::post('/crm/leads/{id}/notes', [LeadController::class, 'addNote']);
        Route::post('/crm/leads/{id}/trial', [LeadController::class, 'bookTrial']);
        Route::post('/crm/leads/{id}/convert', [LeadController::class, 'convert']);
        Route::delete('/crm/leads/{id}', [LeadController::class, 'destroy']);
    });

    // LMS / Courses (LMS module, docs/lms). Staff build on-demand courses — sections of lessons
    // (YouTube / text / PDF / audio now; uploaded video + quizzes in later phases) — that learners
    // watch on the academy's public subdomain. Owner-only by default (`course.read` / `course.manage`),
    // delegated via a custom "Courses" role. Plan-gated by its own billable module (entitled:lms).
    // Literal segments (`summary`, `sections`, `lessons`, `publish`) precede `{id}` so they aren't
    // captured as an id.
    Route::middleware('entitled:lms')->group(function () {
        Route::get('/courses', [CourseController::class, 'index']);
        Route::get('/courses/summary', [CourseController::class, 'summary']);
        // The course platform's own dashboard — the LMS client's home screen (literal, so it must
        // precede/avoid `{id}`, which is whereUuid'd).
        Route::get('/courses/dashboard', [LmsDashboardController::class, 'show']);
        // The client's public-site content (docs/lms/09) — the only per-client half of the shared
        // learner-site template. Literal, so it must precede the whereUuid'd `/courses/{id}`.
        Route::get('/courses/site', [LmsSiteProfileController::class, 'show']);
        Route::put('/courses/site', [LmsSiteProfileController::class, 'update']);

        // The sales desk (docs/lms/10 §4) — the order queue, the receipts awaiting a decision and
        // the money the catalogue made. `course_order.read` opens it; every decision that moves
        // money or access additionally needs `course_order.manage`. All literal `orders` /
        // `payment-*` segments, so they precede the whereUuid'd `/courses/{id}` below.
        Route::get('/courses/orders', [LmsOrderController::class, 'index']);
        Route::get('/courses/orders/summary', [LmsOrderController::class, 'summary']);
        Route::get('/courses/orders/{id}', [LmsOrderController::class, 'show'])->whereUuid('id');
        Route::get('/courses/orders/{id}/receipts/{receiptId}/file', [LmsOrderController::class, 'receiptFile'])
            ->whereUuid(['id', 'receiptId']);
        Route::post('/courses/orders/{id}/approve', [LmsOrderController::class, 'approve'])->whereUuid('id');
        Route::post('/courses/orders/{id}/reject', [LmsOrderController::class, 'reject'])->whereUuid('id');
        Route::post('/courses/orders/{id}/refund', [LmsOrderController::class, 'refund'])->whereUuid('id');
        Route::post('/courses/orders/{id}/cancel', [LmsOrderController::class, 'cancel'])->whereUuid('id');
        Route::post('/courses/orders/{id}/status', [LmsOrderController::class, 'setStatus'])->whereUuid('id');

        // Where the client's money lands. Changing an account number is its own capability
        // (`payment_method.manage`); the currency is the academy's, guarded by payment_settings.manage.
        Route::get('/courses/payment-methods', [LmsPaymentMethodController::class, 'index']);
        Route::put('/courses/payment-methods', [LmsPaymentMethodController::class, 'update']);
        Route::put('/courses/payment-currency', [LmsPaymentMethodController::class, 'setCurrency']);
        // Digital products (docs/lms/11) — the books/PDFs half of the catalogue. All literal
        // `products` segments, so they precede the whereUuid'd `/courses/{id}` below. Gated by the
        // course capabilities: this IS the client's catalogue, just a different shelf of it.
        Route::get('/courses/products', [LmsProductController::class, 'index']);
        Route::get('/courses/products/summary', [LmsProductController::class, 'summary']);
        Route::post('/courses/products', [LmsProductController::class, 'store']);
        Route::get('/courses/products/{id}', [LmsProductController::class, 'show'])->whereUuid('id');
        Route::patch('/courses/products/{id}', [LmsProductController::class, 'update'])->whereUuid('id');
        Route::post('/courses/products/{id}/publish', [LmsProductController::class, 'setStatus'])->whereUuid('id');
        Route::delete('/courses/products/{id}', [LmsProductController::class, 'destroy'])->whereUuid('id');
        Route::post('/courses/products/{product}/files', [LmsProductController::class, 'storeFile'])->whereUuid('product');
        Route::post('/courses/products/{product}/files/reorder', [LmsProductController::class, 'reorderFiles'])->whereUuid('product');
        Route::patch('/courses/products/{product}/files/{id}', [LmsProductController::class, 'updateFile'])->whereUuid(['product', 'id']);
        Route::delete('/courses/products/{product}/files/{id}', [LmsProductController::class, 'destroyFile'])->whereUuid(['product', 'id']);

        Route::post('/courses', [CourseController::class, 'store']);
        Route::get('/courses/{id}', [CourseController::class, 'show'])->whereUuid('id');
        Route::patch('/courses/{id}', [CourseController::class, 'update'])->whereUuid('id');
        Route::post('/courses/{id}/publish', [CourseController::class, 'setStatus'])->whereUuid('id');
        Route::delete('/courses/{id}', [CourseController::class, 'destroy'])->whereUuid('id');

        Route::post('/courses/{course}/sections', [SectionController::class, 'store']);
        Route::post('/courses/{course}/sections/reorder', [SectionController::class, 'reorder']);
        Route::patch('/courses/{course}/sections/{id}', [SectionController::class, 'update']);
        Route::delete('/courses/{course}/sections/{id}', [SectionController::class, 'destroy']);

        Route::post('/courses/{course}/lessons', [LessonController::class, 'store']);
        Route::post('/courses/{course}/lessons/reorder', [LessonController::class, 'reorder']);
        Route::patch('/courses/{course}/lessons/{id}', [LessonController::class, 'update']);
        Route::delete('/courses/{course}/lessons/{id}', [LessonController::class, 'destroy']);

        // Uploaded lesson media (VOD, docs/lms/04): reserve → PUT the file (presigned/​signed) →
        // confirm READY → poll status. `media` is a literal segment; `/courses/{id}` is whereUuid'd
        // above so it isn't captured as an id.
        Route::post('/courses/media/upload-url', [MediaController::class, 'createUpload']);
        Route::get('/courses/media/{id}', [MediaController::class, 'show'])->whereUuid('id');
        Route::post('/courses/media/{id}/uploaded', [MediaController::class, 'markUploaded'])->whereUuid('id');

        // Quizzes (phase 4, docs/lms/04): the builder for a course; a QUIZ lesson references quizzes.id.
        // Correct-answer flags are returned to staff here but never to learners.
        // The cross-course listing + its results are literal (`quizzes` in the {course} slot), so they
        // precede the course-scoped routes below.
        Route::get('/courses/quizzes', [QuizController::class, 'index']);
        Route::get('/courses/quizzes/{id}/results', [QuizController::class, 'results'])->whereUuid('id');
        Route::post('/courses/{course}/quizzes', [QuizController::class, 'store']);
        Route::get('/courses/{course}/quizzes/{id}', [QuizController::class, 'show']);
        Route::put('/courses/{course}/quizzes/{id}', [QuizController::class, 'update']);
        Route::delete('/courses/{course}/quizzes/{id}', [QuizController::class, 'destroy']);

        // Access codes (staff generate/hand out; learners redeem on the public site).
        Route::get('/courses/codes', [CodeController::class, 'index']);
        Route::post('/courses/codes/batch', [CodeController::class, 'batch']);
        Route::patch('/courses/codes/{id}', [CodeController::class, 'update']);
        Route::delete('/courses/codes/{id}', [CodeController::class, 'destroy']);

        // Learners + their enrollments (staff view; block / revoke access).
        Route::get('/courses/learners', [LearnerAdminController::class, 'index']);
        Route::get('/courses/learners/{id}', [LearnerAdminController::class, 'show']);
        Route::post('/courses/learners/{id}/status', [LearnerAdminController::class, 'setStatus']);
        Route::post('/courses/learners/{id}/enrollment', [LearnerAdminController::class, 'setEnrollment']);
        Route::post('/courses/learners/{id}/product', [LearnerAdminController::class, 'setProductAccess']);
    });

    Route::post('/admin/generate-sessions', GenerateSessionsController::class);

    // Attendance & custom reports (Sprint 6 §8). The attendance outcome fires the billing hook
    // (§5) and sets the billable status Sprint 5 left untouched; the report engine renders the
    // academy's report_field_definitions and stores values keyed by field key. Every route is
    // capability-gated, RLS-scoped, and (for Teachers) row-filtered to their own sessions (§3.6).
    Route::get('/sessions/pending-attendance', [SessionController::class, 'pendingAttendance']);
    // The overdue worklist (الحصص المعلقة): lessons that ended more than the grace window ago and
    // still have no outcome. Literal segment, so it precedes /{id}.
    Route::get('/sessions/overdue', [SessionController::class, 'overdue']);
    // Day view for the attendance page (date-range + filters); before /{id} so it isn't captured.
    Route::get('/sessions/day', [SessionController::class, 'day']);
    // Count of today's SCHEDULED sessions for the sidebar Attendance badge; before /{id}.
    Route::get('/sessions/day/count', [SessionController::class, 'dayCount']);
    Route::get('/sessions/{id}', [SessionController::class, 'show']);
    Route::get('/sessions/{id}/duration-preview', [SessionController::class, 'durationPreview']);
    Route::patch('/sessions/{id}/duration', [SessionController::class, 'updateDuration']);
    Route::post('/sessions/{id}/attendance', [AttendanceController::class, 'store']);
    // Take back a recorded outcome (session.revert_attendance — owners/supervisors, never a
    // teacher). Puts the lesson back to SCHEDULED, reversing the invoice line and the payout with
    // it, which is what makes a mis-marked lesson reschedulable again.
    Route::post('/sessions/{id}/attendance/revert', [AttendanceController::class, 'revert']);
    Route::put('/sessions/{id}/report', [SessionReportController::class, 'put']);
    Route::post('/sessions/{id}/report/whatsapp-sent', [SessionReportController::class, 'whatsappSent']);
    Route::get('/students/{id}/reports', [SessionReportController::class, 'archive']);

    // Notifications & teacher-cancellation approvals (owner-only Notifications page, two tabs). A
    // TEACHER raises a cancellation REQUEST (session.cancel_request); the OWNER approves/rejects
    // (session.cancel_approve) and reads the queue + report-overdue feed via notification.read.
    // Literal segments (`summary`, `read-all`) are declared before `{id}` so they aren't captured.
    Route::post('/sessions/{id}/cancellation-request', [CancellationRequestController::class, 'store']);
    // A teacher requests a lesson be marked FREE (session.free_request); the owner approves it from
    // the same "Classes" queue (session.free_approve), deciding the billing in the approval popup.
    Route::post('/sessions/{id}/free-request', [CancellationRequestController::class, 'storeFree']);
    Route::get('/cancellation-requests', [CancellationRequestController::class, 'index']);
    Route::post('/cancellation-requests/{id}/approve', [CancellationRequestController::class, 'approve']);
    Route::post('/cancellation-requests/{id}/reject', [CancellationRequestController::class, 'reject']);

    Route::get('/notifications', [NotificationController::class, 'index']);
    Route::get('/notifications/summary', [NotificationController::class, 'summary']);
    Route::post('/notifications/read-all', [NotificationController::class, 'markAllRead']);
    Route::post('/notifications/{id}/read', [NotificationController::class, 'markRead']);

    // Student progress reports: a TEACHER submits a monthly report about one of their students
    // (student_report.submit); the OWNER reviews it on the Notifications "Student Reports" tab
    // (student_report.review). Plan-gated (entitled:student_reports — PRO feature); literal
    // segments are declared before `{id}` so they aren't captured.
    Route::middleware('entitled:student_reports')->group(function () {
        Route::get('/student-reports/students', [StudentProgressReportController::class, 'students']);
        Route::get('/student-reports/review', [StudentProgressReportController::class, 'review']);
        Route::get('/student-reports', [StudentProgressReportController::class, 'index']);
        Route::post('/student-reports', [StudentProgressReportController::class, 'store']);
        Route::post('/student-reports/{id}/approve', [StudentProgressReportController::class, 'approve']);
        Route::post('/student-reports/{id}/reject', [StudentProgressReportController::class, 'reject']);
    });

    // Invoicing (Sprint 7 §8). `close` is declared before `{id}` to prevent Laravel treating
    // the literal string "close" as an invoice ID. Plan-gated (entitled:invoicing),
    // capability-gated (invoice.read / invoice.create / etc.), and RLS-scoped.
    Route::middleware('entitled:invoicing')->group(function () {
        Route::get('/invoices', [InvoiceController::class, 'index']);
        Route::get('/invoices/summary', [InvoiceController::class, 'summary']);
        Route::get('/invoices/advance-quote', [InvoiceController::class, 'advanceQuote']);
        Route::post('/invoices', [InvoiceController::class, 'store']);
        Route::post('/invoices/advance', [InvoiceController::class, 'storeAdvance']);
        Route::post('/invoices/close', [InvoiceController::class, 'close']);
        Route::get('/invoices/{id}', [InvoiceController::class, 'show']);
        Route::post('/invoices/{id}/mark-paid', [InvoiceController::class, 'markPaid']);
        Route::get('/invoices/{id}/payment-proof', [InvoiceController::class, 'paymentProof']);
        Route::post('/invoices/{id}/send-link', [InvoiceController::class, 'sendLink']);

        // Lesson packages (docs/lesson-packages) — the hour-based billing mode that replaces the
        // monthly invoice for the students on it. Same plan gate as invoicing because it IS
        // invoicing, just on a different clock. Literal segments (`summary`, `students`) are
        // declared before `{id}` so they are never captured as a package ID.
        Route::get('/packages', [LessonPackageController::class, 'index']);
        Route::get('/packages/summary', [LessonPackageController::class, 'summary']);
        Route::get('/packages/students', [LessonPackageController::class, 'students']);
        Route::post('/packages', [LessonPackageController::class, 'store']);
        Route::get('/packages/{id}', [LessonPackageController::class, 'show']);
        Route::patch('/packages/{id}', [LessonPackageController::class, 'update']);
        Route::post('/packages/{id}/sync-lessons', [LessonPackageController::class, 'syncLessons']);
        Route::post('/packages/{id}/close', [LessonPackageController::class, 'close']);
        Route::post('/packages/{id}/cancel', [LessonPackageController::class, 'cancel']);
        Route::post('/packages/{id}/bill-overdraft', [LessonPackageController::class, 'billOverdraft']);

        // The ledger by hand: the owner adding, correcting and removing individual lessons on a
        // package. `lessons` here means the credit rows — the lessons that ate this block — and
        // adding one can CREATE the underlying attended session, so these are package.manage.
        Route::get('/packages/{id}/available-lessons', [LessonPackageController::class, 'availableLessons']);
        Route::post('/packages/{id}/lessons', [LessonPackageController::class, 'addLesson']);
        Route::patch('/packages/{id}/lessons/{creditId}', [LessonPackageController::class, 'updateLesson']);
        Route::delete('/packages/{id}/lessons/{creditId}', [LessonPackageController::class, 'removeLesson']);
    });

    // Live FX rates (owner) — converts every academy currency into the home currency (EGP) so the
    // financial-statistics page can show one converted grand total and salaries in EGP. Not plan-gated;
    // guarded by invoice.read inside the controller (same gate as the statistics page).
    Route::get('/reports/exchange-rates', [ExchangeRateController::class, 'index']);

    // Payroll (Sprint 8 §8) — the second money document. Plan-gated (entitled:payroll).
    // `finalize` and `/me/payouts` are declared before `{id}` so the literal segments are
    // never treated as a payout ID. Owner endpoints require payout.read / payout.finalize;
    // the teacher self-view requires payout.read_own (§3.6). Profit summary is payout.read.
    Route::middleware('entitled:payroll')->group(function () {
        Route::get('/payouts', [PayoutController::class, 'index']);
        // Salaries for an arbitrary window rather than a calendar month. Declared before `{id}`
        // so the literal segment is never read as a payout ID.
        Route::get('/payouts/range', [PayoutController::class, 'range']);
        Route::post('/payouts/finalize', [PayoutController::class, 'finalize']);
        Route::get('/me/payouts', [PayoutController::class, 'mePayouts']);
        Route::get('/payouts/{id}', [PayoutController::class, 'show']);
        Route::post('/payouts/{id}/adjustments', [PayoutController::class, 'addAdjustment']);
        Route::delete('/payouts/{id}/adjustments/{adjustmentId}', [PayoutController::class, 'removeAdjustment']);
        Route::get('/reports/profit-summary', [PayoutController::class, 'profitSummary']);

        // Teacher quality + Discounts & Awards — payroll's two management surfaces, so they sit
        // under the SAME plan gate as the statements they move money on. RBAC splits by page:
        // the rubric/reports are teacher_quality.*, while an award/discount is a payout
        // adjustment and stays on payout.read / payout.adjust — nobody gains a way to move a
        // teacher's pay that they didn't already have. Literal segments (`summary`, `settings`,
        // `rubric`) are declared before `{id}` so they aren't captured as an id.
        Route::get('/quality/rubric', [QualityRubricController::class, 'index']);
        Route::post('/quality/rubric/categories', [QualityRubricController::class, 'storeCategory']);
        Route::patch('/quality/rubric/categories/{id}', [QualityRubricController::class, 'updateCategory']);
        Route::delete('/quality/rubric/categories/{id}', [QualityRubricController::class, 'destroyCategory']);
        Route::post('/quality/rubric/criteria', [QualityRubricController::class, 'storeCriterion']);
        Route::patch('/quality/rubric/criteria/{id}', [QualityRubricController::class, 'updateCriterion']);
        Route::delete('/quality/rubric/criteria/{id}', [QualityRubricController::class, 'destroyCriterion']);

        Route::get('/quality/reports/summary', [QualityReportController::class, 'summary']);
        Route::get('/quality/reports', [QualityReportController::class, 'index']);
        Route::post('/quality/reports', [QualityReportController::class, 'store']);
        Route::get('/quality/reports/{id}', [QualityReportController::class, 'show']);
        Route::delete('/quality/reports/{id}', [QualityReportController::class, 'destroy']);
        Route::get('/quality/teachers/{id}/sessions', [QualityReportController::class, 'teacherSessions']);

        Route::get('/quality/settings', [TeacherAdjustmentController::class, 'settings']);
        Route::put('/quality/settings', [TeacherAdjustmentController::class, 'updateSettings']);
        Route::get('/quality/adjustments/summary', [TeacherAdjustmentController::class, 'summary']);
        Route::get('/quality/adjustments', [TeacherAdjustmentController::class, 'index']);
        Route::post('/quality/adjustments/{id}/waive', [TeacherAdjustmentController::class, 'waive']);
        Route::delete('/quality/adjustments/{id}', [TeacherAdjustmentController::class, 'destroy']);
        Route::post('/quality/teachers/{id}/adjustments', [TeacherAdjustmentController::class, 'store']);

        // The teacher's own window onto everything above. Self-scoped in the controllers (RLS pins
        // the academy, not the person) — a pay document has to be readable by whoever it pays.
        Route::get('/me/quality-reports', [QualityReportController::class, 'mine']);
        Route::get('/me/quality-reports/{id}', [QualityReportController::class, 'mineShow']);
        Route::get('/me/adjustments', [TeacherAdjustmentController::class, 'mine']);
    });

    // Video classroom (docs/video-platform). Plan-gated by entitled:video.conferencing (402 on a
    // miss); each operation is capability-gated in the controller via Gate::authorize (403), and
    // every row is tenant-scoped by RLS. The academy owns the room (V-CTL-1): owners create/manage,
    // teachers join; recordings are on-demand (V-REC-1) and the token endpoint mints a scoped JWT.
    Route::middleware('entitled:video.conferencing')->group(function () {
        Route::get('/video/rooms', [VideoRoomController::class, 'index']);
        // Live occupancy across the academy's rooms (polled by the classroom panel). MUST precede the
        // `/video/rooms/{id}` routes below so "presence" isn't captured as a room id.
        Route::get('/video/rooms/presence', [VideoRoomController::class, 'presence']);
        Route::post('/video/rooms', [VideoRoomController::class, 'store']);
        Route::get('/video/recordings', [VideoRecordingController::class, 'index']);
        Route::get('/video/recordings/{id}/url', [VideoRecordingController::class, 'url']);
        Route::delete('/video/recordings/{id}', [VideoRecordingController::class, 'destroy']);
        Route::get('/video/rooms/{id}', [VideoRoomController::class, 'show']);
        Route::get('/video/rooms/{id}/logs', [VideoRoomController::class, 'logs']);
        Route::patch('/video/rooms/{id}', [VideoRoomController::class, 'update']);
        Route::delete('/video/rooms/{id}', [VideoRoomController::class, 'destroy']);
        Route::post('/video/rooms/{id}/token', [VideoRoomController::class, 'token']);
        Route::post('/video/rooms/{id}/rotate-link', [VideoRoomController::class, 'rotate']);
        Route::post('/video/rooms/{id}/recording', [VideoRecordingController::class, 'start']);
        Route::delete('/video/rooms/{id}/recording', [VideoRecordingController::class, 'stop']);
        // Host moderation (room.manage) — server-mediated SFU admin actions.
        Route::post('/video/rooms/{id}/participants/{identity}/mute', [VideoModerationController::class, 'mute']);
        Route::post('/video/rooms/{id}/participants/{identity}/mute-video', [VideoModerationController::class, 'muteVideo']);
        Route::post('/video/rooms/{id}/participants/{identity}/remove', [VideoModerationController::class, 'remove']);
        Route::post('/video/rooms/{id}/end', [VideoModerationController::class, 'end']);
    });
});
