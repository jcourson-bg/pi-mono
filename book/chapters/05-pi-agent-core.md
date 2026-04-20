# 5. pi-agent-core — an agent is just a loop

"Agent framework" is a phrase that, over the last two years, has come to
mean something between 1,000 and 30,000 lines of code. `pi-agent-core`
is about 650 lines across `agent.ts`, `agent-loop.ts`, `types.ts`, and
`proxy.ts`. You can read the whole thing in an afternoon and there will
be nothing left to understand.

The central claim of the package is that **an agent is a loop that (1)
calls a model, (2) runs whatever tools the model asked for, and (3)
goes back to step 1 until the model stops asking**. Everything else —
permissions, parallelism, streaming events, error recovery — is
annotations on that loop.

## Two public entry points

```ts
import { Agent, agentLoop, agentLoopContinue } from "@mariozechner/pi-agent-core";
```

`agentLoop(config, messages)` takes new user messages, pushes them into
the conversation, and runs the loop until the model stops. It returns
an `EventStream` immediately — the caller starts consuming; the loop
runs on another tick and feeds events in.

`agentLoopContinue(config)` is almost the same but for **resuming
without a new user message**. Its precondition is that the last message
in context is *not* an `assistant` message (`agent-loop.ts:70-76`) —
either it's a `toolResult`, or a `user` message that hasn't been
answered. This is what you use to retry after a tool error, or after
the LLM stream aborted mid-turn. No dummy "continue" message required.

The `Agent` class at `agent.ts:157-539` is a higher-level wrapper
holding mutable session state. You use it when you want conveniences
like "current streaming message," a pending tool call tracker, steering
and follow-up queues, or an `activeRun` concept that prevents
double-prompt calls. Under the hood it calls `agentLoop` /
`agentLoopContinue`.

## The state machine

Internally the `Agent` holds a single `MutableAgentState` (see the
setter pattern at `agent.ts:74-85`, which copies arrays on assign to
prevent external mutation):

```
systemPrompt        // string
model               // pi-ai Model
thinkingLevel       // "off" | "minimal" | "low" | "medium" | "high" | "xhigh"
tools               // AgentTool[]
messages            // AgentMessage[]
isStreaming         // boolean
streamingMessage?   // partial AssistantMessage while streaming
pendingToolCalls    // Set<string> — tool call IDs currently executing
errorMessage?       // last error text from a failed turn
```

Lifecycle is driven by `runWithLifecycle()` at lines 434-456:

```
idle
  ├─ prompt() or continue() called
  │  ├─ activeRun = { promise, resolve, abortController }
  │  ├─ isStreaming = true
  │  ├─ errorMessage = undefined
  │  └─ executor runs runAgentLoop or runAgentLoopContinue
  │
  └─ finally
     ├─ isStreaming = false
     ├─ streamingMessage = undefined
     ├─ pendingToolCalls cleared
     └─ activeRun = undefined
  → idle
```

Concurrent calls to `prompt()` or `continue()` throw immediately (lines
313-316, 324-326). The agent is **single-threaded by design**. If you
want parallelism, you run multiple agents.

## Steering and follow-up queues

The most unusual thing in `Agent` is that it has two separate message
queues with independent drain modes. From `agent.ts:55-143`:

```ts
class PendingMessageQueue {
  mode: "all" | "one-at-a-time";
  messages: AgentMessage[];
  drain(): AgentMessage[] {
    if (mode === "all") { const m = [...messages]; messages = []; return m; }
    return messages.length ? [messages.shift()!] : [];
  }
}
```

Two instances, each controlled by its own setter:

- **Steering queue.** Messages the user sends *while the agent is
  already streaming or running tools.* Drained after each `turn_end`
  (agent-loop.ts:216) — so a steering message interrupts the next
  model call, but not mid-stream.
- **Follow-up queue.** Messages the user sent after the agent would
  have otherwise stopped (no more tool calls, no more steering). Drained
  only when the inner loop is about to exit (lines 169-228) — so
  follow-ups reactivate a finished agent instead of interrupting a
  running one.

Why two? Because "what should a rapid click do?" has different answers
in different UIs.

