// Static regression checks for the universal clickable-Book invariant.
const fs = require("fs");
const renderer = fs.readFileSync("js/book-render.js", "utf8");
const main = fs.readFileSync("js/main.js", "utf8");

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}`);
  if (!condition) failures++;
}

check("one shared interaction helper exists", /function _makeBookInteractive/.test(renderer));
check("canonical book page wins over listing context", renderer.indexOf("if (book.bookId)") < renderer.indexOf("if (context.myListingId)"));
check("external books still open a book page", /if \(book\.isbn \|\| book\.title\) return \(\) => _actions\.viewExternalBook\(book\)/.test(renderer));
check("tiles use shared interaction", /function _renderTile[\s\S]*?_makeBookInteractive\(card, book, context\)/.test(renderer));
check("thumbs use shared interaction", /function _renderThumb[\s\S]*?_makeBookInteractive\(item, book, context\)/.test(renderer));
check("books are keyboard reachable", /element\.tabIndex = 0/.test(renderer));
check("books expose link semantics and label", /setAttribute\("role", "link"\)/.test(renderer) && /View book:/.test(renderer));
check("Enter and Space activate books", /event\.key === "Enter" \|\| event\.key === " "/.test(renderer));
check("both profile shelf queries include canonical book id", (main.match(/books!inner\(id, isbn, title, author, cover_url\)/g) || []).length >= 2);
check("focus is visibly indicated", /book-thumb:focus-visible/.test(renderer) && /book-card:focus-visible/.test(renderer));

if (failures) process.exit(1);
console.log("\nAll clickable-Book invariant checks passed.");
