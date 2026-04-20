# 15. pi-mom — the agent on Slack

"mom" is a Slack bot that wraps pi-coding-agent and lets you talk to
it from a channel. The name is a joke: it's like the mom you can ask
to fix things while you're at work. The implementation is surprisingly
small — under 2,500 lines — and it's a good study of "how do you wrap
the coding agent in a different UI without forking it."

## The three actors

`packages/mom/src/main.ts` boots three things:

1. **SlackBot** (`slack.ts:153-169`), which opens a Socket Mode
   connection to Slack. Socket Mode means pi-mom holds a persistent
   WebSocket to Slack rather than exposing an HTTP webhook — works
   behind NAT, no public URL required.
2. **EventsWatcher** (`events.ts`), a file-system watcher for
   scheduled/timer-driven tasks.
3. **Per-channel `AgentRunner`** instances (`agent.ts:392-410`),
   cached in memory. Each channel gets one runner. The runner owns a
   long-lived `AgentSession` bound to that channel's workspace.

The main handler (`main.ts:281-332`) is a non-blocking dispatcher.
Slack events come in, get logged synchronously, then either get
rejected (if the channel's runner is busy) or pushed to the channel's
message queue.

## How pi-mom talks to pi

It doesn't shell out, doesn't use RPC. It **calls the coding-agent
SDK in-process** (`agent.ts:467-476, 780`):

```ts
import { createAgentSession } from "@mariozechner/pi-coding-agent";

const session = await createAgentSession({
  cwd: channelWorkspaceDir,
  authStorage,
  extensions: [...],
});

await session.prompt(userMessage, { images });
```

It's the same SDK any embedding would use. The advantage over RPC is
no serialization overhead, no subprocess management, and direct
access to the event stream. The disadvantage is that mom's memory
and crash behavior are tied to pi's — if pi crashes, mom crashes too.

## Per-channel sessions

Each Slack channel gets its own workspace directory (`/data/<channel-
id>/`), its own session file (`context.jsonl`), its own memory file,
and its own skills directory. The `AgentRunner` (`agent.ts`) wraps
this setup.

The per-channel isolation is meaningful: two channels discussing
unrelated projects get unrelated agent state. Switching channels is
switching sessions. Files written in one channel stay in that
channel's workspace and aren't visible to another.

## Summary in channel, details in thread

The split is the bot's most distinctive UI choice. For every response
from the agent:

- A **summary** goes to the main channel — short, what-happened-at-a-
  glance. Truncated to 35 KB if needed.
- The **details** (tool calls, full output, intermediate steps) go to
  the thread attached to the message.

Implementation in `agent.ts:499-620`. The handler subscribes to
`message_end` events, partitions the content into main-channel text
and thread-detail text, and enqueues two posts.

Tool executions in the thread look like:

```
🔧 bash
$ find . -name "*.py" | head
./foo.py
./bar.py
```

While the main channel just shows: `→ bash` and then the next text.

The message queue (`agent.ts:702-728`) is a promise chain that
serializes all Slack API calls. Slack's rate limits are real; a naive
concurrent poster would get throttled. The chain guarantees in-order
delivery and respects API backoff.

## Editing the final message

When the agent is still running and streaming, pi-mom posts a
placeholder ("thinking..."). When the turn ends, it **edits** the
placeholder via `chat.update` to contain the final summary. Source:
`agent.ts:819`.

This is much nicer than "here is my initial thought... actually, here
is my updated thought... actually, my final thought is..." which is
what you get if you post each token as it arrives. The message list
stays tidy.

## Docker sandbox

Mom accepts `--sandbox=host` (run tools on the host) or
`--sandbox=docker:<container>` (run them in a container).

The `DockerExecutor` (`sandbox.ts:179-193`) wraps every bash call:

```
docker exec <container> sh -c "<command>"
```

With path translation: the host workspace `/data/CHANNEL-ID/`
corresponds to `/workspace/CHANNEL-ID/` inside the container. Tool
calls that read or write files against the host path get rewritten.

Stdout and stderr are capped at 10 MB per stream (`sandbox.ts:141,
147`) so a misbehaving `cat /dev/zero` can't eat memory.

No host directories are automatically mounted; the operator
provisions the container (and mounts whatever they want) externally
via a setup script. Mom just runs `docker exec` against it.

This is not a security boundary against a motivated adversary — the
container has shell access to whatever its mounts and image allow. It
is a **blast-radius** limiter. A runaway bash command can wreck the
container; it can't wreck the host.

## Skills and memory

Mom loads two kinds of persistent context on every run:

- **Skills** (`agent.ts:105-139`): `workspace/skills/<name>/SKILL.md`
  files with Markdown frontmatter. Workspace-level skills apply
  globally; per-channel skills override. Loaded and listed in the
  system prompt on each run.
- **Memory** (`agent.ts:69-103`): `MEMORY.md` file(s) that get
  appended to the system prompt verbatim. Workspace-level applies
  globally; per-channel overrides.

The agent has `read`, `write`, and `bash` access to its workspace. It
can create and modify skills and memory files by itself. "Remember
that we always use black formatting" → write it to `MEMORY.md`.
"Here's a new playbook for running migrations" → create `skills/
migrations/SKILL.md`.

This self-configuration is the piece that makes pi-mom feel
live-trainable. You teach it something by chatting; it persists the
lesson; next session it applies automatically.

## Deduplication and backfill

Slack Socket Mode connections drop and reconnect. When that happens,
Slack re-delivers events that arrived during the outage. The
`ChannelStore` (`store.ts:33-50`) tracks logged timestamps in a
60-second window to reject duplicates.

Separately, on startup, mom backfills `log.jsonl` — the persistent
event log on disk — against the current session's known state. If a
user message came in while mom was down and got logged to
`log.jsonl`, the session on startup catches up before taking new
input.

## Credentials

Two env vars required (`main.ts:16-17`):

- `MOM_SLACK_APP_TOKEN` — Socket Mode app-level token.
- `MOM_SLACK_BOT_TOKEN` — the bot user's workspace token.

Both are read at startup and never logged. LLM API keys live
separately in `~/.pi/mom/auth.json` — **not** the default `~/.pi/
auth.json` — so a compromised mom workspace can't read the
operator's personal pi credentials. Nice touch.

## Abort semantics

If a user says something that mom interprets as "stop" (or the user
invokes a stop command), the current run calls `session.abort()`,
which sets the AbortSignal on the whole event stream. Tools get the
signal, HTTP requests tear down, the agent exits with a `turn_end` +
`agent_end`, and the "thinking" message in the channel gets edited
to "aborted." No forked state, no dangling tool calls.

## In one paragraph

Pi-mom is a Slack bot that embeds pi-coding-agent via its SDK, gives
each Slack channel its own long-lived session and workspace,
optionally runs tool calls inside a Docker container for blast-radius
containment, and teaches itself via SKILL.md and MEMORY.md files the
agent can read and write. The clever UI move is summary-in-channel /
details-in-thread, implemented as a promise-chain message queue over
the Slack Web API. Its existence is a proof that the coding-agent
SDK is genuinely embeddable.

Next: the web-ui package.
