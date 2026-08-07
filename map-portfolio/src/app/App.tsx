import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Database, Map as MapIcon } from "lucide-react";
import { AdminPage } from "../admin/AdminPage";
import { FilterPanel } from "../components/FilterPanel";
import { LoadingState } from "../components/LoadingState";
import { MapControls } from "../components/MapControls";
import { MapView } from "../components/MapView";
import { ProjectPanel } from "../components/ProjectPanel";
import { Timeline } from "../components/Timeline";
import { filterProjects } from "../data/projectLogic";
import { projectRepository } from "../data/projectRepository";
import type { Project, ProjectFilters } from "../data/types";
import type { MapController } from "../map/cesiumViewer";

const initialFilters: ProjectFilters = {
  keyword: "",
  province: "全部",
  city: "全部",
  category: "全部",
  year: "全部",
  featuredOnly: false
};

export function App() {
  const isAdmin = window.location.pathname.includes("/admin");
  if (isAdmin) return <AdminPage />;
  return <PortfolioMap />;
}

function PortfolioMap() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [filters, setFilters] = useState<ProjectFilters>(initialFilters);
  const [selected, setSelected] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mapController, setMapController] = useState<MapController | null>(null);
  const filteredProjects = useMemo(() => filterProjects(projects, filters), [projects, filters]);

  useEffect(() => {
    projectRepository.list()
      .then((data) => {
        setProjects(data);
        setSelected(data.find((project) => project.isFeatured) ?? data[0] ?? null);
      })
      .catch((requestError: Error) => setError(requestError.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (selected && !filteredProjects.some((project) => project.id === selected.id)) {
      setSelected(filteredProjects[0] ?? null);
    }
  }, [filteredProjects, selected]);

  const selectProject = (project: Project, fly = false) => {
    setSelected(project);
    if (fly) mapController?.flyToProject(project);
  };

  return (
    <main className="map-app">
      <MapView
        projects={filteredProjects}
        selectedProject={selected}
        onSelectProject={(project) => selectProject(project)}
        onControllerReady={setMapController}
      />

      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true"><MapIcon size={17} /></span>
          <div>
            <h1>设计行迹</h1>
            <p>中国设计项目地理档案</p>
          </div>
        </div>
        <div className="topbar-status">
          <span className="live-dot" aria-hidden="true" />
          <span>我的作品</span>
          <span className="project-total">{projects.length} 个坐标</span>
        </div>
        <a className="icon-text-button" href="/map-portfolio/admin/" title="打开项目管理后台">
          <Database size={16} />
          <span>项目管理</span>
        </a>
      </header>

      <FilterPanel
        projects={projects}
        filteredProjects={filteredProjects}
        filters={filters}
        onFiltersChange={setFilters}
        onSelectProject={(project) => selectProject(project, true)}
        selectedProjectId={selected?.id ?? ""}
      />

      {selected && (
        <ProjectPanel
          project={selected}
          onClose={() => setSelected(null)}
          onFlyTo={() => mapController?.flyToProject(selected)}
        />
      )}

      <MapControls
        onHome={() => mapController?.flyHome()}
        onZoomIn={() => mapController?.zoomIn()}
        onZoomOut={() => mapController?.zoomOut()}
        onFullscreen={() => document.documentElement.requestFullscreen?.()}
      />

      <Timeline
        projects={projects}
        selectedYear={filters.year}
        onYearChange={(year) => setFilters((current) => ({ ...current, year }))}
      />

      <div className="map-attribution-note">示例项目数据 · 地形与影像来源见地图署名</div>
      {(loading || error) && <LoadingState error={error} />}
    </main>
  );
}
