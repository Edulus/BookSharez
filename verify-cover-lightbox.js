// Static regression checks for the detail-page cover lightbox.
const fs = require("fs");
const html = fs.readFileSync("index.html", "utf8");
const css = fs.readFileSync("css/style.css", "utf8");
const main = fs.readFileSync("js/main.js", "utf8");
const renderer = fs.readFileSync("js/book-render.js", "utf8");

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}`);
  if (!condition) failures++;
}

check("accessible dialog markup exists", /id="coverLightbox"[\s\S]*?role="dialog"[\s\S]*?aria-modal="true"/.test(html));
check("large image remains viewport-contained", /max-width: min\(92vw, 1200px\)/.test(css) && /max-height: calc\(100vh - 7rem\)/.test(css));
check("Google Books requests larger cover", /searchParams\.set\("zoom", "3"\)/.test(main));
check("Open Library requests large cover", /replace\(\/-\[SM\]/.test(main));
check("failed high-resolution request falls back", /let triedFallback = false[\s\S]*?image\.src = src/.test(main));
check("backdrop and close button dismiss", /coverLightboxClose[\s\S]*?closeCoverLightbox/.test(main) && /event\.target\.id === "coverLightbox"/.test(main));
check("Escape dismisses", /event\.key === "Escape"[\s\S]*?closeCoverLightbox/.test(main));
check("listing detail cover is interactive", /openCoverLightbox: \(\) => \{\}/.test(renderer) && /_actions\.openCoverLightbox\(book\.coverUrl, book\.title\)/.test(renderer));
check("book detail cover is interactive", /cover\.onclick = book\.coverUrl \? \(\) => openCoverLightbox/.test(main));
check("keyboard activation supports Enter and Space", (main.match(/event\.key === "Enter" \|\| event\.key === " "/g) || []).length >= 1 && (renderer.match(/event\.key === "Enter" \|\| event\.key === " "/g) || []).length >= 1);

if (failures) process.exit(1);
console.log("\nAll cover lightbox checks passed.");
