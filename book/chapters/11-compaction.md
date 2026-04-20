# 11. Context compaction

LLMs have fixed context windows. Every token you stuff in costs money
and takes time; past a certain point the model's quality starts to
degrade; past the hard limit, the API errors out.

Compaction is pi's mechanism for dealing with this: when the context
gets too big, summarize the old stuff into a shorter summary, keep
recent messages intact, and continue the conversation from the
summary. It is a small idea with a lot of sharp edges.

## When compaction fires

Three triggers, in order of likelihood:

1. **Auto-compaction.** After each turn, the session checks context
   size and compacts if it's too close to the limit. Controlled by
   settings (`compaction.enabled`, `compaction.reserveTokens`).

2. **Manual / extension-triggered.** A user types `/compact` or an
   extension calls `session.compact()`. Forces one now regardless of
   size.

3. **Overflow recovery.** The API returned a context-overflow error
   mid-turn. Pi detects the overflow pattern (chapter 4's
   `isContextOverflow`), compacts, and retries. This is capped at
   one attempt to avoid infinite loops.

## Counting tokens

The check is:

```
contextTokens = calculateContextTokens(lastAssistantUsage)
              + estimateTokens(messagesAfterLastUsage)
if contextTokens > model.contextWindow - reserveTokens:
  compact()
```

`calculateContextTokens` uses the real usage the provider reported on
the last assistant message. Providers' `usage.input + usage.cacheRead`
is the authoritative count of tokens that went into the last prompt.

But tokens have been added *since* that measurement — whatever user
messages, tool results, and custom messages were appended after.
`estimateTokens()` covers those with a heuristic:

- Text: `length / 4` (the commonly cited English estimate).
- Images: a flat 4800 tokens each (`compaction.ts:272`). Not precise;
  close enough to set the trigger reliably.
- Tool results: text estimate for text content, image estimate for
  images.

The heuristic is wrong in predictable directions — English-like text is
roughly 4 chars/token; non-ASCII can be denser. It errs toward
overestimating for safety; the worst case from being wrong is that
compaction fires slightly early, not that overflow happens.

## The `reserveTokens` buffer

The trigger compares against `contextWindow - reserveTokens`, not
`contextWindow` itself. Default `reserveTokens` is around 10,000 (the
actual number depends on settings). The reason:

1. The next turn is going to add *more* context before the model
   responds — the user's next message, the model's response, any
   tool calls. We need headroom.
2. The usage report from the provider is on the *input* to the last
   turn. The assistant's own output (which becomes input to the next
   turn) isn't counted until we estimate it.
3. Providers sometimes lie or round. Leave a margin.

## The summarization prompt

`src/core/compaction/utils.ts:SUMMARIZATION_SYSTEM_PROMPT`:

> You are summarizing a conversation for context management.
> Preserve all critical technical decisions, code snippets, and user
> requirements. Be concise but complete. The summary will be sent to
> the LLM as-is.

It is sent via `completeSimple()` — non-streaming — because the
summary's token count has to be known before continuing. The
summarization call uses the same model as the session (unless
overridden in settings), which means the summary cost is
proportional to the session cost. A cheaper model could summarize,
but the author opted for consistency: the summary is in the model's
native style.

What the prompt avoids saying is "summarize the conversation
concisely." LLMs hate that instruction because it invites
impressionistic summaries that drop precisely the technical content
you need. Naming the things to preserve — decisions, code, requirements
— skews the model toward structured fidelity.

## What gets kept intact

The compaction entry stores `firstKeptEntryId`. Everything from
`firstKeptEntryId` up to (but not including) the compaction is
*preserved verbatim* in the LLM context.

This matters because the most recent messages are what the model needs
to continue correctly. A summary says "we decided X, then Y"; the
actual tool-result messages say "I just ran `edit` and here is the
diff." The diff matters for the next turn; the summary doesn't have
that detail.

Exactly how many messages get preserved depends on settings but is
typically the last few turns — enough context for the model to know
"where it was" without dragging in all the old junk.

