# Inside pi-mono

> Architecture, design decisions, and little bits of intuition you might not know about the internals.

A book-length walk through [`badlogic/pi-mono`](https://github.com/badlogic/pi-mono): the
repo behind `pi` (the coding agent), `pi-ai` (a unified LLM client),
`pi-agent-core` (a small, honest agent runtime), `pi-tui` (a terminal UI that
doesn't flicker), and a handful of satellites. The point of the book is not to
duplicate the READMEs; it is to explain why the code looks the way it does,
what surprised me while reading it, and the rules the codebase seems to follow
even when nobody wrote them down.

## Read it

- **[PDF](build/inside-pi-mono.pdf)** — clean typography, ~130 pages, A4.
- **Markdown** — the TOC below links to each chapter.

See [`build/README.md`](build/README.md) for how to rebuild the PDF.

## Table of contents

### Part I — Foundations

- [Preface](chapters/00-preface.md)
- [1. What pi-mono is](chapters/01-what-pi-mono-is.md)
- [2. The shape of the monorepo](chapters/02-monorepo-shape.md)
- [3. Design philosophy](chapters/03-design-philosophy.md)

### Part II — The four foundation packages

- [4. pi-ai — one API, many providers](chapters/04-pi-ai.md)
- [5. pi-agent-core — an agent is just a loop](chapters/05-pi-agent-core.md)
- [6. pi-tui — a terminal that doesn't flicker](chapters/06-pi-tui.md)
- [7. pi-coding-agent — the thing you actually run](chapters/07-pi-coding-agent.md)

### Part III — Cross-cutting design

- [8. Event streams and backpressure](chapters/08-events-and-backpressure.md)
- [9. Tool calling end-to-end](chapters/09-tool-calling.md)
- [10. Sessions as JSONL trees](chapters/10-sessions.md)
- [11. Context compaction](chapters/11-compaction.md)
- [12. Extensions: trust, lifecycle, API](chapters/12-extensions.md)
- [13. Auth, credentials, and OAuth](chapters/13-auth.md)
- [14. Three ways to run the agent](chapters/14-modes.md)

### Part IV — The ecosystem

- [15. pi-mom — the agent on Slack](chapters/15-pi-mom.md)
- [16. pi-web-ui — agents in the browser](chapters/16-pi-web-ui.md)
- [17. pi-pods — rolling your own vLLM](chapters/17-pi-pods.md)

### Part V — Going further

- [18. Adding a new LLM provider](chapters/18-adding-a-provider.md)
- [19. Testing agents with the faux provider](chapters/19-testing.md)
- [20. Release engineering](chapters/20-releases.md)

### Appendix

- [A. Glossary](appendix/a-glossary.md)
- [B. File map](appendix/b-file-map.md)
- [C. The rules pi-mono seems to follow](appendix/c-rules.md)

---

*Companion repo:* [pi-mono-video/](../pi-mono-video/) — the animated
architecture walkthrough, if you want the short visual version first.
