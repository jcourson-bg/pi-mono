# 18. Adding a new LLM provider

If pi-mono lives or dies by "we talk to every LLM worth talking to,"
then adding a new provider needs to be a well-worn path. It is. The
author documented it in AGENTS.md and the codebase has guardrails to
make sure you don't forget a step.

This chapter walks the path. If you're adding a real provider while
reading this, treat it as a checklist.

## The seven-file tour

AGENTS.md's own list:

1. `packages/ai/src/types.ts` — add API id, options interface,
   KnownProvider name.
2. `packages/ai/src/providers/<name>.ts` — the implementation.
3. `packages/ai/package.json` + `src/index.ts` + `src/providers/
   register-builtins.ts` — exports and lazy registration.
4. `packages/ai/src/env-api-keys.ts` — credential detection.
5. `packages/ai/scripts/generate-models.ts` — model list generation.
6. `packages/ai/test/*.test.ts` — lots of them.
7. `packages/coding-agent/` — default model entry and env-var docs.

That's it. Seven places; none of them are architectural.

## 1. Core types

`packages/ai/src/types.ts` maintains three string unions:

- `Api` — every provider's API identifier. For example,
  `"anthropic-messages"`, `"openai-completions"`,
  `"openai-responses"`, `"bedrock-converse-stream"`.
- `KnownProvider` — the user-facing name.
- `ApiOptionsMap` — maps each `Api` to its options type.

Adding a provider is adding three entries (or subsets of them if a
provider shares an API with another). Also add an options interface
extending `StreamOptions`:

```ts
export interface FooStreamOptions extends StreamOptions {
  baseURL?: string;
  customHeader?: string;
}

export type Api =
  | ...
  | "foo-chat";

export type ApiOptionsMap = {
  ...
  "foo-chat": FooStreamOptions;
};

export type KnownProvider =
  | ...
  | "foo";
```

## 2. Provider implementation

`packages/ai/src/providers/foo.ts` is the meat. It must export:

- `streamFoo(model, context, options)` — returns
  `AssistantMessageEventStream`.
- `streamSimpleFoo(...)` — a variant for `SimpleStreamOptions`.
- The `FooStreamOptions` interface (re-exported here for providers
  that want it).
- Helpers to convert `Context.messages` → provider native format.
- Helpers to convert `Context.tools` → provider native format.
- A response parser that consumes the provider's stream (SSE,
  WebSocket, or JSON-in-HTTP) and emits pi-ai events (`text`,
  `tool_call`, `thinking`, `usage`, `stop`/`error`).

The existing providers are templates. Start with whichever is
closest in spirit:

- **OpenAI-compatible?** Copy `openai-completions.ts`. Most
  providers in the wild are OpenAI-compatible; this covers Groq,
  Cerebras, xAI, z.ai, MiniMax, AI Gateway, OpenRouter, and more.
- **Anthropic-style messages API?** `anthropic.ts`. Deep thinking,
  cache control, tool use blocks.
- **Google Gemini-style?** `google-gemini.ts`, or `google-gemini-cli.ts`
  if you need OAuth + reasoning interleaving.
- **Something novel?** `amazon-bedrock.ts` handles the Converse
  API; `openai-codex-responses.ts` handles Codex-flavored reasoning.

## 3. Registration and lazy loading

`packages/ai/package.json` needs a subpath export:

```json
"exports": {
  ".": "./dist/index.js",
  "./foo": "./dist/providers/foo.js",
  ...
}
```

This lets downstream code do `import { streamFoo } from
"@mariozechner/pi-ai/foo"`.

`packages/ai/src/index.ts` re-exports types consumers might want:

```ts
export type { FooStreamOptions } from "./providers/foo.js";
```

But **not the implementation functions**. Leave those lazy.

`packages/ai/src/providers/register-builtins.ts` is where the lazy
registration happens. Add a module-level promise and wrapper
factories:

```ts
let fooProviderModulePromise: Promise<FooProviderModule> | undefined;

const lazyStreamFoo = createLazyStream(
  () => (fooProviderModulePromise ||= import("./foo.js").then(m => ({
    stream: m.streamFoo,
    streamSimple: m.streamSimpleFoo,
  }))),
);

// in registerBuiltInApiProviders():
registerApiProvider({ api: "foo-chat", stream: lazyStreamFoo, ... });
```

The `||=` is the whole lazy mechanism. Calling `lazyStreamFoo()`
triggers the import the first time; subsequent calls reuse the
resolved promise. No provider module is loaded unless actually
needed.

