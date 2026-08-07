import {
  Cartesian2,
  Cartesian3,
  ClippingPolygon,
  ClippingPolygonCollection,
  Color,
  DistanceDisplayCondition,
  EllipsoidTerrainProvider,
  HeightReference,
  HorizontalOrigin,
  ImageryLayer,
  Ion,
  LabelStyle,
  Math as CesiumMath,
  NearFarScalar,
  PolygonHierarchy,
  Rectangle,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Terrain,
  TileMapServiceImageryProvider,
  VerticalOrigin,
  Viewer,
  buildModuleUrl,
  defined
} from "cesium";
import type { Project } from "../data/types";
import { getChinaBoundaryRings } from "./chinaBoundary";

export type TerrainMode = "loading" | "real" | "demo";

export interface MapController {
  terrainMode: TerrainMode;
  setProjects: (projects: Project[], selectedId?: string) => void;
  flyToProject: (project: Project) => void;
  flyHome: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  destroy: () => void;
}

const HOME_RECTANGLE = Rectangle.fromDegrees(66, 10, 143, 60);

function projectColor(project: Project, selected: boolean): Color {
  if (selected) return Color.fromCssColorString("#ffd27a");
  if (project.importance === 3) return Color.fromCssColorString("#eebd66");
  if (project.importance === 2) return Color.fromCssColorString("#72d4c2");
  return Color.fromCssColorString("#5b96a4");
}

