# Appendix C — The rules pi-mono seems to follow

A condensed version of the intuitions scattered throughout the book.
Not a style guide; closer to the shape of the codebase's taste.
Lifted from AGENTS.md where applicable, and inferred from the code
elsewhere.

## Architecture

1. **Start with the minimum. Add nothing until a concrete use forces
   you to.** The agent ships with `read`, `write`, `edit`, `bash` and
   no more.

2. **Everything beyond the minimum is an extension, not a feature.**
   MCP, plan mode, subagents, memory files — all extensions, none
   in the core.

3. **One way to do things.** Global `~/.pi/settings.json`, project
   `./.pi/settings.json`, deep merge, project wins. That's the whole
   config system.

4. **The event stream is the contract.** Every layer emits an async
   iterator of discriminated events. Errors travel as events; only
   caller mistakes throw.

5. **Sessions are JSONL files.** Nothing more sophisticated than
   append-only line-delimited JSON.

6. **Cross-provider fidelity is a feature.** Engineering time goes
   into making a conversation started on one provider feed another
   provider correctly.

## Code

7. **No `any`.** If the compiler complains, fix the code or upgrade
   the dependency — don't widen the type.

8. **Never use inline imports or dynamic imports for types.**
   Standard top-level imports only.

9. **Check `node_modules` for external API types. Don't guess.**

10. **Write no comments by default.** Add one only when the *why* is
    non-obvious. Don't describe what the code does; the code does
    that.

11. **Extract a function after the third copy, not before.** Three
    similar lines is better than a premature abstraction.

12. **No `try`/`catch` for errors that aren't really exceptions.**
    Put them in the event stream instead.

## Input and UI

13. **Never hardcode key checks.** All keybindings go through
    `KeybindingsManager` with configurable names.

14. **Render width is a hard contract.** A component returning a
    line wider than the provided width is a bug, and pi-tui hard-
    fails.

15. **Line-level diff is enough.** Cell-level diffing is not worth
    the complexity.

16. **Wrap every render in CSI 2026.** Modern terminals understand
    it; old ones ignore it cleanly.

## Tests

17. **Real API tests and framework tests never mix.** pi-ai tests
    hit real providers (when keys are set); coding-agent tests use
    a faux provider and never touch the network.

18. **Issue regressions get their own test file, named by issue
    number.** `123-short-slug.test.ts`.

19. **Tests run from their package root.** Not from the repo root.

## Git and releases

20. **Lockstep versions.** Every package always shares the same
    version. No exceptions.

21. **`minor` is breaking, `patch` is additive.** No major releases
    until we leave 0.x. Breaking changes are deliberately minor
    bumps.

22. **Changelogs are hand-curated.** Under `[Unreleased]` until
    release day; frozen thereafter.

23. **`prepublishOnly` guards every release.** Clean + build +
    check, or nothing ships.

24. **Only commit files you actually changed.** Never `git add -A`
    or `git add .`. The repo is deliberately structured for parallel
    work; sweeping stages sweep up other people's work.

25. **Never force push, never `--no-verify`.** Full stop.

## Extensions and trust

26. **Extensions run unsandboxed.** The trust model is "you
    installed it." Don't install extensions you don't trust.

27. **Backward compatibility is opt-in.** Don't add compat shims
    unless asked. Don't delete load-bearing code without asking.

## Process and communication

28. **Always read all comments on an issue before acting.**

29. **Write the full comment to a temp file before posting to
    GitHub.** Never pass multi-line markdown via `--body` in shell.

30. **Post exactly one final comment per task unless the user
    asked for multiple.**

31. **Close issues via commit message** (`fixes #123`).

32. **Keep comments technical and in the user's tone.** No filler.

## The overarching rule

33. **The repo is sized to fit in one head.** Every decision above
    is downstream of this. If something makes the repo feel smaller
    and more readable, it's probably right. If it makes the repo
    more general, more abstracted, more "future-proof," it's
    probably wrong.

---

If this list feels prescriptive, that's because lists of rules
always do. In practice the code reads less like "we followed these
rules" and more like "these rules describe the way we ended up
writing code." The author wrote what felt right, and this is what
felt right often enough to become habit.

Read the code. It's the real reference.
