# Appendix A — Glossary

Terms that come up repeatedly in pi-mono, in one place.

### Agent

A class (`pi-agent-core`) that orchestrates a loop of LLM calls and
tool executions. Holds mutable state: messages, tools, model,
streaming status, pending tool calls, queues.

### AgentMessage

A union of `UserMessage`, `AssistantMessage`, `ToolResultMessage`,
and custom message types. The entries in an agent's conversation
history.

### AgentSession

pi-coding-agent's session wrapper. Extends `Agent` with
session-specific concerns: JSONL persistence, compaction triggers,
custom message support, tool registry.

### AgentSessionRuntime

Owner of the services bound to a working directory: session
manager, auth storage, extensions, tools, cwd. Torn down and rebuilt
on `/switch` or `/fork`.

### agentLoop, agentLoopContinue

Two lower-level entry points in pi-agent-core. `agentLoop` takes new
user messages; `agentLoopContinue` resumes without a new message
(used for retrying after tool errors or aborts).

### Api

A provider's API identifier — `"anthropic-messages"`,
`"openai-completions"`, etc. Multiple providers can share an API
(e.g., many OpenAI-compatible providers use `"openai-completions"`).

### AssistantMessageEvent

The discriminated union of streaming events emitted by pi-ai. Types
include `start`, `text_delta`, `toolcall_delta`, `thinking_delta`,
`done`, `error`.

### AssistantMessageEventStream

An `EventStream` of `AssistantMessageEvent`s returned by pi-ai's
`stream()`.

### Backpressure

The property of a stream consumer slowing down the producer. In
pi-mono, `agentLoop` does not apply backpressure (producer keeps
going regardless of consumer speed); the `Agent` class does (awaits
all subscribers before advancing).

### beforeToolCall, afterToolCall

Hooks in pi-agent-core's `AgentLoopConfig`. `beforeToolCall` is a
permission gate that can block execution; `afterToolCall` can
replace a tool's result.

### Branch (session)

A path from the session's root entry to a leaf, defined by
following `parentId` pointers. Forking creates a new leaf with a
different `parentId`.

### Compaction

Summarizing old messages and inserting a `compaction` entry into
the session tree, so future LLM calls see the summary in place of
the old history.

### Context

pi-ai's `{ systemPrompt?, messages, tools? }` — the full state
needed to make an LLM call. Intentionally mutable; accumulates
over turns.

### CSI 2026

ANSI escape sequence (`\x1b[?2026h`) that tells the terminal to
render atomically instead of showing intermediate state. pi-tui
wraps every render in it.

### Custom message

A JSONL session entry of type `custom_message` written by
extensions. Arbitrary content; rendered by registered renderers.

### Differential rendering

pi-tui's strategy of diffing rendered line arrays and emitting only
the changed lines.

### EventStream

A generic queue+promise hybrid (`packages/ai/src/utils/event-
stream.ts`). Every streaming layer in pi-mono uses one.

### Extension

A TypeScript file loaded at startup from `~/.pi/extensions/` or
`./.pi/extensions/`. Runs in-process with no sandbox. Can register
tools, commands, shortcuts, providers, renderers, event handlers.

### Faux provider

The test harness in `packages/coding-agent/test/suite/harness.ts`
that stands in for pi-ai, producing deterministic scripted event
streams so tests run without real API keys.

### /fork

Command that creates a new session file branching from the current
entry. Original session is untouched; new session has its own JSONL
file and genealogy link.

### Hook (before / after)

See `beforeToolCall` / `afterToolCall`.

### JSONL

Line-delimited JSON. pi-mono uses it for session files, log files,
pi-ai test fixtures, and the Hugging Face published sessions.

### jiti

A TypeScript runtime loader (`@mariozechner/jiti`). Used by
pi-coding-agent to import extensions without a compile step.

### Kitty keyboard protocol

An extended keyboard reporting protocol supported by Kitty,
Ghostty, WezTerm, and others. pi-tui queries for it on startup
with a 150 ms timeout before falling back to xterm modifyOtherKeys
mode 2.

### KnownProvider

pi-ai's type listing supported providers by name — `"anthropic"`,
`"openai"`, etc.

### Leaf

The entry at the tip of the current session branch. Where new
entries get appended as children.

### Lockstep versioning

pi-mono's release policy: every package always shares the same
version number.

### MCP

Model Context Protocol. External tool-server protocol. **Not built
in to pi.** Implemented as an extension.

### MEMORY.md

A file in a workspace that gets appended to the system prompt.
Used for "always remember this" facts. Agents can read and write
to their own MEMORY.md.

### Mode

How pi-coding-agent is I/O-configured: `interactive`, `print`,
`json`, or `rpc`.

### Overflow (context)

LLM error meaning the request was too big for the context window.
pi-ai detects it via regex patterns; pi-coding-agent triggers
compaction to recover.

### partial-json

The npm package used by `parseStreamingJson()` to parse incomplete
JSON during tool-call streaming.

### proper-lockfile

The npm package used by pi-coding-agent to serialize concurrent
writes to session files and auth storage.

### RPC mode

JSON-RPC over stdin/stdout. Used by IDE extensions and pi-mom (when
not embedded).

### Session

pi-coding-agent's conversation state, persisted as a JSONL file.

### SKILL.md

A Markdown file with frontmatter describing a named prompt template
that can be invoked via `/skill:name`. Stateless; not executable.

### Steering queue

Messages the user sends while the agent is already running. Drained
between turns. Mode `"all"` or `"one-at-a-time"`.

### Streaming JSON

Parsing not-yet-complete JSON during tool-call deltas. See
`parseStreamingJson()`.

### TSchema

TypeBox schema type (`@sinclair/typebox`). Used everywhere pi-mono
describes a tool's input.

### Thinking level

Controls extended-thinking behavior: `"off"`, `"minimal"`, `"low"`,
`"medium"`, `"high"`, `"xhigh"`. Provider-specific semantics; not
all providers support all levels.

### Tool

In pi-ai: `{ name, description, parameters: TSchema }`. In
pi-agent-core: `AgentTool` extends `Tool` with `label`,
`prepareArguments?`, `execute`.

### tsgo

TypeScript's native Go-port compiler. Used across pi-mono instead
of `tsc` for speed.

### Turn

One LLM call and whatever tool executions it triggers. Marked by
`turn_start` / `turn_end` events.

### vLLM

An open-source LLM inference server. pi-pods deploys and manages
vLLM instances on remote GPUs.
