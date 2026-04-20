import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { theme } from "../theme";

export const S10_Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const p = interpolate(frame, [0, fps * 0.8], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const ty = interpolate(p, [0, 1], [30, 0]);

  return (
    <Backdrop>
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          opacity: p,
          transform: `translateY(${ty}px)`,
        }}
      >
        <div
          style={{
            fontFamily: theme.mono,
            fontSize: 26,
            color: theme.textMuted,
            letterSpacing: 6,
            textTransform: "uppercase",
            marginBottom: 28,
          }}
        >
          start here
        </div>
        <div
          style={{
            fontFamily: theme.mono,
            fontWeight: 800,
            fontSize: 76,
            letterSpacing: -2,
            background: `linear-gradient(120deg, ${theme.accent.teal}, ${theme.accent.pink} 50%, ${theme.accent.amber})`,
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
            whiteSpace: "nowrap",
          }}
        >
          npx @mariozechner/pi-coding-agent
        </div>
        <div
          style={{
            marginTop: 36,
            fontFamily: theme.mono,
            fontSize: 30,
            color: theme.textMuted,
          }}
        >
          github.com/badlogic/pi-mono · MIT
        </div>
        <div
          style={{
            marginTop: 80,
            display: "flex",
            gap: 24,
            fontFamily: theme.mono,
            fontSize: 20,
            color: theme.textDim,
          }}
        >
          <span>pi-ai</span>
          <span>·</span>
          <span>pi-agent-core</span>
          <span>·</span>
          <span>pi-tui</span>
          <span>·</span>
          <span>pi-coding-agent</span>
          <span>·</span>
          <span>pi-mom</span>
          <span>·</span>
          <span>pi-web-ui</span>
          <span>·</span>
          <span>pi-pods</span>
        </div>
      </AbsoluteFill>
    </Backdrop>
  );
};
