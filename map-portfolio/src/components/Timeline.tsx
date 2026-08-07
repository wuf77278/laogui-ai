import { Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { projectYears } from "../data/projectLogic";
import type { Project, ProjectFilters } from "../data/types";

const speedOptions = [
  { label: "慢速", value: 2200 },
  { label: "正常", value: 1300 },
  { label: "快速", value: 700 }
];

export function Timeline({ projects, selectedYear, onYearChange }: { projects: Project[]; selectedYear: ProjectFilters["year"]; onYearChange: (year: ProjectFilters["year"]) => void }) {
  const years = useMemo(() => projectYears(projects), [projects]);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1300);
  const currentIndex = selectedYear === "全部" ? -1 : years.indexOf(selectedYear);

  useEffect(() => {
    if (!playing || !years.length) return;
    const timer = window.setTimeout(() => {
      const nextIndex = currentIndex + 1;
      if (nextIndex >= years.length) {
        setPlaying(false);
        return;
      }
      onYearChange(years[nextIndex]);
    }, speed);
    return () => window.clearTimeout(timer);
  }, [playing, currentIndex, years, speed, onYearChange]);

  const togglePlayback = () => {
    if (!playing && currentIndex >= years.length - 1) onYearChange(years[0] ?? "全部");
    setPlaying((current) => !current);
  };

  return (
    <section className="timeline" aria-label="项目年份时间轴">
      <button className="play-button" onClick={togglePlayback} aria-label={playing ? "暂停时间轴" : "播放时间轴"} title={playing ? "暂停" : "逐年点亮"}>
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </button>
      <div className="timeline-main">
        <div className="year-labels">{years.map((year) => <button key={year} className={selectedYear === year ? "active" : ""} onClick={() => { setPlaying(false); onYearChange(year); }}>{year}</button>)}</div>
        <input
          type="range"
          min="0"
          max={Math.max(0, years.length - 1)}
          value={Math.max(0, currentIndex)}
          onChange={(event) => { setPlaying(false); onYearChange(years[Number(event.target.value)] ?? "全部"); }}
          aria-label="选择年份"
        />
      </div>
      <select aria-label="播放速度" value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>{speedOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
      <button className="reset-year" onClick={() => { setPlaying(false); onYearChange("全部"); }} title="显示全部年份" aria-label="显示全部年份"><RotateCcw size={15} /></button>
    </section>
  );
}
