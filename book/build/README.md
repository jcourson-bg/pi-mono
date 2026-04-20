# Book PDF build

The PDF is rendered from the Markdown chapters in `../chapters/` and
`../appendix/` via Chromium print-to-PDF.

## Output

`inside-pi-mono.pdf` — the book. A4, ~130 pages.

## Rebuild

```bash
npm install
node build.mjs     # chapters/*.md → book.html (applies style.css)
node render-pdf.mjs  # book.html → inside-pi-mono.pdf
```

`build.mjs` uses [marked](https://marked.js.org/) to convert
Markdown and emits a single `book.html` with a cover page, TOC, part
dividers, and chapter headers.

`render-pdf.mjs` uses Playwright's `page.pdf()` with
`preferCSSPageSize: true` so the `@page` rules in `style.css` drive
page size, margins, and the page-number footer.

The sandbox here points the browser at
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`. Remove that
line to use the default Chromium you have installed.
