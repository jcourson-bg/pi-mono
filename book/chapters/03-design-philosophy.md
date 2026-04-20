# 3. Design philosophy

Nobody in pi-mono wrote a manifesto file, and if they had I wouldn't trust
it. The rules a codebase actually follows are visible in what it does and
what it refuses to do. Reading it for a while, here are the ones I see.

## Rule 1 — Start with the minimum. Add nothing until forced.

The obvious shape of a modern coding agent goes something like:

- a plan / think / act loop
- a planner subagent, a critic subagent, a tool router subagent
- an MCP client with twenty connected servers
- a memory / RAG layer
- a vector store
- a framework of "chains" or "graphs"

pi-coding-agent has none of those. It has:

- one LLM stream
- four tools: `read`, `write`, `edit`, `bash`
- a queue for user messages while the model is working
- a JSONL file that records what happened

Everything else is an extension that ships *separately* from the minimum.
Plan mode, MCP servers, memory files, subagents — all optional. The AGENTS.md
at the root is explicit about this:

> Aggressively extensible, minimal core, no MCP/sub-agents/plan-mode
> built-in — these are implemented as extensions/packages instead.

The intuition: if you bake in the wrong abstraction early, it becomes a
tax on every feature forever. Start with nothing; let patterns emerge from
use.

## Rule 2 — One way to do things.

For most decisions, pi-mono picks one answer and commits. A sampling:

- **Config.** Global at `~/.pi/settings.json`, project-scoped at
  `./.pi/settings.json`. Deep merge, project overrides global. That's the
  whole system. There's no `.piconfig.yml`, no `pi.config.ts`, no
  environment-variable fanout with a precedence table.

- **Persistence.** Sessions are JSONL files. Not SQLite, not a git-backed
  store, not a cloud API. JSONL appends line by line, is trivially
  diffable, and can be opened in `less`.

- **State.** The `Agent` class in `pi-agent-core` has one mutable state
  object. Not an event store, not Redux, not an immutable tree. Setters
  that copy on assign; getters that return the live object.

- **Tool schemas.** TypeBox. Not Zod, not JSON Schema hand-written, not a
  custom DSL.

- **Linter / formatter.** Biome.

- **Compiler.** `tsgo`.

The cost: less flexibility when someone wants option B. The benefit: the
code never goes off on a tangent to accommodate the third way.

## Rule 3 — Put the honest tradeoffs in-code.

Read the comments in pi-tui's rendering path (`packages/tui/src/tui.ts`
around line 1098):

> Only render changed lines (firstChanged to lastChanged), not all lines to
> end. This reduces flicker when only a single line changes (e.g., spinner
> animation).

This comment isn't describing the code. It's describing *why the code is
shaped like that* — naming the enemy (flicker) and the scenario (spinners)
that forced the design. The codebase has a lot of these. They are the
shortest form of design documentation available and they travel with the
code.

Contrast with:

```ts
// Increment i by one
i++;
```

You find zero of those. The default is to write no comment. When a comment
does appear it exists because someone decided a future reader would be
confused without it.

## Rule 4 — No `any`. Actually, no.

From AGENTS.md:

> No `any` types unless absolutely necessary

This is enforced by biome, but the rule goes further: **don't invent
types, read `node_modules` for the real ones**. Also from AGENTS.md:

> Check node_modules for external API type definitions instead of guessing

And:

> NEVER remove or downgrade code to fix type errors from outdated
> dependencies; upgrade the dependency instead

That last one is interesting. A common move in a hurry is "cast to `any`
to quiet the error and move on." pi-mono explicitly rejects this. If the
types say the code is wrong, the code is wrong or the types need
updating. The shortcut is banned.

## Rule 5 — Keybindings are configuration, not constants.

Also from AGENTS.md:

> Never hardcode key checks with, eg. `matchesKey(keyData, "ctrl+x")`.
> All keybindings must be configurable.

Every key is looked up by a *name* in a `KeybindingsManager`. The
`Editor` component never says "if this is Ctrl+A, move to line start." It
says "if this matches `tui.editor.lineStart`, move to line start." The
mapping from names to physical keys lives in a config the user can
override.

