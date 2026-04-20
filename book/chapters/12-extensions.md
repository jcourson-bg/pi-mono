# 12. Extensions: trust, lifecycle, API

The founding philosophical move of pi-coding-agent is that MCP, plan
mode, subagents, and memory files are not features — they are
extensions. Anything beyond the four built-in tools and the JSONL
session has to earn its way into the core; until then, it lives as
TypeScript a user has installed.

This isn't an "also" feature. A full day of using `pi` might involve
half a dozen active extensions, any of which could override tool
behavior, inject new tools, register slash commands, handle keyboard
shortcuts, or replace the system prompt.

## What an extension is

A TypeScript file (or a directory with an `index.ts` / `index.js`
entry). Example:

```ts
// ~/.pi/extensions/pin-files.ts
import type { Extension } from "@mariozechner/pi-coding-agent";

export default <Extension>{
  name: "pin-files",

  async init(ctx) {
    const pinned = new Set<string>();

    ctx.registerSlashCommand("pin", "Pin a file", async ({ args }) => {
      pinned.add(args);
      return `Pinned ${args}`;
    });

    ctx.on("turn_start", (ev, { session }) => {
      if (pinned.size === 0) return;
      session.appendNextTurnMessage({
        role: "user",
        content: [{ type: "text",
          text: `Pinned files:\n${[...pinned].map(p => "- " + p).join("\n")}` }],
      });
    });
  },
};
```

It's a JavaScript object with a `name` and an `init` function. Inside
`init`, the extension uses a context object (`ctx`) to register
things and subscribe to events.

## Discovery

Two auto-scanned locations:

| location | purpose |
|---|---|
| `~/.pi/extensions/` | User-global. Loaded in every project. |
| `./.pi/extensions/` | Project-scoped. Loaded only in this project. |

Plus CLI overrides:

| flag | effect |
|---|---|
| `--extension=path` | Load a specific file. Repeatable. |
| `--no-extensions` | Disable auto-discovery entirely. |

Resource loading lives in `src/core/resource-loader.ts` and extension
loading in `src/core/extensions/loader.ts`.

## How TypeScript extensions run without compiling

pi bundles
[`@mariozechner/jiti`](https://github.com/mariozechner/jiti), a
TypeScript runtime loader that transpiles TS on import. The loader at
`src/core/extensions/loader.ts:58-87` creates a `jiti` instance with
import aliases:

```ts
const jiti = createJiti({
  alias: {
    "@mariozechner/pi-coding-agent": /* bundled path */,
    "@mariozechner/pi-ai": /* bundled path */,
    "@sinclair/typebox": /* bundled path */,
    // ...
  },
});
```

Why aliases? So an extension that says
`import { Agent } from "@mariozechner/pi-coding-agent"` gets the
already-loaded version in the running process, not a second copy it
would have to resolve via `node_modules`. Two copies would fail
`instanceof` checks; one copy means the extension shares types,
classes, and state with the host.

In Bun binary mode (when `pi` has been compiled to a single
executable via `bun build --compile`), file resolution doesn't work.
The loader (lines 43-50) switches to `virtualModules` — a map of
in-memory module definitions. Extensions that depend on a module
outside this map won't work in binary mode. This is an intentional
tradeoff: the binary is easier to ship, and extensions that need
arbitrary node_modules can just be used from source.

## The trust model

There is no sandbox. The loader is `jiti.import()`. The extension
runs in the same Node.js process, with the same permissions, as `pi`
itself. An extension has:

- File system access via `fs`
- Network access via `fetch`, `http`, etc.
- Shell execution via `child_process`
- Full pi-coding-agent API access — session state, mutating
  messages, changing the model, reading auth storage
- No confinement whatsoever

This is chapter 3's rule 7. It is deliberate and it is the right
choice for pi's audience and threat model. Other agents make the
opposite choice (Cursor runs extensions in a V8 isolate with a
capability system). pi does not.

The practical implication: **install extensions the way you install
npm packages — by looking at what they do first**. Don't install
random extensions. The `CONTRIBUTING.md` and README both say this
implicitly by treating extensions as "your code."

## The API surface

What an extension can register or subscribe to (from
`src/core/extensions/` and `src/core/extensions/loader.ts:161-200`):

### Lifecycle events

- `session_before_switch` / `session_before_fork` — before a
  session handover. Chance to persist.
- `turn_start` — before each LLM call.
- `turn_end` — after each assistant message completes, including
  tool results.
- `message_start` / `message_update` / `message_end` — streaming
  message lifecycle.
- `tool_execute_start` / `tool_execute_update` / `tool_execute_end`
  — tool lifecycle.
- `compaction_start` / `compaction_end` — before and after a
  compaction fires.
- `agent_start` / `agent_end` — outermost. Only meaningful for
  long-running extensions.

### Registrations

- `registerTool(tool)` — define a new `AgentTool` the LLM can call.
- `registerCommand(name, opts)` — register a CLI-style command the
  user can invoke by typing `/<name> ...`.
- `registerSlashCommand(name, desc, fn)` — simpler sugar for slash
  commands that just take one string arg.
- `registerShortcut(keyId, opts)` — bind a keyboard shortcut in
  interactive mode, with a label for the help menu.
- `registerProvider(name, cfg)` — register a custom LLM provider
  entry. Useful if you have a provider pi-ai doesn't ship.
- `registerMessageRenderer(type, fn)` — custom renderer for custom
  message types.
- `registerToolRenderer(toolName, fn)` — custom renderer for a
  specific tool's output in the TUI (e.g., a pretty-printer for your
  custom `spreadsheet` tool).