export async function createCesiumMap(container: HTMLElement, onSelect: (projectId: string) => void): Promise<MapController> {
  const token = String(import.meta.env.CESIUM_ION_TOKEN || "").trim();
  let terrainMode: TerrainMode = "demo";
  let terrain: Terrain | EllipsoidTerrainProvider = new EllipsoidTerrainProvider();
  if (token) {
    Ion.defaultAccessToken = token;
    terrain = Terrain.fromWorldTerrain({ requestVertexNormals: true });
    terrainMode = "real";
  }

  const imageryProvider = await TileMapServiceImageryProvider.fromUrl(
    buildModuleUrl("Assets/Textures/NaturalEarthII")
  );
  const baseLayer = new ImageryLayer(imageryProvider, {
    brightness: 0.52,
    contrast: 1.3,
    saturation: 0.34,
    gamma: 0.9
  });

  const viewer = new Viewer(container, {
    baseLayer,
    terrainProvider: terrain instanceof EllipsoidTerrainProvider ? terrain : undefined,
    terrain: terrain instanceof Terrain ? terrain : undefined,
    animation: false,
    baseLayerPicker: false,
    fullscreenButton: false,
    geocoder: false,
    homeButton: false,
    infoBox: false,
    navigationHelpButton: false,
    sceneModePicker: false,
    selectionIndicator: false,
    timeline: false,
    requestRenderMode: true,
    maximumRenderTimeChange: Infinity,
    shadows: false,
    skyAtmosphere: undefined
  });

  viewer.scene.backgroundColor = Color.fromCssColorString("#050a0b");
  if (viewer.scene.skyBox) viewer.scene.skyBox.show = false;
  if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = false;
  if (viewer.scene.sun) viewer.scene.sun.show = false;
  if (viewer.scene.moon) viewer.scene.moon.show = false;
  viewer.scene.globe.baseColor = Color.fromCssColorString("#31554c");
  viewer.scene.globe.enableLighting = terrainMode === "real";
  viewer.scene.globe.showGroundAtmosphere = false;
  viewer.scene.highDynamicRange = true;
  viewer.scene.screenSpaceCameraController.minimumZoomDistance = 8_000;
  viewer.scene.screenSpaceCameraController.maximumZoomDistance = 16_000_000;
  viewer.camera.setView({ destination: HOME_RECTANGLE });

  const chinaRings = getChinaBoundaryRings();
  if (ClippingPolygonCollection.isSupported(viewer.scene)) {
    viewer.scene.globe.clippingPolygons = new ClippingPolygonCollection({
      inverse: true,
      quality: 1.5,
      polygons: chinaRings.map((ring) => new ClippingPolygon({
        positions: Cartesian3.fromDegreesArray(ring.flatMap(([longitude, latitude]) => [longitude, latitude]))
      }))
    });
  }

  const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
  const pickProject = (position: Cartesian2) => {
    const picked = viewer.scene.pick(position);
    if (!defined(picked) || !defined(picked.id)) return null;
    return String(picked.id.properties?.projectId?.getValue() || "") || null;
  };
  handler.setInputAction((movement: { position: Cartesian2 }) => {
    const id = pickProject(movement.position);
    if (id) onSelect(id);
  }, ScreenSpaceEventType.LEFT_CLICK);
  handler.setInputAction((movement: { position: Cartesian2 }) => {
    const id = pickProject(movement.position);
    if (!id) return;
    const entity = viewer.entities.getById(`project-${id}`);
    if (entity) viewer.flyTo(entity, { duration: 1.3, offset: undefined });
  }, ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

  function setProjects(projects: Project[], selectedId?: string) {
    viewer.entities.removeAll();
    chinaRings.forEach((ring, index) => {
      const positions = Cartesian3.fromDegreesArray(ring.flatMap(([longitude, latitude]) => [longitude, latitude]));
      viewer.entities.add({
        id: `china-surface-${index}`,
        polygon: {
          hierarchy: new PolygonHierarchy(positions),
          height: 8_000,
          material: Color.fromCssColorString(index === 0 ? "#26483f" : "#1b3c36").withAlpha(terrainMode === "real" ? 0.18 : 0.96)
        }
      });
      viewer.entities.add({
        id: `china-outline-${index}`,
        polyline: {
          positions,
          width: 1.7,
          material: Color.fromCssColorString("#d7aa5d").withAlpha(0.7)
        }
      });
    });
    projects.forEach((project) => {
      const selected = project.id === selectedId;
      const color = projectColor(project, selected);
      const height = [0, 85_000, 135_000, 200_000][project.importance];
      viewer.entities.add({
        id: `project-${project.id}`,
        position: Cartesian3.fromDegrees(project.longitude, project.latitude, height / 2),
        properties: { projectId: project.id },
        cylinder: {
          length: height,
          topRadius: selected ? 4_500 : 2_100,
          bottomRadius: selected ? 11_000 : 6_000,
          material: color.withAlpha(selected ? 0.72 : 0.5),
          heightReference: HeightReference.NONE
        },
        label: {
          text: project.title,
          font: selected ? "600 16px sans-serif" : "500 13px sans-serif",
          fillColor: selected ? Color.fromCssColorString("#fff1cc") : Color.fromCssColorString("#d7e1dc"),
          outlineColor: Color.fromCssColorString("#07100f").withAlpha(0.95),
          outlineWidth: 4,
          style: LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cartesian2(0, selected ? -28 : -19),
          verticalOrigin: VerticalOrigin.BOTTOM,
          horizontalOrigin: HorizontalOrigin.CENTER,
          scaleByDistance: new NearFarScalar(250_000, 1.15, 5_500_000, 0.55),
          distanceDisplayCondition: new DistanceDisplayCondition(0, 7_200_000),
          disableDepthTestDistance: 6_000_000
        }
      });
      viewer.entities.add({
        id: `project-base-${project.id}`,
        position: Cartesian3.fromDegrees(project.longitude, project.latitude, 2_000),
        properties: { projectId: project.id },
        ellipse: {
          semiMajorAxis: selected ? 34_000 : 21_000,
          semiMinorAxis: selected ? 34_000 : 21_000,
          material: color.withAlpha(selected ? 0.24 : 0.13),
          heightReference: HeightReference.NONE
        }
      });
    });
    viewer.scene.requestRender();
  }

  return {
    terrainMode,
    setProjects,
    flyToProject(project) {
      viewer.camera.flyTo({
        destination: Cartesian3.fromDegrees(project.longitude, project.latitude - 1.8, 470_000),
        orientation: { heading: 0, pitch: CesiumMath.toRadians(-48), roll: 0 },
        duration: 1.4
      });
    },
    flyHome() { viewer.camera.flyTo({ destination: HOME_RECTANGLE, duration: 1.35 }); },
    zoomIn() { viewer.camera.zoomIn(viewer.camera.positionCartographic.height * 0.22); },
    zoomOut() { viewer.camera.zoomOut(viewer.camera.positionCartographic.height * 0.28); },
    destroy() {
      handler.destroy();
      if (!viewer.isDestroyed()) viewer.destroy();
    }
  };
}
