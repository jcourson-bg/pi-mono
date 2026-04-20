# 8. Event streams and backpressure

A recurring pattern across pi-mono: **the primary interface between
layers is an async iterator of discriminated-union events.**
pi-ai's `stream()` returns one. pi-agent-core's `agentLoop()` returns
one. The coding-agent's RPC mode emits one as JSON lines on stdout.
The web-ui renders one into HTML.

This is the stack's spine. Picking it apart is the point of this chapter.

## The shape of an event

Every event in the codebase has a `type` discriminator and a payload
that depends on the type. Example from pi-ai:

```ts
type AssistantMessageEvent =
  | { type: "start"; partial: AssistantMessage }
  | { type: "text_delta"; contentIndex: number; delta: string }
  | { type: "text_end"; contentIndex: number; content: string }
  | { type: "thinking_delta"; ... }
  | { type: "toolcall_start"; ... }
  | { type: "toolcall_delta"; ... }
  | { type: "toolcall_end"; contentIndex: number; toolCall: ToolCall }
  | { type: "done"; reason: string; message: AssistantMessage }
  | { type: "error"; reason: "error" | "aborted"; error: AssistantMessage };
```

pi-agent-core wraps pi-ai's events into a higher-level event type
that nests the inner `assistantMessageEvent`, adds `tool_execution_*`,
and frames everything in `agent_start` / `turn_start` / `turn_end` /
`agent_end`.

The coding-agent's RPC mode serializes those as JSON lines. Each line
is a single event. Clients parse and render.

## Why events, not callbacks

Two reasons.

First, **composability by transformation.** An event stream can be
transformed — filtered, mapped, merged — without changing the consumer
or producer. The cross-provider transform layer in chapter 4 is
literally a function `(events, context) => events`. The RPC mode is
`events.map(JSON.stringify)`. The web-ui is `events → DOM updates`.
Callbacks would require reshaping every consumer.

Second, **no implicit state in the consumer.** An `async for await`
loop over events is the simplest control flow for "do something until
this stream ends." There is no handler registration to track, no
dispose method to remember, no event emitter cleanup.

## Soft errors, hard errors

Chapter 3 mentioned this as rule 9 and it's worth restating in detail
because it's counterintuitive:

> Errors travel as events, not exceptions.

Context overflow, rate limits, provider 500s, auth failures, user
aborts — all arrive as `{ type: "error", reason, error:
AssistantMessage }`. The attached `AssistantMessage` has
`stopReason: "error" | "aborted"` and a filled-in `errorMessage`.

A consumer's `for await` loop does not need `try`/`catch`. The last
event before the loop ends tells you how it ended:

```ts
for await (const ev of stream({ model, context })) {
  switch (ev.type) {
    case "text_delta": appendText(ev.delta); break;
    case "toolcall_end": showToolCall(ev.toolCall); break;
    case "done": markSuccess(); break;
    case "error": showError(ev.error.errorMessage); break;
  }
}
```

Exceptions *are* used. They are reserved for caller misuse — calling
`prompt()` on an already-running agent, passing an invalid model,
feeding `agentLoopContinue` a context whose last message is an
assistant message. Those genuinely are bugs on the caller side, and
throwing is the right response.

The split is simple: **"the model or provider did something you need
to react to"** is data. **"You used the API wrong"** is an exception.

## The EventStream class

`packages/ai/src/utils/event-stream.ts:4-88` implements a
queue-and-promise hybrid that every layer uses:

```
EventStream<T, R>
  queue: T[]                             // buffered events
  waiting: Array<(t: IteratorResult<T>) => void>   // blocked consumers
  finalResult: Promise<R>                // resolves when stream ends
```

`push(event)` either pops a waiter and fires it or appends to the
queue. `next()` either pops from the queue or appends a waiter. When
`complete(result)` runs, remaining waiters get `{ done: true }`, and
`finalResult` resolves.

The two-level model: every layer has its own `EventStream`, and higher
layers consume lower layers' streams and push into their own. That
pattern is what lets you stack pi-ai underneath pi-agent-core
underneath pi-coding-agent without any layer needing to know where its
events ultimately go.

## Backpressure: the two paths through agent-core

Recall from chapter 5 that `pi-agent-core` has two ways to consume:

