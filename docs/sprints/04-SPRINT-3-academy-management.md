# Sprint 3 — Academy & Academy-Type Management (Super Admin)

> **Status:** Detailed / Ready to execute
> **Depends on:** Sprint 1 (academies, academy_types, plans, report_field_definitions schema), Sprint 2 (Super Admin auth, enter/exit academy, Gates/`Gate::authorize`, audit)
> **Blocks:** Sprint 4 (you cannot add people without an academy to put them in), and every later sprint that operates within an academy
> **References:** Master Spec §2 (business model), §5.6 (custom report fields), §5.10 (branding), §6.1 (tenancy); Sprint 1 §6.1 (academies/plans/academy_types), §6.4 (report_field_definitions); Sprint 2 §4.4 (enter academy), §5 (RBAC)

---

## 1. Goal

Give the Super Admin everything needed to **onboard and configure an academy** end to end: create the academy, assign its type and plan, set currency/timezone/invoice-grouping, seed its first Owner login, and define its custom session-report fields. By the end of this sprint you can sit at the Super Admin panel and produce a fully configured, ready-to-populate "Noor Al-Qur'an Academy" — the thing every later sprint needs to exist before it can do anything.

The deliverable is judged on: *can the Super Admin create a brand-new academy, configure it correctly (type, plan, currency, timezone, grouping, report fields, first owner), and can that owner then log in and see a correctly configured but empty academy?*

## 2. Scope

### In scope
- **Academy CRUD** (Super Admin): create, edit, suspend/reactivate. No hard delete (academies are never destroyed; they are `SUSPENDED`).
- **Academy Type** selection and management: a small catalog (Qur'an, and the structure to add more), and the per-type **report-field template** that pre-fills a new academy's `report_field_definitions`.
- **Plan assignment**: pick the academy's tier (BASIC/PRO); plan/add-on catalog management (CRUD on `plans`/`add_ons`).
- **Academy configuration**: `default_currency`, `timezone` (IANA), `invoice_grouping` (PER_GUARDIAN / PER_STUDENT), `billing_day`.
- **First Owner provisioning**: create the academy's first Academy Owner — a `users` row (no/placeholder password) + `user_roles(ACADEMY_OWNER)` — so the owner can log in. (Minimal: Super Admin sets email; the owner receives a Laravel set-password link via a signed/`password_reset_tokens` URL. Full invite flows remain post-MVP per Sprint 2 scope.)
- **Report-field configuration UI** at academy scope: the Super Admin (and later the Owner via `report_field.manage`) can add/edit/reorder/deactivate the custom report fields that the attendance screen (Sprint 6) will render. Seeded from the academy-type template, then editable.
- **Reserved branding fields** (R-BRA-1): expose form inputs for `brand_display_name`, `brand_logo_url`, `subdomain` and persist them — **stored but not yet surfaced** anywhere user-facing. Validate `subdomain` uniqueness/format now to avoid migration pain later (Sprint 12).
- **Platform view**: the Super Admin academy list (the audited `app.admin_list_academies()` from Sprint 1/2), with status, plan, currency, counts.
- Audit entries for `academy.create`, `academy.configure`, `academy.suspend`, `academy.reactivate`, `plan.manage`, `report_field.manage`, `user.invite` (owner creation), `role.assign`.

### Out of scope (deferred)
- Self-service academy signup (Sprint 13) — onboarding is Super-Admin-only here.
- Surfacing branding (logos/subdomains) in the UI or routing (Sprint 12) — fields are stored only.
- Per-plan **feature enforcement/gating** — selecting a plan is in scope; *enforcing* what each plan unlocks is Sprint 9. Here we store the plan; we do not yet block features by it.
- Payment for the academy's own subscription (platform billing/gateways) — post-MVP.
- People/teachers/students CRUD (Sprint 4) beyond the single first-owner provisioning.

---

## 3. Design decisions (locked for this sprint)

1. **Academies are never hard-deleted.** "Removing" an academy means `status = SUSPENDED`. Suspended academies' users cannot log in; data is retained. (Reactivation restores access.)
2. **Academy Type drives a *template*, not a constraint.** Choosing "Qur'an" pre-fills the new academy's `report_field_definitions` from the type template, but the academy can then edit them freely (R-CRF-1). The type is a starting point, not a lock — this is the generalization mechanism.
3. **Report-field definitions are tenant-scoped data** (Sprint 1 §6.4), created **per academy** at provisioning by copying the type template. Editing them later never touches other academies.
4. **First-owner provisioning is a deliberate, audited cross-tenant action.** The Super Admin creates a `users` row with `academy_id` = the new academy and role `ACADEMY_OWNER`. This runs through the explicit Super-Admin path (Sprint 2 §4.4), with the context (`Tenancy::withContext`) set to the new academy, and is audited.
5. **Branding fields validated now, surfaced later.** `subdomain` must be unique, lowercase, DNS-safe even though unused — so Sprint 12 is pure activation, no data cleanup.
6. **Currency and timezone are set once at creation, editable with care.** Changing `default_currency` after invoices exist is restricted (warn; does not retroactively change existing per-student currencies, which live on subscriptions). Timezone changes affect how future sessions render, not stored UTC instants.
7. **Plan selection is stored, not enforced here.** The `academy.plan_id` is set; gating logic is Sprint 9. This keeps Sprint 3 about configuration, not entitlement.

---

## 4. User flows

### 4.1 Create an academy (happy path)
```
Super Admin (platform view)
  → "New academy"
  → Step 1 Identity:  name, academy_type (Qur'an), default_currency (EGP), timezone (Africa/Cairo)
  → Step 2 Billing:   plan (PRO), invoice_grouping (PER_GUARDIAN), billing_day (1)
  → Step 3 Branding:  brand_display_name, logo URL, subdomain  (optional, reserved)
  → Step 4 Owner:     owner full name, email  (creates login)
  → Step 5 Review     → Create
System (in one DB transaction, context = new academy):
  - insert academies row (status ACTIVE or TRIAL)
  - copy academy_type report-field template → report_field_definitions (per academy)
  - create users row (placeholder password) + user_roles(ACADEMY_OWNER)
  - audit: academy.create, report_field.manage(seed), user.invite, role.assign
After commit (post-transaction side effect):
  - send the Laravel set-password link (password-reset notification) to the owner's email
  → Owner sets a password and can log in to a configured, empty academy.
```

### 4.2 Configure report fields
```
Academy detail → "Report fields"
  list (sortable by sort_order) of fields seeded from the Qur'an template:
    surah_from (TEXT), surah_to (TEXT), tajweed_rating (SELECT: ممتاز/جيد جداً/جيد),
    next_assignment (TEXT), notes (TEXTAREA)
  actions: add field, edit (label_ar/label_en/type/options/required), reorder, deactivate
  validation: key unique per academy; SELECT must have options; cannot delete a field
              that already has values — only deactivate (preserves Sprint 6 history)
```

### 4.3 Suspend / reactivate
```
Academy detail → Suspend  → confirm → status=SUSPENDED, audit; owner/teacher logins blocked
                → Reactivate → status=ACTIVE, audit; logins restored
```

---

## 5. Academy-type report-field templates

The catalog ships with at least the **Qur'an** template (matching the seed from Sprint 1 §9 and the prototype's attendance screen):

