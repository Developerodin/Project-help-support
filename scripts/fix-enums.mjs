import fs from "node:fs";
const md = fs.readFileSync("C:/Users/INTEL/Desktop/DHARWIN NEW/docs/superpowers/plans/2026-08-13-pms-build1-foundation-auth.md", "utf8");
const re = /`shared\/enums\.js`[^\n]*\n\n```js\n([\s\S]*?)```/;
const m = md.match(re);
if (!m) { console.log("no enums match"); process.exit(1); }
fs.writeFileSync("shared/enums.js", m[1].endsWith("\n") ? m[1] : m[1] + "\n");
console.log("enums lines", m[1].split("\n").length);
const idx = md.match(/`shared\/index\.js`:\n\n```js\n([\s\S]*?)```/g);
console.log("index blocks", idx && idx.length);