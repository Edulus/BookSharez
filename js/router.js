// ---------------------------------------------------------------------------
// Hash routing (extracted from main.js July 4 — improvement plan §5.2)
// ---------------------------------------------------------------------------
// Pages remain display-toggled divs (no framework); this module is the single
// mapping between location.hash and the page functions, giving shareable
// URLs, working back/forward, and refresh that stays on the page.
//
//   #/                      homepage (browse)
//   #/listing/<id>          single-listing detail page
//   #/book/<bookId>         unified book page
//   #/profile/<userId>      public profile
//   #/dashboard[/<tab>]     dashboard (login required)
//
// main.js wires the page functions in via initRouter(pages) — the router
// never imports page code, so there is no circular dependency. Page functions
// *record* their route via setRoute() when invoked directly (clicks); the
// hashchange listener *applies* routes on back/forward and direct link loads.
// _routeWrites suppresses the echo event that our own hash writes produce, so
// navigation never double-renders.

let _routeWrites = 0; // pending hashchange events caused by setRoute itself
let _initialRouteApplied = false;
let _pages = null; // { home, listing, book, profile, dashboard }

export function initRouter(pages) {
  _pages = pages;
  window.addEventListener("hashchange", () => {
    if (_routeWrites > 0) {
      _routeWrites--;
      return;
    }
    _applyRoute();
  });
}

// replace=true rewrites the current history entry instead of pushing a new
// one (used for within-page changes like dashboard tabs, so the back button
// leaves the page rather than replaying every tab). replaceState fires no
// hashchange event, so it needs no _routeWrites guard.
export function setRoute(hash, replace = false) {
  // "" (no hash at all) and "#/" both mean the homepage; writing "#/" over an
  // empty hash would push a phantom history entry and wipe the forward stack.
  const current = location.hash === "" || location.hash === "#" ? "#/" : location.hash;
  if (current === hash) return;
  if (replace) {
    history.replaceState(null, "", hash);
    return;
  }
  _routeWrites++;
  location.hash = hash;
}

// Called once by main.js after the first auth state is known, so a direct
// link to #/dashboard works when a session is restored (and the logged-out
// homepage reset doesn't clobber a public deep link).
export function applyInitialRoute() {
  if (_initialRouteApplied) return;
  _initialRouteApplied = true;
  if (location.hash && location.hash !== "#/") _applyRoute();
}

function _applyRoute() {
  const parts = location.hash
    .replace(/^#\/?/, "")
    .split("/")
    .filter(Boolean)
    .map(decodeURIComponent);
  const [page, arg] = parts;
  if (page === "listing" && arg) _pages.listing(arg);
  else if (page === "book" && arg) _pages.book(arg);
  else if (page === "profile" && arg) _pages.profile(arg);
  else if (page === "dashboard") _pages.dashboard(arg);
  else _pages.home(); // "", "#/" and anything unrecognized
}
