# pi-mono architecture video

Animated walkthrough of the pi-mono monorepo and its SDK, built with
[Remotion](https://www.remotion.dev/) following the official
[Remotion agent skill](https://github.com/remotion-dev/skills).

The video is ten scenes (~77 s at 1920×1080, 30 fps) covering:

1. Title
2. Three headline numbers (7 packages, 20+ providers, agent runtime)
3. The seven packages as a grid
4. The layer stack (`pi-ai` → `pi-agent-core` → `pi-tui` → `pi-coding-agent`)
5. `pi-ai` — one API, many providers, with a code snippet
6. `pi-agent-core` — the agent loop as a walking cycle
7. A single tool call flowing end to end
8. The JSONL session tree with branching + `/fork`
9. Ecosystem satellites (`pi-coding-agent`, `pi-mom`, `pi-web-ui`, `pi-pods`)
10. Outro with install command

## Rendered video

`out/pi-mono.mp4` is the finished render.

## Develop

```bash
npm install
npm run dev         # open Remotion Studio
```

## Render

```bash
npx remotion render PiMono out/pi-mono.mp4
```

On a sandbox without internet, pass an existing Chromium:

```bash
npx remotion render PiMono out/pi-mono.mp4 \
  --browser-executable=/path/to/chromium
```

## Layout

```
src/
├── index.ts             # registerRoot
├── Root.tsx             # <Composition> definition
├── PiMonoVideo.tsx      # chains all scenes via <Series>
├── theme.ts             # colors, fonts, package metadata
├── components/
│   ├── Backdrop.tsx     # animated background
│   └── SceneHeader.tsx  # shared eyebrow + title
└── scenes/
    ├── S01_Title.tsx … S10_Outro.tsx
```

All animation is driven by `useCurrentFrame()` + `interpolate()` with
`Easing.bezier(...)` curves per the Remotion skill's guidance. No CSS
transitions.
