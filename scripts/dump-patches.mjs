import fs from "node:fs";

const plan = fs.readFileSync("C:/Users/INTEL/Desktop/DHARWIN NEW/docs/superpowers/plans/2026-08-13-pms-build1-phases-2-6.md", "utf8");
const lines = plan.split("\n");
const targets = [
  "backend/src/app.js",
  "backend/src/index.js",
  "backend/src/modules/auth/auth.service.js",
  "backend/src/modules/tickets/ticket.service.js",
  "backend/src/modules/tickets/ticket.route.js",
  "backend/src/modules/tickets/ticket.validation.js",
  "backend/src/modules/tickets/ticket.controller.js",
  "backend/package.json",
  "shared/enums.js",
  "shared/index.js",
  "shared/package.json",
];

for (const target of targets) {
  console.log("\n########## " + target + " ##########");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes("`" + target + "`")) continue;
    // print context + following fence if any
    const ctx = lines.slice(Math.max(0, i - 1), Math.min(lines.length, i + 3)).join("\n");
    if (/In `|Append to `|replace the whole|add the|pass `config`|import /.test(ctx) || line.trim().startsWith("`" + target + "`")) {
      console.log("--- line " + (i + 1) + " ---");
      console.log(lines.slice(i, Math.min(lines.length, i + 80)).join("\n").slice(0, 2500));
      console.log("--- end snippet ---");
    }
  }
}