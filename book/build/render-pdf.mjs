import { chromium } from "playwright-core";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { statSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(here, "book.html");
const pdfPath = join(here, "inside-pi-mono.pdf");

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  headless: true,
  args: ["--no-sandbox"],
});

const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "networkidle" });

await page.emulateMedia({ media: "print" });

await page.pdf({
  path: pdfPath,
  format: "A4",
  printBackground: true,
  preferCSSPageSize: true,  // respect our @page rules
});

await browser.close();

const size = statSync(pdfPath).size;
console.log(`wrote ${pdfPath} (${(size / 1024 / 1024).toFixed(2)} MB)`);