- A chat UI where each Enter should interrupt the current response:
  `steeringMode: "all"`, drain all queued messages into one big turn.
- A careful UI where each message should be answered individually,
  even if the user typed five in a row: `"one-at-a-time"`, queue up,
  drain one per turn.

For the coding agent, the default is `"one-at-a-time"` for both. For a
chat app you might flip to `"all"`. The choice is per-instance.

## Tools: `AgentTool` extends `Tool`

`types.ts:292-307`:

```ts
interface AgentTool<TParameters extends TSchema, TDetails = any> extends Tool<TParameters> {
  label: string;  // human-readable
  prepareArguments?: (args: unknown) => Static<TParameters>;
  execute: (
    toolCallId: string,
    params: Static<TParameters>,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<TDetails>,
  ) => Promise<AgentToolResult<TDetails>>;
}
```

The `Tool` base (from pi-ai) is the schema. `AgentTool` adds `label`
(for UI rendering), an optional `prepareArguments` hook to massage raw
arguments before validation, and the `execute` function itself. A tool
reports progress via `onUpdate` (for long-running operations that want
to stream status to the UI).

**Tools throw on error** — they do not encode errors as part of their
result content. The loop catches the throw, wraps the message, and
emits an error-flavored tool result.

## The hooks: `beforeToolCall`, `afterToolCall`

This is how permission systems, sandbox gates, and extensions
intercept behavior. Both are async, both receive an `AbortSignal`.

`beforeToolCall` receives the tool call and its *already-validated*
arguments:

```ts
type BeforeToolCallContext = {
  assistantMessage: AssistantMessage;
  toolCall: AgentToolCall;
  args: unknown;       // validated against tool.parameters
  context: AgentContext;
};

type BeforeToolCallResult = {
  block?: boolean;     // true → do not execute
  reason?: string;     // error message if blocked
};
```

It's a permission gate. It cannot modify arguments; if you want to
change them, do it in `prepareArguments` on the tool itself.

`afterToolCall` receives the real result and can override fields:

```ts
type AfterToolCallResult = {
  content?: (TextContent | ImageContent)[];  // replace
  details?: unknown;                         // replace
  isError?: boolean;                         // replace
};
```

Omitted fields keep their original values. There's no deep merge — each
field is either replaced entirely or left alone.

The hooks are how the coding agent's interactive mode prompts you to
approve a `bash` call before it runs, and how audit extensions log the
exact result the model saw.

## Sequential vs parallel tool execution

The loop has two implementations behind one flag (`config.toolExecution`):

```ts
type ToolExecutionMode = "sequential" | "parallel";
```

Default: `"parallel"`. A single assistant turn that produces three tool
calls runs them concurrently by default.

The interesting detail is that **even in parallel mode, results are
emitted in original source order**. Lines 390-437 of `agent-loop.ts`:
prepare all calls sequentially (catching validation errors), then
launch runnable ones concurrently as a Promise array, then await them
one by one in source order — so tool result events arrive in the order
they appeared in the assistant message, not the order they finished.
The downstream UI and the LLM both see a consistent ordering.

## The event timeline

Here's the exact order of events for a prompt that produces one
assistant message with one tool call, followed by a second assistant
response to the tool result:

```
prompt("hello")
  agent_start
  turn_start
  message_start { userMessage }
  message_end   { userMessage }
  message_start { assistantMessage }
  message_update { assistantMessageEvent: "text_delta" }
  message_update { assistantMessageEvent: "toolcall_start" }
  message_update { assistantMessageEvent: "toolcall_delta" × N }
  message_end   { assistantMessage }
  tool_execution_start  { toolCallId, toolName, args }
  tool_execution_update { partialResult }    (optional)
  tool_execution_end    { result, isError }
  message_start { toolResultMessage }
  message_end   { toolResultMessage }
  turn_end      { message, toolResults }
  turn_start                                  (second turn)
  message_start { assistantMessage }
  message_end   { assistantMessage }
  turn_end      { message, toolResults: [] }
  agent_end     { messages }
```

Every event is a plain JSON object. `message_update` delegates the
inner `assistantMessageEvent` to pi-ai's event types directly, so the
whole pipeline is one stream of discriminated unions from the provider
API up to the UI.

