import { ArrowUpRight, Focus, MapPin, Star, X } from "lucide-react";
import type { Project } from "../data/types";

export function ProjectPanel({ project, onClose, onFlyTo }: { project: Project; onClose: () => void; onFlyTo: () => void }) {
  return (
    <aside className="project-panel" aria-live="polite">
      <div className="project-cover">
        <img src={project.coverImage} alt={`${project.title}项目示意图`} onError={(event) => { event.currentTarget.src = "/map-portfolio/assets/project-cover.png"; }} />
        <div className="cover-actions">
          <span>{project.category}</span>
          <button onClick={onClose} title="关闭项目详情" aria-label="关闭项目详情"><X size={16} /></button>
        </div>
      </div>
      <div className="project-content">
        <div className="project-kicker"><span>PROJECT / {project.year}</span>{project.isFeatured && <span className="featured-label"><Star size={11} />代表作</span>}</div>
        <h2>{project.title}</h2>
        <div className="location"><MapPin size={14} />{project.province} · {project.city}</div>
        <dl>
          <div><dt>年份</dt><dd>{project.year}</dd></div>
          <div><dt>面积</dt><dd>{project.area}</dd></div>
          <div><dt>等级</dt><dd>{["", "项目", "重点", "代表作"][project.importance]}</dd></div>
        </dl>
        <p className="summary">{project.summary}</p>
        <p className="description">{project.description}</p>
        <div className="project-actions">
          <button className="focus-button" onClick={onFlyTo}><Focus size={15} />定位项目</button>
          <button className="detail-button" onClick={() => window.alert("完整案例页将在录入真实项目图片后启用。")}>查看完整案例<ArrowUpRight size={15} /></button>
        </div>
      </div>
    </aside>
  );
}
