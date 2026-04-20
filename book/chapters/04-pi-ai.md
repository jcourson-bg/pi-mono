# 4. pi-ai — one API, many providers

`pi-ai` is the bottom of the stack. Its job is exactly one thing: give
you a single streaming function that talks to any of a large number of
LLM providers, with enough fidelity that a conversation started against
Claude can be handed off to GPT without the receiving model rejecting it.

The public surface is small:

```ts
import { stream, getModel } from "@mariozechner/pi-ai";

const model = getModel("anthropic", "claude-sonnet-4-6");

for await (const event of stream({ model, context })) {
  // text · tool_call · thinking · usage · done | error
}
```

Two functions, a few types. Everything else is implementation.

## The `Context` type

`packages/ai/src/types.ts:223-227`:

```ts
export interface Context {
  systemPrompt?: string;
  messages: Message[];
  tools?: Tool[];
}
```

Three fields. That's the conversation. `Context` is **intentionally
mutable**: the canonical pattern is to push an assistant message onto
`context.messages` when a turn completes, then push the next user
message, then call `stream` again. You are not supposed to build a fresh
`Context` per call.

The upstream tradeoff is REPL-shaped rather than request-shaped, which
matches how the code is actually used. The downstream effect is that
`messages` accumulates forever unless someone (chapter 11) compacts it.

`Message` is a discriminated union of `UserMessage | AssistantMessage |
ToolResultMessage`. Each `AssistantMessage` carries `provider`, `api`,
and `model` metadata (lines 193-195), so when you later feed the
conversation to a different provider, the library knows where each turn
originated and can decide whether a thinking block is safe to replay.

## The provider registry is lazy

pi-ai supports 20+ providers. Each provider is a few hundred lines of
TypeScript doing message-shape translation, streaming parsing, and
error mapping. Loading all of them up-front would be expensive in
memory and startup time, especially in browser or serverless targets.

The trick is in `packages/ai/src/providers/register-builtins.ts`. Every
provider has a module-level promise that fires exactly once:

```ts
anthropicProviderModulePromise ||= import("./anthropic.js").then(...)
```

The `||=` assignment is the whole lazy-load mechanism. Call
`streamAnthropic()`, the import fires, subsequent calls reuse the
resolved promise. No import, no cost. The `pi-ai` root export registers
lazy wrappers; the actual provider modules only get loaded when you
actually stream through them.

Bedrock is the exception (lines 329-343): AWS SDK is Node-only and too
heavy to load speculatively, so it's gated behind an explicit
`setBedrockProviderModule()` call. Test environments inject a mock.

## The event stream

When you call `stream()` you get back an `AssistantMessageEventStream`,
an async iterator of discriminated events. `types.ts:237-249`:

| event | payload highlights | meaning |
|---|---|---|
| `start` | `partial: AssistantMessage` | Stream opened; empty skeleton. |
| `text_start` / `text_delta` / `text_end` | index, delta, final text | Text block being written. |
| `thinking_start` / `thinking_delta` / `thinking_end` | same shape | Extended thinking (Anthropic / OpenAI). |
| `toolcall_start` / `toolcall_delta` / `toolcall_end` | partial JSON, final `ToolCall` | A tool call being assembled. |
| `usage` | `Usage` | Final accounting. |
| `done` | `reason, message` | Success; final `AssistantMessage` attached. |
| `error` | `reason, error: AssistantMessage` | Failure; `stopReason: "error" \| "aborted"`. |

Two details worth knowing.

First, **`toolcall_delta` emits partial JSON**. A model streaming
`{"name": "read", "args": {"path": "/etc/` will deliver it a chunk at a
time, and `parseStreamingJson()` in
`packages/ai/src/utils/json-parse.ts` will return a best-effort parse at
every step. Internally the fast path is `JSON.parse`; on failure it
falls back to the `partial-json` npm package. Incomplete fields come
back as `undefined`. This lets UIs show tool arguments populating live
instead of waiting for the call to finish.

Second, **errors travel as events, not exceptions**. A rate limit, a
context overflow, a user abort, a provider 500 — all arrive as
`{ type: "error", reason, error: AssistantMessage }`. The attached
message has `stopReason` set and `errorMessage` filled in. Consumers
never need `try`/`catch` around `for await`.

