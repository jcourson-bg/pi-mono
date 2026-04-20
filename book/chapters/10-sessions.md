# 10. Sessions as JSONL trees

Every turn you have with `pi` gets appended to a session file. The
file is JSONL — one JSON object per line. That's the whole storage
engine. No database, no SQLite, no git-like object store.

But the file is not a flat log. Hidden in the `parentId` field is a
tree, and that tree is the mechanism for `/fork`, `/tree`, compaction
insertion, and crash recovery.

## The on-disk format

A fresh session file, abridged:

```
{"type":"session","version":3,"id":"abc","cwd":"/home/user/proj","timestamp":"..."}
{"type":"message","id":"m1","parentId":null,"message":{"role":"user","content":[{"type":"text","text":"hi"}]}}
{"type":"message","id":"m2","parentId":"m1","message":{"role":"assistant","content":[...]}}
{"type":"thinking_level_change","id":"tlc1","parentId":"m2","thinkingLevel":"high"}
{"type":"message","id":"m3","parentId":"tlc1","message":{"role":"user","content":[...]}}
```

Five entry types today (`src/core/session-manager.ts`):

| type | what it carries |
|---|---|
| `session` | Header: id, cwd, timestamp, version. First line only. |
| `message` | A user, assistant, or tool result message. |
| `thinking_level_change` | A record that the thinking level was changed between turns. |
| `compaction` | A summary entry that replaces prior history for the LLM. |
| `custom_message` | Extension-owned. Any shape, any meaning. |

Every entry has `id` and `parentId`. `parentId: null` is reserved for
the root; every other entry has a parent. The *last appended* entry
is the current leaf — the tip of the "branch" you're working on.

## Why JSONL

The author had options. SQLite is battle-tested. A git-backed store
would naturally support branching. A proper event store would make
replay trivial.

JSONL got picked because it is:

1. **Human-readable.** Open a session in `less`. Grep for a command
   you ran. Diff two sessions in `git diff --no-index`. This is
   genuinely useful for debugging agent behavior, and it's how the
   author publishes sessions as training data on Hugging Face.

2. **Append-only.** Writing is `fs.appendFile`. Never seek, never
   rewrite, never worry about torn writes. A crash mid-append leaves
   a truncated last line which a single pass discards.

3. **Lockable.** `proper-lockfile` with 10 retries over 200 ms
   (`auth-storage.ts:62-87`) is enough to serialize two `pi`
   instances in the same project.

4. **Infinitely streamable.** Reading is `fs.readFile` and split by
   `\n`. A 100,000-line session is still milliseconds to load.

The cost is that "loading" is linear in total entries and
reconstructing an arbitrary subtree is O(n). For sessions that stay
under a few thousand entries (which is what a long day of work looks
like), this is fine. Longer than that and compaction has
probably already kicked in.

## The tree inside

The flat file encodes a tree because multiple entries can share a
`parentId`:

```
       m1
        │
        m2
        │
        m3
       / \
     m4   m5
     │    │
     m6   m7
```

Here the user made a `/fork` at `m3`. Both `m4` and `m5` have
`parentId: "m3"`. Two branches.

The reconstruction algorithm
(`src/core/session-manager.ts:310-417`) is:

1. Build a flat `Map<id, entry>` index (lines 316-320).
2. Given a leaf id, walk `parentId` back to root, collecting entries
   in reverse (lines 341-347).
3. Reverse the collection to get chronological order.

That's the path from root to leaf — the actual conversation.

The leaf is whichever entry you're currently pointing at. Normally
it's the *last appended* entry, since new work extends the current
branch. After `/fork`, it's the entry you forked from (the new branch
starts empty). After `/tree` → select, it's whichever entry you picked.

## `/fork` in detail

The exposed semantics: "I want to go back to an earlier state and try
something else without losing what I already did."

Under the hood (`src/core/session-manager.ts:1076-1100`):

1. Create a new session file.
2. Write a `session` header whose `parentSession` field points at the
   current session's id (genealogy tracking).
3. Copy the path-to-leaf from the parent session into the new one.
4. Return a handle to the new session; the current runtime
   `switchSession`es to it.

The original session file is untouched. Two separate files now exist.
You can pick either, `/switch` between them, fork each independently.

It's cheap because copying a 500-entry session is copying 500 JSON
lines. It scales because forking never rewrites history.

## `/tree`

`/tree` opens a tree-browser overlay showing the current session's
entries as a structured outline with branches. Up/Down navigates; Enter
selects; Space expands.

When you select an entry:

- The runtime "rewinds" the agent's state to that point by rebuilding
  `context.messages` from root to the selected entry.
