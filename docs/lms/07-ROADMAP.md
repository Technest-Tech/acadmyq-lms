# 07 — Roadmap

Four phases, each an independently shippable slice. The sequence front-loads a **complete, useful
product** (phases 1–2: branded course sites with code-unlocked YouTube/audio/PDF courses) and defers
the two heavy sub-systems — uploaded-video VOD and quizzes — to the end.

---

## Phase 1 — Module + course builder  *(in progress)*

Stand up `LMS` as a real, sellable module and let staff build courses from the cheap content types.

**Backend**
- `2026_07_22_000001_lms_module_code.php` — widen `module` check to include `LMS`.
- `2026_07_22_000002_lms_courses.php` — `courses, course_sections, lessons, lesson_attachments,
  media_assets` + RLS.
- `2026_07_22_000003_seed_lms_permissions.php` — `course.read/manage, access_code.manage, learner.read`.
- `2026_07_22_000004_seed_lms_plan.php` — `LMS_BASIC` plan.
- Edits: `ModuleBilling::MODULES`, `FeatureCatalog` (capability + limits), `PermissionCatalog`
  (codes + roleMap), `Entitlement::resolveFromModules` (LMS union).
- `App\Http\Controllers\Lms\CourseController` (+ Section/Lesson) — CRUD, publish, reorder; gated
  `entitled:lms` + `can:course.*`.

**Frontend**
- `(app)/courses` — list + course editor + lesson editor for `YOUTUBE / AUDIO / PDF / TEXT`.
- Sidebar item gated on the `lms` entitlement.

**Acceptance**
- Super Admin enables LMS for a client in the clients hub; the client's bill includes the LMS line.
- Owner creates a course with YouTube/PDF/text lessons and publishes it.
- A client with no LMS entitlement gets 402 on `/api/courses/*` and no sidebar item.
- Pausing the LMS sub drops `lms` from the academy's capabilities; other modules unaffected.

---

## Phase 2 — Learners, codes & the public site

The first end-to-end product: a branded per-academy site where students sign up, redeem a code, and
watch.

**Backend**
- `learners` table + `learner` auth guard + `/api/learn/auth/*`.
- `academies.lms_subdomain` + `resolve.academy` middleware.
- `access_codes, access_code_courses, code_redemptions, enrollments, lesson_progress` + controllers
  (`CodeController`, `RedemptionController`, `EnrollmentController`, learner `CatalogController` /
  `PlayerController`).
- Batch code generation + CSV export; redemption with row-locked cap enforcement.

**Frontend**
- `apps/web/src/middleware.ts` subdomain routing → `(learn)` group.
- Learner site: landing/catalog, course detail, register/login, `/redeem`, player (phase-1 lesson
  types), `/me`, progress + resume.
- Dashboard: `/courses/codes`, `/courses/learners`, `/courses/settings` (subdomain + branding).

**Acceptance**
- `<academy>.<platform>` serves that academy's catalog; an unknown subdomain 404s.
- Learner registers, redeems a single-use code once (second attempt refused), watches, resumes.
- Enrollment gates the player; `is_preview` lessons are watchable un-enrolled.

---

## Phase 3 — Uploaded-video VOD

Add `VIDEO_UPLOAD` lessons: direct-to-storage upload → transcode → HLS playback.

**Backend**
- Presigned upload URL endpoint; `media_assets` lifecycle; ffmpeg transcode worker (reuses
  `infra/video` storage/CDN); signed short-TTL playback URLs behind the enrollment check.
- `maxStorageGb` enforcement via summed `media_assets.size_bytes`.

**Frontend**
- Upload UI with transcode-progress (`media_assets.status`); `hls.js` adaptive player.

**Acceptance**
- Owner uploads a video; it transcodes to READY; an enrolled learner streams it; storage counts
  against the plan cap; at-limit upload returns an upgrade prompt.

---

## Phase 4 — Quizzes, assignments & certificates

**Backend**
- `quizzes, quiz_questions, quiz_options, quiz_attempts, quiz_answers`, `course_certificates`.
- Server-side grading; certificate issuance on completion (reuse `certificate.*` where possible).

**Frontend**
- Quiz builder (dashboard) + quiz runner (learner) + certificate view/print.

**Acceptance**
- Owner authors a quiz; learner passes → lesson completes; finishing the course issues a certificate
  with a verifiable serial.

---

## Phase 5 — Orders, checkout & manual payments  *(done)*

Turn the site from "ask us for a code" into a shop. Full spec:
[10-ORDERS-CHECKOUT-AND-PAYMENTS.md](10-ORDERS-CHECKOUT-AND-PAYMENTS.md).

**Backend**
- `2026_09_08_000001_lms_orders_and_payments.php` — `lms_payment_methods, course_orders,
  course_order_receipts, course_order_counters, learner_notifications, learner_password_resets` +
  RLS, `courses.checkout_enabled / code_enabled`, `enrollments.source_order_id`, and
  `app.next_course_order_number()`.
- `2026_09_08_000002_seed_lms_sales_permissions.php` — `course_order.read/manage,
  payment_method.manage` (owner-only; also added to `PermissionCatalog::FINANCIAL`, so a SUPERVISOR
  never sees the money).
- `2026_09_08_000003_automation_send_log_learner.php` — the send log learns `LEARNER` / `LMS`.
- `App\Services\Lms\CourseOrders` — the state machine, and the ONE writer of `course_orders.status`.
- Learner: `CheckoutController`, `NotificationController`, `PasswordResetController`.
- Staff: `Lms\OrderController` (queue, summary, decisions, private receipt stream),
  `Lms\PaymentMethodController` (receiving accounts + currency).

**Frontend**
- Dashboard: `/lms/sales` (queue + review drawer + Excel export), `/lms/payments` (receiving
  accounts), per-course channel toggles in the course editor, a pending-receipts sidebar badge.
- Learner site: Buy CTA, `/checkout/<slug>`, `/orders`, `/orders/<number>`, `/legal/{terms,refund,
  privacy}`, `/forgot-password`, `/reset-password`, an orders entry in the account menu.
- Marketing: `/course-platform`, the sales page for the module itself.

**Acceptance**
- A learner buys a course, uploads an InstaPay receipt, and the client's approval enrolls them in the
  same transaction — no codes anywhere in the flow.
- A rejected receipt shows the client's reason verbatim and accepts a corrected upload.
- A course with `checkout_enabled` off shows no Buy button; with `code_enabled` off, a code minted
  earlier stops working.
- The Buy button never appears while the client has no active payment method.
- `course_orders_one_open_idx` makes a duplicate pending order impossible, not merely unlikely.

---

## Cross-cutting

- **Tests**, per phase, mirroring the API test suite (mind the `plan_id ⇒ PRO` gotcha:
  entitled routes 402 unless the test academy is seeded with an LMS-granting plan).
- **Audit**: course publish, code generation, enrollment revoke, learner block → `audit_log`.
- **i18n**: en/ar keys for both surfaces; learner site RTL-aware.
- **Docs**: keep this set current as the phases land (it is the module's source of truth).