## Cross-provider message transforms

This is the file I think is the most impressive 172 lines in the repo.
`packages/ai/src/providers/transform-messages.ts` implements
`transformMessages<TApi>()`, which takes messages produced against
provider A and prepares them for provider B.

Five transforms matter:

1. **Tool call ID normalization** (lines 14, 76-81). OpenAI Responses
   API emits IDs with pipes and 450+ characters; Anthropic requires
   `^[a-zA-Z0-9_-]+$` up to 64 chars. A map tracks the original→
   normalized mapping so tool result references downstream get
   rewritten consistently.

2. **Thinking block handling** (lines 41-56). Three cases:
   - *Redacted thinking* (OpenAI encrypted reasoning payloads). Dropped
     when switching models; kept only for replay against the same model,
     because only that model can decrypt it.
   - *Empty thinking* blocks (some providers emit them). Stripped.
   - *Cross-model fallback*. A thinking block moving to a model that
     doesn't support thinking becomes a plain `text` block so nothing
     is silently lost.

3. **`thoughtSignature` stripping** (lines 71-73). Google-specific
   opaque context. Harmless there, rejected as "unknown field"
   everywhere else.

4. **Synthetic tool results** (lines 98-171). The critical invariant:
   if an assistant message has tool calls and the next message is not
   a matching tool result, inject a synthetic one:

   ```ts
   result.push({
     role: "toolResult",
     toolCallId: tc.id,
     toolName: tc.name,
     content: [{ type: "text", text: "No result provided" }],
     isError: true,
     timestamp: Date.now(),
   });
   ```

   This prevents "orphaned tool call" errors that most APIs reject at
   validation.

5. **Error/aborted message filtering** (lines 126-134). Assistant
   messages with `stopReason: "error" | "aborted"` are dropped when
   re-submitting. They represent incomplete turns; replaying them
   tends to produce errors like OpenAI's "reasoning without following
   item."

The test file that exercises this, `cross-provider-handoff.test.ts`,
feeds real captured contexts from every provider to every target model.
Failures dump payloads to `/tmp/pi-handoff-*.json`. This is how a
feature earns the right to be called "cross-provider": by proving it
against a matrix of actual conversations, not a hand-written fixture.

## Tools

Tools are defined with TypeBox (`@sinclair/typebox`). A `Tool` is
`{ name, description, parameters: TSchema }` and nothing else (lines
217-221). The `parameters` field is expected to hold the JSON Schema
output of TypeBox, not the TypeBox descriptor.

Each provider converts the generic `Tool` into its native format. For
Anthropic (`anthropic.ts:867-883`):

```ts
return tools.map(tool => ({
  name: isOAuthToken ? toClaudeCodeName(tool.name) : tool.name,
  description: tool.description,
  input_schema: { type: "object", properties: ..., required: ... },
}));
```

For OpenAI (`openai-completions.ts:717-731`) it wraps in the `type:
"function"` envelope and sets `strict: false` because many
OpenAI-compatible providers choke on strict mode.

**Argument validation** happens in `packages/ai/src/utils/validation.ts`.
AJV compiles the JSON Schema and validates (and coerces) the parsed
arguments. If code generation isn't available (strict CSP, some browser
extensions, lines 14-25), AJV is disabled and validation is skipped.
That's a reasonable tradeoff: some environments just can't.

## The Claude Code tool name round-trip

One of the delightful hacks in this codebase. When you authenticate to
Anthropic via the "Claude Pro/Max" OAuth flow, the API expects tool
names in Claude Code's canonical PascalCase: `Read`, `Write`, `Bash`,
`TodoWrite`. But pi calls its tools `read`, `write`, `bash`,
`todowrite`.

`anthropic.ts:64-101` handles this. On outbound, `toClaudeCodeName()`
maps lowercase tool names to their PascalCase equivalents. On inbound,
`fromClaudeCodeName()` maps them back. The mapping is a case-insensitive
exact-match lookup against the tools array — so if your tool is
registered as `todowrite`, the API sees `TodoWrite`, and the returned
tool call shows up as `todowrite` again on your end. Round-trips
cleanly; test in `anthropic-tool-name-normalization.test.ts`.

This is a good example of a rule-9 design: a named concept
("ClaudeCode tool names") with a tiny, procedural implementation.

