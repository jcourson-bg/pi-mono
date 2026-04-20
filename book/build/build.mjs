import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { marked } from "marked";

const here = dirname(fileURLToPath(import.meta.url));
const bookRoot = join(here, "..");
const chaptersDir = join(bookRoot, "chapters");
const appendixDir = join(bookRoot, "appendix");

marked.use({
  mangle: false,
  headerIds: false,
});

const chapters = readdirSync(chaptersDir)
  .filter((f) => f.endsWith(".md"))
  .sort();

const appendices = readdirSync(appendixDir)
  .filter((f) => f.endsWith(".md"))
  .sort();

const parts = [
  { label: "Part I", title: "Foundations", at: 1 },
  { label: "Part II", title: "The four foundation packages", at: 4 },
  { label: "Part III", title: "Cross-cutting design", at: 8 },
  { label: "Part IV", title: "The ecosystem", at: 15 },
  { label: "Part V", title: "Going further", at: 18 },
];

function chapterNumberOf(filename) {
  const m = filename.match(/^(\d+)-/);
  return m ? parseInt(m[1], 10) : -1;
}

function titleFromMarkdown(md) {
  const line = md.split("\n").find((l) => l.startsWith("# "));
  if (!line) return "";
  return line.replace(/^#\s*/, "").replace(/^\d+\.\s*/, "").trim();
}

// Drop the first H1 from each chapter since we'll render our own chapter header.
function stripFirstH1(md) {
  const lines = md.split("\n");
  const idx = lines.findIndex((l) => l.startsWith("# "));
  if (idx < 0) return md;
  return lines.slice(idx + 1).join("\n").replace(/^\s+/, "");
}

// Build TOC first
const tocEntries = [];
for (const f of chapters) {
  const n = chapterNumberOf(f);
  const md = readFileSync(join(chaptersDir, f), "utf8");
  const title = titleFromMarkdown(md);
  tocEntries.push({ kind: "ch", n, title });
}
for (const f of appendices) {
  const md = readFileSync(join(appendixDir, f), "utf8");
  const line = md.split("\n").find((l) => l.startsWith("# ")) ?? "";
  const label = line.replace(/^#\s*/, "").trim();
  tocEntries.push({ kind: "app", label });
}

// --- HTML assembly ---
const css = readFileSync(join(here, "style.css"), "utf8");

let out = "";
out += `<!doctype html><html lang="en"><head><meta charset="utf-8">`;
out += `<title>Inside pi-mono</title>`;
out += `<style>${css}</style></head><body>`;

// Cover
out += `<section class="cover">
  <div class="eyebrow">An architecture walkthrough</div>
  <h1 class="title">Inside<br/>pi-mono</h1>
  <div class="subtitle">Architecture, design decisions, and little bits
    of intuition you might not know about the internals.</div>
  <div class="meta">
    <strong>Companion to</strong> github.com/badlogic/pi-mono<br/>
    Written from a deep read of the source, April 2026.
  </div>
</section>`;

// TOC
out += `<section class="toc"><h1>Contents</h1>`;
let partIdx = 0;
for (const entry of tocEntries) {
  if (entry.kind === "ch") {
    while (partIdx < parts.length && parts[partIdx].at === entry.n) {
      out += `<div class="toc-part">${parts[partIdx].label} · ${parts[partIdx].title}</div>`;
      partIdx++;
    }
    const numStr = entry.n === 0 ? "—" : String(entry.n).padStart(2, "0");
    const name = entry.n === 0 ? "Preface" : entry.title;
    out += `<li class="toc-ch"><span class="num">${numStr}</span><span class="name">${name}</span></li>`;
  } else {
    // app
    out += `<li class="toc-app"><span class="num" style="width:14mm">—</span><span class="name">${entry.label}</span></li>`;
  }
}
out += `</section>`;

// Render chapters with part dividers
partIdx = 0;
for (const f of chapters) {
  const n = chapterNumberOf(f);
  while (partIdx < parts.length && parts[partIdx].at === n) {
    const p = parts[partIdx];
    out += `<section class="part"><div class="label">${p.label}</div><h2 class="title">${p.title}</h2></section>`;
    partIdx++;
  }
  const md = readFileSync(join(chaptersDir, f), "utf8");
  const title = titleFromMarkdown(md);
  const body = stripFirstH1(md);
  const chapterLabel = n === 0 ? "Preface" : `Chapter ${n}`;

  out += `<section class="chapter">`;
  out += `<h1><span style="display:block;font-family:'JetBrains Mono',monospace;font-size:9pt;letter-spacing:4pt;color:#6b7389;text-transform:uppercase;margin-bottom:3mm;font-weight:400;">${chapterLabel}</span>${title}</h1>`;
  out += marked.parse(body);
  out += `</section>`;
}

// Appendix divider
out += `<section class="part"><div class="label">Appendix</div><h2 class="title">Reference</h2></section>`;

// Appendices
for (const f of appendices) {
  const md = readFileSync(join(appendixDir, f), "utf8");
  const line = md.split("\n").find((l) => l.startsWith("# ")) ?? "";
  const title = line.replace(/^#\s*/, "").trim();
  const body = stripFirstH1(md);

  out += `<section class="chapter appendix">`;
  out += `<h1>${title}</h1>`;
  out += marked.parse(body);
  out += `</section>`;
}

out += `</body></html>`;

const outPath = join(here, "book.html");
writeFileSync(outPath, out);
console.log("wrote", outPath, `(${(out.length / 1024).toFixed(1)} KB)`);
