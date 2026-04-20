# 7. pi-coding-agent — the thing you actually run

This is the biggest package in the repo and the one that has your name
on it when you install the CLI as `pi`. It is also the one that ties
everything together: `pi-ai` for streams, `pi-agent-core` for the
loop, `pi-tui` for the terminal, and a lot of glue.

## The entry point

`src/cli.ts:8-17`:

```ts
process.title = "pi";
// disable some warnings, set undici proxy
await main(process.argv.slice(2));
```

That's it. `main()` lives in `src/main.ts` and is the actual
orchestrator. The chain is:

```
cli.ts  (set title, delegate)
   └─ main.ts
        ├─ parseArgs          (cli/args.ts)
        ├─ resolveAppMode     (interactive | print | json | rpc)
        ├─ createSessionManager
        ├─ createAgentSessionRuntime
        └─ runMode            (InteractiveMode / runPrintMode / runRpcMode)
```

## `parseArgs`

`cli/args.ts` handles a lot more than you'd think from the name. The
parser:

- Supports `@file` syntax for loading a prompt from a file (line 163).
- Validates thinking levels (lines 118-127).
- Accumulates **unknown flags** into a `Map<string, string>` (line
  47-48) — so extensions can define their own flags and read them from
  this map.
- Collects diagnostics as it goes (line 49), which the final output
  surfaces after startup completes.

Flags like `--model`, `--provider`, `--thinking` support compound
syntax. `--model claude-sonnet:high` is parsed as model
`claude-sonnet` with thinking `high`. The split happens later in
`model-resolver.ts:180-200`.

## Mode selection

`main.ts:97-108`'s `resolveAppMode()`:

- `--mode rpc` → **rpc mode** (JSON-RPC on stdin/stdout)
- `--mode json` → **json mode** (streams all events as JSONL on stdout)
- `--print`, or stdin is a pipe → **print mode** (one-shot, final text)
- Otherwise, stdin is a TTY → **interactive mode** (TUI)

The guard at `main.ts:451`: if mode isn't interactive and stdin isn't
a TTY, `takeOverStdout()` redirects `console.log` / `console.error` to
internal buffers. Extensions and tools that log to stdout would
otherwise corrupt the RPC protocol or the single-shot text output.
`restoreStdout()` at line 723 puts it back before exit.

## AgentSession and AgentSessionRuntime

There are two classes here and the distinction matters.

`AgentSession` (`src/core/agent-session.ts`) owns the **conversation
state**: the messages, the steering and follow-up queues, the
compaction state, the current tool registry. It inherits from the
`Agent` class in pi-agent-core and adds coding-agent-specific behavior.

`AgentSessionRuntime` (`src/core/agent-session-runtime.ts:54-126`)
owns the **services bound to a working directory**: the session
manager writing to a JSONL file, the auth storage, the extension
runner, the tools, the cwd itself. It's the thing that gets torn down
when you switch sessions.

Separating them means `/switch` and `/fork` have a clean lifecycle.
`switchSession()` (line 128) tears down the runtime's services,
closes the old session, and mounts a new one. Extensions get
`session_before_switch` and `session_before_fork` events before the
teardown so they can persist anything they need to (lines 83-111).

## The session file — JSONL all the way down

`src/core/session-manager.ts`. A session file is a sequence of line-
delimited JSON entries. The first line is the session header:

```json
{ "type": "session", "version": 3, "id": "abc123", "cwd": "/home/user/proj", "timestamp": "..." }
```

Then messages, thinking-level changes, compactions, and custom
entries, each with an `id` and `parentId`:

```json
{ "type": "message", "id": "msg1", "parentId": null, "message": { ... } }
{ "type": "message", "id": "msg2", "parentId": "msg1", "message": { ... } }
{ "type": "thinking_level_change", "id": "tlc1", "parentId": "msg2", "thinkingLevel": "high" }
{ "type": "compaction", "id": "cmp1", "parentId": "msg2", "summary": "...", "firstKeptEntryId": "msg2" }
{ "type": "custom_message", "id": "cm1", "parentId": "cmp1", "customType": "...", "content": "..." }
```

The file is **append-only**. A branch is just multiple entries that
share the same `parentId`. There are no "delete" entries; rolling back
means picking a different leaf. Chapter 10 pulls this apart further.

**Concurrency.** The session manager and the auth storage both use
`proper-lockfile` (`src/core/auth-storage.ts:62-87`,
`src/core/settings-manager.ts:152-177`), with 10 retries and 20 ms
delay. This matters because a user might run two `pi` instances in the
same project — lockfile acquisition prevents file corruption from
concurrent writes.

## Compaction

`src/core/compaction/compaction.ts` provides the pure summarization
logic; `AgentSession` orchestrates when to call it.

Trigger:

```
After each turn:
  tokens = calculateContextTokens(lastUsage) + estimate(trailingMessages)
  if tokens > contextWindow - reserveTokens:
    compact()
```