## Token accounting

`Usage` carries input, output, cacheRead, cacheWrite, total, plus a
`cost` object priced in USD. Cost is computed from `model.cost` metadata
(auto-generated in `models.generated.ts`) and the usage numbers,
multiplied and divided by a million. That's literally the whole
calculation (`packages/ai/src/models.ts:39-46`).

Cache tokens are reported where providers support them:

- Anthropic reports them natively on every streamed usage block.
- OpenAI requires `stream_options: { include_usage: true }` to surface
  `prompt_tokens_details.cached_tokens`.
- Google reports them unevenly, occasionally omitting cache granularity.

If a provider doesn't report cache tokens, they stay zero; total is
computed without them.

## Context overflow detection

`packages/ai/src/utils/overflow.ts:28-131`. `isContextOverflow()` uses
eighteen regex patterns across fifteen providers to detect overflow
from error messages — `/prompt is too long/i`, `/request_too_large/i`,
`/exceeds the context window/i`, and others, with exclusion patterns
to rule out rate limits that happen to mention tokens.

It also catches **silent overflow** (lines 123-128): a `stopReason:
"stop"` response where `usage.input + usage.cacheRead > contextWindow`.
Some providers (looking at you, z.ai) accept overflowing requests and
return successfully with partial output. The library treats that as an
overflow so callers can react the same way.

Overflow detection is a primitive for the coding agent's compaction
logic; we'll come back to it in chapter 11.

## Unicode surrogate sanitization

One of the small, unpleasant realities of working with LLM output:
models occasionally produce unpaired UTF-16 surrogates, especially on
emoji that got chopped mid-chunk. JSON APIs reject these. Pi-ai strips
them everywhere it serializes: `sanitizeSurrogates()` in `types.ts:29`
and its friend in `packages/ai/src/utils/sanitize-unicode.ts:21-25`.

The regex:

```
/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g
```

A high surrogate without a trailing low surrogate, or a low surrogate
without a leading high, gets removed. Valid emoji (properly paired
surrogates) pass through. There is no graceful path that repairs broken
pairs — they are stripped and the data moves on.

## OAuth

Five providers support OAuth in pi-ai:

1. Anthropic (Claude Pro / Max)
2. GitHub Copilot (device flow)
3. Google Gemini CLI (gcloud refresh)
4. Google Antigravity (Cloud Code Assist)
5. OpenAI Codex (ChatGPT OAuth)

The registry is in `packages/ai/src/utils/oauth/index.ts:35-48`.
`getOAuthApiKey()` at line 119 is the whole refresh loop:

```ts
if (Date.now() >= creds.expires) {
  creds = await provider.refreshToken(creds);
}
return { newCredentials: creds, apiKey: provider.getApiKey(creds) };
```

Callers must persist the returned `newCredentials`, because tokens
rotate. The persistence story lives one layer up, in
`pi-coding-agent`'s `AuthStorage` (chapter 13).

## The largest files

A rough map of where complexity concentrates, for when you go reading
the source yourself:

| file | ~lines | why |
|---|---|---|
| `providers/google-gemini-cli.ts` | 987 | OAuth refresh + reasoning block interleaving |
| `providers/openai-codex-responses.ts` | 970 | Codex-specific reasoning adapter |
| `providers/anthropic.ts` | 905 | Cache control, thinking, OAuth tool-name round-trip |
| `providers/openai-completions.ts` | 881 | Covers the largest fleet of compatible providers |
| `providers/amazon-bedrock.ts` | 807 | AWS Converse API + SDK integration |
| `providers/register-builtins.ts` | 433 | Lazy-load orchestration |
| `providers/transform-messages.ts` | 172 | Cross-provider glue |

The providers are chunky; everything else is small. That distribution
tells you where the domain difficulty actually lives.

## In one paragraph

pi-ai is a thin, lazy, event-stream-driven abstraction over a large
number of LLM providers. The two things that earn it its keep are
(a) cross-provider message fidelity — the transform layer — and
(b) treating errors as events, so upstream consumers stream
everything uniformly. Everything else — OAuth, tools, tokens, cache —
is competent, unremarkable plumbing that stays out of the way.

Next chapter: `pi-agent-core`, which takes `stream()` and builds the
smallest honest agent runtime around it.
