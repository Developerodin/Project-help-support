import fs from "node:fs";
const md = fs.readFileSync("C:/Users/INTEL/Desktop/DHARWIN NEW/docs/superpowers/plans/2026-08-13-pms-build1-phases-2-6.md","utf8");
const i = md.indexOf("frontend/vitest.config.js");
console.log(md.slice(i, i+800));