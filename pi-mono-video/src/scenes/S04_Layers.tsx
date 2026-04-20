import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { SceneHeader } from "../components/SceneHeader";
import { theme } from "../theme";

const layers = [
  {
    name: "pi-coding-agent",
    label: "CLI · TUI · RPC · print modes",
    color: theme.accent.pink,
    width: 900,
  },
  {
    name: "pi-agent-core",
    label: "agent state machine · tool loop · hooks",
    color: theme.accent.violet,
    width: 1040,
  },
  {
    name: "pi-tui",
    label: "differential rendering · components",
    color: theme.accent.amber,
    width: 1180,
  },
  {
    name: "pi-ai",
    label: "unified streaming across 20+ providers",
    color: theme.accent.teal,
    width: 1320,
  },
];

export const S04_Layers: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const outro = interpolate(frame, [durationInFrames - fps, durationInFrames], [0, 1], {
    easing: Easing.in(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <Backdrop>
      <AbsoluteFill style={{ opacity: 1 - outro }}>
        <SceneHeader
          eyebrow="02 · architecture"
          title="A clean stack of layers"
          accent={theme.accent.violet}
        />
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", paddingTop: 120 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            {layers.map((layer, i) => {
              const start = fps * 0.6 + i * 12;
              const p = interpolate(frame, [start, start + 24], [0, 1], {
                easing: Easing.bezier(0.16, 1, 0.3, 1),
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              });
              const tx = interpolate(p, [0, 1], [-60, 0]);
              return (
                <div
                  key={layer.name}
                  style={{
                    opacity: p,
                    transform: `translateX(${tx}px)`,
                    width: layer.width,
                    height: 130,
                    borderRadius: 18,
                    backgroundColor: theme.bgPanel,
                    border: `1px solid ${theme.borderStrong}`,
                    paddingLeft: 36,
                    display: "flex",
                    alignItems: "center",
                    gap: 32,
                    position: "relative",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      background: `linear-gradient(90deg, ${layer.color}22, transparent 55%)`,
                    }}
                  />
                  <div
                    style={{
                      position: "relative",
                      fontFamily: theme.sans,
                      fontWeight: 800,
                      fontSize: 46,
                      color: layer.color,
                      minWidth: 420,
                    }}
                  >
                    {layer.name}
                  </div>
                  <div
                    style={{
                      position: "relative",
                      fontFamily: theme.mono,
                      fontSize: 22,
                      color: theme.textMuted,
                    }}
                  >
                    {layer.label}
                  </div>
                </div>
              );
            })}
          </div>
          <div
            style={{
              marginTop: 28,
              fontFamily: theme.mono,
              fontSize: 20,
              color: theme.textDim,
              opacity: interpolate(frame, [fps * 2.5, fps * 3.2], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
            }}
          >
            higher layers compose lower ones · each is usable on its own
          </div>
        </AbsoluteFill>
      </AbsoluteFill>
    </Backdrop>
  );
};
