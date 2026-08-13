import fs from "node:fs";
const md = fs.readFileSync("C:/Users/INTEL/Desktop/DHARWIN NEW/docs/superpowers/plans/2026-08-13-pms-build1-foundation-auth.md","utf8");
const m = md.match(/`\.env\.example`:\s*\n\s*```(?:dotenv|env)?\n([\s\S]*?)```/);
if (!m) { console.log("no match"); process.exit(1); }
fs.writeFileSync(".env.example", m[1].endsWith("\n") ? m[1] : m[1] + "\n");
console.log("wrote", m[1].length);