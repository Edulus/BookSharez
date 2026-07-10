// Static regression checks for listing-photo lifecycle cleanup.
const fs = require("fs");

const main = fs.readFileSync("js/main.js", "utf8");
const migration = fs.readFileSync("db/listing_photo_cleanup.sql", "utf8");
const schema = fs.readFileSync("db/schema.sql", "utf8");

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}`);
  if (!condition) failures++;
}

const cleanup = main.match(/async function cleanupListingPhotos[\s\S]*?\r?\n}\r?\n/);
check("cleanup helper exists", Boolean(cleanup));
check("cleanup loads photo paths", cleanup && cleanup[0].includes('.select("photo_url")'));
check("cleanup removes Storage objects", cleanup && cleanup[0].includes('.remove(paths)'));
check("cleanup removes metadata rows", cleanup && cleanup[0].includes('.from("listing_photos")') && cleanup[0].includes('.delete()'));
check("mark-sold invokes cleanup", /async function markAsSold[\s\S]*?cleanupListingPhotos\(listingId\)/.test(main));
check("delete cleans before deleting listing", /async function deleteListing[\s\S]*?cleanupListingPhotos\(listingId\)[\s\S]*?\.from\("listings"\)[\s\S]*?\.delete\(\)/.test(main));
check("failed metadata insert rolls back upload", /if \(rowErr\)[\s\S]*?\.remove\(\[path\]\)/.test(main));

for (const [label, sql] of [["migration", migration], ["baseline schema", schema]]) {
  check(`${label}: metadata DELETE policy`, /ON listing_photos FOR DELETE/.test(sql));
  check(`${label}: Storage DELETE policy`, /ON storage\.objects FOR DELETE/.test(sql));
  check(`${label}: policy is owner-scoped`, /listings\.user_id = auth\.uid\(\)/.test(sql));
}

if (failures) {
  console.error(`\n${failures} storage-cleanup check(s) failed.`);
  process.exit(1);
}
console.log("\nAll storage-cleanup checks passed.");
