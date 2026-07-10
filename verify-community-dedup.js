// Static regression checks for community shelf work-level deduplication.
const fs = require("fs");
const main = fs.readFileSync("js/main.js", "utf8");

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}`);
  if (!condition) failures++;
}

const helper = main.match(/function communityBookKey[\s\S]*?\n}\n/);
const loader = main.match(/async function loadCommunityShelfSection[\s\S]*?\n}\n/);
check("community identity helper exists", Boolean(helper));
check("ISBN is normalized for identity", helper && helper[0].includes('replace(/[^0-9X]/gi'));
check("title and author provide fallback identity", helper && helper[0].includes('`work:${title}|${author}`'));
check("community query loads ISBN", loader && loader[0].includes("id, isbn, title, author, cover_url"));
check("renderer deduplicates by community identity", loader && loader[0].includes("communityBookKey(entry)"));
check("deduplication happens before nine-card limit", loader && loader[0].indexOf("seen.has(key)") < loader[0].indexOf("unique.length >= 9"));

if (failures) process.exit(1);
console.log("\nAll community deduplication checks passed.");
