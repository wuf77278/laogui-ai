import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, LoaderCircle } from "lucide-react";
import type { Project } from "../data/types";
import { createCesiumMap, type MapController, type TerrainMode } from "../map/cesiumViewer";

interface Props {
  projects: Project[];
  selectedProject: Project | null;
  onSelectProject: (project: Project) => void;
  onControllerReady: (controller: MapController) => void;
}

export function MapView({ projects, selectedProject, onSelectProject, onControllerReady }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<MapController | null>(null);
  const projectsRef = useRef(projects);
  const selectRef = useRef(onSelectProject);
  const [terrainMode, setTerrainMode] = useState<TerrainMode>("loading");
  const [mapError, setMapError] = useState("");

  projectsRef.current = projects;
  selectRef.current = onSelectProject;

  useEffect(() => {
    if (!containerRef.current) return;
    let active = true;
    createCesiumMap(containerRef.current, (id) => {
      const project = projectsRef.current.find((item) => item.id === id);
      if (project) selectRef.current(project);
    }).then((controller) => {
      if (!active) return controller.destroy();
      controllerRef.current = controller;
      setTerrainMode(controller.terrainMode);
      onControllerReady(controller);
      controller.setProjects(projectsRef.current, selectedProject?.id);
    }).catch((error: Error) => {
      if (active) setMapError(error.message || "三维地图加载失败");
    });
    return () => {
      active = false;
      controllerRef.current?.destroy();
      controllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    controllerRef.current?.setProjects(projects, selectedProject?.id);
  }, [projects, selectedProject?.id]);

  return (
    <section className="map-stage" aria-label="中国三维设计地图">
      <div id="cesiumContainer" ref={containerRef} />
      <div className="map-vignette" aria-hidden="true" />
      <div className={`terrain-badge mode-${terrainMode}`}>
        {mapError ? <AlertTriangle size={13} /> : terrainMode === "loading" ? <LoaderCircle className="spin" size={13} /> : <CheckCircle2 size={13} />}
        <span>{mapError || (terrainMode === "real" ? "真实地形" : terrainMode === "demo" ? "演示地形 · 配置密钥后启用真实海拔" : "地形加载中")}</span>
      </div>
    </section>
  );
}
