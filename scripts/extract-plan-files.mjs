import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const plans = process.argv.slice(2);

// Only full-file writes: line starts with `path`:
const FILE_HINT = /^`((?:shared|backend|frontend|\.env\.example)[^`]*?)`:\s*\n\s*```(?:js|jsx|javascript|json|dotenv|bash|ts|tsx|css|text|env|html|diff)?\n([\s\S]*?)```/gm;

const seen = new Map(); // rel -> {content, len}
for (const planPath of plans) {
  const md = fs.readFileSync(planPath, "utf8");
  let m;
  FILE_HINT.lastIndex = 0;
  while ((m = FILE_HINT.exec(md)) !== null) {
    let rel = m[1].trim();
    if (!rel || /[\n ]/.test(rel) || rel.endsWith("/") || rel.includes("*")) continue;
    if (!/\.(js|jsx|json|mjs|css|md|example)$/.test(rel) && rel !== ".env.example") continue;
    const content = m[2].replace(/\r\n/g, "\n");
    const prev = seen.get(rel);
    // Prefer longest full-file write (partial later snippets are shorter)
    if (!prev || content.length >= prev.len) {
      seen.set(rel, { content, len: content.length });
    }
  }
}

let written = 0;
for (const [rel, { content }] of seen) {
  const abs = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content.endsWith("\n") ? content : content + "\n", "utf8");
  written += 1;
  console.log("W", String(content.length).padStart(5), rel);
}
console.log("Wrote " + written + " unique files (longest full-file wins)");