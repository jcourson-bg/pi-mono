import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { SceneHeader } from "../components/SceneHeader";
import { theme } from "../theme";

// Horizontal pipeline: User → AgentSession → pi-agent-core → Tool → pi-ai → LLM, then a return arrow loop.
const stations = [
  { label: "User prompt", sub: "TUI · RPC · Slack", color: theme.accent.pink },
  { label: "AgentSession", sub: "session-manager.ts", color: theme.accent.rose },
  { label: "agentLoop", sub: "pi-agent-core", color: theme.accent.violet },
  { label: "Tool", sub: "bash · edit · read", color: theme.accent.amber },
  { label: "stream()", sub: "pi-ai", color: theme.accent.teal },
  { label: "LLM", sub: "Claude · GPT · Gemini", color: theme.accent.lime },
];

export const S07_ToolFlow: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const outro = interpolate(frame, [durationInFrames - fps, durationInFrames], [0, 1], {
    easing: Easing.in(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const n = stations.length;
  const xs = stations.map((_, i) => 150 + i * ((1920 - 300) / (n - 1)));
  const y = 620;

  // Forward sweep fills each station and the arrow to the next one.
  const sweepStart = fps * 0.6;
  const sweepPerStation = 10;
  const showReturn = frame > sweepStart + sweepPerStation * n + 10;
  const returnProgress = interpolate(
    frame,
    [sweepStart + sweepPerStation * n + 10, sweepStart + sweepPerStation * n + 60],
    [0, 1],
    {
      easing: Easing.bezier(0.45, 0, 0.55, 1),
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  return (
    <Backdrop>
      <AbsoluteFill style={{ opacity: 1 - outro }}>
        <SceneHeader
          eyebrow="05 · data flow"
          title="One tool call, end to end"
          accent={theme.accent.pink}
        />

        {/* Forward path */}
        <svg
          width={1920}
          height={1080}
          style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
        >
          {stations.slice(0, -1).map((_, i) => {
            const start = sweepStart + i * sweepPerStation + 6;
            const end = start + sweepPerStation;
            const p = interpolate(frame, [start, end], [0, 1], {
              easing: Easing.bezier(0.16, 1, 0.3, 1),
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            const x1 = xs[i] + 110;
            const x2 = xs[i + 1] - 110;
            const midX = x1 + (x2 - x1) * p;
            return (
              <g key={`fwd-${i}`}>
                <line x1={x1} y1={y} x2={x2} y2={y} stroke={theme.border} strokeWidth={2} />
                <line
                  x1={x1}
                  y1={y}
                  x2={midX}
                  y2={y}
                  stroke={theme.accent.teal}
                  strokeWidth={4}
                />
                {p > 0.05 && (
                  <circle cx={midX} cy={y} r={8} fill={theme.accent.teal} />
                )}
              </g>
            );
          })}

          {/* Return arc */}
          {showReturn &&
            stations.slice(0, -1).map((_, i) => {
              const idx = stations.length - 2 - i;
              const start = idx / (n - 1);
              const end = (idx + 1) / (n - 1);
              const segStart = start;
              const segEnd = end;
              const localP = Math.min(1, Math.max(0, (returnProgress - segStart) / (segEnd - segStart)));
              const x1 = xs[idx + 1];
              const x2 = xs[idx];
              const arcY = y - 220;
              const midX = x1 + (x2 - x1) * localP;
              const midY = y - 220 * (4 * localP * (1 - localP));
              return (
                <g key={`back-${i}`}>
                  <path
                    d={`M ${x1} ${y - 70} Q ${(x1 + x2) / 2} ${arcY} ${x2} ${y - 70}`}
                    stroke={theme.border}
                    strokeWidth={2}
                    fill="none"
                    strokeDasharray="4 8"
                  />
                  {localP > 0.02 && localP < 1 && (
                    <circle cx={midX} cy={midY - 70} r={6} fill={theme.accent.pink} />
                  )}
                </g>
              );
            })}
        </svg>

        {/* Stations */}
        {stations.map((s, i) => {
          const stationStart = sweepStart + i * sweepPerStation;
          const p = interpolate(frame, [stationStart, stationStart + 12], [0, 1], {
            easing: Easing.bezier(0.22, 1, 0.36, 1),
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          const scale = interpolate(p, [0, 1], [0.8, 1]);
          const lit =
            frame >= stationStart + 4 && frame <= stationStart + sweepPerStation + 6;
          return (
            <div
              key={s.label}
              style={{
                position: "absolute",
                left: xs[i] - 110,
                top: y - 80,
                width: 220,
                height: 160,
                borderRadius: 20,
                backgroundColor: theme.bgPanel,
                border: `2px solid ${lit ? s.color : theme.border}`,
                opacity: p,
                transform: `scale(${scale})`,
                padding: "18px 14px",
                textAlign: "center",
                boxShadow: lit ? `0 0 48px ${s.color}55` : "none",
              }}
            >
              <div
                style={{
                  fontFamily: theme.sans,
                  fontWeight: 800,
                  fontSize: 24,
                  color: s.color,
                }}
              >
                {s.label}
              </div>
              <div
                style={{
                  fontFamily: theme.mono,
                  fontSize: 15,
                  color: theme.textMuted,
                  marginTop: 10,
                  lineHeight: 1.4,
                }}
              >
                {s.sub}
              </div>
            </div>
          );
        })}

        {/* Label for return arrow */}
        <div
          style={{
            position: "absolute",
            top: y - 340,
            left: 0,
            right: 0,
            textAlign: "center",
            fontFamily: theme.mono,
            fontSize: 22,
            color: theme.accent.pink,
            opacity: interpolate(
              frame,
              [sweepStart + sweepPerStation * n + 14, sweepStart + sweepPerStation * n + 30],
              [0, 1],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
            ),
            letterSpacing: 3,
            textTransform: "uppercase",
          }}
        >
          tool result streams back · session persists as JSONL
        </div>
      </AbsoluteFill>
    </Backdrop>
  );
};
