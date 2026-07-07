# Mobile Core Loop Audit — Batch Scanner

**Date:** July 7, 2026  
**Viewport target:** 360–414 px wide phones  
**Scope:** Dashboard → Scan a Book → capture/confirm/add → repeat

## Result

Batch capture is implemented as a dashboard-scanner enhancement:

- Adding a scanned book no longer closes the scanner modal.
- A non-blocking success toast replaces the old blocking `alert()` path.
- A per-calendar-day counter shows progress in the scanner header.
- Duplicate shelf adds are surfaced honestly and do not increment the counter.
- The shelf refreshes in the background after each add.
- Manual ISBN lookup inside the scanner is now defined and routed through the same detection path.

## Mobile layout adjustments

The enhancement injects mobile-only CSS for `max-width: 414px`:

- Scanner modal uses nearly the full phone width with a small edge gutter.
- Modal body height is capped to avoid content falling below the viewport.
- Close control gets a 44×44 px touch target.
- Scanner action buttons are at least 50 px tall.
- Manual ISBN input stacks above its button on narrow screens.
- Form inputs use 16 px font size to avoid iOS Safari zoom-on-focus.
- Dashboard tabs become horizontal-scrollable instead of wrapping into a cramped block.
- Shelf cards are slightly narrowed so two columns fit comfortably on common phones.
- Live camera viewfinder gets a phone-sized height cap.

## Verification harness

`verify-batchscan.js` covers the headless-verifiable pieces at a 390×844 viewport:

1. Batch enhancement loads.
2. Counter starts at zero.
3. First add keeps the modal open.
4. Success toast appears without a blocking dialog.
5. Counter increments.
6. Second add increments again.
7. Duplicate add does not increment.
8. Counter persists after close/reopen.
9. `scannerManualLookup()` exists.
10. No browser dialogs are triggered by the batch-add path.

## Required manual phone test

Headless Playwright cannot verify real camera re-acquisition. Test this by hand:

### iOS Safari

1. Log in on a real iPhone.
2. Open Dashboard → **Scan a Book to Add to Shelf**.
3. Tap **Use Live Camera**.
4. Scan a book barcode.
5. Tap **Books I Have**.
6. Confirm the modal stays open, the green toast appears, and the live viewfinder returns automatically.
7. Scan a second book without closing/reopening the modal.
8. Confirm the counter reads `2 books added today`.

### Android Chrome

Repeat the same sequence. Expected result: the camera should restart more smoothly than iOS Safari.

## Watch points

- iOS Safari may show a permission/re-acquisition delay after the first add.
- If camera restart fails, photo/manual capture still returns to the capture-choice screen.
- If a duplicate is scanned, the user should see an honest duplicate notice and the counter must not increment.
