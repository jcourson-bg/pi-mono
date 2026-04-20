# 2. The shape of the monorepo

Most modern TypeScript monorepos reach for Turbo or Nx on day one, pull in a
task graph, and from then on nobody in the team ever runs a build without
asking the graph to figure out what's dirty. pi-mono does not do this.

Here is the root `package.json` build script, in full, unedited:

```json
"build": "cd packages/tui && npm run build && cd ../ai && npm run build && cd ../agent && npm run build && cd ../coding-agent && npm run build && cd ../mom && npm run build && cd ../web-ui && npm run build && cd ../pods && npm run build"
```

It is a `cd` pipeline. It is exactly as long as it looks, and the order is
hand-maintained. This is the first thing that tells you something about the
codebase: the author thinks the set of packages is small enough to enumerate
in a shell one-liner, and the build dependency graph is stable enough not
to need tooling to model it.

## npm workspaces, nothing else

The workspace setup lives in the root `package.json`:

```json
"workspaces": [
  "packages/*",
  "packages/web-ui/example",
  "packages/coding-agent/examples/extensions/with-deps",
  "packages/coding-agent/examples/extensions/custom-provider-anthropic",
  "packages/coding-agent/examples/extensions/custom-provider-gitlab-duo",
  "packages/coding-agent/examples/extensions/custom-provider-qwen-cli"
]
```

`packages/*` picks up the seven production packages. The explicit entries
underneath pick up the handful of nested example extensions so that symlinked
dev dependencies resolve locally. That's the whole monorepo.

No `turbo.json`. No `nx.json`. No Bazel, no Pants, no lerna. The root
`package.json` and npm's built-in workspace resolver are the entire tooling
story.

## The compiler is `tsgo`, not `tsc`

Look at the root `devDependencies`:

```json
"@typescript/native-preview": "7.0.0-dev.20260120.1"
```

That's [`tsgo`](https://github.com/microsoft/typescript-go), the TypeScript
team's native port of the compiler (written in Go). The root `check` script:

```json
"check": "biome check --write --error-on-warnings . && tsgo --noEmit && npm run check:browser-smoke && cd packages/web-ui && npm run check"
```

`tsgo --noEmit` replaces the old `tsc --noEmit`. The motivation is pure
speed — tsgo is an order of magnitude faster on repos this size. The note in
the root README nudges everyone to run `npm run build` first so `.d.ts`
files exist for cross-package type checking: the `web-ui` package still uses
`tsc` because it depends on the output of the other packages.

## Biome is the only linter / formatter

`biome.json` is 28 lines. No ESLint, no Prettier, no `.editorconfig` fights.
The `npm run check` command lints, formats (with `--write`), and type-checks
in a single command. That's it.

The payoff is that contributors and AI agents alike have exactly one command
to run after touching code. AGENTS.md is explicit:

> After code changes (not documentation changes): `npm run check` (get full
> output, no tail). Fix all errors, warnings, and infos before committing.

## Lockstep versioning

The harder tooling decision: **every package always has the same version
number**. When you release, you release all seven packages at once.

From AGENTS.md:

> Lockstep versioning: All packages always share the same version number.
> Every release updates all packages together.

The release script (`scripts/release.mjs`) enforces this. The root
`package.json` has `version:patch`, `version:minor`, `version:major` scripts
that run `npm version -ws --no-git-tag-version` (bump all workspace
packages), then `node scripts/sync-versions.js` (which walks dependents and
updates the `dependencies:` pins to match), then wipes `node_modules` and
reinstalls to resolve the new pins.

The tradeoff: if you only changed `pi-ai`, you still cut a new `pi-tui`.
Package consumers who want only `pi-ai` pay for releases they don't care
about.

The benefit: **the version number is a commit label**. `pi-ai@0.30.4`,
`pi-coding-agent@0.30.4`, `pi-tui@0.30.4` are guaranteed to have been
released from the same commit on main. No need to maintain a compatibility
matrix ("this version of coding-agent wants these versions of the libs"),
because there is no matrix — every row is identical.

For a product that's tightly integrated end-to-end, this is the right
call.  For a library suite with independent consumers, it would be
frustrating.  pi-mono is firmly the first kind of repo, even though some of
its pieces are good libraries.

## No major versions

Also in AGENTS.md:

> Version semantics (no major releases):
>
> - `patch`: Bug fixes and new features
> - `minor`: API breaking changes

There's no `version:major` release step. Breaking changes ship as minor
bumps. This is legitimate semver abuse, but deliberate. The projects
haven't hit "1.0" and the author seems uninterested in the ritual. You're
pinned to exact versions (`^0.30.4` under semver rules pins you to `0.30.x`
for additive changes, but `0.x.y → 0.(x+1).0` is a free-for-all in semver).
The convention here is `minor = breaking`, and the `CHANGELOG.md` files in
each package tell you what actually changed.

## The test runners

- **pi-ai** uses Vitest. Lots of cross-provider tests that need real API
  keys to run (skipped gracefully when keys aren't present).
- **pi-tui** uses Node's built-in test runner.
- **pi-coding-agent** has its own `test/suite/` with a `harness.ts` and a
  "faux provider" that synthesizes deterministic LLM responses so suites
  run without network or paid tokens. More on that in chapter 19.

The root `./test.sh` is a 35-line shell script that skips provider-dependent
test files when no API keys are set. No fancy orchestration — `grep` for
skip markers, run what's left.

## `.pi/` — the agent's own config directory

The repo root has a `.pi/` directory. It is both:

1. **The project-scoped config the `pi` CLI itself uses** when you run it
   in this repo. Extensions, skills, settings for the repo's own agent.
2. **The published dataset** of coding sessions, under
   `.pi/hf-sessions/`. (These are gitignored locally but published
   separately to Hugging Face.)

Seeing `.pi/` at the root of the repo that *defines* pi is a funny kind of
self-reference: pi-mono uses pi to work on pi-mono.

## What the shape tells you

The tooling choices — npm workspaces instead of a task runner, tsgo
instead of tsc, biome instead of ESLint+Prettier, lockstep versioning,
shell-script build ordering — all point the same direction: **the repo is
sized to fit in one head**. The author is not trying to scale to a hundred
contributors. He is trying to keep friction low for one person (plus a few
agents) hacking across seven packages.

That choice has knock-on effects everywhere in the code. Interfaces are
small. Abstractions are thin. Names are short. When something looks
under-engineered, it's usually because being easy to read was worth more
than being generalized.

Chapter 3 pulls that thread: the explicit and implicit rules the codebase
follows about what *not* to build.