| key | label_ar | label_en | type | options | required |
|---|---|---|---|---|---|
| surah_from | من سورة / آية | From surah / ayah | TEXT | — | yes |
| surah_to | إلى سورة / آية | To surah / ayah | TEXT | — | yes |
| tajweed_rating | تقييم التجويد | Tajweed rating | SELECT | ممتاز, جيد جداً, جيد | no |
| next_assignment | الوِرد القادم | Next assignment | TEXT | — | no |
| notes | ملاحظات للأهل | Notes for family | TEXTAREA | — | no |

> A future "Languages" type would ship a different template (e.g. `level`, `vocabulary_count`, `homework`, `notes`). Adding a type = adding a catalog row + its template; **no code change** to the report engine. This is the concrete payoff of the generalized design.

Templates are stored as platform-level config attached to `academy_types` (a `report_field_template jsonb` column on `academy_types`, or a `academy_type_report_fields` catalog table — see §6).

---

## 6. Schema / Data deltas

Sprint 1 created the core tables. This sprint adds the **type template** storage and small refinements:

- **`academy_types.report_field_template`** `jsonb not null default '[]'` — the ordered list of field definitions a new academy of this type is seeded with. (Alternatively a normalized `academy_type_report_fields` table; jsonb chosen for simplicity since it is read once at provisioning.)
- **`academies.suspended_at`** `timestamptz null` and **`academies.suspended_reason`** `text null` — for audit/clarity on suspension.
- **`users` set-password support** — use Laravel's built-in password-reset (`password_reset_tokens` table, already present from Sprint 0) or a signed set-password URL; no extra auth schema needed. Track `users.invited_at timestamptz null`.
- Confirm `academies.subdomain` has a unique, format-checked constraint (lowercase DNS label); add a `check` if not already present.

A Laravel migration `..._academy_type_templates_and_suspension` (with `down()`): adds `report_field_template`, `suspended_at`, `suspended_reason`, `invited_at`, and the subdomain format check; a seeder seeds/updates the Qur'an template.

---

## 7. API surface