For a TUI-heavy product, this is a rule you only get right if you write
it down. Otherwise `ctrl+x` checks metastasize everywhere the first time
someone wants a Vim mode.

## Rule 6 — Don't preserve backward compatibility unless asked.

Also from AGENTS.md:

> Do not preserve backward compatibility unless the user explicitly asks
> for it.

And the flip side:

> Always ask before removing functionality or code that appears to be
> intentional.

Those sit together on purpose. "Don't write a compat shim I didn't ask
for" is paired with "but don't delete something that looks load-bearing
without checking." The code avoids museum debt (old exports kept around
because of a hypothetical consumer) without letting refactors quietly
break real users.

## Rule 7 — Extensions are sandboxless, because trust is the model.

From the coding-agent research (chapter 12 will go deeper):

> No sandbox: Extensions run in the same Node.js process as the agent.
> Trust model: Extensions are assumed trusted; they have full access.

Modern secure-coding orthodoxy says extensions should be sandboxed, run
in a V8 isolate, capability-restricted. pi-mono just… doesn't. An
extension is a TypeScript file you wrote or installed, running in the
same process as `pi`.

The tradeoff is explicit: **pi treats "you ran this extension" as
equivalent to "you ran this code." No pretense otherwise.** If that
worries you, don't install extensions you don't trust. The benefit is
that extensions have the full power of Node.js and the full pi API
without adapter layers.

For a personal tool with a hacker audience, this is defensible. For a
hosted product it would be negligent. pi is the first kind.

## Rule 8 — Cross-provider fidelity is worth real engineering.

`packages/ai/src/providers/transform-messages.ts` is 172 lines of
nothing-but-compatibility work. It rewrites tool call IDs, drops
redacted-thinking blocks when moving to a model that can't replay them,
strips Google's `thoughtSignature`, injects synthetic "No result
provided" tool results to satisfy APIs that reject orphaned tool calls,
and filters out errored assistant messages that would be replayed as
invalid.

That file exists because the author took a conversation started against
Claude, fed it to GPT, watched it explode, and kept the scar tissue in
code. It makes "hand a conversation to another model and keep going" a
real feature instead of an aspiration.

The test file that exercises it, `cross-provider-handoff.test.ts`, takes
real contexts from 20+ providers and asks each target model to consume
all of them. Failures dump payloads to `/tmp/pi-handoff-*.json` for
offline triage.

## Rule 9 — The event stream is the contract.

Neither `pi-ai` nor `pi-agent-core` throws on errors that are part of the
model's normal output. Context overflow, rate limits, auth failures,
aborts — all arrive as an event in the stream (`{ type: "error", reason:
"aborted", error: message }`) with a proper `AssistantMessage` attached.

Exceptions are reserved for things the caller *really* did wrong
(calling `prompt()` while the previous `prompt()` is still running, for
example).

This inversion — "soft" failures as data, "hard" failures as exceptions
— is unusual enough to call out. The payoff is that UIs streaming the
event stream need exactly one error path: render the error event. No
try/catch wrapping every stream consumption.

## Rule 10 — Intuitions, not abstractions.

A final pattern worth naming: pi-mono prefers to encode intuitions as
small, concrete helpers rather than general abstractions.

Example: the "synthetic tool result" injection. Instead of a
`MessageValidator` abstraction with rules and a pipeline, you get 40
lines of procedural code that says "if the last message had tool calls
and the next one doesn't answer them, push a synthetic error result."

Example: "partial JSON parsing during tool call deltas." Instead of a
streaming parser class with events, you get a function that tries
`JSON.parse` and falls back to the `partial-json` npm package.

The rule seems to be: **write the procedure. If the same procedure shows
up three times, pull it into a function. Don't invent a framework for
it.**

---

These aren't in any style guide. They are the rules I see the code
following. Violate them and your PR will look out of place; match them
and the codebase feels consistent across ten-thousand lines and seven
packages written over years.

Part II is four chapters deep on the four foundation packages. We start
at the bottom of the stack: pi-ai.
