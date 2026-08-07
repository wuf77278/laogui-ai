import * as THREE from "../public/vendor/three.module.js";

const mapCanvas = document.querySelector("#mapCanvas");
const stage = document.querySelector(".map-stage");
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(33, innerWidth / innerHeight, .1, 1000);
camera.position.set(0, 16, 31);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
mapCanvas.appendChild(renderer.domElement);

scene.add(new THREE.AmbientLight(0x9cc6bd, 1.5));
const keyLight = new THREE.DirectionalLight(0xffdca0, 3.4); keyLight.position.set(-12, 20, 16); scene.add(keyLight);
const rimLight = new THREE.PointLight(0x2cdae4, 2.3, 90); rimLight.position.set(16, 8, -9); scene.add(rimLight);

const mapGroup = new THREE.Group();
mapGroup.rotation.x = -.34;
mapGroup.rotation.z = -.03;
scene.add(mapGroup);

const chinaOutline = [
  [-10.8, 5.3], [-9.2, 6.5], [-7.2, 6.8], [-5.5, 7.4], [-3.8, 7.1], [-2.1, 7.5], [-.2, 7.3], [1.4, 7.6], [2.6, 8.5], [4.1, 8.4], [5.4, 7.6], [7.1, 7.7], [8.5, 7.2], [9.7, 6.1], [10.7, 5.1], [10.2, 3.9], [8.8, 3.5], [9.1, 2.5], [8.4, 1.4], [8.8, .4], [7.8, -.4], [7.5, -1.6], [6.6, -2.1], [6.7, -3.1], [5.2, -3.6], [4.4, -4.6], [3.4, -5.2], [2.1, -4.5], [.7, -5.3], [-.7, -4.3], [-2.2, -4.8], [-3.5, -4.1], [-4.6, -4.8], [-5.8, -4.1], [-6.8, -3.3], [-8.1, -3.1], [-8.6, -1.9], [-9.6, -1.2], [-9.2, .2], [-10.2, 1.3], [-9.8, 2.6], [-11.2, 3.6]
].map(([x, z]) => new THREE.Vector2(x, z));

const shape = new THREE.Shape(chinaOutline);
const base = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 1.05, bevelEnabled: true, bevelSegments: 2, bevelSize: .12, bevelThickness: .1, curveSegments: 2 }), new THREE.MeshStandardMaterial({ color: 0x173a38, roughness: .78, metalness: .12 }));
base.rotation.x = Math.PI / 2; base.position.y = -.3; mapGroup.add(base);
const baseEdge = new THREE.LineSegments(new THREE.EdgesGeometry(base.geometry), new THREE.LineBasicMaterial({ color: 0xd5a44c, transparent: true, opacity: .42 }));
baseEdge.rotation.copy(base.rotation); baseEdge.position.copy(base.position); mapGroup.add(baseEdge);

const terrain = new THREE.Group(); mapGroup.add(terrain);
function mountain(x, z, scale, color = 0x41645c) {
  const geo = new THREE.ConeGeometry(scale * .68, scale * 1.45, 5, 2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: .9, metalness: .04, flatShading: true }));
  mesh.position.set(x, .38 + scale * .22, z); mesh.rotation.y = Math.random() * Math.PI; mesh.rotation.z = (Math.random() - .5) * .18; terrain.add(mesh); return mesh;
}
[
  [-8.6, 4.2, 2.2], [-6.4, 4.8, 1.4], [-4.5, 4.9, 1.8], [-2.5, 4.7, 1.2], [.2, 4.7, 1.2], [2.5, 5.6, 1.8], [5.1, 5.3, 1.55], [7.7, 5.2, 1.3], [-8.2, 2.3, 1.8], [-6.2, 2.1, 1.15], [-3.9, 2.6, 1.5], [-1.8, 2.6, 1.1], [1.1, 2.5, 1.35], [3.1, 2.8, 1.55], [5.1, 2.5, 1.25], [7.2, 2.5, 1.1], [-7.8, .2, 1.1], [-5.6, -.3, 1.35], [-3.7, -.2, 1.65], [-1.5, -.5, 1.1], [.7, -.4, 1.35], [2.6, -.1, 1.2], [4.6, -.5, 1.4], [6.1, -.8, 1.05], [-5.6, -2.3, 1.2], [-3.6, -2.6, 1.05], [-1.5, -2.3, .9], [.4, -2.1, 1.3], [2.4, -2.7, 1.05], [4.1, -2.6, .9]
].forEach(([x, z, s], i) => mountain(x, z, s, i % 3 === 0 ? 0x315a55 : 0x49675b));

const ridges = new THREE.Group(); mapGroup.add(ridges);
for (let i = 0; i < 13; i++) {
  const points = []; const startX = -9.3 + Math.random() * 17; const startZ = -3.7 + Math.random() * 8;
  for (let j = 0; j < 7; j++) points.push(new THREE.Vector3(startX + j * 1.9, .83 + Math.sin(j * 1.25 + i) * .13, startZ + Math.sin(j * .68 + i) * .6));
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: i % 2 ? 0x84aaa0 : 0xb98b48, transparent: true, opacity: .26 })); ridges.add(line);
}