## Backpressure — the two-level model

A subtlety that caught me on the first pass.

The **low-level** `agentLoop()` (agent-loop.ts:276-330) emits events
into an `EventStream` and **does not await subscribers**. If a consumer
is slow, events queue; the producer keeps going. This is deliberate —
the loop should never block on a UI that isn't keeping up.

The **high-level** `Agent` class (`agent.ts:535-537`) wraps this by
awaiting *all* subscriber promises in `processEvents()` before
advancing. So when you use `Agent`, a slow subscriber does apply
backpressure: subsequent events pile up *before* being emitted, not
after.

Both behaviors are valid. If you want the no-backpressure model,
consume `agentLoop()` directly. If you want the "wait until everyone
has caught up" model, use the `Agent` class. The code makes the choice
explicit and the README calls it out at line 452.

## Error recovery

Three kinds of failure:

1. **A tool throws.** Caught at `agent-loop.ts:524-559`. The error is
   wrapped in a `createErrorToolResult()` and emitted as a tool result
   with `isError: true`. The loop continues — the LLM sees the error
   and can decide to retry, explain, or ask the user.

2. **The LLM stream errors or aborts.** Detected at line 194 of the
   loop: `message.stopReason === "error" || "aborted"`. The agent emits
   `turn_end`, then `agent_end`, and exits. The final assistant message
   carries `errorMessage` so the UI can display it.

3. **Tool argument JSON parse failure.** Caught in the try/catch
   around `prepareToolCall()` (lines 515-521). Emitted as an error tool
   result; the loop continues.

The `Agent` class wraps all of this in an additional top-level catch
(lines 459-474) that synthesizes an `assistant` message with
`stopReason: "error"` if something really unexpected bubbled up.
`errorMessage` gets set on the agent state so UIs can display it
between turns.

## What agent-core does *not* do

It does not detect or handle context overflow. Overflow detection
lives in pi-ai (`isContextOverflow()`, chapter 4) and recovery
(compaction, retry) lives in pi-coding-agent (chapter 11). Agent-core
just emits the error and moves on.

It does not persist anything. The `messages` array stays in memory.
Saving to disk, branching, forking — all the coding-agent's problem.

It does not know about TUIs, files, users. It's a runtime. The
`StreamFn` abstraction means you can swap pi-ai for a mock, or for the
`streamProxy()` below.

## `streamProxy` — the remote-agent escape hatch

`proxy.ts` (341 lines) implements a `streamProxy()` function that
replaces pi-ai's `stream()` but routes the call through a backend HTTP
endpoint. The use case is browser apps that can't hold API keys
directly but want to use the full `Agent` locally.

The protocol is a bandwidth-optimized version of the event stream.
The server emits `ProxyAssistantMessageEvent` objects (lines 36-57)
with the `partial: AssistantMessage` field *stripped* — the client
reconstructs the partial locally from deltas in `processProxyEvent()`
(lines 211-340). For `text_delta`, it appends to
`partial.content[index].text`. For `toolcall_delta`, it appends to a
JSON buffer and parses incrementally.

End result: the `Agent` class doesn't know it's running over a proxy.
You pass a different `streamFn` at construction time and everything
else works identically.

## What it looks like from the outside

```ts
import { Agent } from "@mariozechner/pi-agent-core";
import { stream, getModel } from "@mariozechner/pi-ai";

const agent = new Agent({
  streamFn: stream,
  model: getModel("anthropic", "claude-sonnet-4-6"),
  systemPrompt: "You are helpful.",
  tools: [
    {
      name: "calculator",
      description: "Do arithmetic",
      label: "Calculator",
      parameters: T.Object({ expr: T.String() }),
      execute: async (_id, { expr }) => ({
        content: [{ type: "text", text: String(eval(expr)) }],
      }),
    },
  ],
});

agent.on("message_end", (ev) => console.log(ev.message));
await agent.prompt("what is 7 * 6?");
```

That is the full surface area of the package for most uses. Model,
system prompt, tools, prompt. It doesn't invent anything that isn't
there.

Next: pi-tui. Same package, different concern — how do you render any
of this in a terminal without flicker?
