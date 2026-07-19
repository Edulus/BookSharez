# Launch Readiness — Gate Checklist

**Date:** July 11, 2026 (Quick Wins 1–4 completed same day — see status table)
**Status:** Authoritative. Supersedes the July 10 planning-session draft (root `LAUNCH_READINESS.md`, deleted).
**Verification basis:** every condition below was checked against the actual repo and live site on July 11, 2026 — code inspection, the verify-*.js harness suite (15 harnesses), [CHANGELOG.md](../CHANGELOG.md), [ToDo.md](../ToDo.md), and [FOR_YOU_TO_DO.md](../FOR_YOU_TO_DO.md). Where a condition is marked met, the evidence is cited. Where it isn't, it is a **launch gate**.

**Context:** the site is already publicly deployed at <https://edulus.github.io/BookSharez/> (July 8). "Launch" here means the deliberate public launch (marketing push, real users transacting), not first deployment.

Legend: ✅ met · 🟡 partially met (gate = the remaining slice) · 🔴 not started (full gate)

---

## Summary

| # | Gate | Status | What remains |
|---|------|--------|--------------|
| 0 | Remove the fake purchase flow | ✅ | Fixed July 11 (Quick Win 1) |
| 1 | Transactions + fee collection | 🔴 | Full build (payment provider, checkout, fee model) |
| 2 | Shipping with label printing | 🔴 | Full build; depends on #1 |
| 3 | Phone barcode/cover capture | 🟡 | Real-device camera test + 1 SQL apply |
| 4 | Auth & account security | 🟡 | 4 Supabase dashboard settings/applies + live reset test |
| 5 | Listing flow E2E on real devices | 🟡 | One authenticated smoke session on real iOS + Android |
| 6 | Legal & compliance live | 🟡 | Pages + 18+ checkbox shipped July 11 (Quick Wins 2–3) — placeholders need real values + a legal glance |
| 7 | Payment failure paths | 🔴 | Design alongside #1, not after |
| 8 | Error handling & fallbacks | ✅ | (1 SQL apply as residual, non-gating) |
| 9 | Moderation & reporting | 🟡 | 2 SQL applies + live report test |
| 10 | Production infrastructure | 🟡 | **URGENT July 19: project paused** — restore + Pro upgrade + daily backups |