const dataGroup = new THREE.Group(); mapGroup.add(dataGroup);
const projectData = [
  { name: "山地庭院", type: "文化旅居 / 民宿", location: "四川 · 西昌", year: "2021", area: "8,420 m²", x: 3.6, z: -1.7, color: 0xffc86a, desc: "让建筑顺着山势展开，借一座庭院把风、光与人的日常重新连在一起。" },
  { name: "云上茶室", type: "茶空间 / 乡村更新", location: "云南 · 大理", year: "2023", area: "1,860 m²", x: -1.8, z: .3, color: 0xffd981, desc: "把一段旧屋檐改成面向山谷的慢生活场所，材料取自当地石与木。" },
  { name: "潮汐客厅", type: "精品酒店 / 滨水", location: "浙江 · 象山", year: "2024", area: "12,600 m²", x: 6.9, z: -.3, color: 0xffbd56, desc: "以潮汐的涨落组织公共空间，让室内外的边界随海风变得轻盈。" },
  { name: "松间居", type: "度假住宅 / 景观", location: "福建 · 武夷山", year: "2020", area: "3,240 m²", x: 2.7, z: -3.2, color: 0xffd47d, desc: "在林间保留安静的留白，用极少的建筑动作换取更多自然视野。" },
  { name: "北岸礼序", type: "公共空间 / 展陈", location: "辽宁 · 大连", year: "2018", area: "5,720 m²", x: 7.1, z: 4.9, color: 0xffc05f, desc: "以连续的光廊串起城市公共生活，形成一条可漫游的展陈路径。" }
];
const tourismData = [
  { name: "九寨沟", x: -4.9, z: 3.6, value: .94 }, { name: "西湖", x: 6.5, z: -1.7, value: .81 }, { name: "张家界", x: 1.9, z: -1.8, value: .72 }, { name: "丽江古城", x: -3.4, z: -1.8, value: .62 }, { name: "故宫", x: 5.4, z: 4.2, value: .86 }, { name: "黄山", x: 4.8, z: -1.9, value: .68 }
];
const hotelData = [
  { name: "三亚", x: 3.2, z: -5.1, value: .96 }, { name: "杭州", x: 6.3, z: -1.5, value: .74 }, { name: "上海", x: 7.9, z: .4, value: .88 }, { name: "成都", x: -1.5, z: .1, value: .52 }, { name: "大理", x: -3.4, z: -1.8, value: .63 }, { name: "北京", x: 5.8, z: 4.4, value: .82 }
];

const markers = [];
function addMarker(item, mode, index) {
  const group = new THREE.Group(); group.position.set(item.x, 1.04, item.z); group.userData = { ...item, mode };
  const markerValue = Number.isFinite(Number(item.value)) ? Number(item.value) : .35;
  const glow = new THREE.Mesh(new THREE.SphereGeometry(.14, 12, 12), new THREE.MeshBasicMaterial({ color: mode === "projects" ? item.color : mode === "tourism" ? 0xffb34f : new THREE.Color().setHSL(.53 - item.value * .53, .85, .58) })); group.add(glow);
  const halo = new THREE.Mesh(new THREE.RingGeometry(.16, .27, 32), new THREE.MeshBasicMaterial({ color: glow.material.color, transparent: true, opacity: .55, side: THREE.DoubleSide })); halo.rotation.x = -Math.PI / 2; halo.position.y = -.02; group.add(halo);
  const height = mode === "projects" ? .45 : .45 + markerValue * 4.4;
  const beamColor = mode === "projects" ? item.color : mode === "tourism" ? 0xffac45 : new THREE.Color().setHSL(.55 - markerValue * .55, .86, .57);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(.035 + markerValue * .04, .075 + markerValue * .06, height, 10), new THREE.MeshBasicMaterial({ color: beamColor, transparent: true, opacity: mode === "projects" ? .85 : .7 })); beam.position.y = height / 2; group.add(beam);
  const beamHalo = new THREE.Mesh(new THREE.CylinderGeometry(.13, .2, height, 12, 1, true), new THREE.MeshBasicMaterial({ color: beamColor, transparent: true, opacity: .08, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })); beamHalo.position.y = height / 2; group.add(beamHalo);
  group.visible = mode === currentMode; dataGroup.add(group); markers.push(group);
  return group;
}
let currentMode = "projects";
projectData.forEach((item, i) => addMarker(item, "projects", i));
tourismData.forEach((item, i) => addMarker(item, "tourism", i));
hotelData.forEach((item, i) => addMarker(item, "hotels", i));

