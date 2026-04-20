# 19. Testing agents with the faux provider

Testing an agent is awkward because the agent's behavior depends on
what the LLM does, and what the LLM does depends on a billed-by-the-
token API you don't want running in CI. Worse, you want *determinism*
— the same test should pass or fail for the same reason every time —
but LLMs are probabilistic.

The standard fix, which pi-mono adopted, is a **faux provider**: a
stand-in for `pi-ai` that synthesizes deterministic LLM behavior from
a script you wrote in the test. No network, no API keys, no variance.

## Where tests live

Three layers have distinct test strategies:

### `packages/ai` — tests run against real providers

Files under `packages/ai/test/` are Vitest tests that expect real
API keys. `stream.test.ts`, `tokens.test.ts`,
`cross-provider-handoff.test.ts` — all of them hit real APIs when
keys are set.

The root `./test.sh` script filters them based on available keys:

```sh
# (paraphrased)
if [ -z "$ANTHROPIC_API_KEY" ]; then
  SKIP_ARGS="$SKIP_ARGS --test-name-pattern='^(?!.*anthropic)'"
fi
# ...
```

If you don't have Anthropic keys, Anthropic tests are skipped. The
CI is configured with keys for the major providers; a local dev run
with no keys silently runs only the provider-agnostic tests.

This is the right default for a library that *has to* talk to real
APIs. If Anthropic changes their streaming protocol tomorrow, pi-ai's
tests catch it before users notice.

### `packages/tui` — Node built-in test runner, no network

pi-tui tests have no external dependencies. They exercise the
rendering engine, the diff, the Kitty protocol fallback logic, the
overlay compositing, the input decoding. They run in CI every time.

### `packages/coding-agent/test/suite/` — faux provider

This is the interesting one.

## The faux provider

`packages/coding-agent/test/suite/harness.ts` and its companion
files build up a test harness that looks like a miniature pi-ai:
same types, same event stream shape, but the "LLM" is a scripted
sequence of events the test author writes.

Example (sketchy, but the shape is real):

```ts
const session = await createTestAgentSession({
  cwd: testDir,
  model: fauxModel,
  scenario: [
    { turn: 1, response: [
      { type: "text", text: "I'll check the readme." },
      { type: "tool_call", name: "read", args: { path: "README.md" } },
    ]},
    { turn: 2, response: [
      { type: "text", text: "The readme looks good. Here's a summary..." },
    ]},
  ],
});

await session.prompt("summarize the readme");
expect(session.messages.length).toBe(4);  // user, assistant, toolResult, assistant
```

The harness synthesizes events as if an LLM really produced them. The
agent loop processes them just like real events — validation runs,
before/after hooks fire, the tool executes for real (so `read`
actually reads your test fixture). You get a deterministic
end-to-end test of the agent's behavior without an LLM.

## What the faux provider cares about

The things tests want to verify:

1. **Tool call validation.** If the scripted tool call has bad
   arguments, does the agent react correctly?
2. **Permission hooks.** If `beforeToolCall` blocks, does the right
   thing happen?
3. **Parallel tool execution.** Did both tools run? In what order
   are results emitted?
4. **Session persistence.** Did the JSONL file get the right
   entries?
5. **Compaction.** Did compaction trigger at the expected token
   count? Did the summary message land where expected?
6. **Error handling.** If the scripted turn is an error, did the
   agent recover (or abort) properly?
7. **Extensions.** Do custom tools and event handlers fire?

The faux provider can script all of these. A scripted "error" turn
produces the same events an overflow would. A scripted tool call
with bad JSON exercises the validation path. Scripted cascades of
tool calls exercise the loop.

## Regression tests as issue reproducers

Also from AGENTS.md:

> Put issue-specific regressions under
> `packages/coding-agent/test/suite/regressions/` and name them
> `<issue-number>-<short-slug>.test.ts`.

An issue filed against pi gets a regression test in this directory.
The naming convention `123-compaction-loses-tool-result.test.ts`
links the test to the bug that created it. When someone "fixes"
something in the future, the test either keeps passing (good) or
starts failing (regression), and the test's name points at the
original bug.

## Running tests

From AGENTS.md:

> Run tests from the package root, not the repo root.

```sh
cd packages/coding-agent
npx tsx ../../node_modules/vitest/dist/cli.js --run test/suite/my-test.test.ts
```

That absurd command pattern exists because the workspace layout
makes `vitest` hard to invoke without a path. The root `./test.sh`
runs everything; individual-file runs need the verbose form.

## Test harness invariants

AGENTS.md also says:

> For `packages/coding-agent/test/suite/`, use `test/suite/harness.ts`
> plus the faux provider. Do not use real provider APIs, real API
> keys, or paid tokens.

Bright-line rule. Tests in the suite don't talk to real LLMs. Ever.
Not for convenience, not "just this once." Real-LLM tests go in
`packages/ai/`. The two worlds stay separated.

The reason: CI shouldn't be billable. If a contributor's PR
accidentally introduces a test that hits a real API, a fly-by-night
CI run can spend money. Keeping the suite pure means the coding
agent's test run can be zero-cost.

## What the faux provider doesn't replicate

- **Latency.** Real providers are slow; the faux provider is
  instant. Tests that care about timing (backpressure behavior, abort
  mid-stream) need to simulate delays manually.
- **Realistic token counts.** Scripted responses can claim any
  token count. Compaction tests pick numbers that trigger the
  logic; they don't mirror real usage patterns.
- **LLM quality effects.** The faux provider can't tell you if the
  real model would have written a good summary. That's a judgment
  call that needs real LLM evals (and pi-mono doesn't ship those —
  the Hugging Face dataset is the evaluator).

The faux provider is for testing the **framework**, not the **LLM**.
That distinction is worth keeping clear.

## In one paragraph

Coding-agent tests use a faux provider in `test/suite/harness.ts`
that feeds scripted event sequences into the same agent loop a real
LLM would — deterministic, free, and end-to-end correct. Regression
tests live in `test/suite/regressions/` named by issue number.
pi-ai's tests, separately, run against real providers when API keys
are set and skip cleanly when they're not. The two layers test
different things: the framework in one, the provider integration
in the other.

Last chapter of Part V: release engineering.