```ts
// Low-level — no backpressure
for await (const ev of agentLoop(config, messages)) { ... }

// High-level — backpressure
const agent = new Agent(config);
agent.on("message_end", async (ev) => { await somethingSlow(); });
await agent.prompt("hi");
```

In the low-level path, `agentLoop()` pushes events into its
`EventStream` and keeps going. Consumer is slow → queue grows.

In the high-level path, the `Agent` class's `processEvents()`
(`agent.ts:535-537`) **awaits every subscriber's promise** before
advancing. Consumer is slow → producer waits.

Which is right depends on what you're building.

- **The coding-agent's RPC mode** uses the high-level path with a
  subscriber that does a synchronous `stdout.write(JSON.stringify(ev)
  + "\n")`. Since the subscriber is fast, the two paths are
  indistinguishable, but having the backpressure available means that
  if the consumer process is slow to read stdout, the agent pauses
  rather than unbounded-buffering.

- **pi-mom's Slack handler** uses the high-level path with subscribers
  that make `chat.postMessage` HTTP calls to Slack. Slack is slow
  (sometimes 500 ms per message). Backpressure means the agent
  doesn't get far ahead of what's displayed. Chapter 15 covers the
  trick pi-mom uses to avoid this serializing every thing.

- **The web-ui** uses pi-ai directly (no agent wrapper) and consumes
  events in a plain loop. DOM updates are fast enough that it doesn't
  matter; when they aren't, the author would need to pull events off
  the stream into a render queue manually.

Making the backpressure choice per-layer instead of one-size-fits-all
is unusual and, as far as I can tell, intentional.

## Abort signals everywhere

Every function that emits events also accepts an `AbortSignal`.
`stream(model, context, { signal })`. `agentLoop(config, messages,
signal)`. `agent.prompt("...", { signal })`. Chains all the way down.

When the signal fires:

1. The provider's HTTP client gets the abort and tears down the
   connection.
2. The pi-ai stream emits `{ type: "error", reason: "aborted", error:
   message }` where `message.stopReason === "aborted"`.
3. Agent-core's loop sees `stopReason` is `"aborted"` (line 194 of
   `agent-loop.ts`) and exits cleanly via `turn_end` → `agent_end`.
4. Any running tool receives the signal and can cancel itself (every
   tool's `execute` signature takes a `signal?`).
5. The `Agent` class reports `isStreaming = false` and clears
   `pendingToolCalls`.

All of this is one clean path through the code because the abort is a
property of the event stream's signal, not a side-channel.

## Where events come from in each layer

```
provider HTTP SSE / websocket
      │
      │  parsed by per-provider module
      ▼
pi-ai event stream   (text_delta, toolcall_delta, done, error, ...)
      │
      │  wrapped by agentLoop() with message_start / tool_execution_* / turn_*
      ▼
pi-agent-core event stream
      │
      │  consumed by Agent.processEvents(),
      │  broadcast to subscribers with backpressure
      ▼
Agent subscribers
      │
      │  (UI renderers, loggers, RPC writers, session persistence)
      ▼
end of stack
```

Each hop is a plain function-to-async-iterator conversion. There is
no framework, no dependency injection, no event bus. The shape of the
interface — "give me an async iterator of discriminated events" —
stays the same from bottom to top.

## Rendering an event stream in a TUI

Because pi-tui is diff-based, a streaming LLM response is implemented
as: a component whose `render()` returns a growing string. Each
`text_delta` appends to its internal state and calls `invalidate()`.
The TUI's render throttle (16 ms, 60 fps) coalesces multi-token
bursts into one render. The diff detects that only the streaming
component's lines changed and redraws only those.

A `toolcall_delta` with partial JSON can similarly be rendered live.
The code shows `Reading /etc/nginx` before the path is even complete,
updating in real time as the model fills in arguments. Chapter 9 pulls
this apart.

## In one paragraph

Events are the spine of pi-mono. Every layer emits a stream of
discriminated union events; errors travel as events except for
genuine caller mistakes. The two-level backpressure model
(`agentLoop` = no backpressure, `Agent` = await all subscribers)
matches the two canonical consumers — fast loggers and slow UIs.
`AbortSignal` threads through every call site so cancellation is a
property of the stream, not a side channel. The whole system works
because the interface between layers never changes.

Next: what a tool call actually looks like as it travels that spine.
