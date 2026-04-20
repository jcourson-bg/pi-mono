import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { SceneHeader } from "../components/SceneHeader";
import { theme } from "../theme";

// Four nodes arranged as a loop, with a marker that walks around the cycle.
const nodes = [
  { label: "stream LLM", sub: "text · tool_call · thinking", color: theme.accent.teal },
  { label: "validate args", sub: "TypeBox schema check", color: theme.accent.amber },
  { label: "execute tool", sub: "bash · read · edit · write", color: theme.accent.pink },
  { label: "append result", sub: "message → context", color: theme.accent.lime },
];

export const S06_AgentLoop: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const outro = interpolate(frame, [durationInFrames - fps, durationInFrames], [0, 1], {
    easing: Easing.in(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const cx = 1240;
  const cy = 620;
  const r = 300;
  const positions = nodes.map((_, i) => {
    const angle = -Math.PI / 2 + (i / nodes.length) * Math.PI * 2;
    return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r, angle };
  });

  const loopStart = fps * 1;
  const cyclesPerSecond = 0.45;
  const t = Math.max(0, frame - loopStart) / fps;
  const phase = (t * cyclesPerSecond) % 1;
  const markerAngle = -Math.PI / 2 + phase * Math.PI * 2;
  const mx = cx + Math.cos(markerAngle) * r;
  const my = cy + Math.sin(markerAngle) * r;
  const activeIdx = Math.floor(phase * nodes.length) % nodes.length;

  const sideIn = interpolate(frame, [0, fps * 0.8], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <Backdrop>
      <AbsoluteFill style={{ opacity: 1 - outro }}>
        <SceneHeader
          eyebrow="04 · pi-agent-core"
          title="An agent is just a loop"
          accent={theme.accent.violet}
        />

        {/* Code on the left */}
        <div
          style={{
            position: "absolute",
            top: 300,
            left: 100,
            width: 620,
            opacity: sideIn,
            transform: `translateX(${interpolate(sideIn, [0, 1], [-30, 0])}px)`,
          }}
        >
          <div
            style={{
              backgroundColor: theme.bgPanelDeep,
              border: `1px solid ${theme.borderStrong}`,
              borderRadius: 16,
              padding: 28,
              fontFamily: theme.mono,
              fontSize: 20,
              lineHeight: 1.6,
              color: theme.text,
            }}
          >
            <div style={{ color: theme.textDim, marginBottom: 8 }}>// packages/agent/src/agent-loop.ts</div>
            <div>
              <span style={{ color: theme.accent.pink }}>await</span>{" "}
              <span style={{ color: theme.accent.teal }}>agentLoop</span>({`{`}
            </div>
            <div>&nbsp;&nbsp;model, tools, context,</div>
            <div>
              &nbsp;&nbsp;
              <span style={{ color: theme.accent.amber }}>beforeToolCall</span>(call){` { /* gate */ }`},
            </div>
            <div>
              &nbsp;&nbsp;
              <span style={{ color: theme.accent.amber }}>afterToolCall</span>(res){` { /* override */ }`},
            </div>
            <div>&nbsp;&nbsp;onEvent: (ev) {"=> emit(ev)"},</div>
            <div>{`});`}</div>
          </div>
          <div
            style={{
              marginTop: 22,
              fontFamily: theme.sans,
              fontSize: 22,
              color: theme.textMuted,
              lineHeight: 1.5,
            }}
          >
            State machine with streaming events, permission hooks and tool queues.
            Works the same across every provider pi-ai supports.
          </div>
        </div>

        {/* Loop graph */}
        <svg
          width={1920}
          height={1080}
          style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
        >
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={theme.borderStrong}
            strokeWidth={2}
            strokeDasharray="6 10"
          />
          {positions.map((pos, i) => {
            const next = positions[(i + 1) % positions.length];
            return (
              <line
                key={`e-${i}`}
                x1={pos.x}
                y1={pos.y}
                x2={next.x}
                y2={next.y}
                stroke={theme.border}
                strokeWidth={1}
                opacity={0.5}
              />
            );
          })}
          {/* Marker */}
          <circle
            cx={mx}
            cy={my}
            r={18}
            fill={theme.accent.pink}
            opacity={interpolate(frame, [loopStart - 8, loopStart + 10], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            })}
          />
          <circle
            cx={mx}
            cy={my}
            r={34}
            fill="none"
            stroke={theme.accent.pink}
            strokeWidth={2}
            opacity={0.4}
          />
        </svg>

        {positions.map((pos, i) => {
          const active = i === activeIdx && frame >= loopStart;
          return (
            <div
              key={nodes[i].label}
              style={{
                position: "absolute",
                left: pos.x - 170,
                top: pos.y - 60,
                width: 340,
                height: 120,
                borderRadius: 18,
                backgroundColor: theme.bgPanel,
                border: `2px solid ${active ? nodes[i].color : theme.border}`,
                padding: "18px 22px",
                boxShadow: active ? `0 0 42px ${nodes[i].color}55` : "none",
                transition: "none",
              }}
            >
              <div
                style={{
                  fontFamily: theme.mono,
                  fontSize: 16,
                  color: theme.textDim,
                  letterSpacing: 2,
                  textTransform: "uppercase",
                }}
              >
                step {i + 1}
              </div>
              <div
                style={{
                  fontFamily: theme.sans,
                  fontWeight: 800,
                  fontSize: 26,
                  color: active ? nodes[i].color : theme.text,
                  marginTop: 4,
                }}
              >
                {nodes[i].label}
              </div>
              <div
                style={{
                  fontFamily: theme.mono,
                  fontSize: 16,
                  color: theme.textMuted,
                  marginTop: 4,
                }}
              >
                {nodes[i].sub}
              </div>
            </div>
          );
        })}
      </AbsoluteFill>
    </Backdrop>
  );
};