- The selected entry becomes the new leaf.
- The next thing you prompt will be a child of that entry.

This is how pi supports the workflow "that last tool call was wrong,
let me steer the conversation differently from two steps back."
Without `/tree`, the only way would be to undo by asking the model to
undo, which rarely works well.

## Compaction and the tree

From chapter 7, compaction inserts a `compaction` entry into the tree.
A compaction entry has:

```ts
{
  type: "compaction",
  id: string,
  parentId: string,    // current leaf when compaction ran
  summary: string,     // LLM-generated summary of prior history
  firstKeptEntryId: string,  // where "original context" resumes
  tokensBefore: number,
  details?: unknown,
  fromHook?: boolean,
}
```

When reconstructing the conversation for the next LLM call, the tree
walker (`src/core/session-manager.ts:385-408`) behaves specially
when it encounters a compaction in the path:

1. Skip directly to the compaction entry.
2. Emit a pseudo-message containing `summary`.
3. Emit the original entries from `firstKeptEntryId` up through the
   compaction's parent.
4. Emit entries *after* the compaction normally.

In practice this means: "if you compacted 80 messages of history, the
next LLM call sees the summary plus the last N kept messages plus
whatever came after the compaction." The full history is still in the
file — compaction never deletes — but the LLM-visible context is
compact.

Chapter 11 goes deeper on the triggers and the prompt.

## Custom messages

Extensions can write arbitrary `custom_message` entries. An extension
that implements "pinned files" might insert a custom message for each
pin event. An extension that implements a local memory file might
insert a custom message each time it was updated.

When the tree is read back, custom messages can be rendered by the
extension's own `registerMessageRenderer`. When the LLM context is
rebuilt, they can be converted to user or system messages by the
extension's `convertToLlm` callback on the `AgentLoopConfig`.

The JSONL format intentionally doesn't forbid anything under
`custom_message`. Extensions own their data; the core just persists
whatever shape they give it.

## Concurrency: two `pi` instances in the same project

The session manager and `AuthStorage` both use
[`proper-lockfile`](https://www.npmjs.com/package/proper-lockfile).
At `src/core/auth-storage.ts:62-87` you'll see:

```ts
const release = await lockfile.lock(path, {
  retries: { retries: 10, minTimeout: 20, maxTimeout: 200 },
});
try {
  // ... do the read+write
} finally {
  await release();
}
```

10 retries over 200 ms covers every realistic case of two instances
fighting over the same file. If one is somehow hung with the lock
forever, the lock file's stale-detection kicks in and a future
instance takes over.

Note this doesn't serialize two instances against *different*
session files in the same project. Two instances working on different
sessions in the same project can run simultaneously with no
conflict. It's only writes to the same file that serialize.

## Session file corruption

A truncated last line happens if the process dies mid-append. The
loader handles it (`src/core/session-manager.ts:700-706`): if
parsing any line throws, and the malformed line is the last one, it's
dropped. If it's an earlier line, the session is considered broken.

There's a further belt-and-braces fallback: if `setSessionFile()`
finds the file exists but has no valid `session` header, it
truncates and starts fresh. The rationale: a session file with no
header is effectively garbage; better to lose it than to error on
every load forever.

## Genealogy

Session headers carry:

- `id` — this session's id
- `parentSession` — the session this was forked from, if any
- `cwd` — the working directory this session was started in
- `timestamp` — when it was created

The genealogy chain is not currently exposed in the UI, but the data
is there. You could walk `parentSession` back through a tree of forks
and trace the full history of how a session came to be.

## The parallel-write story you don't have to worry about

Two internal guarantees make concurrency basically not a thing for
callers:

1. Within a single `pi` process, only one `Agent` runs at a time per
   session (chapter 5's "concurrent calls to `prompt()` throw").
2. Across processes, `proper-lockfile` serializes writes.

You cannot race tool results into the wrong session, you cannot get a
half-written entry, you cannot get two instances writing interleaved
entries. The system looks like a single-writer log from the outside,
even though the file is accessed from multiple places (message
append, thinking-level change, compaction, extension writes).

## In one paragraph

A session is a JSONL file where each entry has an id and a parentId,
encoding a tree that supports branching, forking, compaction-as-entry,
and streaming append for crash safety. The file is human-readable,
grep-able, trivially diffable, and locked by `proper-lockfile`. Every
"state" the agent might need (rewind, fork, compact, resume,
custom-extension-event) is just a different way to interpret the
same append-only log. This is the single best design decision in the
repo.

Next: compaction in detail, because the brief version in chapter 7
skipped the interesting parts.
