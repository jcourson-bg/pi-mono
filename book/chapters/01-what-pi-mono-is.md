# 1. What pi-mono is

If you squint at pi-mono from a distance, it looks like a coding agent. `pi` —
the CLI at `packages/coding-agent` — is the user-facing product, the thing you
install with `npx @mariozechner/pi-coding-agent`, the thing you run in a
terminal to get something that reads, writes, and executes code on your
behalf.

That's fine as a one-line description, but it's not what the repo actually
*is*. The repo is seven packages, and only one of them is the agent you run.
The other six exist because the author had to build them to make the agent
work — and along the way noticed each one was useful on its own.

## The seven packages

| package | directory | rough size | role |
|---|---|---|---|
| **pi-ai** | `packages/ai` | ~16 k LOC | One streaming API in front of 20+ LLM providers. |
| **pi-agent-core** | `packages/agent` | ~650 LOC | The agent loop: queue messages, call model, run tools, repeat. |
| **pi-tui** | `packages/tui` | ~8 k LOC | A terminal UI toolkit with differential rendering and overlays. |
| **pi-coding-agent** | `packages/coding-agent` | ~20 k LOC | The CLI user, three modes, sessions, extensions, skills, the whole product. |
| **pi-mom** | `packages/mom` | ~2 k LOC | A Slack bot that delegates to the coding agent. |
| **pi-web-ui** | `packages/web-ui` | ~5 k LOC | Lit-based chat components for browsers. |
| **pi-pods** | `packages/pods` | ~3 k LOC | CLI to spin up vLLM on rented GPUs. |

The boundaries are not arbitrary. There is a clear stack:

```
              pi-coding-agent                       pi-mom, pi-web-ui
                    │                                       │
                    ▼                                       ▼
       ┌────────────────────────────┐           ┌──────────────────────┐
       │  pi-agent-core (agent loop)│           │   pi-ai (providers)  │
       └────────────────────────────┘           └──────────────────────┘
                    │                                       ▲
                    └───────────────────────────────────────┘
                              calls pi-ai.stream()

                    pi-tui  ◀──── rendering used by pi-coding-agent
                    pi-pods ◀──── runs models that pi-ai can talk to
```

Each package's upstream dependency is small and deliberate:

- **pi-ai** depends on nothing pi-specific. You can use it to stream from
  Claude without ever touching an agent.
- **pi-agent-core** depends on pi-ai, adds a runtime. You can use it to build
  a custom agent without touching a terminal.
- **pi-tui** depends on nothing pi-specific. You can use it to build a fancy
  CLI without touching agents.
- **pi-coding-agent** depends on all three and adds the product.

Two packages (pi-ai, pi-tui) are honest standalone libraries that happen to
share a scope. The other two (pi-agent-core, pi-coding-agent) are where "pi"
actually lives.

## Who runs it

The primary user is the author, `badlogic` — this is his daily driver for
coding work. Sessions are published as training data on [Hugging
Face](https://huggingface.co/datasets/badlogicgames/pi-mono), which is an
unusually honest thing for an open-source agent to do. You can watch real
sessions, including the failed ones.

The secondary user is anyone who wants:

- A coding agent they can actually hack on. No MCP, no cloud account, no
  sub-agent frameworks to learn. The whole thing is TypeScript in one repo.
- A minimal LLM client that isn't tied to a framework like LangChain. If you
  just want `stream({ model, context })` and no opinions about agents,
  prompt templates, or chains — `pi-ai` is that.
- An embeddable agent runtime. If you're building a product that wraps
  LLM+tools, `pi-agent-core` is small enough to read in an afternoon.

## What it is not

Worth being explicit about a few things pi-mono is *not*, because the
absences shape the design:

- **Not an MCP client.** The README calls this out — MCP is implemented "as
  extensions, not built-in". The rationale is in chapter 3.
- **Not a plan / reflect / subagent framework.** There is no `plan()` phase,
  no "reflection" step, no subagents by default. If you want those, you add
  an extension.
- **Not a browser agent, not a "computer use" agent.** The built-in tools
  are `read`, `write`, `edit`, `bash`, and a few grep/find helpers. Anything
  else is an extension.
- **Not a framework.** There's no plugin marketplace, no config DSL, no YAML
  other than the frontmatter in a skill file. "Configuration" is
  `settings.json` and "customization" is TypeScript.

## What this book will cover

Everything. The stack from bottom to top, the decisions that made each layer
look the way it does, and — where I can find it — the intuition behind
choices that might not be obvious from the code alone.

Chapter 2 opens the lid: the shape of the monorepo itself, how the workspace
is wired, and why the build script is a shell `cd` pipeline instead of Turbo
or Nx.
