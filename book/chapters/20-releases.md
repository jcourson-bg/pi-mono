# 20. Release engineering

Releases are the thing every monorepo eventually has to decide about.
pi-mono's answer is the shortest possible one: **every package ships
together, every time, with the same version number**.

## Lockstep versioning

From AGENTS.md:

> Lockstep versioning: All packages always share the same version
> number. Every release updates all packages together.

This is uncommon. Most monorepos use per-package versioning with
tools like Changesets or Lerna to track which packages need a bump
based on which files changed. Pi-mono does the opposite: if you ship
a patch release, all seven packages get patched — even the ones
that didn't change in the release window.

The tradeoff:

- **Cost**: noisier npm releases, more version bumps, more
  changelog entries (some saying "no changes this cycle").
- **Benefit**: the version number is a commit label.
  `pi-ai@0.67.1` and `pi-coding-agent@0.67.1` are literally from the
  same commit on main. No compatibility matrix, no wondering which
  agent version needs which ai version.

For a tightly integrated product like pi, this is the right
tradeoff.

## No major versions

Also from AGENTS.md:

> Version semantics (no major releases):
>
> - `patch`: Bug fixes and new features
> - `minor`: API breaking changes

Breaking changes ship as minor bumps while the project is in the
0.x range. This is mild semver abuse but explicit; since you pin
with `^0.67.1` you're only locked to patch levels within
`0.67.x`. Every minor bump is a conscious upgrade step.

Changelogs in `packages/*/CHANGELOG.md` spell out what changed.

## The release scripts

Root `package.json`:

```json
"version:patch": "npm version patch -ws --no-git-tag-version && node scripts/sync-versions.js && shx rm -rf node_modules packages/*/node_modules package-lock.json && npm install",
"version:minor": "npm version minor -ws --no-git-tag-version && node scripts/sync-versions.js && shx rm -rf node_modules packages/*/node_modules package-lock.json && npm install",
```

Step by step:

1. `npm version patch -ws --no-git-tag-version` — bumps every
   workspace package's version in its own `package.json`.
2. `node scripts/sync-versions.js` — walks dependents and updates
   their `dependencies:` pins to match. So if `pi-coding-agent`
   depends on `pi-ai`, the new `pi-coding-agent@0.67.2` now has
   `"@mariozechner/pi-ai": "^0.67.2"`.
3. Nuke `node_modules` and the lockfile.
4. `npm install` to resolve everything fresh.

The script `release.mjs` wraps this with changelog finalization
(adds a date to `[Unreleased]` and opens a new `[Unreleased]`
section), commits, tags, and publishes.

## The `prepublishOnly` guard

```json
"prepublishOnly": "npm run clean && npm run build && npm run check"
```

Before any publish, npm runs `prepublishOnly`. The guard:

- Cleans every package.
- Builds everything (in the correct order per the `cd` pipeline).
- Runs Biome + tsgo type check.

If any of that fails, publish aborts. Versions don't ship unless
the repo can build and pass lint from scratch.

## The changelog discipline

Every package has its own `CHANGELOG.md` with `[Unreleased]` at the
top. Contributions add to the appropriate subsection under
`[Unreleased]`:

- `### Breaking Changes` — API changes requiring migration
- `### Added` — new features
- `### Changed` — changes to existing functionality
- `### Fixed` — bug fixes
- `### Removed` — removed features

AGENTS.md enforces rules:

> Before adding entries, read the full `[Unreleased]` section to see
> which subsections already exist.
>
> New entries ALWAYS go under `## [Unreleased]` section.
>
> Append to existing subsections, do not create duplicates.
>
> NEVER modify already-released version sections. Each version
> section is immutable once released.

At release time, the script renames `[Unreleased]` to `[0.67.2]`
with the date, and adds a fresh empty `[Unreleased]` at the top.

Attribution rules:

- Internal changes (from issues): `Fixed foo bar
  ([#123](.../issues/123))`.
- External contributions: `Added feature X ([#456](.../pull/456)
  by [@user](.../user))`.

## The OSS weekend script

There's a separate, unrelated release-adjacent script:
`scripts/oss-weekend.mjs`. pi-mono has an explicit "OSS weekend"
policy where the issue tracker closes from Monday to the following
Monday each week. During OSS weekend, `.github/workflows/oss-weekend-
issues.yml` auto-closes new issues from non-maintainers, and
`.github/workflows/pr-gate.yml` auto-closes PRs from approved
non-maintainers with a weekend message.

The README's top-of-file block gets updated every week by running the
oss-weekend script with `--mode=close --end-date=...` or `--mode=
open`. It's a small piece of maintenance automation that's not really
"release" but lives in the same scripts directory.

## Publishing

```sh
npm run publish
```

Runs `prepublishOnly` then `npm publish -ws --access public`. Every
workspace package publishes to npm in parallel. `--access public`
because the `@mariozechner` scope is scoped (scoped packages default
to private on npm).

`npm run publish:dry` is the same thing with `--dry-run` so you can
verify the diff before actually pushing bits to npm.

## Tags and Git

The version scripts use `--no-git-tag-version` explicitly; tagging
happens in `release.mjs` after the commit. One commit per release,
one tag per release, all packages bumped in that one commit.

`git log --oneline` shows the release cadence clearly:

```
e3247c4 book: add preface and chapters 1-14
49ed95e Add Remotion-based architecture walkthrough video
efc58fe Add [Unreleased] section for next cycle
5326452 Release v0.67.1
0fa9539 fix(coding-agent): correct changelog heading for startup notes
```

Every `Release` commit is a clean tag point. Every `[Unreleased]`
commit opens the next cycle.

## What pi-mono chose not to do

- **No automated release notes from PR titles.** Changelogs are
  hand-curated. The author prefers prose that names the *why* over
  auto-generated lists of commit subjects.
- **No beta / rc channel.** The project ships to `latest` directly.
  Users who want stability pin to a specific version; users who
  want the latest run `@latest`.
- **No changesets for "only some packages changed."** All packages
  bump. See above.

## In one paragraph

pi-mono releases are lockstep: every package at the same version,
every time. The mechanism is `npm version -ws` across the workspace
plus a `sync-versions.js` script that rewrites inter-package
dependencies; `prepublishOnly` enforces a clean build and type
check; changelogs are hand-curated with a formal `[Unreleased]` →
`[X.Y.Z]` promotion. It's deliberately simple, trusting that the
author would rather bump all seven packages than maintain an
inter-package compatibility matrix.

The core chapters end here. Three appendices follow.
