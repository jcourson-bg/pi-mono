export const theme = {
  bg: "#0b0f1e",
  bgPanel: "#121831",
  bgPanelDeep: "#0d1226",
  border: "#1f2a4a",
  borderStrong: "#2b3a66",
  text: "#e7ecff",
  textMuted: "#98a3c9",
  textDim: "#5c6891",
  mono: '"JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  sans: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  accent: {
    pink: "#ff7ab3",
    teal: "#22d3ee",
    amber: "#fbbf24",
    lime: "#a3e635",
    violet: "#a78bfa",
    blue: "#60a5fa",
    rose: "#fb7185",
  },
} as const;

export const packages = [
  {
    name: "pi-ai",
    tagline: "Unified multi-provider LLM API",
    color: theme.accent.teal,
  },
  {
    name: "pi-agent-core",
    tagline: "Agent runtime with tool calling",
    color: theme.accent.violet,
  },
  {
    name: "pi-coding-agent",
    tagline: "Interactive CLI coding agent",
    color: theme.accent.pink,
  },
  {
    name: "pi-tui",
    tagline: "Terminal UI with differential rendering",
    color: theme.accent.amber,
  },
  {
    name: "pi-web-ui",
    tagline: "Web components for AI chat",
    color: theme.accent.lime,
  },
  {
    name: "pi-mom",
    tagline: "Slack bot wrapping the coding agent",
    color: theme.accent.rose,
  },
  {
    name: "pi-pods",
    tagline: "CLI for vLLM GPU deployments",
    color: theme.accent.blue,
  },
];
