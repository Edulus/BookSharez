# For You To Do

**Updated:** July 19, 2026
**Derived from:** [ToDo.md](ToDo.md), the master backlog and status record

This file contains only active tasks that require the user's service-dashboard
access, a spending decision, or hands-on authenticated verification. Code work
and completed tasks belong in `ToDo.md` and `CHANGELOG.md`, not here. When an
item is completed, report the result so it can be recorded in the master files
and removed from this checklist.

## ⚠️ Do FIRST — the Supabase project is paused (July 19)

The project was auto-paused on July 19 despite the keep-alive workflow running
green every 3 days (HTTP 200 pings on July 13 and 16, inside the 7-day
inactivity window) — Supabase's pause detection did not count the pings as
activity. Diagnosis is in CHANGELOG.md (July 19); the accepted fix is the Pro
upgrade, which never auto-pauses. **Every "Do now" item below is blocked until
the project is restored.**

- [ ] Supabase Dashboard → project `kkmxdemnbuyuxnrezxmn` → **Restore project**
      (manual button; restore can take a few minutes).
- [ ] **Upgrade the project to Supabase Pro** (Settings → Billing). This is the
      accepted permanent fix and was already the pre-launch plan
      (LAUNCH_READINESS gate #10).
- [ ] **Enable daily backups** (comes with Pro) — the sharpest infra gap in the
      launch checklist.
- [ ] Tell Claude when Pro is live, so `.github/workflows/keep-alive.yml` can
      be deleted (it's obsolete on Pro and already proven insufficient on Free).

## Do now

Apply the database scripts in this order. Each script is safe to rerun after a
partial or completed application.

### 1. Allow books without ISBNs

- [ ] In Supabase → SQL Editor, run [db/books_isbn_nullable.sql](db/books_isbn_nullable.sql).
- [ ] Verify with an old barcode-less book: Read Book Cover → confirm candidate
      → Add & List for Sale → submit with the ISBN empty.

### 2. Harden catalog writes

- [ ] Run [db/books_rls_harden.sql](db/books_rls_harden.sql).
- [ ] Tell Codex after it succeeds; Codex can run `node verify-rls-live.js`.

### 3. Enable content reporting

- [ ] Run [db/reports.sql](db/reports.sql).
- [ ] Open another user's listing → Report this listing → select a reason →
      submit. Confirm the success message, then run `SELECT * FROM reports;`.

### 4. Enable notifications

- [ ] Run [db/notifications.sql](db/notifications.sql).
- [ ] As user A, add a book to Books I Want. As user B, list that book. Return
      as user A and confirm the bell badge appears and opens the listing.

### 5. Enable listing-photo cleanup

- [ ] Run [db/listing_photo_cleanup.sql](db/listing_photo_cleanup.sql). This
      lets the app remove private Storage objects when a listing is sold or
      deleted and roll back a photo whose metadata insert fails.
- [ ] Create a listing with photos, mark it sold, and confirm its Storage folder
      and `listing_photos` rows are gone. Repeat with a deleted listing.

### 6. Remove demo production data

- [ ] Run [db/remove_seed_data.sql](db/remove_seed_data.sql). Its first result
      previews real activity. The cleanup removes demo seller/listings and preserves
      any seed book referenced by a real listing, shelf entry, or discussion.
- [ ] Confirm the demo seller has no listings and browse no longer shows the
      six fake listings. A seed book may remain when real activity references it.

### 7. Configure Supabase authentication URLs

- [ ] Supabase → Authentication → URL Configuration:
  - Set Site URL to `https://edulus.github.io/BookSharez/`.
  - Add `https://edulus.github.io/BookSharez/` to Redirect URLs.
  - Add `http://localhost:7654` to Redirect URLs.
- [ ] From the live site, complete Forgot password end-to-end and confirm the
      email returns to the Set a New Password form on the live site.

### 8. Run the authenticated production smoke test

- [ ] Log in and confirm the dashboard shelves load.
- [ ] Scan or enter an ISBN → Books I Have; confirm the scanner stays open and
      its session count increases.
- [ ] Add & List for Sale; select condition, confirm the suggested price, add
      required photos, and publish the listing.
- [ ] Submit a report on someone else's listing (requires item 3).
- [ ] Complete the password-reset test (requires item 6).

## Optional

### 9. Cloudflare Web Analytics

- [ ] Cloudflare → Web Analytics → Add a site for `edulus.github.io`; copy the
      token and give it to Codex. Codex will update `index.html`, verify the
      change, and publish it when asked.
- [ ] Visit the live site and confirm the dashboard begins receiving traffic.

### 10. Remove old RLS test users

- [ ] Run the CLEANUP block at the bottom of [db/rls_test.sql](db/rls_test.sql).

## Pre-launch

> The Pro upgrade, daily backups, and keep-alive removal moved to the
> "Do FIRST" section above (July 19 pause incident).

- [ ] Enable email confirmation and leaked-password protection in Supabase.
- [ ] Review the Supabase authentication email templates.
