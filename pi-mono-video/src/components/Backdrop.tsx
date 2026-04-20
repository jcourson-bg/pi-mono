import { AbsoluteFill, useCurrentFrame } from "remotion";
import { theme } from "../theme";

export const Backdrop: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const frame = useCurrentFrame();
  const driftX = Math.sin(frame / 120) * 30;
  const driftY = Math.cos(frame / 160) * 20;
  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg, overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at ${50 + driftX / 10}% ${40 + driftY / 10}%, rgba(167,139,250,0.18), transparent 55%)`,
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at ${80 - driftX / 8}% ${80 - driftY / 8}%, rgba(34,211,238,0.15), transparent 50%)`,
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          backgroundPosition: `${driftX}px ${driftY}px`,
        }}
      />
      {children}
    </AbsoluteFill>
  );
};
