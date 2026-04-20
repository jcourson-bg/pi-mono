import "./index.css";
import { Composition } from "remotion";
import { FPS, PiMonoVideo, TOTAL_FRAMES } from "./PiMonoVideo";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="PiMono"
        component={PiMonoVideo}
        durationInFrames={TOTAL_FRAMES}
        fps={FPS}
        width={1920}
        height={1080}
      />
    </>
  );
};
