# Preface

I read pi-mono the same way I read any interesting codebase: I start in the
README, jump to the entry points, and then chase the interesting nouns —
`Agent`, `Context`, `Session`, `Tool` — until I understand what the authors
were actually thinking. This book is the notes from one of those passes, cleaned
up and put in an order that should be readable on its own.

## Who this is for

* People **using** pi as an end-user who want to understand what's happening
  under the hood.
* People **building** on top of pi-mono — custom extensions, custom providers,
  embedding `pi-agent-core` in another product, or porting pieces of `pi-tui`
  into a non-pi tool.
* People **learning** how modern agent systems are actually wired. pi-mono is
  small, honest, and readable — a better study subject than a 50-service cloud
  stack.

## What I'm assuming

You've written some TypeScript. You know what a REPL is. You've used at least
one LLM SDK (OpenAI, Anthropic, Gemini, whatever). You don't need to know
anything about terminal escape sequences, JSONL, or agent loops going in.

## How to read it

Linearly is fine. Each chapter is short and self-contained enough that
jumping straight to chapter 10 ("Sessions as JSONL trees") or chapter 6
("pi-tui") also works.

Code references point at specific files, sometimes with line numbers. Line
numbers are a snapshot — code moves — but the landmarks they point to (a
function name, a type definition, a particular `if` branch) should stay
recognizable.

## What this book is *not*

It's not the API reference. That's what
[the package READMEs](../../packages/) are for.

It's not a tutorial. You will learn things by reading it, but nobody is going
to hold your hand through "run `npm install` and see what happens".

It's not a marketing brochure. If I think a design decision is weird or a
tradeoff is uncomfortable, I say so.

## A note on names

Every package in the repo is prefixed with `pi-` and published under the
`@mariozechner` npm scope. Inside the repo the packages live as
`packages/ai`, `packages/agent`, `packages/tui`, etc. — so `pi-agent-core`
lives at `packages/agent`, which tripped me up a few times. This book uses
whichever name is clearest in context and tries to be consistent inside each
chapter.

Let's go.
