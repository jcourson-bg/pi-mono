# Appendix B — File map

A reader's map of the repo. Not exhaustive; annotated with what each
important file contains.

## Repo root

```
pi-mono/
├── AGENTS.md                   # dev rules for humans and agents. Read this first.
├── CONTRIBUTING.md             # outward-facing contribution guide.
├── README.md                   # project overview, package table, OSS weekend banner.
├── biome.json                  # the only formatter/linter config.
├── package.json                # workspace definition, build/release scripts.
├── pi-test.sh                  # run pi from source anywhere in the system.
├── test.sh                     # run tests, skipping LLM-dependent ones without keys.
├── tsconfig.base.json          # shared TypeScript config.
├── .pi/                        # per-repo pi config. extensions, skills, session data.
├── scripts/
│   ├── release.mjs             # orchestrates a release cycle.
│   ├── sync-versions.js        # rewrites inter-package dep pins after a version bump.
│   ├── oss-weekend.mjs         # toggles OSS weekend banner + CI gates.
│   └── profile-coding-agent-node.mjs   # CPU profiler harness.
└── packages/                   # the real content.
```

## packages/ai (`@mariozechner/pi-ai`)

```
packages/ai/
├── src/
│   ├── index.ts                # public entry. re-exports types.
│   ├── types.ts                # Context, Message, Tool, Api, KnownProvider, events.
│   ├── api-registry.ts         # Map<Api, RegisteredApiProvider>, the runtime registry.
│   ├── models.ts               # calculateCost, getModel, getModels.
│   ├── models.generated.ts     # auto-generated. Per-provider model lists with costs.
│   ├── env-api-keys.ts         # env var → provider credential map.
│   ├── providers/
│   │   ├── register-builtins.ts  # lazy registration of every built-in provider.
│   │   ├── transform-messages.ts # cross-provider message transforms.
│   │   ├── anthropic.ts
│   │   ├── openai-completions.ts
│   │   ├── openai-responses.ts
│   │   ├── openai-codex-responses.ts
│   │   ├── google-gemini.ts
│   │   ├── google-gemini-cli.ts
│   │   ├── google-vertex.ts
│   │   ├── google-antigravity.ts
│   │   ├── amazon-bedrock.ts
│   │   ├── mistral.ts
│   │   ├── groq.ts
│   │   ├── cerebras.ts
│   │   ├── xai.ts
│   │   ├── openrouter.ts
│   │   ├── ai-gateway.ts
│   │   ├── minimax.ts
│   │   ├── azure-openai.ts
│   │   ├── copilot.ts
│   │   ├── opencode-zen.ts
│   │   ├── opencode-go.ts
│   │   ├── kimi.ts
│   │   └── bedrock-utils.ts, oauth/   # per-provider auth helpers.
│   └── utils/
│       ├── event-stream.ts     # EventStream<T, R> queue+promise hybrid.
│       ├── overflow.ts         # isContextOverflow, regex patterns.
│       ├── json-parse.ts       # parseStreamingJson for partial JSON.
│       ├── validation.ts       # validateToolCall via AJV.
│       ├── sanitize-unicode.ts # surrogate pair sanitizer.
│       └── oauth/index.ts      # OAuth provider registry + refresh.
├── scripts/
│   └── generate-models.ts      # fetches model lists, writes models.generated.ts.
└── test/
    ├── stream.test.ts
    ├── tokens.test.ts
    ├── abort.test.ts
    ├── empty.test.ts
    ├── context-overflow.test.ts
    ├── image-limits.test.ts
    ├── unicode-surrogate.test.ts
    ├── tool-call-without-result.test.ts
    ├── image-tool-result.test.ts
    ├── total-tokens.test.ts
    └── cross-provider-handoff.test.ts
```

## packages/agent (`@mariozechner/pi-agent-core`)

```
packages/agent/
└── src/
    ├── index.ts                # public entry: Agent, agentLoop, types.
    ├── types.ts                # AgentMessage, AgentTool, AgentLoopConfig, hooks.
    ├── agent.ts                # Agent class — mutable state machine, queue modes.
    ├── agent-loop.ts           # agentLoop, agentLoopContinue — core loop.
    └── proxy.ts                # streamProxy for routing through a backend.
```

## packages/tui (`@mariozechner/pi-tui`)

```
packages/tui/
└── src/
    ├── index.ts
    ├── tui.ts                  # the TUI class and render engine.
    ├── terminal.ts             # ProcessTerminal abstraction, Kitty/xterm setup.
    ├── terminal-image.ts       # Kitty/iTerm2 image encoding.
    ├── stdin-buffer.ts         # escape sequence reassembler.
    ├── keys.ts                 # semantic key decoder.
    ├── keybindings.ts          # KeybindingsManager.
    ├── utils.ts                # graphemeWidth, AnsiCodeTracker, caches.
    ├── autocomplete.ts         # file path / command autocomplete source.
    └── components/
        ├── text.ts
        ├── input.ts
        ├── editor.ts           # multi-line editor, undo, kill ring, paste markers.
        ├── markdown.ts
        ├── loader.ts
        ├── select-list.ts
        ├── settings-list.ts
        ├── image.ts
        ├── box.ts
        └── container.ts
```

