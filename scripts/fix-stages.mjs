import fs from "node:fs";
const md = fs.readFileSync("C:/Users/INTEL/Desktop/DHARWIN NEW/docs/superpowers/plans/2026-08-13-pms-build1-phases-2-6.md","utf8");
const start = md.indexOf("`shared/stages.js` — replace the whole file:");
console.log("start", start);
// also try ascii hyphen variants
const alts = [
  "`shared/stages.js` — replace",
  "`shared/stages.js` - replace",
  "`shared/stages.js` – replace",
];
for (const a of alts) console.log(a, md.indexOf(a));
const idx = md.indexOf("export const STAGES = Object.freeze([");
console.log("STAGES at", idx);
// walk back to fence
let fenceStart = md.lastIndexOf("```js", idx);
let fenceEnd = md.indexOf("```", idx);
console.log("fence", fenceStart, fenceEnd);
const code = md.slice(fenceStart + 5, fenceEnd).replace(/^\n/, "");
console.log("code lines", code.split("\n").length, "chars", code.length);
fs.writeFileSync("shared/stages.js", code.endsWith("\n")?code:code+"\n");
console.log(code.slice(0,200));
console.log("...");
console.log(code.slice(-200));