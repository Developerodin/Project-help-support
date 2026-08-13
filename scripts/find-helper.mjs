import fs from "node:fs";
import path from "node:path";
const md = fs.readFileSync("C:/Users/INTEL/Desktop/DHARWIN NEW/docs/superpowers/plans/2026-08-13-pms-build1-foundation-auth.md","utf8");
const re = /`([^`]+\.js)`:\s*\n\s*```js\n([\s\S]*?)```/g;
let m; const want = ["memoryDb", "helpers"];
while ((m = re.exec(md)) !== null) {
  if (m[1].includes("memoryDb") || m[1].includes("helpers/")) {
    console.log("FOUND", m[1], "len", m[1].length, m[2].length);
    const abs = path.join(process.cwd(), m[1]);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, m[2].endsWith("\n")?m[2]:m[2]+"\n");
  }
}
// Also search for withMemoryDb definition
const i = md.indexOf("withMemoryDb");
console.log("first withMemoryDb at", i);
console.log(md.slice(i-200, i+400));