## packages/coding-agent (`@mariozechner/pi-coding-agent`)

```
packages/coding-agent/
├── src/
│   ├── cli.ts                   # process.title, delegate to main.
│   ├── main.ts                  # orchestration: args, modes, sessions.
│   ├── index.ts                 # SDK export.
│   ├── cli/
│   │   └── args.ts              # argument parser with compound syntax.
│   ├── core/
│   │   ├── agent-session.ts     # extends Agent with session concerns.
│   │   ├── agent-session-runtime.ts  # cwd-bound services wrapper.
│   │   ├── session-manager.ts   # JSONL append-only persistence, tree walk.
│   │   ├── model-resolver.ts    # resolve --model flag to Model with fallback.
│   │   ├── auth-storage.ts      # ~/.pi/auth.json I/O with proper-lockfile.
│   │   ├── settings-manager.ts  # ~/.pi/settings.json + ./.pi/settings.json.
│   │   ├── resource-loader.ts   # discover extensions/skills/themes.
│   │   ├── skills.ts            # SKILL.md parser.
│   │   ├── sdk.ts               # createAgentSession factory for embedders.
│   │   ├── compaction/
│   │   │   ├── compaction.ts
│   │   │   └── utils.ts         # SUMMARIZATION_SYSTEM_PROMPT, token estimators.
│   │   ├── extensions/
│   │   │   ├── loader.ts        # jiti-based extension loading.
│   │   │   ├── runner.ts        # extension lifecycle (init, bind, destroy).
│   │   │   └── index.ts         # extension API surface.
│   │   └── tools/
│   │       ├── bash.ts
│   │       ├── read.ts
│   │       ├── write.ts
│   │       ├── edit.ts
│   │       ├── grep.ts
│   │       ├── find.ts
│   │       ├── ls.ts
│   │       └── index.ts
│   └── modes/
│       ├── interactive/        # TUI-based mode. Many components.
│       ├── print-mode.ts       # single-shot.
│       └── rpc/
│           ├── rpc-mode.ts     # stdin/stdout JSON-RPC loop.
│           └── rpc-types.ts    # command and event types.
└── test/
    └── suite/
        ├── harness.ts           # faux provider + test helpers.
        └── regressions/         # issue-specific regressions.
```

## packages/mom

```
packages/mom/
└── src/
    ├── main.ts                 # entry, channel state, run loop.
    ├── slack.ts                # Socket Mode handler.
    ├── agent.ts                # AgentRunner, system prompt, event plumbing.
    ├── events.ts               # file-system event watcher.
    ├── sandbox.ts              # host vs. docker executor.
    └── store.ts                # ChannelStore, dedup window.
```

## packages/web-ui

```
packages/web-ui/
├── src/
│   ├── index.ts
│   ├── ChatPanel.ts            # top-level composition.
│   ├── components/
│   │   ├── AgentInterface.ts
│   │   ├── MessageList.ts
│   │   ├── StreamingMessageContainer.ts
│   │   ├── MessageEditor.ts
│   │   ├── SandboxedIframe.ts   # the large one. postMessage bridge.
│   │   ├── Messages.ts
│   │   ├── ModelSelector.ts
│   │   ├── SettingsDialog.ts
│   │   ├── SessionListDialog.ts
│   │   ├── CustomProviderDialog.ts
│   │   ├── ApiKeyPromptDialog.ts
│   │   └── (artifact renderers)
│   ├── storage/
│   │   ├── app-storage.ts       # IndexedDB wrapper.
│   │   ├── sessions-store.ts
│   │   ├── settings-store.ts
│   │   ├── custom-providers-store.ts
│   │   └── provider-keys-store.ts
│   ├── tools/
│   │   └── artifacts/artifacts.ts
│   └── utils/
│       └── proxy-utils.ts       # CORS bypass.
└── example/                     # working demo app.
```

## packages/pods

```
packages/pods/
└── src/
    ├── cli.ts                  # command dispatcher.
    ├── config.ts               # ~/.pi/pods.json I/O.
    ├── types.ts                # Pod, GPU, Model interfaces.
    ├── model-configs.ts        # catalog of supported models.
    ├── ssh.ts                  # ssh helper.
    └── commands/
        ├── pods.ts             # pod setup / list / active.
        ├── models.ts           # start / stop / logs / list.
        └── prompt.ts           # pi agent <pod> shortcut.
```
