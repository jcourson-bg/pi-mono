# 16. pi-web-ui — agents in the browser

`packages/web-ui` is the one package in pi-mono that doesn't run in a
terminal. It's a library of [Lit](https://lit.dev) web components for
building chat-style agent UIs in a browser, plus a handful of
artifact renderers for PDFs, spreadsheets, Word documents, Markdown,
and sandboxed HTML.

It is unusually broad for a 5 k-LOC package because "a full agent UI"
has a lot of moving parts. This chapter tours what's there and how
it fits together.

## The component library

The default entry point is `ChatPanel` — a `LitElement` that
composes `AgentInterface` (the chat) and `ArtifactsPanel` (the
output renderer) into a two-pane layout.

From there, granular components are exported for apps that want
their own layout:

- `AgentInterface` — the chat scrollback, streaming message
  container, input editor.
- `MessageList` / `StreamingMessageContainer` — render an array of
  messages and a currently-streaming one.
- `MessageEditor` — the input component, with file attachment support.
- `ModelSelector`, `SettingsDialog`, `SessionListDialog`,
  `CustomProviderDialog`, `ApiKeyPromptDialog` — the modals.

And the artifact renderers:

- `HtmlArtifact` (via `SandboxedIframe`)
- `PdfArtifact` (via `pdfjs-dist`)
- `MarkdownArtifact`
- `ExcelArtifact` (via `xlsx`)
- `DocxArtifact` (via `docx-preview`)
- `SvgArtifact`, `ImageArtifact`

Peer dependency on `lit@^3.3.1`. An alternative lightweight path
exists via `@mariozechner/mini-lit`. The library ships unbundled ES
modules, so apps choose their bundler.

## Talking to the LLM from the browser

`AgentInterface` accepts an optional `session?: Agent`. Two
patterns:

1. **Bring your own `Agent`.** The host app creates an `Agent`
   (from pi-agent-core) and passes it in. Events flow from the agent
   into the component; user input from the component into the agent.
   The example app at `packages/web-ui/example/` does this.

2. **Provider-direct.** Without a session, the component uses
   pi-ai's `streamSimple` directly — in-browser `fetch` to provider
   APIs, with a proxy-bypass layer for CORS (`utils/proxy-utils.ts`).
   Credentials come from an in-browser IndexedDB-backed
   `ProviderKeysStore`.

The second pattern is how a static-hosted web app can be a full
agent UI with no backend. You paste an Anthropic API key, it goes
into IndexedDB, and from then on `fetch` calls go directly from the
user's browser to `api.anthropic.com`. Your host never sees the
messages.

Two things to note:

- The API key *is* in the browser. A malicious extension or
  compromised third-party script can steal it. Not for production
  apps handling sensitive data.
- Provider APIs don't always ship permissive CORS headers. The
  `proxy-utils` layer routes through a small proxy when needed —
  typically a Cloudflare Worker or similar that the deployer runs.

## The artifact system

An artifact is a piece of content the agent produces that isn't
chat — a generated HTML page, a calculated Excel sheet, a rendered
Markdown doc. The `ArtifactsPanel` shows a list of artifacts; each
has its own renderer.

The twist: **HTML artifacts run in a sandboxed iframe with a
postMessage bridge** (`SandboxedIframe.ts`, 600+ lines, the largest
file in the package). The iframe has `sandbox="allow-scripts"` but
not `allow-same-origin`, so its JS can run but it can't touch the
parent's DOM, cookies, or storage.

A message bridge exposes *runtime providers* to the iframe:

- `ArtifactsRuntimeProvider` — create/read/update other artifacts
  from inside the iframe.
- `AttachmentsRuntimeProvider` — access user-attached files.
- `ConsoleRuntimeProvider` — logging that surfaces in the host.
- `FileDownloadRuntimeProvider` — save a file to the user's disk.

This means the agent can generate rich interactive HTML — a
dashboard, a calculator, a visualization — and it runs in your
browser without seeing your credentials, your chat history, or your
other artifacts unless you explicitly expose them.

## Document rendering

The file-type artifacts each wrap a third-party library:

| format | library |
|---|---|
| PDF | `pdfjs-dist@5.4.394` — renders pages to canvas, paginates. |
| XLSX | `xlsx` (SheetJS) — parses and renders as an HTML table. |
| DOCX | `docx-preview@0.3.7` — renders into an HTML container. |
| Markdown | Native Lit template. |
| HTML/SVG | Sandboxed iframe. |
| Image | `<img>` with base64 data URL. |

The tool flow: the agent generates content, calls a tool like
`create_artifact` (provided by the example app), and the resulting
`custom_message` in the session causes the web UI to render it in
the artifacts panel.

## Persistence

Everything persists in IndexedDB:

- `SessionsStore` — the conversation history (mirrors the coding
  agent's JSONL on disk but in browser).
- `SettingsStore` — UI settings, theme, default model.
- `CustomProvidersStore` — user-added custom OpenAI-compatible
  providers (e.g., pointing at a local Ollama).
- `ProviderKeysStore` — API keys.

Sessions can be exported as a `.jsonl` file, imported into pi the
CLI, and vice versa. Same format.

## Build and output

The library itself uses plain `tsc` — no bundler. Output is
`dist/index.js`, `dist/index.d.ts`, and `dist/app.css` (Tailwind
v4). Consumers bundle it themselves.

The example app in `packages/web-ui/example/` uses Vite for a dev
server with HMR and a production build.

## Tool renderers

Each tool result type can have a custom renderer. The built-in
renderers:

- `BashRenderer` — syntax-highlighted terminal output.
- `DefaultRenderer` — fallback for any tool.
- `CalculateRenderer` — math output with MathJax.
- `GetCurrentTimeRenderer` — formatted time display.

Extensions register their own via `registerToolRenderer(name, fn)`.
Same mechanism as the TUI in the coding agent; the underlying
abstraction is shared.

## What pi-web-ui does not do

- It doesn't ship a server. The library is all client-side; any
  server-side concerns (auth, multi-tenancy, shared sessions) are
  the host app's problem.
- It doesn't implement tools. The `AgentInterface` takes tools as
  input; it doesn't define them. This is deliberate: the web UI and
  the CLI should share tool definitions when possible, but the
  library stays agnostic about which tools exist.

## In one paragraph

Web-ui is a Lit-based component library for building browser-side
agent chat UIs, with rich artifact rendering (HTML sandboxed, PDF /
XLSX / DOCX / Markdown / images native), IndexedDB persistence for
sessions and credentials, and a peer-dependency model so apps
choose their own Lit version and bundler. The headline feature is
sandboxed HTML artifacts with a postMessage runtime-provider bridge
— LLMs can generate rich interactive content that runs in the user's
browser without seeing anything else.

Next: pi-pods.
