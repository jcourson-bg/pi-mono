import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../theme";

export const SceneHeader: React.FC<{
  eyebrow: string;
  title: string;
  accent: string;
}> = ({ eyebrow, title, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = interpolate(frame, [0, fps * 0.7], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const y = interpolate(p, [0, 1], [18, 0]);
  return (
    <div
      style={{
        position: "absolute",
        top: 80,
        left: 100,
        opacity: p,
        transform: `translateY(${y}px)`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          fontFamily: theme.mono,
          fontSize: 22,
          color: accent,
          letterSpacing: 4,
          textTransform: "uppercase",
          marginBottom: 10,
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: 40,
            height: 3,
            backgroundColor: accent,
          }}
        />
        {eyebrow}
      </div>
      <div
        style={{
          fontFamily: theme.sans,
          fontWeight: 800,
          fontSize: 80,
          letterSpacing: -2,
          color: theme.text,
        }}
      >
        {title}
      </div>
    </div>
  );
};