### Session manipulation

Via the `session` binding on the `ctx`:

- `session.addTool(tool)` / `session.removeTool(name)` — dynamically
  add/remove tools mid-session (e.g., enable MCP tools only when an
  MCP server is online).
- `session.appendNextTurnMessage(msg)` — inject a message that will
  be sent as user context on the next turn.
- `session.appendCustomMessage(entry)` — write a custom entry to the
  session JSONL.
- `session.compact()` — force a compaction.
- `session.abort()` — cancel the running turn.

### UI primitives

Via `ctx.ui`:

- `ctx.ui.select(options)` — open a select overlay, await a choice.
- `ctx.ui.confirm(message)` — yes/no prompt.
- `ctx.ui.input(prompt)` — single-line input.
- `ctx.ui.showError(...)`, `ctx.ui.showInfo(...)` — toast messages.

These work in all modes. In interactive mode they use pi-tui overlays.
In RPC mode they emit `extension_ui_request` events to the client,
which handles them. In print mode they usually throw or auto-resolve
to a default (because there's no user present).

## Lifecycle

```
Startup
  ├─ loader discovers files in ~/.pi/extensions/ and ./.pi/extensions/
  ├─ for each file:
  │  ├─ jiti.import(file) → extension object
  │  ├─ stub ctx methods that throw "not initialized"
  │  └─ extension.init(ctx) runs (registrations stored but not active)
  ├─ bindCore(extensions, runtime)
  │  ├─ replace stubs with live implementations
  │  ├─ merge registered tools into the session
  │  ├─ merge registered commands/shortcuts into the TUI
  │  └─ subscribe event handlers
  └─ extensions are now live

Session switch / fork
  ├─ emit session_before_switch
  ├─ call extension.destroy(oldCtx) if defined
  ├─ call extension.init(newCtx) for new session
  └─ bindCore again

Shutdown
  ├─ emit agent_end
  ├─ call extension.destroy() for each extension
  └─ process exits
```

The stub-then-replace pattern is notable (`src/core/extensions/loader.ts:134-151`). During `init()`, the
extension can register things, but it cannot yet *call* session
actions — because there's no session bound yet. Calling
`ctx.session.compact()` during `init()` will throw "not
initialized." This catches a class of bugs where an extension tries to
do work before the core is ready.

## A real extension: MCP

The MCP integration is itself an extension (published separately).
Sketch of what it does:

1. In `init()`, read a `.pi/mcp.json` config listing MCP servers.
2. Spawn each server as a child process, connect via stdio, handshake.
3. For each MCP server, list its tools, and call `session.addTool()`
   for each with an `execute` that delegates to the MCP call.
4. On `session_before_switch`, close connections. Reopen in the new
   session's init.

No core changes needed. The built-in tools are unchanged. The session
JSONL format is unchanged. The agent loop is unchanged. MCP is just a
set of tools that happen to proxy to another process.

## A real extension: Plan mode

"Plan mode" in other agents is often a first-class feature. In pi, it's
an extension:

1. In `init()`, register a `/plan` slash command and a keyboard
   shortcut.
2. When the user invokes it, switch to a specific system prompt that
   asks the LLM to produce a plan, not edit files.
3. Lock out the `edit`, `write`, and `bash` tools for the duration
   (via `session.removeTool` and restoring on `turn_end`).
4. On each turn_end while in plan mode, check for a "ready to
   execute" signal and switch back.

Again, no core changes.

## Isolation by convention, not by force

Because extensions are not sandboxed, it is *possible* for a
misbehaving extension to break other extensions or the core. Pi's
conventions are:

- **Don't mutate shared state** (session.messages, etc.) directly.
  Use the provided session methods.
- **Don't monkey-patch anything**. If you need to alter behavior,
  register a hook.
- **Namespace your events** if you emit them. `pin-files.event-name`,
  not just `event-name`.

These are not enforced. But extensions in the wild all follow them
because violating them has an obvious cost: your extension is the one
that breaks next time someone upgrades.

## Practical notes

- **Hot reload is not supported.** Changing an extension file
  requires restarting `pi`.
- **Error handling.** If an extension throws during `init()`, pi
  logs the error and continues without it rather than refusing to
  start. Better to have a partial `pi` than none.
- **Performance.** Extension event handlers run inline in the agent
  loop. A slow handler applies backpressure (via the Agent class's
  await-subscribers model). Keep them fast or make them async and
  fire-and-forget.

## In one paragraph

Extensions are TypeScript files loaded at startup from `~/.pi/extensions/`
and `./.pi/extensions/`, transpiled by jiti, running in the same
process with no sandbox. They register tools, commands, shortcuts,
providers, renderers, and handlers via a small API, and they have
full access to the session and all of pi. The trust model is "don't
install untrusted extensions"; the payoff is that anything the core
doesn't do (MCP, plan mode, memory files, custom providers, remote
shells) can be added in a file under 200 lines.

Next: how pi stores the credentials you give it, and how OAuth fits
in.
