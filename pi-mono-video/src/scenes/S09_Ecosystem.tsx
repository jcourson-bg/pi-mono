import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { SceneHeader } from "../components/SceneHeader";
import { theme } from "../theme";

const satellites = [
  {
    name: "pi-coding-agent",
    tag: "pi CLI",
    detail: "interactive · print · rpc modes · extensions · skills",
    color: theme.accent.pink,
  },
  {
    name: "pi-mom",
    tag: "Slack bot",
    detail: "thread-aware · sandboxed via Docker",
    color: theme.accent.rose,
  },
  {
    name: "pi-web-ui",
    tag: "browser",
    detail: "lit components · Ollama, LM Studio, vLLM",
    color: theme.accent.lime,
  },
  {
    name: "pi-pods",
    tag: "GPU deploys",
    detail: "vLLM on GPU pods · model management",
    color: theme.accent.blue,
  },
];

export const S09_Ecosystem: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const outro = interpolate(frame, [durationInFrames - fps, durationInFrames], [0, 1], {
    easing: Easing.in(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const hubX = 960;
  const hubY = 640;
  const hubScale = interpolate(frame, [0, fps * 0.6], [0.7, 1], {
    easing: Easing.bezier(0.22, 1, 0.36, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const positions = [
    { x: 320, y: 400 },
    { x: 1600, y: 400 },
    { x: 320, y: 880 },
    { x: 1600, y: 880 },
  ];

  return (
    <Backdrop>
      <AbsoluteFill style={{ opacity: 1 - outro }}>
        <SceneHeader
          eyebrow="07 · ecosystem"
          title="Built on top, usable separately"
          accent={theme.accent.pink}
        />

        {/* Connections */}
        <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
          {positions.map((pos, i) => {
            const start = fps * 0.5 + i * 6;
            const p = interpolate(frame, [start, start + 18], [0, 1], {
              easing: Easing.bezier(0.16, 1, 0.3, 1),
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            const x = hubX + (pos.x - hubX) * p;
            const y = hubY + (pos.y - hubY) * p;
            return (
              <line
                key={`l-${i}`}
                x1={hubX}
                y1={hubY}
                x2={x}
                y2={y}
                stroke={satellites[i].color}
                strokeWidth={3}
                strokeDasharray="8 10"
                opacity={0.6}
              />
            );
          })}
        </svg>

        {/* Central hub */}
        <div
          style={{
            position: "absolute",
            left: hubX - 220,
            top: hubY - 100,
            width: 440,
            height: 200,
            borderRadius: 28,
            backgroundColor: theme.bgPanel,
            border: `2px solid ${theme.borderStrong}`,
            transform: `scale(${hubScale})`,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: `0 0 80px rgba(167,139,250,0.25)`,
          }}
        >
          <div
            style={{
              fontFamily: theme.mono,
              fontSize: 18,
              color: theme.textDim,
              letterSpacing: 4,
              textTransform: "uppercase",
            }}
          >
            core
          </div>
          <div
            style={{
              fontFamily: theme.sans,
              fontWeight: 800,
              fontSize: 36,
              color: theme.accent.teal,
              marginTop: 8,
            }}
          >
            pi-ai
          </div>
          <div
            style={{
              fontFamily: theme.sans,
              fontWeight: 800,
              fontSize: 28,
              color: theme.accent.violet,
              marginTop: 2,
            }}
          >
            + pi-agent-core
          </div>
        </div>

        {/* Satellites */}
        {satellites.map((s, i) => {
          const start = fps * 0.8 + i * 8;
          const p = interpolate(frame, [start, start + 22], [0, 1], {
            easing: Easing.bezier(0.22, 1, 0.36, 1),
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          const pos = positions[i];
          const scale = interpolate(p, [0, 1], [0.5, 1]);
          return (
            <div
              key={s.name}
              style={{
                position: "absolute",
                left: pos.x - 210,
                top: pos.y - 90,
                width: 420,
                height: 180,
                borderRadius: 22,
                backgroundColor: theme.bgPanel,
                border: `2px solid ${s.color}`,
                opacity: p,
                transform: `scale(${scale})`,
                padding: 26,
                boxShadow: `0 0 50px ${s.color}33`,
              }}
            >
              <div
                style={{
                  fontFamily: theme.mono,
                  fontSize: 16,
                  color: theme.textDim,
                  letterSpacing: 3,
                  textTransform: "uppercase",
                }}
              >
                {s.tag}
              </div>
              <div
                style={{
                  fontFamily: theme.sans,
                  fontWeight: 800,
                  fontSize: 36,
                  color: s.color,
                  marginTop: 6,
                }}
              >
                {s.name}
              </div>
              <div
                style={{
                  fontFamily: theme.mono,
                  fontSize: 18,
                  color: theme.textMuted,
                  marginTop: 10,
                  lineHeight: 1.4,
                }}
              >
                {s.detail}
              </div>
            </div>
          );
        })}
      </AbsoluteFill>
    </Backdrop>
  );
};
