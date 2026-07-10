// Static regression checks for public cached Hardcover enrichment and safe login convenience.
const fs = require("fs");
const html = fs.readFileSync("index.html", "utf8");
const main = fs.readFileSync("js/main.js", "utf8");

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}`);
  if (!condition) failures++;
}

check("public cache reads books directly", /function fetchPublicCachedEnrichment[\s\S]*?\.from\("books"\)/.test(main));
check("public cache includes Hardcover slug", /hc_series_pos, hc_slug, hc_book_category, hc_enriched_at/.test(main));
check("fresh public cache returns before auth check", main.indexOf("cacheAge < 30") < main.indexOf("auth.getSession()"));
check("anonymous visitors cannot trigger external refresh", /if \(!session\) return cached/.test(main));
check("failed refresh falls back to public cache", /resp\.error \|\| !resp\.data\?\.enriched\) return cached/.test(main));
check("email advertises username autocomplete", /id="email"[\s\S]*?autocomplete="username"/.test(html));
check("password advertises current-password autocomplete", /id="password"[\s\S]*?autocomplete="current-password"/.test(html));
check("only email is remembered locally", /localStorage\.setItem\("booksharez:login-email", email\)/.test(main));
check("password is never stored locally", !/localStorage\.setItem\([^\n]*password/i.test(main));

if (failures) process.exit(1);
console.log("\nAll public enrichment/login checks passed.");
