# 14. Three ways to run the agent

The coding agent ships three modes over the same `AgentSession` core:
interactive, print, and RPC. There's also a fourth, `json`, which is
really a variant of print. The modes differ almost entirely in I/O —
how prompts come in and how events go out. Everything below the I/O
is identical.

## Interactive (TUI)

The mode you get when you run `pi` in a terminal with no flags.
Source: `src/modes/interactive/`.

Flow:

1. Initialize pi-tui.
2. Render the conversation view with a message list and an editor at
   the bottom.
3. Subscribe to `AgentSession` events; update the view on each event.
4. On Enter in the editor, call `session.prompt(text)`.
5. On an arriving `tool_execution_start` where `beforeToolCall`
   requires approval, pause the session and overlay a confirmation
   dialog.
6. Handle keybindings via `KeybindingsManager`.

Key UI pieces:

- **Editor** (pi-tui's multi-line component). Typed history, Emacs-
  style kill ring, undo, autocomplete for file paths and slash
  commands.
- **Message list** renderers per message type. Text renders as
  Markdown; tool calls render as labeled panels with the tool's
  pretty output; thinking blocks render as collapsible sections.
- **Status line** at the top: current model, thinking level, token
  usage, cost.
- **Overlays**: model selector (Ctrl+P), session tree (double Esc),
  settings, extension UI dialogs.

Interactive mode is the largest part of the codebase outside of
tools and providers, and most of its code is pi-tui components and
layouts. The TUI does a lot of work here; interactive mode is
mostly a glue layer between `AgentSession` events and pi-tui
updates.

## Print mode

Single-shot. `pi "fix the readme typo"` runs one conversation and
exits. Source: `src/modes/print-mode.ts`.

Flow:

1. Read the prompt from argv, `@file.txt`, or stdin if piped.
2. `session.prompt(text)`.
3. Subscribe to events, accumulate the final assistant text.
4. On `agent_end`, write the final text to stdout and exit.

Print mode has a subtle twist: if any tool wants approval, print mode
has no user to ask. By convention, the default extension config for
print mode auto-approves read-only tools (`read`, `grep`, `find`,
`ls`) and rejects everything else. You can override per invocation
with flags.

`--mode json` is print mode with a different output: instead of
accumulating text, each event is written as a JSON line to stdout as
it arrives. You get the full event stream. This is what CI pipelines
and scripts hook into.

## RPC mode

Stdin/stdout JSON-RPC. Source: `src/modes/rpc/`. Used by:

- IDE extensions (VS Code, potentially others).
- pi-mom, when running pi as a subprocess instead of linking the SDK.
- Any external orchestrator.

Protocol (`src/modes/rpc/rpc-types.ts:19-68`):

**Commands** come on stdin, one per line:

```json
{ "id": "req-1", "type": "prompt", "message": "Hello", "images": [] }
{ "id": "req-2", "type": "abort" }
{ "id": "req-3", "type": "set_model", "provider": "anthropic", "model": "claude-sonnet-4-6" }
{ "id": "req-4", "type": "get_state" }
{ "id": "req-5", "type": "fork", "entryId": "msg-42" }
{ "id": "req-6", "type": "switch_session", "path": "..." }
{ "id": "req-7", "type": "bash", "command": "ls" }
```

Every command has an `id` for correlation. Full list includes:
`prompt`, `steer`, `follow_up`, `abort`, `set_model`, `cycle_model`,
`get_available_models`, `get_state`, `get_messages`,
`get_session_stats`, `bash`, `switch_session`, `fork`, `new_session`.

**Responses** echo the id and a success/error:

```json
{ "id": "req-1", "type": "response", "command": "prompt", "success": true }
```

**Events** are the agent's event stream, emitted as they happen, with
no `id` (they aren't responses to anything):

```json
{ "type": "message_start", ... }
{ "type": "tool_execute_start", "name": "bash", ... }
{ "type": "message_end", ... }
```

**Extension UI requests** are emitted when an extension needs user
input. The client should reply with a matching
`extension_ui_response`:

```json
// out
{ "type": "extension_ui_request", "requestId": "ui-1", "kind": "confirm", "message": "Allow bash?" }
// in
{ "type": "extension_ui_response", "requestId": "ui-1", "result": { "confirmed": true } }
```

Default values and timeouts are supported so a client that disappears
mid-dialog doesn't hang the session forever.

## The `takeOverStdout` guard

From chapter 7: `main.ts:451` redirects `console.log` and
`console.error` to internal buffers when running in print, json, or
RPC modes. Otherwise a stray log from an extension would corrupt the
output protocol. The buffers are flushed to stderr on exit so you
can still see them for debugging.

## Mode-specific extension UI

The same `ctx.ui.confirm()` call works in all three modes because
the UI primitives are abstract. Behind the scenes:

| mode | how confirm() works |
|---|---|
| interactive | Opens a pi-tui overlay with Y/N buttons; awaits keypress. |
| print | Uses the configured default (often auto-approve); no user input. |
| json / rpc | Emits `extension_ui_request`; awaits matching response. |

Extensions write against the abstract API and work everywhere.

## Why three modes

Why not just pick one?

- **Interactive** is what humans want when they sit at a terminal and
  want to see a rich rendering.
- **Print** is what scripts and CI want. Machine-parseable output,
  no TTY requirements, stdin-pipe-able.
- **RPC** is what IDE integrations and orchestrators want. Full
  event access, the ability to issue arbitrary commands, and a
  symmetric command/event protocol so client and server can evolve
  independently.

None of the three is a strict subset of another. Removing any one
would remove a user.

## Switching modes mid-session

You can't. Modes are chosen at process start and the I/O wiring is
different enough that switching would require re-architecting the
event emission path. If you want to go from interactive to RPC, you
exit and restart.

However, a session file can be consumed by any mode. `pi --resume
my-session` will pick up in whatever mode you're launching now,
regardless of what mode created the session. Session format is
mode-agnostic.

## In one paragraph

Three modes — interactive (TUI), print (one-shot stdout), RPC
(stdin/stdout JSON) — sit over the same AgentSession core. They
differ only in I/O: what reads the prompt, how events render, how
UI dialogs are resolved. The abstraction is a handful of UI
primitives that each mode implements concretely, so extensions
written against the abstract API work everywhere. Session files
don't care which mode wrote them.

Part IV starts with the Slack bot.
