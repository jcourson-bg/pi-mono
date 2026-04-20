import { AbsoluteFill, Series } from "remotion";
import { S01_Title } from "./scenes/S01_Title";
import { S02_Tagline } from "./scenes/S02_Tagline";
import { S03_Packages } from "./scenes/S03_Packages";
import { S04_Layers } from "./scenes/S04_Layers";
import { S05_PiAi } from "./scenes/S05_PiAi";
import { S06_AgentLoop } from "./scenes/S06_AgentLoop";
import { S07_ToolFlow } from "./scenes/S07_ToolFlow";
import { S08_SessionTree } from "./scenes/S08_SessionTree";
import { S09_Ecosystem } from "./scenes/S09_Ecosystem";
import { S10_Outro } from "./scenes/S10_Outro";
import { theme } from "./theme";

export const SCENES = [
  { id: "title", Component: S01_Title, seconds: 5 },
  { id: "tagline", Component: S02_Tagline, seconds: 4 },
  { id: "packages", Component: S03_Packages, seconds: 9 },
  { id: "layers", Component: S04_Layers, seconds: 9 },
  { id: "pi-ai", Component: S05_PiAi, seconds: 10 },
  { id: "agent-loop", Component: S06_AgentLoop, seconds: 10 },
  { id: "tool-flow", Component: S07_ToolFlow, seconds: 10 },
  { id: "session-tree", Component: S08_SessionTree, seconds: 8 },
  { id: "ecosystem", Component: S09_Ecosystem, seconds: 7 },
  { id: "outro", Component: S10_Outro, seconds: 5 },
] as const;

export const FPS = 30;
export const TOTAL_FRAMES = SCENES.reduce((sum, s) => sum + s.seconds * FPS, 0);

export const PiMonoVideo: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg }}>
      <Series>
        {SCENES.map((scene) => (
          <Series.Sequence
            key={scene.id}
            durationInFrames={scene.seconds * FPS}
            premountFor={FPS}
          >
            <scene.Component />
          </Series.Sequence>
        ))}
      </Series>
    </AbsoluteFill>
  );
};