The cheap gates (#3, #4, #5, #9, and most of #10) are dominated by the already-scripted **pending Supabase applies and dashboard settings** in [FOR_YOU_TO_DO.md](../FOR_YOU_TO_DO.md). The expensive gates (#1, #2, #7) are one interdependent payments cluster, plus #6 which must precede it.

---

## 0. Immediate: remove the fake purchase flow ✅ FIXED July 11

**Not in the draft — found during this audit, fixed same day.** `buyBook()` ([js/main.js:2566-2572](../js/main.js#L2566-L2572)) previously told a real visitor *"Purchase successful! You will receive shipping information via email"* on Buy Now, with no transaction and no email — a live trust problem. Replaced with an honest interim message directing the buyer to contact the seller shown on the listing, until #1 ships. Verified: no harness referenced the old string; an ad-hoc Playwright smoke check confirmed the new dialog text and that no purchase claim is made.

---

## 1. Transactions + fee collection 🔴 (founder condition)

**Current state — verified:** zero payment code exists in the repo (searched for Stripe/checkout/payment across `index.html`, `js/`, `supabase/`). The only artifact is the visual-only Buy Now above.

**Scope note:** [PHASE_1_MVP_SPEC.md](PHASE_1_MVP_SPEC.md) and [PHASE_1_OPERATIONS.md](PHASE_1_OPERATIONS.md) define Phase 1 launch as campus-local pickup with **no payments** (Stripe explicitly Phase 3). This founder condition redefines launch to include Phase-3 scope. That is the founder's call and this checklist adopts it — but the Phase 1 spec's ADR should be updated to record the decision, and it's worth stating the alternative once: everything *except* #1/#2/#7 is close to done, so a soft launch (local-pickup marketplace) is available months earlier if ever wanted.

**Gate — remaining work:**
- Decide payment provider (Stripe is the documented assumption) and fee model (percentage, who pays, when collected).
- Checkout flow, payment Edge Function(s) (keys server-side only, per the security rules in [CLAUDE.md](../CLAUDE.md)), order/transaction table + RLS, seller payout mechanics.
- #6 (legal) and #7 (failure paths) are prerequisites/co-requisites — see sequencing at the end.

## 2. Shipping with label printing 🔴 (founder condition)

**Current state — verified:** no shipping code exists. Same Phase-3 scope note as #1.

**Gate — remaining work:**
- Depends on #1: a label needs a paid order and a buyer address; collecting addresses obligates the privacy policy (#6).
- Decide label provider (EasyPost/Shippo class), address collection UI, label generation + printable output, shipping cost model (who pays, flat vs. calculated).

## 3. Phone barcode/cover capture 🟡 (founder condition)

**The draft's flag was right: this is mostly built.** Verified in code and harnesses:

- **Four capture paths** in [js/scanner.js](../js/scanner.js): live camera (rear-facing `facingMode: "environment"`, native `BarcodeDetector` with html5-qrcode fallback), barcode-from-photo (Quagga2 fallback), cover-photo vision OCR (`vision-extract` Edge Function, deployed), and manual ISBN.
- **Batch capture UX** (the core loop): modal stays open, success flash, per-day session chip, camera auto-restart, Add & List exit, loop metrics.
- **Verified by:** [verify-batchscan.js](../verify-batchscan.js) (63 checks at 390×844), [verify-mobile.js](../verify-mobile.js) (360/390/414 px ergonomics, ≥44 px tap targets), [verify-vision.js](../verify-vision.js), and [verify-production.js](../verify-production.js) (live site, phone viewport: scanner modal + all four capture paths reachable).

**Gate — remaining work:**
1. **Real-device camera test** — headless Playwright cannot verify real camera acquisition/re-acquisition. The exact scripts exist: [MOBILE_CORE_LOOP_AUDIT.md](MOBILE_CORE_LOOP_AUDIT.md) §"Required manual phone test" (iOS Safari + Android Chrome) and FOR_YOU_TO_DO item 8. One session closes this and most of #5.
2. **Apply [db/books_isbn_nullable.sql](../db/books_isbn_nullable.sql)** (ToDo 14 / FOR_YOU_TO_DO 1) — until applied, cover-captured books without ISBNs fail to save on the live site.

## 4. Auth & account security 🟡

**Met and verified:**
- Signup, login, logout, and the full password-reset flow (`handleForgotPassword` → `PASSWORD_RECOVERY` → new-password modal → `updateUser`) are built; reset UX is covered by [verify-security.js](../verify-security.js) (20 checks), including neutral "if an account exists" messaging.
- **Cross-user access control is live-verified**: [verify-rls-live.js](../verify-rls-live.js) probes the production project with the anon key (anon INSERT books → 401; anon UPDATE/DELETE books and UPDATE listings → 0 rows; anon INSERT notifications → rejected — all passing), and [db/rls_test.sql](../db/rls_test.sql) passed 8/8 in Supabase.
- Client already handles both email-confirmation modes ([js/main.js:1233-1241](../js/main.js#L1233-L1241)): shows "check your email to confirm" when confirmation is on.

**Gate — remaining work** (all Supabase dashboard items, already listed in FOR_YOU_TO_DO):
1. **Enable email confirmation + leaked-password protection** (FOR_YOU_TO_DO "Pre-launch"). Today confirmation appears to be off — signup logs users straight in.
2. **Auth URL configuration** (FOR_YOU_TO_DO 7): Site URL + redirect allowlist for the production domain, then a **live end-to-end password reset** from the deployed site.
3. **Apply [db/books_rls_harden.sql](../db/books_rls_harden.sql)** (ToDo 15), then rerun `node verify-rls-live.js`.
4. Review the Supabase auth email templates (FOR_YOU_TO_DO "Pre-launch").

## 5. Core listing flow verified on real devices 🟡

**Met and verified (everything short of real hardware):** scan/ISBN → condition → AI price → photos → publish is green in [verify-bookflow.js](../verify-bookflow.js), [verify-batchscan.js](../verify-batchscan.js), and [verify-mobile.js](../verify-mobile.js) (phone viewports); [verify-production.js](../verify-production.js) smoke-tests the live site's logged-out surfaces at a phone viewport.

**Gate — remaining work:** the authenticated production smoke test on a **real iPhone (Safari) and a real Android (Chrome)** — the checklist is FOR_YOU_TO_DO item 8 (login → scan → shelf add → Add & List → photos → publish → report → reset). This is the same session as #3's device test; plan them together. Watch points are documented in [MOBILE_CORE_LOOP_AUDIT.md](MOBILE_CORE_LOOP_AUDIT.md) (iOS camera re-acquisition delay is the known risk).

## 6. Legal & compliance live 🟡

**Shipped July 11 (Quick Wins 2–3):**
- **Terms of Service and Privacy Policy pages** are live at `#/terms` and `#/privacy` ([index.html](../index.html), new `termsPage`/`privacyPage` divs; routing wired in [js/router.js](../js/router.js) and [js/main.js](../js/main.js) `showTerms()`/`showPrivacy()`/`backFromLegal()`, following the existing page-toggle + hash-routing convention), linked from the site footer, content drawn from the existing [PHASE_1_OPERATIONS.md](PHASE_1_OPERATIONS.md) templates.
- **18+ self-declaration checkbox** added to signup ([index.html](../index.html) `#signupAgeConfirm`, `required`), blocks submission (native HTML5 validation, same pattern as the existing password fields) until checked; on success the confirmation is stored in the user's Supabase auth metadata (`age_confirmed_18: true`) via `signUp({ options: { data } } )` in `handleSignup()` ([js/main.js](../js/main.js)) — no schema change needed.
- Verified: `node verify-routing.js`, `verify-mobile.js`, and `verify-security.js` all still pass unchanged (no regression); an ad-hoc Playwright smoke check confirmed the checkbox blocks signup when unchecked, the metadata is sent, and both legal pages render, link from the footer, and deep-link correctly.

**Gate — remaining work (narrow):**
1. **Placeholders need real values** — both pages carry clearly-marked `[PLACEHOLDER]` text for effective date, governing-law state, and the `legal@`/`privacy@` contact inboxes (confirm those inboxes actually exist before launch).
2. **A human legal glance is advisable** before real launch — these are the pre-existing operations-doc templates, not a vetted contract.
3. **Sequencing:** must be revised before #1 collects money or #2 collects addresses — the Privacy Policy needs a new section for payment data, addresses, and the payment processor as a data recipient.

## 7. Payment failure paths 🔴

**Confirmed as scoped — the draft's framing is correct** (failure paths are the risk), with one adjustment: this is not a separate later gate but a **design constraint on #1**. Refund flow, failed-payment handling, disputes, and fee-collected-but-transaction-failed cases should be designed into the transaction model from the start (state machine, not bolt-on). A manual dispute-resolution process sketch already exists in [PHASE_1_OPERATIONS.md](PHASE_1_OPERATIONS.md) §"Dispute Resolution" to build from. Blocked by #1 by definition.

## 8. Error handling & fallbacks ✅ MET

Verified in code — this gate is already satisfied:

- **ISBN lookup fallback:** Edge Function (6 s timeout) → Open Library (5 s) → Google Books (5 s) in [js/api-lookup.js](../js/api-lookup.js); buyer-side search falls back Google Books → Open Library on any 429/error. Matches [ERROR_HANDLING_PATTERNS.md](ERROR_HANDLING_PATTERNS.md).
- **Price suggestion fallback:** Edge Function failure is caught and falls back to the condition-multiplier algorithm ([js/main.js:1582-1602](../js/main.js#L1582-L1602)); the user is told whether the number came from AI or the fallback.
- **Photo upload failure:** the listing is created first, photos second — a failed upload never loses the listing; the user sees "Book listed, but some photos didn't upload. You can edit the listing later." ([js/main.js:1801-1809](../js/main.js#L1801-L1809)). Rollback of orphaned uploads is coded ([verify-storage-cleanup.js](../verify-storage-cleanup.js)).

**Residual (non-gating):** apply [db/listing_photo_cleanup.sql](../db/listing_photo_cleanup.sql) (ToDo 18) so the coded Storage cleanup/rollback deletes actually execute.

## 9. Moderation & reporting 🟡

**Built and verified, not yet live:**
- Report buttons on listings, profiles, and discussion posts feed one shared modal → INSERT-only `reports` table with a snapshot JSONB (actionable even if the subject is later edited/deleted) and duplicate-report handling. Covered by [verify-security.js](../verify-security.js).
- **Removal path exists and matches the draft's "founder-only moderation is acceptable":** review queries ship inside [db/reports.sql](../db/reports.sql); listings have a `removed` status; removal/ban actions run via the Supabase dashboard (service role). The moderation strategy, prohibited-content list, and SLA are documented in [PHASE_1_OPERATIONS.md](PHASE_1_OPERATIONS.md) §"Content Moderation Strategy".

**Gate — remaining work:**
1. **Apply [db/reports.sql](../db/reports.sql)** (ToDo 16 / FOR_YOU_TO_DO 3) — until then, Report buttons degrade to "try again later" and no reports are captured.
2. Live test: submit a report against another user's listing, confirm the row via `SELECT * FROM reports;`.
3. **Apply [db/remove_seed_data.sql](../db/remove_seed_data.sql)** (ToDo 17 / FOR_YOU_TO_DO 6) — demo seller + 6 fake listings are live in production now; a marketplace launch with fake inventory undercuts the trust the moderation system exists to protect.

## 10. Production infrastructure 🟡

**Met and verified:**
- **Secrets:** all billing-exposed keys (Google Books, DeepSeek, Hardcover, Gemini, optional ISBNdb) live only in Supabase Edge Function secrets; client files carry only `SUPABASE_URL` + the RLS-protected publishable key. Enforced by a pre-commit hook (blocks `AIzaSy…`/`sk-…`/service-role patterns) and gitleaks on every push ([.github/workflows/secret-scan.yml](../.github/workflows/secret-scan.yml)).
- **HTTPS:** enforced by GitHub Pages on the production domain.

**⚠️ Auto-pause mitigation FAILED — July 19 update:** the project **was paused on July 19** despite the keep-alive workflow ([.github/workflows/keep-alive.yml](../.github/workflows/keep-alive.yml)) running green every 3 days — its 200-status REST `SELECT`s on July 13 and 16 landed inside the 7-day inactivity window and Supabase's pause detection did not count them as activity. Diagnosis confirmed the workflow itself was correct (on `main`, scheduled runs fired, current key, real DB query, status-checked); the failure is in what Supabase counts as activity. Full report in [CHANGELOG.md](../CHANGELOG.md) (July 19). **Decision (founder-accepted, July 19): upgrade to Pro now rather than at launch.**

**Gate — remaining work** (now urgent, in FOR_YOU_TO_DO "Do FIRST"):
1. **Restore the paused project** (manual dashboard step) — everything else, including the pending SQL applies, is blocked until this happens.
2. **Upgrade Supabase to Pro** — Pro never auto-pauses; then delete the keep-alive workflow (obsolete, and proven insufficient on Free).
3. **Enable daily database backups** — comes with Pro; the sharpest infrastructure gap.

---

## Sequencing

**Track A — close the cheap gates now** (mostly dashboard work already scripted in [FOR_YOU_TO_DO.md](../FOR_YOU_TO_DO.md)):
1. ~~Fix the fake Buy Now (#0)~~ — done July 11.
2. Apply the pending SQL batch in the documented order (FOR_YOU_TO_DO 1–6) → closes the gates in #3, #4, #8-residual, #9.
3. Supabase settings: auth URLs, email confirmation, leaked-password protection, Pro + backups (#4, #10).
4. ~~Publish legal pages + 18+ checkbox (#6)~~ — done July 11; remaining: fill in the placeholders (date/governing law/contact emails) and a legal glance.
5. One real-device session: iPhone Safari + Android Chrome, capture loop + full listing flow (#3, #5).

Completing Track A makes the product launch-ready **as a local-pickup marketplace** — every gate except the payments cluster.

**Track B — the payments cluster** (the heavy lift; sequence deliberately):
1. #6 must be live first (it's in Track A — pages are live; finish the placeholders before money/addresses are collected).
2. #1 transactions, with #7's failure paths designed into the transaction model from day one — provider choice, fee model, order state machine including refund/dispute/fell-through states.
3. #2 shipping + labels, which needs #1's paid orders and addresses; revise the Privacy Policy for the new data.
4. ~~Update PHASE_1_MVP_SPEC.md's ADR~~ — done July 11: a "Launch Scope Note" now records that launch scope includes payments/shipping (formerly Phase 3) and points back to this doc.

---

## Quick Wins — completed July 11, 2026

The subset of remaining gate work that was code/documentation only — no
Supabase dashboard access, no real devices, no spending decisions. All four
done same day; see gates #0 and #6 above for the current state and residual
placeholders.

1. ✅ **Fixed the fake "Purchase successful" alert (#0).** `buyBook()` now tells
   the buyer to contact the seller directly instead of falsely confirming a
   purchase.
2. ✅ **Added the 18+ confirmation checkbox to signup (part of #6).** Required,
   blocks submission until checked; the confirmation is stored in Supabase auth
   user metadata on signup.
3. ✅ **Published Terms of Service + Privacy Policy pages (#6).** Live at
   `#/terms` / `#/privacy`, linked from the footer, content from the existing
   PHASE_1_OPERATIONS.md templates. Effective date, governing-law state, and
   contact-email placeholders are still marked `[PLACEHOLDER]` — need real
   values from the founder, plus a legal glance, before real launch.
4. ✅ **Recorded the payments-in-launch decision in the spec ADR (#1).**
   [PHASE_1_MVP_SPEC.md](PHASE_1_MVP_SPEC.md) now has a dated "Launch Scope
   Note" so the docs no longer contradict each other about payments/shipping.

**Still not quick wins** (out of code/docs reach): every Supabase SQL apply +
dashboard setting (FOR_YOU_TO_DO 1–7), the Pro upgrade and daily backups
(billing — #10), real-device camera/listing testing (physical phones — #3,
#5), and the payments/shipping/failure-path builds (#1, #2, #7 — large, and
gated on provider/fee decisions).

---

## Changes from the July 10 draft

- **Added #0** (fake purchase alert) — found during verification; urgent because the site is already live.
- **#3 confirmed near-done** as the draft suspected; gate narrowed to real-device testing + one SQL apply.
- **#8 marked met** — all three fallback chains verified in code; only a non-gating SQL apply remains.
- **#4, #5, #9, #10 narrowed** from "build/verify" to specific, already-scripted dashboard/SQL/manual-test items.
- **#6 downgraded in effort** (not in necessity): full ToS/Privacy/age-gate templates already exist in PHASE_1_OPERATIONS.md; the work is publishing, not drafting.
- **#7 reframed** as a design constraint on #1 rather than a separate later workstream.
- **Scope conflict surfaced:** founder conditions #1/#2 pull Phase-3 scope into the launch gate, contradicting the Phase 1 spec's launch definition. Adopted per founder decision; spec ADR update queued in Track B.
