import { Search, SlidersHorizontal, Star, X } from "lucide-react";
import { uniqueSortedValues } from "../data/projectLogic";
import type { Project, ProjectFilters } from "../data/types";

interface Props {
  projects: Project[];
  filteredProjects: Project[];
  filters: ProjectFilters;
  onFiltersChange: (filters: ProjectFilters) => void;
  onSelectProject: (project: Project) => void;
  selectedProjectId: string;
}

export function FilterPanel({ projects, filteredProjects, filters, onFiltersChange, onSelectProject, selectedProjectId }: Props) {
  const provinces = uniqueSortedValues(projects, "province");
  const categories = uniqueSortedValues(projects, "category");
  const cities = uniqueSortedValues(
    filters.province === "全部" ? projects : projects.filter((project) => project.province === filters.province),
    "city"
  );
  const update = <K extends keyof ProjectFilters>(key: K, value: ProjectFilters[K]) => onFiltersChange({ ...filters, [key]: value });
  const hasFilters = filters.keyword || filters.province !== "全部" || filters.city !== "全部" || filters.category !== "全部" || filters.featuredOnly;

  return (
    <aside className="filter-panel" aria-label="作品筛选">
      <div className="panel-title-row">
        <div><SlidersHorizontal size={15} /><span>作品坐标</span></div>
        {hasFilters && (
          <button className="clear-button" onClick={() => onFiltersChange({ ...filters, keyword: "", province: "全部", city: "全部", category: "全部", featuredOnly: false })}>
            <X size={13} /> 清空
          </button>
        )}
      </div>

      <label className="search-field">
        <Search size={15} />
        <input aria-label="关键词搜索" value={filters.keyword} onChange={(event) => update("keyword", event.target.value)} placeholder="搜索项目、城市或类型" />
      </label>

      <div className="filter-grid">
        <label><span>省份</span><select value={filters.province} onChange={(event) => onFiltersChange({ ...filters, province: event.target.value, city: "全部" })}><option>全部</option>{provinces.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span>城市</span><select value={filters.city} onChange={(event) => update("city", event.target.value)}><option>全部</option>{cities.map((item) => <option key={item}>{item}</option>)}</select></label>
      </div>
      <label className="select-row"><span>项目类型</span><select value={filters.category} onChange={(event) => update("category", event.target.value)}><option>全部</option>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label className="featured-toggle"><input type="checkbox" checked={filters.featuredOnly} onChange={(event) => update("featuredOnly", event.target.checked)} /><span className="toggle-track" /><Star size={14} /><span>只看代表作</span></label>

      <div className="result-heading"><strong>共 {filteredProjects.length} 个项目</strong><span>点击坐标定位</span></div>
      <div className="project-list">
        {filteredProjects.length ? filteredProjects.map((project) => (
          <button key={project.id} className={`project-list-item ${project.id === selectedProjectId ? "active" : ""}`} onClick={() => onSelectProject(project)} aria-label={`${project.title}，${project.city}，${project.year}年`}>
            <span className={`importance importance-${project.importance}`} />
            <span><strong>{project.title}</strong><small>{project.city} · {project.year}</small></span>
            <em>{project.category}</em>
          </button>
        )) : <div className="empty-result">没有符合条件的项目</div>}
      </div>
    </aside>
  );
}
