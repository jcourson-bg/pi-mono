# 9. Tool calling end-to-end

A single tool call touches every layer of pi-mono. Chapter 8 covered
the event spine; this one walks one call from user input to file on
disk and back, annotating the interesting bits.

## The scenario

The user runs `pi "read packages/ai/src/types.ts and count the
exported types"`. The agent decides to call the `read` tool with path
`packages/ai/src/types.ts`.

## Step 1 — user input arrives

In interactive mode, the `Editor` component collects the prompt.
Pressing Enter fires `AgentSession.prompt(text)`. The session
constructs a `UserMessage` with the text and any attachments, appends
it to `context.messages`, persists it to the JSONL file, and calls
`agentLoop()`.

In print mode the same thing happens without the editor; the argv
string becomes the prompt.

In RPC mode, a `{ "type": "prompt", "message": "..." }` line arrives
on stdin and is dispatched to `session.prompt()`.

## Step 2 — the stream opens

`pi-agent-core` emits `agent_start`, then `turn_start`, then
`message_start` for the user message, then calls `stream()` on pi-ai.

pi-ai formats the context for Anthropic (in this example), including
the tool definitions:

```json
"tools": [
  { "name": "read", "description": "...", "input_schema": { "type": "object", "properties": { "path": ..., "offset": ..., "limit": ... }, "required": ["path"] } },
  { "name": "write", ... },
  { "name": "edit", ... },
  { "name": "bash", ... }
]
```

The HTTP POST fires. The SSE stream starts arriving.

## Step 3 — the tool call streams in

Claude decides to call `read`. Events arrive chunk by chunk:

