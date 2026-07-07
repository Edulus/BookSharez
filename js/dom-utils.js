// Tiny DOM-adjacent helpers shared across modules. Kept dependency-free so it
// can be imported from both directions (e.g. main.js and book-render.js)
// without creating a circular import.

// Vanilla JS has no auto-escaping; escape user text before putting it in HTML.
export function escapeHTML(value) {
  const div = document.createElement("div");
  div.textContent = value == null ? "" : String(value);
  return div.innerHTML;
}
