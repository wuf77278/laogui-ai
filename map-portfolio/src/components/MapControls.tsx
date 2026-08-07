import { Expand, Home, Minus, Plus } from "lucide-react";

interface Props {
  onHome: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFullscreen: () => void;
}

export function MapControls({ onHome, onZoomIn, onZoomOut, onFullscreen }: Props) {
  return (
    <div className="map-controls" aria-label="地图控制">
      <button onClick={onHome} title="回到中国全景" aria-label="回到中国全景"><Home size={17} /></button>
      <span />
      <button onClick={onZoomIn} title="放大地图" aria-label="放大地图"><Plus size={18} /></button>
      <button onClick={onZoomOut} title="缩小地图" aria-label="缩小地图"><Minus size={18} /></button>
      <button onClick={onFullscreen} title="进入全屏" aria-label="进入全屏"><Expand size={17} /></button>
    </div>
  );
}