Estimation (compaction.ts:135-213): real usage when the model reported
it, falling back to a `chars / 4` heuristic for messages without usage
and a fixed `4800 tokens per image` for image content.

The summarization prompt (in `compaction/utils.ts`) is straightforward
and was tuned for the "technical decisions must survive" use case.
It's called via `completeSimple()`, not streaming, because we need to
know the final token count before continuing.

The tricky part is the **overflow recovery flag**
(`_overflowRecoveryAttempted`). If context overflow happens mid-turn,
the session attempts one compaction and retries. If the retry also
overflows, the agent emits an error instead of spinning forever. This
caps bad loops at two attempts.

Compaction entries land as children of the current leaf. Subsequent
messages are children of the compaction. When reconstructing the
conversation for the next LLM call, the tree walker emits: (1) the
compaction's summary text as a system or user message, (2) all
entries from `firstKeptEntryId` up to the compaction point, (3) all
entries after the compaction. No history is rewritten — compaction is
just another entry in the append-only log. Chapter 11 unpacks this in
detail.

## The four built-in tools

`src/core/tools/`. Each one is an `AgentTool` with a `parameters`
schema, a `label`, and an `execute`.

### `bash.ts`

Spawns the child with `detached: true` so it gets its own process group
(POSIX). Stdio is `["ignore", "pipe", "pipe"]` — stdin ignored to
prevent interactive commands from hanging, stdout/stderr captured.

Output streams incrementally via `onData` callback (so the TUI can
show output as it arrives) *and* is tee'd to a temp file, which lets
the tool return the full output even if its streamed snippet gets
truncated for the LLM.

Timeout: if exceeded, `killProcessTree()` walks the group and kills
everyone. No SIGTERM-then-SIGKILL escalation — one kill. If a child
ignores signals and orphaned its grandchildren, the grandchildren
survive. In practice this is rare enough to be acceptable.

### `read.ts`

Default limits: 5000 lines or 100 KB, whichever hits first (line 15).
`offset` is 1-indexed (to match `grep` / editor numbering); `limit`
caps line count. A special case at line 103: if the very first line
exceeds the byte limit, it truncates at a line boundary mid-line so
we don't feed the LLM a half-character.

Image handling: `read` on a known image extension returns structured
content with `[{ type: "text", text: "..." }, { type: "image", data,
mimeType }]`. Large images are optionally resized via `resizeImage()`
(lines 160-162) to a 2000×2000 bounding box so the LLM doesn't pay for
a 4K photo.

### `write.ts`

Always overwrites. No append mode. No atomic-write guarantee on all
filesystems — it's `writeFileSync`, which the author considered
sufficient. Tools that need append semantics should use `edit`.

### `edit.ts`

The model passes an array of `{ oldText, newText }`. Each `oldText`
must be an exact substring match, unique in the file, and not
overlapping with any other edit in the same call. The whole batch is
applied against the original file, not incrementally, so edits never
see each other's changes.

Input is normalized to LF before matching; the original line endings
(CRLF or LF) are restored after. BOM, if present, is stripped before
matching and re-added at the end. Returns a diff string for display.

This is deliberately unforgiving. No fuzzy matching, no whitespace-
insensitive mode. If the LLM's `oldText` doesn't match exactly, the
edit fails, the LLM sees the failure, it tries again. The strictness
is what prevents "the file looks fine but I silently skipped an edit"
bugs.

### The helpers

`grep.ts` wraps ripgrep. `find.ts` uses `rg --files` (so `.gitignore`
is respected). `ls.ts` is a `ls -la`-style listing.

## Extensions

Anything the core doesn't do — MCP, plan mode, sub-agents, memory,
additional tools, UI widgets, slash commands — lives here.

`src/core/extensions/loader.ts` uses
[`@mariozechner/jiti`](https://github.com/mariozechner/jiti) (a
TypeScript runtime loader) to `import()` an extension file at runtime.
It sets up import aliases (lines 77-84) so extensions can
`import { Something } from "@mariozechner/pi-coding-agent"` and have
the symbols resolve to the bundled versions rather than a second copy.

In Bun binary mode (when `pi` was compiled to a single executable),
the loader uses `virtualModules` (lines 43-50) instead of file
resolution. Everything else is the same.

**Discovery.** The `ResourceLoader` scans `~/.pi/extensions/` (global)
and `./.pi/extensions/` (project-local). Explicit `--extension=path`
flags add more. `--no-extensions` disables auto-discovery entirely.

**API surface** (lines 161-200 of the loader):