```
start
  partial = empty AssistantMessage

text_delta "I'll read that file for you."
  (displayed to user)
text_end
  (content block 0 closed)

toolcall_start
  contentIndex = 1
  partial.content[1] = { type: "tool_call", id: "toolu_abc", name: "read", args: undefined }

toolcall_delta
  partial JSON so far: `{"path":"packa`
  parseStreamingJson → { path: "packa" }

toolcall_delta
  `{"path":"packages/ai/src/types.ts"}`
  parseStreamingJson → { path: "packages/ai/src/types.ts" }

toolcall_end
  toolCall = { id: "toolu_abc", name: "read", args: {"path":"packages/ai/src/types.ts"} }
```

`parseStreamingJson` (`packages/ai/src/utils/json-parse.ts:10-28`) is
the hero of this section. Fast path `JSON.parse`, fallback to the
`partial-json` package. Incomplete strings become `undefined`; partial
objects become real objects with the parsed subset of keys. The TUI
can therefore display "Reading `packa`…" and watch it fill in live.

## Step 4 — validation

pi-agent-core consumes the pi-ai events and emits its own. When
`toolcall_end` arrives it triggers `prepareToolCall()` at
`agent-loop.ts:458-470`:

1. Look up the tool by name (`read`).
2. If the tool has `prepareArguments`, call it to massage the raw
   args. (`read` doesn't.)
3. Call `validateToolCall()` from pi-ai, which compiles the JSON
   schema with AJV and validates `{ path: "packages/..." }`.
4. If validation fails, emit an error tool result with the AJV error
   message and move on. The LLM sees the error and can retry.

Validation succeeded. Arguments are now typed as
`Static<typeof ReadSchema>` — we have `{ path: string, offset?:
number, limit?: number }`.

## Step 5 — the before hook

pi-agent-core's `beforeToolCall` hook fires (`agent-loop.ts:491-507`).

In interactive mode with approval required, this is where the TUI
opens an overlay asking "Read `packages/ai/src/types.ts`? [y/N/a]"
and waits for a keypress. If you press `n`, the hook returns
`{ block: true, reason: "user denied" }` and the tool is never
executed. The LLM sees an error tool result; the agent continues.

If you press `y`, the hook returns `undefined` (or
`{ block: false }`) and execution continues.

In RPC mode, the before hook dispatches an `extension_ui_request`
event to the client, which handles approval however it wants. In
print mode, the default config often has auto-approval turned on for
read-only tools.

## Step 6 — execution

`tool_execution_start` is emitted. The tool's `execute()` runs with
the abort signal and an optional `onUpdate` callback.

`read.ts`:

```ts
execute: async (toolCallId, { path, offset, limit }, signal, onUpdate) => {
  const absolutePath = resolveReadPath(path, cwd);
  await checkSignal(signal);
  const content = await readFileSafely(absolutePath, { offset, limit, signal });
  return { content: [{ type: "text", text: content.text }], details: content.meta };
}
```

Read does:

1. Resolve `path` against cwd (absolute paths are absolute; relative
   are relative to the session's cwd, which might differ from
   `process.cwd()` after a `/switch`).
2. Check it's not binary, not huge (truncate at 100 KB / 5000 lines).
3. If it's an image, return `content: [{ type: "text", text: "..." },
   { type: "image", data: base64, mimeType }]`.
4. Return the content.

On error (permission, missing file, binary) `execute` throws. The
loop catches and wraps in `createErrorToolResult()`.

## Step 7 — the after hook and tool result message

`tool_execution_end` fires with `{ result, isError }`.

The `afterToolCall` hook runs (`agent-loop.ts:573-592`). Extensions
can override `content`, `details`, or `isError`. Omitted fields are
untouched. A common use: a logging extension that writes the result
to a file and returns `{}`, letting the LLM see the unmodified
result.

pi-agent-core then synthesizes a `ToolResultMessage`:

```ts
{
  role: "toolResult",
  toolCallId: "toolu_abc",
  toolName: "read",
  content: [{ type: "text", text: "... file contents ..." }],
  isError: false,
  timestamp: Date.now(),
}
```

It pushes this onto `context.messages`. Emits `message_start` and
`message_end` for the tool result. Emits `turn_end`.

## Step 8 — second turn

The loop re-enters. Because the last message is `toolResult` (not
`assistant`), it calls `stream()` again — this is the implicit
"continue" that makes tool calls work. The tool result is now part of
the context the LLM sees.

Claude generates a regular text response: "The file exports 17 types,
including..." This streams in as `text_delta` events, gets packaged
into an `AssistantMessage`, gets pushed to `context.messages`, emits
`turn_end`, and because this turn has no tool calls, the loop exits
with `agent_end`.

## Step 9 — persistence

Everything that got pushed to `context.messages` also got appended to
the JSONL session file as it happened. The session manager's
`appendMessage()` is called from the agent's `message_end` subscriber.
By the time `agent_end` fires, the file on disk is current.

If the process dies mid-stream, the file has every completed message
up to the crash. Nothing was lost. The next launch of `pi --resume`
can rebuild exactly the same state.

## Parallel tool calls

If Claude had called `read` *and* `grep` in the same turn, the call
changes slightly. Recall from chapter 5 that default tool execution
is parallel.

```
toolcall_end for read
toolcall_end for grep
tool_execution_start { read }
tool_execution_start { grep }
tool_execution_end { read result }
tool_execution_end { grep result }
message_start { toolResultMessage: [read result, grep result] }
```

Both tools launch concurrently. Both results are collected. They get
emitted in the order the model asked for them, not the order they
finished. That ordering matters: LLMs see tool results in the same
order as their tool call blocks in the assistant message, and
shuffling would confuse them.

## When a tool wants to stream updates

The `onUpdate` parameter on `execute` is for long-running operations.
`bash` uses it: as stdout and stderr arrive in chunks, it calls
`onUpdate({ stdout, stderr, elapsed })` which flows out as a
`tool_execution_update` event. The TUI shows this live.

```
tool_execution_start { bash "sleep 5; echo done" }
tool_execution_update { stdout: "" }
...  (five seconds later)
tool_execution_update { stdout: "done\n" }
tool_execution_end { result, isError: false }
```

The LLM doesn't see intermediate updates — they're purely for UI.
Only the final result goes in the tool result message.

## Tool result content: text and images

A tool can return text or images or both. The `content` field of
`AgentToolResult` is an array of `TextContent | ImageContent`. `read`
on an image file returns both — a text description ("read PNG image,
800×600") and the actual base64 image data.

pi-ai's provider conversion layer handles packaging this into
provider-native tool result formats. Anthropic and Gemini take
multimodal tool results natively; for providers that don't, the
image is dropped (with a log warning) and only the text survives.

## Synthetic tool results

If you abort mid-stream — tool call emitted, but the process died
before the tool ran — `context.messages` has an assistant message
with a tool call and nothing follows it. Next time you prompt, the
cross-provider transform layer (chapter 4) injects a synthetic error
tool result:

```json
{ "role": "toolResult", "toolCallId": "toolu_abc", "toolName": "read",
  "content": [{ "type": "text", "text": "No result provided" }], "isError": true }
```

The conversation stays valid. The LLM sees "oh, that tool didn't
actually run" and proceeds from there.

## In one paragraph

One tool call is: partial-JSON streamed arguments → AJV validation →
before hook → `execute()` with signal and onUpdate → result → after
hook → tool result message appended to context and JSONL → second
turn re-enters `stream()` with the tool result in scope. Parallel
tool calls run concurrently but emit in source order. Every step is
an event on the stream, every event gets persisted, the whole thing
is resumable on crash.

Next chapter: the JSONL file where all this history lives, and the
tree structure hiding inside it.
