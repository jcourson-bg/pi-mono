import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { SceneHeader } from "../components/SceneHeader";
import { theme } from "../theme";

const providers = [
  "Anthropic",
  "OpenAI",
  "Google Gemini",
  "Vertex AI",
  "Mistral",
  "Groq",
  "Cerebras",
  "xAI",
  "OpenRouter",
  "AI Gateway",
  "MiniMax",
  "Azure OpenAI",
  "Bedrock",
  "Copilot",
  "Ollama",
  "vLLM",
];

export const S05_PiAi: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const outro = interpolate(frame, [durationInFrames - fps, durationInFrames], [0, 1], {
    easing: Easing.in(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const hubX = 1060;
  const hubY = 640;
  const cols = 2;
  const colX = [1400, 1700];
  const rowStartY = 270;
  const rowStep = 80;

  const positions = providers.map((_, i) => ({
    x: colX[i % cols],
    y: rowStartY + Math.floor(i / cols) * rowStep,
  }));

  const codeAppear = interpolate(frame, [fps * 0.4, fps * 1.2], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <Backdrop>
      <AbsoluteFill style={{ opacity: 1 - outro }}>
        <SceneHeader
          eyebrow="03 · pi-ai"
          title="One API. Twenty providers."
          accent={theme.accent.teal}
        />

        {/* Code snippet on the left */}
        <div
          style={{
            position: "absolute",
            top: 300,
            left: 100,
            width: 720,
            backgroundColor: theme.bgPanelDeep,
            border: `1px solid ${theme.borderStrong}`,
            borderRadius: 16,
            padding: 28,
            fontFamily: theme.mono,
            fontSize: 22,
            lineHeight: 1.55,
            color: theme.text,
            opacity: codeAppear,
            transform: `translateY(${interpolate(codeAppear, [0, 1], [20, 0])}px)`,
          }}
        >
          <div style={{ color: theme.textDim, marginBottom: 8 }}>// packages/ai/src/index.ts</div>
          <div>
            <span style={{ color: theme.accent.pink }}>import</span>{" "}
            <span>{"{ stream, getModel }"}</span>{" "}
            <span style={{ color: theme.accent.pink }}>from</span>{" "}
            <span style={{ color: theme.accent.lime }}>"@mariozechner/pi-ai"</span>;
          </div>
          <div style={{ marginTop: 16 }}>
            <span style={{ color: theme.accent.pink }}>const</span> model ={" "}
            <span style={{ color: theme.accent.teal }}>getModel</span>(
            <span style={{ color: theme.accent.lime }}>"anthropic"</span>,
            <br />
            &nbsp;&nbsp;
            <span style={{ color: theme.accent.lime }}>"claude-sonnet-4-6"</span>);
          </div>
          <div style={{ marginTop: 16 }}>
            <span style={{ color: theme.accent.pink }}>for await</span> (
            <span style={{ color: theme.accent.pink }}>const</span> ev{" "}
            <span style={{ color: theme.accent.pink }}>of</span>{" "}
            <span style={{ color: theme.accent.teal }}>stream</span>({"{ model, context }"})) {`{`}
          </div>
          <div>
            &nbsp;&nbsp;<span style={{ color: theme.textMuted }}>// text · tool_call · thinking · usage</span>
          </div>
          <div>{`}`}</div>
        </div>

        {/* Connector lines */}
        <svg
          width={1920}
          height={1080}
          style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
        >
          {positions.map((pos, i) => {
            const start = fps * 0.8 + i * 3;
            const p = interpolate(frame, [start, start + 18], [0, 1], {
              easing: Easing.bezier(0.22, 1, 0.36, 1),
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            const x2 = hubX + (pos.x - 95 - hubX) * p;
            const y2 = hubY + (pos.y - hubY) * p;
            return (
              <line
                key={`l-${i}`}
                x1={hubX}
                y1={hubY}
                x2={x2}
                y2={y2}
                stroke={theme.accent.teal}
                strokeWidth={1.5}
                strokeDasharray="4 6"
                opacity={p * 0.55}
              />
            );
          })}
        </svg>

        {/* Hub */}
        <div
          style={{
            position: "absolute",
            left: hubX - 130,
            top: hubY - 70,
            width: 260,
            height: 140,
            borderRadius: 70,
            backgroundColor: theme.bgPanel,
            border: `2px solid ${theme.accent.teal}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: theme.sans,
            fontWeight: 800,
            fontSize: 40,
            color: theme.accent.teal,
            boxShadow: `0 0 60px ${theme.accent.teal}55`,
          }}
        >
          pi-ai
        </div>

        {providers.map((name, i) => {
          const start = fps * 0.8 + i * 3;
          const p = interpolate(frame, [start, start + 18], [0, 1], {
            easing: Easing.bezier(0.22, 1, 0.36, 1),
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          const pos = positions[i];
          return (
            <div
              key={name}
              style={{
                position: "absolute",
                left: pos.x - 95,
                top: pos.y - 26,
                width: 190,
                height: 52,
                borderRadius: 26,
                backgroundColor: theme.bgPanel,
                border: `1px solid ${theme.border}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: theme.mono,
                fontSize: 18,
                color: theme.textMuted,
                opacity: p,
                transform: `scale(${interpolate(p, [0, 1], [0.6, 1])})`,
              }}
            >
              {name}
            </div>
          );
        })}
      </AbsoluteFill>
    </Backdrop>
  );
};