## 4. Credential detection

`packages/ai/src/env-api-keys.ts` maps `KnownProvider` names to env
vars:

```ts
foo: {
  envVars: ["FOO_API_KEY"],
  description: "Foo API key",
}
```

If the env var is present, pi treats it as the provider's
credential. If auth flows exist (OAuth, cloud SDK), this file also
drives the fallback order.

## 5. Model generation

`packages/ai/scripts/generate-models.ts` is a build-time script that
fetches each provider's model list and writes
`packages/ai/src/models.generated.ts`. You add logic to fetch Foo's
models (usually an API call to `foo.com/v1/models`), map each to
the `Model` type, and include them in the generated output.

The `Model` type has:

```ts
{
  provider: "foo",
  api: "foo-chat",
  id: "foo-pro-v1",
  contextWindow: 131072,
  cost: {
    input: 3.0,    // $ per million tokens
    output: 12.0,
    cacheRead: 0.3,
    cacheWrite: 3.75,
  },
  // capabilities: supportsThinking, supportsImages, etc.
}
```

The model file is regenerated by `npm run generate-models` in
`packages/ai`. It's not checked in from your CI — the author runs it
locally when a new provider adds or renames models and commits the
result.

## 6. Tests

AGENTS.md lists eleven test files every new provider must appear in.
Every one:

| test | what it checks |
|---|---|
| `stream.test.ts` | Basic streaming works. |
| `tokens.test.ts` | Usage is reported and plausible. |
| `abort.test.ts` | Abort mid-stream cleanly. |
| `empty.test.ts` | Empty messages and empty responses don't crash. |
| `context-overflow.test.ts` | Overflow is detected correctly. |
| `image-limits.test.ts` | Images of allowed sizes work; oversized fail gracefully. |
| `unicode-surrogate.test.ts` | Unpaired surrogates don't leak into API calls. |
| `tool-call-without-result.test.ts` | Missing tool result gets synthetic injection. |
| `image-tool-result.test.ts` | Tool results with images survive if supported. |
| `total-tokens.test.ts` | Total usage = input + output (cached excluded). |
| `cross-provider-handoff.test.ts` | Conversations from other providers feed this one. |

Adding a provider is not a one-file change. It's touching each of
these, adding a case for the new provider, and running them with
a real API key to make sure your provider passes.

## 7. Coding agent integration

Three touches in `packages/coding-agent/`:

- `src/core/model-resolver.ts` — add a default model id so the CLI
  can resolve a bare `--provider foo` without a model.
- `src/cli/args.ts` — add the env-var documentation to the `--help`
  output.
- `README.md` — add a "Foo" section with setup instructions.

## 8. Documentation

- `packages/ai/README.md` — add Foo to the providers table,
  document options, auth, env vars.
- `packages/ai/CHANGELOG.md` — add an entry under `[Unreleased]`.

## What the pattern means

AGENTS.md calls out one thing worth emphasizing:

> Add `export type` re-exports in `packages/ai/src/index.ts` for
> provider option types that should remain available from the root
> entry.
>
> Register the provider in `register-builtins.ts` via lazy loader
> wrappers, **do not statically import provider implementation
> modules there**.

Violating the "lazy import" rule is the one way to screw up adding
a provider. If you statically import `./foo.js` in
`register-builtins.ts`, you pay the Foo SDK load cost every time
anyone loads pi-ai — in a browser, in serverless, in test. The
lazy pattern keeps the overhead zero for providers you don't use.

## Non-standard auth

If Foo has weird auth (AWS-style signed requests, OAuth with
unusual flows, token exchange with a separate auth endpoint), the
convention is:

1. A utility file: `src/providers/foo-utils.ts` with credential
   detection and request signing.
2. Usage from inside `foo.ts`, not from the general auth layer.

Bedrock does this (`bedrock-utils.ts`); OAuth providers do it via
`src/utils/oauth/<provider>.ts`. The pattern is: provider-specific
quirks live next to the provider; the general auth layer stays
simple.

## In one paragraph

Adding a provider touches seven files, each in a specific way. The
guardrails — lazy loading via `register-builtins.ts`, eleven tests
that new providers must appear in, credential detection in one
file — make sure you can't add a provider that silently breaks the
bundle size, the test coverage, or the existing providers'
cross-handoff. The pattern is explicit, procedural, and well-worn.

Next: testing agents without spending money.
