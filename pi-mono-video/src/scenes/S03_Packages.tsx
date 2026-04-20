import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { SceneHeader } from "../components/SceneHeader";
import { packages, theme } from "../theme";

export const S03_Packages: React.FC = () => {
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
        <SceneHeader eyebrow="01 · monorepo" title="Seven packages, one repo" accent={theme.accent.teal} />
        <div
          style={{
            position: "absolute",
            top: 280,
            left: 100,
            right: 100,
            bottom: 100,
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gridAutoRows: "1fr",
            gap: 28,
          }}
        >
          {packages.map((p, i) => {
            const start = fps * 0.5 + i * 5;
            const prog = interpolate(frame, [start, start + 22], [0, 1], {
              easing: Easing.bezier(0.16, 1, 0.3, 1),
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            const ty = interpolate(prog, [0, 1], [40, 0]);
            return (
              <div
                key={p.name}
                style={{
                  opacity: prog,
                  transform: `translateY(${ty}px)`,
                  backgroundColor: theme.bgPanel,
                  borderRadius: 20,
                  border: `1px solid ${theme.border}`,
                  padding: "32px 36px",
                  position: "relative",
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: 6,
                    backgroundColor: p.color,
                  }}
                />
                <div
                  style={{
                    fontFamily: theme.mono,
                    fontSize: 18,
                    color: theme.textDim,
                    letterSpacing: 3,
                    textTransform: "uppercase",
                  }}
                >
                  packages/{p.name.replace("pi-", "")}
                </div>
                <div>
                  <div
                    style={{
                      fontFamily: theme.sans,
                      fontWeight: 800,
                      fontSize: 44,
                      color: p.color,
                      marginTop: 10,
                    }}
                  >
                    {p.name}
                  </div>
                  <div
                    style={{
                      fontFamily: theme.sans,
                      fontSize: 22,
                      color: theme.textMuted,
                      marginTop: 10,
                      lineHeight: 1.35,
                    }}
                  >
                    {p.tagline}
                  </div>
                </div>
              </div>
            );
          })}
          <div
            style={{
              opacity: interpolate(frame, [fps * 0.5 + 40, fps * 0.5 + 60], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
              borderRadius: 20,
              border: `2px dashed ${theme.borderStrong}`,
              padding: "32px 36px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              fontFamily: theme.mono,
              fontSize: 22,
              color: theme.textDim,
              lineHeight: 1.5,
            }}
          >
            npm workspaces
            <br />
            lockstep versioning
            <br />
            biome + tsgo
          </div>
        </div>
      </AbsoluteFill>
    </Backdrop>
  );
};