## Inserting the compaction entry

The compaction is a regular JSONL entry (`src/core/session-manager.ts:869-889`):

```ts
appendCompaction({
  summary: "...",
  firstKeptEntryId: "m17",
  tokensBefore: 180_432,
  details: ...,
  fromHook: false,
})
```

Parent is the current leaf. After append, the compaction *is* the
new leaf. New messages will have the compaction as their parent.

Because the compaction is an entry, not a rewrite, **no history is
lost**. The old messages are still in the file. `/tree` can still
navigate into pre-compaction state. You could, in principle, fork
back to before the compaction and continue without summarization (you
just couldn't actually fit it into the model's context).

## Context reconstruction with compactions in it

When the next LLM call needs the context, the tree walker
(`src/core/session-manager.ts:385-408`) emits:

1. The compaction summary as a synthetic user message at the position
   of the compaction. (Why a user message? Because system prompt is
   already set; a user message is the cleanest way to inject a chunk
   of context the LLM will treat as established history.)
2. All entries from `firstKeptEntryId` up through the compaction's
   parent — the preserved recent history.
3. All entries *after* the compaction — whatever new stuff has
   happened since.

The LLM sees: "[summary of earlier conversation] [last N turns
verbatim] [new user message]". This is the minimum viable context for
continuity.

## Compaction and branches

What happens if you `/fork` from a message, one branch compacts, and
the other doesn't? Nothing weird. The compaction entry is in one
branch's path to leaf but not the other's. Walking the other branch's
tree gives the full, uncompacted history.

This is not a special-case; it's a consequence of compaction being an
entry. Entries are in whatever branches contain them. Branches are
paths to leaves. Simple.

## The overflow-recovery loop

The specific flow for "context overflowed mid-turn":

```
agent.prompt("hi")
  agentLoop → stream
  stream emits { type: "error", reason: "error", error: message }
      message.errorMessage matches an OVERFLOW_PATTERN
  isContextOverflow(message, model) → true
  session detects overflow
  _overflowRecoveryAttempted ? abort : true
  compact()
  agentLoopContinue   (last message is not assistant, so this is valid)
  stream retries with smaller context
```

`_overflowRecoveryAttempted` is the infinite-loop guard. If we
compact, retry, and still overflow, we emit the error and stop. The
user can `/compact` more aggressively manually, or switch to a
larger-context model.

## Failures to watch for

- **Summary blows through reserve.** A model occasionally writes a
  summary too long to leave real room for new tokens. Settings allow
  tuning `branchSummary.reserveTokens` separately. Watch your logs.

- **Summarization itself overflows.** If the session is already so
  big that the *summarization call* can't fit, compaction fails. The
  session is stuck. The fallback is to manually `/fork` from an
  earlier point and start a new branch.

- **Important context not in the summary.** Heuristic: if the model
  repeatedly asks about details that were established pre-compaction,
  the summary isn't doing its job. The solution is usually to shrink
  `reserveTokens` so more recent messages stay verbatim, or to keep
  critical files in a `MEMORY.md` that gets appended to the system
  prompt.

## What compaction does not touch

- Tool call IDs and their results: compaction never decouples a tool
  call from its result in a way that would make the conversation
  invalid. The summary replaces both.
- Thinking blocks in preserved messages: kept as-is. Nothing strips
  them.
- Session files on disk: never rewritten. Compaction is always an
  append.

## In one paragraph

Compaction is: detect "we're close to the context limit," call a
small LLM round-trip to summarize old history, insert a `compaction`
entry into the session tree that references where "new" context
starts, and rely on the tree walker to emit summary + preserved-recent
+ new when building the next LLM context. Triggers are
auto-by-size, manual, and overflow-recovery (capped at one retry).
The summary prompt names the things to preserve explicitly. No
history is ever deleted; compaction is just another kind of entry.

Next: extensions, where "anything the core doesn't do" lives.