const stars = new THREE.Group(); scene.add(stars);
for (let i = 0; i < 150; i++) { const dot = new THREE.Mesh(new THREE.SphereGeometry(.012 + Math.random() * .02, 5, 5), new THREE.MeshBasicMaterial({ color: i % 5 ? 0x4d93a0 : 0xe0b66c, transparent: true, opacity: .28 + Math.random() * .48 })); dot.position.set((Math.random() - .5) * 45, Math.random() * 17 - 3, (Math.random() - .5) * 25); stars.add(dot); }

let targetRotation = { x: -.34, z: -.03 }; let dragging = false; let last = { x: 0, y: 0 }; let selected = projectData[0];
function setMode(mode) { currentMode = mode; markers.forEach((m) => { m.visible = m.userData.mode === mode; }); document.querySelectorAll(".mode-button").forEach((button) => button.classList.toggle("active", button.dataset.mode === mode)); if (mode === "projects") selectProject(projectData[0]); else { const source = mode === "tourism" ? tourismData[0] : hotelData[0]; selectData(source, mode); } }
function selectProject(data) { selected = data; document.querySelector("#projectName").textContent = data.name; document.querySelector("#projectType").textContent = data.type; document.querySelector("#projectLocation").textContent = data.location; document.querySelector("#projectYear").textContent = data.year; document.querySelector("#projectArea").textContent = data.area; document.querySelector("#projectDescription").textContent = data.desc; }
function selectData(data, mode) { document.querySelector("#projectName").textContent = data.name; document.querySelector("#projectType").textContent = mode === "tourism" ? `景区热度 · ${Math.round(data.value * 100)} / 100` : `酒店价格 · ${data.value > .8 ? "高位" : data.value > .6 ? "中高位" : "亲和"}`; document.querySelector("#projectLocation").textContent = "中国 · 数据示意"; document.querySelector("#projectYear").textContent = "实时"; document.querySelector("#projectArea").textContent = mode === "tourism" ? "人流强度" : "每晚均价"; document.querySelector("#projectDescription").textContent = mode === "tourism" ? "光柱越高、光点越亮，表示当前平台记录的景区热度越高。" : "颜色从青色到红色，表示从较低到较高的住宿价格区间。"; }
document.querySelectorAll(".mode-button").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));
document.querySelector("#resetView").addEventListener("click", () => { targetRotation = { x: -.34, z: -.03 }; camera.position.set(0, 16, 31); });
document.querySelector("#zoomIn").addEventListener("click", () => { camera.position.multiplyScalar(.9); }); document.querySelector("#zoomOut").addEventListener("click", () => { camera.position.multiplyScalar(1.1); });
document.querySelector("#fullscreen").addEventListener("click", () => document.documentElement.requestFullscreen?.());
document.querySelector("#playTimeline").addEventListener("click", (event) => { event.currentTarget.textContent = event.currentTarget.textContent === "▶" ? "Ⅱ" : "▶"; });
document.querySelector("#yearRange").addEventListener("input", (event) => { document.querySelector(".years .selected")?.classList.remove("selected"); const year = String(event.target.value); const found = [...document.querySelectorAll(".years span")].find((span) => span.textContent === year); found?.classList.add("selected"); });

renderer.domElement.addEventListener("pointerdown", (event) => { dragging = true; last = { x: event.clientX, y: event.clientY }; renderer.domElement.setPointerCapture(event.pointerId); });
renderer.domElement.addEventListener("pointermove", (event) => { if (!dragging) return; const dx = event.clientX - last.x; const dy = event.clientY - last.y; targetRotation.z += dx * .003; targetRotation.x = THREE.MathUtils.clamp(targetRotation.x + dy * .002, -.78, .15); last = { x: event.clientX, y: event.clientY }; });
renderer.domElement.addEventListener("pointerup", () => { dragging = false; }); renderer.domElement.addEventListener("pointerleave", () => { dragging = false; });

const raycaster = new THREE.Raycaster(); const pointer = new THREE.Vector2();
renderer.domElement.addEventListener("click", (event) => { if (dragging) return; const rect = renderer.domElement.getBoundingClientRect(); pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1; pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1; raycaster.setFromCamera(pointer, camera); const hits = raycaster.intersectObjects(markers, true); const hit = hits.find((item) => item.object.parent?.userData?.mode === currentMode); if (!hit) return; const data = hit.object.parent.userData; if (currentMode === "projects") selectProject(data); else selectData(data, currentMode); });

function animate() { requestAnimationFrame(animate); mapGroup.rotation.x += (targetRotation.x - mapGroup.rotation.x) * .08; mapGroup.rotation.z += (targetRotation.z - mapGroup.rotation.z) * .08; const time = performance.now() * .002; markers.forEach((marker, index) => { if (!marker.visible) return; const pulse = 1 + Math.sin(time + index * .7) * .09; marker.children[0].scale.setScalar(pulse); marker.children[1].scale.setScalar(1 + (pulse - 1) * 1.8); }); renderer.render(scene, camera); }
animate();
addEventListener("resize", () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