| Method & path | Permission | Purpose |
|---|---|---|
| `GET /api/admin/academies` | `academy.read` (SUPER_ADMIN) | List all academies (audited platform fn) |
| `POST /api/admin/academies` | `academy.create` | Create academy + seed report fields + first owner (transactional) |
| `GET /api/admin/academies/{id}` | `academy.read` | Academy detail + config |
| `PATCH /api/admin/academies/{id}` | `academy.configure` | Edit name, currency, timezone, grouping, billing_day, branding |
| `POST /api/admin/academies/{id}/suspend` | `academy.suspend` | Suspend (reason) |
| `POST /api/admin/academies/{id}/reactivate` | `academy.suspend` | Reactivate |
| `GET /api/admin/plans` `POST/PATCH /api/admin/plans/{id}` | `plan.manage` | Plan & add-on catalog CRUD |
| `GET /api/academies/{id}/report-fields` | `report_field.manage` | List report-field definitions |
| `POST /api/academies/{id}/report-fields` | `report_field.manage` | Add field |
| `PATCH /api/academies/{id}/report-fields/{fieldId}` | `report_field.manage` | Edit / reorder / deactivate |
| `POST /api/admin/academies/{id}/owner` | `user.invite` + `role.assign` | (Re)provision an owner login |

All run through `TenantContextMiddleware` (the new academy's context for tenant-scoped writes) and call `Gate::authorize`. Creation is a single DB transaction so a partial failure leaves no half-built academy.

## 8. Definition of Done / Acceptance Criteria

- **AC-3.1** Super Admin can create an academy via the wizard; on success the academy exists with the chosen type, plan, currency, timezone, and grouping.
- **AC-3.2** Creating a Qur'an academy seeds its `report_field_definitions` from the Qur'an template (5 fields, correct types/options/required), scoped to that academy only.
- **AC-3.3** The same flow provisions a first Academy Owner who can log in (after setting a password) and lands on their configured, empty academy (ties to Sprint 2 AC-2.1).
- **AC-3.4** Academy creation is **atomic**: if any step fails, no academy, report fields, or owner are left behind.
- **AC-3.5** Editing report fields (add/edit/reorder/deactivate) affects only that academy; a field with existing values cannot be deleted, only deactivated.
- **AC-3.6** Suspending an academy blocks its owner/teacher logins; reactivating restores them; data is retained throughout.
- **AC-3.7** Branding fields (`brand_display_name`, `brand_logo_url`, `subdomain`) persist; `subdomain` is validated unique + DNS-safe; nothing branding-related is surfaced in the UI yet.
- **AC-3.8** Plan selection is stored on the academy; no feature is gated by it yet (gating is Sprint 9).
- **AC-3.9** A non-Super-Admin cannot reach any `/admin/*` endpoint (403), and RLS prevents cross-academy effects of any of these operations.
- **AC-3.10** Every listed mutation writes the correct `audit_log` entry with actor, target academy, and before/after where applicable.
- **AC-3.11** Changing `default_currency` after subscriptions/invoices exist warns and does not retroactively alter existing per-student currencies or closed invoices.
- **AC-3.12** Adding a **new academy type** (catalog row + template) makes it selectable in the wizard and seeds its template — with **no code change** to the report engine.

## 9. Test Cases

> `TC-3.<n>`, mapped to ACs.

### Academy creation
- **TC-3.1** Create academy with valid inputs → 201; row has correct type, plan, currency='EGP', timezone='Africa/Cairo', grouping=PER_GUARDIAN. *(AC-3.1)*
- **TC-3.2** After creation, the academy has exactly the 5 Qur'an report fields with correct types; `tajweed_rating` is SELECT with the 3 options; `surah_from`/`surah_to` required. *(AC-3.2)*
- **TC-3.3** The seeded report fields carry the new academy's `academy_id` and are invisible to any other academy (RLS). *(AC-3.2, AC-3.9)*
- **TC-3.4** First owner is created with role ACADEMY_OWNER and academy_id = new academy; can log in after set-password and `GET /api/auth/me` returns the right academy. *(AC-3.3)*
- **TC-3.5** Force a failure mid-creation (e.g. duplicate owner email) → transaction rolls back; no academy, no report fields, no orphan user. *(AC-3.4)*
- **TC-3.6** Duplicate `subdomain` → creation rejected with a clear validation error. *(AC-3.7)*
- **TC-3.7** Invalid `subdomain` (uppercase, spaces, leading hyphen) → rejected by format check. *(AC-3.7)*
- **TC-3.8** Invalid timezone string (not an IANA name) → rejected. *(AC-3.1)*

### Report-field configuration
- **TC-3.9** Add a new field (key unique) → appears in list at the given sort_order. *(AC-3.5)*
- **TC-3.10** Add a SELECT field with no options → rejected. *(AC-3.5)*
- **TC-3.11** Add a field with a key that already exists for this academy → rejected (unique per academy). *(AC-3.5)*
- **TC-3.12** Reorder fields → `sort_order` updates; other academies unaffected. *(AC-3.5, AC-3.9)*
- **TC-3.13** Deactivate a field → it stops appearing for new reports but remains for history. *(AC-3.5)*
- **TC-3.14** Attempt to delete a field that already has session-report values (simulate one) → blocked; deactivate offered instead. *(AC-3.5)*

### Suspension lifecycle
- **TC-3.15** Suspend academy → status SUSPENDED, suspended_at/reason set; its owner's next login attempt is blocked. *(AC-3.6)*
- **TC-3.16** While suspended, the academy's data still exists (counts unchanged). *(AC-3.6)*
- **TC-3.17** Reactivate → status ACTIVE, login restored. *(AC-3.6)*
- **TC-3.18** There is no hard-delete endpoint for academies (verify route absence / 405). *(decision §3.1)*

### Authorization & isolation
- **TC-3.19** Academy Owner calls `POST /admin/academies` → 403. *(AC-3.9)*
- **TC-3.20** Teacher calls any `/admin/*` → 403. *(AC-3.9)*
- **TC-3.21** Super Admin creating Academy B while "in" Academy A does not write any row into Academy A (context correctly set to B). *(AC-3.9)*
- **TC-3.22** Owner of Academy A cannot edit Academy B's report fields (RLS + permission). *(AC-3.9)*

### Plan, currency, branding
- **TC-3.23** Selecting plan PRO stores `plan_id`; no feature is blocked/allowed differently yet (gating absent). *(AC-3.8)*
- **TC-3.24** Plan/add-on catalog CRUD works for Super Admin; Owner gets 403 on `plan.manage`. *(AC-3.8, AC-3.9)*
- **TC-3.25** Change `default_currency` after a subscription exists → warning returned; existing subscription currency unchanged; any closed invoice unchanged. *(AC-3.11)*
- **TC-3.26** Branding fields save and read back; no part of the app renders the logo/subdomain (reserved). *(AC-3.7)*

### Generalization (the key payoff)
- **TC-3.27** Insert a new academy_type "LANGUAGES" with a template (e.g. level/vocabulary/homework/notes) → it appears in the creation wizard. *(AC-3.12)*
- **TC-3.28** Create a LANGUAGES academy → it is seeded with the LANGUAGES fields, not the Qur'an ones; the attendance/report engine (consumed in Sprint 6) needs no code change to render them. *(AC-3.12)*

### Audit
- **TC-3.29** Each of create/configure/suspend/reactivate/plan.manage/report_field.manage/owner-provision writes a correctly-attributed audit entry. *(AC-3.10)*
- **TC-3.30** A configure change records before/after of the changed fields. *(AC-3.10)*

## 10. Risks & mitigations
- **Risk:** Partial creation leaving a half-built academy. **Mitigation:** the owner `users` row lives in the **same Postgres database** as the academy, so everything (academy, report fields, owner, roles) is created in **one DB transaction** — full rollback on any failure, no external auth system to orphan (a real simplification vs. the old Supabase-Auth design). The only post-commit step is sending the set-password email, which is a retriable side effect; if it fails, the owner can be re-provisioned via `POST .../owner` (idempotent). TC-3.5 targets the rollback.
- **Risk:** Editing report fields after Sprint 6 is live corrupts historical reports. **Mitigation:** deactivate-not-delete rule (TC-3.13/3.14); `values` jsonb keyed by stable `key` tolerates added/removed fields.
- **Risk:** Currency change creating inconsistent money. **Mitigation:** currency lives per-subscription and per-invoice (snapshotted); academy default is only a *default* for new entities; TC-3.25 verifies no retroactive change.
- **Risk:** Branding validation skipped now → painful Sprint 12 migration. **Mitigation:** enforce subdomain uniqueness/format now (TC-3.6/3.7).
- **Risk:** Adding a type secretly requiring code. **Mitigation:** template stored as data; TC-3.27/3.28 prove a new type needs no engine change.

## 11. Estimate
**Medium.** Mostly CRUD and forms. The owner is created in the same DB transaction as the academy (no external auth system, so the old orphaned-auth-user trap is gone — the set-password email is the only post-commit side effect). The part that still deserves care is the **report-field configuration UI** with its deactivate-not-delete and SELECT-options rules, since Sprint 6 depends on it being correct.

## 12. Handoffs to later sprints
- **Sprint 4** populates the academy created here with guardians, students, and teachers.
- **Sprint 6** renders and validates session reports against the `report_field_definitions` configured here (the deactivate-not-delete contract matters there).
- **Sprint 7** uses `invoice_grouping` and `billing_day` set here.
- **Sprint 9** adds **plan feature gating** on top of the `plan_id` stored here, and reads the audit entries this sprint produces.
- **Sprint 12** activates the branding fields validated and stored here (zero migration).
- **Sprint 13** replaces this manual onboarding with self-service signup, reusing the same provisioning transaction.
