import fs from "node:fs";
const md = fs.readFileSync("C:/Users/INTEL/Desktop/DHARWIN NEW/docs/superpowers/plans/2026-08-13-pms-build1-foundation-auth.md", "utf8");
const needle = "backend/src/platform/__tests__/config.test.js";
const i = md.indexOf(needle);
console.log("index", i);
const slice = md.slice(i - 5, i + needle.length + 40);
console.log(JSON.stringify(slice));
console.log([...slice].map(c => c.charCodeAt(0)).join(","));
// find all occurrences of path followed by colon pattern
const re = /`([^`]+?\.(?:js|jsx|json))`:/g;
let m, n=0;
while ((m = re.exec(md)) !== null) {
  n++;
  if (n <= 15) console.log("path:", m[1]);
}
console.log("path:colon count", n);