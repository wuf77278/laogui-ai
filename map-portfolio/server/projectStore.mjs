import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

function validate(input) {
  const errors = [];
  if (!String(input?.title ?? "").trim()) errors.push("项目名称不能为空");
  if (!String(input?.province ?? "").trim()) errors.push("省份不能为空");
  if (!String(input?.city ?? "").trim()) errors.push("城市不能为空");
  if (!String(input?.category ?? "").trim()) errors.push("项目类型不能为空");

  const longitude = Number(input?.longitude);
  const latitude = Number(input?.latitude);
  const year = Number(input?.year);
  const importance = Number(input?.importance);
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) errors.push("经度必须在 -180 到 180 之间");
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) errors.push("纬度必须在 -90 到 90 之间");
  if (!Number.isInteger(year) || year < 1900 || year > 2100) errors.push("年份必须在 1900 到 2100 之间");
  if (![1, 2, 3].includes(importance)) errors.push("重要程度只能是 1、2 或 3");
  return errors;
}

function normalize(input, existing = {}) {
  const now = new Date().toISOString();
  return {
    id: existing.id || input.id || randomUUID(),
    title: String(input.title).trim(),
    slug: String(input.slug || input.title).trim().toLocaleLowerCase("zh-CN").replace(/\s+/g, "-"),
    province: String(input.province).trim(),
    city: String(input.city).trim(),
    longitude: Number(input.longitude),
    latitude: Number(input.latitude),
    year: Number(input.year),
    category: String(input.category).trim(),
    area: String(input.area || "未填写").trim(),
    summary: String(input.summary || "").trim(),
    description: String(input.description || "").trim(),
    coverImage: String(input.coverImage || "/map-portfolio/assets/project-cover.png"),
    gallery: Array.isArray(input.gallery) ? input.gallery.map(String) : [],
    importance: Number(input.importance),
    isFeatured: Boolean(input.isFeatured),
    isPublished: input.isPublished !== false,
    createdAt: existing.createdAt || input.createdAt || now,
    updatedAt: now
  };
}

export function createProjectStore(filePath) {
  async function readAll() {
    try {
      const content = await readFile(filePath, "utf8");
      const projects = JSON.parse(content);
      return Array.isArray(projects) ? projects : [];
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
  }

  async function writeAll(projects) {
    await mkdir(dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(projects, null, 2)}\n`, "utf8");
    await rename(temporaryPath, filePath);
  }

  return {
    list: readAll,
    async get(id) {
      return (await readAll()).find((project) => project.id === id) ?? null;
    },
    async create(input) {
      const errors = validate(input);
      if (errors.length) throw new Error(errors.join("；"));
      const projects = await readAll();
      const project = normalize(input);
      projects.push(project);
      await writeAll(projects);
      return project;
    },
    async update(id, input) {
      const errors = validate(input);
      if (errors.length) throw new Error(errors.join("；"));
      const projects = await readAll();
      const index = projects.findIndex((project) => project.id === id);
      if (index < 0) return null;
      projects[index] = normalize(input, projects[index]);
      await writeAll(projects);
      return projects[index];
    },
    async remove(id) {
      const projects = await readAll();
      const nextProjects = projects.filter((project) => project.id !== id);
      if (nextProjects.length === projects.length) return false;
      await writeAll(nextProjects);
      return true;
    },
    async replaceAll(projects) {
      if (!Array.isArray(projects)) throw new Error("备份文件格式不正确");
      for (const project of projects) {
        const errors = validate(project);
        if (errors.length) throw new Error(`项目“${project?.title || "未命名"}”存在问题：${errors.join("；")}`);
      }
      const normalized = projects.map((project) => normalize(project, project));
      await writeAll(normalized);
      return normalized;
    }
  };
}
