import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { SceneHeader } from "../components/SceneHeader";
import { theme } from "../theme";

type Node = { id: string; x: number; y: number; role: "user" | "assistant"; label: string };

const nodes: Node[] = [
  { id: "1", x: 180, y: 620, role: "user", label: "fix readme typo" },
  { id: "2", x: 380, y: 620, role: "assistant", label: "read(README.md)" },
  { id: "3", x: 580, y: 620, role: "assistant", label: "edit(README.md)" },
  { id: "4", x: 800, y: 460, role: "user", label: "also bump version" },
  { id: "5", x: 1010, y: 460, role: "assistant", label: "edit(pkg.json)" },
  { id: "6", x: 800, y: 780, role: "user", label: "/fork · explain" },
  { id: "7", x: 1010, y: 780, role: "assistant", label: "summary" },
];

const edges: [string, string][] = [
  ["1", "2"],
  ["2", "3"],
  ["3", "4"],
  ["4", "5"],
  ["3", "6"],
  ["6", "7"],
];

const roleColor = (r: Node["role"]) =>
  r === "user" ? theme.accent.lime : theme.accent.teal;

const jsonlLines = [
  `{"id":"1","role":"user","text":"fix the readme typo"}`,
  `{"id":"2","parentId":"1","role":"assistant","toolCall":"read"}`,
  `{"id":"3","parentId":"2","role":"assistant","toolCall":"edit"}`,
  `{"id":"4","parentId":"3","role":"user","text":"also bump version"}`,
  `{"id":"5","parentId":"4","role":"assistant","toolCall":"edit"}`,
  `{"id":"6","parentId":"3","role":"user","text":"/fork"}`,
  `{"id":"7","parentId":"6","role":"assistant","text":"summary"}`,
];

export const S08_SessionTree: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const outro = interpolate(frame, [durationInFrames - fps, durationInFrames], [0, 1], {
    easing: Easing.in(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  return (
    <Backdrop>
      <AbsoluteFill style={{ opacity: 1 - outro }}>
        <SceneHeader
          eyebrow="06 · sessions"
          title="Branching history as JSONL"
          accent={theme.accent.lime}
        />

        {/* JSONL panel on the right */}
        <div
          style={{
            position: "absolute",
            top: 300,
            right: 80,
            width: 640,
            backgroundColor: theme.bgPanelDeep,
            border: `1px solid ${theme.borderStrong}`,
            borderRadius: 16,
            padding: 24,
            fontFamily: theme.mono,
            fontSize: 16,
            lineHeight: 1.6,
            color: theme.text,
            overflow: "hidden",
          }}
        >
          <div style={{ color: theme.textDim, marginBottom: 10 }}>session.jsonl</div>
          {jsonlLines.map((ln, i) => {
            const start = fps * 0.3 + i * 6;
            const p = interpolate(frame, [start, start + 18], [0, 1], {
              easing: Easing.bezier(0.16, 1, 0.3, 1),
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            return (
              <div
                key={ln}
                style={{
                  opacity: p,
                  transform: `translateX(${interpolate(p, [0, 1], [10, 0])}px)`,
                  whiteSpace: "pre",
                  color: i % 2 === 0 ? theme.accent.lime : theme.accent.teal,
                }}
              >
                {ln}
              </div>
            );
          })}
        </div>

        {/* Tree graph on the left */}
        <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
          {edges.map(([a, b], i) => {
            const from = nodeMap.get(a);
            const to = nodeMap.get(b);
            if (!from || !to) return null;
            const start = fps * 0.4 + i * 6 + 4;
            const p = interpolate(frame, [start, start + 16], [0, 1], {
              easing: Easing.bezier(0.16, 1, 0.3, 1),
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            const mx = from.x + (to.x - from.x) * p;
            const my = from.y + (to.y - from.y) * p;
            return (
              <line
                key={`e-${i}`}
                x1={from.x}
                y1={from.y}
                x2={mx}
                y2={my}
                stroke={b === "6" || b === "7" ? theme.accent.pink : theme.accent.violet}
                strokeWidth={3}
              />
            );
          })}
        </svg>

        {nodes.map((n, i) => {
          const start = fps * 0.4 + i * 6;
          const p = interpolate(frame, [start, start + 14], [0, 1], {
            easing: Easing.bezier(0.22, 1, 0.36, 1),
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          const c = roleColor(n.role);
          return (
            <div
              key={n.id}
              style={{
                position: "absolute",
                left: n.x - 90,
                top: n.y - 30,
                width: 180,
                height: 60,
                borderRadius: 30,
                backgroundColor: theme.bgPanel,
                border: `2px solid ${c}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: theme.mono,
                fontSize: 14,
                color: theme.text,
                opacity: p,
                transform: `scale(${interpolate(p, [0, 1], [0.7, 1])})`,
                padding: "0 10px",
                textAlign: "center",
              }}
            >
              {n.label}
            </div>
          );
        })}

        <div
          style={{
            position: "absolute",
            bottom: 80,
            left: 100,
            right: 100,
            textAlign: "center",
            fontFamily: theme.sans,
            fontSize: 22,
            color: theme.textMuted,
            opacity: interpolate(frame, [fps * 3, fps * 3.8], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          /tree lets you replay, branch and /fork.  Compaction summarizes old turns when context fills up.
        </div>
      </AbsoluteFill>
    </Backdrop>
  );
};