| method | purpose |
|---|---|
| `on(event, handler)` | Subscribe to `message_start`, `tool_execute_end`, `compaction_end`, etc. |
| `registerTool(tool)` | Declare an LLM-callable tool. |
| `registerCommand(name, opts)` | Register a `/command`. |
| `registerShortcut(keyId, opts)` | Bind a keyboard shortcut in interactive mode. |
| `registerProvider(name, cfg)` | Register a custom LLM provider (for when you want to point at something pi-ai doesn't ship). |
| `registerMessageRenderer(type, fn)` | Custom rendering for custom message types. |
| `registerSlashCommand(name, desc, fn)` | Sugar for simple slash commands. |

No sandbox. Trust, not isolation. Chapter 12 goes deeper.

**Lifecycle.** Extensions load *before* `bindCore()`
(lines 134-151 in `loader.ts`), so their registration calls happen
against stub action methods that throw "not initialized" if invoked
during load. After bind, the runner replaces the stubs with live
implementations. This prevents extensions from accidentally calling
session actions before the session is ready.

## Skills vs prompt templates vs extensions

Three similar-sounding things. The differences matter.

**Skills** (`src/core/skills.ts:74-81`): directory-based, stateless
prompt templates with frontmatter metadata. Invoked by the user as
`/skill:name`. Contents are plain Markdown. Skills cannot execute
code. Example: a skill for "code review" is Markdown describing how to
review code; invoking it inserts that Markdown as a user message.

**Prompt templates**: fragments injected into the system prompt at
startup. Like skills but for always-on context, not on-demand
invocation.

**Extensions**: executable TypeScript. Everything the other two can't
do.

The rule: "text" → skill, "system-prompt additive" → prompt template,
"code" → extension. No confusion between them because they literally
don't share code paths.

## Settings

Global at `~/.pi/settings.json`, project at `./.pi/settings.json`.
Deep merge, project overrides global. Loading and merging in
`src/core/settings-manager.ts:102-130`. Nested objects merge
recursively; arrays and primitives are replaced entirely.

Typical settings:

```ts
{
  compaction?: { enabled?: boolean; reserveTokens?: number };
  branchSummary?: { reserveTokens?: number };
  theme?: string;
  extensions?: string[];       // extra extension paths
  sessionDir?: string;         // custom session storage
  enabledModels?: string[];    // for Ctrl+P cycling
}
```

Initialization at `main.ts:486`:

```ts
const startupSettingsManager = SettingsManager.create(cwd, agentDir);
```

Settings writes also use `proper-lockfile` to serialize concurrent
`pi` instances in the same project.

## Three modes, three chapters

- **Interactive** (`src/modes/interactive/`) — the TUI you usually
  see. Theming, keybindings, input editor, message renderers,
  extension UI callbacks.
- **Print** (`src/modes/print-mode.ts`) — single-shot. `pi "fix the
  readme"` runs one turn and exits. `--mode json` spits events on
  stdout.
- **RPC** (`src/modes/rpc/`) — stdin/stdout JSON-RPC for IDE
  extensions and pi-mom.

Chapter 14 takes them one at a time.

## A bunch of small, clever things

Scattered through the package, some intuitions worth calling out now
because the chapters they belong to are about something else:

**Model auto-fallback.** `src/core/model-resolver.ts:151-165`. If you
ask for a model that's not in the registry, the resolver builds a
synthetic `Model` object with the provider's defaults so the CLI
doesn't hard-fail on an unknown model name. A new Anthropic model the
registry hasn't heard of yet still works; the accounting just may not
be accurate until you upgrade.

**Dual thinking level sources.** `--thinking high` takes precedence
over `--model claude-sonnet:low`. Useful for CLI scripts: you can
pin the thinking level regardless of what model you ended up
resolving (agent-session.ts:320-345, main.ts:350-351).

**Session CWD validation.** If you `/resume` a session whose `cwd` no
longer exists, the runtime refuses to mount it and prompts you with a
fallback cwd (main.ts:387-419). A subtle case — the session metadata
points at `/Users/you/old-project`, which you deleted three months
ago, and the agent can't possibly do file operations there.

**File mutation queue.** The edit tool imports a
`withFileMutationQueue()` helper that batches file operations so two
tools in the same turn don't race on overlapping ranges. The coding
agent runs tools in parallel by default; this queue is the reason
that's safe for file edits.

**Session file recovery.** If the session file is empty or corrupted
on load, `setSessionFile()` truncates and starts fresh with a valid
header (lines 700-706). It's better to lose an unreadable session
than to keep erroring on every load.

## In one paragraph

pi-coding-agent is the product. A CLI argument parser, an orchestrator
of session/runtime lifecycles, four built-in tools, a sandboxless
extension system loaded via `jiti`, a compaction engine wired to
pi-ai's overflow detection, a lockfile-guarded JSONL persistence
layer, and three I/O modes over the same `AgentSession` core. The bulk
of the code is in the modes and the tools; the core coordination is
smaller than you'd guess.

Part III moves from "what each package is" to "how the patterns work
across the stack." Starting with how events actually flow.
