import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { theme } from "../theme";

export const S01_Title: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const intro = interpolate(frame, [0, fps * 0.8], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const scale = interpolate(intro, [0, 1], [0.92, 1]);
  const outro = interpolate(frame, [fps * 4, fps * 5], [0, 1], {
    easing: Easing.in(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const caretOn = Math.floor(frame / 15) % 2 === 0;

  return (
    <Backdrop>
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          opacity: intro - outro,
          transform: `scale(${scale})`,
        }}
      >
        <div
          style={{
            fontFamily: theme.mono,
            fontSize: 34,
            color: theme.textMuted,
            letterSpacing: 6,
            textTransform: "uppercase",
            marginBottom: 32,
          }}
        >
          An architecture walkthrough
        </div>
        <div
          style={{
            fontFamily: theme.sans,
            fontWeight: 800,
            fontSize: 280,
            lineHeight: 1,
            letterSpacing: -10,
            background: `linear-gradient(120deg, ${theme.accent.teal}, ${theme.accent.pink} 55%, ${theme.accent.amber})`,
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
            display: "flex",
            alignItems: "center",
          }}
        >
          pi-mono
          <span
            style={{
              marginLeft: 18,
              width: 22,
              height: 200,
              background: theme.accent.pink,
              opacity: caretOn ? 1 : 0.1,
              transform: "translateY(14px)",
            }}
          />
        </div>
        <div
          style={{
            fontFamily: theme.sans,
            fontSize: 36,
            color: theme.textMuted,
            marginTop: 24,
            maxWidth: 1200,
            textAlign: "center",
          }}
        >
          Tools for building AI agents and managing LLM deployments.
        </div>
      </AbsoluteFill>
    </Backdrop>
  );
};
