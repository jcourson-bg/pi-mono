import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { theme } from "../theme";

const bullets = [
  { label: "7 packages", sub: "one monorepo" },
  { label: "20+ LLM providers", sub: "one unified API" },
  { label: "Agent runtime", sub: "tools, hooks, streaming" },
];

export const S02_Tagline: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const intro = interpolate(frame, [0, fps * 0.8], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const outro = interpolate(frame, [durationInFrames - fps, durationInFrames], [0, 1], {
    easing: Easing.in(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <Backdrop>
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          opacity: intro - outro,
        }}
      >
        <div
          style={{
            fontFamily: theme.mono,
            fontSize: 24,
            color: theme.accent.teal,
            letterSpacing: 4,
            textTransform: "uppercase",
            marginBottom: 40,
          }}
        >
          github.com/badlogic/pi-mono
        </div>
        <div
          style={{
            display: "flex",
            gap: 48,
          }}
        >
          {bullets.map((b, i) => {
            const start = fps * 0.6 + i * 10;
            const p = interpolate(frame, [start, start + 20], [0, 1], {
              easing: Easing.bezier(0.22, 1, 0.36, 1),
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            const ty = interpolate(p, [0, 1], [24, 0]);
            return (
              <div
                key={b.label}
                style={{
                  width: 380,
                  padding: "36px 32px",
                  borderRadius: 18,
                  border: `1px solid ${theme.borderStrong}`,
                  backgroundColor: theme.bgPanel,
                  opacity: p,
                  transform: `translateY(${ty}px)`,
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    fontFamily: theme.sans,
                    fontWeight: 800,
                    fontSize: 42,
                    color: theme.text,
                    marginBottom: 8,
                  }}
                >
                  {b.label}
                </div>
                <div
                  style={{
                    fontFamily: theme.sans,
                    fontSize: 22,
                    color: theme.textMuted,
                  }}
                >
                  {b.sub}
                </div>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </Backdrop>
  );
};
